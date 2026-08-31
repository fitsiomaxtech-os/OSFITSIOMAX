"""Rehab — a course delivered by a physio, alongside that patient's treatment days.

The fourth thing a branch schedules, and the second one a *physio* delivers:

    Head Physio     -> consultation    -> `appointments`
    Physio          -> treatment days  -> `sessions`
    Nutrition Coach -> check-in days   -> `diet_sessions`
    Physio          -> rehab days      -> `rehab_sessions`   <- this file

Rehab is a parallel programme, not a later stage of treatment: a patient can be sent to
rehab having never bought a session package, and one who bought both runs the two courses
side by side. collect_rehab_fee makes the same point by refusing to touch
consultation_stage.

WHY rehab days live in their own collection rather than in `sessions` with a flag:

for the reason v3_diet's own docstring sets out at length, and which that module records
has already taken this OS down once. `sessions` is read in forty-odd places by physio_id
or lead_id with no filter on what kind of row it is. The sharpest is
v3_reviews._treatment_days, which counts a lead's completed rows to decide when a physio
is due a review — rehab days landing there would fire the week-one review three treatment
days early. The treatment-day grid ("Day 03/7"), the weekly assessments and the patient
portal all read it the same way. A separate collection makes that mistake impossible
rather than merely avoided.

What is deliberately shared is the physio's calendar. A rehab day is booked onto the same
published PHYSIO CALENDAR slot a treatment day would take, so the two cannot double-book
the same physio — see utils.physio_slot_load, which both assign endpoints count with,
and get_doctor_calendar, which the slot picker draws from.
"""

import uuid
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from database import v3_col
from deps import v3_require_roles
from schemas.v3 import V3LeadOut, V3UserOut
from utils import normalize_slot_time, now_iso, physio_slot_load, slot_capacity_of

router = APIRouter(prefix="/api/v3")


class AssignRehabInput(BaseModel):
    lead_id: str
    # A physio, not a separate rehab therapist: rehab is delivered on the treatment floor
    # by the same people, off the same published calendar, and lands on the same board.
    physio_id: str
    slot_times: List[str]


