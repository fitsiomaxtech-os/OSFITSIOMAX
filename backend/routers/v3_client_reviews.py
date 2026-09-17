"""Client Reviews — the stars a client gives their Consultant and their Physio.

Kept apart from two things with a similar name:

  * routers/v3_reviews.py is the clinical Review pipeline, the Consultant's review of a
    patient's progress every 7 days of treatment. Nothing to do with what the client thought
    -- though a completed one is what the client's Consultant Review hangs off.
  * routers/v3_feedback.py is the client's conversation with their branch, consultant or
    head office ("Talk to Management"). That is words to be answered; this is a verdict.

Every review is its own row, with a `kind` (who is rated) and a `source` (what prompted it):

  * source "week"    -- every 7 days of treatment the client rates BOTH their Physio and their
    Consultant the same way: 1-5 stars and written feedback, one row per kind per week. A
    week is due once every day in it is completed; the portal then asks in a pop-up for
    each due week finished since PHYSIO_REVIEW_START. Optional: Skip stops the asking. Rehab weeks (every 7
    rehab days) rate the Physio only -- rehab has no consultant of its own.
  * source "anytime" -- either kind, from the Feedback tab, whenever the client wants.
  * source "session" / "review" -- the earlier per-session Physio and per-clinical-Review
    Consultant rows. No longer written, still read by management.

Rows written by the first flow (one row per client with both ratings, no `kind`) are still
read by management: list_client_reviews splits each into its consultant and physio halves.

Read by management only: Super Admin and BDE across every branch, a Branch Admin for their
own branch. BDE is admitted by BDE_ROLES rather than the one slug: the Business Development
Executive is `business_dev`, but a login created before migrate_designation_roles ran still
holds the typed `business_development_executive` (see DEFAULT_ROLES in routers/v3_hr.py),
and that desk reads these figures for the company.
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
# Weeks whose review pop-up the client skipped: {lead_id, track, week_number, skipped_at}.
SKIPS_COLLECTION = "client_review_skips"
MAX_TEXT = 2000

KIND_PHYSIO = "physio"
KIND_CONSULTANT = "consultant"
SOURCE_WEEK = "week"
SOURCE_ANYTIME = "anytime"

TRACKS = ("treatment", "rehab")
DAYS_PER_WEEK = 7

# Weeks finished on or after this are the ones a client must rate.
PHYSIO_REVIEW_START = "2026-09-16"

BDE_ROLES = ("business_dev", "business_development_executive")


class WeekReviewIn(BaseModel):
    track: str = "treatment"
    week_number: int
    physio_rating: Optional[int] = None
    physio_comment: Optional[str] = ""
    consultant_rating: Optional[int] = None
    consultant_comment: Optional[str] = ""


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


def required_comment(value, who: str) -> str:
    text = _text(value)
    if not text:
        raise HTTPException(status_code=400, detail=f"Write a few words of feedback for your {who}")
    return text


def week_of(day: dict) -> int:
    """The week a day sits in. Treatment days carry `week_number` from booking; rehab days
    and older rows do not, so every 7 days by number make a week."""
    if day.get("track") != "rehab" and day.get("week_number"):
        return int(day["week_number"])
    number = day.get("session_number") or day.get("day_number") or 1
    return (int(number) - 1) // DAYS_PER_WEEK + 1


def course_weeks(days: List[dict]) -> List[dict]:
    """Every week of both courses: its day range, whether every day is completed, when it
    finished, and the physio of its last completed day. `days` each carry `track`."""
    groups: Dict[tuple, List[dict]] = {}
    for d in days:
        track = d.get("track") or "treatment"
        groups.setdefault((track, week_of({**d, "track": track})), []).append(d)
    out = []
    for (track, week), rows in groups.items():
        done = [r for r in rows if r.get("status") == "completed"]
        complete = len(done) == len(rows)
        last = max(done, key=lambda r: str(r.get("completed_at") or r.get("slot_time") or "")) if done else {}
        numbers = [n for n in (r.get("session_number") or r.get("day_number") for r in rows) if n is not None]
        slots = [str(r.get("slot_time") or "") for r in rows if r.get("slot_time")]
        out.append({
            # The last day's date: the review opens once that day is done.
            "opens_on": max(slots)[:10] if slots else "",
            "track": track,
            "week_number": week,
            "first_number": min(numbers) if numbers else None,
            "last_number": max(numbers) if numbers else None,
            "days": len(rows),
            "completed_days": len(done),
            "complete": complete,
            "finished_at": str(last.get("completed_at") or last.get("slot_time") or "") if complete else "",
            "physio_id": _text(last.get("physio_id")),
            "physio_name": _text(last.get("physio_name") or last.get("completed_by")),
        })
    out.sort(key=lambda w: (TRACKS.index(w["track"]) if w["track"] in TRACKS else len(TRACKS), w["week_number"]))
    return out


def pending_weeks(weeks: List[dict], rows: List[dict], has_consultant: bool,
                  skipped: Optional[set] = None, since: str = PHYSIO_REVIEW_START) -> List[dict]:
    """Completed weeks, finished since `since`, oldest first, still missing a Physio or
    Consultant review and not skipped. Rehab weeks owe the Physio half only."""
    given = {(r.get("kind"), r.get("track"), r.get("week_number")) for r in rows if r.get("source") == SOURCE_WEEK}
    skipped = skipped or set()
    out = []
    for w in weeks:
        if not w["complete"] or w["finished_at"][:10] < since or (w["track"], w["week_number"]) in skipped:
            continue
        needs_physio = (KIND_PHYSIO, w["track"], w["week_number"]) not in given
        needs_consultant = (w["track"] == "treatment" and has_consultant
                            and (KIND_CONSULTANT, w["track"], w["week_number"]) not in given)
        if needs_physio or needs_consultant:
            out.append({**w, "needs_physio": needs_physio, "needs_consultant": needs_consultant})
    out.sort(key=lambda w: w["finished_at"])
    return out


async def _course_days(lead_id: str) -> List[dict]:
    fields = {"_id": 0, "id": 1, "status": 1, "completed_at": 1, "slot_time": 1, "session_number": 1,
              "day_number": 1, "week_number": 1, "physio_id": 1, "physio_name": 1, "completed_by": 1}
    treatment = await v3_col("sessions").find({"lead_id": lead_id}, fields).to_list(500)
    rehab = await v3_col("rehab_sessions").find({"lead_id": lead_id}, fields).to_list(300)
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
    """One row per thing reviewed: saving the same week again changes it."""
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
    """Everything the portal's Weekly Review card, its pop-up and the Feedback tab draw from."""
    lead = await _lead_or_404(lead_id)
    rows = await v3_col(COLLECTION).find(
        {"lead_id": lead_id, "kind": {"$in": [KIND_PHYSIO, KIND_CONSULTANT]}, "skipped": {"$ne": True}}, {"_id": 0}
    ).sort("created_at", -1).to_list(1000)
    team = await care_team(lead)
    weeks = course_weeks(await _course_days(lead_id))
    week_rows = [r for r in rows if r.get("source") == SOURCE_WEEK]
    skipped = {
        (s.get("track"), s.get("week_number"))
        for s in await v3_col(SKIPS_COLLECTION).find({"lead_id": lead_id}, {"_id": 0}).to_list(500)
    }
    return {
        **team,
        "weeks": weeks,
        "weeks_pending": pending_weeks(weeks, week_rows, bool(team["consultant"]["name"]), skipped),
        "week_reviews": week_rows,
        "anytime_reviews": [r for r in rows if r.get("source") == SOURCE_ANYTIME],
    }


