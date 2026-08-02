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


def _generate_password(length: int = 10) -> str:
    # No 0/O, 1/l/I or similarly-confusable characters — this is typed by a patient on
    # a phone keyboard, often copy-pasted imperfectly from a WhatsApp message on a small
    # screen, so every character needs to be unambiguous by eye. Length bumped up from 8
    # to 10 to keep entropy reasonable after shrinking the alphabet.
    alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"
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
    """Backs all four Client Portal tabs (Sessions / Treatment / Payment History /
    Profile) in one call — this is the patient's own read-only mirror of what the
    Physio's Patient Detail page already shows, minus anything staff-only (no head
    physio contact info; that's deliberately not returned here at all)."""
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Patient not found")

    sessions = await v3_col("sessions").find({"lead_id": lead_id}, {"_id": 0}).sort("slot_time", 1).to_list(500)
    assessments = await v3_col("weekly_assessments").find({"lead_id": lead_id}, {"_id": 0}).sort("week_number", 1).to_list(100)
    reviews = await v3_col("reviews").find({"lead_id": lead_id}, {"_id": 0}).sort("raised_at", 1).to_list(50)
    total = len(sessions)
    completed = len([s for s in sessions if s.get("status") == "completed"])

    branch = {}
    if lead.get("branch_id"):
        branch = await v3_col("branches").find_one(
            {"id": lead["branch_id"]}, {"_id": 0, "branch_name": 1, "phone": 1, "address": 1}
        ) or {}

    # Every Treatment Fee installment collected so far, split into what's actually
    # been paid vs the next thing due — same math the Physio's own Payment History
    # tab and Branch Admin's Outstanding Amount board use.
    installments = (lead.get("treatment_fee_payment_details") or {}).get("installments") or []
    is_partial = lead.get("treatment_fee_payment_mode") == "partial"
    treatment_paid = (
        sum(i.get("amount", 0) for i in installments if i.get("paid")) if is_partial
        else (lead.get("treatment_fee_paid") or 0)
    )
    unpaid = sorted((i for i in installments if not i.get("paid")), key=lambda i: i.get("due_date", "")) if is_partial else []
    next_due = unpaid[0] if unpaid else None

    return {
        "patient_name": lead.get("name", "Unknown"),
        "phone": lead.get("phone", ""),
        "email": lead.get("email", ""),
        "patient_number": lead.get("patient_number"),
        "age": lead.get("age"),
        "gender": lead.get("gender"),
        "occupation": lead.get("occupation"),
        "address": lead.get("address"),
        "city": lead.get("city"),
        "state": lead.get("state"),
        "condition": lead.get("condition"),

        # Doctor detail card — physio_name from the session docs (same source the
        # Physio board itself uses); head_physio_name is informational only, no
        # contact info is ever included anywhere in this response on purpose.
        "physio_name": next((s.get("physio_name") for s in sessions if s.get("physio_name")), ""),
        "head_physio_name": next((s.get("head_physio_name") for s in sessions if s.get("head_physio_name")), ""),

        "branch_name": branch.get("branch_name", ""),
        "branch_phone": branch.get("phone", ""),
        "branch_address": branch.get("address", ""),

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

        "diagnosis": lead.get("diagnosis"),
        "physio_diagnosis_report": lead.get("physio_diagnosis_report"),
        "treatment_summary": lead.get("treatment_summary"),
        "session_package_name": lead.get("session_package_name"),
        "session_package_sessions": lead.get("session_package_sessions"),

        "reviews": [
            {
                "review_number": (r.get("treatment_days") or 0) // 7,
                "status": r.get("status"),
                "review_date": r.get("review_date"),
                "head_physio_suggestions": r.get("head_physio_suggestions"),
            }
            for r in reviews
        ],

        "payment": {
            "consultation_fee_total": lead.get("package_price"),
            "consultation_fee_paid": lead.get("package_paid"),
            "consultation_payment_mode": lead.get("package_payment_mode"),
            "treatment_fee_total": lead.get("session_package_price"),
            "treatment_fee_paid": treatment_paid,
            "treatment_payment_mode": lead.get("treatment_fee_payment_mode"),
            "is_partial": is_partial,
            "installments_total": len(installments),
            "installments_paid": len([i for i in installments if i.get("paid")]),
            "next_due_amount": next_due.get("amount") if next_due else None,
            "next_due_date": next_due.get("due_date") if next_due else None,
        },
    }
