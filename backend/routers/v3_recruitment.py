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
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from typing import Optional, List
from datetime import date
import uuid

from database import v3_col
from utils import now_iso
from deps import v3_current_user
from constants import V3_RECRUITMENT_STAGES
from schemas.v3 import V3UserOut

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
