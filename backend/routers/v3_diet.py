"""Diet Consultation — the third service vertical, alongside Consultations and Sessions.

Shaped deliberately like the physio side, because it is the same pattern a third time:

    Head Physio  -> consultation      -> `appointments`
    Physio       -> treatment days    -> `sessions`
    Nutrition Coach -> check-in days  -> `diet_sessions`     <- this file

One Nutrition Coach does both halves — the diet consultation AND the check-in days that
follow it. That is the one place diet departs from physio, where a senior consults and a
junior delivers. It has a consequence: there is no senior above the coach, so there is no
review chain here, and none is faked.

WHY diet check-ins live in their own collection, not in `sessions` with a discriminator:

`sessions` is read in several places by physio_id or lead_id with no filter on what kind
of session a row is. The clearest is v3_reviews._treatment_days, which counts every
completed row for a lead to decide when a physio is due a review — diet rows landing there
would fire a physio's week-one review after four physio days and three diet check-ins. The
physio calendar, the treatment-day grid and the Physio Master View counts read it the same
way. Adding a `track` field would mean auditing every one of those and every query written
after today. A separate collection makes that mistake impossible rather than merely
avoided, which matters because v3_reviews' own module docstring records that this exact
class of mistake in this exact collection has already taken the OS down once.
"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timezone
import uuid

from database import v3_col
from utils import now_iso, normalize_slot_time, slot_capacity_of
from security import hash_password
from deps import v3_require_roles, v3_require_diet, is_diet_role
from schemas.v3 import V3UserOut

router = APIRouter(prefix="/api/v3")

COACH = "nutrition_coach"


async def _resolve_coach(user: V3UserOut, coach_id: Optional[str] = None) -> Optional[dict]:
    """The doctors record for the logged-in Nutrition Coach.

    Same three-step resolution the physio board uses: a coach created here is linked by
    user_id, one hired through HR is linked only by employee_id, and Super Admin driving a
    specific coach's board passes the id outright — a branch can have several coaches, so
    branch_id alone would not disambiguate.

    If none of those find one, it creates it. That is a write in a read path and is
    deliberate: the record is derived — a calendar holder, not business data — and its
    absence is a setup gap the coach cannot fix from any screen they can reach. Anyone
    hired under a diet role before HR knew to create one logs in to a permanently empty
    board otherwise, which is exactly what happened to this install's diet_manage user.
    """
    if coach_id and user.role == "super_admin":
        doctor = await v3_col("doctors").find_one({"id": coach_id, "profile_type": COACH}, {"_id": 0})
        if doctor:
            return doctor
    doctor = await v3_col("doctors").find_one({"user_id": user.id, "profile_type": COACH}, {"_id": 0})
    if doctor:
        return doctor
    raw = await v3_col("users").find_one({"id": user.id}, {"_id": 0, "employee_id": 1, "branch_id": 1, "full_name": 1})
    if raw and raw.get("employee_id"):
        doctor = await v3_col("doctors").find_one(
            {"employee_id": raw["employee_id"], "profile_type": COACH}, {"_id": 0}
        )
        if doctor:
            return doctor

    if not is_diet_role(user.role) or user.role == "super_admin":
        return None
    doctor = {
        "id": str(uuid.uuid4()),
        "user_id": user.id,
        "full_name": user.full_name or (raw or {}).get("full_name", ""),
        "profile_type": COACH,
        "branch_id": user.branch_id or (raw or {}).get("branch_id"),
        "specialization": "",
        "slots": [],
        "slot_details": [],
        "created_at": now_iso(),
    }
    await v3_col("doctors").insert_one(doctor.copy())
    doctor.pop("_id", None)
    return doctor


# ============ Branch Admin: staffing ============

class CreateCoachInput(BaseModel):
    full_name: str
    email: str
    password: str
    specialization: Optional[str] = ""


@router.post("/branch/nutrition-coaches")
async def create_nutrition_coach(
    payload: CreateCoachInput,
    user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin")),
):
    """A coach is two records that must both exist: a `users` row so they can log in, and a
    `doctors` row so they can hold a calendar. Created together and linked by user_id, so
    neither can be left orphaned by a half-finished setup."""
    branch_id = user.branch_id
    if not branch_id:
        raise HTTPException(status_code=400, detail="No branch assigned")

    email = payload.email.lower().strip()
    if await v3_col("users").find_one({"email": email}, {"_id": 0, "id": 1}):
        raise HTTPException(status_code=409, detail="User with this email already exists")

    user_id = str(uuid.uuid4())
    doctor_id = str(uuid.uuid4())
    now = now_iso()

    await v3_col("users").insert_one({
        "id": user_id,
        "full_name": payload.full_name.strip(),
        "email": email,
        "password": hash_password(payload.password),
        "role": COACH,
        "branch_id": branch_id,
        "is_active": True,
        "created_at": now,
    })
    await v3_col("doctors").insert_one({
        "id": doctor_id,
        "user_id": user_id,
        "full_name": payload.full_name.strip(),
        "profile_type": COACH,
        "branch_id": branch_id,
        "specialization": (payload.specialization or "").strip(),
        "slots": [],
        "slot_details": [],
        "created_at": now,
    })
    return {"user_id": user_id, "doctor_id": doctor_id, "full_name": payload.full_name.strip()}


@router.get("/branch/nutrition-coaches")
async def list_nutrition_coaches(user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin", COACH))):
    query = {"profile_type": COACH}
    if user.branch_id:
        query["branch_id"] = user.branch_id
    coaches = await v3_col("doctors").find(query, {"_id": 0}).sort("full_name", 1).to_list(200)
    return {"coaches": coaches}


# ============ Branch Admin: putting a patient on a diet plan ============

class AssignDietInput(BaseModel):
    lead_id: str
    coach_id: str
    slot_times: List[str]


@router.post("/branch/assign-diet")
async def assign_diet(
    payload: AssignDietInput,
    user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin")),
):
    """Put a patient with a Nutrition Coach and book their check-in days.

    Mirrors assign-physio-sessions, including the two things that flow learned the hard
    way: this lead's own upcoming days are cleared first so a re-assignment doesn't clash
    with itself, and a slot is refused only once it is FULL rather than merely occupied.
    """
    lead = await v3_col("leads").find_one({"id": payload.lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    coach = await v3_col("doctors").find_one({"id": payload.coach_id, "profile_type": COACH}, {"_id": 0})
    if not coach:
        raise HTTPException(status_code=404, detail="Nutrition Coach not found")

    slots = sorted({normalize_slot_time(s) for s in payload.slot_times})
    if not slots:
        raise HTTPException(status_code=400, detail="Pick at least one check-in day")
    if len(slots) != len(payload.slot_times):
        raise HTTPException(status_code=400, detail="Duplicate check-in times were submitted")

    # Cleared before the conflict check, or this lead's own existing days would read as a
    # clash against themselves on a re-assignment.
    await v3_col("diet_sessions").delete_many({"lead_id": payload.lead_id, "status": "upcoming"})

    capacity = slot_capacity_of(coach)
    booked = await v3_col("diet_sessions").find(
        {"coach_id": payload.coach_id, "status": "upcoming", "slot_time": {"$in": slots}},
        {"_id": 0, "slot_time": 1},
    ).to_list(1000)
    taken: dict = {}
    for b in booked:
        taken[b["slot_time"]] = taken.get(b["slot_time"], 0) + 1
    full = sorted(s for s in slots if taken.get(s, 0) >= capacity)
    if full:
        raise HTTPException(
            status_code=400,
            detail=f"Full for this coach ({capacity} per slot): {', '.join(full)}",
        )

    now = now_iso()
    docs = [{
        "id": str(uuid.uuid4()),
        "lead_id": payload.lead_id,
        "lead_name": lead.get("name", "Unknown"),
        "branch_id": lead.get("branch_id") or user.branch_id,
        "coach_id": coach["id"],
        "coach_name": coach["full_name"],
        "day_number": i + 1,
        "total_days": len(slots),
        "slot_time": slot_time,
        "status": "upcoming",
        "coach_remarks": "",
        "weight_kg": None,
        "created_at": now,
        "updated_at": now,
    } for i, slot_time in enumerate(slots)]
    await v3_col("diet_sessions").insert_many([d.copy() for d in docs])

    await v3_col("leads").update_one(
        {"id": payload.lead_id},
        {"$set": {
            "diet_coach_id": coach["id"],
            "diet_coach_name": coach["full_name"],
            "diet_assigned_at": now,
            "diet_stage": "Diet Plan Assigned",
            # Set here as well as by the Head Physio's decision, because /diet/consultations
            # reads this flag as "is in the diet vertical". A patient the branch books onto
            # a plan afterwards — asked for one later, or was referred by phone — would
            # otherwise hold check-in days with the coach while being absent from the very
            # queue that lists who those days belong to.
            "diet_recommended": True,
            "updated_at": now,
        }},
    )
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": payload.lead_id,
        "action": "diet_coach_assigned",
        "details": f"{coach['full_name']} assigned with {len(slots)} check-in days",
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now,
    })
    return {"days_booked": len(docs), "coach_name": coach["full_name"]}


class DietAppointmentInput(BaseModel):
    lead_id: str
    coach_id: str
    slot_time: str  # "YYYY-MM-DDTHH:MM"


@router.post("/branch/diet-appointment")
async def book_diet_appointment(
    payload: DietAppointmentInput,
    user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin")),
):
    """Book the Diet Consultation — one appointment on the coach's calendar.

    Diet is a consultation vertical, the same shape as a Head Physio consultation and not
    the same shape as a course of treatment: the Nutrition Coach sees the patient once to
    read them and set a plan. So this books ONE slot, and it lands in the shared
    `appointments` collection with appt_kind="diet", exactly the way
    v3_consult_appointments books a Head Physio's. That is what makes it show up on the
    coach's own calendar without a second mechanism to keep in step.

    Two rules this deliberately does not enforce, because the branch decides them:

    Diet normally follows treatment, but a patient can come for a diet consultation and
    nothing else — so this never requires a physio assignment or a treatment package.

    And it is never compulsory: nothing here reads or requires `diet_recommended`. The flag
    is set as a RESULT of booking, so the coach's queue agrees with the booking whether the
    Head Physio recommended diet on the day or the patient asked for it a week later.

    What it must never do is touch `stage`, `branch_stage` or `consultation_stage`. The
    generic book-appointment endpoint resets a lead to the first sales stage, which for a
    patient already at Fee Collected would throw away their whole consultation. That is
    why this is its own endpoint rather than a reuse of that one.
    """
    lead = await v3_col("leads").find_one({"id": payload.lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    coach = await v3_col("doctors").find_one({"id": payload.coach_id, "profile_type": COACH}, {"_id": 0})
    if not coach:
        raise HTTPException(status_code=404, detail="Nutrition Coach not found")

    slot = normalize_slot_time(payload.slot_time)
    if slot not in (coach.get("slots") or []):
        raise HTTPException(
            status_code=400,
            detail="That time isn't published on this coach's calendar. Open it in MANAGEMENT > DIET CALENDAR first.",
        )

    # This lead's own earlier booking is cancelled before the clash check, or re-booking
    # them into the same slot would read as a clash against themselves.
    await v3_col("appointments").update_many(
        {"lead_id": payload.lead_id, "appt_kind": "diet", "status": "new_appointment"},
        {"$set": {"status": "cancelled", "updated_at": now_iso()}},
    )

    clash = await v3_col("appointments").find_one(
        {"doctor_id": payload.coach_id, "slot_time": slot, "status": "new_appointment"},
        {"_id": 0, "lead_name": 1},
    )
    if clash:
        raise HTTPException(
            status_code=409,
            detail=f"This coach is already booked at that time ({clash.get('lead_name') or 'another patient'})",
        )

    date_part, _, time_part = slot.partition("T")
    now = now_iso()
    appt = {
        "id": str(uuid.uuid4()),
        "lead_id": payload.lead_id,
        "lead_name": lead.get("name", "Unknown"),
        "patient_name": lead.get("name", "Unknown"),
        "branch_id": lead.get("branch_id") or coach.get("branch_id") or user.branch_id,
        "doctor_id": coach["id"],
        "doctor_name": coach["full_name"],
        "appointment_date": date_part,
        "appointment_time": time_part,
        "slot_time": slot,
        "status": "new_appointment",
        "appt_kind": "diet",
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now,
        "updated_at": now,
    }
    await v3_col("appointments").insert_one(appt.copy())

    await v3_col("leads").update_one(
        {"id": payload.lead_id},
        {"$set": {
            "diet_coach_id": coach["id"],
            "diet_coach_name": coach["full_name"],
            "diet_appointment_at": slot,
            "diet_stage": "Diet Consultation Booked",
            "diet_recommended": True,
            "updated_at": now,
        }},
    )
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": payload.lead_id,
        "action": "diet_appointment_booked",
        "details": f"Diet Consultation with {coach['full_name']} on {date_part} at {time_part}",
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now,
    })
    return {"appointment": appt, "coach_name": coach["full_name"], "slot_time": slot}


class DietReportInput(BaseModel):
    report: str


@router.post("/diet/consultation-report/{lead_id}")
async def save_diet_consultation_report(
    lead_id: str,
    payload: DietReportInput,
    user: V3UserOut = Depends(v3_require_diet),
):
    """What the Nutrition Coach concluded at the Diet Consultation.

    The diet vertical's counterpart to the Head Physio's diagnosis report: one piece of
    written advice per patient, replaced rather than appended to, because it is the current
    plan and not a log. The per-visit notes are `coach_remarks` on each check-in day.

    Written by the coach alone. Branch Admin books and collects; what the plan says is a
    clinical judgement and nobody else's to author.
    """
    text = (payload.report or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="The report cannot be empty")

    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0, "id": 1, "name": 1})
    if not lead:
        raise HTTPException(status_code=404, detail="Patient not found")

    now = now_iso()
    await v3_col("leads").update_one(
        {"id": lead_id},
        {"$set": {
            "diet_consultation_report": text,
            "diet_consultation_report_at": now,
            "diet_consultation_report_by": user.full_name,
            "updated_at": now,
        }},
    )
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "diet_consultation_report_saved",
        "details": "Diet Consultation report written",
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now,
    })
    return {"report": text, "saved_at": now, "saved_by": user.full_name}


@router.get("/branch/diet-patients")
async def branch_diet_patients(user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin"))):
    """Everyone at this branch already on a diet plan, for the Branch Admin's own view."""
    query = {"diet_coach_id": {"$nin": [None, ""]}}
    if user.branch_id:
        query["branch_id"] = user.branch_id
    leads = await v3_col("leads").find(
        query, {"_id": 0, "id": 1, "name": 1, "phone": 1, "diet_coach_id": 1, "diet_coach_name": 1, "diet_stage": 1}
    ).sort("updated_at", -1).to_list(500)
    lead_ids = [l["id"] for l in leads]
    rows = await v3_col("diet_sessions").find({"lead_id": {"$in": lead_ids}}, {"_id": 0}).to_list(5000)
    by_lead: dict = {}
    for r in rows:
        by_lead.setdefault(r["lead_id"], []).append(r)
    for l in leads:
        days = by_lead.get(l["id"], [])
        l["total_days"] = len(days)
        l["completed_days"] = sum(1 for d in days if d.get("status") == "completed")
    return {"patients": leads}


