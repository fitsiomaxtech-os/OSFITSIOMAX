"""Client Reviews — the stars a client gives their Consultant and their Physio.

Kept apart from two things with a similar name:

  * routers/v3_reviews.py is the clinical Review pipeline, a hand-off between a branch and
    a Consultant about a patient's progress. Nothing to do with what the client thought.
  * routers/v3_feedback.py is the client's conversation with their branch, consultant or
    head office. That is words to be answered; this is a verdict to be read.

One review per client, which they can come back and change. A client's opinion of the
people treating them is a single standing answer that moves as the treatment does -- a
second row every time they change their mind would make the average count the unhappy
ones twice.

Read by management only: Super Admin and BDE across every branch, a Branch Admin for their
own branch. The Consultant and Physio being rated do not read it, which is what the portal
tells the client before they write anything.
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
from schemas.v3 import V3UserOut
from utils import now_iso

router = APIRouter(prefix="/api/v3")

COLLECTION = "client_reviews"
MAX_TEXT = 2000


class ClientReviewIn(BaseModel):
    consultant_rating: Optional[int] = None
    consultant_comment: Optional[str] = ""
    physio_rating: Optional[int] = None
    physio_comment: Optional[str] = ""
    summary: Optional[str] = ""


def _text(value) -> str:
    return str(value or "").strip()[:MAX_TEXT]


async def care_team(lead: dict) -> Dict[str, Dict[str, str]]:
    """Who this client can rate: the consultant who saw them and the physio treating them.

    The consultant is consultant_of_lead, the same answer the Feedback tab addresses, so a
    client is never asked to rate somebody different from the person they can write to.

    The physio is the one assigned on the lead, falling back to the name on their newest
    session -- the same source the portal's own care-team card reads.
    """
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


def build_review(payload: ClientReviewIn, team: dict) -> dict:
    """The fields a save writes, or a 400 explaining what is missing.

    Stars are only kept for somebody the client actually has: a physio rating from a client
    with no physio would be a verdict on nobody. At least one set of stars is required --
    the words are welcome, but a review with no rating is feedback, and that has its own tab.
    """
    consultant_rating = _rating(payload.consultant_rating) if team["consultant"]["name"] else None
    physio_rating = _rating(payload.physio_rating) if team["physio"]["name"] else None
    if consultant_rating is None and physio_rating is None:
        raise HTTPException(status_code=400, detail="Choose at least one star rating")
    return {
        "consultant_id": team["consultant"]["id"],
        "consultant_name": team["consultant"]["name"],
        "consultant_rating": consultant_rating,
        "consultant_comment": _text(payload.consultant_comment) if consultant_rating else "",
        "physio_id": team["physio"]["id"],
        "physio_name": team["physio"]["name"],
        "physio_rating": physio_rating,
        "physio_comment": _text(payload.physio_comment) if physio_rating else "",
        "summary": _text(payload.summary),
    }


def _average(values: List[int]) -> Optional[float]:
    return round(sum(values) / len(values), 1) if values else None


def summarise(rows: List[dict]) -> dict:
    """Headline figures and a per-person breakdown, off the rows being shown.

    Grouped by name rather than id: a consultant can hold twin expert records across
    branches (see resolve_consultant_doctor), and management reads a person, not a record.
    """
    consultant_stars = [r["consultant_rating"] for r in rows if r.get("consultant_rating")]
    physio_stars = [r["physio_rating"] for r in rows if r.get("physio_rating")]

    def by_person(role: str) -> List[dict]:
        people: Dict[str, List[int]] = {}
        for r in rows:
            name, stars = _text(r.get(f"{role}_name")), r.get(f"{role}_rating")
            if name and stars:
                people.setdefault(name, []).append(stars)
        out = [{"name": n, "count": len(s), "average": _average(s)} for n, s in people.items()]
        return sorted(out, key=lambda p: (-(p["average"] or 0), -p["count"], p["name"]))

    return {
        "total": len(rows),
        "consultant_average": _average(consultant_stars),
        "physio_average": _average(physio_stars),
        "consultant_count": len(consultant_stars),
        "physio_count": len(physio_stars),
        # A review is low when either rating is 2 or under -- the ones worth opening first.
        "low": sum(
            1 for r in rows
            if (r.get("consultant_rating") or 5) <= 2 or (r.get("physio_rating") or 5) <= 2
        ),
        "consultants": by_person("consultant"),
        "physios": by_person("physio"),
    }


# ------------------------------------------------------------------ Client Portal side

@router.get("/patient-portal/review")
async def portal_my_review(lead_id: str = Depends(_current_patient_lead_id)):
    """The client's own review, if any, and who they can rate."""
    lead = await _lead_or_404(lead_id)
    review = await v3_col(COLLECTION).find_one({"lead_id": lead_id}, {"_id": 0})
    return {"review": review, **(await care_team(lead))}


@router.put("/patient-portal/review")
async def portal_save_review(
    payload: ClientReviewIn,
    lead_id: str = Depends(_current_patient_lead_id),
):
    """Write or change the client's one review. The session is the identity -- a lead id
    from the body would let anybody review as anybody."""
    lead = await _lead_or_404(lead_id)
    team = await care_team(lead)
    existing = await v3_col(COLLECTION).find_one({"lead_id": lead_id}, {"_id": 0})
    fields = build_review(payload, team)
    now = now_iso()
    if existing:
        changes = {**fields, "updated_at": now, "branch_id": lead.get("branch_id")}
        await v3_col(COLLECTION).update_one({"id": existing["id"]}, {"$set": changes})
        return {"message": "Your review is updated. Thank you.", "review": {**existing, **changes}}
    row = {
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "branch_id": lead.get("branch_id"),
        "patient_name": _text(lead.get("name")),
        "patient_phone": _text(lead.get("phone")),
        "patient_number": lead.get("patient_number"),
        **fields,
        "created_at": now,
        "updated_at": "",
    }
    await v3_col(COLLECTION).insert_one(dict(row))
    return {"message": "Thank you for your review.", "review": row}


# ------------------------------------------------------------------ Management side

@router.get("/client-reviews")
async def list_client_reviews(
    branch_id: Optional[str] = Query(None),
    user: V3UserOut = Depends(v3_require_roles("super_admin", "business_dev", "branch_admin")),
):
    """Every review management may read, with the figures over them.

    A Branch Admin is always held to their own branch, whatever they pass. Super Admin and
    BDE read every branch and may narrow to one.
    """
    query: dict = {}
    if is_branch_admin_role(user.role):
        if not user.branch_id:
            return {"reviews": [], "summary": summarise([])}
        query["branch_id"] = user.branch_id
    elif branch_id:
        query["branch_id"] = branch_id

    rows = await v3_col(COLLECTION).find(query, {"_id": 0}).to_list(5000)
    # Newest activity first: an edited review is news again.
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
    return {"reviews": rows, "summary": summarise(rows)}
