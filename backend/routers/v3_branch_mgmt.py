from fastapi import APIRouter, Depends, HTTPException
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
import uuid

from database import v3_col
from utils import now_iso, derive_branch_code
from deps import v3_require_roles, is_branch_admin_role, is_physio_role, PHYSIO_ROLES
from security import verify_password
import lead_control
from schemas.v3 import V3UserOut


router = APIRouter(prefix="/api/v3/branch-mgmt")


class BranchAssignedCreate(BaseModel):
    branch_name: str
    address: Optional[str] = ""  # online-vertical branches have no physical address
    admin_user_id: str = Field(..., description="Existing user with a Branch Admin role")
    admin_phone: Optional[str] = ""
    vertical: Optional[str] = "offline_physiotherapy"
    opened_date: Optional[str] = ""
    opening_hours: Optional[str] = ""
    phone: Optional[str] = ""
    email: Optional[str] = ""
    map_location: Optional[str] = ""
    weekly_hours: Optional[Dict[str, Any]] = None
    holidays: Optional[List[str]] = None
    code: Optional[str] = None  # short unique prefix for Patient Numbers, e.g. "ANN" — auto-derived if omitted
    lead_control: Optional[str] = None  # "pre_sales" | "branch_admin" — see backend/lead_control.py


class AssignAdmin(BaseModel):
    admin_user_id: str


class AssignHeadPhysio(BaseModel):
    doctor_id: str


class BranchArchiveInput(BaseModel):
    password: str = Field(..., description="Acting Super Admin's own login password")


@router.get("")
async def list_branches_full(archived: bool = False, _: V3UserOut = Depends(v3_require_roles("super_admin", "business_dev", "marketing_head"))):
    q = {"archived": True} if archived else {"archived": {"$ne": True}}
    branches = await v3_col("branches").find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    # Enrich each branch with stats
    out = []
    for b in branches:
        bid = b["id"]
        leads_total = await v3_col("leads").count_documents({"branch_id": bid})
        leads_open = await v3_col("leads").count_documents({"branch_id": bid, "stage": {"$nin": ["Completed", "Lost"]}})
        leads_completed = await v3_col("leads").count_documents({"branch_id": bid, "stage": "Completed"})
        appointments = await v3_col("appointments").count_documents({"branch_id": bid})
        doctors = await v3_col("doctors").count_documents({"branch_id": bid})
        out.append({
            **b,
            "leads_total": leads_total,
            "leads_open": leads_open,
            "leads_completed": leads_completed,
            "appointments_count": appointments,
            "doctors_count": doctors,
        })
    return out


@router.post("/{branch_id}/archive")
async def archive_branch(branch_id: str, payload: BranchArchiveInput, user: V3UserOut = Depends(v3_require_roles("super_admin"))):
    # Soft-delete: keeps the branch, its admin user, and its leads/appointments intact
    # (unlike DELETE /branches/{id}, which hard-deletes) — gated by the acting Super
    # Admin re-entering their own login password so archiving isn't a stray misclick.
    account = await v3_col("users").find_one({"id": user.id}, {"_id": 0, "password": 1})
    if not account or not verify_password(payload.password, account.get("password", "")):
        raise HTTPException(status_code=401, detail="Incorrect password")
    existing = await v3_col("branches").find_one({"id": branch_id}, {"_id": 0, "id": 1})
    if not existing:
        raise HTTPException(status_code=404, detail="Branch not found")
    await v3_col("branches").update_one(
        {"id": branch_id},
        {"$set": {"archived": True, "archived_at": now_iso(), "archived_by": user.full_name}},
    )
    return {"message": "Branch archived"}


