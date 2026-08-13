from fastapi import APIRouter, HTTPException, Depends
from typing import Optional
from datetime import date, datetime, timedelta, timezone
import uuid

from database import v3_col
from utils import now_iso, normalize_slot_time
from security import hash_password
from deps import v3_require_roles
from schemas.v3 import (
    V3UserOut, V3CompleteSessionInput, V3AbsentSessionInput, V3JrPhysioWeeklyInput,
    V3CreateJrPhysioInput, V3LeadOut,
)

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

    leads = await v3_col("leads").find(
        {"assigned_physio_id": doctor["id"]}, {"_id": 0}
    ).sort("updated_at", -1).to_list(500)

    lead_ids = [l["id"] for l in leads]
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

    leads = await v3_col("leads").find(
        {"assigned_physio_id": doctor["id"]},
        {"_id": 0},
    ).sort("appointment_datetime", -1).to_list(500)

    # Treatment-day tallies, so the board can show "3 of 8 days" per patient without
    # a follow-up request for each one. Carried alongside the lead's own fields
    # (V3LeadOut ignores extras, so these are attached after dumping).
    lead_ids = [l["id"] for l in leads]
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

    assessments = await v3_col("weekly_assessments").find(
        {"lead_id": lead_id}, {"_id": 0}
    ).sort("week_number", 1).to_list(100)

    return {"sessions": sessions, "assessments": assessments}


async def _first_incomplete_before(session: dict):
    """The lowest day number before this one that is still not completed, or None.

    Ordered on session_number rather than on the date: a day that has been pushed by an
    absence carries a later date than the day after it until the shift is applied, and
    comparing dates would then call the sequence broken when it is not.
    """
    number = session.get("session_number") or 0
    rows = await v3_col("sessions").find(
        {"lead_id": session.get("lead_id"), "status": {"$ne": "completed"}},
        {"_id": 0, "session_number": 1},
    ).to_list(1000)
    earlier = [r.get("session_number") or 0 for r in rows if (r.get("session_number") or 0) < number]
    return min(earlier) if earlier else None


def _shift_slot_day(slot_time: str, days: int) -> str:
    """Move a slot to another date, keeping its time of day. Returns it untouched if it is
    not a slot this can read — a malformed value is not worth turning into a wrong date."""
    try:
        day_part, _, time_part = str(slot_time or "").partition("T")
        moved = date.fromisoformat(day_part) + timedelta(days=days)
        return f"{moved.isoformat()}T{time_part}" if time_part else moved.isoformat()
    except Exception:
        return slot_time


@router.post("/physio/sessions/{session_id}/absent")
async def physio_mark_absent(
    session_id: str,
    payload: V3AbsentSessionInput,
    user: V3UserOut = Depends(v3_require_roles("physio", "super_admin")),
):
    """The patient did not turn up, so the day moves rather than being lost.

    This day and every uncompleted day after it shift forward together. Moving only the
    missed one would land it on top of the next day already booked, and the package is a
    count of days of treatment — skipping one would quietly shorten it.

    The absence itself is kept on the session and written to the lead's activity, because
    the branch needs to see that a day was missed and when; the schedule moving on its own
    would otherwise be the only trace, and that reads as an admin error rather than a
    patient who did not arrive.
    """
    session = await v3_col("sessions").find_one({"id": session_id}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
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
    to_move = await v3_col("sessions").find(
        {"lead_id": session["lead_id"], "status": {"$ne": "completed"}},
        {"_id": 0, "id": 1, "session_number": 1, "slot_time": 1},
    ).to_list(1000)

    moved = 0
    for row in to_move:
        if (row.get("session_number") or 0) < number:
            continue
        await v3_col("sessions").update_one(
            {"id": row["id"]},
            {"$set": {"slot_time": _shift_slot_day(row.get("slot_time"), 1), "updated_at": now_iso()}},
        )
        moved += 1

    await v3_col("sessions").update_one(
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
            f" That day and {moved - 1} later day(s) moved on by one."
            + (f" Remarks: {payload.remarks.strip()}" if (payload.remarks or "").strip() else "")
        ),
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now_iso(),
    })

    updated = await v3_col("sessions").find_one({"id": session_id}, {"_id": 0})
    return {
        "session": updated,
        "moved": moved,
        "message": f"Day {number} marked absent — moved to {(updated or {}).get('slot_time', '').split('T')[0] or 'the next day'}",
    }


@router.post("/physio/sessions/{session_id}/complete")
async def physio_complete_session(
    session_id: str,
    payload: V3CompleteSessionInput,
    user: V3UserOut = Depends(v3_require_roles("physio", "super_admin")),
):
    session = await v3_col("sessions").find_one({"id": session_id}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session["status"] == "completed":
        raise HTTPException(status_code=400, detail="Session already completed")

    # Treatment runs in order. Day 5 being ticked off while Day 4 is still open means either
    # the wrong row was pressed or a day went unrecorded, and both are worth stopping here:
    # the day count drives the review milestones, so a gap in it quietly moves them.
    blocking = await _first_incomplete_before(session)
    if blocking is not None:
        raise HTTPException(
            status_code=400,
            detail=f"Day {blocking} has not been completed yet — treatment days are completed in order",
        )

    await v3_col("sessions").update_one(
        {"id": session_id},
        {"$set": {
            "status": "completed",
            "jr_physio_remarks": payload.remarks,
            # Who wrote the day's report. It was only ever in the activity log's prose,
            # which is not something the Head Physio's day-report view can read a name out
            # of. Rows completed before this stay blank rather than guessing.
            "completed_by": user.full_name,
            "completed_at": now_iso(),
            "updated_at": now_iso(),
        }},
    )

    activity = {
        "id": str(uuid.uuid4()),
        "lead_id": session["lead_id"],
        "action": "session_completed",
        "details": f"Session #{session.get('session_number', '?')} completed by {user.full_name}. Remarks: {payload.remarks}",
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now_iso(),
    }
    await v3_col("lead_activity").insert_one(activity.copy())

    updated = await v3_col("sessions").find_one({"id": session_id}, {"_id": 0})
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
