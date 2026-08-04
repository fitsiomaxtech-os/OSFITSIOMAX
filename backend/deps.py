from fastapi import Depends, Header, HTTPException
from database import db, v2_col, v3_col
from schemas.v1 import AuthUser
from schemas.v2 import V2UserOut
from schemas.v3 import V3UserOut


async def get_current_user(authorization: str = Header(...)) -> AuthUser:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")

    token = authorization.split(" ", 1)[1].strip()
    session = await db.sessions.find_one({"token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Session expired. Please login again.")

    user_doc = await db.users.find_one(
        {"id": session["user_id"], "is_active": True},
        {"_id": 0, "password": 0},
    )
    if not user_doc:
        raise HTTPException(status_code=401, detail="User not found")

    return AuthUser(**user_doc)


def require_roles(*roles: str):
    async def checker(user: AuthUser = Depends(get_current_user)) -> AuthUser:
        if user.role not in roles:
            raise HTTPException(status_code=403, detail="You do not have permission for this action")
        return user

    return checker


async def v2_current_user(authorization: str = Header(...)) -> V2UserOut:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    token = authorization.split(" ", 1)[1].strip()
    session = await v2_col("sessions").find_one({"token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Session expired")
    user = await v2_col("users").find_one({"id": session["user_id"], "is_active": True}, {"_id": 0, "password": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return V2UserOut(**user)


def v2_require_roles(*roles: str):
    async def checker(user: V2UserOut = Depends(v2_current_user)) -> V2UserOut:
        if user.role not in roles:
            raise HTTPException(status_code=403, detail="Not allowed")
        return user

    return checker


async def v3_current_user(authorization: str = Header(...)) -> V3UserOut:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    token = authorization.split(" ", 1)[1].strip()
    session = await v3_col("sessions").find_one({"token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Session expired")
    user = await v3_col("users").find_one({"id": session["user_id"], "is_active": True}, {"_id": 0, "password": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return V3UserOut(**user)


def v3_require_roles(*roles: str):
    async def checker(user: V3UserOut = Depends(v3_current_user)) -> V3UserOut:
        if user.role not in roles:
            raise HTTPException(status_code=403, detail="Not allowed")
        return user

    return checker


def is_hr_role(role: str) -> bool:
    """Whether a role slug reads as Human Resources.

    The HR role is created by hand in Super Admin -> HR Admin, so its slug is whatever
    label was typed ("Human Resource" -> human_resource). Pinning one literal would leave
    the board 403ing for anyone who worded it differently, so the shape of the slug is
    matched instead — on whole underscore-separated tokens, so an unrelated future role
    can't slip through on a substring.

    Lives here rather than in a router so the recruitment endpoints and anything that gates
    on HR in future share one definition instead of drifting copies.
    """
    r = (role or "").strip().lower()
    if r == "super_admin":
        return True
    if "human_resource" in r:
        return True
    return bool(set(r.split("_")) & {"hr", "recruiter", "recruitment", "talent"})
