import hashlib
import secrets
import uuid
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from database import v3_col
from utils import now_iso, now_utc
from security import hash_password
from email_utils import send_email

router = APIRouter(prefix="/api/v3/public/super-admin")

CONTROL_EMAIL = "fitsiomaxtech@gmail.com"
OTP_TTL_MINUTES = 10
MAX_OTP_ATTEMPTS = 5
RESEND_COOLDOWN_SECONDS = 60


class SuperAdminOtpRequest(BaseModel):
    full_name: str
    email: str
    mobile_number: Optional[str] = None
    password: str


class SuperAdminOtpVerify(BaseModel):
    request_id: str
    otp: str


def _hash_otp(otp: str) -> str:
    return hashlib.sha256(otp.encode()).hexdigest()


@router.post("/request-otp")
async def request_super_admin_otp(payload: SuperAdminOtpRequest):
    if len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    if payload.mobile_number and not payload.mobile_number.isdigit():
        raise HTTPException(status_code=400, detail="Mobile number must contain digits only")

    existing_user = await v3_col("users").find_one({"email": payload.email}, {"_id": 0, "id": 1})
    if existing_user:
        raise HTTPException(status_code=409, detail="Email already in use")

    recent = await v3_col("super_admin_otp_requests").find_one(
        {"email": payload.email, "consumed": False},
        {"_id": 0, "created_at": 1},
        sort=[("created_at", -1)],
    )
    if recent:
        elapsed = (now_utc() - datetime.fromisoformat(recent["created_at"])).total_seconds()
        if elapsed < RESEND_COOLDOWN_SECONDS:
            raise HTTPException(status_code=429, detail=f"Please wait {int(RESEND_COOLDOWN_SECONDS - elapsed)}s before requesting another OTP")

    otp = f"{secrets.randbelow(1000000):06d}"
    request_doc = {
        "id": str(uuid.uuid4()),
        "full_name": payload.full_name,
        "email": payload.email,
        "mobile_number": payload.mobile_number,
        "password_hash": hash_password(payload.password),
        "otp_hash": _hash_otp(otp),
        "attempts": 0,
        "consumed": False,
        "expires_at": (now_utc() + timedelta(minutes=OTP_TTL_MINUTES)).isoformat(),
        "created_at": now_iso(),
    }
    await v3_col("super_admin_otp_requests").insert_one(request_doc.copy())

    send_email(
        CONTROL_EMAIL,
        "FitsiomaxOS — Super Admin creation approval OTP",
        (
            f"A request was made to create a new Super Admin account.\n\n"
            f"Name: {payload.full_name}\n"
            f"Email: {payload.email}\n"
            f"Mobile: {payload.mobile_number or '-'}\n\n"
            f"OTP: {otp}\n"
            f"This code expires in {OTP_TTL_MINUTES} minutes.\n\n"
            f"If you did not expect this, ignore this email — no account will be created without the OTP."
        ),
    )

    return {"request_id": request_doc["id"], "message": f"OTP sent to {CONTROL_EMAIL}"}


@router.post("/verify-otp")
async def verify_super_admin_otp(payload: SuperAdminOtpVerify):
    req = await v3_col("super_admin_otp_requests").find_one({"id": payload.request_id}, {"_id": 0})
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    if req["consumed"]:
        raise HTTPException(status_code=400, detail="This OTP has already been used")
    if datetime.fromisoformat(req["expires_at"]) < now_utc():
        raise HTTPException(status_code=400, detail="OTP expired — please request a new one")
    if req["attempts"] >= MAX_OTP_ATTEMPTS:
        raise HTTPException(status_code=400, detail="Too many incorrect attempts — please request a new OTP")

    if _hash_otp(payload.otp) != req["otp_hash"]:
        await v3_col("super_admin_otp_requests").update_one({"id": req["id"]}, {"$inc": {"attempts": 1}})
        raise HTTPException(status_code=401, detail="Invalid OTP")

    existing_user = await v3_col("users").find_one({"email": req["email"]}, {"_id": 0, "id": 1})
    if existing_user:
        raise HTTPException(status_code=409, detail="Email already in use")

    user = {
        "id": str(uuid.uuid4()),
        "full_name": req["full_name"],
        "email": req["email"],
        "password": req["password_hash"],
        "role": "super_admin",
        "branch_id": None,
        "employee_id": None,
        "mobile_number": req.get("mobile_number"),
        "aadhar_number": None,
        "is_active": True,
        "created_at": now_iso(),
    }
    await v3_col("users").insert_one(user.copy())
    await v3_col("super_admin_otp_requests").update_one({"id": req["id"]}, {"$set": {"consumed": True}})

    safe = {k: v for k, v in user.items() if k != "password"}
    return safe
