"""Client Reviews — the stars a client gives their Consultant and their Physio.

Kept apart from two things with a similar name:

  * routers/v3_reviews.py is the clinical Review pipeline, the Consultant's review of a
    patient's progress every 7 days of treatment. Nothing to do with what the client thought
    -- though a completed one is what the client's Consultant Review hangs off.
  * routers/v3_feedback.py is the client's conversation with their branch, consultant or
    head office ("Talk to Management"). That is words to be answered; this is a verdict.

Every review is its own row, with a `kind` (who is rated) and a `source` (what prompted it):

  * kind "physio",     source "session" -- one per completed physio day, treatment or rehab.
    Required: the portal holds the client on a pop-up until every day completed since
    PHYSIO_REVIEW_START is rated. Opened from the Review button on the day in Sessions.
  * kind "consultant", source "review"  -- one per completed 7-day clinical Review, opened
    from the Review button beside it on the Treatment tab. Optional.
  * either kind,       source "anytime" -- from the Feedback tab, whenever the client wants.

Rows written by the first flow (one row per client with both ratings, no `kind`) are still
read by management: list_client_reviews splits each into its consultant and physio halves.

Read by management only: Super Admin and BDE across every branch, a Branch Admin for their
own branch.
"""

import uuid
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from database import v3_col
from deps import v3_require_roles, is_branch_admin_role
from physio_scope import consultant_of_lead
from routers.v3_feedback import _rating
from routers.v3_patient_portal import _current_patient_lead_id, _lead_or_404
from routers.v3_reviews import review_numbers_for_lead
from schemas.v3 import V3UserOut
from utils import now_iso

router = APIRouter(prefix="/api/v3")

COLLECTION = "client_reviews"
MAX_TEXT = 2000

KIND_PHYSIO = "physio"
KIND_CONSULTANT = "consultant"
SOURCE_SESSION = "session"
SOURCE_REVIEW = "review"
SOURCE_ANYTIME = "anytime"

# Physio days completed on or after this are the ones a client must rate.
PHYSIO_REVIEW_START = "2026-09-16"


class PhysioReviewIn(BaseModel):
    session_id: str
    rating: Optional[int] = None
    comment: Optional[str] = ""


class ConsultantReviewIn(BaseModel):
    review_id: str
    rating: Optional[int] = None
    comment: Optional[str] = ""


class AnytimeReviewIn(BaseModel):
    target: str
    rating: Optional[int] = None
    comment: Optional[str] = ""


def _text(value) -> str:
    return str(value or "").strip()[:MAX_TEXT]


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


async def _physio_days(lead_id: str) -> List[dict]:
    fields = {"_id": 0, "id": 1, "status": 1, "completed_at": 1, "slot_time": 1, "session_number": 1,
              "day_number": 1, "physio_id": 1, "physio_name": 1, "completed_by": 1}
    treatment = await v3_col("sessions").find({"lead_id": lead_id, "status": "completed"}, fields).to_list(500)
    rehab = await v3_col("rehab_sessions").find({"lead_id": lead_id, "status": "completed"}, fields).to_list(300)
    return [{**d, "track": "treatment"} for d in treatment] + [{**d, "track": "rehab"} for d in rehab]


async def care_team(lead: dict) -> Dict[str, Dict[str, str]]:
    """The consultant who saw this client and the physio treating them -- who an anytime
    review can be about. The physio is the one on the lead, else the newest session's."""
    consultant = await consultant_of_lead(lead)
    physio_id = _text(lead.get("assigned_physio_id"))
    physio_name = _text(lead.get("assigned_physio_name"))
    if not physio_name:
        session = await v3_col("sessions").find_one(
            {"lead_id": lead.get("id"), "physio_name": {"$nin": [None, ""]}},
            {"_id": 0, "physio_name": 1, "physio_id": 1},
            sort=[("slot_time", -1)],
        ) or {}
        physio_name = _text(session.get("physio_name"))
        physio_id = physio_id or _text(session.get("physio_id"))
    return {
        "consultant": {"id": consultant["id"], "name": consultant["name"]},
        "physio": {"id": physio_id, "name": physio_name},
    }


def _base_row(lead: dict, kind: str, source: str) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "kind": kind,
        "source": source,
        "lead_id": lead.get("id"),
        "branch_id": lead.get("branch_id"),
        "patient_name": _text(lead.get("name")),
        "patient_phone": _text(lead.get("phone")),
        "patient_number": lead.get("patient_number"),
        "created_at": now_iso(),
    }


