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
# A CONSULTANT who takes their consultations over video. The same board, the same
# pipeline, the same org-wide reach — only the room differs — so it is an alias of
# head_physio rather than a role of its own, exactly as online_physio is of physio.
#
# "consultant" and "online_consultant" are the same two roles under the names this clinic
# actually uses. A designation is a role here, so the job titles in HR's structure are
# minted as roles — and the title for this desk is CONSULTANT, not "head physio", which is
# a slug nobody outside the code says. Listed rather than matched loosely for the reason
# above: "sales_consultant" is a different job, and a rule on the bare token would hand it
# the consultation pipeline.
HEAD_PHYSIO_ROLES = frozenset({
    "head_physio", "online_head_physio",
    "consultant", "online_consultant",
})


def is_head_physio_role(role: str) -> bool:
    """Whether a role takes consultations — in the room or over video."""
    return (role or "").strip().lower() in HEAD_PHYSIO_ROLES


PHYSIO_ROLES = frozenset({"physio", "online_physio"})


def is_physio_role(role: str) -> bool:
    """Whether this role treats patients as a Physio does.

    Like is_branch_admin_role, this is for the *scoping* checks as well as the gate: an
    endpoint that narrows to the logged-in physio's own patients has to narrow for these
    too. Missing one shows them every physio's book rather than locking them out.
    """
    return (role or "").strip().lower() in PHYSIO_ROLES


# Sales Head is Pre-Sales' own manager, not a separate desk: same pipeline, same leads,
# same board (PreSalesCRM on the frontend), just the org-wide Master View instead of one
# rep's own book. So it is Pre-Sales' authority under a second slug, on the same footing
# as BRANCH_ADMIN_ROLES/PHYSIO_ROLES above, rather than a parallel permission set that
# would drift from it.
PRE_SALES_ROLES = frozenset({"pre_sales", "sales_head"})


def is_pre_sales_role(role: str) -> bool:
    """Whether this role holds Pre-Sales' authority over leads.

    Like is_branch_admin_role, this is for the *scoping* checks as well as the gate:
    anywhere a query or action is opened up to "pre_sales", it has to be opened up to
    these too, or Sales Head is left able to see the Master View but not act on it.
    """
    return (role or "").strip().lower() in PRE_SALES_ROLES


def v3_require_roles(*roles: str):
    async def checker(user: V3UserOut = Depends(v3_current_user)) -> V3UserOut:
        # Anywhere branch_admin, physio, head_physio or pre_sales is allowed, its aliases
        # are allowed.
        # Done here rather than at the 80-odd call sites so the next endpoint added is
        # covered by default instead of being one someone remembered to list the second
        # role on.
        allowed = (
            ("branch_admin" in roles and is_branch_admin_role(user.role))
            or ("physio" in roles and is_physio_role(user.role))
            or ("head_physio" in roles and is_head_physio_role(user.role))
            or ("pre_sales" in roles and is_pre_sales_role(user.role))
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


def is_rehab_role(role: str) -> bool:
    """Whether a role slug reads as the Rehab desk.

    Same problem the Diet and Zumba predicates solve, arriving the same way: the role is
    created by hand in Roles & Credentials, so its slug is whatever was typed — "rehab",
    "rehab_therapist", "rehab_manage" all name the same desk.

    Matched on whole underscore-separated tokens so an unrelated role cannot slip through
    on a substring. Note this is the ROLE, not the store category of the same name: a
    rehab course on the shelf has nothing to do with who holds the rehab calendar.

    Super Admin is included for the same reason it is in is_diet_role — it may reach every
    board — and excluded again wherever the question is "does this person hold a calendar".
    """
    r = (role or "").strip().lower()
    if r == "super_admin":
        return True
    return bool(set(r.split("_")) & {"rehab", "rehabilitation"})


def is_zumba_role(role: str) -> bool:
    """Whether a role slug reads as the Zumba desk.

    Same problem the HR and Diet predicates solve, arriving the same way: the role is
    created by hand in Roles & Credentials, so its slug is whatever wording was typed --
    this install has "zumba", and a "Zumba Master" typed tomorrow would be "zumba_master".
    Pinning one literal leaves the board 403ing for the other.

    Matched on whole underscore-separated tokens so an unrelated role cannot slip through
    on a substring. Note this is the ROLE, not the store category of the same name: a
    Zumba package on the shelf has nothing to do with who may read the class roll.
    """
    r = (role or "").strip().lower()
    if r == "super_admin":
        return True
    return "zumba" in set(r.split("_"))


def v3_require_diet(user: V3UserOut = Depends(v3_current_user)) -> V3UserOut:
    if not is_diet_role(user.role):
        raise HTTPException(status_code=403, detail="Not allowed")
    return user
