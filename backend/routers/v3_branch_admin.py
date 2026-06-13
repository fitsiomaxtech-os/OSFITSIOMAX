from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
import uuid

from database import v3_col
from utils import now_iso
from deps import v3_require_roles
from constants import V3_BRANCH_STAGES, V3_CONSULTATION_STAGES
from schemas.v3 import (
    V3UserOut, V3LeadOut,
    V3BranchStageInput, V3CollectFeeInput, V3AssignPhysioInput, V3ConsultationStageInput,
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
        "branch_stage": "Appointment Date & Time",
        "consultation_stage": lead.get("consultation_stage") or "New Appointment",
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
    final_stage: str = "Appointment Date & Time"   # "Appointment Date & Time" or "Cancelled"


@router.post("/leads/{lead_id}/schedule-branch-appointment", response_model=V3LeadOut)
async def v3_schedule_branch_appointment(lead_id: str, payload: V3BranchAppointmentInput, user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin"))):
    """Schedule appointment date/time, assign physio, add notes, then move to final stage."""
    if payload.final_stage not in ("Appointment Date & Time", "Cancelled"):
        raise HTTPException(status_code=400, detail="final_stage must be 'Appointment Date & Time' or 'Cancelled'")
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
    # When the appointment is booked (not cancelled), seed the Consultations pipeline
    if payload.final_stage == "Appointment Date & Time":
        updates["consultation_stage"] = lead.get("consultation_stage") or "New Appointment"
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



@router.get("/branch-admin/available-experts/{branch_id}")
async def v3_available_experts(
    branch_id: str,
    date: str,
    time: str,
    _: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin", "head_physio")),
):
    """Return only branch experts who have NO consultation booked at the given date+time.

    A physio is considered booked when another lead in this branch has the same
    appointment_date + appointment_time and is not in a final-cancelled state.
    """
    if not date or not time:
        raise HTTPException(status_code=400, detail="date and time are required")
    # All experts at this branch
    branch_experts = await v3_col("doctors").find(
        {"branch_id": branch_id}, {"_id": 0}
    ).to_list(500)
    # All experts (fallback when no branch-mapped experts)
    if not branch_experts:
        branch_experts = await v3_col("doctors").find({}, {"_id": 0}).to_list(500)

    # Find leads already taking those slots
    busy_lead_query = {
        "appointment_date": date,
        "appointment_time": time,
        "assigned_physio_id": {"$ne": None},
        "branch_stage": {"$ne": "Cancelled"},
    }
    busy_leads = await v3_col("leads").find(busy_lead_query, {"_id": 0, "assigned_physio_id": 1}).to_list(500)
    busy_ids = {ld["assigned_physio_id"] for ld in busy_leads if ld.get("assigned_physio_id")}

    available = [d for d in branch_experts if d.get("id") not in busy_ids]
    return {
        "date": date,
        "time": time,
        "branch_id": branch_id,
        "total_branch_experts": len(branch_experts),
        "available_count": len(available),
        "busy_count": len(busy_ids & {d["id"] for d in branch_experts}),
        "experts": available,
    }



@router.get("/branch-admin/consultations/{branch_id}/board")
async def v3_consultations_board(branch_id: str, _: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin", "head_physio"))):
    """Return all leads in the Consultations pipeline for a branch, grouped by consultation_stage."""
    query = {"branch_id": branch_id, "consultation_stage": {"$ne": None}}
    leads_docs = await v3_col("leads").find(query, {"_id": 0}).sort("updated_at", -1).to_list(2000)
    stage_counts = {}
    for stage in V3_CONSULTATION_STAGES:
        stage_counts[stage] = sum(1 for ld in leads_docs if ld.get("consultation_stage") == stage)
    lead_list = [V3LeadOut(**ld).model_dump() for ld in leads_docs]
    return {"leads": lead_list, "stage_counts": stage_counts, "stages": V3_CONSULTATION_STAGES}


@router.post("/leads/{lead_id}/move-consultation-stage", response_model=V3LeadOut)
async def v3_move_consultation_stage(lead_id: str, payload: V3ConsultationStageInput, user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin", "head_physio"))):
    if payload.consultation_stage not in V3_CONSULTATION_STAGES:
        raise HTTPException(status_code=400, detail=f"Invalid consultation_stage. Allowed: {V3_CONSULTATION_STAGES}")
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    previous = lead.get("consultation_stage") or "—"
    await v3_col("leads").update_one({"id": lead_id}, {"$set": {
        "consultation_stage": payload.consultation_stage,
        "updated_at": now_iso(),
    }})
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "consultation_stage_moved",
        "details": f"Consultation: {previous} → {payload.consultation_stage}",
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now_iso(),
    })
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return V3LeadOut(**updated)
