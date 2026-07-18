import uuid
from database import db, v2_col, v3_col
from utils import now_iso
from security import hash_password
from constants import V3_VERTICALS, V3_BRANCH_STAGES, V3_STAGES, V3_CONSULTATION_STAGES, V3_HEAD_CONSULTATION_STAGES
from stage_utils import get_first_stage_name


# Maps deprecated branch_stage labels (legacy 8-stage flow) to the new flow.
# Idempotent: runs every startup; only touches leads with a legacy value.
_LEGACY_BRANCH_STAGE_MAP = {
    "Call & Confirm": "New Appointment",
    "Qualified": "New Appointment",
    "Head Physio Appointment": "Appointment Date & Time",
    "Consultation Fee Collected": "New Appointment",
    "Consultation Done": "Portfolio",
    "Follow-up Package Upsell": "Follow Up",
    "Package Paid": "Appointment Date & Time",
    "Jr. Physio Assigned": "Appointment Date & Time",
    "Assigned Physio": "Appointment Date & Time",
    "Branch": "Appointment Date & Time",
}

# Maps deprecated pre-sales stage labels → new 4-stage flow.
_LEGACY_PRESALES_STAGE_MAP = {
    "New Lead": "New Leads",
    "Pre-sales Qualified": "Follow Up",
    "Assigned to Branch": "Appointment",
    "Branch Confirmed": "Appointment",
    "Appointment Booked": "Appointment",
    "Completed": "Appointment",
}


async def migrate_branch_stages() -> None:
    """Map legacy branch_stage and pre-sales stage values to new flows. Safe to re-run."""
    # Resolve the live first "sales" stage name once — Super Admin may have renamed it via
    # Pipeline Stage Management (e.g. "New Appointment" -> "New Leads"), and every legacy
    # mapping below that used to hardcode the literal "New Appointment" must land on whatever
    # that stage is actually called now, or the leads become invisible orphans on the board.
    first_branch_stage = await get_first_stage_name("sales", "New Appointment")
    legacy_branch_stage_map = {
        old: (first_branch_stage if new == "New Appointment" else new)
        for old, new in _LEGACY_BRANCH_STAGE_MAP.items()
    }
    # Branch stage migration
    for old, new in legacy_branch_stage_map.items():
        await v3_col("leads").update_many(
            {"branch_stage": old},
            {"$set": {"branch_stage": new, "updated_at": now_iso()}},
        )
    # Remove "Qualified" and "Assigned Physio" from pipeline_stages (sales type)
    await v3_col("pipeline_stages").delete_many({"type": "sales", "name": {"$in": ["Qualified", "Assigned Physio"]}})
    # Pre-sales stage migration
    for old, new in _LEGACY_PRESALES_STAGE_MAP.items():
        await v3_col("leads").update_many(
            {"stage": old},
            {"$set": {"stage": new, "updated_at": now_iso()}},
        )
    # Backfill orphaned leads: the Branch board's own total is every lead with a branch_id
    # assigned (regardless of the pre-sales "stage" field), so any such lead whose branch_stage
    # is empty or doesn't match a currently valid "sales" stage name (e.g. still stuck on a dead
    # literal from before a rename) gets moved onto the live first stage — otherwise it's counted
    # in "All Stages" but invisible in every individual stage pill.
    valid_branch_stages = set(await v3_col("pipeline_stages").distinct("name", {"type": "sales"}))
    if valid_branch_stages:
        # $nin against names only (not None/"") is deliberate: a missing/None/empty branch_stage
        # is never "in" that list of real names either, so it's naturally caught by this same
        # filter and doesn't need a separate query.
        await v3_col("leads").update_many(
            {"branch_id": {"$ne": None}, "branch_stage": {"$nin": list(valid_branch_stages)}},
            {"$set": {"branch_stage": first_branch_stage, "updated_at": now_iso()}},
        )
    # Re-seed pipeline_stages of type=sales with the new names if any legacy entries exist.
    legacy_sales = await v3_col("pipeline_stages").find(
        {"type": "sales", "name": {"$in": list(_LEGACY_BRANCH_STAGE_MAP.keys())}},
        {"_id": 0, "id": 1},
    ).to_list(50)
    if legacy_sales:
        await v3_col("pipeline_stages").delete_many({"type": "sales"})
        SALES_COLORS = ["#0ea5e9", "#22c55e", "#a855f7", "#f59e0b", "#06b6d4", "#14b8a6", "#6366f1", "#ef4444"]
        docs = []
        for idx, name in enumerate(V3_BRANCH_STAGES):
            docs.append({
                "id": str(uuid.uuid4()),
                "name": name,
                "color": SALES_COLORS[idx % len(SALES_COLORS)],
                "type": "sales",
                "order": idx,
                "is_final": name in ("Assigned Physio", "Cancelled"),
                "created_at": now_iso(),
            })
        if docs:
            await v3_col("pipeline_stages").insert_many(docs)
    # Re-seed pipeline_stages of type=pre_sales with the new names if any legacy entries exist.
    legacy_pre = await v3_col("pipeline_stages").find(
        {"type": "pre_sales", "name": {"$in": list(_LEGACY_PRESALES_STAGE_MAP.keys())}},
        {"_id": 0, "id": 1},
    ).to_list(50)
    if legacy_pre:
        await v3_col("pipeline_stages").delete_many({"type": "pre_sales"})
        PRESALES_COLORS = ["#0ea5e9", "#ef4444", "#f59e0b", "#22c55e"]
        docs = []
        for idx, name in enumerate(V3_STAGES):
            docs.append({
                "id": str(uuid.uuid4()),
                "name": name,
                "color": PRESALES_COLORS[idx % len(PRESALES_COLORS)],
                "type": "pre_sales",
                "order": idx,
                "is_final": name == "Appointment",
                "created_at": now_iso(),
            })
        if docs:
            await v3_col("pipeline_stages").insert_many(docs)