# ============ The Nutrition Coach's own board ============

@router.get("/diet/consultations")
async def diet_consultations(coach_id: Optional[str] = None, user: V3UserOut = Depends(v3_require_diet)):
    """Patients coming in for a Diet Consultation.

    The list is everyone the Head Physio referred — `diet_recommended` set on their
    consultation decision — at this coach's branch. That flag IS the referral: it is set
    at the moment the Head Physio decides, and nothing else in the OS records the
    intention, so reading anything else here would mean the coach's queue disagreeing
    with the decision that filled it.

    Already-assigned patients stay in the list rather than disappearing, marked as such.
    A coach needs to see who they have seen as well as who is waiting, and a queue that
    empties itself gives no way to check the day's work.
    """
    coach = await _resolve_coach(user, coach_id)
    if not coach:
        return {"patients": []}

    query = {"diet_recommended": True}
    if coach.get("branch_id"):
        query["branch_id"] = coach["branch_id"]
    leads = await v3_col("leads").find(query, {"_id": 0}).sort("updated_at", -1).to_list(500)

    lead_ids = [l["id"] for l in leads]
    booked = await v3_col("diet_sessions").find(
        {"lead_id": {"$in": lead_ids}}, {"_id": 0, "lead_id": 1, "status": 1}
    ).to_list(5000)
    days_by_lead: dict = {}
    for d in booked:
        row = days_by_lead.setdefault(d["lead_id"], {"total": 0, "done": 0})
        row["total"] += 1
        if d.get("status") == "completed":
            row["done"] += 1

    # The DIET consultation's own appointment. The lead's appointment_date/_time are the
    # Head Physio's consultation — reading those here had the coach's queue showing every
    # patient at the time they saw the physio, which is not when the coach sees them.
    diet_appts = await v3_col("appointments").find(
        {"lead_id": {"$in": lead_ids}, "appt_kind": "diet", "status": {"$ne": "cancelled"}},
        {"_id": 0, "lead_id": 1, "slot_time": 1, "status": 1, "doctor_name": 1},
    ).sort("slot_time", 1).to_list(2000)
    appt_by_lead = {a["lead_id"]: a for a in diet_appts}

    out = []
    for l in leads:
        days = days_by_lead.get(l["id"], {"total": 0, "done": 0})
        appt = appt_by_lead.get(l["id"])
        appt_date, _, appt_time = (appt or {}).get("slot_time", "").partition("T")
        out.append({
            "lead_id": l["id"],
            "lead_name": l.get("name", "Unknown"),
            "phone": l.get("phone", ""),
            "patient_number": l.get("patient_number", ""),
            "appointment_date": appt_date or None,
            "appointment_time": appt_time or None,
            "appointment_status": (appt or {}).get("status"),
            "booked": bool(appt),
            # What the Head Physio sent them here with, so the coach can see at a glance
            # whether this patient is also on a physio course.
            "consultation_decision": l.get("consultation_decision"),
            "diet_stage": l.get("diet_stage"),
            "diet_coach_name": l.get("diet_coach_name"),
            # So the coach's queue shows who has been written up and who has not.
            "diet_consultation_report": l.get("diet_consultation_report"),
            "assigned": bool(l.get("diet_coach_id")),
            "total_days": days["total"],
            "completed_days": days["done"],
            "updated_at": l.get("updated_at"),
        })
    return {"patients": out}

