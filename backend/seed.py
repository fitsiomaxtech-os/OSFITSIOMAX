import uuid
from database import db, v2_col, v3_col
from utils import now_iso
from security import hash_password
from constants import V3_VERTICALS, V3_BRANCH_STAGES, V3_STAGES


# Maps deprecated branch_stage labels (legacy 8-stage flow) to the new flow.
# Idempotent: runs every startup; only touches leads with a legacy value.
_LEGACY_BRANCH_STAGE_MAP = {
    "Call & Confirm": "Qualified",
    "Head Physio Appointment": "Appointment Date & Time",
    "Consultation Fee Collected": "Qualified",
    "Consultation Done": "Portfolio",
    "Follow-up Package Upsell": "Follow Up",
    "Package Paid": "Appointment Date & Time",
    "Jr. Physio Assigned": "Assigned Physio",
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
    # Branch stage migration
    for old, new in _LEGACY_BRANCH_STAGE_MAP.items():
        await v3_col("leads").update_many(
            {"branch_stage": old},
            {"$set": {"branch_stage": new, "updated_at": now_iso()}},
        )
    # Pre-sales stage migration
    for old, new in _LEGACY_PRESALES_STAGE_MAP.items():
        await v3_col("leads").update_many(
            {"stage": old},
            {"$set": {"stage": new, "updated_at": now_iso()}},
        )
    # When pre-sales stage = "Appointment" and branch_stage is empty, push to "New Appointment" so
    # it appears in Branch Admin's New Appointment column.
    await v3_col("leads").update_many(
        {"stage": "Appointment", "$or": [{"branch_stage": None}, {"branch_stage": ""}, {"branch_stage": {"$exists": False}}]},
        {"$set": {"branch_stage": "New Appointment", "updated_at": now_iso()}},
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
        {"full_name": "Super Admin", "email": "admin@fitsiomax.com", "password": "admin123", "role": "super_admin"},
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
