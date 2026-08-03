"""Recruitment pipeline for the Human Resource Master View.

Candidates (job seekers) move Applied -> Screening -> Interview -> Selected -> Offer Sent
-> Joined, or leave the pipeline at Rejected from any point. Every move is appended to the
candidate's own history so the board can answer "why is this person still at Screening
three weeks later" without a separate audit trail.

Two deliberate departures from how the patient pipelines are stored, both learned from
bugs this codebase has already paid for:

1. Candidates live in their own `candidates` collection, never in `leads`. A job seeker
   and a patient share almost no fields and none of the same lifecycle; putting both in
   one collection is exactly the shape that took the OS down when `sessions` held login
   tokens and treatment sessions at the same time.

2. A candidate stores `stage_id`, not the stage's name. Everywhere else in the OS a lead
   stores the stage *name*, which is why renaming a stage in Pipeline Stage Management has
   repeatedly orphaned records — the literal stops matching anything real. An id cannot go
   stale, so HR can rename any stage here and no migration is ever needed.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator
from typing import Optional, List, Dict, Any
from datetime import date
import asyncio
import re
import uuid

from database import v3_col
from utils import now_iso
from deps import v3_current_user
from constants import V3_RECRUITMENT_STAGES
from schemas.v3 import V3UserOut
from routers.v3_marketing import extract_spreadsheet_id, normalize_phone

router = APIRouter(prefix="/api/v3/recruitment")

STAGE_TYPE = "recruitment"

# Where a candidate came from. Free text is still accepted — this is the picker's list,
# not a constraint, because HR will always have a source nobody thought of.
SOURCES = ["Referral", "Walk-in", "Naukri", "LinkedIn", "Indeed", "Website", "Consultancy", "Other"]

INTERVIEW_MODES = ["In-person", "Phone", "Video"]


# ---------------------------------------------------------------- access

def _is_hr_role(role: str) -> bool:
    """Whether this role may work the recruitment board.

    The HR role is created by hand in Super Admin -> HR Admin, so its slug is whatever
    label was typed ("Human Resource" -> human_resource). Rather than pin one literal and
    have the board silently 403 if a different label was used, any role whose slug reads as
    HR/recruitment is accepted. Matched on whole underscore-separated tokens so an
    unrelated future role can't slip in on a substring.
    """
    r = (role or "").strip().lower()
    if r == "super_admin":
        return True
    if "human_resource" in r:
        return True
    return bool(set(r.split("_")) & {"hr", "recruiter", "recruitment", "talent"})


async def require_hr(user: V3UserOut = Depends(v3_current_user)) -> V3UserOut:
    if not _is_hr_role(user.role):
        raise HTTPException(status_code=403, detail="Not allowed")
    return user


# ---------------------------------------------------------------- stages

async def _ensure_recruitment_stages() -> None:
    """Seed the pipeline once.

    Deliberately separate from v3_stages._ensure_seed, which only fires when
    pipeline_stages is completely empty — in production it never is, so a new type added
    there would never appear.
    """
    if await v3_col("pipeline_stages").count_documents({"type": STAGE_TYPE}):
        return
    await v3_col("pipeline_stages").insert_many([
        {
            "id": str(uuid.uuid4()),
            "name": name,
            "color": color,
            "type": STAGE_TYPE,
            "order": idx,
            "is_final": is_final,
            "created_at": now_iso(),
        }
        for idx, (name, color, is_final) in enumerate(V3_RECRUITMENT_STAGES)
    ])


async def _stages() -> List[dict]:
    await _ensure_recruitment_stages()
    return await v3_col("pipeline_stages").find(
        {"type": STAGE_TYPE}, {"_id": 0}
    ).sort("order", 1).to_list(100)


async def _stage_or_404(stage_id: str) -> dict:
    st = await v3_col("pipeline_stages").find_one({"id": stage_id, "type": STAGE_TYPE}, {"_id": 0})
    if not st:
        raise HTTPException(status_code=404, detail="Stage not found")
    return st


# ---------------------------------------------------------------- models

class CandidateIn(BaseModel):
    full_name: str
    phone: str
    email: Optional[str] = ""
    position: Optional[str] = ""
    department: Optional[str] = ""
    branch_id: Optional[str] = None
    experience_years: Optional[float] = None
    current_ctc: Optional[float] = None
    expected_ctc: Optional[float] = None
    location: Optional[str] = ""
    source: Optional[str] = "Walk-in"
    resume_url: Optional[str] = ""
    notes: Optional[str] = ""

    @field_validator("full_name", "phone")
    @classmethod
    def _required(cls, v):
        if not str(v or "").strip():
            raise ValueError("Required")
        return str(v).strip()


class CandidateUpdate(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    position: Optional[str] = None
    department: Optional[str] = None
    branch_id: Optional[str] = None
    experience_years: Optional[float] = None
    current_ctc: Optional[float] = None
    expected_ctc: Optional[float] = None
    location: Optional[str] = None
    source: Optional[str] = None
    resume_url: Optional[str] = None
    notes: Optional[str] = None


class MoveIn(BaseModel):
    stage_id: str
    remark: Optional[str] = ""


class InterviewIn(BaseModel):
    interview_date: str          # YYYY-MM-DD
    interview_time: Optional[str] = ""   # HH:MM, 24h
    mode: Optional[str] = "In-person"
    panel: Optional[str] = ""    # who is taking it
    notes: Optional[str] = ""


class OfferIn(BaseModel):
    offered_ctc: Optional[float] = None
    joining_date: Optional[str] = ""
    notes: Optional[str] = ""


class NoteIn(BaseModel):
    note: str


# ---------------------------------------------------------------- shaping

def _shape(c: dict, by_id: dict) -> dict:
    """Attach the live stage name/colour, resolved from stage_id at read time.

    Nothing downstream reads a stage name off the stored document, which is what keeps a
    rename free of migrations.
    """
    st = by_id.get(c.get("stage_id")) or {}
    out = {k: v for k, v in c.items() if k != "_id"}
    out["stage_name"] = st.get("name") or "Unassigned"
    out["stage_color"] = st.get("color") or "#64748b"
    out["stage_order"] = st.get("order", 999)
    out["stage_is_final"] = bool(st.get("is_final"))
    return out


async def _candidate_or_404(cand_id: str) -> dict:
    c = await v3_col("candidates").find_one({"id": cand_id}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Candidate not found")
    return c


def _history_entry(user: V3UserOut, action: str, detail: str = "") -> dict:
    return {
        "at": now_iso(),
        "by": user.full_name or user.email,
        "action": action,
        "detail": detail,
    }


# ---------------------------------------------------------------- board

@router.get("/board")
async def recruitment_board(
    stage_id: Optional[str] = None,
    search: Optional[str] = None,
    source: Optional[str] = None,
    branch_id: Optional[str] = None,
    user: V3UserOut = Depends(require_hr),
):
    """Everything the dashboard renders in one call: the pipeline, the candidates on it,
    and the counts the summary cards sit on."""
    stages = await _stages()
    by_id = {s["id"]: s for s in stages}

    q: dict = {}
    if stage_id and stage_id != "all":
        q["stage_id"] = stage_id
    if source and source != "all":
        q["source"] = source
    if branch_id and branch_id != "all":
        q["branch_id"] = branch_id
    if search and search.strip():
        rx = {"$regex": search.strip(), "$options": "i"}
        q["$or"] = [{"full_name": rx}, {"phone": rx}, {"email": rx}, {"position": rx}]

    rows = await v3_col("candidates").find(q, {"_id": 0}).sort("created_at", -1).to_list(2000)
    shaped = [_shape(c, by_id) for c in rows]

    # Counts are of the whole pipeline, not the filtered view — a card that changed every
    # time you typed in the search box would be useless as a workload figure.
    all_rows = rows if not q else await v3_col("candidates").find({}, {"_id": 0, "stage_id": 1, "interview": 1}).to_list(5000)
    per_stage = {s["id"]: 0 for s in stages}
    for c in all_rows:
        if c.get("stage_id") in per_stage:
            per_stage[c["stage_id"]] += 1

    today = date.today().isoformat()
    interviews_today = sum(
        1 for c in all_rows if (c.get("interview") or {}).get("interview_date") == today
    )

    final_ids = {s["id"] for s in stages if s.get("is_final")}
    return {
        "stages": [{**s, "count": per_stage.get(s["id"], 0)} for s in stages],
        "candidates": shaped,
        "summary": {
            "total": len(all_rows),
            "in_process": sum(1 for c in all_rows if c.get("stage_id") not in final_ids),
            "interviews_today": interviews_today,
            "per_stage": per_stage,
        },
        "sources": SOURCES,
        "interview_modes": INTERVIEW_MODES,
    }


@router.get("/stages")
async def list_recruitment_stages(user: V3UserOut = Depends(require_hr)):
    stages = await _stages()
    counts = {}
    async for row in v3_col("candidates").aggregate([{"$group": {"_id": "$stage_id", "n": {"$sum": 1}}}]):
        counts[row["_id"]] = row["n"]
    return [{**s, "count": counts.get(s["id"], 0)} for s in stages]


# ---------------------------------------------------------------- candidates

@router.post("/candidates")
async def create_candidate(payload: CandidateIn, user: V3UserOut = Depends(require_hr)):
    stages = await _stages()
    if not stages:
        raise HTTPException(status_code=500, detail="Recruitment pipeline is not configured")

    # Re-applying is normal and fine; two open records for the same person is not — the
    # second one silently splits their history across two cards.
    open_ids = [s["id"] for s in stages if not s.get("is_final")]
    dup = await v3_col("candidates").find_one(
        {"phone": payload.phone.strip(), "stage_id": {"$in": open_ids}}, {"_id": 0, "full_name": 1, "id": 1}
    )
    if dup:
        raise HTTPException(
            status_code=409,
            detail=f"{dup['full_name']} is already in the pipeline on this number.",
        )

    doc = {
        "id": str(uuid.uuid4()),
        **payload.model_dump(),
        "stage_id": stages[0]["id"],
        "interview": None,
        "offer": None,
        "rejected_reason": "",
        "history": [_history_entry(user, "Added", f"Entered at {stages[0]['name']}")],
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "created_by": user.full_name or user.email,
    }
    await v3_col("candidates").insert_one(doc.copy())
    return _shape(doc, {s["id"]: s for s in stages})


@router.get("/candidates/{cand_id}")
async def get_candidate(cand_id: str, user: V3UserOut = Depends(require_hr)):
    c = await _candidate_or_404(cand_id)
    return _shape(c, {s["id"]: s for s in await _stages()})


@router.patch("/candidates/{cand_id}")
async def update_candidate(cand_id: str, payload: CandidateUpdate, user: V3UserOut = Depends(require_hr)):
    await _candidate_or_404(cand_id)
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No updates provided")
    updates["updated_at"] = now_iso()
    await v3_col("candidates").update_one(
        {"id": cand_id},
        {"$set": updates, "$push": {"history": _history_entry(user, "Edited", ", ".join(sorted(k for k in updates if k != "updated_at")))}},
    )
    return await get_candidate(cand_id, user)


@router.post("/candidates/{cand_id}/move")
async def move_candidate(cand_id: str, payload: MoveIn, user: V3UserOut = Depends(require_hr)):
    c = await _candidate_or_404(cand_id)
    target = await _stage_or_404(payload.stage_id)
    stages = await _stages()
    by_id = {s["id"]: s for s in stages}
    current = by_id.get(c.get("stage_id")) or {}

    if current.get("id") == target["id"]:
        raise HTTPException(status_code=400, detail=f"Already at {target['name']}")

    updates = {"stage_id": target["id"], "updated_at": now_iso()}
    # Only meaningful on the way out; kept so a rejected candidate's card explains itself.
    if target.get("is_final") and payload.remark:
        updates["rejected_reason"] = payload.remark

    await v3_col("candidates").update_one(
        {"id": cand_id},
        {"$set": updates, "$push": {"history": _history_entry(
            user, "Moved", f"{current.get('name', '—')} -> {target['name']}" + (f" · {payload.remark}" if payload.remark else "")
        )}},
    )
    return await get_candidate(cand_id, user)


@router.post("/candidates/{cand_id}/interview")
async def schedule_interview(cand_id: str, payload: InterviewIn, user: V3UserOut = Depends(require_hr)):
    await _candidate_or_404(cand_id)
    interview = payload.model_dump()
    await v3_col("candidates").update_one(
        {"id": cand_id},
        {"$set": {"interview": interview, "updated_at": now_iso()},
         "$push": {"history": _history_entry(
             user, "Interview scheduled",
             f"{payload.interview_date} {payload.interview_time or ''} · {payload.mode}".strip()
         )}},
    )
    return await get_candidate(cand_id, user)


@router.post("/candidates/{cand_id}/offer")
async def record_offer(cand_id: str, payload: OfferIn, user: V3UserOut = Depends(require_hr)):
    await _candidate_or_404(cand_id)
    offer = {**payload.model_dump(), "sent_on": now_iso()}
    await v3_col("candidates").update_one(
        {"id": cand_id},
        {"$set": {"offer": offer, "updated_at": now_iso()},
         "$push": {"history": _history_entry(
             user, "Offer recorded",
             f"Rs.{payload.offered_ctc or 0:,.0f}" + (f" · joins {payload.joining_date}" if payload.joining_date else "")
         )}},
    )
    return await get_candidate(cand_id, user)


@router.post("/candidates/{cand_id}/notes")
async def add_note(cand_id: str, payload: NoteIn, user: V3UserOut = Depends(require_hr)):
    if not payload.note.strip():
        raise HTTPException(status_code=400, detail="Note is empty")
    await _candidate_or_404(cand_id)
    await v3_col("candidates").update_one(
        {"id": cand_id},
        {"$set": {"updated_at": now_iso()},
         "$push": {"history": _history_entry(user, "Note", payload.note.strip())}},
    )
    return await get_candidate(cand_id, user)


@router.delete("/candidates/{cand_id}")
async def delete_candidate(cand_id: str, user: V3UserOut = Depends(require_hr)):
    await _candidate_or_404(cand_id)
    await v3_col("candidates").delete_one({"id": cand_id})
    return {"message": "Candidate removed"}


# ---------------------------------------------------------------- stage admin

class StageReorder(BaseModel):
    ids: List[str]  # every recruitment stage id, in the order they should sit


class StageIn(BaseModel):
    name: str
    color: Optional[str] = "#64748b"
    is_final: Optional[bool] = False


class StagePatch(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    is_final: Optional[bool] = None


@router.post("/stages")
async def create_recruitment_stage(payload: StageIn, user: V3UserOut = Depends(require_hr)):
    stages = await _stages()
    doc = {
        "id": str(uuid.uuid4()),
        "name": payload.name.strip(),
        "color": payload.color or "#64748b",
        "type": STAGE_TYPE,
        "order": (stages[-1]["order"] + 1) if stages else 0,
        "is_final": bool(payload.is_final),
        "created_at": now_iso(),
    }
    await v3_col("pipeline_stages").insert_one(doc.copy())
    return doc


@router.patch("/stages/{stage_id}")
async def update_recruitment_stage(stage_id: str, payload: StagePatch, user: V3UserOut = Depends(require_hr)):
    await _stage_or_404(stage_id)
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No updates provided")
    # No candidate rewrite needed on rename: they point at this id, not at its name.
    await v3_col("pipeline_stages").update_one({"id": stage_id, "type": STAGE_TYPE}, {"$set": updates})
    return await v3_col("pipeline_stages").find_one({"id": stage_id}, {"_id": 0})


@router.post("/stages/reorder")
async def reorder_recruitment_stages(payload: StageReorder, user: V3UserOut = Depends(require_hr)):
    """Rewrite the whole order in one call.

    The full list is required rather than a pair of swapped ids: a partial reorder can
    leave two stages sharing an `order`, and the pipeline's first stage — where every new
    candidate lands — is decided by that sort.
    """
    existing = {s["id"] for s in await _stages()}
    if set(payload.ids) != existing:
        raise HTTPException(status_code=400, detail="Send every recruitment stage id exactly once")
    for i, sid in enumerate(payload.ids):
        await v3_col("pipeline_stages").update_one({"id": sid, "type": STAGE_TYPE}, {"$set": {"order": i}})
    return await _stages()


@router.delete("/stages/{stage_id}")
async def delete_recruitment_stage(stage_id: str, user: V3UserOut = Depends(require_hr)):
    await _stage_or_404(stage_id)
    in_use = await v3_col("candidates").count_documents({"stage_id": stage_id})
    if in_use:
        raise HTTPException(status_code=409, detail=f"{in_use} candidate(s) are on this stage. Move them first.")
    remaining = await v3_col("pipeline_stages").count_documents({"type": STAGE_TYPE})
    if remaining <= 1:
        raise HTTPException(status_code=409, detail="A pipeline needs at least one stage")
    await v3_col("pipeline_stages").delete_one({"id": stage_id, "type": STAGE_TYPE})
    return {"message": "Stage deleted"}


# ---------------------------------------------------------------- lead sheets

"""Candidate lead sheets.

