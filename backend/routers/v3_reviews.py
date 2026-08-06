"""Post-treatment Review pipeline.

A patient who has been in treatment for a week is due a Head Physio review. The chain
runs Physio -> Branch Admin -> Head Physio:

    send_to_review   the Physio has raised it; it is waiting on the Branch Admin
    sent             the Branch Admin has dispatched it to a named Head Physio for a date
    completed        that Head Physio has written the review

Each board reads the same records through its own lens: Branch Admin sees the whole
branch, a Head Physio sees only what was dispatched to them.

This lives in its own `reviews` collection rather than on `weekly_assessments`. That one
is keyed (lead_id, week_number) and already carries its own physio->head-physio flow with
no dispatch step; bolting a second state machine onto it would give one collection two
unrelated shapes — exactly what the `sessions` collection did before it took the OS down.
"""
from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel
from typing import Optional, List
from datetime import date, datetime, timedelta
import uuid

from database import v3_col
from utils import now_iso
from deps import v3_require_roles
from schemas.v3 import V3UserOut

router = APIRouter(prefix="/api/v3")

# A patient becomes due a review once they've been in treatment this long.
REVIEW_AFTER_DAYS = 7

SEND_TO_REVIEW = "send_to_review"
SENT = "sent"
COMPLETED = "completed"


class ReviewRaiseInput(BaseModel):
    reason: Optional[str] = ""
    physio_notes: Optional[str] = ""


class ReviewSendInput(BaseModel):
    head_physio_id: str
    review_date: str  # YYYY-MM-DD
    review_time: Optional[str] = None  # HH:MM, from the Head Physio's published slots
    review_duration: Optional[int] = None  # minutes, carried from that slot
    notes: Optional[str] = None  # branch's own note, on top of the physio's


class ReviewCompleteInput(BaseModel):
    head_physio_notes: str
    head_physio_suggestions: Optional[str] = ""


def _today() -> str:
    return date.today().isoformat()


async def _lead_or_404(lead_id: str) -> dict:
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    return lead


async def _review_or_404(review_id: str) -> dict:
    rev = await v3_col("reviews").find_one({"id": review_id}, {"_id": 0})
    if not rev:
        raise HTTPException(status_code=404, detail="Review not found")
    return rev


async def _treatment_days(lead_id: str) -> int:
    """Completed treatment sessions for this patient (the field is still named
    treatment_days for compatibility with what's already stored on review docs).

    Counted as completed sessions rather than distinct calendar days — a milestone at
    exactly the 7th/14th/etc completed session, matching the same session_number the
    Treatment tab's own review badge is built on. Also counted from completed sessions
    rather than from the assignment date — a package booked three weeks out is not three
    weeks of treatment, and the review is about what the patient has been through, not
    how long ago they paid.
    """
    return await v3_col("sessions").count_documents({"lead_id": lead_id, "status": "completed"})


async def _first_session_date(lead_id: str) -> Optional[str]:
    rows = await v3_col("sessions").find(
        {"lead_id": lead_id}, {"_id": 0, "slot_time": 1}
    ).sort("slot_time", 1).to_list(1)
    return (rows[0].get("slot_time") or "")[:10] if rows else None


def _shape(rev: dict) -> dict:
    return {k: v for k, v in rev.items() if k != "_id"}


