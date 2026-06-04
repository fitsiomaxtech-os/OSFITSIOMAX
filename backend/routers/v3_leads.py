from fastapi import APIRouter, HTTPException, Depends
from typing import Optional, Dict
from pydantic import BaseModel
import uuid

from database import v3_col
from utils import now_iso, normalize_slot_time
from deps import v3_current_user, v3_require_roles
from constants import V3_STAGES
from schemas.v3 import (
    V3UserOut, V3LeadCreate, V3LeadUpdate, V3LeadOut,
    V3AssignBranchInput, V3BookAppointmentInput, V3AppointmentOut,
    V3RemarkCreate, V3FollowUpCreate, V3MoveStageInput,
)

router = APIRouter(prefix="/api/v3")


@router.get("/leads")
async def v3_get_leads(
    stage: Optional[str] = None,
    branch_id: Optional[str] = None,
    source_tab: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    user: V3UserOut = Depends(v3_current_user),
):
    query: Dict[str, object] = {}
    if stage:
        query["stage"] = stage
    if source_tab:
        query["source_tab"] = source_tab

    if user.role in ["branch_admin", "head_physio", "physio"] and user.branch_id:
        query["branch_id"] = user.branch_id
    elif branch_id:
        query["branch_id"] = branch_id

    if start_date or end_date:
        created_query: Dict[str, str] = {}
        if start_date:
            created_query["$gte"] = start_date
        if end_date:
            created_query["$lte"] = end_date
        query["created_at"] = created_query

    rows = await v3_col("leads").find(query, {"_id": 0}).sort("updated_at", -1).to_list(1000)
    return [V3LeadOut(**row) for row in rows]


@router.post("/leads/manual", response_model=V3LeadOut)
async def v3_manual_lead(payload: V3LeadCreate, _: V3UserOut = Depends(v3_require_roles("super_admin", "business_dev", "pre_sales", "branch_admin"))):
    lead = {
        "id": str(uuid.uuid4()),
        "name": payload.name,
        "phone": payload.phone,
        "email": payload.email,
        "vertical": payload.vertical,
        "source_tab": payload.source_tab,
        "source_type": payload.source_type,
        "stage": "New Leads",
        "branch_id": payload.branch_id,
        "notes": payload.notes,
        "extra_fields": payload.extra_fields or {},
        "alternative_phone": payload.alternative_phone or "",
        "address": payload.address or "",
        "city": payload.city or "",
        "state": payload.state or "",
        "location": payload.location or "",
        "department": payload.department or "",
        "condition": payload.condition or "",
        "months_of_pain": payload.months_of_pain,
        "age": payload.age,
        "gender": payload.gender or "",
        "occupation": payload.occupation or "",
        "expected_consultation_date": payload.expected_consultation_date or "",
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await v3_col("leads").insert_one(lead.copy())
    return V3LeadOut(**lead)


@router.put("/leads/{lead_id}", response_model=V3LeadOut)
async def v3_edit_lead(
    lead_id: str,
    payload: V3LeadUpdate,
    user: V3UserOut = Depends(v3_require_roles("super_admin", "business_dev", "pre_sales", "branch_admin")),
):
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No updates provided")

    updates["updated_at"] = now_iso()
    # Hand-off bridge: when stage is set to "Appointment" via PUT, push lead into Branch Admin
    # New Appointment column (only if branch_stage isn't already set on the lead).
    if updates.get("stage") == "Appointment":
        existing = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0, "id": 1, "branch_stage": 1})
        if existing is not None and not existing.get("branch_stage"):
            updates["branch_stage"] = "New Appointment"

    filter_query: Dict[str, object] = {"id": lead_id}
    if user.role == "branch_admin" and user.branch_id:
        filter_query["branch_id"] = user.branch_id

    result = await v3_col("leads").update_one(filter_query, {"$set": updates})
    if result.matched_count == 0:
        exists = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0, "id": 1})
        if not exists:
            raise HTTPException(status_code=404, detail="Lead not found")
        raise HTTPException(status_code=403, detail="Lead not in your branch scope")

    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return V3LeadOut(**lead)


@router.post("/leads/{lead_id}/qualify", response_model=V3LeadOut)
async def v3_qualify_lead(lead_id: str, _: V3UserOut = Depends(v3_require_roles("pre_sales", "business_dev", "super_admin"))):
    await v3_col("leads").update_one({"id": lead_id}, {"$set": {"stage": "Follow Up", "updated_at": now_iso()}})
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    return V3LeadOut(**lead)


