from fastapi import APIRouter, Depends, HTTPException
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, field_validator
import uuid

from database import v3_col
from utils import now_iso
from deps import v3_require_roles, is_diet_role
from security import hash_password
from schemas.v3 import V3UserOut


router = APIRouter(prefix="/api/v3/hr")


DEFAULT_DEPARTMENTS = ["Pre-Sales", "Branch", "HR", "Accounts", "Operations", "Marketing", "Experts"]
# "online_physio_admin" is the Online Physio Admin: a Branch Admin for a branch's online
# practice, holding the same board and the same reach over one branch. See BRANCH_ADMIN_ROLES
# in deps.py for why it is a fixed slug listed here rather than a custom role — a role whose
# name is typed by hand cannot be aliased to branch_admin safely.
DEFAULT_ROLES = ["super_admin", "business_dev", "pre_sales", "branch_admin", "online_physio_admin", "head_physio", "physio", "marketing_head", "accountant"]

# Both consultant roles can be assigned to more than one branch (a linked `doctors`
# record is kept in sync per branch) — every other role stays pinned to a single branch.
# Physios are assigned to branches — they deliver treatment where they work, and may cover
# more than one. Head Physios are not: they take consultations across the whole
# organisation, so they get a single branchless expert record and are offered everywhere.
# A Nutrition Coach belongs to a branch and holds a calendar there, exactly like a Physio,
# so hiring one has to create the matching `doctors` record or they log in to a board with
# no calendar behind it and nothing explains why.
MULTI_BRANCH_ROLES = {"physio", "nutrition_coach"}
ORG_WIDE_ROLES = {"head_physio"}
EXPERT_ROLES = MULTI_BRANCH_ROLES | ORG_WIDE_ROLES


def _slugify_role(label: str) -> str:
    import re
    slug = re.sub(r"[^a-z0-9]+", "_", label.strip().lower()).strip("_")
    return slug


async def _custom_roles() -> list:
    return await v3_col("custom_roles").find({}, {"_id": 0}).sort("created_at", 1).to_list(200)


async def _all_role_names() -> list:
    return DEFAULT_ROLES + [r["name"] for r in await _custom_roles()]


# The hues the built-in roles already wear. A custom role picks from the same set rather
# than a free hex, so one added today can't arrive in a colour nothing else in the OS uses
# — and so the value can be checked here instead of trusting whatever the client sends.
ROLE_COLORS = [
    "purple", "indigo", "sky", "emerald", "amber",
    "cyan", "pink", "orange", "rose", "teal", "slate",
]


class CustomRoleCreate(BaseModel):
    label: str
    color: Optional[str] = None


class EmployeeCreate(BaseModel):
    full_name: str
    email: Optional[str] = ""
    phone: Optional[str] = ""
    dob: Optional[str] = ""
    gender: Optional[str] = ""
    blood_group: Optional[str] = ""
    marital_status: Optional[str] = ""
    father_name: Optional[str] = ""
    mother_name: Optional[str] = ""
    department: Optional[str] = ""
    designation: Optional[str] = ""
    joining_date: Optional[str] = ""
    reporting_to: Optional[str] = ""
    employee_code: Optional[str] = ""
    pan: Optional[str] = ""
    aadhar: Optional[str] = ""
    address: Optional[str] = ""
    emergency_contact_name: Optional[str] = ""
    emergency_contact_phone: Optional[str] = ""
    net_salary: Optional[float] = 0
    gross_salary: Optional[float] = 0
    bank_name: Optional[str] = ""
    bank_account: Optional[str] = ""
    ifsc: Optional[str] = ""
    status: Optional[str] = "active"
    notes: Optional[str] = ""


class EmployeeUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    dob: Optional[str] = None
    gender: Optional[str] = None
    blood_group: Optional[str] = None
    marital_status: Optional[str] = None
    father_name: Optional[str] = None
    mother_name: Optional[str] = None
    department: Optional[str] = None
    designation: Optional[str] = None
    joining_date: Optional[str] = None
    reporting_to: Optional[str] = None
    employee_code: Optional[str] = None
    pan: Optional[str] = None
    aadhar: Optional[str] = None
    address: Optional[str] = None
    emergency_contact_name: Optional[str] = None
    emergency_contact_phone: Optional[str] = None
    net_salary: Optional[float] = None
    gross_salary: Optional[float] = None
    bank_name: Optional[str] = None
    bank_account: Optional[str] = None
    ifsc: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None


class UserAccountCreate(BaseModel):
    full_name: str
    email: str
    password: str
    # Not a Literal — the allowed set now includes custom roles added at runtime
    # via POST /hr/roles, so membership is checked in the handler instead.
    role: str
    employee_id: Optional[str] = None
    branch_id: Optional[str] = None
    # Only meaningful for role="head_physio"/"physio" — lets a consultant be assigned
    # across several branches. branch_id above stays the primary/first branch
    # so every other single-branch filter in the app keeps working unchanged.
    branch_ids: Optional[List[str]] = None
    mobile_number: Optional[str] = None
    aadhar_number: Optional[str] = None

    @field_validator("role", mode="before")
    @classmethod
    def _normalize_role(cls, v):
        # "consultant" is a legacy/UI alias for "physio" — same permissions, different label.
        return "physio" if v == "consultant" else v


class UserAccountUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None
    employee_id: Optional[str] = None
    branch_id: Optional[str] = None
    branch_ids: Optional[List[str]] = None
    mobile_number: Optional[str] = None
    aadhar_number: Optional[str] = None


async def _next_emp_code() -> str:
    last = await v3_col("employees").find({"employee_code": {"$regex": "^EMP[0-9]+$"}}, {"_id": 0, "employee_code": 1}).sort("employee_code", -1).limit(1).to_list(1)
    if last:
        try:
            n = int(last[0]["employee_code"][3:]) + 1
        except Exception:
            n = (await v3_col("employees").count_documents({})) + 1
    else:
        n = 1
    return f"EMP{n:04d}"


# ---------- Dashboard ----------

@router.get("/dashboard")
async def hr_dashboard(_: V3UserOut = Depends(v3_require_roles("super_admin", "marketing_head"))):
    active_employees = await v3_col("employees").count_documents({"status": "active"})
    total_users = await v3_col("users").count_documents({"is_active": True})

    dept_pipeline = [{"$group": {"_id": "$department", "n": {"$sum": 1}}}]
    rows = await v3_col("employees").aggregate(dept_pipeline).to_list(50)
    by_dept: Dict[str, int] = {}
    for r in rows:
        key = r["_id"] or "Unassigned"
        by_dept[key] = r["n"]
    departments_count = len([k for k in by_dept.keys() if k != "Unassigned"])

    salary_pipeline = [{"$match": {"status": "active"}}, {"$group": {"_id": None, "total": {"$sum": "$net_salary"}}}]
    salary_rows = await v3_col("employees").aggregate(salary_pipeline).to_list(1)
    monthly_salary = salary_rows[0]["total"] if salary_rows else 0

    return {
        "kpis": {
            "active_employees": active_employees,
            "total_users": total_users,
            "present_today": 0,
            "late_today": 0,
            "pending_leaves": 0,
            "monthly_salary_budget": monthly_salary,
            "departments": departments_count,
        },
        "department_strength": [{"name": k, "count": v} for k, v in by_dept.items()],
    }


# ---------- Employees CRUD ----------

async def _next_emp_code_legacy() -> str:
    cnt = await v3_col("employees").count_documents({})
    return f"EMP{(cnt + 1):04d}"


@router.get("/employees")
async def list_employees(status: Optional[str] = None, _: V3UserOut = Depends(v3_require_roles("super_admin", "marketing_head"))):
    q: Dict[str, Any] = {}
    if status:
        q["status"] = status
    rows = await v3_col("employees").find(q, {"_id": 0}).sort("created_at", -1).to_list(2000)
    return rows


