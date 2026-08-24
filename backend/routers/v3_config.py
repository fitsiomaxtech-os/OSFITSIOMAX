from fastapi import APIRouter, HTTPException, Depends
from typing import List, Optional, Dict
from pydantic import BaseModel
import re
import uuid

from database import v3_col
from utils import now_iso, normalize_slot_time, derive_branch_code, active_doctor_query
from security import hash_password
from deps import v3_current_user, v3_require_roles, is_branch_admin_role
from stage_utils import get_first_stage_name, realign_branch_stage_leads
from shift_utils import attach_shifts
import lead_control
from schemas.v3 import (
    V3UserOut, V3VerticalCreate, V3VerticalOut,
    V3BranchCreate, V3BranchOut, V3BranchUpdate,
    V3TeamMemberCreate, V3TeamMemberOut,
    V3DoctorCreate, V3DoctorSlotsInput, V3DoctorOut,
    V3TreatmentTypeCreate, V3TreatmentTypeOut,
    V3PhysioTypeCreate, V3PhysioTypeOut, V3PhysioTypeUpdate, V3DoctorServiceInput,
)

router = APIRouter(prefix="/api/v3")


@router.get("/verticals", response_model=List[V3VerticalOut])
async def v3_get_verticals(_: V3UserOut = Depends(v3_current_user)):
    rows = await v3_col("verticals").find({}, {"_id": 0}).to_list(100)
    return [V3VerticalOut(**row) for row in rows]


