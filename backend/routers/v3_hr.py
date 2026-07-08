from fastapi import APIRouter, Depends, HTTPException
from typing import Optional, List, Literal, Dict, Any
from pydantic import BaseModel
import uuid

from database import v3_col
from utils import now_iso
from deps import v3_require_roles
from security import hash_password
from schemas.v3 import V3UserOut


router = APIRouter(prefix="/api/v3/hr")


DEFAULT_DEPARTMENTS = ["Pre-Sales", "Branch", "HR", "Accounts", "Operations", "Marketing", "Experts"]
DEFAULT_ROLES = ["super_admin", "business_dev", "pre_sales", "branch_admin", "head_physio", "physio", "marketing_head"]


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
    role: Literal["super_admin", "business_dev", "pre_sales", "branch_admin", "head_physio", "physio", "marketing_head"]
    employee_id: Optional[str] = None
    branch_id: Optional[str] = None
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
    updates["updated_at"] = now_iso()
    res = await v3_col("employees").update_one({"id": emp_id}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Employee not found")
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
    for r in rows:
        r["linked_employee"] = emps.get(r.get("employee_id"))
    return rows


@router.post("/users")
async def create_user_account(payload: UserAccountCreate, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
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
        "employee_id": payload.employee_id,
        "mobile_number": payload.mobile_number,
        "aadhar_number": payload.aadhar_number,
        "is_active": True,
        "created_at": now_iso(),
    }
    await v3_col("users").insert_one(user.copy())
    safe = {k: v for k, v in user.items() if k != "password"}
    return safe


@router.patch("/users/{user_id}/role")
async def update_user_role(user_id: str, role: str, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    if role not in DEFAULT_ROLES:
        raise HTTPException(status_code=400, detail="Invalid role")
    res = await v3_col("users").update_one({"id": user_id}, {"$set": {"role": role}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"message": "Role updated"}


@router.patch("/users/{user_id}/reset-password")
async def reset_password(user_id: str, password: str, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="Password too short (min 6)")
    res = await v3_col("users").update_one({"id": user_id}, {"$set": {"password": hash_password(password)}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"message": "Password reset"}


@router.delete("/users/{user_id}")
async def deactivate_user(user_id: str, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    res = await v3_col("users").update_one({"id": user_id}, {"$set": {"is_active": False}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"message": "User deactivated"}


@router.patch("/users/{user_id}/activate")
async def activate_user(user_id: str, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    res = await v3_col("users").update_one({"id": user_id}, {"$set": {"is_active": True}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"message": "User activated"}


@router.delete("/users/{user_id}/permanent")
async def delete_user_permanent(user_id: str, current: V3UserOut = Depends(v3_require_roles("super_admin"))):
    if user_id == current.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")
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


@router.get("/meta")
async def hr_meta(_: V3UserOut = Depends(v3_require_roles("super_admin", "marketing_head"))):
    return {"departments": DEFAULT_DEPARTMENTS, "roles": DEFAULT_ROLES}