@router.post("/leads/{lead_id}/assign-branch", response_model=V3LeadOut)
async def v3_assign_branch(lead_id: str, payload: V3AssignBranchInput, _: V3UserOut = Depends(v3_require_roles("pre_sales", "business_dev", "super_admin"))):
    await v3_col("leads").update_one(
        {"id": lead_id},
        {"$set": {"branch_id": payload.branch_id, "stage": "Appointment", "branch_stage": "New Appointment", "updated_at": now_iso()}},
    )
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    return V3LeadOut(**lead)


@router.post("/leads/{lead_id}/confirm", response_model=V3LeadOut)
async def v3_confirm_lead(lead_id: str, user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin"))):
    filter_query = {"id": lead_id}
    if user.role == "branch_admin":
        filter_query["branch_id"] = user.branch_id

    result = await v3_col("leads").update_one(filter_query, {"$set": {"stage": "Appointment", "branch_stage": "New Appointment", "updated_at": now_iso()}})
    if result.matched_count == 0:
        exists = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0, "id": 1})
        if not exists:
            raise HTTPException(status_code=404, detail="Lead not found")
        raise HTTPException(status_code=403, detail="Lead not in your branch scope")

    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    return V3LeadOut(**lead)


@router.post("/leads/{lead_id}/book-appointment", response_model=V3AppointmentOut)
async def v3_book_appointment(lead_id: str, payload: V3BookAppointmentInput, user: V3UserOut = Depends(v3_require_roles("pre_sales", "branch_admin", "head_physio", "super_admin"))):
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    slot_key = normalize_slot_time(payload.slot_time)
    doctor = await v3_col("doctors").find_one({"id": payload.doctor_id}, {"_id": 0})
    if not doctor:
        raise HTTPException(status_code=404, detail="Doctor not found")
    if slot_key not in doctor.get("slots", []):
        raise HTTPException(status_code=400, detail="Doctor slot unavailable")
    clash = await v3_col("appointments").find_one({"doctor_id": payload.doctor_id, "slot_time": slot_key, "status": "new_appointment"}, {"_id": 0})
    if clash:
        raise HTTPException(status_code=409, detail="Slot already booked")

    appointment = {
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "lead_name": lead["name"],
        "branch_id": lead.get("branch_id") or doctor["branch_id"],
        "doctor_id": doctor["id"],
        "doctor_name": doctor["full_name"],
        "slot_time": slot_key,
        "status": "new_appointment",
        "created_by_role": user.role,
        "created_at": now_iso(),
    }
    await v3_col("appointments").insert_one(appointment.copy())
    await v3_col("leads").update_one({"id": lead_id}, {"$set": {"stage": "Appointment", "branch_stage": "New Appointment", "updated_at": now_iso()}})
    return V3AppointmentOut(**appointment)


@router.get("/leads/{lead_id}/remarks")
async def v3_get_remarks(lead_id: str, _: V3UserOut = Depends(v3_current_user)):
    rows = await v3_col("lead_remarks").find({"lead_id": lead_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return rows


@router.post("/leads/{lead_id}/remarks")
async def v3_add_remark(lead_id: str, payload: V3RemarkCreate, user: V3UserOut = Depends(v3_current_user)):
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0, "id": 1})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    remark = {
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "text": payload.text,
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now_iso(),
    }
    await v3_col("lead_remarks").insert_one(remark.copy())
    return remark


@router.get("/leads/{lead_id}/follow-ups")
async def v3_get_follow_ups(lead_id: str, _: V3UserOut = Depends(v3_current_user)):
    rows = await v3_col("lead_followups").find({"lead_id": lead_id}, {"_id": 0}).sort("scheduled_date", 1).to_list(200)
    return rows


@router.post("/leads/{lead_id}/follow-ups")
async def v3_add_follow_up(lead_id: str, payload: V3FollowUpCreate, user: V3UserOut = Depends(v3_current_user)):
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0, "id": 1})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    followup = {
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "note": payload.note,
        "scheduled_date": payload.scheduled_date,
        "status": "pending",
        "created_by": user.full_name,
        "created_at": now_iso(),
    }
    await v3_col("lead_followups").insert_one(followup.copy())
    return followup


