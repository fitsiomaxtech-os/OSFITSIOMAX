from fastapi import APIRouter, HTTPException, Depends
from typing import Optional
from datetime import datetime, timezone
import uuid

from database import v3_col
from utils import now_iso, normalize_slot_time
from security import hash_password
from deps import v3_require_roles
from schemas.v3 import (
    V3UserOut, V3CompleteSessionInput, V3AbsentSessionInput, V3JrPhysioWeeklyInput,
    V3CreateJrPhysioInput, V3LeadOut,
)
# The interval that actually governs when a review can be raised. Imported rather than
# redeclared so the Treatment Days popup marks its milestones where the reviews router
# agrees they are.
from routers.v3_reviews import REVIEW_AFTER_DAYS
# Which leads belong to a physio. In its own module because both this board and the
# reviews router need it, and this one already imports from that one — a helper living
# in either would close the loop.
from physio_scope import physio_lead_ids

router = APIRouter(prefix="/api/v3")


async def _resolve_doctor(user: V3UserOut, physio_id: Optional[str] = None) -> Optional[dict]:
    """Find the doctors record for the logged-in physio. Doctors created via Jr. Physio
    signup are linked directly by user_id; doctors created via Fitsiomax Experts are only
    linked to an employee record, so fall back to the users.employee_id -> doctors.employee_id
    chain to resolve those. Super Admin driving a specific physio's board (Branch Management >
    Branch Control) can pass that physio's doctor id to resolve directly instead — a branch can
    have several physios, so branch_id alone isn't enough to disambiguate."""
    if physio_id and user.role == "super_admin":
        doctor = await v3_col("doctors").find_one({"id": physio_id, "profile_type": "physio"}, {"_id": 0})
        if doctor:
            return doctor
    doctor = await v3_col("doctors").find_one(
        {"user_id": user.id, "profile_type": "physio"},
        {"_id": 0},
    )
    if doctor:
        return doctor
    raw_user = await v3_col("users").find_one({"id": user.id}, {"_id": 0, "employee_id": 1})
    if raw_user and raw_user.get("employee_id"):
        doctor = await v3_col("doctors").find_one(
            {"employee_id": raw_user["employee_id"], "profile_type": "physio"},
            {"_id": 0},
        )
    return doctor


