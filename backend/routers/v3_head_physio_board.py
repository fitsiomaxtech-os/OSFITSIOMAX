from fastapi import APIRouter, HTTPException, Depends
from typing import Optional
from pydantic import BaseModel
import uuid

from database import v3_col
from utils import now_iso
from deps import v3_current_user, v3_require_roles
from constants import V3_HEAD_CONSULTATION_STAGES
from schemas.v3 import V3UserOut, V3PackageRecommendInput, V3HeadPhysioReviewInput, V3LeadOut, V3ConsultationDecisionInput

router = APIRouter(prefix="/api/v3")


async def _head_consultation_stage_names() -> list:
    """Live Head Consultation stages as configured in Super Admin > Pipeline Stage
    Management, falling back to the built-in defaults if none have been configured yet."""
    rows = await v3_col("pipeline_stages").find(
        {"type": "head_consultation"}, {"_id": 0, "name": 1}
    ).sort("order", 1).to_list(50)
    names = [r["name"] for r in rows]
    return names or V3_HEAD_CONSULTATION_STAGES


async def _resolve_hp_doctor(user: V3UserOut, branch_id: Optional[str] = None) -> Optional[dict]:
    """Find the doctors record for the logged-in head physio/consultant, scoped to their own
    user_id. Super Admin driving a specific branch's board (e.g. from Branch Management >
    Branch Control) can pass that branch's id to resolve its head physio instead."""
    doctor = await v3_col("doctors").find_one(
        {"user_id": user.id, "profile_type": "head_physio"},
        {"_id": 0},
    )
    if doctor:
        return doctor
    effective_branch = branch_id if (user.role == "super_admin" and branch_id) else user.branch_id
    if effective_branch:
        doctor = await v3_col("doctors").find_one(
            {"branch_id": effective_branch, "profile_type": "head_physio"},
            {"_id": 0},
        )
    return doctor