HR's own Google Sheet sources, kept apart from Marketing's `marketing_sources` in their own
`candidate_sources` collection. Both read through the one company-wide Google connection
Super Admin authorises, but a recruitment sheet must never be pullable into `leads` and a
marketing sheet must never land in `candidates` — separate collections make that a
structural guarantee rather than a filter someone can forget.
"""

CANDIDATE_FIELD_ALIASES = {
    "full_name": ["name", "full name", "fullname", "candidate name", "candidate", "applicant name", "applicant"],
    "phone": ["phone", "phone number", "mobile", "mobile number", "contact", "contact number", "whatsapp"],
    "email": ["email", "email id", "email address", "mail"],
    "position": ["position", "role", "designation", "applied for", "applying for", "job title", "post", "vacancy"],
    "department": ["department", "dept", "team", "function"],
    "location": ["location", "city", "place", "current location", "preferred location"],
    "experience_years": ["experience", "exp", "years of experience", "total experience", "experience years", "yoe"],
    "current_ctc": ["current ctc", "current salary", "present ctc", "present salary", "ctc"],
    "expected_ctc": ["expected ctc", "expected salary", "expectation", "salary expectation"],
    "source": ["source", "referred by", "referral", "channel", "came from"],
    "resume_url": ["resume", "cv", "resume link", "cv link", "resume url", "profile"],
    "notes": ["notes", "remarks", "comments", "message", "about"],
}

CANDIDATE_TEXT_FIELDS = {"full_name", "phone", "email", "position", "department", "location", "source", "resume_url", "notes"}
CANDIDATE_NUMBER_FIELDS = {"experience_years", "current_ctc", "expected_ctc"}


def auto_map_candidate_columns(headers: List[str]) -> Dict[str, str]:
    mapping: Dict[str, str] = {}
    lowered = {str(h).strip().lower(): h for h in headers}
    used: set = set()
    for std, aliases in CANDIDATE_FIELD_ALIASES.items():
        for alias in aliases:
            if alias in lowered and lowered[alias] not in used:
                mapping[std] = lowered[alias]
                used.add(lowered[alias])
                break
    return mapping


def _parse_number(raw: Any, field: str) -> Optional[float]:
    """Turn what people actually type into a number, or None.

    Recruitment sheets are written by hand: "3 yrs", "4.5 LPA", "Rs. 4,80,000", "6L". A
    salary given in lakhs is expanded, because 4.5 stored against 480000 in the next row
    would make every comparison on the board meaningless.
    """
    text = str(raw or "").strip().lower()
    if not text:
        return None
    m = re.search(r"\d+(?:\.\d+)?", text.replace(",", ""))
    if not m:
        return None
    value = float(m.group())
    if field in ("current_ctc", "expected_ctc"):
        if re.search(r"\b(lpa|lakh|lac|l)\b", text) or text.endswith("l"):
            value *= 100000
    return value


class SheetSourceCreate(BaseModel):
    name: str
    sheet_url: Optional[str] = ""
    spreadsheet_id: Optional[str] = ""
    sheet_name: Optional[str] = "Sheet1"
    default_position: Optional[str] = ""
    auto_sync_enabled: Optional[bool] = False
    auto_sync_interval_minutes: Optional[int] = 60


class SheetSourceUpdate(BaseModel):
    name: Optional[str] = None
    sheet_url: Optional[str] = None
    spreadsheet_id: Optional[str] = None
    sheet_name: Optional[str] = None
    default_position: Optional[str] = None
    column_mapping: Optional[Dict[str, str]] = None
    is_active: Optional[bool] = None
    auto_sync_enabled: Optional[bool] = None
    auto_sync_interval_minutes: Optional[int] = None


@router.get("/sheets/status")
async def sheet_status(user: V3UserOut = Depends(require_hr)):
    """Whether the company-wide Google connection exists.

    HR cannot authorise it — that is Super Admin's one-time step — so the board says which
    of the two it is waiting on rather than failing a pull with a bare error.
    """
    doc = await v3_col("google_sheets_tokens").find_one({"id": "_company_shared_"}, {"_id": 0, "refresh_token": 1, "connected_at": 1})
    return {
        "connected": bool(doc and doc.get("refresh_token")),
        "connected_at": (doc or {}).get("connected_at"),
        "fields": sorted(CANDIDATE_FIELD_ALIASES.keys()),
    }


@router.get("/sources")
async def list_sheet_sources(user: V3UserOut = Depends(require_hr)):
    return await v3_col("candidate_sources").find({}, {"_id": 0}).sort("created_at", -1).to_list(200)


@router.post("/sources")
async def create_sheet_source(payload: SheetSourceCreate, user: V3UserOut = Depends(require_hr)):
    spreadsheet_id = (payload.spreadsheet_id or "").strip() or extract_spreadsheet_id(payload.sheet_url or "")
    if not spreadsheet_id:
        raise HTTPException(status_code=400, detail="Paste the Google Sheet link (or its ID)")
    doc = {
        "id": str(uuid.uuid4()),
        "name": payload.name.strip() or "Candidate Sheet",
        "sheet_url": payload.sheet_url or "",
        "spreadsheet_id": spreadsheet_id,
        "sheet_name": payload.sheet_name or "Sheet1",
        # Applied to rows whose sheet has no position column — a recruitment sheet is
        # usually one opening, so the column is often just missing.
        "default_position": payload.default_position or "",
        "column_mapping": {},
        "headers_detected": [],
        "row_count": 0,
        "last_synced": None,
        "last_sync_imported": 0,
        "last_sync_skipped_duplicate": 0,
        "last_sync_skipped_no_phone": 0,
        "is_active": True,
        "auto_sync_enabled": bool(payload.auto_sync_enabled),
        "auto_sync_interval_minutes": max(int(payload.auto_sync_interval_minutes or 60), 5),
        "created_at": now_iso(),
        "created_by": user.full_name or user.email,
    }
    await v3_col("candidate_sources").insert_one(doc.copy())
    return doc


@router.patch("/sources/{source_id}")
async def update_sheet_source(source_id: str, payload: SheetSourceUpdate, user: V3UserOut = Depends(require_hr)):
    if not await v3_col("candidate_sources").find_one({"id": source_id}, {"_id": 0, "id": 1}):
        raise HTTPException(status_code=404, detail="Sheet source not found")
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if payload.sheet_url and not payload.spreadsheet_id:
        extracted = extract_spreadsheet_id(payload.sheet_url)
        if extracted:
            updates["spreadsheet_id"] = extracted
    if "auto_sync_interval_minutes" in updates:
        updates["auto_sync_interval_minutes"] = max(int(updates["auto_sync_interval_minutes"]), 5)
    if not updates:
        raise HTTPException(status_code=400, detail="No updates provided")
    updates["updated_at"] = now_iso()
    await v3_col("candidate_sources").update_one({"id": source_id}, {"$set": updates})
    return await v3_col("candidate_sources").find_one({"id": source_id}, {"_id": 0})


@router.delete("/sources/{source_id}")
async def delete_sheet_source(source_id: str, user: V3UserOut = Depends(require_hr)):
    res = await v3_col("candidate_sources").delete_one({"id": source_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Sheet source not found")
    # Candidates already pulled in are left alone on purpose — they are real people in a
    # live pipeline, not a cache of the spreadsheet.
    return {"message": "Sheet source removed. Candidates already imported were kept."}


@router.post("/sources/{source_id}/pull")
async def pull_sheet_source(source_id: str, range_: str = Query("A1:Z10000"), user: V3UserOut = Depends(require_hr)):
    result = await _pull_candidate_source(source_id, range_)
    if result.get("error"):
        raise HTTPException(status_code=400, detail=_pull_error_message(result["error"]))
    return result


def _pull_error_message(code: str) -> str:
    return {
        "source_not_found": "Sheet source not found",
        "no_spreadsheet_id": "This source has no Google Sheet linked",
        "not_connected": "Google Sheets is not connected. Ask Super Admin to connect it under Marketing.",
        "no_tabs_found": "That spreadsheet has no readable tabs",
    }.get(code, code)


async def _pull_candidate_source(source_id: str, range_: str = "A1:Z10000") -> Dict[str, Any]:
    """Read a sheet and import its rows as candidates.

    Imported inside the function rather than at module load so this router does not depend
    on the Google client libraries being importable just to serve the board.
    """
    from googleapiclient.discovery import build
    from routers.v3_google_sheets import _get_creds

    source = await v3_col("candidate_sources").find_one({"id": source_id}, {"_id": 0})
    if not source:
        return {"error": "source_not_found", "imported": 0}
    if not source.get("spreadsheet_id"):
        return {"error": "no_spreadsheet_id", "imported": 0}

    creds = await _get_creds()
    if not creds:
        return {"error": "not_connected", "imported": 0}

    sheet_name = source.get("sheet_name") or "Sheet1"
    a1_range = f"'{sheet_name}'!{range_}"
    persist: Dict[str, Any] = {}

    try:
        svc = await asyncio.to_thread(lambda: build("sheets", "v4", credentials=creds))
        try:
            resp = await asyncio.to_thread(
                lambda: svc.spreadsheets().values().get(spreadsheetId=source["spreadsheet_id"], range=a1_range).execute()
            )
        except Exception as range_err:
            # A tab renamed in the sheet shouldn't need re-linking here — find the first
            # real tab, use it, and remember it. Same fallback the marketing pull uses.
            text = str(range_err)
            if "Unable to parse" in text or "Requested entity was not found" in text:
                meta = await asyncio.to_thread(
                    lambda: svc.spreadsheets().get(spreadsheetId=source["spreadsheet_id"], fields="sheets.properties.title").execute()
                )
                titles = [s["properties"]["title"] for s in meta.get("sheets", []) if s.get("properties")]
                if not titles:
                    return {"error": "no_tabs_found", "imported": 0}
                a1_range = f"'{titles[0]}'!{range_}"
                resp = await asyncio.to_thread(
                    lambda: svc.spreadsheets().values().get(spreadsheetId=source["spreadsheet_id"], range=a1_range).execute()
                )
                persist["sheet_name"] = titles[0]
                persist["available_tabs"] = titles
            else:
                raise
    except Exception as e:
        return {"error": f"sheets_api: {str(e)[:200]}", "imported": 0}

    values = resp.get("values", [])
    if not values:
        await v3_col("candidate_sources").update_one({"id": source_id}, {"$set": {"last_synced": now_iso()}})
        return {"imported": 0, "skipped": 0, "rows_received": 0, "message": "Sheet is empty"}

    headers = [str(h).strip() for h in values[0]]
    rows = []
    for r in values[1:]:
        padded = list(r) + [""] * (len(headers) - len(r))
        rows.append({headers[i]: padded[i] for i in range(len(headers))})

    mapping = dict(source.get("column_mapping") or {})
    inferred = auto_map_candidate_columns(headers)
    for k, v in inferred.items():
        mapping.setdefault(k, v)
    if "phone" not in mapping:
        return {"error": "No phone column found in the sheet. Add one named Phone or Mobile.", "imported": 0}

    stages = await _stages()
    if not stages:
        return {"error": "Recruitment pipeline is not configured", "imported": 0}
    first_stage_id = stages[0]["id"]
    open_ids = [s["id"] for s in stages if not s.get("is_final")]

    imported = 0
    skipped_no_phone = 0
    skipped_duplicate = 0
    sample_errors: List[str] = []

    for idx, row in enumerate(rows):
        phone_raw = str(row.get(mapping["phone"], "") or "").strip()
        if not normalize_phone(phone_raw):
            skipped_no_phone += 1
            if len(sample_errors) < 3:
                sample_errors.append(f"row {idx + 2}: no usable phone in column '{mapping['phone']}'")
            continue

        # The same rule the Add Candidate form enforces: re-applying later is fine, two
        # open records for one person is not.
        if await v3_col("candidates").find_one({"phone": phone_raw, "stage_id": {"$in": open_ids}}, {"_id": 0, "id": 1}):
            skipped_duplicate += 1
            continue

        doc: Dict[str, Any] = {
            "id": str(uuid.uuid4()),
            "full_name": "Unknown",
            "phone": phone_raw,
            "email": "", "position": "", "department": "", "location": "",
            "experience_years": None, "current_ctc": None, "expected_ctc": None,
            "source": source["name"], "resume_url": "", "notes": "",
            "branch_id": None,
        }
        for field in CANDIDATE_TEXT_FIELDS:
            key = mapping.get(field)
            if key and str(row.get(key, "") or "").strip():
                doc[field] = str(row[key]).strip()
        for field in CANDIDATE_NUMBER_FIELDS:
            key = mapping.get(field)
            if key:
                doc[field] = _parse_number(row.get(key), field)
        if not doc["position"] and source.get("default_position"):
            doc["position"] = source["default_position"]
        if doc["full_name"] == "Unknown" and mapping.get("full_name"):
            doc["full_name"] = str(row.get(mapping["full_name"], "") or "").strip() or "Unknown"

        # Columns nobody mapped still carry meaning to whoever built the sheet, so they are
        # appended to notes rather than dropped.
        mapped_cols = set(mapping.values())
        extras = [f"{k}: {v}" for k, v in row.items() if k not in mapped_cols and str(v or "").strip()]
        if extras:
            doc["notes"] = (doc["notes"] + "\n" if doc["notes"] else "") + " | ".join(extras)

        doc.update({
            "stage_id": first_stage_id,
            "interview": None,
            "offer": None,
            "rejected_reason": "",
            "history": [{
                "at": now_iso(),
                "by": f"Sheet · {source['name']}",
                "action": "Imported",
                "detail": f"Row {idx + 2} of {source.get('sheet_name') or 'Sheet1'}",
            }],
            "sheet_source_id": source_id,
            "created_at": now_iso(),
            "updated_at": now_iso(),
            "created_by": f"Sheet · {source['name']}",
        })
        await v3_col("candidates").insert_one(doc.copy())
        imported += 1

    update = {
        "last_synced": now_iso(),
        "row_count": (source.get("row_count") or 0) + imported,
        "headers_detected": headers,
        "column_mapping": mapping,
        "last_sync_imported": imported,
        "last_sync_skipped_no_phone": skipped_no_phone,
        "last_sync_skipped_duplicate": skipped_duplicate,
        "last_sync_rows_received": len(rows),
    }
    update.update(persist)
    await v3_col("candidate_sources").update_one({"id": source_id}, {"$set": update})

    return {
        "imported": imported,
        "skipped": skipped_no_phone + skipped_duplicate,
        "skipped_no_phone": skipped_no_phone,
        "skipped_duplicate": skipped_duplicate,
        "rows_received": len(rows),
        "mapping_used": mapping,
        "headers": headers,
        "sample_errors": sample_errors,
    }