@router.post("/branch/jr-physios")
async def create_jr_physio(payload: V3CreateJrPhysioInput, user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin"))):
    branch_id = user.branch_id
    if not branch_id:
        raise HTTPException(status_code=400, detail="No branch assigned")

    email = payload.email.lower().strip()
    exists = await v3_col("users").find_one({"email": email}, {"_id": 0})
    if exists:
        raise HTTPException(status_code=409, detail="User with this email already exists")

    user_id = str(uuid.uuid4())
    doctor_id = str(uuid.uuid4())

    await v3_col("users").insert_one({
        "id": user_id,
        "full_name": payload.full_name.strip(),
        "email": email,
        "password": hash_password(payload.password),
        "role": "physio",
        "branch_id": branch_id,
        "is_active": True,
        "created_at": now_iso(),
    })

    doctor = {
        "id": doctor_id,
        "full_name": payload.full_name.strip(),
        "profile_type": "physio",
        "branch_id": branch_id,
        "specialization": payload.specialization or "",
        "slots": [],
        "slot_details": [],
        "user_id": user_id,
        "created_at": now_iso(),
    }
    await v3_col("doctors").insert_one(doctor.copy())

    return {
        "doctor_id": doctor_id,
        "user_id": user_id,
        "full_name": payload.full_name.strip(),
        "email": email,
        "branch_id": branch_id,
    }


async def _rehab_rows(physio_id: str, prefix: str) -> list:
    """This physio's rehab days whose date starts with `prefix`, shaped like a session row.

    `track: "rehab"` is what tells the board apart from a treatment day. Every row also
    carries day_number/total_days of its own *rehab course*, never of the session package —
    the two are separate courses that happen to share a physio and a calendar, and merging
    their counts is how "Day 3 of 7" starts lying. See v3_rehab for why they are separate
    collections in the first place.
    """
    rows = await v3_col("rehab_sessions").find(
        {"physio_id": physio_id, "slot_time": {"$regex": f"^{prefix}"}},
        {"_id": 0},
    ).sort("slot_time", 1).to_list(500)
    for row in rows:
        row["track"] = "rehab"
        # Named the way the board already reads a session, so nothing downstream has to
        # learn a second shape to render the row.
        row["session_number"] = row.get("day_number")
        row["total_sessions"] = row.get("total_days")
    return rows


@router.get("/physio/today")
async def physio_today(physio_id: Optional[str] = None, user: V3UserOut = Depends(v3_require_roles("physio", "super_admin"))):
    doctor = await _resolve_doctor(user, physio_id)

    if not doctor:
        return {"sessions": [], "new_assigned": [], "date": datetime.now(timezone.utc).date().isoformat()}

    today = datetime.now(timezone.utc).date().isoformat()
    sessions = await v3_col("sessions").find(
        {"physio_id": doctor["id"], "slot_time": {"$regex": f"^{today}"}},
        {"_id": 0},
    ).sort("slot_time", 1).to_list(100)
    # Rehab days sit on the same day, in the same room, for the same physio — so the day's
    # list has to hold them or the physio arrives to a patient their board never mentioned.
    # Merged in tagged rather than silently: a rehab day is not a day of the treatment
    # package, and reading as one would put the "Day 3 of 7" count out.
    sessions = sessions + await _rehab_rows(doctor["id"], today)
    sessions.sort(key=lambda r: r.get("slot_time") or "")

    new_assigned = await v3_col("leads").find(
        {"assigned_physio_id": doctor["id"], "physio_assigned_at": {"$regex": f"^{today}"}},
        {"_id": 0},
    ).sort("physio_assigned_at", -1).to_list(200)

    return {
        "sessions": sessions,
        "new_assigned": [V3LeadOut(**ld).model_dump() for ld in new_assigned],
        "date": today,
        "doctor_id": doctor["id"],
        "doctor_name": doctor["full_name"],
    }


@router.get("/physio/calendar")
async def physio_calendar(
    month: Optional[int] = None,
    year: Optional[int] = None,
    physio_id: Optional[str] = None,
    user: V3UserOut = Depends(v3_require_roles("physio", "super_admin")),
):
    doctor = await _resolve_doctor(user, physio_id)

    if not doctor:
        return {"sessions": [], "slots": [], "slot_details": []}

    now = datetime.now(timezone.utc)
    m = month or now.month
    y = year or now.year
    prefix = f"{y}-{str(m).zfill(2)}"

    sessions = await v3_col("sessions").find(
        {"physio_id": doctor["id"], "slot_time": {"$regex": f"^{prefix}"}},
        {"_id": 0},
    ).sort("slot_time", 1).to_list(500)
    # Same reason as /physio/today: the month has to show the rehab days too, or the week
    # strip counts a day as free that the physio is already booked for.
    sessions = sessions + await _rehab_rows(doctor["id"], prefix)
    sessions.sort(key=lambda r: r.get("slot_time") or "")

    return {
        "sessions": sessions,
        "slots": doctor.get("slots", []),
        "slot_details": doctor.get("slot_details", []),
        "doctor_id": doctor["id"],
        "doctor_name": doctor["full_name"],
    }


@router.get("/physio/patients")
async def physio_patients(physio_id: Optional[str] = None, user: V3UserOut = Depends(v3_require_roles("physio", "super_admin"))):
    """Every lead ever assigned to this physio — not just ones with generated treatment
    sessions — so newly assigned/consulted patients show up here right away, with session
    stats layered on once a package is assigned and sessions exist."""
    doctor = await _resolve_doctor(user, physio_id)

    if not doctor:
        return {"patients": []}

    # Rehab patients included: they are this physio's too, and were missing from this list
    # entirely because the lead carries no assigned_physio_id for them.
    lead_ids = await physio_lead_ids(doctor["id"])
    leads = await v3_col("leads").find(
        {"id": {"$in": lead_ids}}, {"_id": 0}
    ).sort("updated_at", -1).to_list(500)
    sessions = await v3_col("sessions").find(
        {"physio_id": doctor["id"], "lead_id": {"$in": lead_ids}}, {"_id": 0}
    ).sort("slot_time", 1).to_list(2000)
    sessions_by_lead: dict = {}
    for s in sessions:
        sessions_by_lead.setdefault(s["lead_id"], []).append(s)

    # Where each week's review has got to: written up by this physio and waiting on the
    # Head Physio ("submitted"), or closed out by them ("reviewed").
    assessment_rows = await v3_col("weekly_assessments").find(
        {"lead_id": {"$in": lead_ids}}, {"_id": 0, "lead_id": 1, "status": 1}
    ).to_list(2000)
    reviews_by_lead: dict = {}
    for a in assessment_rows:
        r = reviews_by_lead.setdefault(a["lead_id"], {"submitted": 0, "reviewed": 0})
        if a.get("status") == "reviewed":
            r["reviewed"] += 1
        else:
            r["submitted"] += 1

    patients = []
    for lead in leads:
        patient_sessions = sessions_by_lead.get(lead["id"], [])
        reviews = reviews_by_lead.get(lead["id"], {"submitted": 0, "reviewed": 0})
        completed = sum(1 for s in patient_sessions if s["status"] == "completed")
        total = len(patient_sessions)
        next_session = next((s for s in patient_sessions if s["status"] == "upcoming"), None)
        # Weeks the booked sessions actually span — package_weeks is only set when a Head
        # Physio recommended a package, so the Review tab falls back to this to know how
        # many weeks it can offer an assessment for.
        weeks = max((s.get("week_number") or 1) for s in patient_sessions) if patient_sessions else 0

        patients.append({
            "lead_id": lead["id"],
            "lead_name": lead.get("name", "Unknown"),
            "phone": lead.get("phone", ""),
            # The branch's two hand-made marks, carried through so a treating
            # clinician sees the VIP star and the attention flag on the same
            # patient the branch marked. This row is a projection, so anything
            # not named here simply never leaves the backend.
            "is_vip": bool(lead.get("is_vip")),
            "needs_attention": bool(lead.get("needs_attention")),
            "total_sessions": total,
            "completed_sessions": completed,
            "remaining_sessions": total - completed,
            "next_session": next_session,
            "package_weeks": lead.get("package_weeks"),
            "weeks": weeks,
            "physio_stage": lead.get("physio_stage"),
            "consultation_stage": lead.get("consultation_stage"),
            "updated_at": lead.get("updated_at"),
            "reviews_submitted": reviews["submitted"],
            "reviews_reviewed": reviews["reviewed"],
        })

    return {"patients": patients}


@router.get("/physio/consultations")
async def physio_consultations(physio_id: Optional[str] = None, user: V3UserOut = Depends(v3_require_roles("physio", "super_admin"))):
    """Leads/appointments assigned to this consultant by a branch manager (pre-package consultation pipeline)."""
    doctor = await _resolve_doctor(user, physio_id)
    if not doctor:
        return {"leads": []}

    # The same set the Patients and Review tabs read. This is what the Treatment list
    # matches its day rows against, so a rehab patient missing here left the row drawn from
    # a name-and-id stub with no phone — and the list decides a row is clickable by asking
    # whether the lead has one. It was the third place reading the stamp alone.
    lead_ids = await physio_lead_ids(doctor["id"])
    leads = await v3_col("leads").find(
        {"id": {"$in": lead_ids}},
        {"_id": 0},
    ).sort("appointment_datetime", -1).to_list(500)
    day_rows = await v3_col("sessions").find(
        {"physio_id": doctor["id"], "lead_id": {"$in": lead_ids}},
        {"_id": 0, "lead_id": 1, "status": 1, "week_number": 1},
    ).to_list(5000)
    tallies: dict = {}
    for row in day_rows:
        t = tallies.setdefault(row["lead_id"], {"total": 0, "completed": 0, "weeks": 0})
        t["total"] += 1
        if row.get("status") == "completed":
            t["completed"] += 1
        # Weeks the plan spans — the highest week any of its days falls in.
        t["weeks"] = max(t["weeks"], row.get("week_number") or 1)

    out = []
    for ld in leads:
        dumped = V3LeadOut(**ld).model_dump()
        t = tallies.get(ld["id"], {"total": 0, "completed": 0, "weeks": 0})
        dumped["total_sessions"] = t["total"]
        dumped["completed_sessions"] = t["completed"]
        dumped["weeks"] = t["weeks"]
        out.append(dumped)

    return {
        "leads": out,
        "doctor_id": doctor["id"],
        "doctor_name": doctor["full_name"],
    }


@router.get("/physio/patient/{lead_id}")
async def physio_patient_detail(lead_id: str, physio_id: Optional[str] = None, user: V3UserOut = Depends(v3_require_roles("physio", "super_admin"))):
    """Full record for one of this physio's own assigned patients — backs the Patient
    Detail page's Treatment and Profile tabs (diagnosis, treatment plan, payment fields).
    physio_patients/physio_consultations only ever return a hand-picked subset; this is
    the one place a physio can read everything V3LeadOut carries for their own patient."""
    doctor = await _resolve_doctor(user, physio_id)
    if not doctor:
        raise HTTPException(status_code=404, detail="No physio profile found for this user")

    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if lead.get("assigned_physio_id") != doctor["id"]:
        raise HTTPException(status_code=403, detail="This lead is not assigned to you")

    return V3LeadOut(**lead).model_dump()


@router.post("/physio/leads/{lead_id}/complete-consultation")
async def physio_complete_consultation(lead_id: str, physio_id: Optional[str] = None, user: V3UserOut = Depends(v3_require_roles("physio", "super_admin"))):
    """Physio marks their initial consultation review of an assigned lead as finished."""
    doctor = await _resolve_doctor(user, physio_id)
    if not doctor:
        raise HTTPException(status_code=404, detail="No physio profile found for this user")

    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if lead.get("assigned_physio_id") != doctor["id"]:
        raise HTTPException(status_code=403, detail="This lead is not assigned to you")

    await v3_col("leads").update_one({"id": lead_id}, {"$set": {
        "physio_stage": "Complete",
        "updated_at": now_iso(),
    }})
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "physio_consultation_completed",
        "details": f"Consultation marked complete by {user.full_name}",
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now_iso(),
    })
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return V3LeadOut(**updated).model_dump()


