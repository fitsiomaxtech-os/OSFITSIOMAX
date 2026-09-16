"""Client Reviews — the stars a client gives their Consultant and their Physio.

Kept apart from two things with a similar name:

  * routers/v3_reviews.py is the clinical Review pipeline, a hand-off between a branch and
    a Consultant about a patient's progress. Nothing to do with what the client thought.
  * routers/v3_feedback.py is the client's conversation with their branch, consultant or
    head office ("Talk to Management"). That is words to be answered; this is a verdict.

Two kinds of review, each its own row:

  * Physio Review (kind "physio") -- one per completed physio day, treatment or rehab.
    Mandatory: the portal holds the client on a prompt until every day completed since
    PHYSIO_REVIEW_START is rated. Days before that date are not asked about, so a client
    thirty sessions in is not handed thirty forms the day this went live.
  * Consultant Review (kind "consultant") -- optional, and open once every 7 days. The
    client may rate, or skip that week; a skip is a row too (skipped=True) so the window
    moves on, and it never counts towards an average.

Rows written by the old flow (one row per client with both ratings, no `kind`) are still
read by management: list_client_reviews splits each into its consultant and physio halves.

Read by management only: Super Admin and BDE across every branch, a Branch Admin for their
own branch.
"""

import uuid
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from database import v3_col
from deps import v3_require_roles, is_branch_admin_role
from physio_scope import consultant_of_lead
from routers.v3_feedback import _rating
from routers.v3_patient_portal import _current_patient_lead_id, _lead_or_404
from schemas.v3 import V3UserOut
from utils import now_iso

router = APIRouter(prefix="/api/v3")

COLLECTION = "client_reviews"
MAX_TEXT = 2000

KIND_PHYSIO = "physio"
KIND_CONSULTANT = "consultant"

# Physio days completed on or after this are the ones a client must rate.
PHYSIO_REVIEW_START = "2026-09-16"
CONSULTANT_REVIEW_EVERY_DAYS = 7


class PhysioReviewIn(BaseModel):
    session_id: str
    rating: Optional[int] = None
    comment: Optional[str] = ""


class ConsultantReviewIn(BaseModel):
    rating: Optional[int] = None
    comment: Optional[str] = ""


def _text(value) -> str:
    return str(value or "").strip()[:MAX_TEXT]


def _parse(iso: str) -> Optional[datetime]:
    try:
        d = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def required_rating(value) -> int:
    rating = _rating(value)
    if rating is None:
        raise HTTPException(status_code=400, detail="Tap the stars to give a rating")
    return rating


def pending_physio_days(days: List[dict], reviewed_ids: set, since: str = PHYSIO_REVIEW_START) -> List[dict]:
    """Completed physio days, oldest first, that still need the client's stars.

    `days` are session rows from both tracks, each already carrying `track`. A day counts
    from when it was completed; one with no completed_at (older rows) falls back to its slot.
    """
    out = []
    for d in days:
        if d.get("status") != "completed" or d.get("id") in reviewed_ids:
            continue
        when = str(d.get("completed_at") or d.get("slot_time") or "")
        if when[:10] < since:
            continue
        out.append({
            "session_id": d.get("id"),
            "track": d.get("track") or "treatment",
            "session_number": d.get("session_number") or d.get("day_number"),
            "slot_time": d.get("slot_time"),
            "completed_at": d.get("completed_at"),
            "physio_id": _text(d.get("physio_id")),
            "physio_name": _text(d.get("physio_name") or d.get("completed_by")),
        })
    out.sort(key=lambda p: str(p.get("completed_at") or p.get("slot_time") or ""))
    return out


def consultant_window(rows: List[dict], now: Optional[datetime] = None) -> dict:
    """Whether the weekly Consultant Review is open, and when it next opens if not.

    Any consultant row -- rated or skipped -- closes the window for 7 days from when it was
    written.
    """
    now = now or datetime.now(timezone.utc)
    stamps = [_parse(r.get("created_at")) for r in rows if r.get("kind") == KIND_CONSULTANT]
    stamps = [s for s in stamps if s]
    if not stamps:
        return {"open": True, "next_at": None}
    next_at = max(stamps) + timedelta(days=CONSULTANT_REVIEW_EVERY_DAYS)
    return {"open": now >= next_at, "next_at": next_at.isoformat()}


