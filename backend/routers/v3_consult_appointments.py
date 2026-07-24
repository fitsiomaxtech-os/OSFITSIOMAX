"""Consultation Appointment Scheduling — fully managed by the Branch Admin from
the Branch Admin > Calendar > Schedule view.

The Branch Admin books a consultation between a client and a Head Physio,
choosing date/time/physio. Availability is derived from the branch's working
hours (weekly_hours) and holidays configured in Super Admin > Branch Management;
double-booking a Head Physio is prevented. Appointments live in the shared
`appointments` collection (status="new_appointment", appt_kind="consultation")
so they automatically surface on the Head Physio's own calendar too.
"""
from fastapi import APIRouter, HTTPException, Depends
from typing import Optional
from pydantic import BaseModel
from datetime import datetime
import uuid

from database import v3_col
from utils import now_iso, normalize_slot_time
from deps import v3_require_roles
from schemas.v3 import V3UserOut

router = APIRouter(prefix="/api/v3")

_DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]  # Mon=0 .. Sun=6


class ConsultApptCreate(BaseModel):
    patient_name: str
    doctor_id: str
    date: str   # YYYY-MM-DD
    time: str   # HH:MM
    duration: Optional[int] = 30
    lead_id: Optional[str] = None


class ConsultApptUpdate(BaseModel):
    patient_name: Optional[str] = None
    doctor_id: Optional[str] = None
    date: Optional[str] = None
    time: Optional[str] = None
    duration: Optional[int] = None


def _day_key(date_str: str) -> Optional[str]:
    try:
        return _DAY_KEYS[datetime.strptime(date_str, "%Y-%m-%d").weekday()]
    except Exception:
        return None


async def _get_branch(branch_id: str) -> dict:
    branch = await v3_col("branches").find_one({"id": branch_id}, {"_id": 0})
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")
    return branch