@router.post("/verticals", response_model=V3VerticalOut)
async def v3_add_vertical(payload: V3VerticalCreate, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    doc = {
        "id": str(uuid.uuid4()),
        "name": payload.name,
        "active": payload.active,
        "created_at": now_iso(),
    }
    await v3_col("verticals").insert_one(doc.copy())
    return V3VerticalOut(**doc)


@router.delete("/verticals/{vertical_id}")
async def v3_delete_vertical(vertical_id: str, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    """Remove a service type.

    Refused while a branch still carries it. A branch's `vertical` holds the type's *name*,
    not its id, so deleting one in use would leave those branches pointing at a type that
    no longer exists — the branch form would then fail to show their current selection and
    silently offer to change it. Naming the branches lets the caller go and reassign them.
    """
    row = await v3_col("verticals").find_one({"id": vertical_id}, {"_id": 0})
    if not row:
        raise HTTPException(status_code=404, detail="Service type not found")
    in_use = await v3_col("branches").find(
        {"vertical": row.get("name")}, {"_id": 0, "branch_name": 1}
    ).to_list(20)
    if in_use:
        names = ", ".join(b.get("branch_name", "?") for b in in_use)
        raise HTTPException(
            status_code=409,
            detail=f"{len(in_use)} branch(es) still use this service type: {names}",
        )
    await v3_col("verticals").delete_one({"id": vertical_id})
    return {"message": "Service type deleted"}


# ---- Treatment types ----------------------------------------------------------------
# The catalogue of treatments the clinic offers, by name — Super Admin > Treatment.
# Deliberately just a name and nothing else: it is a list to pick from, and every price,
# session count and duration already lives on a package in FITSIO STORE. Adding those
# fields here would create a second place to maintain them and a question about which
# one is right.


@router.get("/treatment-types", response_model=List[V3TreatmentTypeOut])
async def v3_get_treatment_types(_: V3UserOut = Depends(v3_current_user)):
    # Any signed-in user reads it: this is a picklist, and the people who would pick from
    # it are the ones treating patients, not the one maintaining the list.
    rows = await v3_col("treatment_types").find({}, {"_id": 0}).sort("name", 1).to_list(500)
    return [V3TreatmentTypeOut(**row) for row in rows]


@router.post("/treatment-types", response_model=V3TreatmentTypeOut)
async def v3_add_treatment_type(payload: V3TreatmentTypeCreate, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Treatment name is required")
    # Case-insensitive: "Dry Needling" and "dry needling" are the same treatment, and a
    # picklist holding both is a picklist nobody trusts.
    clash = await v3_col("treatment_types").find_one(
        {"name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}}, {"_id": 0, "name": 1}
    )
    if clash:
        raise HTTPException(status_code=409, detail=f"'{clash['name']}' already exists")
    doc = {"id": str(uuid.uuid4()), "name": name, "created_at": now_iso()}
    await v3_col("treatment_types").insert_one(doc.copy())
    return V3TreatmentTypeOut(**doc)


@router.delete("/treatment-types/{treatment_type_id}")
async def v3_delete_treatment_type(treatment_type_id: str, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    """Remove a treatment from the catalogue.

    No in-use check, unlike service types: nothing in the OS references a treatment type
    yet, so there is nothing to strand. The moment something does — a package, a session,
    a lead — this needs the same guard v3_delete_vertical has, refusing while it is
    referenced and naming what still holds it.
    """
    res = await v3_col("treatment_types").delete_one({"id": treatment_type_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Treatment not found")
    return {"message": "Treatment deleted"}


# Type of Physios — which kinds of physiotherapy the clinic offers.
#
# The same shape as treatment types above, and deliberately so: a name and nothing else,
# because the price, the session count and the duration belong to a package in FITSIO
# STORE. Two lists rather than one because they answer different questions — a treatment
# is what is wrong with the patient, a physio type is the service being sold.


@router.get("/physio-types", response_model=List[V3PhysioTypeOut])
async def v3_get_physio_types(_: V3UserOut = Depends(v3_current_user)):
    # Any signed-in user reads it, like the treatment list: this is a picklist, and the
    # people who pick from it are the ones seeing patients, not the one maintaining it.
    rows = await v3_col("physio_types").find({}, {"_id": 0}).sort("name", 1).to_list(500)
    return [V3PhysioTypeOut(**row) for row in rows]


@router.post("/physio-types", response_model=V3PhysioTypeOut)
async def v3_add_physio_type(payload: V3PhysioTypeCreate, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Service name is required")
    # Case-insensitive: "Sports Physio" and "sports physio" are one service, and a picklist
    # holding both is a picklist nobody trusts.
    clash = await v3_col("physio_types").find_one(
        {"name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}}, {"_id": 0, "name": 1}
    )
    if clash:
        raise HTTPException(status_code=409, detail=f"'{clash['name']}' already exists")
    doc = {"id": str(uuid.uuid4()), "name": name, "created_at": now_iso()}
    await v3_col("physio_types").insert_one(doc.copy())
    return V3PhysioTypeOut(**doc)


@router.patch("/physio-types/{physio_type_id}", response_model=V3PhysioTypeOut)
async def v3_update_physio_type(
    physio_type_id: str,
    payload: V3PhysioTypeUpdate,
    _: V3UserOut = Depends(v3_require_roles("super_admin")),
):
    """Rename a service.

    The name is written through to every expert offered under the old one, because a
    doctors record holds the service as text rather than as an id — leaving them behind
    would strand experts under a name the picklist no longer offers.
    """
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Service name is required")
    existing = await v3_col("physio_types").find_one({"id": physio_type_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Service not found")
    # Same case-insensitive rule the create has, minus this row: renaming a service to
    # the case it already has is not a clash with itself.
    clash = await v3_col("physio_types").find_one(
        {"name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}, "id": {"$ne": physio_type_id}},
        {"_id": 0, "name": 1},
    )
    if clash:
        raise HTTPException(status_code=409, detail=f"'{clash['name']}' already exists")
    await v3_col("physio_types").update_one({"id": physio_type_id}, {"$set": {"name": name}})
    if existing.get("name") != name:
        await v3_col("doctors").update_many(
            {"service_type": existing.get("name")}, {"$set": {"service_type": name}}
        )
    return V3PhysioTypeOut(**{**existing, "name": name})


@router.patch("/doctors/{doctor_id}/service")
async def v3_set_doctor_service(
    doctor_id: str,
    payload: V3DoctorServiceInput,
    _: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin")),
):
    """Say which service an expert is offered under, from the Service picklist.

    Set where the calendar is published rather than where the expert is hired: the
    question is asked when a branch is opening this person's days, and that is the
    screen the answer is read back on.

    Checked against the picklist so the calendar can never print a service Super Admin
    does not offer — the same reason the list exists rather than a free-text field.
    """
    name = (payload.service_type or "").strip()
    if name:
        known = await v3_col("physio_types").find_one(
            {"name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}}, {"_id": 0, "name": 1}
        )
        if not known:
            raise HTTPException(status_code=404, detail=f"'{name}' is not a service in Services and Products")
        # Stored as the picklist spells it, not as the caller typed it.
        name = known["name"]
    res = await v3_col("doctors").update_one({"id": doctor_id}, {"$set": {"service_type": name}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Expert not found")
    return {"message": "Service updated", "service_type": name}


@router.delete("/physio-types/{physio_type_id}")
async def v3_delete_physio_type(physio_type_id: str, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    """Remove a service from the Service list.

    Guarded now that experts are offered under one: deleting a service still held by a
    calendar would leave those experts printing a service the picklist no longer offers,
    which is the state this list exists to prevent. Refused and named, the way
    v3_delete_vertical refuses.
    """
    existing = await v3_col("physio_types").find_one({"id": physio_type_id}, {"_id": 0, "name": 1})
    if not existing:
        raise HTTPException(status_code=404, detail="Service not found")
    in_use = await v3_col("doctors").count_documents({"service_type": existing["name"]})
    if in_use > 0:
        raise HTTPException(
            status_code=409,
            detail=f"'{existing['name']}' is offered by {in_use} expert(s). Change theirs first.",
        )
    await v3_col("physio_types").delete_one({"id": physio_type_id})
    return {"message": "Service deleted"}

@router.get("/branches", response_model=List[V3BranchOut])
async def v3_get_branches(_: V3UserOut = Depends(v3_current_user)):
    rows = await v3_col("branches").find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return [V3BranchOut(**row) for row in rows]


@router.get("/team-members", response_model=List[V3TeamMemberOut])
async def v3_get_team_members(team_type: Optional[str] = None, _: V3UserOut = Depends(v3_current_user)):
    query: Dict[str, str] = {}
    if team_type:
        query["team_type"] = team_type
    rows = await v3_col("team_members").find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return [V3TeamMemberOut(**row) for row in rows]


@router.post("/team-members", response_model=V3TeamMemberOut)
async def v3_add_team_member(payload: V3TeamMemberCreate, _: V3UserOut = Depends(v3_require_roles("business_dev", "super_admin"))):
    email = payload.email.lower().strip()
    exists = await v3_col("team_members").find_one({"email": email, "team_type": payload.team_type}, {"_id": 0})
    if exists:
        raise HTTPException(status_code=409, detail="Team member already exists")

    member = {
        "id": str(uuid.uuid4()),
        "full_name": payload.full_name.strip(),
        "email": email,
        "team_type": payload.team_type,
        "created_at": now_iso(),
    }
    await v3_col("team_members").insert_one(member.copy())
    return V3TeamMemberOut(**member)


@router.post("/branches", response_model=V3BranchOut)
async def v3_create_branch(payload: V3BranchCreate, _: V3UserOut = Depends(v3_require_roles("super_admin", "business_dev"))):
    branch_id = str(uuid.uuid4())
    admin_user_id = str(uuid.uuid4())
    await v3_col("users").insert_one(
        {
            "id": admin_user_id,
            "full_name": payload.admin_name,
            "email": payload.admin_email.lower(),
            "password": hash_password(payload.admin_password),
            "role": "branch_admin",
            "branch_id": branch_id,
            "is_active": True,
            "created_at": now_iso(),
        }
    )
    existing_codes = set(await v3_col("branches").distinct("code"))
    code = (payload.code or "").strip().upper()
    if code:
        if code in existing_codes:
            raise HTTPException(status_code=409, detail=f"Branch code '{code}' is already in use")
    else:
        code = derive_branch_code(payload.branch_name, existing_codes)
    branch = {
        "id": branch_id,
        "code": code,
        "branch_name": payload.branch_name,
        "address": payload.address,
        "admin_user_id": admin_user_id,
        "admin_name": payload.admin_name,
        "admin_email": payload.admin_email.lower(),
        "admin_phone": payload.admin_phone,
        "vertical": payload.vertical,
        "lead_control": lead_control.normalize(payload.lead_control),
        "created_at": now_iso(),
    }
    await v3_col("branches").insert_one(branch.copy())

    await v3_col("users").update_many(
        {
            "email": {"$in": ["headphysio@fitsiomax.com", "physio@fitsiomax.com"]},
            "branch_id": None,
        },
        {"$set": {"branch_id": branch_id}},
    )

    return V3BranchOut(**branch)


@router.put("/branches/{branch_id}", response_model=V3BranchOut)
async def v3_update_branch(branch_id: str, payload: V3BranchUpdate, user: V3UserOut = Depends(v3_require_roles("super_admin", "business_dev"))):
    existing = await v3_col("branches").find_one({"id": branch_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Branch not found")
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    if "code" in updates:
        new_code = updates["code"].strip().upper()
        if not new_code:
            raise HTTPException(status_code=400, detail="Branch code cannot be empty")
        clash = await v3_col("branches").find_one({"code": new_code, "id": {"$ne": branch_id}}, {"_id": 0, "id": 1})
        if clash:
            raise HTTPException(status_code=409, detail=f"Branch code '{new_code}' is already used by another branch")
        updates["code"] = new_code
    if "lead_control" in updates:
        # Rejected rather than defaulted: a typo here silently hands every lead at the
        # branch to the wrong desk, and the caller would never see it.
        if updates["lead_control"] not in lead_control.VALID:
            raise HTTPException(status_code=400, detail=f"lead_control must be one of {list(lead_control.VALID)}")
    # Names a person, not a branch field — pulled out before the branch is written so it
    # does not end up stored on the document.
    assignee_id = updates.pop("lead_control_assignee_id", None)
    assignee = None
    if assignee_id and updates.get("lead_control") == lead_control.PRE_SALES:
        assignee = await v3_col("users").find_one(
            {"id": assignee_id, "role": "pre_sales", "branch_id": branch_id},
            {"_id": 0, "id": 1, "full_name": 1},
        )
        # Checked rather than trusted: this hands a branch's entire book to whoever is
        # named, so a stale or wrong id must fail loudly instead of assigning the leads
        # to nobody and looking like it worked.
        if not assignee:
            raise HTTPException(status_code=400, detail="That Pre-Sales member is not attached to this branch")
    await v3_col("branches").update_one({"id": branch_id}, {"$set": updates})
    # The two modes open on different stages — Branch Assign + RNR for a branch running its
    # own leads, New Appointment for one fed by Pre-Sales. Leads already sitting on the old
    # mode's stages are rehomed now, in the same request as the flip, so the board the admin
    # lands on after switching is the full backlog rather than a board missing most of it.
    if "lead_control" in updates and updates["lead_control"] != lead_control.normalize(existing.get("lead_control")):
        await realign_branch_stage_leads(branch_id, updates["lead_control"])
        # A branch that ran its own leads had no Pre-Sales rep on any of them, so handing
        # the book back left every lead sitting in the Pre-Sales pipeline unowned. The rep
        # named on the switch takes them, which is the whole point of being asked.
        if assignee:
            await v3_col("leads").update_many(
                {"branch_id": branch_id},
                {"$set": {
                    "assigned_user_id": assignee["id"],
                    "assigned_user_name": assignee.get("full_name", ""),
                    "assigned_user_role": "pre_sales",
                    "updated_at": now_iso(),
                }},
            )
        # Every flip is recorded. The switch moves a whole branch's leads between two desks,
        # and the branch itself only ever carries the answer as it stands now — so without
        # this there is nothing to say when the handover happened or who called it.
        await v3_col("branch_lead_control_history").insert_one({
            "id": str(uuid.uuid4()),
            "branch_id": branch_id,
            "from_control": lead_control.normalize(existing.get("lead_control")),
            "to_control": updates["lead_control"],
            "changed_by": user.full_name,
            "changed_by_role": user.role,
            "assigned_to_id": assignee["id"] if assignee else None,
            "assigned_to_name": assignee.get("full_name", "") if assignee else None,
            "changed_at": now_iso(),
        })
    updated = await v3_col("branches").find_one({"id": branch_id}, {"_id": 0})
    return V3BranchOut(**updated)


@router.get("/branches/{branch_id}/pre-sales-members")
async def v3_branch_pre_sales_members(
    branch_id: str,
    _: V3UserOut = Depends(v3_require_roles("super_admin", "business_dev")),
):
    """The Pre-Sales reps attached to this branch, for the hand-back dropdown.

    Scoped to the branch rather than the whole Pre-Sales desk: returning a branch's book
    to Pre-Sales means handing it to someone who covers that branch. A branch with nobody
    attached comes back empty, and the dialog says so rather than offering a dead control —
    the fix for that is attaching a Pre-Sales user to the branch in HR Admin.
    """
    rows = await v3_col("users").find(
        {"role": "pre_sales", "branch_id": branch_id, "is_active": {"$ne": False}},
        {"_id": 0, "id": 1, "full_name": 1, "email": 1},
    ).sort("full_name", 1).to_list(200)
    return rows


@router.get("/branches/{branch_id}/lead-control-history")
async def v3_lead_control_history(
    branch_id: str,
    _: V3UserOut = Depends(v3_require_roles("super_admin", "business_dev")),
):
    """Every Lead Control switch this branch has been through, newest first.

    Empty for a branch that has never been switched, including every branch that existed
    before this was recorded — an empty table means "no flip seen", not "no flips ever".
    """
    return await v3_col("branch_lead_control_history").find(
        {"branch_id": branch_id}, {"_id": 0}
    ).sort("changed_at", -1).to_list(200)


@router.delete("/branches/{branch_id}")
async def v3_delete_branch(branch_id: str, _: V3UserOut = Depends(v3_require_roles("super_admin", "business_dev"))):
    existing = await v3_col("branches").find_one({"id": branch_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Branch not found")
    await v3_col("branches").delete_one({"id": branch_id})
    if existing.get("admin_user_id"):
        await v3_col("users").delete_one({"id": existing["admin_user_id"]})
    # Don't leave leads/sources pointing at a branch that no longer exists — unassign them
    # back to "no branch" so they fall back to the normal Pre-Sales flow instead of silently
    # keeping a dead branch_id forever.
    await v3_col("leads").update_many(
        {"branch_id": branch_id},
        {"$set": {"branch_id": None, "branch_stage": None}},
    )
    await v3_col("marketing_sources").update_many(
        {"branch_id": branch_id},
        {"$set": {"branch_id": None}},
    )
    return {"message": "Branch deleted"}


# The desks whose records may legitimately carry no branch, and so are offered at every
# one. A CONSULTANT takes consultations across the organisation; a Nutritionist covers
# every branch here. Every other desk is somewhere — a Physio treats at their own branch,
# and rehab is delivered where the patient comes — so a missing branch on one of those is
# a gap to fix rather than a reach to honour.
ORG_WIDE_PROFILES = ["head_physio", "nutrition_coach"]


@router.get("/doctors", response_model=List[V3DoctorOut])
async def v3_get_doctors(
    branch_id: Optional[str] = None,
    user: V3UserOut = Depends(v3_current_user),
):
    query: Dict[str, object] = {}
    scope_branch = None
    if (is_branch_admin_role(user.role) or user.role in ["head_physio", "physio"]) and user.branch_id:
        scope_branch = user.branch_id
    elif branch_id:
        scope_branch = branch_id
    if scope_branch:
        # An expert with no branch on their record belongs to all of them — but only where
        # that desk can genuinely hold none. A CONSULTANT is org-wide by definition, and a
        # Nutritionist here covers every branch; both are recorded branchless and must not
        # be filtered out, or those calendars come back empty at every branch.
        #
        # A Physio is not: they treat at the branch they belong to. A physio record with no
        # branch on it is a gap in the data, not a licence to appear on every calendar, and
        # reading it as one would put every physio in the organisation on every branch's
        # list. Rehab is the same, being delivered where the patient comes.
        query["$or"] = [
            {"branch_id": scope_branch},
            {"profile_type": {"$in": ORG_WIDE_PROFILES}, "branch_id": {"$in": [None, ""]}},
            # Kept alongside the rule rather than replaced by it: a Head Physio record
            # written before branchless was the convention may still carry a branch, and
            # dropping this clause would hide them from every other branch's calendar.
            {"profile_type": "head_physio"},
        ]
    rows = await v3_col("doctors").find(active_doctor_query(query), {"_id": 0}).sort("created_at", -1).to_list(1000)
    # Their rostered working window, so a list that offers an expert also says which hours
    # that expert actually works. Resolved here rather than by each caller because every
    # calendar and picker reads this one endpoint.
    rows = await attach_shifts(rows)
    out = []
    for row in rows:
        try:
            out.append(V3DoctorOut(**row))
        except Exception:
            # One malformed legacy row (e.g. missing a field a later schema change added)
            # shouldn't 500 the whole Experts list — skip it and keep going.
            continue
    return out


@router.post("/doctors", response_model=V3DoctorOut)
async def v3_add_doctor(payload: V3DoctorCreate, user: V3UserOut = Depends(v3_require_roles("super_admin", "branch_admin", "head_physio"))):
    branch_id = payload.branch_id or user.branch_id
    if not branch_id:
        raise HTTPException(status_code=400, detail="Branch is required")
    doctor = {
        "id": str(uuid.uuid4()),
        "full_name": payload.full_name,
        "profile_type": payload.profile_type,
        "branch_id": branch_id,
        "specialization": payload.specialization,
        "employee_id": payload.employee_id,
        "joining_date": payload.joining_date,
        "slots": [],
        "created_at": now_iso(),
    }
    await v3_col("doctors").insert_one(doctor.copy())
    return V3DoctorOut(**doctor)


@router.delete("/doctors/{doctor_id}")
async def v3_delete_doctor(doctor_id: str, user: V3UserOut = Depends(v3_require_roles("super_admin", "branch_admin"))):
    """Remove an expert profile created via HR > Fitsiomax Experts (or Branch
    Admin's own Fitsiomax Experts tab). Only for profile-only entries with no
    linked login and no appointment/session history — those are real accounts
    or real patient history, not stray test/duplicate rows. Branch Admin can
    only delete an expert from their own branch."""
    doctor = await v3_col("doctors").find_one({"id": doctor_id}, {"_id": 0})
    if not doctor:
        raise HTTPException(status_code=404, detail="Expert not found")
    if is_branch_admin_role(user.role) and doctor.get("branch_id") != user.branch_id:
        raise HTTPException(status_code=404, detail="Expert not found")
    # Refused only while that login still exists. It used to be refused on the presence of
    # the field alone, which trapped anyone whose login had already been deleted: the record
    # was left pointing at nothing, the advice was to remove a login that was already gone,
    # and there was no way to clear it. A user_id that resolves to nobody is a dead
    # reference, not a live account to protect.
    if doctor.get("user_id"):
        owner = await v3_col("users").find_one({"id": doctor["user_id"]}, {"_id": 0, "id": 1})
        if owner:
            raise HTTPException(status_code=400, detail="This expert is linked to a login account — remove the login in Roles & Credentials instead")
    if await v3_col("appointments").find_one({"doctor_id": doctor_id}, {"_id": 0, "id": 1}):
        raise HTTPException(status_code=400, detail="This expert has appointment history and can't be deleted")
    if await v3_col("sessions").find_one({"physio_id": doctor_id}, {"_id": 0, "id": 1}):
        raise HTTPException(status_code=400, detail="This expert has session history and can't be deleted")
    await v3_col("doctors").delete_one({"id": doctor_id})
    return {"message": "Expert deleted"}


@router.post("/doctors/{doctor_id}/slots", response_model=V3DoctorOut)
async def v3_add_slots(doctor_id: str, payload: V3DoctorSlotsInput, _: V3UserOut = Depends(v3_require_roles("super_admin", "branch_admin", "head_physio"))):
    doctor = await v3_col("doctors").find_one({"id": doctor_id}, {"_id": 0})
    if not doctor:
        raise HTTPException(status_code=404, detail="Doctor not found")
    normalized_slots = [normalize_slot_time(slot) for slot in payload.slots]
    all_slots = sorted(set(doctor.get("slots", [])).union(set(normalized_slots)))
    await v3_col("doctors").update_one({"id": doctor_id}, {"$set": {"slots": all_slots}})
    updated = await v3_col("doctors").find_one({"id": doctor_id}, {"_id": 0})
    return V3DoctorOut(**updated)


@router.get("/doctors/available")
async def v3_available_doctors(branch_id: str, slot_time: str, _: V3UserOut = Depends(v3_current_user)):
    slot_key = normalize_slot_time(slot_time)
    doctors = await v3_col("doctors").find(active_doctor_query({"branch_id": branch_id}), {"_id": 0}).to_list(1000)
    booked = await v3_col("appointments").find({"branch_id": branch_id, "slot_time": slot_key, "status": "new_appointment"}, {"_id": 0, "doctor_id": 1}).to_list(200)
    booked_ids = {item["doctor_id"] for item in booked}
    available = [d for d in doctors if slot_key in d.get("slots", []) and d["id"] not in booked_ids]
    return {"available_doctors": available}


@router.post("/admin/reset-all-leads")
async def v3_reset_all_leads(confirm: bool = False, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    """Testing utility: resets every lead's pipeline progress back to a fresh,
    unassigned state at Pre-Sales' first stage — the lead record itself (name,
    phone, contact info, source) is kept as-is. Clears both the Consultation
    Package/fee and the Treatment Fee/Session Package/Partial Payment schedule,
    so no stale balance or due date survives into Accountant Manage after a
    reset. Also clears everything tied to leads that only makes sense
    mid-pipeline: sessions, weekly assessments, package recommendations,
    appointments, patient view tokens, and activity history. Irreversible —
    requires confirm=true. Super Admin only."""
    if not confirm:
        raise HTTPException(status_code=400, detail="Pass confirm=true to proceed — this cannot be undone.")

    first_stage = await get_first_stage_name("pre_sales", "New Leads")
    reset_fields = {
        "stage": first_stage,
        "branch_id": None,
        "branch_stage": None,
        "consultation_stage": None,
        "head_consultation_stage": None,
        "physio_stage": None,
        "consultation_fee": None,
        "consultation_item_name": None,
        "consultation_mode": None,
        "consultation_payment_mode": None,
        "package_amount": None,
        "package_weeks": None,
        "package_id": None,
        "package_name": None,
        "package_price": None,
        "package_paid": None,
        "package_payment_mode": None,
        "package_sessions": None,
        "package_duration_minutes": None,
        "package_mode": None,
        "treatment_fee_paid": None,
        "treatment_fee_payment_mode": None,
        "treatment_fee_payment_details": None,
        "session_package_id": None,
        "session_package_name": None,
        "session_package_price": None,
        "session_package_sessions": None,
        "session_package_mode": None,
        "diagnosis": None,
        "physio_diagnosis_report": None,
        "physio_diagnosis_locked": False,
        "treatment_summary": None,
        "treatment_summary_locked": False,
        "assigned_physio_id": None,
        "assigned_physio_name": None,
        "physio_assigned_at": None,
        "assigned_user_id": None,
        "assigned_user_name": None,
        "rnr_attempts": 0,
        "rnr_last_attempt_at": None,
        "follow_ups": [],
        "next_follow_up_at": None,
        "consultation_follow_ups": [],
        "next_consultation_follow_up_at": None,
        "appointment_mode": None,
        "appointment_department": None,
        "appointment_date": None,
        "appointment_time": None,
        "appointment_datetime": None,
        "portfolio_date": None,
        "portfolio_time": None,
        "portfolio_datetime": None,
        "expected_consultation_date": None,
        "updated_at": now_iso(),
    }
    leads_result = await v3_col("leads").update_many({}, {"$set": reset_fields})

    # Treatment sessions only. The `sessions` collection also holds auth login tokens
    # ({token, user_id}), and an unfiltered delete here signed every user out of every
    # device — nothing to do with resetting leads. Treatment sessions are the ones
    # carrying lead_id; login tokens have none, so they can never match.
    sessions_deleted = (await v3_col("sessions").delete_many({"lead_id": {"$exists": True}})).deleted_count
    assessments_deleted = (await v3_col("weekly_assessments").delete_many({})).deleted_count
    recs_deleted = (await v3_col("package_recommendations").delete_many({})).deleted_count
    appts_deleted = (await v3_col("appointments").delete_many({})).deleted_count
    tokens_deleted = (await v3_col("patient_tokens").delete_many({})).deleted_count
    activity_deleted = (await v3_col("lead_activity").delete_many({})).deleted_count

    return {
        "message": "All leads reset to a fresh state",
        "leads_reset": leads_result.modified_count,
        "sessions_deleted": sessions_deleted,
        "weekly_assessments_deleted": assessments_deleted,
        "package_recommendations_deleted": recs_deleted,
        "appointments_deleted": appts_deleted,
        "patient_tokens_deleted": tokens_deleted,
        "lead_activity_deleted": activity_deleted,
    }