async def _physio_days(lead_id: str) -> List[dict]:
    fields = {"_id": 0, "id": 1, "status": 1, "completed_at": 1, "slot_time": 1, "session_number": 1,
              "day_number": 1, "physio_id": 1, "physio_name": 1, "completed_by": 1}
    treatment = await v3_col("sessions").find({"lead_id": lead_id, "status": "completed"}, fields).to_list(500)
    rehab = await v3_col("rehab_sessions").find({"lead_id": lead_id, "status": "completed"}, fields).to_list(300)
    return [{**d, "track": "treatment"} for d in treatment] + [{**d, "track": "rehab"} for d in rehab]


def _base_row(lead: dict, kind: str) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "kind": kind,
        "lead_id": lead.get("id"),
        "branch_id": lead.get("branch_id"),
        "patient_name": _text(lead.get("name")),
        "patient_phone": _text(lead.get("phone")),
        "patient_number": lead.get("patient_number"),
        "created_at": now_iso(),
    }


def _average(values: List[int]) -> Optional[float]:
    return round(sum(values) / len(values), 1) if values else None


def split_legacy(row: dict) -> List[dict]:
    """An old one-row-per-client review, as the consultant and physio rows it now reads as."""
    if row.get("kind"):
        return [row]
    out = []
    when = row.get("updated_at") or row.get("created_at")
    common = {k: row.get(k) for k in ("lead_id", "branch_id", "patient_name", "patient_phone", "patient_number")}
    for kind in (KIND_CONSULTANT, KIND_PHYSIO):
        if row.get(f"{kind}_rating"):
            comment = row.get(f"{kind}_comment") or ""
            if row.get("summary"):
                comment = f"{comment}\n\nSummary: {row['summary']}".strip()
            out.append({
                **common, "id": f"{row.get('id')}-{kind}", "kind": kind, "legacy": True,
                "person_id": row.get(f"{kind}_id") or "", "person_name": row.get(f"{kind}_name") or "",
                "rating": row.get(f"{kind}_rating"), "comment": comment, "created_at": when,
            })
    return out


def summarise(rows: List[dict]) -> dict:
    """Headline figures and a per-person breakdown for one kind of review.

    Grouped by name rather than id: a consultant can hold twin expert records across
    branches (see resolve_consultant_doctor), and management reads a person, not a record.
    """
    rated = [r for r in rows if r.get("rating") and not r.get("skipped")]
    people: Dict[str, List[int]] = {}
    for r in rated:
        name = _text(r.get("person_name"))
        if name:
            people.setdefault(name, []).append(r["rating"])
    by_person = sorted(
        ({"name": n, "count": len(s), "average": _average(s)} for n, s in people.items()),
        key=lambda p: (-(p["average"] or 0), -p["count"], p["name"]),
    )
    return {
        "total": len(rated),
        "average": _average([r["rating"] for r in rated]),
        "low": sum(1 for r in rated if r["rating"] <= 2),
        "skipped": sum(1 for r in rows if r.get("skipped")),
        "people": by_person,
    }


# ------------------------------------------------------------------ Client Portal side

@router.get("/patient-portal/review")
async def portal_my_review(lead_id: str = Depends(_current_patient_lead_id)):
    """Everything the portal's two review sections draw: who can be rated, the physio days
    still waiting for stars, past reviews of each kind, and the consultant's weekly window."""
    lead = await _lead_or_404(lead_id)
    rows = await v3_col(COLLECTION).find(
        {"lead_id": lead_id, "kind": {"$in": [KIND_PHYSIO, KIND_CONSULTANT]}}, {"_id": 0}
    ).sort("created_at", -1).to_list(1000)
    physio_rows = [r for r in rows if r["kind"] == KIND_PHYSIO]
    consultant_rows = [r for r in rows if r["kind"] == KIND_CONSULTANT]
    reviewed = {r.get("session_id") for r in physio_rows}
    consultant = await consultant_of_lead(lead)
    return {
        "consultant": {"id": consultant["id"], "name": consultant["name"]},
        "physio_pending": pending_physio_days(await _physio_days(lead_id), reviewed),
        "physio_reviews": physio_rows,
        "consultant_reviews": [r for r in consultant_rows if not r.get("skipped")],
        "consultant_window": consultant_window(consultant_rows),
    }