@router.get("/physio/sessions/{lead_id}")
async def physio_lead_sessions(lead_id: str, _: V3UserOut = Depends(v3_require_roles("physio", "super_admin", "head_physio", "branch_admin"))):
    sessions = await v3_col("sessions").find(
        {"lead_id": lead_id}, {"_id": 0}
    ).sort("slot_time", 1).to_list(500)
    for row in sessions:
        row.setdefault("track", "treatment")

    # A rehab patient's days live in their own collection, so this popup opened empty for
    # them — the row on the list said Day 1 of 26 and the days behind it were nowhere.
    # Merged in tagged, shaped the way the popup already reads a day, so the list needs no
    # second shape and a rehab day can still say what it is rather than passing as a day of
    # a treatment package the patient may not be on.
    rehab = await v3_col("rehab_sessions").find(
        {"lead_id": lead_id}, {"_id": 0}
    ).sort("slot_time", 1).to_list(500)
    for row in rehab:
        row["track"] = "rehab"
        row["session_number"] = row.get("day_number")
        row["total_sessions"] = row.get("total_days")
        # Rehab courses are not cut into weeks; leaving this unset would read as week 0.
        row.setdefault("week_number", None)
    sessions = sorted(sessions + rehab, key=lambda r: r.get("slot_time") or "")

    assessments = await v3_col("weekly_assessments").find(
        {"lead_id": lead_id}, {"_id": 0}
    ).sort("week_number", 1).to_list(100)

    # What became of each review this patient's treatment has already earned. The Treatment
    # Days list marks its milestones off this: on its own the popup can only count to seven,
    # so it had to call every milestone "due" — including the ones a Head Physio had already
    # written up, and including the one currently sitting on the Branch Admin's desk.
    review_rows = await v3_col("reviews").find({"lead_id": lead_id}, {"_id": 0}).to_list(100)
    reviews = [
        {
            "id": r.get("id"),
            "status": r.get("status"),
            "treatment_days": r.get("treatment_days") or 0,
            # Which milestone this covers, taken from the day count stored when it was
            # raised rather than from its position among the reviews: raising is allowed
            # any time after a milestone, so a review raised on day 9 still covers day 7.
            "review_number": max(1, (r.get("treatment_days") or 0) // REVIEW_AFTER_DAYS),
            "reason": r.get("reason") or "",
            "physio_notes": r.get("physio_notes") or "",
            "head_physio_name": r.get("head_physio_name") or "",
            "review_date": r.get("review_date") or "",
            "completed_at": r.get("completed_at") or "",
        }
        for r in review_rows
    ]
    reviews.sort(key=lambda r: r["treatment_days"])

    # Sent so the popup marks milestones on the same interval the reviews router enforces,
    # instead of carrying its own copy of the number and drifting from it.
    return {
        "sessions": sessions,
        "assessments": assessments,
        "reviews": reviews,
        "review_after_days": REVIEW_AFTER_DAYS,
    }


async def _first_incomplete_before(session: dict):
    """The lowest day number before this one that is still not completed, or None.

    Ordered on session_number rather than on the date: a day that has been pushed by an
    absence carries a later date than the day after it until the shift is applied, and
    comparing dates would then call the sequence broken when it is not.
    """
    # Against the day's own course. A rehab course and a treatment package are separate
    # runs of days for the same patient, so judging one by the other has Rehab Day 2 blocked
    # by Treatment Day 1 — two courses that never had an order between them.
    rehab = session.get("track") == "rehab"
    collection = "rehab_sessions" if rehab else "sessions"
    field = "day_number" if rehab else "session_number"
    number = session.get(field) or session.get("session_number") or 0
    rows = await v3_col(collection).find(
        {"lead_id": session.get("lead_id"), "status": {"$ne": "completed"}},
        {"_id": 0, field: 1},
    ).to_list(1000)
    earlier = [r.get(field) or 0 for r in rows if (r.get(field) or 0) < number]
    return min(earlier) if earlier else None


@router.post("/physio/sessions/{session_id}/absent")
async def physio_mark_absent(
    session_id: str,
    payload: V3AbsentSessionInput,
    user: V3UserOut = Depends(v3_require_roles("physio", "super_admin")),
):
    """The patient did not turn up, so the day moves rather than being lost.

    This day and every uncompleted day after it shift down one place: this day takes the
    next day's slot, that one takes the one after, and so on to the end of the course.
    Moving only the missed one would land it on top of the next day already booked, and the
    package is a count of days of treatment — skipping one would quietly shorten it.

    The days move into each other's slots rather than each sliding one calendar day, which
    is what this did before. Treatment dates are not a run of consecutive days: the Branch
    Admin picks every one of them off the physio's published calendar, so a package can be
    three days a week, and adding a day to each date walks the whole course onto days that
    physio never opened. Stepping along the slots already chosen keeps every remaining day
    on a time that exists.

    That leaves the last day with nowhere to go, so it is left unscheduled and handed back
    to the Branch Admin — the only role that can place a day on a published slot. This is
    the missed class: the patient is still owed all of their days, and the last one now
    needs a date choosing rather than one being invented for it.

    The absence itself is kept on the session and written to the lead's activity, because
    the branch needs to see that a day was missed and when; the schedule moving on its own
    would otherwise be the only trace, and that reads as an admin error rather than a
    patient who did not arrive.
    """
    # A rehab day is a day of its own course, in its own collection. The popup lists both
    # tracks together, so Complete is pressed on either — and this looked only in `sessions`
    # and answered "Session not found" for every rehab day on the board. Marking one absent
    # was the same story.
    session = await v3_col("sessions").find_one({"id": session_id}, {"_id": 0})
    collection = "sessions"
    if not session:
        session = await v3_col("rehab_sessions").find_one({"id": session_id}, {"_id": 0})
        if session:
            collection = "rehab_sessions"
            session["track"] = "rehab"
            # Named the way the rest of this function reads a day, so one body serves both.
            session["session_number"] = session.get("day_number")
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    is_rehab = collection == "rehab_sessions"
    if session["status"] == "completed":
        raise HTTPException(status_code=400, detail="This day is already completed")

    blocking = await _first_incomplete_before(session)
    if blocking is not None:
        raise HTTPException(
            status_code=400,
            detail=f"Day {blocking} has not been completed yet — treatment days are worked in order",
        )

    missed_on = (session.get("slot_time") or "").split("T")[0]
    number = session.get("session_number") or 0

    # This day and everything after it that has not been done. Completed days keep the date
    # they actually happened on.
    # A rehab course numbers its days day_number, not session_number. Read under the wrong
    # name every row came back as day 0, nothing sorted after the missed day, and the
    # absence was recorded while the dates it was supposed to move stayed exactly as they
    # were — the quietest possible failure.
    num_field = "day_number" if is_rehab else "session_number"
    to_move = await v3_col(collection).find(
        {"lead_id": session["lead_id"], "status": {"$ne": "completed"}},
        {"_id": 0, "id": 1, num_field: 1, "slot_time": 1},
    ).to_list(1000)
    later = sorted(
        (r for r in to_move if (r.get(num_field) or 0) >= number),
        key=lambda r: r.get(num_field) or 0,
    )

    # Only the days that still hold a slot take part. A day already waiting on the Branch
    # Admin from an earlier absence has no slot to give away, and stepping through it would
    # hand its emptiness to the day in front — one absence would strand two days instead of
    # one. Those wait where they are; each absence leaves exactly one day to be re-dated.
    dated = [r for r in later if (r.get("slot_time") or "").strip()]

    moved = 0
    for i, row in enumerate(dated):
        next_slot = dated[i + 1]["slot_time"] if i + 1 < len(dated) else ""
        await v3_col(collection).update_one(
            {"id": row["id"]},
            {"$set": {
                "slot_time": next_slot,
                # True on the last one only — the day the course has run out of slots for.
                "needs_assignment": not next_slot,
                "updated_at": now_iso(),
            }},
        )
        moved += 1

    await v3_col(collection).update_one(
        {"id": session_id},
        {"$push": {"absences": {
            "date": missed_on,
            "marked_by": user.full_name,
            "marked_at": now_iso(),
            "remarks": (payload.remarks or "").strip(),
        }}},
    )

    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": session["lead_id"],
        "action": "session_absent",
        "details": (
            f"Day {number} marked absent on {missed_on or 'an unknown date'} by {user.full_name}."
            f" That day and {max(moved - 1, 0)} later day(s) moved down one slot."
            + (
                f" Day {dated[-1].get(num_field)} now needs a date from the Branch Admin."
                if dated else ""
            )
            + (f" Remarks: {payload.remarks.strip()}" if (payload.remarks or "").strip() else "")
        ),
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now_iso(),
    })

    updated = await v3_col(collection).find_one({"id": session_id}, {"_id": 0})
    landed = ((updated or {}).get("slot_time") or "").split("T")[0]
    unscheduled_day = dated[-1].get(num_field) if dated else None
    return {
        "session": updated,
        "moved": moved,
        "unscheduled_session_number": unscheduled_day,
        "message": (
            f"Day {number} marked absent — moved to {landed}" if landed
            else f"Day {number} marked absent"
        ) + (
            f". Day {unscheduled_day} now needs a date from the Branch Admin."
            if unscheduled_day and unscheduled_day != number else ""
        ),
    }


