from fastapi import APIRouter, HTTPException, Depends, Header
import re
import uuid

from database import v3_col
from utils import now_iso
from security import verify_password, hash_password, is_hashed
from deps import v3_current_user
from schemas.v3 import V3UserOut, V3LoginRequest, V3LoginResponse

router = APIRouter(prefix="/api/v3")


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
    await v3_col("sessions").delete_many({"user_id": user["id"]})
    await v3_col("sessions").insert_one({"token": token, "user_id": user["id"], "created_at": now_iso()})
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