@router.post("/branch/assign-rehab")
async def assign_rehab(
    payload: AssignRehabInput,
    user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin")),
):
    """Put a paid-up rehab patient with a physio and date every day of their course.

    Mirrors assign-physio-sessions and assign-diet, including the two things both learned
    the hard way: this lead's own upcoming rehab days are cleared first so re-assigning
    does not clash with itself, and a slot is refused only once it is FULL rather than
    merely occupied — a physio treats two or three at once.
    """
    lead = await v3_col("leads").find_one({"id": payload.lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    # The fee is the gate, exactly as the Treatment Fee gates assign-physio-sessions.
    # Scheduling a course nobody has paid for puts days on a physio's calendar the branch
    # has no claim on.
    if lead.get("rehab_fee_paid") is None:
        raise HTTPException(status_code=400, detail="Collect the Rehab Fee first")

    physio = await v3_col("doctors").find_one(
        {"id": payload.physio_id, "profile_type": "physio"}, {"_id": 0}
    )
    if not physio:
        raise HTTPException(status_code=404, detail="Physio not found")

    slots = sorted({normalize_slot_time(s) for s in payload.slot_times})
    if not slots:
        raise HTTPException(status_code=400, detail="Pick at least one rehab day")
    if len(slots) != len(payload.slot_times):
        raise HTTPException(status_code=400, detail="Duplicate rehab times were submitted")
    # Only enforced when the course says how many days it is. A Rehab package entered
    # without a day count is scheduled to whatever was picked rather than refused — the
    # branch knows what it sold, and blocking here would strand a paid-up patient.
    expected = lead.get("rehab_package_sessions")
    if expected and len(slots) != expected:
        plural = "s" if expected > 1 else ""
        raise HTTPException(
            status_code=400,
            detail=f"Pick exactly {expected} rehab day{plural} (got {len(slots)})",
        )

    # This lead's own rehab days are discounted rather than deleted first. Deleting first
    # did answer the "a re-assignment must not clash with itself" problem, but it answered
    # it by destroying the course before anything had agreed to replace it: every refusal
    # below — a full slot, a clash — returned 400 with the patient's existing rehab days
    # already gone from the physio's calendar. Nothing is removed now until the whole
    # submission is known to be bookable.
    capacity = slot_capacity_of(physio)
    taken, lead_elsewhere = await physio_slot_load(
        payload.physio_id, slots, lead_id=payload.lead_id, replacing="rehab_sessions",
    )

    # The patient's own treatment days are the one thing a seat count cannot speak for.
    # They occupy a seat like anyone else's, but they also mean this patient is already
    # spoken for at that hour, so a free seat beside them is no use — checked first,
    # because "you have a treatment day here" is the answer the branch can act on and
    # "full" is not.
    clashing = sorted(s for s in slots if s in lead_elsewhere)
    if clashing:
        what = lead_elsewhere[clashing[0]]
        raise HTTPException(
            status_code=400,
            detail=f"{lead.get('name', 'This patient')} already has a {what} at: {', '.join(clashing)}",
        )

    full = sorted(s for s in slots if taken.get(s, 0) >= capacity)
    if full:
        raise HTTPException(
            status_code=400,
            detail=f"Full for this physio ({capacity} per slot): {', '.join(full)}",
        )

    # Past every refusal: the old course can go now, and the new one replaces it.
    await v3_col("rehab_sessions").delete_many({"lead_id": payload.lead_id, "status": "upcoming"})

    now = now_iso()
    docs = [{
        "id": str(uuid.uuid4()),
        "lead_id": payload.lead_id,
        "lead_name": lead.get("name", "Unknown"),
        "branch_id": lead.get("branch_id") or user.branch_id,
        "physio_id": physio["id"],
        "physio_name": physio["full_name"],
        "day_number": i + 1,
        "total_days": len(slots),
        "slot_time": slot_time,
        "status": "upcoming",
        "physio_remarks": "",
        # Filled in when the physio signs the day off, from the Super Admin catalogue.
        "physio_treatments": [],
        "created_at": now,
        "updated_at": now,
    } for i, slot_time in enumerate(slots)]
    await v3_col("rehab_sessions").insert_many([d.copy() for d in docs])

    day_word = "days" if len(slots) > 1 else "day"
    await v3_col("leads").update_one(
        {"id": payload.lead_id},
        {"$set": {
            "rehab_physio_id": physio["id"],
            "rehab_physio_name": physio["full_name"],
            "rehab_assigned_at": now,
            "rehab_stage": "Rehab Assigned",
            # Deliberately not consultation_stage. Rehab runs beside the physio pipeline,
            # and moving that pipeline as a side effect of a rehab booking would misreport
            # where the patient actually is — the same line collect_rehab_fee holds.
            "updated_at": now,
        }},
    )
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": payload.lead_id,
        "action": "rehab_assigned",
        "details": f"Rehab: {physio['full_name']} and {len(slots)} {day_word} booked",
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now,
    })

    updated = await v3_col("leads").find_one({"id": payload.lead_id}, {"_id": 0})
    return {
        "message": "Rehab assigned",
        "lead": V3LeadOut(**updated).model_dump(),
        "days_booked": len(docs),
        "physio_name": physio["full_name"],
    }


@router.get("/branch/rehab-sessions/{lead_id}")
async def rehab_sessions_for_lead(
    lead_id: str,
    _: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin", "physio", "head_physio")),
):
    """One patient's rehab course, in date order — what the branch booked and where it is."""
    rows = await v3_col("rehab_sessions").find(
        {"lead_id": lead_id}, {"_id": 0}
    ).sort("slot_time", 1).to_list(500)
    return {"sessions": rows}
