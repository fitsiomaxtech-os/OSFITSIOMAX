from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
import uuid

from database import v3_col
from utils import now_iso
from deps import v3_require_roles
from constants import V3_BRANCH_STAGES
from schemas.v3 import (
    V3UserOut, V3LeadOut,
    V3BranchStageInput, V3CollectFeeInput, V3AssignPhysioInput,
)

router = APIRouter(prefix="/api/v3")


@router.get("/branch-board/{branch_id}")
async def v3_branch_board_new(branch_id: str, _: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin", "business_dev"))):
    leads = await v3_col("leads").find({"branch_id": branch_id}, {"_id": 0}).sort("updated_at", -1).to_list(1000)
    stage_counts = {}
    for stage in V3_BRANCH_STAGES:
        stage_counts[stage] = sum(1 for lead in leads if lead.get("branch_stage") == stage)
    lead_list = [V3LeadOut(**lead) for lead in leads]
    return {"leads": [lead.model_dump() for lead in lead_list], "stage_counts": stage_counts}


@router.post("/leads/{lead_id}/branch-stage")
async def v3_move_branch_stage(lead_id: str, payload: V3BranchStageInput, user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin"))):
    if payload.branch_stage not in V3_BRANCH_STAGES:
        raise HTTPException(status_code=400, detail="Invalid branch stage")
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    old_stage = lead.get("branch_stage", "Unknown")
    await v3_col("leads").update_one({"id": lead_id}, {"$set": {"branch_stage": payload.branch_stage, "updated_at": now_iso()}})
    activity = {
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "branch_stage_change",
        "details": f"Branch stage: '{old_stage}' -> '{payload.branch_stage}'",
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now_iso(),
    }
    await v3_col("lead_activity").insert_one(activity.copy())
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return V3LeadOut(**updated)


@router.post("/leads/{lead_id}/collect-fee")
async def v3_collect_fee(lead_id: str, payload: V3CollectFeeInput, user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin"))):
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    updates = {"updated_at": now_iso()}
    if payload.fee_type == "consultation":
        updates["consultation_fee"] = payload.amount
    elif payload.fee_type == "package":
        updates["package_amount"] = payload.amount
        if payload.package_weeks:
            updates["package_weeks"] = payload.package_weeks
    await v3_col("leads").update_one({"id": lead_id}, {"$set": updates})
    activity = {
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "fee_collected",
        "details": f"{payload.fee_type.title()} fee collected: Rs.{payload.amount}" + (f" ({payload.package_weeks} weeks)" if payload.package_weeks else ""),
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now_iso(),
    }
    await v3_col("lead_activity").insert_one(activity.copy())
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return V3LeadOut(**updated)


@router.post("/leads/{lead_id}/assign-physio")
async def v3_assign_physio(lead_id: str, payload: V3AssignPhysioInput, user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin"))):
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    physio = await v3_col("doctors").find_one({"id": payload.physio_id}, {"_id": 0})
    if not physio:
        raise HTTPException(status_code=404, detail="Physio not found")
    await v3_col("leads").update_one({"id": lead_id}, {"$set": {
        "assigned_physio_id": payload.physio_id,
        "assigned_physio_name": physio["full_name"],
        "branch_stage": "Assigned Physio",
        "updated_at": now_iso(),
    }})
    activity = {
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "physio_assigned",
        "details": f"Jr. Physio assigned: {physio['full_name']}",
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now_iso(),
    }
    await v3_col("lead_activity").insert_one(activity.copy())
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return V3LeadOut(**updated)


class V3BranchAppointmentInput(BaseModel):
    appointment_date: str   # YYYY-MM-DD
    appointment_time: str   # HH:MM
    physio_id: str
    notes: Optional[str] = ""
    final_stage: str = "Assigned Physio"   # "Assigned Physio" or "Cancelled"


@router.post("/leads/{lead_id}/schedule-branch-appointment", response_model=V3LeadOut)
async def v3_schedule_branch_appointment(lead_id: str, payload: V3BranchAppointmentInput, user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin"))):
    """Schedule appointment date/time, assign physio, add notes, then move to final stage."""
    if payload.final_stage not in ("Assigned Physio", "Cancelled"):
        raise HTTPException(status_code=400, detail="final_stage must be 'Assigned Physio' or 'Cancelled'")
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    physio = await v3_col("doctors").find_one({"id": payload.physio_id}, {"_id": 0, "full_name": 1})
    if not physio:
        raise HTTPException(status_code=404, detail="Physio not found")

    updates = {
        "appointment_date": payload.appointment_date,
        "appointment_time": payload.appointment_time,
        "appointment_datetime": f"{payload.appointment_date}T{payload.appointment_time}:00",
        "assigned_physio_id": payload.physio_id,
        "assigned_physio_name": physio["full_name"],
        "branch_stage": payload.final_stage,
        "updated_at": now_iso(),
    }
    if payload.notes and payload.notes.strip():
        existing_notes = (lead.get("notes") or "").strip()
        appended = f"[Appt {payload.appointment_date} {payload.appointment_time}] {payload.notes.strip()}"
        updates["notes"] = f"{existing_notes}\n{appended}" if existing_notes else appended
    await v3_col("leads").update_one({"id": lead_id}, {"$set": updates})
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "branch_appointment_scheduled",
        "details": f"Appointment {payload.appointment_date} {payload.appointment_time} with {physio['full_name']} → {payload.final_stage}" + (f" · Notes: {payload.notes.strip()}" if payload.notes else ""),
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now_iso(),
    })
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return V3LeadOut(**updated)