@router.post("/employees")
async def create_employee(payload: EmployeeCreate, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    # Department and Designation are what every downstream view groups and colour-codes
    # employees by, so an employee without them is unusable — required at the API too,
    # not just in the form.
    if not (payload.department or "").strip():
        raise HTTPException(status_code=400, detail="Department is required")
    if not (payload.designation or "").strip():
        raise HTTPException(status_code=400, detail="Designation is required")
    doc = payload.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["employee_code"] = doc.get("employee_code") or await _next_emp_code()
    doc["status"] = doc.get("status") or "active"
    doc["created_at"] = now_iso()
    doc["updated_at"] = now_iso()
    await v3_col("employees").insert_one(doc.copy())
    return doc


@router.patch("/employees/{emp_id}")
async def update_employee(emp_id: str, payload: EmployeeUpdate, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No updates")
    # Omitting these on a partial update is fine; explicitly clearing them is not — an
    # existing employee must not be left without a department or designation.
    for field, label in (("department", "Department"), ("designation", "Designation")):
        if field in updates and not str(updates[field]).strip():
            raise HTTPException(status_code=400, detail=f"{label} is required")
    updates["updated_at"] = now_iso()
    res = await v3_col("employees").update_one({"id": emp_id}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Employee not found")
    if "full_name" in updates:
        # Cascade the rename to any linked User account, and from there to their doctors
        # record too — full_name is denormalized across employees/users/doctors.
        linked_user_ids = await v3_col("users").distinct("id", {"employee_id": emp_id})
        if linked_user_ids:
            await v3_col("users").update_many({"employee_id": emp_id}, {"$set": {"full_name": updates["full_name"]}})
            await v3_col("doctors").update_many({"user_id": {"$in": linked_user_ids}}, {"$set": {"full_name": updates["full_name"]}})
    return await v3_col("employees").find_one({"id": emp_id}, {"_id": 0})


@router.delete("/employees/{emp_id}")
async def delete_employee(emp_id: str, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    res = await v3_col("employees").delete_one({"id": emp_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Employee not found")
    # Unlink any users tied to this employee
    await v3_col("users").update_many({"employee_id": emp_id}, {"$set": {"employee_id": None}})
    return {"message": "Employee deleted"}


# ---------- Roles & Credentials ----------

@router.get("/users")
async def list_users(search: Optional[str] = None, role: Optional[str] = None, _: V3UserOut = Depends(v3_require_roles("super_admin", "marketing_head"))):
    q: Dict[str, Any] = {}
    if role and role != "all":
        q["role"] = role
    if search:
        rgx = {"$regex": search, "$options": "i"}
        q["$or"] = [{"full_name": rgx}, {"email": rgx}]
    rows = await v3_col("users").find(q, {"_id": 0, "password": 0}).sort("created_at", -1).to_list(1000)
    # Enrich with linked employee
    emp_ids = [r.get("employee_id") for r in rows if r.get("employee_id")]
    emps = {}
    if emp_ids:
        async for emp in v3_col("employees").find({"id": {"$in": emp_ids}}, {"_id": 0}):
            emps[emp["id"]] = {"employee_code": emp.get("employee_code"), "designation": emp.get("designation"), "full_name": emp.get("full_name")}
    # Which branch each account belongs to. Three different answers are possible and the
    # column has to tell them apart, so the shape is a list plus a flag rather than one
    # string that would have to mean all of them:
    #
    #   org-wide      a Head Physio covers every branch and holds no branch of their own.
    #                 An empty branch list on them means "all", not "none".
    #   multi-branch  a Physio or Nutrition Coach can serve several, held in branch_ids.
    #   single        everyone else, on branch_id.
    branch_docs = await v3_col("branches").find({}, {"_id": 0, "id": 1, "branch_name": 1}).to_list(500)
    bmap = {b["id"]: b.get("branch_name", "") for b in branch_docs}
    for r in rows:
        r["linked_employee"] = emps.get(r.get("employee_id"))
        ids = r.get("branch_ids") or ([r["branch_id"]] if r.get("branch_id") else [])
        r["branches"] = [{"id": i, "name": bmap.get(i) or "Unknown branch"} for i in ids if i]
        r["org_wide"] = r.get("role") in ORG_WIDE_ROLES
    return rows


@router.post("/users")
async def create_user_account(payload: UserAccountCreate, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    if payload.role == "super_admin":
        raise HTTPException(status_code=403, detail="Super Admin accounts can only be created via the OTP-approved Super Admin creation page")
    if payload.role not in await _all_role_names():
        raise HTTPException(status_code=400, detail="Invalid role")
    if len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    existing = await v3_col("users").find_one({"email": payload.email}, {"_id": 0, "id": 1})
    if existing:
        raise HTTPException(status_code=409, detail="Email already in use")
    if payload.employee_id:
        emp = await v3_col("employees").find_one({"id": payload.employee_id}, {"_id": 0, "id": 1})
        if not emp:
            raise HTTPException(status_code=404, detail="Linked employee not found")
    user = {
        "id": str(uuid.uuid4()),
        "full_name": payload.full_name,
        "email": payload.email,
        "password": hash_password(payload.password),
        "role": payload.role,
        "branch_id": payload.branch_id,
        "branch_ids": payload.branch_ids,
        "employee_id": payload.employee_id,
        "mobile_number": payload.mobile_number,
        "aadhar_number": payload.aadhar_number,
        "is_active": True,
        "created_at": now_iso(),
    }
    await v3_col("users").insert_one(user.copy())
    if is_diet_role(payload.role) and payload.role != "super_admin":
        # A diet role belongs to a branch and holds a calendar there, exactly like a Physio.
        for b_id in (payload.branch_ids or [payload.branch_id]):
            await v3_col("doctors").insert_one({
                "id": str(uuid.uuid4()),
                "full_name": payload.full_name,
                "profile_type": "nutrition_coach",
                "branch_id": b_id,
                "specialization": "",
                "slots": [],
                "slot_details": [],
                "user_id": user["id"],
                "created_at": now_iso(),
            })
    elif payload.role in ORG_WIDE_ROLES:
        # One branchless record — a Head Physio has one calendar the whole organisation
        # books against, not a separate one per branch.
        await v3_col("doctors").insert_one({
            "id": str(uuid.uuid4()),
            "full_name": payload.full_name,
            "profile_type": payload.role,
            "branch_id": None,
            "specialization": "",
            "slots": [],
            "slot_details": [],
            "user_id": user["id"],
            "created_at": now_iso(),
        })
    elif payload.role in MULTI_BRANCH_ROLES:
        # One doctors record per assigned branch (each branch's calendar/booking is
        # scoped to its own record) — plain single-branch case is just a list of one.
        for b_id in (payload.branch_ids or [payload.branch_id]):
            await v3_col("doctors").insert_one({
                "id": str(uuid.uuid4()),
                "full_name": payload.full_name,
                "profile_type": payload.role,
                "branch_id": b_id,
                "specialization": "",
                "slots": [],
                "slot_details": [],
                "user_id": user["id"],
                "created_at": now_iso(),
            })
    safe = {k: v for k, v in user.items() if k != "password"}
    return safe


async def _guard_super_admin_target(user_id: str, caller: V3UserOut) -> None:
    """Only a Super Admin may act on a Super Admin's account.

    HR now reaches these endpoints, and without this an HR user could deactivate, delete,
    rename or reset the password of the Super Admin who granted them the role — locking the
    owner out of their own OS. Creating or promoting *to* super_admin was already blocked
    elsewhere; this closes the other direction.
    """
    if caller.role == "super_admin":
        return
    target = await v3_col("users").find_one({"id": user_id}, {"_id": 0, "role": 1})
    if target and target.get("role") == "super_admin":
        raise HTTPException(status_code=403, detail="Only a Super Admin can change a Super Admin account")


@router.patch("/users/{user_id}")
async def update_user_account(user_id: str, payload: UserAccountUpdate, caller: V3UserOut = Depends(v3_require_roles("super_admin"))):
    await _guard_super_admin_target(user_id, caller)
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No updates provided")
    if "email" in updates:
        existing = await v3_col("users").find_one({"email": updates["email"], "id": {"$ne": user_id}}, {"_id": 0, "id": 1})
        if existing:
            raise HTTPException(status_code=409, detail="Email already in use")
    if updates.get("employee_id"):
        emp = await v3_col("employees").find_one({"id": updates["employee_id"]}, {"_id": 0, "id": 1})
        if not emp:
            raise HTTPException(status_code=404, detail="Linked employee not found")

    branch_ids = updates.get("branch_ids")
    if branch_ids is not None:
        # branch_id stays in sync as the primary/first branch, since every other
        # single-branch filter in the app (leads, finance, sessions...) still reads it.
        updates["branch_id"] = branch_ids[0] if branch_ids else None

    res = await v3_col("users").update_one({"id": user_id}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    user = await v3_col("users").find_one({"id": user_id}, {"_id": 0, "password": 0})
    if "full_name" in updates:
        # Both `doctors` (Experts picker, calendars) and `employees` keep their own denormalized
        # copy of full_name — keep them in sync so a rename doesn't leave stale names elsewhere.
        await v3_col("doctors").update_many({"user_id": user_id}, {"$set": {"full_name": updates["full_name"]}})
        if user and user.get("employee_id"):
            await v3_col("employees").update_one({"id": user["employee_id"]}, {"$set": {"full_name": updates["full_name"], "updated_at": now_iso()}})

    if branch_ids is not None and user and user.get("role") in MULTI_BRANCH_ROLES:
        # Add a doctors record for any newly-assigned branch that doesn't already have
        # one. Branches removed from the list are left as-is so their existing calendar
        # slots/appointments aren't destroyed by an accidental unassign.
        existing_docs = await v3_col("doctors").find(
            {"user_id": user_id, "profile_type": user["role"]}, {"_id": 0, "branch_id": 1}
        ).to_list(50)
        existing_branch_ids = {d.get("branch_id") for d in existing_docs}
        for b_id in branch_ids:
            if b_id not in existing_branch_ids:
                await v3_col("doctors").insert_one({
                    "id": str(uuid.uuid4()),
                    "full_name": user["full_name"],
                    "profile_type": user["role"],
                    "branch_id": b_id,
                    "specialization": "",
                    "slots": [],
                    "slot_details": [],
                    "user_id": user_id,
                    "created_at": now_iso(),
                })
    return user


@router.patch("/users/{user_id}/role")
async def update_user_role(user_id: str, role: str, caller: V3UserOut = Depends(v3_require_roles("super_admin"))):
    await _guard_super_admin_target(user_id, caller)
    if role not in await _all_role_names():
        raise HTTPException(status_code=400, detail="Invalid role")
    if role == "super_admin":
        raise HTTPException(status_code=403, detail="Super Admin accounts can only be created via the OTP-approved Super Admin creation page")
    res = await v3_col("users").update_one({"id": user_id}, {"$set": {"role": role}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    if role in EXPERT_ROLES:
        user = await v3_col("users").find_one({"id": user_id}, {"_id": 0})
        existing_docs = await v3_col("doctors").find(
            {"user_id": user_id, "profile_type": role}, {"_id": 0, "branch_id": 1}
        ).to_list(50)
        existing_branch_ids = {d.get("branch_id") for d in existing_docs}
        # A Head Physio needs exactly one record and it belongs to no branch; a Physio
        # needs one per branch they cover.
        wanted = [None] if role in ORG_WIDE_ROLES else (user.get("branch_ids") or [user.get("branch_id")])
        for b_id in wanted:
            if b_id not in existing_branch_ids:
                await v3_col("doctors").insert_one({
                    "id": str(uuid.uuid4()),
                    "full_name": user["full_name"],
                    "profile_type": role,
                    "branch_id": b_id,
                    "specialization": "",
                    "slots": [],
                    "slot_details": [],
                    "user_id": user_id,
                    "created_at": now_iso(),
                })
    return {"message": "Role updated"}


@router.patch("/users/{user_id}/reset-password")
async def reset_password(user_id: str, password: str, caller: V3UserOut = Depends(v3_require_roles("super_admin"))):
    await _guard_super_admin_target(user_id, caller)
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="Password too short (min 6)")
    res = await v3_col("users").update_one({"id": user_id}, {"$set": {"password": hash_password(password)}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"message": "Password reset"}


@router.delete("/users/{user_id}")
async def deactivate_user(user_id: str, caller: V3UserOut = Depends(v3_require_roles("super_admin"))):
    await _guard_super_admin_target(user_id, caller)
    res = await v3_col("users").update_one({"id": user_id}, {"$set": {"is_active": False}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"message": "User deactivated"}


@router.patch("/users/{user_id}/activate")
async def activate_user(user_id: str, caller: V3UserOut = Depends(v3_require_roles("super_admin"))):
    await _guard_super_admin_target(user_id, caller)
    res = await v3_col("users").update_one({"id": user_id}, {"$set": {"is_active": True}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"message": "User activated"}


@router.delete("/users/{user_id}/permanent")
async def delete_user_permanent(user_id: str, current: V3UserOut = Depends(v3_require_roles("super_admin"))):
    if user_id == current.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")
    await _guard_super_admin_target(user_id, current)
    res = await v3_col("users").delete_one({"id": user_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"message": "User permanently deleted"}


# ---------- Branch Admin Picker (for super-admin Branch creation flow) ----------

@router.get("/branch-admin-candidates")
async def branch_admin_candidates(_: V3UserOut = Depends(v3_require_roles("super_admin"))):
    rows = await v3_col("users").find({"role": "branch_admin", "is_active": True}, {"_id": 0, "password": 0}).to_list(500)
    branches = {}
    async for b in v3_col("branches").find({}, {"_id": 0}):
        branches[b.get("admin_user_id")] = b
    out = []
    for u in rows:
        out.append({
            "id": u["id"],
            "full_name": u.get("full_name"),
            "email": u.get("email"),
            "branch_id": u.get("branch_id"),
            "assigned_branch": branches.get(u["id"], {}).get("branch_name") if branches.get(u["id"]) else None,
        })
    return out


@router.post("/roles")
async def add_custom_role(payload: CustomRoleCreate, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    """Add a new selectable Role name (e.g. "Tech Manager" -> tech_manager) so it
    shows up in Create User Account going forward. This only registers the name —
    it has no page/permission access wired up on its own; that's a separate,
    later step once there's an actual screen or endpoint meant for it."""
    label = payload.label.strip()
    if not label:
        raise HTTPException(status_code=400, detail="Role name is required")
    slug = _slugify_role(label)
    if not slug:
        raise HTTPException(status_code=400, detail="Role name must contain letters or numbers")
    if slug in await _all_role_names():
        raise HTTPException(status_code=409, detail="This role already exists")
    color = (payload.color or "").strip().lower()
    if color and color not in ROLE_COLORS:
        raise HTTPException(status_code=400, detail=f"Colour must be one of: {', '.join(ROLE_COLORS)}")
    # Falls to slate rather than to nothing: a role with no colour rendered as the same
    # grey as "unrecognised role", so a deliberate choice and a missing one looked alike.
    role = {
        "id": str(uuid.uuid4()),
        "name": slug,
        "label": label.upper(),
        "color": color or "slate",
        "created_at": now_iso(),
    }
    await v3_col("custom_roles").insert_one(role.copy())
    return role


@router.get("/meta")
async def hr_meta(_: V3UserOut = Depends(v3_require_roles("super_admin", "marketing_head"))):
    custom = await _custom_roles()
    return {
        "departments": DEFAULT_DEPARTMENTS,
        "roles": DEFAULT_ROLES + [r["name"] for r in custom],
        "custom_roles": custom,
    }