async def _get_head_physio(doctor_id: str) -> dict:
    doc = await v3_col("doctors").find_one({"id": doctor_id, "profile_type": "head_physio"}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Head Physio not found")
    return doc


def _hours_for(branch: dict, date_str: str):
    """(is_open, open_time, close_time, reason). reason is set only when closed."""
    if date_str in (branch.get("holidays") or []):
        return (False, None, None, "This date is a branch holiday")
    key = _day_key(date_str)
    if key is None:
        return (False, None, None, "Invalid date")
    cfg = (branch.get("weekly_hours") or {}).get(key)
    if cfg is None:
        return (True, "09:00", "20:00", None)  # no config → default open
    if cfg.get("is_open") is False:
        return (False, None, None, "The branch is closed on this day")
    return (True, cfg.get("open") or "09:00", cfg.get("close") or "20:00", None)


async def _validate_slot(branch: dict, date_str: str, time_str: str, doctor_id: str, exclude_id: Optional[str] = None) -> str:
    is_open, open_t, close_t, reason = _hours_for(branch, date_str)
    if not is_open:
        raise HTTPException(status_code=400, detail=reason or "The branch is closed on this date")
    if not (open_t <= time_str < close_t):
        raise HTTPException(status_code=400, detail=f"Time must be within the branch working hours ({open_t}–{close_t})")
    slot = normalize_slot_time(f"{date_str}T{time_str}")
    q = {"doctor_id": doctor_id, "slot_time": slot, "status": "new_appointment"}
    if exclude_id:
        q["id"] = {"$ne": exclude_id}
    if await v3_col("appointments").find_one(q, {"_id": 0, "id": 1}):
        raise HTTPException(status_code=409, detail="This Head Physio is already booked at that time")
    return slot


@router.get("/branch-admin/{branch_id}/consult-appointments")
async def list_consult_appointments(branch_id: str, _: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin"))):
    rows = await v3_col("appointments").find(
        {"branch_id": branch_id, "appt_kind": "consultation", "status": {"$ne": "cancelled"}},
        {"_id": 0},
    ).sort("slot_time", 1).to_list(5000)
    return {"appointments": rows}


@router.get("/branch-admin/{branch_id}/consult-availability")
async def consult_availability(branch_id: str, date: str, doctor_id: str, _: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin"))):
    """Available 30-minute start times for a Head Physio on a date, derived from the
    branch working hours minus times that Head Physio is already booked."""
    branch = await _get_branch(branch_id)
    is_open, open_t, close_t, reason = _hours_for(branch, date)
    if not is_open:
        return {"open": False, "reason": reason, "slots": []}

    def to_min(t):
        h, m = t.split(":")
        return int(h) * 60 + int(m)

    start, end = to_min(open_t), to_min(close_t)
    all_slots = [f"{x // 60:02d}:{x % 60:02d}" for x in range(start, end, 30)]
    booked_rows = await v3_col("appointments").find(
        {"doctor_id": doctor_id, "status": "new_appointment", "slot_time": {"$regex": f"^{date}T"}},
        {"_id": 0, "slot_time": 1},
    ).to_list(500)
    booked = {r["slot_time"].split("T")[1] for r in booked_rows if "T" in (r.get("slot_time") or "")}
    return {
        "open": True,
        "open_time": open_t,
        "close_time": close_t,
        "slots": [s for s in all_slots if s not in booked],
        "booked": sorted(booked),
    }


@router.post("/branch-admin/{branch_id}/consult-appointments")
async def create_consult_appointment(branch_id: str, payload: ConsultApptCreate, user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin"))):
    if not payload.patient_name.strip():
        raise HTTPException(status_code=400, detail="Patient name is required")
    branch = await _get_branch(branch_id)
    doc = await _get_head_physio(payload.doctor_id)
    slot = await _validate_slot(branch, payload.date, payload.time, payload.doctor_id)
    appt = {
        "id": str(uuid.uuid4()),
        "branch_id": branch_id,
        "doctor_id": payload.doctor_id,
        "doctor_name": doc["full_name"],
        "lead_id": payload.lead_id,
        "lead_name": payload.patient_name.strip(),   # hp calendar reads lead_name
        "patient_name": payload.patient_name.strip(),
        "appointment_date": payload.date,
        "appointment_time": payload.time,
        "slot_time": slot,
        "duration": payload.duration or 30,
        "status": "new_appointment",
        "appt_kind": "consultation",
        "created_by": user.full_name,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await v3_col("appointments").insert_one(appt.copy())
    return appt


@router.patch("/branch-admin/consult-appointments/{appt_id}")
async def update_consult_appointment(appt_id: str, payload: ConsultApptUpdate, _: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin"))):
    appt = await v3_col("appointments").find_one({"id": appt_id, "appt_kind": "consultation"}, {"_id": 0})
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found")
    branch = await _get_branch(appt["branch_id"])
    updates = {"updated_at": now_iso()}
    if payload.date or payload.time or payload.doctor_id:
        new_date = payload.date or appt["appointment_date"]
        new_time = payload.time or appt["appointment_time"]
        new_doctor = payload.doctor_id or appt["doctor_id"]
        slot = await _validate_slot(branch, new_date, new_time, new_doctor, exclude_id=appt_id)
        updates.update({"appointment_date": new_date, "appointment_time": new_time, "slot_time": slot, "doctor_id": new_doctor})
        if payload.doctor_id and payload.doctor_id != appt["doctor_id"]:
            updates["doctor_name"] = (await _get_head_physio(payload.doctor_id))["full_name"]
    if payload.patient_name is not None and payload.patient_name.strip():
        updates["patient_name"] = payload.patient_name.strip()
        updates["lead_name"] = payload.patient_name.strip()
    if payload.duration:
        updates["duration"] = payload.duration
    await v3_col("appointments").update_one({"id": appt_id}, {"$set": updates})
    return await v3_col("appointments").find_one({"id": appt_id}, {"_id": 0})


@router.post("/branch-admin/consult-appointments/{appt_id}/cancel")
async def cancel_consult_appointment(appt_id: str, _: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin"))):
    appt = await v3_col("appointments").find_one({"id": appt_id, "appt_kind": "consultation"}, {"_id": 0})
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found")
    await v3_col("appointments").update_one({"id": appt_id}, {"$set": {"status": "cancelled", "updated_at": now_iso()}})
    return {"message": "Appointment cancelled", "id": appt_id}
