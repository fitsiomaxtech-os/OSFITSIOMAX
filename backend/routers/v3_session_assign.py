from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
import uuid

from database import v3_col
from utils import now_iso, normalize_slot_time, slot_capacity_of
from deps import v3_require_roles
from schemas.v3 import V3UserOut, V3AssignSessionsInput

router = APIRouter(prefix="/api/v3")


@router.get("/branch/package-recommendations")
async def get_recommendations(user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin"))):
    query = {}
    if user.branch_id:
        query["branch_id"] = user.branch_id

    recs = await v3_col("package_recommendations").find(query, {"_id": 0}).sort("created_at", -1).to_list(500)

    lead_ids = [r["lead_id"] for r in recs]
    leads = await v3_col("leads").find({"id": {"$in": lead_ids}}, {"_id": 0}).to_list(500)
    lead_map = {l["id"]: l for l in leads}

    for rec in recs:
        lead = lead_map.get(rec["lead_id"], {})
        rec["lead_phone"] = lead.get("phone", "")
        rec["lead_email"] = lead.get("email", "")
        rec["branch_stage"] = lead.get("branch_stage", "")
        rec["package_amount"] = lead.get("package_amount")

    return {"recommendations": recs}


@router.post("/branch/assign-sessions")
async def assign_sessions(
    payload: V3AssignSessionsInput,
    user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin")),
):
    lead = await v3_col("leads").find_one({"id": payload.lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    physio = await v3_col("doctors").find_one({"id": payload.physio_id}, {"_id": 0})
    if not physio:
        raise HTTPException(status_code=404, detail="Jr. Physio not found")

    rec = await v3_col("package_recommendations").find_one({"lead_id": payload.lead_id}, {"_id": 0})

    total = len(payload.slot_times)
    sessions_to_create = []

    for i, slot_time in enumerate(payload.slot_times):
        normalized = normalize_slot_time(slot_time)
        week_num = (i // (rec["sessions_per_week"] if rec else 3)) + 1

        session = {
            "id": str(uuid.uuid4()),
            "lead_id": payload.lead_id,
            "lead_name": lead.get("name", "Unknown"),
            "branch_id": lead.get("branch_id") or user.branch_id,
            "physio_id": payload.physio_id,
            "physio_name": physio["full_name"],
            "head_physio_id": rec.get("head_physio_id", "") if rec else "",
            "head_physio_name": rec.get("head_physio_name", "") if rec else "",
            "session_number": i + 1,
            "total_sessions": total,
            "week_number": week_num,
            "slot_time": normalized,
            "status": "upcoming",
            "jr_physio_remarks": "",
            "created_at": now_iso(),
            "updated_at": now_iso(),
        }
        sessions_to_create.append(session)

    if sessions_to_create:
        await v3_col("sessions").insert_many([s.copy() for s in sessions_to_create])

    await v3_col("leads").update_one(
        {"id": payload.lead_id},
        {"$set": {
            "assigned_physio_id": payload.physio_id,
            "assigned_physio_name": physio["full_name"],
            "physio_assigned_at": now_iso(),
            "branch_stage": "Assigned Physio",
            "updated_at": now_iso(),
        }},
    )

    if rec:
        await v3_col("package_recommendations").update_one(
            {"id": rec["id"]},
            {"$set": {"status": "assigned"}},
        )

    patient_token = str(uuid.uuid4())
    await v3_col("patient_tokens").update_one(
        {"lead_id": payload.lead_id},
        {"$set": {"lead_id": payload.lead_id, "token": patient_token, "created_at": now_iso()}},
        upsert=True,
    )

    activity = {
        "id": str(uuid.uuid4()),
        "lead_id": payload.lead_id,
        "action": "sessions_assigned",
        "details": f"{total} sessions assigned to {physio['full_name']}",
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now_iso(),
    }
    await v3_col("lead_activity").insert_one(activity.copy())

    return {
        "sessions_created": total,
        "physio_name": physio["full_name"],
        "patient_token": patient_token,
        "lead_id": payload.lead_id,
    }


# ------------------------------------------- Treatment days left without a date by an absence
#
# Marking a patient absent steps every later day down into the slot in front of it, which
# leaves the last day of the course with nowhere to go. It is flagged needs_assignment and
# lands here: the Physio can move days along the slots already bought, but only the Branch
# Admin puts a day onto the physio's published calendar, which is where it came from in the
# first place. Until this is done the patient is a day short of the package they paid for.


class ScheduleSessionInput(BaseModel):
    slot_time: str


@router.get("/branch/sessions/unscheduled")
async def unscheduled_sessions(user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin"))):
    """Treatment days waiting on a date, oldest patient first."""
    query: dict = {"needs_assignment": True, "status": {"$ne": "completed"}}
    if user.branch_id:
        query["branch_id"] = user.branch_id

    rows = await v3_col("sessions").find(query, {"_id": 0}).to_list(500)
    rows.sort(key=lambda s: (s.get("lead_name") or "", s.get("session_number") or 0))

    # The absence that caused this is what the Branch Admin needs to read to place the day —
    # who missed, when, and what the physio wrote. It sits on the session that was missed,
    # not on the one left dateless, so the two are matched up by lead here.
    lead_ids = list({s.get("lead_id") for s in rows if s.get("lead_id")})

    # A session carries the patient's name but not their patient number, and the number is
    # how the branch actually identifies someone on the phone.
    leads = await v3_col("leads").find(
        {"id": {"$in": lead_ids}}, {"_id": 0, "id": 1, "patient_number": 1, "phone": 1},
    ).to_list(500)
    lead_map = {l["id"]: l for l in leads}

    missed = await v3_col("sessions").find(
        {"lead_id": {"$in": lead_ids}, "absences": {"$exists": True, "$ne": []}},
        {"_id": 0, "lead_id": 1, "session_number": 1, "absences": 1},
    ).to_list(1000)
    latest_absence: dict = {}
    for row in missed:
        for ab in row.get("absences") or []:
            current = latest_absence.get(row["lead_id"])
            if not current or (ab.get("marked_at") or "") > (current.get("marked_at") or ""):
                latest_absence[row["lead_id"]] = {**ab, "session_number": row.get("session_number")}

    for s in rows:
        s["last_absence"] = latest_absence.get(s.get("lead_id"))
        lead = lead_map.get(s.get("lead_id"), {})
        s["patient_number"] = lead.get("patient_number", "")
        s["phone"] = lead.get("phone", "")

    return {"sessions": rows}


@router.post("/branch/sessions/{session_id}/schedule")
async def schedule_session(
    session_id: str,
    payload: ScheduleSessionInput,
    user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin")),
):
    """Put a dateless treatment day onto one of its physio's published slots."""
    session = await v3_col("sessions").find_one({"id": session_id}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.get("status") == "completed":
        raise HTTPException(status_code=400, detail="This day is already completed")

    slot = normalize_slot_time(payload.slot_time)
    if not slot:
        raise HTTPException(status_code=400, detail="Pick a date and time for this day")

    physio = await v3_col("doctors").find_one({"id": session.get("physio_id")}, {"_id": 0})
    if not physio:
        raise HTTPException(status_code=404, detail="This day's physio is no longer on record")

    # Refused rather than accepted quietly: a day placed on a time the physio never opened
    # shows on nobody's calendar, and the patient is turned away twice over the same absence.
    if slot not in (physio.get("slots") or []):
        raise HTTPException(
            status_code=400,
            detail="That time isn't published by this physio — open it in MANAGEMENT → PHYSIO CALENDAR first",
        )

    capacity = slot_capacity_of(physio)
    taken = await v3_col("sessions").count_documents({
        "physio_id": session.get("physio_id"),
        "slot_time": slot,
        "status": {"$ne": "completed"},
        "id": {"$ne": session_id},
    })
    if taken >= capacity:
        raise HTTPException(status_code=409, detail=f"That slot is full — it already holds {taken} of {capacity}")

    await v3_col("sessions").update_one(
        {"id": session_id},
        {"$set": {"slot_time": slot, "needs_assignment": False, "updated_at": now_iso()}},
    )

    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": session.get("lead_id"),
        "action": "session_rescheduled",
        "details": (
            f"Day {session.get('session_number')} was left without a date by an absence and has been"
            f" booked for {slot.replace('T', ' at ')} with {physio.get('full_name', 'the physio')}."
        ),
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now_iso(),
    })

    updated = await v3_col("sessions").find_one({"id": session_id}, {"_id": 0})
    return {"session": updated}
