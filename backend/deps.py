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


# Roles that are a Branch Admin under another name. A branch is run by one of these whether
# it sells physiotherapy, fitness, both, or runs online — the job is the same job, over one
# branch's leads, patients, calendars, store and accounts. So rather than a set of
# permissions each, this is Branch Admin's one set under several slugs.
#
# The distinction they carry is which practice the person runs, and that is a label on the
# user, not a different reach into the data: a Branch Admin (Fitness) still needs the whole
# of their branch. Anything that should genuinely differ between them belongs in a check on
# the branch's vertical, not in a fork of these permissions.
#
# Matched exactly, unlike the HR and Diet predicates below. Those match loosely because
# their roles are typed by hand and the wording varies. Doing that here would be dangerous:
# any rule matching a token like "physio", "fitness" or "online" would also catch the plain
# `physio` role and hand a treating physio the branch's finances. So the slugs are fixed,
# and they are in DEFAULT_ROLES instead, which puts them in the Create User and Designation
# dropdowns — nobody has to type one.
BRANCH_ADMIN_ROLES = frozenset({
    "branch_admin",
    "branch_admin_physio",
    "branch_admin_fitness",
    "branch_admin_physio_fitness",
    "online_physio_admin",
    "online_fitness_admin",
})


def is_branch_admin_role(role: str) -> bool:
    """Whether this role holds Branch Admin's authority over its own branch.

    Used for the branch *scoping* checks as well as the gate: an endpoint that narrows its
    query to user.branch_id for a branch_admin has to narrow it for these too. Missing one
    of those does not lock the role out — it does the opposite, and shows them every branch
    in the company.
    """
    return (role or "").strip().lower() in BRANCH_ADMIN_ROLES


# Roles that are a Physio under another name, on the same footing as BRANCH_ADMIN_ROLES
# above. An Online Physio treats patients over video instead of on the floor; the board,
# the sessions, the reviews and the reach are identical, so it is the same permissions
# under a second slug rather than a parallel set that would drift.
#
# Exact match, for the same reason: a loose rule on the "physio" token would also catch
# `head_physio` and hand a treating physio the CONSULTANT's pipeline.
PHYSIO_ROLES = frozenset({"physio", "online_physio"})


def is_physio_role(role: str) -> bool:
    """Whether this role treats patients as a Physio does.

    Like is_branch_admin_role, this is for the *scoping* checks as well as the gate: an
    endpoint that narrows to the logged-in physio's own patients has to narrow for these
    too. Missing one shows them every physio's book rather than locking them out.
    """
    return (role or "").strip().lower() in PHYSIO_ROLES


def v3_require_roles(*roles: str):
    async def checker(user: V3UserOut = Depends(v3_current_user)) -> V3UserOut:
        # Anywhere branch_admin or physio is allowed, its aliases are allowed. Done here
        # rather than at the 80-odd call sites so the next endpoint added is covered by
        # default instead of being one someone remembered to list the second role on.
        allowed = (
            ("branch_admin" in roles and is_branch_admin_role(user.role))
            or ("physio" in roles and is_physio_role(user.role))
        )
        if user.role not in roles and not allowed:
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


def is_diet_role(role: str) -> bool:
    """Whether a role slug reads as the Diet vertical.

    Same problem the HR predicate solves, arriving the same way: the role is created by
    hand in Roles & Credentials, so its slug is whatever label was typed — this install
    has `diet_manage`, not the `nutrition_coach` the Diet board was written against, and
    that user logged in to a blank screen. Pinning one literal leaves the board 403ing
    for anyone who worded it differently.

    Matched on whole underscore-separated tokens so an unrelated role can't slip through
    on a substring — "audit_manage" shares no token with this set.
    """
    r = (role or "").strip().lower()
    if r == "super_admin":
        return True
    if "nutrition_coach" in r:
        return True
    return bool(set(r.split("_")) & {"diet", "nutrition", "nutritionist", "dietician", "dietitian"})


def v3_require_diet(user: V3UserOut = Depends(v3_current_user)) -> V3UserOut:
    if not is_diet_role(user.role):
        raise HTTPException(status_code=403, detail="Not allowed")
    return user
