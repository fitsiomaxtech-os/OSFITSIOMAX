"""EOD Report -- what a Physio or a Consultant did with their day, written at Clock Out.

Two kinds, decided by the role of the person writing it:

  * Physio ("physio") -- the treatments given today: which clients, how many, and a note
    on each. Pre-filled from their own treatment and rehab days on today's date.
  * Consultant ("consultant") -- the consultations taken today, the same way. Pre-filled
    from the consultation appointments and reviews booked against them today.

The pre-fill is only a starting point. The person ticks the clients they actually saw,
adds anybody the calendar did not know about, and says something about the day. The count
on the report is the clients ticked, not what the calendar held -- a no-show on the book
is not a treatment given.

Asked for by the header's clock when somebody clocks out (see ClockWidget.jsx) and
skippable there; a skipped day simply has no report, and shows as "Not submitted" on the
Super Admin's list. One report per person per clinic day: submitting again replaces it.

Read by Super Admin only, from HR Admin > EOD Report.
"""

import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from database import v3_col
from deps import v3_current_user, v3_require_roles, is_physio_role, is_head_physio_role, PHYSIO_ROLES, HEAD_PHYSIO_ROLES
from physio_scope import resolve_physio_doctor
from schemas.v3 import V3UserOut
from utils import clinic_today, now_iso

router = APIRouter(prefix="/api/v3")

COLLECTION = "eod_reports"
KIND_PHYSIO = "physio"
KIND_CONSULTANT = "consultant"
MAX_NOTE = 1000
MAX_SUMMARY = 3000
MAX_ENTRIES = 100


class EodEntry(BaseModel):
    client_name: str
    lead_id: Optional[str] = ""
    notes: Optional[str] = ""
    source: Optional[str] = ""


class EodReportIn(BaseModel):
    entries: List[EodEntry] = []
    summary: Optional[str] = ""


def report_kind(role: str) -> Optional[str]:
    """Which report this role writes, or None for a role that writes none."""
    if is_physio_role(role):
        return KIND_PHYSIO
    if is_head_physio_role(role):
        return KIND_CONSULTANT
    return None


def _text(value, limit: int) -> str:
    return str(value or "").strip()[:limit]


