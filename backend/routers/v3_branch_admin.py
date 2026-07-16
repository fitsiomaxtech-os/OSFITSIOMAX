from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timedelta
from calendar import monthrange
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


async def _branch_stage_names() -> list:
    """Live Branch Stages as configured in Super Admin > Pipeline Stage Management,
    falling back to the built-in defaults if none have been configured yet."""
    rows = await v3_col("pipeline_stages").find({"type": "sales"}, {"_id": 0, "name": 1}).sort("order", 1).to_list(200)
    names = [r["name"] for r in rows]
    return names or V3_BRANCH_STAGES


async def _consultation_stage_names() -> list:
    """Live Consultation Stages as configured in Super Admin > Pipeline Stage Management,
    falling back to the built-in defaults if none have been configured yet."""
    rows = await v3_col("pipeline_stages").find({"type": "consultation"}, {"_id": 0, "name": 1}).sort("order", 1).to_list(200)
    names = [r["name"] for r in rows]
    return names or V3_CONSULTATION_STAGES


@router.get("/branch-board/{branch_id}")
async def v3_branch_board_new(branch_id: str, _: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin", "business_dev"))):
    leads = await v3_col("leads").find({"branch_id": branch_id}, {"_id": 0}).sort("updated_at", -1).to_list(20000)
    stage_counts = {}
    for stage in await _branch_stage_names():
        stage_counts[stage] = sum(1 for lead in leads if lead.get("branch_stage") == stage)
    lead_list = [V3LeadOut(**lead) for lead in leads]
    return {"leads": [lead.model_dump() for lead in lead_list], "stage_counts": stage_counts}


@router.post("/leads/{lead_id}/branch-stage")
async def v3_move_branch_stage(lead_id: str, payload: V3BranchStageInput, user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin"))):
    if payload.branch_stage not in await _branch_stage_names():
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
    stage_names = await _consultation_stage_names()
    stage_counts = {}
    for stage in stage_names:
        stage_counts[stage] = sum(1 for ld in leads_docs if ld.get("consultation_stage") == stage)
    lead_list = [V3LeadOut(**ld).model_dump() for ld in leads_docs]
    return {"leads": lead_list, "stage_counts": stage_counts, "stages": stage_names}


@router.post("/leads/{lead_id}/move-consultation-stage", response_model=V3LeadOut)
async def v3_move_consultation_stage(lead_id: str, payload: V3ConsultationStageInput, user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin", "head_physio"))):
    stage_names = await _consultation_stage_names()
    if payload.consultation_stage not in stage_names:
        raise HTTPException(status_code=400, detail=f"Invalid consultation_stage. Allowed: {stage_names}")
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


class V3ConsultationFollowUpInput(BaseModel):
    date: str  # YYYY-MM-DD
    time: str  # HH:MM (24h)
    remarks: Optional[str] = ""


class V3ConsultationFollowUpRescheduleInput(BaseModel):
    date: str
    time: str
    reason: Optional[str] = ""


@router.post("/leads/{lead_id}/consultation-follow-up", response_model=V3LeadOut)
async def v3_schedule_consultation_follow_up(lead_id: str, payload: V3ConsultationFollowUpInput, user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin", "head_physio"))):
    """Schedule a consultation follow-up. Appends to consultation_follow_ups[] and moves consultation_stage to 'Follow Up'."""
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    entry = {
        "id": str(uuid.uuid4()),
        "date": payload.date,
        "time": payload.time,
        "remarks": (payload.remarks or "").strip(),
        "status": "active",
        "created_by": user.full_name,
        "created_at": now_iso(),
    }
    await v3_col("leads").update_one(
        {"id": lead_id},
        {"$push": {"consultation_follow_ups": entry}, "$set": {
            "consultation_stage": "Follow Up",
            "next_consultation_follow_up_at": f"{payload.date}T{payload.time}:00",
            "updated_at": now_iso(),
        }},
    )
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "consultation_follow_up_scheduled",
        "details": f"Consultation follow-up on {payload.date} at {payload.time} — {entry['remarks'] or 'no remarks'}",
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now_iso(),
    })
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return V3LeadOut(**updated)


@router.post("/leads/{lead_id}/consultation-follow-up/{followup_id}/reschedule", response_model=V3LeadOut)
async def v3_reschedule_consultation_follow_up(lead_id: str, followup_id: str, payload: V3ConsultationFollowUpRescheduleInput, user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin", "head_physio"))):
    """Mark an existing consultation follow-up as rescheduled (with a reason) and add a new active one in its place."""
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    follow_ups = lead.get("consultation_follow_ups") or []
    old = next((f for f in follow_ups if f.get("id") == followup_id), None)
    if not old:
        raise HTTPException(status_code=404, detail="Follow-up not found")
    reason = (payload.reason or "").strip()
    for f in follow_ups:
        if f.get("id") == followup_id:
            f["status"] = "rescheduled"
            f["reschedule_reason"] = reason
    new_entry = {
        "id": str(uuid.uuid4()),
        "date": payload.date,
        "time": payload.time,
        "remarks": old.get("remarks", ""),
        "status": "active",
        "rescheduled_from": followup_id,
        "created_by": user.full_name,
        "created_at": now_iso(),
    }
    follow_ups.append(new_entry)
    await v3_col("leads").update_one(
        {"id": lead_id},
        {"$set": {
            "consultation_follow_ups": follow_ups,
            "consultation_stage": "Follow Up",
            "next_consultation_follow_up_at": f"{payload.date}T{payload.time}:00",
            "updated_at": now_iso(),
        }},
    )
    old_summary = f"{old.get('date')} at {old.get('time')}"
    details = f"Consultation follow-up rescheduled from {old_summary} to {payload.date} at {payload.time}"
    if reason:
        details += f" — reason: {reason}"
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "consultation_follow_up_rescheduled",
        "details": details,
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now_iso(),
    })
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return V3LeadOut(**updated)


# ---------- Smart Booking ----------

DEFAULT_SLOTS = [f"{h:02d}:{m:02d}" for h in range(9, 18) for m in (0, 30)]  # 09:00 → 17:30 every 30 min


async def _branch_experts(branch_id: str):
    rows = await v3_col("doctors").find({"branch_id": branch_id}, {"_id": 0}).to_list(500)
    return rows or await v3_col("doctors").find({}, {"_id": 0}).to_list(500)


def _expert_slots(expert: dict):
    """Return the 30-min HH:MM slot list for an expert.

    Prefer slot_details filtered to consultation_type == "Initial Consultation"
    (because Smart Booking only books fresh appointments, not follow-ups/reviews).
    Falls back to the legacy `slots` list, then to the default 09:00-17:30 grid.
    """
    details = expert.get("slot_details") or []
    initial = [d.get("slot_time", "")[:5] for d in details
               if (d.get("consultation_type") or "Initial Consultation") == "Initial Consultation"
               and d.get("slot_time")]
    if initial:
        return sorted(set(initial))
    custom = expert.get("slots") or []
    norm = []
    for s in custom:
        if isinstance(s, str) and len(s) >= 5 and s[2] == ":":
            norm.append(s[:5])
    return norm if norm else DEFAULT_SLOTS


async def _booked_by_expert(branch_id: str, date_str: str):
    """Return {expert_id: set(HH:MM)} of already-booked slots for a branch on a date."""
    cursor = v3_col("leads").find(
        {"branch_id": branch_id, "appointment_date": date_str,
         "assigned_physio_id": {"$ne": None}, "branch_stage": {"$ne": "Cancelled"}},
        {"_id": 0, "assigned_physio_id": 1, "appointment_time": 1}
    )
    booked = {}
    async for ld in cursor:
        eid = ld.get("assigned_physio_id")
        t = (ld.get("appointment_time") or "")[:5]
        if not eid or not t:
            continue
        booked.setdefault(eid, set()).add(t)
    return booked


@router.get("/branch-admin/calendar-availability/{branch_id}")
async def v3_calendar_availability(
    branch_id: str,
    month: str = Query(..., description="YYYY-MM"),
    _: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin", "head_physio")),
):
    """Return per-day availability for a branch in a given month."""
    try:
        y, m = month.split("-")
        y, m = int(y), int(m)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="month must be YYYY-MM") from exc
    _, last_day = monthrange(y, m)
    experts = await _branch_experts(branch_id)
    days = {}
    for d in range(1, last_day + 1):
        date_str = f"{y:04d}-{m:02d}-{d:02d}"
        booked = await _booked_by_expert(branch_id, date_str)
        # Count experts who have at least 1 free slot today
        free_experts = 0
        for e in experts:
            slots = set(_expert_slots(e))
            taken = booked.get(e.get("id"), set())
            if slots - taken:
                free_experts += 1
        days[date_str] = {
            "available_experts": free_experts,
            "total_experts": len(experts),
            "fully_booked": free_experts == 0 and len(experts) > 0,
        }
    return {"month": month, "branch_id": branch_id, "experts_total": len(experts), "days": days}


