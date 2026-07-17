from fastapi import APIRouter, HTTPException, Depends
from typing import List, Optional, Dict
from pydantic import BaseModel
from datetime import datetime, timedelta
import hashlib
import secrets
import uuid

from database import v3_col
from utils import now_iso, now_utc, normalize_slot_time
from security import hash_password
from email_utils import send_email
from deps import v3_current_user, v3_require_roles
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
    branch = {
        "id": branch_id,
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
    return [V3DoctorOut(**row) for row in rows]


@router.post("/doctors", response_model=V3DoctorOut)
async def v3_add_doctor(payload: V3DoctorCreate, user: V3UserOut = Depends(v3_require_roles("super_admin", "branch_admin", "head_physio"))):
    if payload.profile_type == "head_physio":
        raise HTTPException(
            status_code=400,
            detail="Head Physio requires OTP verification — use POST /doctors/request-verification instead",
        )
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


EXPERT_OTP_TTL_MINUTES = 5
EXPERT_MAX_OTP_ATTEMPTS = 5


class V3ExpertVerificationRequest(BaseModel):
    full_name: str
    branch_id: str
    employee_id: str
    specialization: Optional[str] = ""
    joining_date: Optional[str] = None


class V3ExpertVerifyRequest(BaseModel):
    request_id: str
    otp: str


@router.post("/doctors/request-verification")
async def v3_request_expert_verification(payload: V3ExpertVerificationRequest, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    """Step 1 of creating a Head Physio: send an OTP to the linked employee's email.
    Nothing is created in `doctors` until verify-and-create succeeds."""
    employee = await v3_col("employees").find_one({"id": payload.employee_id}, {"_id": 0})
    if not employee:
        raise HTTPException(status_code=404, detail="Linked employee not found")
    if not employee.get("email"):
        raise HTTPException(status_code=400, detail="Linked employee has no email on file — add one before assigning as Head Physio")
    branch = await v3_col("branches").find_one({"id": payload.branch_id}, {"_id": 0})
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")

    otp = f"{secrets.randbelow(1000000):06d}"
    request_id = str(uuid.uuid4())
    doc = {
        "id": request_id,
        "full_name": payload.full_name,
        "branch_id": payload.branch_id,
        "employee_id": payload.employee_id,
        "specialization": payload.specialization or "",
        "joining_date": payload.joining_date,
        "otp_hash": hashlib.sha256(otp.encode()).hexdigest(),
        "attempts": 0,
        "consumed": False,
        "expires_at": (now_utc() + timedelta(minutes=EXPERT_OTP_TTL_MINUTES)).isoformat(),
        "created_at": now_iso(),
    }
    await v3_col("expert_verification_requests").insert_one(doc.copy())
    send_email(
        employee["email"],
        "FitsiomaxOS — Head Physio verification OTP",
        (
            f"Hi {employee.get('full_name', '')},\n\n"
            f"You're being added as a Head Physio ({payload.full_name}) on FitsiomaxOS.\n\n"
            f"OTP: {otp}\n"
            f"This code expires in {EXPERT_OTP_TTL_MINUTES} minutes.\n\n"
            f"If you did not expect this, ignore this email — no account changes will be made."
        ),
    )
    return {"request_id": request_id, "message": f"OTP sent to {employee['email']}"}


@router.post("/doctors/verify-and-create", response_model=V3DoctorOut)
async def v3_verify_and_create_expert(payload: V3ExpertVerifyRequest, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    """Step 2: verify the OTP, then create the Head Physio doctors record."""
    req = await v3_col("expert_verification_requests").find_one({"id": payload.request_id}, {"_id": 0})
    if not req:
        raise HTTPException(status_code=404, detail="Verification request not found")
    if req["consumed"]:
        raise HTTPException(status_code=400, detail="This verification request has already been used")
    if datetime.fromisoformat(req["expires_at"]) < now_utc():
        raise HTTPException(status_code=400, detail="OTP expired — please request a new one")
    if req["attempts"] >= EXPERT_MAX_OTP_ATTEMPTS:
        raise HTTPException(status_code=400, detail="Too many incorrect attempts — please request a new OTP")

    if hashlib.sha256(payload.otp.encode()).hexdigest() != req["otp_hash"]:
        await v3_col("expert_verification_requests").update_one({"id": req["id"]}, {"$inc": {"attempts": 1}})
        raise HTTPException(status_code=401, detail="Invalid OTP")

    doctor = {
        "id": str(uuid.uuid4()),
        "full_name": req["full_name"],
        "profile_type": "head_physio",
        "branch_id": req["branch_id"],
        "specialization": req.get("specialization", ""),
        "employee_id": req.get("employee_id"),
        "joining_date": req.get("joining_date"),
        "slots": [],
        "created_at": now_iso(),
    }
    await v3_col("doctors").insert_one(doctor.copy())
    await v3_col("expert_verification_requests").update_one({"id": req["id"]}, {"$set": {"consumed": True}})
    return V3DoctorOut(**doctor)


@router.get("/doctors/available")
async def v3_available_doctors(branch_id: str, slot_time: str, _: V3UserOut = Depends(v3_current_user)):
    slot_key = normalize_slot_time(slot_time)
    doctors = await v3_col("doctors").find({"branch_id": branch_id}, {"_id": 0}).to_list(1000)
    booked = await v3_col("appointments").find({"branch_id": branch_id, "slot_time": slot_key, "status": "new_appointment"}, {"_id": 0, "doctor_id": 1}).to_list(200)
    booked_ids = {item["doctor_id"] for item in booked}
    available = [d for d in doctors if slot_key in d.get("slots", []) and d["id"] not in booked_ids]
    return {"available_doctors": available}
