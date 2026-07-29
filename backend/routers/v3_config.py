from fastapi import APIRouter, HTTPException, Depends
from typing import List, Optional, Dict
from pydantic import BaseModel
import uuid

from database import v3_col
from utils import now_iso, normalize_slot_time, derive_branch_code
from security import hash_password
from deps import v3_current_user, v3_require_roles
from stage_utils import get_first_stage_name
from schemas.v3 import (
    V3UserOut, V3VerticalCreate, V3VerticalOut,
    V3BranchCreate, V3BranchOut, V3BranchUpdate,
    V3TeamMemberCreate, V3TeamMemberOut,
    V3DoctorCreate, V3DoctorSlotsInput, V3DoctorOut,
)

router = APIRouter(prefix="/api/v3")


@router.get("/verticals", response_model=List[V3VerticalOut])
async def v3_get_verticals(_: V3UserOut = Depends(v3_current_user)):
    rows = await v3_col("verticals").find({}, {"_id": 0}).to_list(100)
    return [V3VerticalOut(**row) for row in rows]


@router.post("/verticals", response_model=V3VerticalOut)
async def v3_add_vertical(payload: V3VerticalCreate, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    doc = {
        "id": str(uuid.uuid4()),
        "name": payload.name,
        "active": payload.active,
        "created_at": now_iso(),
    }
    await v3_col("verticals").insert_one(doc.copy())
    return V3VerticalOut(**doc)


@router.get("/branches", response_model=List[V3BranchOut])
async def v3_get_branches(_: V3UserOut = Depends(v3_current_user)):
    rows = await v3_col("branches").find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return [V3BranchOut(**row) for row in rows]


@router.get("/team-members", response_model=List[V3TeamMemberOut])
async def v3_get_team_members(team_type: Optional[str] = None, _: V3UserOut = Depends(v3_current_user)):
    query: Dict[str, str] = {}
    if team_type:
        query["team_type"] = team_type
    rows = await v3_col("team_members").find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return [V3TeamMemberOut(**row) for row in rows]


@router.post("/team-members", response_model=V3TeamMemberOut)
async def v3_add_team_member(payload: V3TeamMemberCreate, _: V3UserOut = Depends(v3_require_roles("business_dev", "super_admin"))):
    email = payload.email.lower().strip()
    exists = await v3_col("team_members").find_one({"email": email, "team_type": payload.team_type}, {"_id": 0})
    if exists:
        raise HTTPException(status_code=409, detail="Team member already exists")

    member = {
        "id": str(uuid.uuid4()),
        "full_name": payload.full_name.strip(),
        "email": email,
        "team_type": payload.team_type,
        "created_at": now_iso(),
    }
    await v3_col("team_members").insert_one(member.copy())
    return V3TeamMemberOut(**member)


@router.post("/branches", response_model=V3BranchOut)
async def v3_create_branch(payload: V3BranchCreate, _: V3UserOut = Depends(v3_require_roles("super_admin", "business_dev"))):
    branch_id = str(uuid.uuid4())
    admin_user_id = str(uuid.uuid4())
    await v3_col("users").insert_one(
        {
            "id": admin_user_id,
            "full_name": payload.admin_name,
            "email": payload.admin_email.lower(),
            "password": hash_password(payload.admin_password),
            "role": "branch_admin",
            "branch_id": branch_id,
            "is_active": True,
            "created_at": now_iso(),
        }
    )
    existing_codes = set(await v3_col("branches").distinct("code"))
    code = (payload.code or "").strip().upper()
    if code:
        if code in existing_codes:
            raise HTTPException(status_code=409, detail=f"Branch code '{code}' is already in use")
    else:
        code = derive_branch_code(payload.branch_name, existing_codes)
    branch = {
        "id": branch_id,
        "code": code,
        "branch_name": payload.branch_name,
        "address": payload.address,
        "admin_user_id": admin_user_id,
        "admin_name": payload.admin_name,
        "admin_email": payload.admin_email.lower(),
        "admin_phone": payload.admin_phone,
        "vertical": payload.vertical,
        "created_at": now_iso(),
    }
    await v3_col("branches").insert_one(branch.copy())

    await v3_col("users").update_many(
        {
            "email": {"$in": ["headphysio@fitsiomax.com", "physio@fitsiomax.com"]},
            "branch_id": None,
        },
        {"$set": {"branch_id": branch_id}},
    )

    return V3BranchOut(**branch)


@router.put("/branches/{branch_id}", response_model=V3BranchOut)
async def v3_update_branch(branch_id: str, payload: V3BranchUpdate, _: V3UserOut = Depends(v3_require_roles("super_admin", "business_dev"))):
    existing = await v3_col("branches").find_one({"id": branch_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Branch not found")
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    if "code" in updates:
        new_code = updates["code"].strip().upper()
        if not new_code:
            raise HTTPException(status_code=400, detail="Branch code cannot be empty")
        clash = await v3_col("branches").find_one({"code": new_code, "id": {"$ne": branch_id}}, {"_id": 0, "id": 1})
        if clash:
            raise HTTPException(status_code=409, detail=f"Branch code '{new_code}' is already used by another branch")
        updates["code"] = new_code
    await v3_col("branches").update_one({"id": branch_id}, {"$set": updates})
    updated = await v3_col("branches").find_one({"id": branch_id}, {"_id": 0})
    return V3BranchOut(**updated)


@router.delete("/branches/{branch_id}")
async def v3_delete_branch(branch_id: str, _: V3UserOut = Depends(v3_require_roles("super_admin", "business_dev"))):
    existing = await v3_col("branches").find_one({"id": branch_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Branch not found")
    await v3_col("branches").delete_one({"id": branch_id})
    if existing.get("admin_user_id"):
        await v3_col("users").delete_one({"id": existing["admin_user_id"]})
    # Don't leave leads/sources pointing at a branch that no longer exists — unassign them
    # back to "no branch" so they fall back to the normal Pre-Sales flow instead of silently
    # keeping a dead branch_id forever.
    await v3_col("leads").update_many(
        {"branch_id": branch_id},
        {"$set": {"branch_id": None, "branch_stage": None}},
    )
    await v3_col("marketing_sources").update_many(
        {"branch_id": branch_id},
        {"$set": {"branch_id": None}},
    )
    return {"message": "Branch deleted"}


@router.get("/doctors", response_model=List[V3DoctorOut])
async def v3_get_doctors(branch_id: Optional[str] = None, user: V3UserOut = Depends(v3_current_user)):
    query: Dict[str, object] = {}
    if user.role in ["branch_admin", "head_physio", "physio"] and user.branch_id:
        query["branch_id"] = user.branch_id
    elif branch_id:
        query["branch_id"] = branch_id
    rows = await v3_col("doctors").find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    out = []
    for row in rows:
        try:
            out.append(V3DoctorOut(**row))
        except Exception:
            # One malformed legacy row (e.g. missing a field a later schema change added)
            # shouldn't 500 the whole Experts list — skip it and keep going.
            continue
    return out


@router.post("/doctors", response_model=V3DoctorOut)
async def v3_add_doctor(payload: V3DoctorCreate, user: V3UserOut = Depends(v3_require_roles("super_admin", "branch_admin", "head_physio"))):
    branch_id = payload.branch_id or user.branch_id
    if not branch_id:
        raise HTTPException(status_code=400, detail="Branch is required")
    doctor = {
        "id": str(uuid.uuid4()),
        "full_name": payload.full_name,
        "profile_type": payload.profile_type,
        "branch_id": branch_id,
        "specialization": payload.specialization,
        "employee_id": payload.employee_id,
        "joining_date": payload.joining_date,
        "slots": [],
        "created_at": now_iso(),
    }
    await v3_col("doctors").insert_one(doctor.copy())
    return V3DoctorOut(**doctor)


@router.delete("/doctors/{doctor_id}")
async def v3_delete_doctor(doctor_id: str, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    """Remove an expert profile created via HR > Fitsiomax Experts. Only for
    profile-only entries with no linked login and no appointment/session history —
    those are real accounts or real patient history, not stray test/duplicate rows."""
    doctor = await v3_col("doctors").find_one({"id": doctor_id}, {"_id": 0})
    if not doctor:
        raise HTTPException(status_code=404, detail="Expert not found")
    if doctor.get("user_id"):
        raise HTTPException(status_code=400, detail="This expert is linked to a login account — remove the login in Roles & Credentials instead")
    if await v3_col("appointments").find_one({"doctor_id": doctor_id}, {"_id": 0, "id": 1}):
        raise HTTPException(status_code=400, detail="This expert has appointment history and can't be deleted")
    if await v3_col("sessions").find_one({"physio_id": doctor_id}, {"_id": 0, "id": 1}):
        raise HTTPException(status_code=400, detail="This expert has session history and can't be deleted")
    await v3_col("doctors").delete_one({"id": doctor_id})
    return {"message": "Expert deleted"}


@router.post("/doctors/{doctor_id}/slots", response_model=V3DoctorOut)
async def v3_add_slots(doctor_id: str, payload: V3DoctorSlotsInput, _: V3UserOut = Depends(v3_require_roles("super_admin", "branch_admin", "head_physio"))):
    doctor = await v3_col("doctors").find_one({"id": doctor_id}, {"_id": 0})
    if not doctor:
        raise HTTPException(status_code=404, detail="Doctor not found")
    normalized_slots = [normalize_slot_time(slot) for slot in payload.slots]
    all_slots = sorted(set(doctor.get("slots", [])).union(set(normalized_slots)))
    await v3_col("doctors").update_one({"id": doctor_id}, {"$set": {"slots": all_slots}})
    updated = await v3_col("doctors").find_one({"id": doctor_id}, {"_id": 0})
    return V3DoctorOut(**updated)


@router.get("/doctors/available")
async def v3_available_doctors(branch_id: str, slot_time: str, _: V3UserOut = Depends(v3_current_user)):
    slot_key = normalize_slot_time(slot_time)
    doctors = await v3_col("doctors").find({"branch_id": branch_id}, {"_id": 0}).to_list(1000)
    booked = await v3_col("appointments").find({"branch_id": branch_id, "slot_time": slot_key, "status": "new_appointment"}, {"_id": 0, "doctor_id": 1}).to_list(200)
    booked_ids = {item["doctor_id"] for item in booked}
    available = [d for d in doctors if slot_key in d.get("slots", []) and d["id"] not in booked_ids]
    return {"available_doctors": available}


@router.post("/admin/reset-all-leads")
async def v3_reset_all_leads(confirm: bool = False, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    """Testing utility: resets every lead's pipeline progress back to a fresh,
    unassigned state at Pre-Sales' first stage — the lead record itself (name,
    phone, contact info, source) is kept as-is. Clears both the Consultation
    Package/fee and the Treatment Fee/Session Package/Partial Payment schedule,
    so no stale balance or due date survives into Accountant Manage after a
    reset. Also clears everything tied to leads that only makes sense
    mid-pipeline: sessions, weekly assessments, package recommendations,
    appointments, patient view tokens, and activity history. Irreversible —
    requires confirm=true. Super Admin only."""
    if not confirm:
        raise HTTPException(status_code=400, detail="Pass confirm=true to proceed — this cannot be undone.")

    first_stage = await get_first_stage_name("pre_sales", "New Leads")
    reset_fields = {
        "stage": first_stage,
        "branch_id": None,
        "branch_stage": None,
        "consultation_stage": None,
        "head_consultation_stage": None,
        "physio_stage": None,
        "consultation_fee": None,
        "consultation_item_name": None,
        "consultation_mode": None,
        "consultation_payment_mode": None,
        "package_amount": None,
        "package_weeks": None,
        "package_id": None,
        "package_name": None,
        "package_price": None,
        "package_paid": None,
        "package_payment_mode": None,
        "package_sessions": None,
        "package_duration_minutes": None,
        "package_mode": None,
        "treatment_fee_paid": None,
        "treatment_fee_payment_mode": None,
        "treatment_fee_payment_details": None,
        "session_package_id": None,
        "session_package_name": None,
        "session_package_price": None,
        "session_package_sessions": None,
        "session_package_mode": None,
        "diagnosis": None,
        "physio_diagnosis_report": None,
        "physio_diagnosis_locked": False,
        "treatment_summary": None,
        "treatment_summary_locked": False,
        "assigned_physio_id": None,
        "assigned_physio_name": None,
        "physio_assigned_at": None,
        "assigned_user_id": None,
        "assigned_user_name": None,
        "rnr_attempts": 0,
        "rnr_last_attempt_at": None,
        "follow_ups": [],
        "next_follow_up_at": None,
        "consultation_follow_ups": [],
        "next_consultation_follow_up_at": None,
        "appointment_mode": None,
        "appointment_department": None,
        "appointment_date": None,
        "appointment_time": None,
        "appointment_datetime": None,
        "portfolio_date": None,
        "portfolio_time": None,
        "portfolio_datetime": None,
        "expected_consultation_date": None,
        "updated_at": now_iso(),
    }
    leads_result = await v3_col("leads").update_many({}, {"$set": reset_fields})

    sessions_deleted = (await v3_col("sessions").delete_many({})).deleted_count
    assessments_deleted = (await v3_col("weekly_assessments").delete_many({})).deleted_count
    recs_deleted = (await v3_col("package_recommendations").delete_many({})).deleted_count
    appts_deleted = (await v3_col("appointments").delete_many({})).deleted_count
    tokens_deleted = (await v3_col("patient_tokens").delete_many({})).deleted_count
    activity_deleted = (await v3_col("lead_activity").delete_many({})).deleted_count

    return {
        "message": "All leads reset to a fresh state",
        "leads_reset": leads_result.modified_count,
        "sessions_deleted": sessions_deleted,
        "weekly_assessments_deleted": assessments_deleted,
        "package_recommendations_deleted": recs_deleted,
        "appointments_deleted": appts_deleted,
        "patient_tokens_deleted": tokens_deleted,
        "lead_activity_deleted": activity_deleted,
    }