@router.post("/leads/{lead_id}/follow-ups/{followup_id}/complete")
async def v3_complete_follow_up(lead_id: str, followup_id: str, _: V3UserOut = Depends(v3_current_user)):
    result = await v3_col("lead_followups").update_one(
        {"id": followup_id, "lead_id": lead_id},
        {"$set": {"status": "completed"}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Follow-up not found")
    return {"message": "Follow-up completed"}


@router.get("/leads/{lead_id}/activity")
async def v3_get_activity(lead_id: str, _: V3UserOut = Depends(v3_current_user)):
    rows = await v3_col("lead_activity").find({"lead_id": lead_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return rows


@router.post("/leads/{lead_id}/move-stage")
async def v3_move_stage(lead_id: str, payload: V3MoveStageInput, user: V3UserOut = Depends(v3_require_roles("pre_sales", "business_dev", "super_admin", "branch_admin"))):
    if payload.stage not in V3_STAGES:
        raise HTTPException(status_code=400, detail="Invalid stage")
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    old_stage = lead.get("stage", "Unknown")
    updates = {"stage": payload.stage, "updated_at": now_iso()}
    # Hand-off bridge: when pre-sales moves a lead into "Appointment", make it visible
    # in Branch Admin > Appointment > New Appointment column (only if not already on a branch stage).
    if payload.stage == "Appointment" and not lead.get("branch_stage"):
        updates["branch_stage"] = "New Appointment"
    await v3_col("leads").update_one({"id": lead_id}, {"$set": updates})
    activity = {
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "stage_change",
        "details": f"Moved from '{old_stage}' to '{payload.stage}'",
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now_iso(),
    }
    await v3_col("lead_activity").insert_one(activity.copy())
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return V3LeadOut(**updated)


@router.post("/leads/{lead_id}/rnr-attempt", response_model=V3LeadOut)
async def v3_rnr_attempt(lead_id: str, user: V3UserOut = Depends(v3_require_roles("pre_sales", "business_dev", "super_admin", "branch_admin"))):
    """Increment the 'rnr_attempts' counter on a lead (Ring-Not-Responded)."""
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    new_count = int(lead.get("rnr_attempts") or 0) + 1
    await v3_col("leads").update_one(
        {"id": lead_id},
        {"$set": {"rnr_attempts": new_count, "rnr_last_attempt_at": now_iso(), "updated_at": now_iso()}},
    )
    activity = {
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "rnr_attempt",
        "details": f"Call attempt #{new_count} — client did not answer",
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now_iso(),
    }
    await v3_col("lead_activity").insert_one(activity.copy())
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return V3LeadOut(**updated)


class V3FollowUpInput(BaseModel):
    date: str  # YYYY-MM-DD
    time: str  # HH:MM (24h)
    remarks: Optional[str] = ""


class V3AppointmentScheduleInput(BaseModel):
    mode: str  # "offline" | "online"
    branch_id: Optional[str] = None


@router.post("/leads/{lead_id}/schedule-appointment", response_model=V3LeadOut)
async def v3_schedule_appointment(lead_id: str, payload: V3AppointmentScheduleInput, user: V3UserOut = Depends(v3_require_roles("pre_sales", "business_dev", "super_admin", "branch_admin"))):
    """Move lead to Appointment stage with mode (offline/online) and optional branch."""
    if payload.mode not in ("offline", "online"):
        raise HTTPException(status_code=400, detail="mode must be 'offline' or 'online'")
    if payload.mode == "offline" and not payload.branch_id:
        raise HTTPException(status_code=400, detail="Branch is required for offline appointments")
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    branch_name = None
    if payload.branch_id:
        b = await v3_col("branches").find_one({"id": payload.branch_id}, {"_id": 0, "branch_name": 1, "name": 1})
        branch_name = b.get("branch_name") or b.get("name") if b else None
    updates = {
        "stage": "Appointment",
        "appointment_mode": payload.mode,
        "branch_id": payload.branch_id,
        "branch_stage": "New Appointment",
        "updated_at": now_iso(),
    }
    await v3_col("leads").update_one({"id": lead_id}, {"$set": updates})
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "appointment_scheduled",
        "details": f"Appointment scheduled · mode={payload.mode}" + (f" · branch={branch_name}" if branch_name else ""),
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now_iso(),
    })
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return V3LeadOut(**updated)


@router.post("/leads/{lead_id}/follow-up", response_model=V3LeadOut)
async def v3_schedule_follow_up(lead_id: str, payload: V3FollowUpInput, user: V3UserOut = Depends(v3_require_roles("pre_sales", "business_dev", "super_admin", "branch_admin"))):
    """Schedule a follow-up for a lead. Appends to follow_ups[] and moves stage to 'Follow Up'."""
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    entry = {
        "id": str(uuid.uuid4()),
        "date": payload.date,
        "time": payload.time,
        "remarks": (payload.remarks or "").strip(),
        "created_by": user.full_name,
        "created_at": now_iso(),
    }
    await v3_col("leads").update_one(
        {"id": lead_id},
        {"$push": {"follow_ups": entry}, "$set": {"stage": "Follow Up", "next_follow_up_at": f"{payload.date}T{payload.time}:00", "updated_at": now_iso()}},
    )
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "follow_up_scheduled",
        "details": f"Follow-up on {payload.date} at {payload.time} — {entry['remarks'] or 'no remarks'}",
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now_iso(),
    })
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return V3LeadOut(**updated)