# Maps deprecated consultation_stage labels (legacy 6-stage flow) to the new 7-stage flow.
# Idempotent: runs every startup; only touches leads with a legacy value.
_LEGACY_CONSULTATION_STAGE_MAP = {
    "Clinic Visit": "Consultation Visit",
    "Package Chosen": "Treatment Fee",
    "Completed": "Treatment Fee",
    "Cancelled": "Cancel",
}


async def migrate_consultation_stages() -> None:
    """Map legacy consultation_stage values to the new flow and (re)seed pipeline_stages
    of type=consultation. Safe to re-run."""
    for old, new in _LEGACY_CONSULTATION_STAGE_MAP.items():
        await v3_col("leads").update_many(
            {"consultation_stage": old},
            {"$set": {"consultation_stage": new, "updated_at": now_iso()}},
        )
    legacy = await v3_col("pipeline_stages").find(
        {"type": "consultation", "name": {"$in": list(_LEGACY_CONSULTATION_STAGE_MAP.keys())}},
        {"_id": 0, "id": 1},
    ).to_list(50)
    existing_count = await v3_col("pipeline_stages").count_documents({"type": "consultation"})
    if legacy or existing_count == 0:
        await v3_col("pipeline_stages").delete_many({"type": "consultation"})
        CONSULTATION_COLORS = ["#3b82f6", "#f43f5e", "#f97316", "#8b5cf6", "#14b8a6", "#22c55e", "#64748b"]
        docs = []
        for idx, name in enumerate(V3_CONSULTATION_STAGES):
            docs.append({
                "id": str(uuid.uuid4()),
                "name": name,
                "color": CONSULTATION_COLORS[idx % len(CONSULTATION_COLORS)],
                "type": "consultation",
                "order": idx,
                "is_final": name in ("Physio Assign", "Cancel"),
                "created_at": now_iso(),
            })
        if docs:
            await v3_col("pipeline_stages").insert_many(docs)

    # Additive: make sure newer consultation stages (added after the initial seed) exist too,
    # without disturbing any Super Admin edits (color/order/rename) made to the existing ones.
    existing_names = set(await v3_col("pipeline_stages").find(
        {"type": "consultation"}, {"_id": 0, "name": 1}
    ).distinct("name"))
    new_stage_specs = [(name, color) for name, color in
                        [("Consultation Pack", "#0ea5e9"), ("Physio Assign", "#a855f7")]
                        if name not in existing_names]
    if new_stage_specs:
        anchor = await v3_col("pipeline_stages").find_one(
            {"type": "consultation", "name": "Consultation Visit"}, {"_id": 0, "order": 1}
        )
        if anchor is not None:
            await v3_col("pipeline_stages").update_many(
                {"type": "consultation", "order": {"$gt": anchor["order"]}},
                {"$inc": {"order": len(new_stage_specs)}},
            )
            base_order = anchor["order"] + 1
        else:
            last = await v3_col("pipeline_stages").find(
                {"type": "consultation"}, {"_id": 0, "order": 1}
            ).sort("order", -1).limit(1).to_list(1)
            base_order = (last[0]["order"] + 1) if last else 0
        docs = [{
            "id": str(uuid.uuid4()),
            "name": name,
            "color": color,
            "type": "consultation",
            "order": base_order + idx,
            "is_final": False,
            "created_at": now_iso(),
        } for idx, (name, color) in enumerate(new_stage_specs)]
        await v3_col("pipeline_stages").insert_many(docs)

    # Reorder: Physio Assign now happens after fee collection (Consultation Fee, then
    # Treatment Fee), not before — a physio shouldn't be assigned to deliver sessions
    # until payment is settled. Only re-order if it's still positioned before Treatment
    # Fee, so a Super Admin who deliberately moved it elsewhere isn't fought on restart.
    physio_assign = await v3_col("pipeline_stages").find_one(
        {"type": "consultation", "name": "Physio Assign"}, {"_id": 0, "order": 1}
    )
    treatment_fee = await v3_col("pipeline_stages").find_one(
        {"type": "consultation", "name": "Treatment Fee"}, {"_id": 0, "order": 1}
    )
    if physio_assign and treatment_fee and physio_assign["order"] < treatment_fee["order"]:
        old_order, new_order = physio_assign["order"], treatment_fee["order"]
        await v3_col("pipeline_stages").update_many(
            {"type": "consultation", "order": {"$gt": old_order, "$lte": new_order}},
            {"$inc": {"order": -1}},
        )
        await v3_col("pipeline_stages").update_one(
            {"type": "consultation", "name": "Physio Assign"},
            {"$set": {"order": new_order, "is_final": True}},
        )

    # Backfill orphaned leads: any lead with a consultation_stage set that no longer matches a
    # currently valid stage name (e.g. still stuck on a legacy/dead literal, or Super Admin
    # renamed the first stage) gets moved onto the live first stage — otherwise it's counted in
    # "All Stages" but invisible in every individual stage pill.
    valid_consultation_stages = set(await v3_col("pipeline_stages").distinct("name", {"type": "consultation"}))
    if valid_consultation_stages:
        first_consultation_stage = await get_first_stage_name("consultation", "New Appointment")
        await v3_col("leads").update_many(
            {"consultation_stage": {"$ne": None, "$nin": list(valid_consultation_stages)}},
            {"$set": {"consultation_stage": first_consultation_stage, "updated_at": now_iso()}},
        )