def clean_entries(entries: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    """The rows worth keeping: named, trimmed, and one per client."""
    out: List[Dict[str, str]] = []
    seen = set()
    for e in entries[:MAX_ENTRIES]:
        name = _text(e.get("client_name"), 200)
        if not name:
            continue
        lead_id = _text(e.get("lead_id"), 100)
        key = lead_id or name.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append({
            "client_name": name,
            "lead_id": lead_id,
            "notes": _text(e.get("notes"), MAX_NOTE),
            "source": _text(e.get("source"), 40),
        })
    return out


async def _physio_suggestions(user: V3UserOut, on: str) -> List[Dict[str, Any]]:
    doctor = await resolve_physio_doctor(user.id, user.role)
    if not doctor:
        return []
    ids = doctor.get("physio_ids") or [doctor["id"]]
    fields = {"_id": 0, "id": 1, "lead_id": 1, "lead_name": 1, "slot_time": 1, "status": 1,
              "session_number": 1, "day_number": 1}
    rows = []
    for track, col in (("treatment", "sessions"), ("rehab", "rehab_sessions")):
        found = await v3_col(col).find(
            {"physio_id": {"$in": ids}, "slot_time": {"$regex": f"^{on}"}}, fields,
        ).to_list(300)
        rows += [{**r, "track": track} for r in found]
    rows.sort(key=lambda r: r.get("slot_time") or "")
    return [
        {
            "lead_id": r.get("lead_id") or "",
            "client_name": r.get("lead_name") or "Unknown",
            "time": str(r.get("slot_time") or "")[11:16],
            "status": r.get("status") or "",
            "source": "rehab" if r["track"] == "rehab" else "treatment",
            "label": f"{'Rehab Day' if r['track'] == 'rehab' else 'Session'} {r.get('day_number') or r.get('session_number') or ''}".strip(),
            # Ticked by default only when the day was actually marked done.
            "done": r.get("status") == "completed",
        }
        for r in rows
    ]


async def _consultant_suggestions(user: V3UserOut, on: str) -> List[Dict[str, Any]]:
    # Read-only: every consultant record this login holds, never minting one.
    doctors = await v3_col("doctors").find(
        {"user_id": user.id, "profile_type": "head_physio"}, {"_id": 0, "id": 1},
    ).to_list(50)
    ids = [d["id"] for d in doctors if d.get("id")]
    if not ids:
        return []
    appts = await v3_col("appointments").find(
        {"doctor_id": {"$in": ids}, "slot_time": {"$regex": f"^{on}"}, "status": {"$ne": "cancelled"}},
        {"_id": 0, "lead_id": 1, "lead_name": 1, "patient_name": 1, "slot_time": 1, "status": 1},
    ).to_list(300)
    reviews = await v3_col("reviews").find(
        {"head_physio_id": {"$in": ids}, "review_date": on},
        {"_id": 0, "lead_id": 1, "lead_name": 1, "review_time": 1, "status": 1},
    ).to_list(300)
    out = [
        {
            "lead_id": a.get("lead_id") or "",
            "client_name": a.get("lead_name") or a.get("patient_name") or "Unknown",
            "time": str(a.get("slot_time") or "")[11:16],
            "status": a.get("status") or "",
            "source": "consultation",
            "label": "Consultation",
            "done": True,
        }
        for a in appts
    ] + [
        {
            "lead_id": r.get("lead_id") or "",
            "client_name": r.get("lead_name") or "Unknown",
            "time": r.get("review_time") or "",
            "status": r.get("status") or "",
            "source": "review",
            "label": "Review",
            "done": True,
        }
        for r in reviews
    ]
    out.sort(key=lambda s: s["time"])
    return out


def _public(row: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not row:
        return None
    return {k: row.get(k) for k in (
        "id", "user_id", "user_name", "role", "kind", "branch_id", "date",
        "entries", "count", "summary", "submitted_at", "updated_at",
    )}


# ---------- the person writing it ----------

@router.get("/eod/today")
async def my_eod_today(user: V3UserOut = Depends(v3_current_user)):
    """Whether this person writes a report, today's clients to start it from, and the
    report already filed today, if there is one."""
    kind = report_kind(user.role)
    on = clinic_today()
    if not kind:
        return {"eligible": False, "kind": None, "date": on, "suggestions": [], "report": None}
    suggestions = await (_physio_suggestions(user, on) if kind == KIND_PHYSIO else _consultant_suggestions(user, on))
    report = await v3_col(COLLECTION).find_one({"user_id": user.id, "date": on}, {"_id": 0})
    return {"eligible": True, "kind": kind, "date": on, "suggestions": suggestions, "report": _public(report)}


@router.post("/eod/today")
async def submit_eod_today(payload: EodReportIn, user: V3UserOut = Depends(v3_current_user)):
    kind = report_kind(user.role)
    if not kind:
        raise HTTPException(status_code=403, detail="EOD reports are written by Physios and Consultants")
    entries = clean_entries([e.model_dump() for e in payload.entries])
    summary = _text(payload.summary, MAX_SUMMARY)
    if not entries and not summary:
        raise HTTPException(status_code=400, detail="Add at least one client or a note about the day")
    on = clinic_today()
    now = now_iso()
    await v3_col(COLLECTION).update_one(
        {"user_id": user.id, "date": on},
        {
            "$set": {
                "user_name": user.full_name, "role": user.role, "kind": kind,
                "branch_id": user.branch_id or "", "entries": entries, "count": len(entries),
                "summary": summary, "updated_at": now,
            },
            "$setOnInsert": {"id": str(uuid.uuid4()), "user_id": user.id, "date": on, "submitted_at": now},
        },
        upsert=True,
    )
    return _public(await v3_col(COLLECTION).find_one({"user_id": user.id, "date": on}, {"_id": 0}))


# ---------- Super Admin's list ----------

@router.get("/eod-reports")
async def list_eod_reports(
    date: Optional[str] = Query(None),
    user: V3UserOut = Depends(v3_require_roles("super_admin")),
):
    """Every report filed on one clinic day, and the Physios and Consultants who clocked
    in that day without filing one."""
    on = date or clinic_today()
    if len(on) != 10:
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
    reports = await v3_col(COLLECTION).find({"date": on}, {"_id": 0}).sort("user_name", 1).to_list(1000)
    filed = {r["user_id"] for r in reports}

    clocked = await v3_col("clock_days").find(
        {"date": on, "clock_in": {"$nin": ["", None]}}, {"_id": 0, "user_id": 1},
    ).to_list(2000)
    clocked_ids = [c["user_id"] for c in clocked if c.get("user_id") and c["user_id"] not in filed]
    staff = await v3_col("users").find(
        {"id": {"$in": clocked_ids}, "role": {"$in": sorted(PHYSIO_ROLES | HEAD_PHYSIO_ROLES)}},
        {"_id": 0, "id": 1, "full_name": 1, "role": 1, "branch_id": 1},
    ).to_list(2000) if clocked_ids else []
    pending = [
        {"user_id": s["id"], "user_name": s.get("full_name") or "", "role": s.get("role") or "",
         "kind": report_kind(s.get("role")), "branch_id": s.get("branch_id") or ""}
        for s in staff
    ]
    pending.sort(key=lambda p: p["user_name"])

    branch_ids = {r.get("branch_id") for r in reports + pending if r.get("branch_id")}
    branches = await v3_col("branches").find(
        {"id": {"$in": list(branch_ids)}}, {"_id": 0, "id": 1, "name": 1},
    ).to_list(500) if branch_ids else []
    names = {b["id"]: b.get("name") or "" for b in branches}
    for row in reports + pending:
        row["branch_name"] = names.get(row.get("branch_id"), "")

    return {"date": on, "reports": [{**_public(r), "branch_name": r["branch_name"]} for r in reports], "pending": pending}