@router.get("/diet/today")
async def diet_today(coach_id: Optional[str] = None, user: V3UserOut = Depends(v3_require_diet)):
    coach = await _resolve_coach(user, coach_id)
    if not coach:
        return {"days": [], "coach_id": None, "coach_name": ""}
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    days = await v3_col("diet_sessions").find(
        {"coach_id": coach["id"], "slot_time": {"$regex": f"^{today}"}}, {"_id": 0}
    ).sort("slot_time", 1).to_list(200)
    return {"days": days, "coach_id": coach["id"], "coach_name": coach["full_name"]}


@router.get("/diet/calendar")
async def diet_calendar(
    month: Optional[int] = None,
    year: Optional[int] = None,
    coach_id: Optional[str] = None,
    user: V3UserOut = Depends(v3_require_diet),
):
    coach = await _resolve_coach(user, coach_id)
    if not coach:
        return {"days": [], "slots": [], "slot_details": []}
    now = datetime.now(timezone.utc)
    prefix = f"{year or now.year}-{str(month or now.month).zfill(2)}"
    days = await v3_col("diet_sessions").find(
        {"coach_id": coach["id"], "slot_time": {"$regex": f"^{prefix}"}}, {"_id": 0}
    ).sort("slot_time", 1).to_list(500)
    return {
        "days": days,
        "slots": coach.get("slots", []),
        "slot_details": coach.get("slot_details", []),
        "coach_id": coach["id"],
        "coach_name": coach["full_name"],
    }


