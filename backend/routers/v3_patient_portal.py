"""Client Portal — a login (email + password) Branch Admin generates for a patient once
their Treatment Fee is paid, so the patient can check their own session progress without
staff involvement.

Kept in its own patient_portal_accounts / patient_portal_sessions collections rather than
reusing `users`/`sessions` — those are staff-only, and `sessions` already carries a second,
unrelated shape (treatment-session bookings, deliberately, per v3_reviews.py's docstring
about what happened the last time this collection grew a second shape); a third shape on
top of that is exactly the mistake to avoid, not repeat.
"""
import random
import string
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException

from database import v3_col
from utils import now_iso
from security import hash_password, verify_password
from deps import v3_require_roles
from schemas.v3 import V3UserOut, V3PortalAccountInput, V3PatientPortalLogin

router = APIRouter(prefix="/api/v3")


def _generate_password(length: int = 8) -> str:
    alphabet = string.ascii_uppercase + string.ascii_lowercase + string.digits
    return "".join(random.choices(alphabet, k=length))


async def _lead_or_404(lead_id: str) -> dict:
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Patient not found")
    return lead


# ------------------------------------------------------------- Branch Admin: manage access

@router.get("/leads/{lead_id}/portal-account")
async def get_portal_account(lead_id: str, user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin"))):
    lead = await _lead_or_404(lead_id)
    if user.role == "branch_admin" and lead.get("branch_id") != user.branch_id:
        raise HTTPException(status_code=404, detail="Patient not found")
    account = await v3_col("patient_portal_accounts").find_one({"lead_id": lead_id}, {"_id": 0, "email": 1, "created_at": 1})
    if not account:
        return {"exists": False}
    return {"exists": True, "email": account["email"], "created_at": account.get("created_at")}


@router.post("/leads/{lead_id}/portal-account")
async def create_or_reset_portal_account(
    lead_id: str,
    payload: V3PortalAccountInput,
    user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin")),
):
    """Create-or-reset in one call: the first time, this creates the account; every call
    after that resets the password (freshly generated unless the caller supplies one),
    since re-sharing a lost password is the same action either way. The plaintext
    password is returned only here, this once — nothing later can ever read it back."""
    lead = await _lead_or_404(lead_id)
    if user.role == "branch_admin" and lead.get("branch_id") != user.branch_id:
        raise HTTPException(status_code=404, detail="Patient not found")
    if lead.get("treatment_fee_paid") is None:
        raise HTTPException(status_code=400, detail="Treatment Fee must be collected before portal access can be created")

    email = (payload.email or lead.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="An email is required for portal access")

    clash = await v3_col("patient_portal_accounts").find_one(
        {"email": email, "lead_id": {"$ne": lead_id}}, {"_id": 0, "id": 1}
    )
    if clash:
        raise HTTPException(status_code=409, detail="This email is already used for another patient's portal account")

    password = (payload.password or "").strip() or _generate_password()
    now = now_iso()
    existing = await v3_col("patient_portal_accounts").find_one({"lead_id": lead_id}, {"_id": 0, "id": 1})
    if existing:
        await v3_col("patient_portal_accounts").update_one(
            {"lead_id": lead_id},
            {"$set": {"email": email, "password_hash": hash_password(password), "updated_at": now, "updated_by": user.full_name}},
        )
    else:
        await v3_col("patient_portal_accounts").insert_one({
            "id": str(uuid.uuid4()),
            "lead_id": lead_id,
            "branch_id": lead.get("branch_id"),
            "email": email,
            "password_hash": hash_password(password),
            "created_at": now,
            "created_by": user.full_name,
            "updated_at": now,
        })
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "portal_account_reset" if existing else "portal_account_created",
        "details": f"{'Reset' if existing else 'Created'} Client Portal access for {email}",
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now,
    })
    return {"email": email, "password": password}


# --------------------------------------------------------------------- Patient: log in

@router.post("/patient-portal/login")
async def patient_portal_login(payload: V3PatientPortalLogin):
    email = payload.email.strip().lower()
    account = await v3_col("patient_portal_accounts").find_one({"email": email}, {"_id": 0})
    if not account or not verify_password(payload.password, account.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    token = str(uuid.uuid4())
    await v3_col("patient_portal_sessions").insert_one({
        "token": token,
        "account_id": account["id"],
        "lead_id": account["lead_id"],
        "created_at": now_iso(),
    })
    lead = await v3_col("leads").find_one({"id": account["lead_id"]}, {"_id": 0, "name": 1})
    return {"token": token, "patient_name": (lead or {}).get("name", "")}


async def _current_patient_lead_id(authorization: str = Header(...)) -> str:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    token = authorization.split(" ", 1)[1].strip()
    session = await v3_col("patient_portal_sessions").find_one({"token": token}, {"_id": 0, "lead_id": 1})
    if not session:
        raise HTTPException(status_code=401, detail="Session expired. Please log in again.")
    return session["lead_id"]


@router.post("/patient-portal/logout")
async def patient_portal_logout(authorization: str = Header(...)):
    if not authorization.startswith("Bearer "):
        return {"message": "Logged out"}
    token = authorization.split(" ", 1)[1].strip()
    await v3_col("patient_portal_sessions").delete_one({"token": token})
    return {"message": "Logged out"}


@router.get("/patient-portal/me")
async def patient_portal_me(lead_id: str = Depends(_current_patient_lead_id)):
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Patient not found")

    sessions = await v3_col("sessions").find({"lead_id": lead_id}, {"_id": 0}).sort("slot_time", 1).to_list(500)
    assessments = await v3_col("weekly_assessments").find({"lead_id": lead_id}, {"_id": 0}).sort("week_number", 1).to_list(100)
    total = len(sessions)
    completed = len([s for s in sessions if s.get("status") == "completed"])

    return {
        "patient_name": lead.get("name", "Unknown"),
        "phone": lead.get("phone", ""),
        "physio_name": next((s.get("physio_name") for s in sessions if s.get("physio_name")), ""),
        "total_sessions": total,
        "completed_sessions": completed,
        "remaining_sessions": total - completed,
        "sessions": [
            {
                "session_number": s.get("session_number"),
                "week_number": s.get("week_number"),
                "slot_time": s.get("slot_time"),
                "status": s.get("status"),
                "jr_physio_remarks": s.get("jr_physio_remarks"),
            }
            for s in sessions
        ],
        "weekly_assessments": [
            {"week_number": a.get("week_number"), "jr_physio_notes": a.get("jr_physio_notes"), "status": a.get("status")}
            for a in assessments
        ],
    }