@router.post("/patient-portal/review/physio")
async def portal_review_physio_day(payload: PhysioReviewIn, lead_id: str = Depends(_current_patient_lead_id)):
    """Stars for one completed physio day. Saving the same day again changes it."""
    lead = await _lead_or_404(lead_id)
    rating = required_rating(payload.rating)
    day = None
    for track, col in (("treatment", "sessions"), ("rehab", "rehab_sessions")):
        day = await v3_col(col).find_one({"id": payload.session_id, "lead_id": lead_id}, {"_id": 0})
        if day:
            day["track"] = track
            break
    if not day:
        raise HTTPException(status_code=404, detail="Session not found")
    if day.get("status") != "completed":
        raise HTTPException(status_code=400, detail="This session is not completed yet")

    fields = {
        "rating": rating,
        "comment": _text(payload.comment),
        "session_id": day["id"],
        "track": day["track"],
        "session_number": day.get("session_number") or day.get("day_number"),
        "session_date": day.get("slot_time"),
        "person_id": _text(day.get("physio_id")),
        "person_name": _text(day.get("physio_name") or day.get("completed_by")),
    }
    existing = await v3_col(COLLECTION).find_one(
        {"lead_id": lead_id, "kind": KIND_PHYSIO, "session_id": day["id"]}, {"_id": 0}
    )
    if existing:
        changes = {**fields, "updated_at": now_iso()}
        await v3_col(COLLECTION).update_one({"id": existing["id"]}, {"$set": changes})
        return {"message": "Your physio review is updated.", "review": {**existing, **changes}}
    row = {**_base_row(lead, KIND_PHYSIO), **fields}
    await v3_col(COLLECTION).insert_one(dict(row))
    return {"message": "Thank you for rating your session.", "review": row}


async def _consultant_row(lead_id: str, skipped: bool, payload: Optional[ConsultantReviewIn] = None) -> dict:
    lead = await _lead_or_404(lead_id)
    consultant = await consultant_of_lead(lead)
    if not consultant["id"] and not consultant["name"]:
        raise HTTPException(status_code=400, detail="You have not seen a consultant yet")
    past = await v3_col(COLLECTION).find(
        {"lead_id": lead_id, "kind": KIND_CONSULTANT}, {"_id": 0, "kind": 1, "created_at": 1}
    ).to_list(1000)
    window = consultant_window(past)
    if not window["open"]:
        raise HTTPException(status_code=400, detail="Your next consultant review opens 7 days after the last one")
    row = {
        **_base_row(lead, KIND_CONSULTANT),
        "person_id": consultant["id"],
        "person_name": consultant["name"],
        "rating": None if skipped else required_rating(payload.rating),
        "comment": "" if skipped else _text(payload.comment),
        "skipped": skipped,
    }
    await v3_col(COLLECTION).insert_one(dict(row))
    return row


@router.post("/patient-portal/review/consultant")
async def portal_review_consultant(payload: ConsultantReviewIn, lead_id: str = Depends(_current_patient_lead_id)):
    row = await _consultant_row(lead_id, False, payload)
    return {"message": "Thank you for reviewing your consultant.", "review": row}


@router.post("/patient-portal/review/consultant/skip")
async def portal_skip_consultant_review(lead_id: str = Depends(_current_patient_lead_id)):
    row = await _consultant_row(lead_id, True)
    return {"message": "Skipped for this week.", "review": row}


# ------------------------------------------------------------------ Management side

@router.get("/client-reviews")
async def list_client_reviews(
    branch_id: Optional[str] = Query(None),
    user: V3UserOut = Depends(v3_require_roles("super_admin", "business_dev", "branch_admin")),
):
    """Every review management may read, split into Consultant Review and Physio Review.

    A Branch Admin is always held to their own branch, whatever they pass. Super Admin and
    BDE read every branch and may narrow to one.
    """
    query: dict = {}
    if is_branch_admin_role(user.role):
        if not user.branch_id:
            empty = summarise([])
            return {"consultant": [], "physio": [], "summary": {"consultant": empty, "physio": empty}}
        query["branch_id"] = user.branch_id
    elif branch_id:
        query["branch_id"] = branch_id

    raw = await v3_col(COLLECTION).find(query, {"_id": 0}).to_list(10000)
    rows = [r for row in raw for r in split_legacy(row)]
    rows.sort(key=lambda r: r.get("updated_at") or r.get("created_at") or "", reverse=True)

    branch_ids = {r.get("branch_id") for r in rows if r.get("branch_id")}
    names = {
        b["id"]: b.get("branch_name") or ""
        for b in await v3_col("branches").find(
            {"id": {"$in": list(branch_ids)}}, {"_id": 0, "id": 1, "branch_name": 1}
        ).to_list(500)
    } if branch_ids else {}
    for r in rows:
        r["branch_name"] = names.get(r.get("branch_id"), "")

    consultant = [r for r in rows if r.get("kind") == KIND_CONSULTANT]
    physio = [r for r in rows if r.get("kind") == KIND_PHYSIO]
    return {
        "consultant": [r for r in consultant if not r.get("skipped")],
        "physio": physio,
        "summary": {"consultant": summarise(consultant), "physio": summarise(physio)},
    }