@router.get("/diet/patients")
async def diet_patients(coach_id: Optional[str] = None, user: V3UserOut = Depends(v3_require_diet)):
    """Every patient assigned to this coach, whether or not their days are booked yet —
    same reasoning as the physio board: a patient who has just been assigned should appear
    immediately rather than only once a plan exists."""
    coach = await _resolve_coach(user, coach_id)
    if not coach:
        return {"patients": []}
    leads = await v3_col("leads").find(
        {"diet_coach_id": coach["id"]}, {"_id": 0}
    ).sort("updated_at", -1).to_list(500)
    lead_ids = [l["id"] for l in leads]
    rows = await v3_col("diet_sessions").find(
        {"coach_id": coach["id"], "lead_id": {"$in": lead_ids}}, {"_id": 0}
    ).sort("slot_time", 1).to_list(5000)
    by_lead: dict = {}
    for r in rows:
        by_lead.setdefault(r["lead_id"], []).append(r)

    patients = []
    for lead in leads:
        days = by_lead.get(lead["id"], [])
        completed = sum(1 for d in days if d.get("status") == "completed")
        patients.append({
            "lead_id": lead["id"],
            "lead_name": lead.get("name", "Unknown"),
            "phone": lead.get("phone", ""),
            "total_days": len(days),
            "completed_days": completed,
            "remaining_days": len(days) - completed,
            "next_day": next((d for d in days if d.get("status") == "upcoming"), None),
            "diet_stage": lead.get("diet_stage"),
            "updated_at": lead.get("updated_at"),
        })
    return {"patients": patients}