@router.post("/physio/sessions/{session_id}/complete")
async def physio_complete_session(
    session_id: str,
    payload: V3CompleteSessionInput,
    user: V3UserOut = Depends(v3_require_roles("physio", "super_admin")),
):
    # A rehab day is a day of its own course, in its own collection. The popup lists both
    # tracks together, so Complete is pressed on either — and this looked only in `sessions`
    # and answered "Session not found" for every rehab day on the board. Marking one absent
    # was the same story.
    session = await v3_col("sessions").find_one({"id": session_id}, {"_id": 0})
    collection = "sessions"
    if not session:
        session = await v3_col("rehab_sessions").find_one({"id": session_id}, {"_id": 0})
        if session:
            collection = "rehab_sessions"
            session["track"] = "rehab"
            # Named the way the rest of this function reads a day, so one body serves both.
            session["session_number"] = session.get("day_number")
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    is_rehab = collection == "rehab_sessions"
    if session["status"] == "completed":
        raise HTTPException(status_code=400, detail="Session already completed")

    # Treatment runs in order. Day 5 being ticked off while Day 4 is still open means either
    # the wrong row was pressed or a day went unrecorded, and both are worth stopping here:
    # the day count drives the review milestones, so a gap in it quietly moves them.
    blocking = await _first_incomplete_before(session)
    if blocking is not None:
        raise HTTPException(
            status_code=400,
            detail=f"Day {blocking} has not been completed yet — days are completed in order",
        )

    # One of the two is the report. Checked here and not only in the popup: this is what
    # the day-report views read to tell a day that was written up from one that was ticked
    # off, and a session completed through the API with neither would read as the latter.
    treatment_remarks = (payload.remarks or "").strip()
    rehab_remarks = (payload.rehab_remarks or "").strip()
    # A rehab day has no treatment half to write about, so only the rehab note counts —
    # otherwise it could be signed off with a note about treatment that did not happen and
    # the one thing the day exists to record left blank.
    if is_rehab and not rehab_remarks:
        raise HTTPException(status_code=400, detail="Rehab Remarks is required")
    if not is_rehab and not treatment_remarks and not rehab_remarks:
        raise HTTPException(status_code=400, detail="Treatment Remarks or Rehab Remarks is required")

    await v3_col(collection).update_one(
        {"id": session_id},
        {"$set": {
            "status": "completed",
            "jr_physio_remarks": treatment_remarks,
            # Kept beside the treatment note rather than folded into it: the Consultant
            # reads the two for different reasons, and one field would make that a
            # matter of how the physio happened to punctuate.
            "rehab_remarks": rehab_remarks,
            # Who wrote the day's report. It was only ever in the activity log's prose,
            # which is not something the Head Physio's day-report view can read a name out
            # of. Rows completed before this stay blank rather than guessing.
            "completed_by": user.full_name,
            "completed_at": now_iso(),
            "updated_at": now_iso(),
        }},
    )

    # Only what was written gets a label in the log; an empty half would otherwise read
    # as "Rehab remarks:" with nothing after it.
    log_parts = []
    if treatment_remarks:
        log_parts.append(f"Remarks: {treatment_remarks}")
    if rehab_remarks:
        log_parts.append(f"Rehab remarks: {rehab_remarks}")
    log_remarks = " · ".join(log_parts)

    activity = {
        "id": str(uuid.uuid4()),
        "lead_id": session["lead_id"],
        "action": "session_completed",
        "details": (
            f"{'Rehab Day' if is_rehab else 'Session'} #{session.get('session_number', '?')}"
            f" completed by {user.full_name}. {log_remarks}"
        ),
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now_iso(),
    }
    await v3_col("lead_activity").insert_one(activity.copy())

    updated = await v3_col(collection).find_one({"id": session_id}, {"_id": 0})
    return updated