def _review_eligibility(existing_for_lead: List[dict], treatment_days: int) -> dict:
    """A new review becomes raisable every REVIEW_AFTER_DAYS treatment days — 7, 14, 21,
    28... not just "7 or more" — so a 28-session package gets exactly 4 review points,
    one per completed week of treatment, rather than staying permanently "due" past day 7.

    milestone: the highest 7-multiple reached so far (0 if none yet).
    review_number: which review this is — 1st at day 7, 2nd at day 14, etc.
    eligible: whether a *new* review can be raised right now.
    review: the review relevant to explain the current (non-eligible) state — an open
    one in flight, or the most recent completed one still covering this milestone.
    None once a fresh milestone is eligible, since that old review is no longer "current".
    """
    milestone = (treatment_days // REVIEW_AFTER_DAYS) * REVIEW_AFTER_DAYS
    review_number = milestone // REVIEW_AFTER_DAYS if milestone else 0

    open_review = next((r for r in existing_for_lead if r.get("status") in (SEND_TO_REVIEW, SENT)), None)
    if open_review:
        return {"milestone": milestone, "review_number": review_number, "eligible": False, "review": open_review}

    if milestone == 0:
        return {"milestone": 0, "review_number": 0, "eligible": False, "review": None}

    completed = [r for r in existing_for_lead if r.get("status") == COMPLETED]
    latest_completed = max(completed, key=lambda r: r.get("raised_at") or "", default=None)

    if latest_completed is None or milestone > (latest_completed.get("treatment_days") or 0):
        return {"milestone": milestone, "review_number": review_number, "eligible": True, "review": None}

    return {"milestone": milestone, "review_number": review_number, "eligible": False, "review": latest_completed}


# ---------------------------------------------------------------- Physio: raise a review

@router.get("/physio/reviews")
async def physio_reviews(
    physio_id: Optional[str] = None,
    user: V3UserOut = Depends(v3_require_roles("physio", "super_admin")),
):
    """This physio's patients, each with how far through treatment they are and whether a
    review has already been raised — so the Physio can see who is due one."""
    doctor = await v3_col("doctors").find_one(
        {"user_id": user.id, "profile_type": "physio"}, {"_id": 0, "id": 1}
    )
    pid = physio_id or (doctor or {}).get("id")
    if not pid:
        return {"patients": [], "reviews": []}

    lead_ids = await v3_col("sessions").distinct("lead_id", {"physio_id": pid})
    leads = await v3_col("leads").find({"id": {"$in": lead_ids}}, {"_id": 0}).to_list(500)
    existing = await v3_col("reviews").find({"physio_id": pid}, {"_id": 0}).to_list(500)
    by_lead: dict = {}
    for r in existing:
        by_lead.setdefault(r["lead_id"], []).append(r)

    patients = []
    for l in leads:
        days = await _treatment_days(l["id"])
        elig = _review_eligibility(by_lead.get(l["id"], []), days)
        rev = elig["review"]
        patients.append({
            "lead_id": l["id"],
            "lead_name": l.get("name", "Unknown"),
            "patient_number": l.get("patient_number", ""),
            "phone": l.get("phone", ""),
            "treatment_days": days,
            "first_session_date": await _first_session_date(l["id"]),
            "milestone": elig["milestone"],
            "review_number": elig["review_number"],
            "due_for_review": elig["eligible"],
            "review_status": rev.get("status") if rev else None,
            "review_id": rev.get("id") if rev else None,
        })
    patients.sort(key=lambda p: (-p["treatment_days"], p["lead_name"]))
    return {"patients": patients, "reviews": [_shape(r) for r in existing], "review_after_days": REVIEW_AFTER_DAYS}


@router.post("/physio/reviews/raise/{lead_id}")
async def physio_raise_review(
    lead_id: str,
    payload: ReviewRaiseInput,
    physio_id: Optional[str] = None,
    user: V3UserOut = Depends(v3_require_roles("physio", "super_admin")),
):
    """Physio sends a patient up for review. Lands in Branch Admin > Review > Send to Review.
    Only raisable at a fresh 7-treatment-day milestone (7, 14, 21...) — mirrors the same
    _review_eligibility check /physio/reviews uses to decide who shows under New Review."""
    # Enforced here as well as in the form: the Head Physio writes their review off the
    # back of these notes, so a review raised without them cannot be acted on.
    if not (payload.physio_notes or "").strip():
        raise HTTPException(status_code=400, detail="Notes for the Head Physio are required")
    lead = await _lead_or_404(lead_id)
    existing_for_lead = await v3_col("reviews").find({"lead_id": lead_id}, {"_id": 0}).to_list(50)
    days = await _treatment_days(lead_id)
    elig = _review_eligibility(existing_for_lead, days)
    if not elig["eligible"]:
        if elig["review"] and elig["review"].get("status") in (SEND_TO_REVIEW, SENT):
            raise HTTPException(status_code=409, detail="This patient already has a review in progress")
        raise HTTPException(status_code=400, detail=f"This patient hasn't reached a new review milestone yet (every {REVIEW_AFTER_DAYS} completed sessions)")

    doctor = await v3_col("doctors").find_one(
        {"user_id": user.id, "profile_type": "physio"}, {"_id": 0, "id": 1, "full_name": 1}
    )
    pid = physio_id or (doctor or {}).get("id") or ""
    now = now_iso()
    review = {
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "lead_name": lead.get("name", "Unknown"),
        "patient_number": lead.get("patient_number", ""),
        "phone": lead.get("phone", ""),
        "branch_id": lead.get("branch_id"),
        "physio_id": pid,
        "physio_name": (doctor or {}).get("full_name") or user.full_name,
        "head_physio_id": "",
        "head_physio_name": "",
        "reason": (payload.reason or "").strip(),
        "physio_notes": (payload.physio_notes or "").strip(),
        "treatment_days": await _treatment_days(lead_id),
        "session_package_name": lead.get("session_package_name", ""),
        "review_date": "",
        "status": SEND_TO_REVIEW,
        "head_physio_notes": "",
        "head_physio_suggestions": "",
        "raised_at": now,
        "sent_at": "",
        "completed_at": "",
        "completed_by": "",
        "created_at": now,
        "updated_at": now,
    }
    await v3_col("reviews").insert_one(review.copy())
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "review_raised",
        "details": f"Physio raised a review after {review['treatment_days']} completed sessions"
                   + (f" · {review['reason']}" if review["reason"] else ""),
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now,
    })
    return _shape(review)


