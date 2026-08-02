from fastapi import APIRouter, HTTPException, Depends, Header
import re
import uuid

from database import v3_col
from utils import now_iso
from security import verify_password, hash_password, is_hashed
from deps import v3_current_user
from schemas.v3 import V3UserOut, V3LoginRequest, V3LoginResponse

router = APIRouter(prefix="/api/v3")

# How many devices one account can stay signed in on at once. Generous on purpose — the
# point is that a second sign-in doesn't end the first, not to police device count.
MAX_SESSIONS_PER_USER = 10


@router.get("/")
async def v3_root():
    return {"message": "FITSIOMAX OS API v3"}


@router.post("/auth/login", response_model=V3LoginResponse)
async def v3_login(payload: V3LoginRequest):
    # Case-insensitive match: some accounts were created with mixed-case emails
    # (e.g. "Consultant@fitsiomax.clinic") before account creation normalized to lowercase.
    email = payload.email.strip()
    user = await v3_col("users").find_one(
        {"email": {"$regex": f"^{re.escape(email)}$", "$options": "i"}, "is_active": True},
        {"_id": 0},
    )
    if not user or not verify_password(payload.password, user.get("password", "")):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if not is_hashed(user.get("password", "")):
        await v3_col("users").update_one(
            {"id": user["id"]},
            {"$set": {"password": hash_password(payload.password)}},
        )

    token = str(uuid.uuid4())
    await v3_col("sessions").insert_one({"token": token, "user_id": user["id"], "created_at": now_iso()})
    # Signing in on a second device must NOT sign the first one out. A Head Physio moves
    # between a phone on the floor and a desk machine and expects both to stay live, and
    # a branch's shared account is used from more than one place at once.
    #
    # Only the oldest sessions beyond the cap are dropped, so tokens can't accumulate
    # forever on an account that signs in every day. The user_id filter also keeps this
    # away from the treatment-session documents that share this collection — those carry
    # no user_id, so they can never match.
    stale = await v3_col("sessions").find(
        {"user_id": user["id"]}, {"_id": 0, "token": 1}
    ).sort("created_at", -1).skip(MAX_SESSIONS_PER_USER).to_list(500)
    if stale:
        await v3_col("sessions").delete_many({"token": {"$in": [s["token"] for s in stale]}})
    await v3_col("login_history").insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "user_name": user.get("full_name", ""),
        "email": user.get("email", ""),
        "role": user.get("role", ""),
        "branch_id": user.get("branch_id"),
        "created_at": now_iso(),
    })
    user_public = {k: v for k, v in user.items() if k != "password"}
    return V3LoginResponse(token=token, user=V3UserOut(**user_public))


@router.get("/auth/me", response_model=V3UserOut)
async def v3_me(user: V3UserOut = Depends(v3_current_user)):
    return user


@router.post("/auth/logout")
async def v3_logout(user: V3UserOut = Depends(v3_current_user), authorization: str = Header(...)):
    token = authorization.split(" ", 1)[1].strip()
    await v3_col("sessions").delete_one({"token": token, "user_id": user.id})
    return {"message": "Logged out"}