async def migrate_head_consultation_stages() -> None:
    """Seed the standalone Head Physio consultation pipeline (type=head_consultation,
    lead field=head_consultation_stage) — fully independent from Branch's own
    consultation_stage pipeline. Safe to re-run; only seeds once."""
    existing_count = await v3_col("pipeline_stages").count_documents({"type": "head_consultation"})
    if existing_count > 0:
        return
    HEAD_CONSULTATION_COLORS = ["#3b82f6", "#0ea5e9", "#8b5cf6", "#a855f7"]
    docs = []
    for idx, name in enumerate(V3_HEAD_CONSULTATION_STAGES):
        docs.append({
            "id": str(uuid.uuid4()),
            "name": name,
            "color": HEAD_CONSULTATION_COLORS[idx % len(HEAD_CONSULTATION_COLORS)],
            "type": "head_consultation",
            "order": idx,
            "is_final": name in ("Physio Assign",),
            "created_at": now_iso(),
        })
    if docs:
        await v3_col("pipeline_stages").insert_many(docs)


async def deactivate_legacy_demo_admin() -> None:
    """Disable the old demo super_admin account (admin@fitsiomax.com / admin123).
    Replaced by a real Super Admin login; kept as a record for audit, not deleted. Safe to re-run."""
    await v3_col("users").update_one(
        {"email": "admin@fitsiomax.com", "role": "super_admin"},
        {"$set": {"is_active": False}},
    )