@router.get("/branch-admin/day-slots/{branch_id}")
async def v3_day_slots(
    branch_id: str,
    date: str = Query(..., description="YYYY-MM-DD"),
    _: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin", "head_physio")),
):
    """Return 30-min slots for a given day with the list of available experts per slot."""
    experts = await _branch_experts(branch_id)
    booked = await _booked_by_expert(branch_id, date)
    # Union of all slots offered by any expert that day
    all_slots = set()
    for e in experts:
        all_slots.update(_expert_slots(e))
    out = []
    for t in sorted(all_slots):
        free_experts = []
        for e in experts:
            if t not in _expert_slots(e):
                continue
            if t in booked.get(e.get("id"), set()):
                continue
            free_experts.append({"id": e["id"], "full_name": e.get("full_name"), "specialization": e.get("specialization"), "profile_type": e.get("profile_type")})
        out.append({"time": t, "available_experts": free_experts, "available_count": len(free_experts)})
    return {"date": date, "branch_id": branch_id, "slots": out}


@router.get("/branch-admin/expert-calendar/{expert_id}")
async def v3_expert_calendar(
    expert_id: str,
    month: str = Query(..., description="YYYY-MM"),
    _: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin", "head_physio")),
):
    """Return per-day availability for a single expert in a month + the slots they offer."""
    try:
        y, m = month.split("-")
        y, m = int(y), int(m)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="month must be YYYY-MM") from exc
    expert = await v3_col("doctors").find_one({"id": expert_id}, {"_id": 0})
    if not expert:
        raise HTTPException(status_code=404, detail="Expert not found")
    slots = _expert_slots(expert)
    _, last_day = monthrange(y, m)
    days = {}
    branch_id = expert.get("branch_id")
    for d in range(1, last_day + 1):
        date_str = f"{y:04d}-{m:02d}-{d:02d}"
        if branch_id:
            booked = await _booked_by_expert(branch_id, date_str)
            taken = booked.get(expert_id, set())
        else:
            # Fallback: look at any lead assigned to this expert that day
            cursor = v3_col("leads").find(
                {"assigned_physio_id": expert_id, "appointment_date": date_str, "branch_stage": {"$ne": "Cancelled"}},
                {"_id": 0, "appointment_time": 1},
            )
            taken = set()
            async for ld in cursor:
                t = (ld.get("appointment_time") or "")[:5]
                if t:
                    taken.add(t)
        free_slots = [s for s in slots if s not in taken]
        days[date_str] = {"available_slots": free_slots, "total_slots": len(slots), "fully_booked": len(free_slots) == 0}
    return {"expert_id": expert_id, "expert_name": expert.get("full_name"), "month": month, "slots_per_day": slots, "days": days}