@router.get("/head-physio/my-calendar")
async def hp_my_calendar(branch_id: Optional[str] = None, user: V3UserOut = Depends(v3_require_roles("head_physio", "super_admin"))):
    """Read-only view of the logged-in consultant's own booked slots (branch admin manages slot availability)."""
    doctor = await _resolve_hp_doctor(user, branch_id)
    if not doctor:
        return {"slots": [], "slot_details": [], "booked": {}}

    booked_rows = await v3_col("appointments").find(
        {"doctor_id": doctor["id"], "status": "new_appointment"},
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


@router.get("/head-physio/my-patients")
async def hp_my_patients(branch_id: Optional[str] = None, user: V3UserOut = Depends(v3_require_roles("head_physio", "super_admin"))):
    doctor = await _resolve_hp_doctor(user, branch_id)
    if not doctor:
        return {"patients": []}

    appointments = await v3_col("appointments").find(
        {"doctor_id": doctor["id"]},
        {"_id": 0},
    ).sort("slot_time", -1).to_list(500)

    lead_ids = list({a["lead_id"] for a in appointments})
    leads = await v3_col("leads").find({"id": {"$in": lead_ids}}, {"_id": 0}).to_list(500)
    lead_map = {l["id"]: l for l in leads}

    recommendations = await v3_col("package_recommendations").find(
        {"lead_id": {"$in": lead_ids}}, {"_id": 0}
    ).to_list(500)
    rec_map = {r["lead_id"]: r for r in recommendations}

    patients = []
    for lead_id in lead_ids:
        lead = lead_map.get(lead_id, {})
        appts = [a for a in appointments if a["lead_id"] == lead_id]
        rec = rec_map.get(lead_id)
        patients.append({
            "lead_id": lead_id,
            "lead_name": lead.get("name", "Unknown"),
            "phone": lead.get("phone", ""),
            "email": lead.get("email", ""),
            "branch_stage": lead.get("branch_stage", ""),
            "consultation_fee": lead.get("consultation_fee"),
            "package_amount": lead.get("package_amount"),
            "appointments": appts,
            "recommendation": rec,
            "has_recommendation": rec is not None,
        })

    return {"patients": patients}


@router.post("/head-physio/recommend-package")
async def hp_recommend_package(
    payload: V3PackageRecommendInput,
    user: V3UserOut = Depends(v3_require_roles("head_physio", "super_admin")),
):
    lead = await v3_col("leads").find_one({"id": payload.lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    doctor = await _resolve_hp_doctor(user, lead.get("branch_id"))

    total_sessions = payload.recommended_weeks * payload.sessions_per_week

    rec = {
        "id": str(uuid.uuid4()),
        "lead_id": payload.lead_id,
        "lead_name": lead.get("name", "Unknown"),
        "branch_id": lead.get("branch_id") or user.branch_id,
        "head_physio_id": doctor["id"] if doctor else "",
        "head_physio_name": doctor["full_name"] if doctor else user.full_name,
        "recommended_weeks": payload.recommended_weeks,
        "sessions_per_week": payload.sessions_per_week,
        "total_sessions": total_sessions,
        "notes": payload.notes or "",
        "status": "pending",
        "created_at": now_iso(),
    }
    await v3_col("package_recommendations").insert_one(rec.copy())

    await v3_col("leads").update_one(
        {"id": payload.lead_id},
        {"$set": {"branch_stage": "Follow Up", "updated_at": now_iso()}},
    )

    activity = {
        "id": str(uuid.uuid4()),
        "lead_id": payload.lead_id,
        "action": "package_recommended",
        "details": f"Head Physio recommended {payload.recommended_weeks} weeks, {payload.sessions_per_week} sessions/week ({total_sessions} total). Notes: {payload.notes}",
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now_iso(),
    }
    await v3_col("lead_activity").insert_one(activity.copy())

    return rec


@router.get("/head-physio/sessions/{lead_id}")
async def hp_view_sessions(lead_id: str, _: V3UserOut = Depends(v3_require_roles("head_physio", "super_admin", "branch_admin"))):
    sessions = await v3_col("sessions").find(
        {"lead_id": lead_id}, {"_id": 0}
    ).sort("slot_time", 1).to_list(500)
    return {"sessions": sessions}


@router.get("/head-physio/weekly-assessments/{lead_id}")
async def hp_get_assessments(lead_id: str, _: V3UserOut = Depends(v3_require_roles("head_physio", "super_admin"))):
    assessments = await v3_col("weekly_assessments").find(
        {"lead_id": lead_id}, {"_id": 0}
    ).sort("week_number", 1).to_list(100)
    return {"assessments": assessments}


@router.post("/head-physio/weekly-review/{lead_id}/{week_number}")
async def hp_weekly_review(
    lead_id: str,
    week_number: int,
    payload: V3HeadPhysioReviewInput,
    user: V3UserOut = Depends(v3_require_roles("head_physio", "super_admin")),
):
    existing = await v3_col("weekly_assessments").find_one(
        {"lead_id": lead_id, "week_number": week_number}, {"_id": 0}
    )

    if existing:
        await v3_col("weekly_assessments").update_one(
            {"lead_id": lead_id, "week_number": week_number},
            {"$set": {
                "head_physio_notes": payload.head_physio_notes,
                "head_physio_suggestions": payload.head_physio_suggestions,
                "status": "reviewed",
                "reviewed_by": user.full_name,
                "updated_at": now_iso(),
            }},
        )
    else:
        await v3_col("weekly_assessments").insert_one({
            "id": str(uuid.uuid4()),
            "lead_id": lead_id,
            "branch_id": user.branch_id,
            "week_number": week_number,
            "jr_physio_notes": "",
            "head_physio_notes": payload.head_physio_notes,
            "head_physio_suggestions": payload.head_physio_suggestions,
            "status": "reviewed",
            "reviewed_by": user.full_name,
            "created_at": now_iso(),
            "updated_at": now_iso(),
        })

    updated = await v3_col("weekly_assessments").find_one(
        {"lead_id": lead_id, "week_number": week_number}, {"_id": 0}
    )
    return updated


class V3ConsultationPhysioAssignInput(BaseModel):
    physio_id: str


class V3HeadConsultationStageMoveInput(BaseModel):
    head_consultation_stage: str


@router.post("/leads/{lead_id}/move-head-consultation-stage", response_model=dict)
async def hp_move_head_consultation_stage(
    lead_id: str,
    payload: V3HeadConsultationStageMoveInput,
    user: V3UserOut = Depends(v3_require_roles("head_physio", "super_admin")),
):
    """Move a lead through the Head Physio's own consultation pipeline
    (head_consultation_stage) — fully independent from Branch's consultation_stage."""
    stage_names = await _head_consultation_stage_names()
    if payload.head_consultation_stage not in stage_names:
        raise HTTPException(status_code=400, detail=f"Invalid head_consultation_stage. Allowed: {stage_names}")
    if payload.head_consultation_stage == "Consultation Visit":
        raise HTTPException(
            status_code=403,
            detail="Use the consultation-decision endpoint (Save & Move) — it requires Diagnosis, Treatment Summary and a decision first.",
        )
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    previous = lead.get("head_consultation_stage") or "—"
    updates = {
        "head_consultation_stage": payload.head_consultation_stage,
        "updated_at": now_iso(),
    }
    await v3_col("leads").update_one({"id": lead_id}, {"$set": updates})
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "head_consultation_stage_moved",
        "details": f"Head Consultation: {previous} → {payload.head_consultation_stage}",
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now_iso(),
    })
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return {"message": "Stage moved", "lead": V3LeadOut(**updated).model_dump()}


@router.post("/leads/{lead_id}/consultation-decision", response_model=dict)
async def hp_consultation_decision(
    lead_id: str,
    payload: V3ConsultationDecisionInput,
    user: V3UserOut = Depends(v3_require_roles("head_physio", "super_admin")),
):
    """Head Physio's 'Save & Move' — the single action that closes out the
    consultation: requires Diagnosis Report + Treatment Summary to already be
    written, records the Consultation Only / Consultation + Treatment decision
    (and, for the latter, the chosen Treatment/Session package — names only, no
    price shown here), then hands the lead to Branch Admin's 'Consultation Visit'
    column on both pipelines at once."""
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if not (lead.get("physio_diagnosis_report") or "").strip():
        raise HTTPException(status_code=400, detail="Write the Diagnosis Report before Save & Move")
    if not (lead.get("treatment_summary") or "").strip():
        raise HTTPException(status_code=400, detail="Write the Treatment Summary before Save & Move")

    updates = {
        "consultation_decision": payload.decision,
        "head_consultation_stage": "Consultation Visit",
        "consultation_stage": "Consultation Visit",
        "updated_at": now_iso(),
    }
    detail = f"Consultation decision: {'Consultation Only' if payload.decision == 'consultation_only' else 'Consultation + Treatment'}"

    # Consultation Fee has a single fixed price (FITSIO STORE > Consultation) — there's
    # nothing for the Head Physio to pick, so it's auto-assigned the first time a lead
    # reaches this decision, the same way it always has been, just without a manual step.
    if not lead.get("package_id"):
        consultation_item = await v3_col("store_items").find_one({"item_type": "consultation"}, {"_id": 0})
        if consultation_item:
            mode = lead.get("appointment_mode") or "offline"
            price = consultation_item.get("price_online") if mode == "online" else consultation_item.get("price_offline")
            updates.update({
                "package_id": consultation_item["id"],
                "package_name": consultation_item["name"],
                "package_price": price,
                "package_duration_minutes": consultation_item.get("duration_minutes"),
                "package_mode": mode,
            })

    if payload.decision == "consultation_treatment":
        if not payload.item_id:
            raise HTTPException(status_code=400, detail="Select a Treatment Package")
        item = await v3_col("store_items").find_one({"id": payload.item_id}, {"_id": 0})
        if not item:
            raise HTTPException(status_code=404, detail="Treatment package not found")
        if item.get("item_type") != "session":
            raise HTTPException(status_code=400, detail="Only Session packages can be chosen as the Treatment Package")
        base_price = item.get("price_online") if payload.mode == "online" else item.get("price_offline")
        base_sessions = item.get("sessions_online") if payload.mode == "online" else item.get("sessions_offline")
        sessions = payload.sessions_override if payload.sessions_override and payload.sessions_override > 0 else base_sessions
        price = round((base_price / base_sessions) * sessions, 2) if base_sessions and base_price is not None else base_price
        updates.update({
            "session_package_id": item["id"],
            "session_package_name": item["name"],
            "session_package_price": price,
            "session_package_sessions": sessions,
            "session_package_mode": payload.mode,
        })
        detail += f" · Package: {item['name']} ({sessions} sessions)"

    await v3_col("leads").update_one({"id": lead_id}, {"$set": updates})
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "consultation_decision_saved",
        "details": detail,
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now_iso(),
    })
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return {"message": "Saved & moved", "lead": V3LeadOut(**updated).model_dump()}