@router.get("/diet/sessions/{lead_id}")
async def diet_sessions_for_lead(
    lead_id: str,
    _: V3UserOut = Depends(v3_require_roles(COACH, "branch_admin", "super_admin", "head_physio")),
):
    days = await v3_col("diet_sessions").find({"lead_id": lead_id}, {"_id": 0}).sort("slot_time", 1).to_list(500)
    return {"days": days}


class CompleteDayInput(BaseModel):
    coach_remarks: Optional[str] = ""
    weight_kg: Optional[float] = None


@router.post("/diet/sessions/{session_id}/complete")
async def complete_diet_day(
    session_id: str,
    payload: CompleteDayInput,
    user: V3UserOut = Depends(v3_require_diet),
):
    day = await v3_col("diet_sessions").find_one({"id": session_id}, {"_id": 0})
    if not day:
        raise HTTPException(status_code=404, detail="Check-in day not found")
    if day.get("status") == "completed":
        raise HTTPException(status_code=400, detail="This check-in is already completed")

    now = now_iso()
    await v3_col("diet_sessions").update_one(
        {"id": session_id},
        {"$set": {
            "status": "completed",
            "coach_remarks": (payload.coach_remarks or "").strip(),
            "weight_kg": payload.weight_kg,
            "completed_at": now,
            "updated_at": now,
        }},
    )
    remaining = await v3_col("diet_sessions").count_documents(
        {"lead_id": day["lead_id"], "status": "upcoming"}
    )
    # The plan closes itself on the last check-in rather than waiting for someone to
    # remember to close it — the same way a treatment course ends.
    if remaining == 0:
        await v3_col("leads").update_one(
            {"id": day["lead_id"]},
            {"$set": {"diet_stage": "Diet Completed", "updated_at": now}},
        )
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": day["lead_id"],
        "action": "diet_checkin_completed",
        "details": f"Check-in day {day.get('day_number')} of {day.get('total_days')} completed"
                   + (f" · {payload.weight_kg} kg" if payload.weight_kg is not None else ""),
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now,
    })
    return {"status": "completed", "remaining": remaining}