# ------------------------------------------------------- Branch Admin: dispatch a review

@router.get("/branch-admin/reviews/{branch_id}")
async def branch_reviews(
    branch_id: str,
    status: Optional[str] = Query(None, description="send_to_review | sent | completed"),
    user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin")),
):
    """Every review on this branch, plus the counts each sub-tab shows on its pill."""
    query: dict = {"branch_id": branch_id}
    if status:
        query["status"] = status
    rows = await v3_col("reviews").find(query, {"_id": 0}).sort("created_at", -1).to_list(2000)

    all_rows = rows if not status else await v3_col("reviews").find(
        {"branch_id": branch_id}, {"_id": 0, "status": 1}
    ).to_list(2000)
    counts = {SEND_TO_REVIEW: 0, SENT: 0, COMPLETED: 0}
    for r in all_rows:
        if r.get("status") in counts:
            counts[r["status"]] += 1

    # Head Physios are org-wide: they take consultations for every branch, so this
    # never narrows by branch_id.
    head_physios = await v3_col("doctors").find(
        {"profile_type": "head_physio"}, {"_id": 0, "id": 1, "full_name": 1}
    ).to_list(200)

    return {
        "branch_id": branch_id,
        "reviews": [_shape(r) for r in rows],
        "counts": counts,
        "head_physios": head_physios,
        "today": _today(),
    }