async def _upsert(lead: dict, kind: str, source: str, match: dict, fields: dict) -> dict:
    """One row per thing reviewed: saving the same session or clinical Review again changes it."""
    existing = await v3_col(COLLECTION).find_one({"lead_id": lead["id"], "kind": kind, **match}, {"_id": 0})
    if existing:
        changes = {**fields, "updated_at": now_iso()}
        await v3_col(COLLECTION).update_one({"id": existing["id"]}, {"$set": changes})
        return {**existing, **changes}
    row = {**_base_row(lead, kind, source), **match, **fields}
    await v3_col(COLLECTION).insert_one(dict(row))
    return row


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
                **common, "id": f"{row.get('id')}-{kind}", "kind": kind, "source": SOURCE_ANYTIME, "legacy": True,
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
        "anytime": sum(1 for r in rated if r.get("source") == SOURCE_ANYTIME),
        "people": by_person,
    }


# ------------------------------------------------------------------ Client Portal side

@router.get("/patient-portal/review")
async def portal_my_review(lead_id: str = Depends(_current_patient_lead_id)):
    """Everything the portal's Review buttons and pop-ups draw from."""
    lead = await _lead_or_404(lead_id)
    rows = await v3_col(COLLECTION).find(
        {"lead_id": lead_id, "kind": {"$in": [KIND_PHYSIO, KIND_CONSULTANT]}, "skipped": {"$ne": True}}, {"_id": 0}
    ).sort("created_at", -1).to_list(1000)
    physio_rows = [r for r in rows if r["kind"] == KIND_PHYSIO]
    reviewed = {r.get("session_id") for r in physio_rows if r.get("session_id")}
    return {
        **(await care_team(lead)),
        "physio_pending": pending_physio_days(await _physio_days(lead_id), reviewed),
        "physio_reviews": [r for r in physio_rows if r.get("session_id")],
        "consultant_reviews": [r for r in rows if r["kind"] == KIND_CONSULTANT and r.get("clinical_review_id")],
        "anytime_reviews": [r for r in rows if r.get("source") == SOURCE_ANYTIME],
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
        raise HTTPException(status_code=400, detail="You can review this session once it is completed")
    row = await _upsert(lead, KIND_PHYSIO, SOURCE_SESSION, {"session_id": day["id"]}, {
        "rating": rating,
        "comment": _text(payload.comment),
        "track": day["track"],
        "session_number": day.get("session_number") or day.get("day_number"),
        "session_date": day.get("slot_time"),
        "person_id": _text(day.get("physio_id")),
        "person_name": _text(day.get("physio_name") or day.get("completed_by")),
    })
    return {"message": "Thank you for reviewing your session.", "review": row}


@router.post("/patient-portal/review/consultant")
async def portal_review_consultant(payload: ConsultantReviewIn, lead_id: str = Depends(_current_patient_lead_id)):
    """Stars for the Consultant on one completed 7-day Review. Saving again changes it."""
    lead = await _lead_or_404(lead_id)
    rating = required_rating(payload.rating)
    clinical = await v3_col("reviews").find_one({"id": payload.review_id, "lead_id": lead_id}, {"_id": 0})
    if not clinical:
        raise HTTPException(status_code=404, detail="Review not found")
    if clinical.get("status") != "completed":
        raise HTTPException(status_code=400, detail="You can review your consultant once this review is completed")
    all_reviews = await v3_col("reviews").find({"lead_id": lead_id}, {"_id": 0}).sort("raised_at", 1).to_list(50)
    consultant = await consultant_of_lead(lead)
    row = await _upsert(lead, KIND_CONSULTANT, SOURCE_REVIEW, {"clinical_review_id": clinical["id"]}, {
        "rating": rating,
        "comment": _text(payload.comment),
        "review_number": review_numbers_for_lead(all_reviews).get(clinical["id"], 1),
        "review_date": clinical.get("review_date") or clinical.get("completed_at"),
        "person_id": consultant["id"],
        "person_name": _text(clinical.get("completed_by")) or consultant["name"],
    })
    return {"message": "Thank you for reviewing your consultant.", "review": row}


@router.post("/patient-portal/review/anytime")
async def portal_review_anytime(payload: AnytimeReviewIn, lead_id: str = Depends(_current_patient_lead_id)):
    """A review of the Consultant or the Physio from the Feedback tab, whenever the client wants."""
    if payload.target not in (KIND_CONSULTANT, KIND_PHYSIO):
        raise HTTPException(status_code=400, detail="Choose who you are reviewing")
    lead = await _lead_or_404(lead_id)
    rating = required_rating(payload.rating)
    person = (await care_team(lead))[payload.target]
    if not person["name"]:
        raise HTTPException(status_code=400, detail=f"You do not have a {payload.target} yet")
    row = {
        **_base_row(lead, payload.target, SOURCE_ANYTIME),
        "rating": rating,
        "comment": _text(payload.comment),
        "person_id": person["id"],
        "person_name": person["name"],
    }
    await v3_col(COLLECTION).insert_one(dict(row))
    return {"message": "Thank you for your review.", "review": row}


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
    query: dict = {"skipped": {"$ne": True}}
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
        "consultant": consultant,
        "physio": physio,
        "summary": {"consultant": summarise(consultant), "physio": summarise(physio)},
    }
