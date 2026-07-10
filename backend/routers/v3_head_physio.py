from fastapi import APIRouter, HTTPException, Depends
from typing import List, Optional

from database import v3_col
from utils import now_iso, normalize_slot_time
from deps import v3_require_roles
from schemas.v3 import (
    V3UserOut, V3DoctorOut,
    V3CalendarSlotsInput, V3RemoveSlotsInput,
)

router = APIRouter(prefix="/api/v3")


@router.get("/doctors/{doctor_id}/calendar")
async def get_doctor_calendar(doctor_id: str, _: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin", "head_physio"))):
    doctor = await v3_col("doctors").find_one({"id": doctor_id}, {"_id": 0})
    if not doctor:
        raise HTTPException(status_code=404, detail="Doctor not found")

    booked_rows = await v3_col("appointments").find(
        {"doctor_id": doctor_id, "status": "new_appointment"},
        {"_id": 0, "slot_time": 1, "lead_name": 1, "id": 1},
    ).to_list(1000)
    booked_map = {row["slot_time"]: row for row in booked_rows}

    return {
        "doctor_id": doctor["id"],
        "doctor_name": doctor["full_name"],
        "specialization": doctor.get("specialization", ""),
        "slots": doctor.get("slots", []),
        "slot_details": doctor.get("slot_details", []),
        "booked": booked_map,
    }


@router.post("/doctors/{doctor_id}/calendar-slots")
async def add_calendar_slots(doctor_id: str, payload: V3CalendarSlotsInput, _: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin"))):
    doctor = await v3_col("doctors").find_one({"id": doctor_id}, {"_id": 0})
    if not doctor:
        raise HTTPException(status_code=404, detail="Doctor not found")

    existing_slots = set(doctor.get("slots", []))
    existing_details = doctor.get("slot_details", [])
    existing_detail_map = {d["slot_time"]: d for d in existing_details}

    new_slot_times = []
    for slot in payload.slots:
        normalized = normalize_slot_time(slot.slot_time)
        new_slot_times.append(normalized)
        existing_detail_map[normalized] = {
            "slot_time": normalized,
            "duration": slot.duration,
            "consultation_type": slot.consultation_type,
        }

    all_slots = sorted(existing_slots.union(set(new_slot_times)))
    all_details = sorted(existing_detail_map.values(), key=lambda x: x["slot_time"])

    await v3_col("doctors").update_one(
        {"id": doctor_id},
        {"$set": {"slots": all_slots, "slot_details": all_details}},
    )

    updated = await v3_col("doctors").find_one({"id": doctor_id}, {"_id": 0})
    return {
        "doctor_id": doctor_id,
        "slots_count": len(all_slots),
        "slots": updated.get("slots", []),
        "slot_details": updated.get("slot_details", []),
    }


@router.post("/doctors/{doctor_id}/remove-slots")
async def remove_calendar_slots(doctor_id: str, payload: V3RemoveSlotsInput, _: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin"))):
    doctor = await v3_col("doctors").find_one({"id": doctor_id}, {"_id": 0})
    if not doctor:
        raise HTTPException(status_code=404, detail="Doctor not found")

    normalized_remove = {normalize_slot_time(s) for s in payload.slot_times}

    booked = await v3_col("appointments").find(
        {"doctor_id": doctor_id, "status": "new_appointment", "slot_time": {"$in": list(normalized_remove)}},
        {"_id": 0, "slot_time": 1},
    ).to_list(100)
    booked_times = {b["slot_time"] for b in booked}
    blocked = normalized_remove.intersection(booked_times)
    if blocked:
        raise HTTPException(status_code=400, detail=f"Cannot remove booked slots: {', '.join(sorted(blocked))}")

    remaining_slots = [s for s in doctor.get("slots", []) if s not in normalized_remove]
    remaining_details = [d for d in doctor.get("slot_details", []) if d["slot_time"] not in normalized_remove]

    await v3_col("doctors").update_one(
        {"id": doctor_id},
        {"$set": {"slots": remaining_slots, "slot_details": remaining_details}},
    )

    return {"doctor_id": doctor_id, "removed": len(normalized_remove - booked_times), "remaining_slots": len(remaining_slots)}