@router.post("/branch-admin/reviews/{review_id}/send")
async def branch_send_review(
    review_id: str,
    payload: ReviewSendInput,
    user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin")),
):
    """Hand the review to a named Head Physio for a date."""
    rev = await _review_or_404(review_id)
    if rev.get("status") == COMPLETED:
        raise HTTPException(status_code=400, detail="This review is already completed")
    hp = await v3_col("doctors").find_one(
        {"id": payload.head_physio_id, "profile_type": "head_physio"}, {"_id": 0, "id": 1, "full_name": 1}
    )
    if not hp:
        raise HTTPException(status_code=404, detail="Head Physio not found")
    try:
        date.fromisoformat(payload.review_date)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="review_date must be YYYY-MM-DD") from exc

    now = now_iso()
    updates = {
        "head_physio_id": hp["id"],
        "head_physio_name": hp["full_name"],
        "review_date": payload.review_date,
        "status": SENT,
        "sent_at": now,
        "sent_by": user.full_name,
        "updated_at": now,
    }
    # The slot is picked from what the Head Physio actually published, so it's stored
    # alongside the date rather than leaving them to work the time out themselves.
    if payload.review_time:
        updates["review_time"] = payload.review_time
        updates["review_duration"] = payload.review_duration
    if payload.notes and payload.notes.strip():
        updates["branch_notes"] = payload.notes.strip()
    await v3_col("reviews").update_one({"id": review_id}, {"$set": updates})
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": rev["lead_id"],
        "action": "review_sent",
        "details": f"Review sent to {hp['full_name']} for {payload.review_date}"
                   + (f" at {payload.review_time}" if payload.review_time else ""),
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now,
    })
    return _shape(await _review_or_404(review_id))


# ------------------------------------------------------- Head Physio: complete a review

@router.get("/head-physio/reviews")
async def hp_reviews(user: V3UserOut = Depends(v3_require_roles("head_physio", "super_admin"))):
    """Reviews dispatched to this Head Physio, split into what's due and what's done.

    A Head Physio assigned to several branches has one doctors record per branch, so this
    matches on every record linked to their login rather than a single doctor id.
    """
    docs = await v3_col("doctors").find(
        {"user_id": user.id, "profile_type": "head_physio"}, {"_id": 0, "id": 1}
    ).to_list(50)
    my_ids = [d["id"] for d in docs]
    if not my_ids:
        return {"today": [], "upcoming": [], "overdue": [], "completed": [], "today_date": _today()}

    rows = await v3_col("reviews").find(
        {"head_physio_id": {"$in": my_ids}}, {"_id": 0}
    ).sort("review_date", 1).to_list(2000)

    today = _today()
    out = {"today": [], "upcoming": [], "overdue": [], "completed": [], "today_date": today}
    for r in rows:
        if r.get("status") == COMPLETED:
            out["completed"].append(_shape(r))
        elif (r.get("review_date") or "") == today:
            out["today"].append(_shape(r))
        elif (r.get("review_date") or "") < today:
            # Past its date and still not written — surfaced with Today's rather than
            # hidden in a list nobody opens.
            out["overdue"].append(_shape(r))
        else:
            out["upcoming"].append(_shape(r))
    out["completed"].sort(key=lambda r: r.get("completed_at") or "", reverse=True)
    return out


@router.post("/head-physio/reviews/{review_id}/complete")
async def hp_complete_review(
    review_id: str,
    payload: ReviewCompleteInput,
    user: V3UserOut = Depends(v3_require_roles("head_physio", "super_admin")),
):
    rev = await _review_or_404(review_id)
    if rev.get("status") == COMPLETED:
        raise HTTPException(status_code=400, detail="This review is already completed")
    if not payload.head_physio_notes.strip():
        raise HTTPException(status_code=400, detail="Review notes are required")

    now = now_iso()
    await v3_col("reviews").update_one({"id": review_id}, {"$set": {
        "head_physio_notes": payload.head_physio_notes.strip(),
        "head_physio_suggestions": (payload.head_physio_suggestions or "").strip(),
        "status": COMPLETED,
        "completed_at": now,
        "completed_by": user.full_name,
        "updated_at": now,
    }})
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": rev["lead_id"],
        "action": "review_completed",
        "details": f"Head Physio review completed by {user.full_name}",
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now,
    })
    return _shape(await _review_or_404(review_id))