class WeekSkipIn(BaseModel):
    track: str = "treatment"
    week_number: int


@router.post("/patient-portal/review/week/skip")
async def portal_skip_week(payload: WeekSkipIn, lead_id: str = Depends(_current_patient_lead_id)):
    """The client closed a week's review pop-up with Skip. It stops asking for that week;
    the week's Review button still opens it whenever they choose."""
    if payload.track not in TRACKS:
        raise HTTPException(status_code=400, detail="Unknown course")
    await _lead_or_404(lead_id)
    match = {"lead_id": lead_id, "track": payload.track, "week_number": payload.week_number}
    await v3_col(SKIPS_COLLECTION).update_one(match, {"$set": {**match, "skipped_at": now_iso()}}, upsert=True)
    return {"message": "Skipped. You can review this week any time from Sessions."}


@router.post("/patient-portal/review/week")
async def portal_review_week(payload: WeekReviewIn, lead_id: str = Depends(_current_patient_lead_id)):
    """Stars and feedback for the Physio and the Consultant on one completed week.

    Both halves come together; a half already given may be left out, and sending a half
    again changes it. Rehab weeks take the Physio half only.
    """
    if payload.track not in TRACKS:
        raise HTTPException(status_code=400, detail="Unknown course")
    lead = await _lead_or_404(lead_id)
    week = next((
        w for w in course_weeks(await _course_days(lead_id))
        if w["track"] == payload.track and w["week_number"] == payload.week_number
    ), None)
    if not week:
        raise HTTPException(status_code=404, detail="Week not found")
    if not week["complete"]:
        raise HTTPException(status_code=400, detail="You can review this week once all its sessions are completed")

    match = {"track": week["track"], "week_number": week["week_number"]}
    given = {r["kind"] for r in await v3_col(COLLECTION).find(
        {"lead_id": lead_id, "source": SOURCE_WEEK, **match}, {"_id": 0, "kind": 1}
    ).to_list(10)}
    team = await care_team(lead)

    writes = []
    if payload.physio_rating is not None or KIND_PHYSIO not in given:
        writes.append((KIND_PHYSIO, {
            "rating": required_rating(payload.physio_rating),
            "comment": required_comment(payload.physio_comment, "physio"),
            "person_id": week["physio_id"] or team["physio"]["id"],
            "person_name": week["physio_name"] or team["physio"]["name"],
        }))
    wants_consultant = week["track"] == "treatment" and bool(team["consultant"]["name"])
    if wants_consultant and (payload.consultant_rating is not None or KIND_CONSULTANT not in given):
        writes.append((KIND_CONSULTANT, {
            "rating": required_rating(payload.consultant_rating),
            "comment": required_comment(payload.consultant_comment, "consultant"),
            "person_id": team["consultant"]["id"],
            "person_name": team["consultant"]["name"],
        }))
    if not writes:
        raise HTTPException(status_code=400, detail="Tap the stars to give a rating")

    common = {"week_first_number": week["first_number"], "week_last_number": week["last_number"],
              "session_date": week["finished_at"]}
    saved = [await _upsert(lead, kind, SOURCE_WEEK, match, {**common, **fields}) for kind, fields in writes]
    return {"message": f"Thank you for reviewing week {week['week_number']}.", "reviews": saved}


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
    user: V3UserOut = Depends(v3_require_roles("super_admin", *BDE_ROLES, "branch_admin")),
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