async def sync_head_physio_doctors() -> None:
    """Head physios created via HR's Roles & Credentials only get a `users` row; Branch Admin's
    calendar reads the separate `doctors` collection. Backfill a matching doctors row (linked via
    user_id) for any head_physio user that doesn't have one yet, so their calendar is manageable.
    Also keeps `doctors.full_name` in sync with the linked user's current name — it's a
    denormalized copy that otherwise goes stale whenever the user is renamed. Safe to re-run."""
    linked_user_ids = set(await v3_col("doctors").distinct("user_id"))
    cursor = v3_col("users").find({"role": "head_physio", "is_active": True}, {"_id": 0})
    async for user in cursor:
        if user["id"] not in linked_user_ids:
            await v3_col("doctors").insert_one({
                "id": str(uuid.uuid4()),
                "full_name": user["full_name"],
                "profile_type": "head_physio",
                "branch_id": user.get("branch_id"),
                "specialization": "",
                "slots": [],
                "slot_details": [],
                "user_id": user["id"],
                "created_at": now_iso(),
            })
            continue
        await v3_col("doctors").update_many(
            {"user_id": user["id"], "full_name": {"$ne": user["full_name"]}},
            {"$set": {"full_name": user["full_name"]}},
        )


async def ensure_v1_seed_data() -> None:
    users_count = await db.users.count_documents({})
    if users_count == 0:
        await db.users.insert_one(
            {
                "id": str(uuid.uuid4()),
                "full_name": "Super Admin",
                "email": "admin@physiofit.com",
                "password": hash_password("admin123"),
                "role": "super_admin",
                "branch_id": None,
                "is_active": True,
                "created_at": now_iso(),
            }
        )

    default_role_users = [
        {
            "full_name": "Pre-sales Executive",
            "email": "presales@physiofit.com",
            "password": "presales123",
            "role": "pre_sales",
        },
        {
            "full_name": "Sales Executive",
            "email": "sales@physiofit.com",
            "password": "sales123",
            "role": "sales",
        },
    ]

    for default_user in default_role_users:
        exists = await db.users.find_one({"email": default_user["email"]}, {"_id": 0})
        if not exists:
            await db.users.insert_one(
                {
                    "id": str(uuid.uuid4()),
                    "full_name": default_user["full_name"],
                    "email": default_user["email"],
                    "password": hash_password(default_user["password"]),
                    "role": default_user["role"],
                    "branch_id": None,
                    "is_active": True,
                    "created_at": now_iso(),
                }
            )

    stages_count = await db.stages.count_documents({})
    if stages_count == 0:
        base_stages = [
            {"name": "New Lead", "pipeline": "pre_sales", "order": 1},
            {"name": "Follow Up", "pipeline": "pre_sales", "order": 2},
            {"name": "Appointment Booked", "pipeline": "pre_sales", "order": 3},
            {"name": "New Appointment", "pipeline": "sales", "order": 1},
            {"name": "Discussion", "pipeline": "sales", "order": 2},
            {"name": "Package Purchased", "pipeline": "sales", "order": 3},
        ]
        for item in base_stages:
            await db.stages.insert_one(
                {
                    "id": str(uuid.uuid4()),
                    "name": item["name"],
                    "pipeline": item["pipeline"],
                    "order": item["order"],
                    "created_at": now_iso(),
                }
            )

    await db.sheets_configs.update_one(
        {"singleton": "global"},
        {
            "$setOnInsert": {
                "singleton": "global",
                "spreadsheet_id": "",
                "sheet_name": "Leads",
                "column_mapping": {},
                "last_sync": None,
                "updated_at": now_iso(),
            }
        },
        upsert=True,
    )


