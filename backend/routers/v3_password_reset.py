"""Forgot Password recovery module.

Two verification paths depending on what the user enters:
  - Email address   -> emailed reset LINK (15 min expiry)
  - Mobile number   -> emailed OTP code (5 min expiry) — there is no SMS
    gateway configured yet, so the OTP is delivered to the account's
    registered email instead of the phone itself.

Both paths converge on the same POST /auth/reset-password endpoint via a
one-time reset_token, so there is a single, auditable "set new password"
step regardless of which method the user chose.
"""
import hashlib
import os
import secrets
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from database import v3_col
from utils import now_iso, now_utc
from security import hash_password
from email_utils import send_email

router = APIRouter(prefix="/api/v3/auth")

FRONTEND_URL = os.environ.get("FRONTEND_URL", "https://os.fitsiomax.clinic")

OTP_TTL_MINUTES = 5
LINK_TTL_MINUTES = 15
MAX_OTP_ATTEMPTS = 5
RESEND_COOLDOWN_SECONDS = 60
MAX_REQUESTS_PER_HOUR = 5


class ForgotPasswordRequest(BaseModel):
    identifier: str  # email address or mobile number


class VerifyResetOtpRequest(BaseModel):
    request_id: str
    otp: str


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str
    confirm_password: str


def _hash_token(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _is_email(identifier: str) -> bool:
    return "@" in identifier


def _mask_email(email: str) -> str:
    try:
        name, domain = email.split("@", 1)
        masked = name[0] + "*" if len(name) <= 2 else name[0] + "*" * (len(name) - 2) + name[-1]
        return f"{masked}@{domain}"
    except Exception:
        return email


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


async def _log_attempt(identifier: str, method: str, user_id, ip: str, event: str):
    await v3_col("password_reset_audit").insert_one({
        "id": str(uuid.uuid4()),
        "identifier": identifier,
        "method": method,
        "user_id": user_id,
        "ip": ip,
        "event": event,
        "created_at": now_iso(),
    })


@router.post("/forgot-password")
async def forgot_password(payload: ForgotPasswordRequest, request: Request):
    identifier = payload.identifier.strip()
    ip = _client_ip(request)
    if not identifier:
        raise HTTPException(status_code=400, detail="Enter your email or mobile number")

    is_email = _is_email(identifier)
    lookup = (
        {"email": identifier.lower(), "is_active": True}
        if is_email
        else {"mobile_number": identifier, "is_active": True}
    )
    user = await v3_col("users").find_one(lookup, {"_id": 0})

    window_start = (now_utc() - timedelta(hours=1)).isoformat()
    recent_count = await v3_col("password_reset_requests").count_documents(
        {"identifier": identifier, "created_at": {"$gte": window_start}}
    )
    if recent_count >= MAX_REQUESTS_PER_HOUR:
        await _log_attempt(identifier, "email" if is_email else "phone", user.get("id") if user else None, ip, "rate_limited")
        raise HTTPException(status_code=429, detail="Too many reset requests. Please try again later.")

    last = await v3_col("password_reset_requests").find_one(
        {"identifier": identifier, "consumed": False},
        {"_id": 0, "created_at": 1},
        sort=[("created_at", -1)],
    )
    if last:
        elapsed = (now_utc() - datetime.fromisoformat(last["created_at"])).total_seconds()
        if elapsed < RESEND_COOLDOWN_SECONDS:
            raise HTTPException(status_code=429, detail=f"Please wait {int(RESEND_COOLDOWN_SECONDS - elapsed)}s before requesting again")

    await _log_attempt(identifier, "email" if is_email else "phone", user.get("id") if user else None, ip, "requested")

    if not user:
        # Same response whether or not the account exists — avoids leaking which emails/phones are registered
        return {"message": "If an account matches, recovery instructions have been sent."}

    method = "link" if is_email else "otp"
    request_id = str(uuid.uuid4())
    doc = {
        "id": request_id,
        "identifier": identifier,
        "method": method,
        "user_id": user["id"],
        "attempts": 0,
        "verified": False,
        "consumed": False,
        "created_at": now_iso(),
    }

    if method == "link":
        link_token = secrets.token_urlsafe(32)
        doc["reset_token_hash"] = _hash_token(link_token)
        doc["expires_at"] = (now_utc() + timedelta(minutes=LINK_TTL_MINUTES)).isoformat()
        await v3_col("password_reset_requests").insert_one(doc.copy())
        reset_url = f"{FRONTEND_URL}/reset-password?token={link_token}"
        send_email(
            user["email"],
            "FitsiomaxOS — Reset your password",
            (
                f"Hi {user.get('full_name', '')},\n\n"
                f"A password reset was requested for your FitsiomaxOS account.\n\n"
                f"Reset your password: {reset_url}\n\n"
                f"This link expires in {LINK_TTL_MINUTES} minutes.\n\n"
                f"If you did not request this, ignore this email — your password will not change."
            ),
        )
        return {"message": f"A reset link has been sent to {_mask_email(user['email'])}"}

    otp = f"{secrets.randbelow(1000000):06d}"
    doc["otp_hash"] = _hash_token(otp)
    doc["expires_at"] = (now_utc() + timedelta(minutes=OTP_TTL_MINUTES)).isoformat()
    await v3_col("password_reset_requests").insert_one(doc.copy())
    send_email(
        user["email"],
        "FitsiomaxOS — Password reset OTP",
        (
            f"Hi {user.get('full_name', '')},\n\n"
            f"You requested a password reset using your registered mobile number.\n\n"
            f"OTP: {otp}\n"
            f"This code expires in {OTP_TTL_MINUTES} minutes.\n\n"
            f"If you did not request this, ignore this email — your password will not change."
        ),
    )
    return {"request_id": request_id, "message": f"An OTP has been sent to {_mask_email(user['email'])} for verification"}


@router.post("/verify-reset-otp")
async def verify_reset_otp(payload: VerifyResetOtpRequest):
    req = await v3_col("password_reset_requests").find_one({"id": payload.request_id, "method": "otp"}, {"_id": 0})
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    if req["consumed"]:
        raise HTTPException(status_code=400, detail="This request has already been used")
    if datetime.fromisoformat(req["expires_at"]) < now_utc():
        raise HTTPException(status_code=400, detail="OTP expired — please request a new one")
    if req["attempts"] >= MAX_OTP_ATTEMPTS:
        raise HTTPException(status_code=400, detail="Too many incorrect attempts — please request a new OTP")

    if _hash_token(payload.otp) != req["otp_hash"]:
        await v3_col("password_reset_requests").update_one({"id": req["id"]}, {"$inc": {"attempts": 1}})
        raise HTTPException(status_code=401, detail="Invalid OTP")

    reset_token = secrets.token_urlsafe(32)
    await v3_col("password_reset_requests").update_one(
        {"id": req["id"]},
        {"$set": {
            "verified": True,
            "reset_token_hash": _hash_token(reset_token),
            "expires_at": (now_utc() + timedelta(minutes=OTP_TTL_MINUTES)).isoformat(),
        }},
    )
    await _log_attempt(req["identifier"], "otp", req["user_id"], "internal", "otp_verified")
    return {"reset_token": reset_token, "message": "OTP verified"}


@router.get("/reset-password/validate")
async def validate_reset_token(token: str):
    req = await v3_col("password_reset_requests").find_one(
        {"reset_token_hash": _hash_token(token), "consumed": False}, {"_id": 0}
    )
    if not req or datetime.fromisoformat(req["expires_at"]) < now_utc():
        raise HTTPException(status_code=400, detail="This reset link is invalid or has expired")
    return {"valid": True}


@router.post("/reset-password")
async def reset_password(payload: ResetPasswordRequest, request: Request):
    if payload.new_password != payload.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match")
    if len(payload.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    req = await v3_col("password_reset_requests").find_one(
        {"reset_token_hash": _hash_token(payload.token), "consumed": False}, {"_id": 0}
    )
    if not req:
        raise HTTPException(status_code=400, detail="This reset link is invalid or has expired")
    if datetime.fromisoformat(req["expires_at"]) < now_utc():
        raise HTTPException(status_code=400, detail="This reset link has expired — please request a new one")
    if req["method"] == "otp" and not req.get("verified"):
        raise HTTPException(status_code=400, detail="OTP verification required")

    user = await v3_col("users").find_one({"id": req["user_id"], "is_active": True}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="Account not found or inactive")

    await v3_col("users").update_one({"id": user["id"]}, {"$set": {"password": hash_password(payload.new_password)}})
    await v3_col("sessions").delete_many({"user_id": user["id"]})
    await v3_col("password_reset_requests").update_one({"id": req["id"]}, {"$set": {"consumed": True}})
    await _log_attempt(req["identifier"], req["method"], user["id"], _client_ip(request), "reset_success")

    return {"message": "Password reset successful. Please log in with your new password."}