@router.post("/leads/{lead_id}/assign-consultation-physio")
async def hp_assign_consultation_physio(
    lead_id: str,
    payload: V3ConsultationPhysioAssignInput,
    user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin")),
):
    """Branch Admin picks the physio who will deliver the assigned package's
    treatment sessions, moving the lead into Branch's own 'Physio Assign' stage —
    the last step in the Consultations pipeline, after fees are collected. Callable
    while at 'Treatment Fee Collected' (first assignment) or already at 'Physio
    Assign' (reassigning to a different physio)."""
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if lead.get("consultation_stage") not in ("Treatment Fee Collected", "Physio Assign"):
        raise HTTPException(status_code=400, detail="A physio can only be assigned after the Treatment Fee has been collected")
    physio = await v3_col("doctors").find_one(
        {"id": payload.physio_id, "profile_type": "physio"}, {"_id": 0}
    )
    if not physio:
        raise HTTPException(status_code=404, detail="Physio not found")

    await v3_col("leads").update_one({"id": lead_id}, {"$set": {
        "assigned_physio_id": physio["id"],
        "assigned_physio_name": physio["full_name"],
        "physio_assigned_at": now_iso(),
        "consultation_stage": "Physio Assign",
        "updated_at": now_iso(),
    }})
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "consultation_physio_assigned",
        "details": f"Assigned {physio['full_name']} to deliver treatment sessions",
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now_iso(),
    })
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return {"message": "Physio assigned", "lead": V3LeadOut(**updated).model_dump()}