async def v2_seed() -> None:
    users = [
        {"full_name": "Super Admin", "email": "admin@fitsiomax.com", "password": "admin123", "role": "super_admin"},
        {"full_name": "Online Fitness", "email": "onlinefitness@fitsiomax.com", "password": "online123", "role": "online_fitness"},
        {"full_name": "Online Physio", "email": "onlinephysio@fitsiomax.com", "password": "physio123", "role": "online_physio"},
        {"full_name": "Offline Physio", "email": "offlinephysio@fitsiomax.com", "password": "offline123", "role": "offline_physio"},
    ]
    for user in users:
        exists = await v2_col("users").find_one({"email": user["email"]}, {"_id": 0})
        if not exists:
            await v2_col("users").insert_one(
                {
                    "id": str(uuid.uuid4()),
                    "full_name": user["full_name"],
                    "email": user["email"],
                    "password": hash_password(user["password"]),
                    "role": user["role"],
                    "is_active": True,
                    "created_at": now_iso(),
                }
            )

    if await v2_col("services").count_documents({}) == 0:
        defaults = [
            {"name": "Online Fitness Program", "mode": "online", "category": "fitness_program"},
            {"name": "Online Physio Therapy", "mode": "online", "category": "physio_therapy"},
            {"name": "Offline Physio Therapy", "mode": "offline", "category": "physio_therapy"},
            {"name": "Offline Fitness GYM", "mode": "offline", "category": "offline_fitness_gym"},
        ]
        for item in defaults:
            await v2_col("services").insert_one(
                {
                    "id": str(uuid.uuid4()),
                    "name": item["name"],
                    "mode": item["mode"],
                    "category": item["category"],
                    "created_at": now_iso(),
                }
            )


async def v3_seed() -> None:
    seed_users = [
        {"full_name": "Super Admin", "email": "fitsiomaxtech@gmail.com", "password": "FitsioMax06", "role": "super_admin"},
        {"full_name": "Business Development", "email": "businessdev@fitsiomax.com", "password": "bd123", "role": "business_dev"},
        {"full_name": "Pre Sales", "email": "presales@fitsiomax.com", "password": "presales123", "role": "pre_sales"},
        {"full_name": "Branch Admin", "email": "branchadmin@fitsiomax.com", "password": "branch123", "role": "branch_admin"},
        {"full_name": "Head Physio", "email": "headphysio@fitsiomax.com", "password": "head123", "role": "head_physio"},
        {"full_name": "Physio", "email": "physio@fitsiomax.com", "password": "physio123", "role": "physio"},
    ]
    for user in seed_users:
        exists = await v3_col("users").find_one({"email": user["email"]}, {"_id": 0})
        if not exists:
            await v3_col("users").insert_one(
                {
                    "id": str(uuid.uuid4()),
                    "full_name": user["full_name"],
                    "email": user["email"],
                    "password": hash_password(user["password"]),
                    "role": user["role"],
                    "branch_id": None,
                    "is_active": True,
                    "created_at": now_iso(),
                }
            )

    if await v3_col("verticals").count_documents({}) == 0:
        for name in V3_VERTICALS:
            await v3_col("verticals").insert_one(
                {
                    "id": str(uuid.uuid4()),
                    "name": name,
                    "active": True,
                    "created_at": now_iso(),
                }
            )

    first_branch = await v3_col("branches").find_one({}, {"_id": 0})
    branch_admin_user = await v3_col("users").find_one({"email": "branchadmin@fitsiomax.com"}, {"_id": 0})

    if not first_branch and branch_admin_user:
        seeded_branch_id = str(uuid.uuid4())
        seeded_branch = {
            "id": seeded_branch_id,
            "branch_name": "Anna Nagar Seed Branch",
            "address": "Anna Nagar, Chennai",
            "admin_user_id": branch_admin_user["id"],
            "admin_name": branch_admin_user["full_name"],
            "admin_email": branch_admin_user["email"],
            "admin_phone": "",
            "vertical": "offline_physiotherapy",
            "created_at": now_iso(),
        }
        await v3_col("branches").insert_one(seeded_branch.copy())
        first_branch = seeded_branch

    if first_branch:
        await v3_col("users").update_many(
            {
                "email": {"$in": ["branchadmin@fitsiomax.com", "headphysio@fitsiomax.com", "physio@fitsiomax.com"]},
                "branch_id": None,
            },
            {"$set": {"branch_id": first_branch["id"]}},
        )

    if await v3_col("team_members").count_documents({}) == 0:
        seed_team = [
            {
                "id": str(uuid.uuid4()),
                "full_name": "Karthik Reddy",
                "email": "presales@constructions.com",
                "team_type": "pre_sales",
                "created_at": now_iso(),
            },
            {
                "id": str(uuid.uuid4()),
                "full_name": "Divya Pillai",
                "email": "sales@constructions.com",
                "team_type": "sales",
                "created_at": now_iso(),
            },
        ]
        await v3_col("team_members").insert_many([item.copy() for item in seed_team])
