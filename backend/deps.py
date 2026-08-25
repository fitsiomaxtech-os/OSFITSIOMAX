from fastapi import Depends, Header, HTTPException
from typing import Dict
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
# it works in the room or online — the job is the same job, over one branch's leads,
# patients, calendars, store and accounts. So rather than a set of permissions each, this
# is Branch Admin's one set under a few slugs.
#
# It used to carry three more, naming the practice the branch sells rather than the arm it
# works in — Branch Admin (Physio), (Fitness), (Physio & Fitness). They were dropped: the
# permissions were identical, so all they did was make the pickers offer four spellings of
# one job. Which practice a branch runs is a fact about the branch and lives on the
# branch's own `vertical`, which is also where anything that should genuinely differ
# between them belongs — not in a fork of these permissions.
#
# Matched exactly, unlike the HR and Diet predicates below. Those match loosely because
# their roles are typed by hand and the wording varies. Doing that here would be dangerous:
# any rule matching a token like "physio", "fitness" or "online" would also catch the plain
# `physio` role and hand a treating physio the branch's finances. So the slugs are fixed,
# and they are in DEFAULT_ROLES instead, which puts them in the Create User and Designation
# dropdowns — nobody has to type one.
CURRENT_BRANCH_ADMIN_ROLES = frozenset({
    "branch_admin",
    "online_physio_admin",
    "online_fitness_admin",
})
# Retired: the three variants that named the practice a branch sells rather than the arm it
# works in. They were the same permissions as plain `branch_admin` under three more names,
# so collapsing them onto it changes nobody's access — migrate_branch_admin_roles() in
# seed.py rewrites the logins, and DEFAULT_ROLES no longer offers them.
#
# Still recognised here, exactly as LEGACY_CONSULTANT_ROLES stays in HEAD_PHYSIO_ROLES
# below: this set is read for the branch *scoping* checks as well as the gate, so dropping
# a slug the moment it stops being assignable would not merely fail closed for an account
# the migration has not reached — is_branch_admin_role returning False is what makes an
# endpoint skip narrowing its query to one branch, which would show that account every
# branch in the company.
LEGACY_BRANCH_ADMIN_ROLES = frozenset({
    "branch_admin_physio",
    "branch_admin_fitness",
    "branch_admin_physio_fitness",
})
BRANCH_ADMIN_ROLES = CURRENT_BRANCH_ADMIN_ROLES | LEGACY_BRANCH_ADMIN_ROLES


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
# the consultation desk and hand a treating physio the CONSULTANT's pipeline.
# The consultation desk. CONSULTANT is what this clinic calls the job and what HR's
# structure lists as the designation, so it is the role slug too — a designation is a role
# here. ONLINE CONSULTANT is the same desk over video: the same board, the same pipeline,
# the same org-wide reach, only the room differs, so it is an alias rather than a role of
# its own, exactly as online_physio is of physio.
#
# `head_physio`/`online_head_physio` are the slugs this desk used to carry. They are
# migrated to the two above by migrate_consultant_roles() in seed.py and are gone from
# DEFAULT_ROLES, so nobody can be given one again — they stay recognised here only so an
# account the migration has not reached yet keeps its board instead of logging in to a
# 403. Nothing new should be written against them.
#
# Note this is the ROLE, not the expert record's `profile_type`: every consultation query
# in the OS keys on profile_type "head_physio" and still does, whichever of these roles
# the person holds. See expert_profile_type in routers/v3_hr.py.
#
# Listed rather than matched loosely for the reason above: "sales_consultant" is a
# different job, and a rule on the bare "consultant" token would hand it the consultation
# pipeline.
CONSULTANT_ROLES = frozenset({"consultant", "online_consultant"})
LEGACY_CONSULTANT_ROLES = frozenset({"head_physio", "online_head_physio"})
HEAD_PHYSIO_ROLES = CONSULTANT_ROLES | LEGACY_CONSULTANT_ROLES


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


async def consultants_serving_branch(rows: list, branch_id: str) -> list:
    """Keep the consultants posted to this branch, and every other desk untouched.

    A Consultant is branch-selective now. They were not: their record was branchless, every
    branch's query matched it, and consolidate_head_physio_doctors cleared their login's
    branches at every startup to keep it that way. Lifting that rule is what this filter is.

    Read off the LOGIN, not off the record. The record stays branchless on purpose — one
    person has one set of published hours, and splitting it per branch would let the same
    Consultant be booked into the same hour at two of them with nothing to catch it — so
    the record cannot carry the answer. The branches live in branch_ids on the account,
    which is where every other multi-branch desk already keeps them.

    An empty list means NOWHERE. That is the reversal, and it is the whole point: a
    Consultant nobody has posted yet is offered at no branch rather than at all of them.

    A record with no login is a profile-only entry from Fitsiomax Experts, which requires a
    branch when it is created, so its own branch_id is its posting and is read directly.
    One that is also branchless has no answer anywhere and is offered nowhere — the same
    result as an unposted Consultant, and recoverable the same way.

    Only consultants are touched. Every other desk is filtered by branch in the query that
    produced these rows, and re-deciding them here would be a second rule to keep in step
    with the first.

    Lives here rather than beside any one caller because there are three of them — the
    expert list, the booking popup's experts and its available dates — and a caller that
    forgets it offers a Consultant at a branch they do not work.
    """
    user_ids = [r.get("user_id") for r in rows if r.get("profile_type") == "head_physio" and r.get("user_id")]
    posted_by_user: Dict[str, list] = {}
    if user_ids:
        async for u in v3_col("users").find(
            {"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "branch_id": 1, "branch_ids": 1},
        ):
            at = [b for b in (u.get("branch_ids") or []) if b]
            if not at and u.get("branch_id"):
                at = [u["branch_id"]]
            posted_by_user[u["id"]] = at

    kept = []
    for r in rows:
        if r.get("profile_type") != "head_physio":
            kept.append(r)
            continue
        uid = r.get("user_id")
        if uid:
            if branch_id in posted_by_user.get(uid, []):
                kept.append(r)
        elif r.get("branch_id") == branch_id:
            kept.append(r)
    return kept