@router.post("/physio/weekly-assessment/{lead_id}/{week_number}")
async def physio_weekly_assessment(
    lead_id: str,
    week_number: int,
    payload: V3JrPhysioWeeklyInput,
    physio_id: Optional[str] = None,
    user: V3UserOut = Depends(v3_require_roles("physio", "super_admin")),
):
    existing = await v3_col("weekly_assessments").find_one(
        {"lead_id": lead_id, "week_number": week_number}, {"_id": 0}
    )

    if existing:
        await v3_col("weekly_assessments").update_one(
            {"lead_id": lead_id, "week_number": week_number},
            {"$set": {
                "jr_physio_notes": payload.jr_physio_notes,
                "status": "submitted",
                "submitted_by": user.full_name,
                "updated_at": now_iso(),
            }},
        )
    else:
        doctor = await _resolve_doctor(user, physio_id)
        rec = await v3_col("package_recommendations").find_one({"lead_id": lead_id}, {"_id": 0})
        await v3_col("weekly_assessments").insert_one({
            "id": str(uuid.uuid4()),
            "lead_id": lead_id,
            "branch_id": (doctor.get("branch_id") if doctor else None) or user.branch_id,
            "physio_id": doctor["id"] if doctor else "",
            "head_physio_id": rec.get("head_physio_id", "") if rec else "",
            "week_number": week_number,
            "jr_physio_notes": payload.jr_physio_notes,
            "head_physio_notes": "",
            "head_physio_suggestions": "",
            "status": "submitted",
            "submitted_by": user.full_name,
            "created_at": now_iso(),
            "updated_at": now_iso(),
        })

    updated = await v3_col("weekly_assessments").find_one(
        {"lead_id": lead_id, "week_number": week_number}, {"_id": 0}
    )
    return updated