@router.post("/{branch_id}/restore")
async def restore_branch(branch_id: str, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    res = await v3_col("branches").update_one(
        {"id": branch_id},
        {"$set": {"archived": False}, "$unset": {"archived_at": "", "archived_by": ""}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Branch not found")
    return {"message": "Branch restored"}


@router.post("/with-existing-admin")
async def create_branch_with_existing_admin(payload: BranchAssignedCreate, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    user = await v3_col("users").find_one({"id": payload.admin_user_id, "is_active": True}, {"_id": 0, "password": 0})
    if not user:
        raise HTTPException(status_code=404, detail="Branch admin user not found")
    if not is_branch_admin_role(user.get("role")):
        raise HTTPException(status_code=400, detail=f"User role is '{user.get('role')}', must be a Branch Admin role")
    # Soft check: warn if user already assigned to another branch
    already = await v3_col("branches").find_one({"admin_user_id": payload.admin_user_id}, {"_id": 0, "id": 1, "branch_name": 1})
    if already:
        raise HTTPException(status_code=409, detail=f"User already assigned to branch '{already.get('branch_name')}'")

    branch_id = str(uuid.uuid4())
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
        "admin_user_id": payload.admin_user_id,
        "admin_name": user.get("full_name", ""),
        "admin_email": user.get("email", ""),
        "admin_phone": payload.admin_phone or "",
        "vertical": payload.vertical or "offline_physiotherapy",
        "opened_date": payload.opened_date or "",
        "opening_hours": payload.opening_hours or "",
        "phone": payload.phone or "",
        "email": payload.email or "",
        "map_location": payload.map_location or "",
        "weekly_hours": payload.weekly_hours or {},
        "holidays": payload.holidays or [],
        "lead_control": lead_control.normalize(payload.lead_control),
        "created_at": now_iso(),
    }
    await v3_col("branches").insert_one(branch.copy())
    # Update user.branch_id
    await v3_col("users").update_one({"id": payload.admin_user_id}, {"$set": {"branch_id": branch_id}})
    return branch


@router.patch("/{branch_id}/admin")
async def reassign_branch_admin(branch_id: str, payload: AssignAdmin, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    branch = await v3_col("branches").find_one({"id": branch_id}, {"_id": 0})
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")
    user = await v3_col("users").find_one({"id": payload.admin_user_id, "is_active": True}, {"_id": 0, "password": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not is_branch_admin_role(user.get("role")):
        raise HTTPException(status_code=400, detail=f"User role must be a Branch Admin role (current: {user.get('role')})")
    other = await v3_col("branches").find_one({"admin_user_id": payload.admin_user_id, "id": {"$ne": branch_id}}, {"_id": 0, "branch_name": 1})
    if other:
        raise HTTPException(status_code=409, detail=f"User already manages '{other.get('branch_name')}'")

    # Unlink previous admin (if any) from this branch
    prev_admin_id = branch.get("admin_user_id")
    if prev_admin_id and prev_admin_id != payload.admin_user_id:
        await v3_col("users").update_one({"id": prev_admin_id}, {"$set": {"branch_id": None}})

    await v3_col("branches").update_one(
        {"id": branch_id},
        {"$set": {
            "admin_user_id": payload.admin_user_id,
            "admin_name": user.get("full_name", ""),
            "admin_email": user.get("email", ""),
        }},
    )
    await v3_col("users").update_one({"id": payload.admin_user_id}, {"$set": {"branch_id": branch_id}})
    return await v3_col("branches").find_one({"id": branch_id}, {"_id": 0})


@router.get("/head-physio-candidates")
async def head_physio_candidates(_: V3UserOut = Depends(v3_require_roles("super_admin"))):
    rows = await v3_col("doctors").find({"profile_type": "head_physio"}, {"_id": 0}).to_list(500)
    branches = {b["id"]: b.get("branch_name") for b in await v3_col("branches").find({}, {"_id": 0, "id": 1, "branch_name": 1}).to_list(500)}
    return [{**d, "assigned_branch": branches.get(d.get("branch_id")) if d.get("branch_id") else None} for d in rows]


@router.patch("/{branch_id}/head-physio")
async def assign_head_physio(branch_id: str, payload: AssignHeadPhysio, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    branch = await v3_col("branches").find_one({"id": branch_id}, {"_id": 0})
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")
    doctor = await v3_col("doctors").find_one({"id": payload.doctor_id, "profile_type": "head_physio"}, {"_id": 0})
    if not doctor:
        raise HTTPException(status_code=404, detail="CONSULTANT not found")

    # Assigns or moves this Head Physio to the given branch (overwrites any prior branch link).
    await v3_col("doctors").update_one({"id": payload.doctor_id}, {"$set": {"branch_id": branch_id}})
    if doctor.get("user_id"):
        await v3_col("users").update_one({"id": doctor["user_id"]}, {"$set": {"branch_id": branch_id}})
    return await v3_col("doctors").find_one({"id": payload.doctor_id}, {"_id": 0})


@router.get("/{branch_id}/performance")
async def branch_performance(branch_id: str, _: V3UserOut = Depends(v3_require_roles("super_admin", "business_dev", "marketing_head"))):
    branch = await v3_col("branches").find_one({"id": branch_id}, {"_id": 0})
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")

    leads_total = await v3_col("leads").count_documents({"branch_id": branch_id})
    leads_pipeline = [
        {"$match": {"branch_id": branch_id}},
        {"$group": {"_id": "$stage", "n": {"$sum": 1}}},
    ]
    stage_breakdown: Dict[str, int] = {}
    async for row in v3_col("leads").aggregate(leads_pipeline):
        stage_breakdown[row["_id"] or "Unknown"] = row["n"]

    appointments_total = await v3_col("appointments").count_documents({"branch_id": branch_id})
    appointments_completed = await v3_col("appointments").count_documents({"branch_id": branch_id, "status": "completed"})
    completed = stage_breakdown.get("Completed", 0)
    conversion = (completed / leads_total * 100.0) if leads_total else 0.0

    # Revenue: consultation_fee + package_amount on this branch's leads
    revenue_pipeline = [
        {"$match": {"branch_id": branch_id}},
        {"$group": {"_id": None,
                    "consultation_fees": {"$sum": {"$ifNull": ["$consultation_fee", 0]}},
                    "package_revenue": {"$sum": {"$ifNull": ["$package_amount", 0]}}}},
    ]
    rev_rows = await v3_col("leads").aggregate(revenue_pipeline).to_list(1)
    revenue = rev_rows[0] if rev_rows else {"consultation_fees": 0, "package_revenue": 0}

    doctors = await v3_col("doctors").count_documents({"branch_id": branch_id})
    # Both physio slugs — an Online Physio is one of the branch's physios, and counting
    # only the floor ones understates the team on every branch that runs online.
    physios = await v3_col("users").count_documents({"branch_id": branch_id, "role": {"$in": list(PHYSIO_ROLES)}, "is_active": True})
    head_physios = await v3_col("users").count_documents({"branch_id": branch_id, "role": "head_physio", "is_active": True})

    return {
        "branch": branch,
        "kpis": {
            "leads_total": leads_total,
            "leads_completed": completed,
            "conversion_rate": round(conversion, 1),
            "appointments_total": appointments_total,
            "appointments_completed": appointments_completed,
            "consultation_fees": revenue.get("consultation_fees", 0),
            "package_revenue": revenue.get("package_revenue", 0),
            "total_revenue": (revenue.get("consultation_fees", 0) or 0) + (revenue.get("package_revenue", 0) or 0),
            "doctors": doctors,
            "physios": physios,
            "head_physios": head_physios,
        },
        "stage_breakdown": [{"stage": k, "count": v} for k, v in stage_breakdown.items()],
    }


@router.get("/performance-summary")
async def performance_summary(_: V3UserOut = Depends(v3_require_roles("super_admin", "business_dev", "marketing_head"))):
    branches = await v3_col("branches").find({}, {"_id": 0}).to_list(500)
    summary: List[Dict[str, Any]] = []
    for b in branches:
        bid = b["id"]
        leads_total = await v3_col("leads").count_documents({"branch_id": bid})
        completed = await v3_col("leads").count_documents({"branch_id": bid, "stage": "Completed"})
        conversion = (completed / leads_total * 100.0) if leads_total else 0.0
        rev_rows = await v3_col("leads").aggregate([
            {"$match": {"branch_id": bid}},
            {"$group": {"_id": None,
                        "consultation_fees": {"$sum": {"$ifNull": ["$consultation_fee", 0]}},
                        "package_revenue": {"$sum": {"$ifNull": ["$package_amount", 0]}}}},
        ]).to_list(1)
        rev = rev_rows[0] if rev_rows else {"consultation_fees": 0, "package_revenue": 0}
        total_rev = (rev.get("consultation_fees", 0) or 0) + (rev.get("package_revenue", 0) or 0)
        summary.append({
            "branch_id": bid,
            "branch_name": b.get("branch_name"),
            "admin_name": b.get("admin_name"),
            "address": b.get("address"),
            "leads_total": leads_total,
            "leads_completed": completed,
            "conversion_rate": round(conversion, 1),
            "total_revenue": total_rev,
        })
    return summary



@router.get("/{branch_id}/detail")
async def branch_detail(branch_id: str, user: V3UserOut = Depends(v3_require_roles("super_admin", "business_dev", "marketing_head", "branch_admin"))):
    # A Branch Admin may view their own branch's detail (read-only Manager view);
    # everyone else with a management role may view any branch.
    if is_branch_admin_role(user.role) and user.branch_id != branch_id:
        raise HTTPException(status_code=403, detail="You can only view your own branch")
    branch = await v3_col("branches").find_one({"id": branch_id}, {"_id": 0})
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")

    admin_user = None
    if branch.get("admin_user_id"):
        admin_user = await v3_col("users").find_one({"id": branch["admin_user_id"]}, {"_id": 0, "password": 0})

    staff_rows = await v3_col("users").find({"branch_id": branch_id, "is_active": True}, {"_id": 0, "password": 0}).to_list(500)
    head_physios = [u for u in staff_rows if u.get("role") == "head_physio"]
    physios = [u for u in staff_rows if is_physio_role(u.get("role"))]
    branch_admins = [u for u in staff_rows if u.get("role") == "branch_admin"]

    doctors = await v3_col("doctors").find({"branch_id": branch_id}, {"_id": 0}).to_list(500)

    appointments = await v3_col("appointments").find({"branch_id": branch_id}, {"_id": 0}).sort("appointment_time", -1).to_list(500)
    appt_completed = len([a for a in appointments if a.get("status") == "completed"])
    appt_scheduled = len([a for a in appointments if a.get("status") in ("scheduled", "confirmed")])
    appt_cancelled = len([a for a in appointments if a.get("status") == "cancelled"])

    leads = await v3_col("leads").find({"branch_id": branch_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    consultations = [ld for ld in leads if ld.get("consultation_fee") and ld.get("consultation_fee") > 0]
    packages = [ld for ld in leads if ld.get("package_amount") and ld.get("package_amount") > 0]
    consultation_total = sum((ld.get("consultation_fee") or 0) for ld in consultations)
    package_total = sum((ld.get("package_amount") or 0) for ld in packages)

    followups = []
    for ld in leads:
        for f in (ld.get("follow_ups") or []):
            followups.append({**f, "lead_id": ld["id"], "lead_name": ld.get("name", "")})
    followups_open = len([f for f in followups if not f.get("completed")])
    followups_done = len([f for f in followups if f.get("completed")])

    weekly_assessments = []
    for ld in leads:
        for w in (ld.get("head_physio_weekly_reviews") or []):
            weekly_assessments.append({**w, "lead_id": ld["id"], "lead_name": ld.get("name", "")})

    head_physio_calendars = [d for d in doctors if d.get("profile_type") == "head_physio"]
    physio_calendars = [d for d in doctors if d.get("profile_type") == "physio"]

    return {
        "branch": branch,
        "admin_user": admin_user,
        "staff": {
            "branch_admins": branch_admins,
            "head_physios": head_physios,
            "physios": physios,
            "doctors": doctors,
        },
        "performance": {
            "kpis": {
                "leads_total": len(leads),
                "leads_open": len([ld for ld in leads if ld.get("stage") not in ("Completed", "Lost")]),
                "leads_completed": len([ld for ld in leads if ld.get("stage") == "Completed"]),
            },
            "appointments": {
                "list": appointments[:50],
                "total": len(appointments),
                "completed": appt_completed,
                "scheduled": appt_scheduled,
                "cancelled": appt_cancelled,
            },
            "consultations": {
                "list": consultations[:50],
                "total_count": len(consultations),
                "total_amount": consultation_total,
            },
            "packages": {
                "list": packages[:50],
                "total_count": len(packages),
                "total_amount": package_total,
            },
            "follow_ups": {
                "list": followups[:100],
                "open": followups_open,
                "done": followups_done,
                "total": len(followups),
            },
        },
        "head_physio_section": {
            "calendars": head_physio_calendars,
            "physio_calendars": physio_calendars,
            "post_treatment_reviews": weekly_assessments[:100],
        },
    }