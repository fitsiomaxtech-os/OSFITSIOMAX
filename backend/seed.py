import uuid
from database import db, v2_col, v3_col
from utils import now_iso, derive_branch_code, generate_patient_number
from security import hash_password
from constants import (
    V3_VERTICALS, V3_BRANCH_STAGES, V3_STAGES, V3_CONSULTATION_STAGES, V3_HEAD_CONSULTATION_STAGES,
    BRANCH_ADMIN_ENTRY_STAGE, BRANCH_ADMIN_RNR_STAGE,
)
import lead_control
from stage_utils import get_first_stage_name, first_branch_stage_for, realign_branch_stage_leads


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

# Maps deprecated pre-sales stage labels → new 4-stage flow. RNR is its own stage
# again (see ensure_rnr_stage below) — no longer mapped away to Follow Up.
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
    # Pinned to the Pre-Sales side: the two modes now share order 0, so "the first sales
    # stage" is ambiguous on its own. Legacy leads predate Lead Control and belong on the
    # original entry stage; ensure_branch_admin_stages then rehomes the branch-run ones.
    first_branch_stage = await first_branch_stage_for(lead_control.PRE_SALES, "New Appointment")
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
        # Which entry stage an orphan lands on depends on the branch it belongs to: a branch
        # running its own leads opens at Branch Assign, one fed by Pre-Sales at New Appointment.
        # Grouped by control so this stays two writes rather than one per branch.
        control_map = await lead_control.branch_control_map()
        branches_by_control = {}
        for branch_id, control in control_map.items():
            branches_by_control.setdefault(control, []).append(branch_id)
        for control, branch_ids in branches_by_control.items():
            entry_stage = await first_branch_stage_for(control, first_branch_stage)
            # $nin against names only (not None/"") is deliberate: a missing/None/empty branch_stage
            # is never "in" that list of real names either, so it's naturally caught by this same
            # filter and doesn't need a separate query.
            await v3_col("leads").update_many(
                {"branch_id": {"$in": branch_ids}, "branch_stage": {"$nin": list(valid_branch_stages)}},
                {"$set": {"branch_stage": entry_stage, "updated_at": now_iso()}},
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


async def ensure_rnr_stage() -> None:
    """RNR was folded into Follow Up when the pre-sales pipeline was cut down to 3 stages;
    it's back as its own stage between New Leads and Follow Up. Idempotent: only inserts it
    once, shifting every later pre-sales stage's order forward by one to make room. A no-op
    if pre-sales stages haven't been seeded yet (migrate_branch_stages/_ensure_seed already
    build the full V3_STAGES list, RNR included, in that case)."""
    existing = await v3_col("pipeline_stages").find_one({"type": "pre_sales", "name": "RNR"}, {"_id": 0, "id": 1})
    if existing:
        return
    new_leads = await v3_col("pipeline_stages").find_one({"type": "pre_sales", "name": "New Leads"}, {"_id": 0, "order": 1})
    if not new_leads:
        return
    insert_order = new_leads["order"] + 1
    await v3_col("pipeline_stages").update_many(
        {"type": "pre_sales", "order": {"$gte": insert_order}},
        {"$inc": {"order": 1}},
    )
    await v3_col("pipeline_stages").insert_one({
        "id": str(uuid.uuid4()),
        "name": "RNR",
        "color": "#ef4444",
        "type": "pre_sales",
        "order": insert_order,
        "is_final": False,
        "created_at": now_iso(),
    })


async def ensure_branch_admin_stages() -> None:
    """Give the Branch pipeline its Branch-Admin-only opening: Branch Assign, then RNR.

    A branch fed by the Pre-Sales desk receives leads already qualified and booked, so its
    board opens at "New Appointment". A branch running its own leads receives them raw and
    has to work them itself, so it opens at "Branch Assign" and needs somewhere to park the
    calls nobody picks up. Both shapes share one `sales` stage list and are told apart by
    `applies_to` (see constants.py), which is why this inserts stages rather than renaming
    the existing one — a rename would drag every Pre-Sales branch along with it.

    Idempotent: kept as a no-op once Branch Assign exists, so a Super Admin who later
    renames or deletes either stage does not get it silently recreated on next boot.
    """
    existing = await v3_col("pipeline_stages").find_one(
        {"type": "sales", "applies_to": lead_control.BRANCH_ADMIN}, {"_id": 0, "id": 1}
    )
    if existing:
        return
    # Position both new stages against whatever the current entry stage is, rather than
    # against the literal "New Appointment" — Pipeline Stage Management may have renamed it.
    entry = await v3_col("pipeline_stages").find(
        {"type": "sales"}, {"_id": 0, "id": 1, "name": 1, "order": 1}
    ).sort("order", 1).limit(1).to_list(1)
    if not entry:
        return  # stages not seeded yet; _ensure_seed builds the list first
    entry_stage = entry[0]
    entry_order = entry_stage["order"]

    # The stage that was global until now becomes the Pre-Sales-side entry only. Every
    # later stage (Follow Up onwards) stays shared and just shifts to make room for RNR.
    await v3_col("pipeline_stages").update_one(
        {"id": entry_stage["id"]}, {"$set": {"applies_to": lead_control.PRE_SALES}}
    )
    await v3_col("pipeline_stages").update_many(
        {"type": "sales", "order": {"$gt": entry_order}}, {"$inc": {"order": 1}}
    )
    await v3_col("pipeline_stages").insert_many([
        {
            "id": str(uuid.uuid4()),
            "name": BRANCH_ADMIN_ENTRY_STAGE,
            "color": "#0ea5e9",
            "type": "sales",
            # Shares the entry slot with the Pre-Sales stage it stands in for: only one of
            # the two is ever visible to a given branch, so they never collide on a board.
            "order": entry_order,
            "is_final": False,
            "applies_to": lead_control.BRANCH_ADMIN,
            "created_at": now_iso(),
        },
        {
            "id": str(uuid.uuid4()),
            "name": BRANCH_ADMIN_RNR_STAGE,
            "color": "#ef4444",
            "type": "sales",
            "order": entry_order + 1,
            "is_final": False,
            "applies_to": lead_control.BRANCH_ADMIN,
            "created_at": now_iso(),
        },
    ])

    # Branches already switched to Branch Admin have a backlog sitting on the stage that
    # just became Pre-Sales-only — it would vanish from their board otherwise.
    branches = await v3_col("branches").find({}, {"_id": 0, "id": 1, "lead_control": 1}).to_list(1000)
    for branch in branches:
        if lead_control.normalize(branch.get("lead_control")) == lead_control.BRANCH_ADMIN:
            await realign_branch_stage_leads(branch["id"], lead_control.BRANCH_ADMIN)


# The stage briefly promoted from the mirrored "Leads" pill into a real branch stage, and
# rolled back again. Named here rather than in constants.py because nothing but the rollback
# below refers to it any more.
_ROLLED_BACK_LEADS_STAGE = "Leads"


async def undo_branch_leads_stage() -> None:
    """Take the Branch pipeline back off the real "Leads" stage, leaving the mirrored pill.

    Reverting that change in code is not enough on its own: the stage row and the leads
    moved onto it are still in the database, and the mirrored pill this code draws is also
    called "Leads" — so the board would render the pair of them, two pills with one name and
    the branch's leads split across both. This puts the data back to match the code.

    Idempotent, and a no-op on any database that never took the change.
    """
    leads_stage = await v3_col("pipeline_stages").find_one(
        {"type": "sales", "name": _ROLLED_BACK_LEADS_STAGE}, {"_id": 0, "id": 1, "order": 1}
    )
    if not leads_stage:
        return
    # Back where they were: everything on Leads arrived by import and was moved off Branch
    # Assign by the change now being undone.
    await v3_col("leads").update_many(
        {"branch_stage": _ROLLED_BACK_LEADS_STAGE},
        {"$set": {"branch_stage": BRANCH_ADMIN_ENTRY_STAGE, "updated_at": now_iso()}},
    )
    await v3_col("pipeline_stages").delete_one({"id": leads_stage["id"]})
    # Close the gap it left, so Branch Assign is back at the head of the pipeline.
    await v3_col("pipeline_stages").update_many(
        {"type": "sales", "order": {"$gt": leads_stage["order"]}}, {"$inc": {"order": -1}}
    )
    # `entry` only ever existed to tell the two openings apart. With one opening again,
    # nothing reads it, and leaving it behind would mislead the next person to look.
    await v3_col("pipeline_stages").update_many({"type": "sales"}, {"$unset": {"entry": ""}})
    # The catch-up that filled Leads from Pre-Sales New Leads is a one-shot, and its marker
    # outlives the code being reverted. Left behind, it would sit there claiming the work was
    # already done and quietly stop that migration ever running again if it is reapplied.
    await v3_col("migrations").delete_one({"name": "backfill_leads_stage_from_presales"})


# Maps deprecated consultation_stage labels (legacy 6-stage flow) to the new 7-stage flow.
# Idempotent: runs every startup; only touches leads with a legacy value.
_LEGACY_CONSULTATION_STAGE_MAP = {
    "Clinic Visit": "Consultation Visit",
    "Package Chosen": "Fee Collected",
    "Completed": "Fee Collected",
    "Cancelled": "Cancel",
    "Consultation Fee": "Fee Collected",
    "Treatment Fee": "Physio Assign",
    "Consultation Fee Collected": "Fee Collected",
    "Treatment Fee Collected": "Physio Assign",
    "RNR": "Follow Up",
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
                "is_final": name in ("Physio Assign", "Consultation Completed", "Cancel"),
                "created_at": now_iso(),
            })
        if docs:
            await v3_col("pipeline_stages").insert_many(docs)

    # Retire Consultation Pack as a separate stage on Branch's own consultation pipeline —
    # the flow now connects directly Consultation Visit -> Consultation Fee. Backfill any
    # lead still sitting on it first (to Consultation Fee, the natural next stage), so
    # nothing goes orphaned once the stage doc is removed. Unconditional/safe to re-run
    # (not gated behind an existence check beyond the deletion itself, so a lead that ends
    # up on this dead value later — e.g. via a stale client — still gets corrected).
    await v3_col("leads").update_many(
        {"consultation_stage": "Consultation Pack"},
        {"$set": {"consultation_stage": "Fee Collected", "updated_at": now_iso()}},
    )
    await v3_col("pipeline_stages").delete_many({"type": "consultation", "name": "Consultation Pack"})

    # Retire "New Appointment" from Branch's own consultation pipeline — consultations
    # now begin at Follow Up. Backfill any lead still sitting on it first so nothing is
    # orphaned, then drop the stage doc. Scoped to type="consultation" only: the Head
    # Physio's independent pipeline keeps its own New Appointment stage.
    await v3_col("leads").update_many(
        {"consultation_stage": "New Appointment"},
        {"$set": {"consultation_stage": "Follow Up", "updated_at": now_iso()}},
    )
    await v3_col("pipeline_stages").delete_many({"type": "consultation", "name": "New Appointment"})

    # Additive: make sure newer consultation stages (added after the initial seed) exist too,
    # without disturbing any Super Admin edits (color/order/rename) made to the existing ones.
    existing_names = set(await v3_col("pipeline_stages").find(
        {"type": "consultation"}, {"_id": 0, "name": 1}
    ).distinct("name"))
    new_stage_specs = [(name, color) for name, color in
                        [("Physio Assign", "#a855f7")]
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

    # Reorder: Physio Assign now happens after fee collection, not before — a physio
    # shouldn't be assigned to deliver sessions until payment is settled. Only re-order
    # if it's still positioned before Fee Collected, so a Super Admin who deliberately
    # moved it elsewhere isn't fought on restart.
    physio_assign = await v3_col("pipeline_stages").find_one(
        {"type": "consultation", "name": "Physio Assign"}, {"_id": 0, "order": 1}
    )
    treatment_fee = await v3_col("pipeline_stages").find_one(
        {"type": "consultation", "name": "Fee Collected"}, {"_id": 0, "order": 1}
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
        first_consultation_stage = await get_first_stage_name("consultation", "Follow Up")
        await v3_col("leads").update_many(
            {"consultation_stage": {"$ne": None, "$nin": list(valid_consultation_stages)}},
            {"$set": {"consultation_stage": first_consultation_stage, "updated_at": now_iso()}},
        )


async def migrate_head_consultation_stages() -> None:
    """Seed the standalone Head Physio consultation pipeline (type=head_consultation,
    lead field=head_consultation_stage) — fully independent from Branch's own
    consultation_stage pipeline. Safe to re-run."""
    existing_count = await v3_col("pipeline_stages").count_documents({"type": "head_consultation"})
    if existing_count == 0:
        HEAD_CONSULTATION_COLORS = ["#3b82f6", "#0ea5e9", "#8b5cf6", "#a855f7"]
        docs = []
        for idx, name in enumerate(V3_HEAD_CONSULTATION_STAGES):
            docs.append({
                "id": str(uuid.uuid4()),
                "name": name,
                "color": HEAD_CONSULTATION_COLORS[idx % len(HEAD_CONSULTATION_COLORS)],
                "type": "head_consultation",
                "order": idx,
                "is_final": name in ("Consultation Visit",),
                "created_at": now_iso(),
            })
        if docs:
            await v3_col("pipeline_stages").insert_many(docs)

    # Retire Consultation Pack / Physio Assign as separate stages on Head Physio's own
    # pipeline — package selection is now an inline part of the lead popup (not a stage
    # move), and physio assignment moved entirely to Branch Admin's board (after
    # Treatment Fee). Backfill any lead still sitting on one of these first, so nothing
    # goes orphaned once the stage itself is removed.
    retired_names = ["Consultation Pack", "Physio Assign"]
    retired = await v3_col("pipeline_stages").find(
        {"type": "head_consultation", "name": {"$in": retired_names}}, {"_id": 0, "id": 1}
    ).to_list(10)
    if retired:
        await v3_col("leads").update_many(
            {"head_consultation_stage": {"$in": retired_names}},
            {"$set": {"head_consultation_stage": "Consultation Visit", "updated_at": now_iso()}},
        )
        await v3_col("pipeline_stages").delete_many({"type": "head_consultation", "name": {"$in": retired_names}})

    # Correction (unconditional, safe to re-run): the backfill above only touched
    # head_consultation_stage, so any lead it moved to Consultation Visit could be left
    # showing an earlier Branch stage (e.g. still "New Appointment") even though the
    # doctor's own board says they're already at Consultation Visit or beyond. Advance
    # Branch's own consultation_stage to match for any lead that's behind — but never
    # regress one that's already further along (or cancelled) on Branch's side.
    branch_stage_order = [
        r["name"] for r in await v3_col("pipeline_stages").find(
            {"type": "consultation"}, {"_id": 0, "name": 1}
        ).sort("order", 1).to_list(50)
    ]
    if "Consultation Visit" in branch_stage_order:
        behind_stages = branch_stage_order[:branch_stage_order.index("Consultation Visit")]
        await v3_col("leads").update_many(
            {
                "head_consultation_stage": "Consultation Visit",
                "consultation_stage": {"$in": behind_stages + [None]},
            },
            {"$set": {"consultation_stage": "Consultation Visit", "updated_at": now_iso()}},
        )


SESSION_ITEM_RATE_PER_SESSION_ONLINE = 1200
SESSION_ITEM_RATE_PER_SESSION_OFFLINE = 800


async def normalize_session_item_prices() -> None:
    """Enforce the fixed per-session rate across every FITSIO STORE Session item
    (the week-based Treatment Packages, e.g. "01 Week" = 7 sessions, "05 week" = 35
    sessions) — price_online/price_offline is a FLAT per-session rate, Rs.1200
    Online and Rs.800 Offline, identical across every package size; only the
    session count differs between packages, never the rate. (The Store UI and
    hp_consultation_decision() both multiply this rate by a session count
    themselves — it must never be pre-multiplied here.) Idempotent/safe to
    re-run: only writes an item whose price doesn't already match."""
    session_items = await v3_col("store_items").find({"item_type": "session"}, {"_id": 0}).to_list(500)
    for item in session_items:
        updates = {}
        if item.get("sessions_offline") and item.get("price_offline") != SESSION_ITEM_RATE_PER_SESSION_OFFLINE:
            updates["price_offline"] = SESSION_ITEM_RATE_PER_SESSION_OFFLINE
        if item.get("sessions_online") and item.get("price_online") != SESSION_ITEM_RATE_PER_SESSION_ONLINE:
            updates["price_online"] = SESSION_ITEM_RATE_PER_SESSION_ONLINE
        if updates:
            updates["updated_at"] = now_iso()
            await v3_col("store_items").update_one({"id": item["id"]}, {"$set": updates})


async def normalize_lead_session_package_prices() -> None:
    """A lead's session_package_price is copied from the store item's price at the
    moment the Head Physio's Consultation Decision was saved — leads saved before
    normalize_session_item_prices() fixed the store item's price are left holding
    the old, wrong total forever, since that copy is never recomputed live. Refresh
    every lead's session_package_price to sessions x the correct per-session rate
    for that lead's own mode (Rs.1200 Online / Rs.800 Offline) wherever it doesn't
    already match. Only touches leads that haven't paid the Treatment Fee yet — once
    treatment_fee_paid is on file, that figure is a real financial record and must
    never be silently rewritten. Idempotent/safe to re-run."""
    leads = await v3_col("leads").find(
        {"session_package_sessions": {"$ne": None}, "treatment_fee_paid": None},
        {"_id": 0, "id": 1, "session_package_sessions": 1, "session_package_price": 1, "session_package_mode": 1},
    ).to_list(2000)
    for lead in leads:
        rate = SESSION_ITEM_RATE_PER_SESSION_ONLINE if lead.get("session_package_mode") == "online" else SESSION_ITEM_RATE_PER_SESSION_OFFLINE
        expected_price = round(lead["session_package_sessions"] * rate, 2)
        if lead.get("session_package_price") != expected_price:
            await v3_col("leads").update_one(
                {"id": lead["id"]},
                {"$set": {"session_package_price": expected_price, "updated_at": now_iso()}},
            )


async def backfill_branch_codes() -> None:
    """Every branch needs a short unique code (e.g. 'ANN' for Anna Nagar, 'ECR' for ECR)
    that prefixes its patients' Patient Numbers. Auto-derives one from the branch name
    for any branch that doesn't already have one set (existing branches, first run).
    Idempotent/safe to re-run — only ever fills in a missing code, never overwrites one
    a Super Admin already set."""
    branches = await v3_col("branches").find({}, {"_id": 0, "id": 1, "branch_name": 1, "code": 1}).to_list(1000)
    existing_codes = {b["code"] for b in branches if b.get("code")}
    for b in branches:
        if b.get("code"):
            continue
        code = derive_branch_code(b.get("branch_name", ""), existing_codes)
        existing_codes.add(code)
        await v3_col("branches").update_one({"id": b["id"]}, {"$set": {"code": code}})


async def backfill_patient_numbers() -> None:
    """Assign a Patient Number (BRANCHCODE-YYMMDD-SEQUENCE, e.g. ANN-260727-0000) to any
    lead that has a branch_id but no patient_number yet — processed oldest-first so the
    sequence reads chronologically. Runs after backfill_branch_codes() so every branch
    already has a code to draw from. Uses the same atomic per-branch-per-day counter as
    live lead creation, so a backfilled number can never collide with one a real request
    assigns for the same branch+day. Idempotent/safe to re-run."""
    leads = await v3_col("leads").find(
        {"branch_id": {"$ne": None}, "patient_number": None},
        {"_id": 0, "id": 1, "branch_id": 1, "created_at": 1},
    ).sort("created_at", 1).to_list(20000)
    for lead in leads:
        patient_number = await generate_patient_number(lead["branch_id"], at=lead.get("created_at"))
        if patient_number:
            await v3_col("leads").update_one({"id": lead["id"]}, {"$set": {"patient_number": patient_number}})


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


async def consolidate_head_physio_doctors() -> None:
    """Collapse each Head Physio down to one branchless expert record.

    Head Physios cover every branch, but the old model gave them one `doctors` record per
    assigned branch. That left duplicates in every expert picker, and split their published
    availability across records — which is why a branch could show a Head Physio as having
    published nothing while their real slots sat on a sibling record.

    Slots are merged rather than picked, so no published availability is lost, and the
    surviving record keeps the id that appointments already point at wherever possible.
    Safe to re-run: once each user has a single branchless record there is nothing to do.
    """
    by_user: dict = {}
    cursor = v3_col("doctors").find({"profile_type": "head_physio"}, {"_id": 0})
    async for doc in cursor:
        key = doc.get("user_id") or f"name:{doc.get('full_name')}"
        by_user.setdefault(key, []).append(doc)

    for key, docs in by_user.items():
        if len(docs) == 1 and docs[0].get("branch_id") is None:
            continue  # already consolidated

        # Keep whichever record is actually referenced by appointments; failing that, the
        # one carrying the most published slots. Either way its id stays valid.
        ids = [d["id"] for d in docs]
        booked = await v3_col("appointments").find(
            {"doctor_id": {"$in": ids}}, {"_id": 0, "doctor_id": 1}
        ).to_list(5000)
        booked_ids = {b.get("doctor_id") for b in booked}
        keeper = next((d for d in docs if d["id"] in booked_ids), None)
        if keeper is None:
            keeper = max(docs, key=lambda d: len(d.get("slots") or []))

        merged_slots = sorted({s for d in docs for s in (d.get("slots") or []) if isinstance(s, str)})
        details: dict = {}
        for d in docs:
            for det in (d.get("slot_details") or []):
                if det.get("slot_time"):
                    details.setdefault(det["slot_time"], det)
        merged_details = [details[t] for t in sorted(details) if t in details]

        await v3_col("doctors").update_one({"id": keeper["id"]}, {"$set": {
            "branch_id": None,
            "slots": merged_slots,
            "slot_details": merged_details,
        }})
        drop = [d["id"] for d in docs if d["id"] != keeper["id"]]
        if drop:
            # Re-point any appointment on a dropped record before it disappears, so no
            # booking is orphaned by the merge.
            await v3_col("appointments").update_many(
                {"doctor_id": {"$in": drop}}, {"$set": {"doctor_id": keeper["id"]}}
            )
            await v3_col("doctors").delete_many({"id": {"$in": drop}})

    # Their login carries no branch either — a Head Physio isn't "at" one.
    await v3_col("users").update_many(
        {"role": "head_physio"}, {"$set": {"branch_id": None, "branch_ids": []}}
    )


async def backfill_login_history_from_sessions() -> None:
    """login_history only started recording on /auth/login once that tracking was added,
    so anyone already logged in at that point shows zero entries in the Super Admin
    Login Tracker until they log in again. Backfill one entry per such user from their
    current active session (sessions holds one row per user, its created_at is their
    last real login time). Only touches users with zero login_history rows — once a
    user has a real tracked login, this never overwrites or duplicates it. Safe to re-run."""
    # The "sessions" collection holds two unrelated shapes: auth login tokens
    # ({token, user_id, created_at}) and treatment sessions ({lead_id, physio_id,
    # slot_time, ...}). Only the login tokens carry user_id — reading the treatment ones
    # here raised KeyError and killed the app at startup, so filter to the auth shape.
    sessions = await v3_col("sessions").find({"user_id": {"$exists": True}}, {"_id": 0}).to_list(2000)
    if not sessions:
        return
    session_user_ids = list({s["user_id"] for s in sessions})
    already_tracked = set(await v3_col("login_history").distinct("user_id", {"user_id": {"$in": session_user_ids}}))
    to_backfill = [s for s in sessions if s["user_id"] not in already_tracked]
    if not to_backfill:
        return
    users = await v3_col("users").find(
        {"id": {"$in": [s["user_id"] for s in to_backfill]}}, {"_id": 0}
    ).to_list(2000)
    user_map = {u["id"]: u for u in users}
    docs = []
    for s in to_backfill:
        user = user_map.get(s["user_id"])
        if not user:
            continue
        docs.append({
            "id": str(uuid.uuid4()),
            "user_id": user["id"],
            "user_name": user.get("full_name", ""),
            "email": user.get("email", ""),
            "role": user.get("role", ""),
            "branch_id": user.get("branch_id"),
            "created_at": s.get("created_at") or now_iso(),
        })
    if docs:
        await v3_col("login_history").insert_many(docs)


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
    # Only the real Super Admin is seeded here. The generic demo role accounts
    # (Business Dev/Pre Sales/Branch Admin/Head Physio/Physio @fitsiomax.com)
    # that used to live in this list had hardcoded, guessable passwords and
    # were removed — real accounts are created through HR > Roles & Credentials.
    seed_users = [
        {"full_name": "Super Admin", "email": "fitsiomaxtech@gmail.com", "password": "FitsioMax06", "role": "super_admin"},
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
