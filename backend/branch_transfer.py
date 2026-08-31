"""Moving one patient from the branch they are at to another one.

Two moments in a patient's journey are safe to do this at, and the gap between them is
deliberately closed:

  "lead"       — nothing has happened yet. The lead is still sitting on the branch's own
                 opening stage: no consultation booked, no fee taken, no clinician named.
                 The usual cause is the obvious one — the branch was picked wrong, or the
                 patient rang the nearest number and lives somewhere else. There is
                 nothing to carry across, so this is close to a correction.

  "treatment"  — the consultation is done, both fees are in and a physio has been named
                 (consultation_stage has reached Physio Assign). The patient is partway
                 through a course they have paid for and is moving; what carries is the
                 package and the money, and what does not is the staff, because the
                 physio, the nutrition coach and the rehab physio all work at the branch
                 being left.

Everything between the two is refused. A patient in that gap is holding something at the
branch they are at — a consultation slot on a Consultant's calendar, a half-finished
assessment, a Treatment Fee collected against a package nobody has been assigned to
deliver — and a transfer would either strand it there or silently destroy it. The refusal
names the stage, so the branch knows what to finish (or cancel) first.

Money never follows the patient. Branch revenue is read live off leads.branch_id (see
routers/v3_finance.py), so rewriting that field alone would move every rupee this patient
ever paid onto the receiving branch's book and take it off the paying branch's — changing
a P&L that was closed months ago. Two things stop that, and both are here:

  * `revenue_frozen` on the lead: what the branch being left collected while it held the
    patient, as its own delta rather than a running total, so a patient moved twice leaves
    each branch exactly its own share.
  * `branch_id` stamped onto that patient's existing payment rows in `lead_activity`, so
    every transaction list attributes a collection to the branch whose till it went
    through. Collections made after the transfer carry no stamp and fall back to the
    lead's current branch, which by then is the receiving one.
"""

import uuid
from typing import Dict, List, Optional, Tuple

from constants import V3_CONSULTATION_STAGES
from database import v3_col
from stage_utils import first_branch_stage_for_branch
from utils import generate_patient_number, now_iso

# The two windows, as the API names them.
WINDOW_LEAD = "lead"
WINDOW_TREATMENT = "treatment"

# The consultation stage that opens the second window. A literal, like the gated-stage set
# in routers/v3_branch_admin.py it sits beside: these stages are fixed and are not renamed.
# Its POSITION is still resolved from the live list rather than assumed, so "at or past
# this point" survives the list being reordered.
PHYSIO_ASSIGN_STAGE = "Physio Assign"

# A side exit, not a later stage. It sorts after Physio Assign in the stage list and would
# otherwise read as "past it" — but a cancelled consultation has been called off, not
# advanced, and there is nothing left to transfer.
CONSULTATION_CANCEL_STAGE = "Cancel"

# Every "how much has actually been paid" field on a lead. These are what a branch's own
# book sums, so these are what gets frozen when the patient leaves. Deliberately the paid
# amounts and not the *_price fields beside them: a price is what something costs, and only
# money that arrived belongs to a branch's revenue.
PAID_FIELDS = (
    "consultation_fee",
    "package_paid",
    "treatment_fee_paid",
    "diet_fee_paid",
    "diet_chart_fee_paid",
    "rehab_fee_paid",
)

# The lead_activity actions that carry money. Kept in step with REVENUE_ACTIONS in
# routers/v3_finance.py — declared here rather than imported from there, so this module
# stays importable from anywhere without dragging a router in behind it.
REVENUE_ACTIONS = (
    "consultation_paid",
    "package_sold",
    "package_payment_collected",
    "treatment_fee_collected",
    "diet_fee_collected",
    "diet_chart_fee_collected",
    "rehab_fee_collected",
    "fee_collected",
)

# The unrun schedules a patient carries. Deleted on transfer rather than moved: every slot
# in them is an hour on a named clinician's calendar at the branch being left.
SCHEDULE_COLLECTIONS = ("sessions", "rehab_sessions", "diet_sessions")


async def _consultation_stage_names() -> List[str]:
    """The live Consultations pipeline, in order. Same read as the board's own."""
    rows = await v3_col("pipeline_stages").find(
        {"type": "consultation"}, {"_id": 0, "name": 1}
    ).sort("order", 1).to_list(200)
    return [r["name"] for r in rows] or list(V3_CONSULTATION_STAGES)


# ------------------------------------------------------------------ eligibility


async def transfer_window(lead: dict) -> Tuple[Optional[str], str]:
    """Which window this lead is in, and why — `(window, explanation)`.

    `window` is None when the lead cannot be transferred, and the explanation is then
    written to be shown to whoever pressed the button: it has to say what to do next,
    not just that the answer is no.
    """
    if not lead.get("branch_id"):
        return None, "This lead is not at a branch yet — assign it to one instead of transferring it."

    consultation_stage = lead.get("consultation_stage")

    # The treatment window is checked first because it is the later and more specific of
    # the two: a lead that has reached the consultation pipeline is never also sitting on
    # its branch's opening stage, and asking in this order means the answer for a patient
    # mid-pipeline names their consultation stage rather than their long-stale sales one.
    if consultation_stage:
        if consultation_stage == CONSULTATION_CANCEL_STAGE:
            return None, "This consultation was cancelled. There is nothing left at this branch to transfer."
        names = await _consultation_stage_names()
        if PHYSIO_ASSIGN_STAGE not in names or consultation_stage not in names:
            # A stage the live pipeline no longer draws — a Consultation Only patient
            # closed out on the retired "Consultation Completed", most often. They never
            # reached Physio Assign, so they are not in the window.
            return None, (
                f"'{consultation_stage}' is not a stage a patient can be transferred from. "
                f"Only a patient who has reached {PHYSIO_ASSIGN_STAGE} can move mid-treatment."
            )
        if names.index(consultation_stage) >= names.index(PHYSIO_ASSIGN_STAGE):
            return WINDOW_TREATMENT, "Treatment is paid for and a physio assigned — the course moves with the patient."
        return None, (
            f"This patient is at '{consultation_stage}'. A transfer is only possible before the consultation "
            f"is booked, or once they reach '{PHYSIO_ASSIGN_STAGE}' — finish or cancel the consultation first."
        )

    entry_stage = await first_branch_stage_for_branch(lead["branch_id"], "New Appointment")
    branch_stage = lead.get("branch_stage")
    if branch_stage in (None, "", entry_stage):
        return WINDOW_LEAD, "Nothing has been booked or collected yet — the lead moves across as it stands."
    return None, (
        f"This lead is already at '{branch_stage}'. A transfer is only possible while it is still on "
        f"'{entry_stage}', or once the patient reaches '{PHYSIO_ASSIGN_STAGE}' after their consultation."
    )


# ------------------------------------------------------------------ what a transfer touches


async def _open_booking_counts(lead_id: str) -> Dict[str, int]:
    """What this patient currently holds on the branch's calendars.

    Counted rather than assumed, so the confirmation can say "3 treatment days and a
    consultation slot will be released" instead of a generic warning — the branch is being
    asked to agree to those bookings disappearing.
    """
    counts = {
        "appointments": await v3_col("appointments").count_documents(
            {"lead_id": lead_id, "status": "new_appointment"}
        ),
    }
    for collection in SCHEDULE_COLLECTIONS:
        counts[collection] = await v3_col(collection).count_documents(
            {"lead_id": lead_id, "status": "upcoming"}
        )
    return counts


def frozen_total(lead: dict, field: str) -> float:
    """How much of one paid field belongs to branches this patient has already left."""
    return sum(float(row.get(field) or 0) for row in (lead.get("revenue_frozen") or []))


def _freeze_delta(lead: dict) -> Dict[str, float]:
    """What the branch currently holding this lead collected while it held them.

    The lead's running totals minus everything already frozen for earlier branches, so
    A -> B -> C leaves A its own share and B its own, rather than B inheriting A's.
    """
    delta = {}
    for field in PAID_FIELDS:
        amount = float(lead.get(field) or 0) - frozen_total(lead, field)
        # Never negative: a refund or correction that took a running total back below what
        # an earlier branch banked is not a debt the leaving branch owes the next one.
        if amount > 0:
            delta[field] = round(amount, 2)
    return delta


def _staff_on(lead: dict) -> List[str]:
    """The clinicians named on this patient — all of whom work at the branch being left."""
    return [name for name in (
        lead.get("assigned_physio_name"),
        lead.get("diet_coach_name"),
        lead.get("rehab_physio_name"),
    ) if name]


# ------------------------------------------------------------------ the transfer


async def preview(lead: dict) -> dict:
    """Everything the confirmation dialog needs, without writing anything."""
    window, explanation = await transfer_window(lead)
    return {
        "eligible": window is not None,
        "window": window,
        "explanation": explanation,
        "open_bookings": await _open_booking_counts(lead["id"]) if lead.get("id") else {},
        # Named individually rather than as one "staff" count: the branch reads this to
        # check it is releasing the people it thinks it is.
        "releases_staff": _staff_on(lead) if window == WINDOW_TREATMENT else [],
        "revenue_stays_here": _freeze_delta(lead),
    }


async def transfer(lead: dict, destination: dict, user, reason: str = "") -> dict:
    """Move `lead` to `destination`. The caller has already checked the window.

    Returns what changed, so the response can tell the branch what it just released rather
    than only that the move worked.
    """
    lead_id = lead["id"]
    source_id = lead["branch_id"]
    window, _ = await transfer_window(lead)
    now = now_iso()

    source = await v3_col("branches").find_one({"id": source_id}, {"_id": 0, "branch_name": 1}) or {}
    source_name = source.get("branch_name") or "Unknown"

    # --- the money stays where it was collected ------------------------------------
    delta = _freeze_delta(lead)
    frozen_rows = list(lead.get("revenue_frozen") or [])
    if delta:
        frozen_rows.append({
            "branch_id": source_id,
            "branch_name": source_name,
            "frozen_at": now,
            **delta,
        })
    # Only the rows that have never been stamped. A patient moved a second time must not
    # have the first branch's collections re-attributed to the second.
    await v3_col("lead_activity").update_many(
        {
            "lead_id": lead_id,
            "action": {"$in": list(REVENUE_ACTIONS)},
            "branch_id": {"$in": [None, ""]},
        },
        {"$set": {"branch_id": source_id}},
    )

    # --- release everything this patient holds at the branch they are leaving -------
    #
    # Cancelled rather than deleted, for appointments: the consultant's hour goes back on
    # the calendar (the same effect reaching the Cancelled stage has — see
    # v3_move_branch_stage) while the booking stays in the record as something that
    # happened. Treatment, rehab and diet days are deleted instead, because that is what
    # every re-assignment in the OS already does with an unrun day: they are a schedule,
    # not a history. The completed ones — which ARE the history, and which the patient's
    # session progress is counted off — are left exactly where they are.
    freed = (await v3_col("appointments").update_many(
        {"lead_id": lead_id, "status": "new_appointment"},
        {"$set": {"status": "cancelled", "updated_at": now}},
    )).modified_count
    dropped = {}
    for collection in SCHEDULE_COLLECTIONS:
        dropped[collection] = (await v3_col(collection).delete_many(
            {"lead_id": lead_id, "status": "upcoming"}
        )).deleted_count

    # --- the lead itself ------------------------------------------------------------
    updates = {
        "branch_id": destination["id"],
        "revenue_frozen": frozen_rows,
        "transferred_from_branch_id": source_id,
        "transferred_from_branch_name": source_name,
        "transferred_at": now,
        "transfer_reason": (reason or "").strip(),
        "updated_at": now,
    }

    # A patient keeps the number they were given. It carries the first branch's code, which
    # is the point — it is printed on receipts already issued and is how their history is
    # looked up. Minting a new one at the destination would leave those receipts pointing
    # at nobody. One is minted here only for a lead that never had one.
    if not lead.get("patient_number"):
        minted = await generate_patient_number(destination["id"])
        if minted:
            updates["patient_number"] = minted

    if window == WINDOW_LEAD:
        # The receiving branch's OWN opening, not the one the lead is on: the two branches
        # can be under different Lead Control, and a lead handed to a branch that runs its
        # own leads must land on Branch Assign or it is counted in that branch's total
        # while appearing in none of its pills.
        updates["branch_stage"] = await first_branch_stage_for_branch(
            destination["id"], lead.get("branch_stage") or "New Appointment"
        )

    released = []
    if window == WINDOW_TREATMENT:
        # Every clinician named on this patient works at the branch being left, so all
        # three are released together with the days they were booked for. The patient stays
        # on Physio Assign, which is where the receiving Branch Admin picks their own
        # physio — the same panel and the same button, one branch along.
        released = _staff_on(lead)
        updates.update({
            "consultation_stage": PHYSIO_ASSIGN_STAGE,
            "assigned_physio_id": None,
            "assigned_physio_name": None,
            "physio_assigned_at": None,
            "physio_stage": None,
            "diet_coach_id": None,
            "diet_coach_name": None,
            "diet_assigned_at": None,
            "diet_appointment_at": None,
            "rehab_physio_id": None,
            "rehab_physio_name": None,
            "rehab_assigned_at": None,
        })

    await v3_col("leads").update_one({"id": lead_id}, {"$set": updates})

    detail = f"Branch transfer: {source_name} -> {destination.get('branch_name') or 'Unknown'}"
    if (reason or "").strip():
        detail += f" · {reason.strip()}"
    if released:
        detail += f" · released {', '.join(released)}"
    if freed:
        detail += f" · {freed} appointment{'' if freed == 1 else 's'} cancelled, slot freed"
    days = sum(dropped.values())
    if days:
        detail += f" · {days} unrun day{'' if days == 1 else 's'} removed"

    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "branch_transferred",
        "details": detail,
        # The transfer is not a collection, but it is stamped anyway so the row reads as
        # the leaving branch's event wherever activity is listed per branch.
        "branch_id": source_id,
        "created_by": getattr(user, "full_name", ""),
        "created_by_role": getattr(user, "role", ""),
        "created_at": now,
    })

    return {
        "window": window,
        "from_branch_id": source_id,
        "from_branch_name": source_name,
        "to_branch_id": destination["id"],
        "to_branch_name": destination.get("branch_name", ""),
        "appointments_cancelled": freed,
        "days_removed": dropped,
        "staff_released": released,
        "revenue_frozen": delta,
    }


# ------------------------------------------------------------------ reading the money back


def finance_lead_query(branch_id: Optional[str]) -> dict:
    """The lead filter a branch's own book should be built from.

    Not `{"branch_id": B}`: a patient B once treated and has since transferred away is no
    longer at B, and the money B took from them does not stop being B's. Both halves are
    matched here, and `branch_share` below decides how much of each lead counts.
    """
    if not branch_id:
        return {}
    return {"$or": [{"branch_id": branch_id}, {"revenue_frozen.branch_id": branch_id}]}


def branch_share(lead: dict, field: str, branch_id: Optional[str]) -> float:
    """How much of one paid field on this lead belongs to `branch_id`.

    Unscoped (no branch), the answer is the whole thing — an org-wide total counts every
    rupee once, wherever it was taken.
    """
    total = float(lead.get(field) or 0)
    if not branch_id:
        return total
    frozen = next(
        (r for r in (lead.get("revenue_frozen") or []) if r.get("branch_id") == branch_id),
        None,
    )
    if frozen is not None:
        return float(frozen.get(field) or 0)
    if lead.get("branch_id") != branch_id:
        return 0.0
    # Still here: the running total, less everything the earlier branches banked.
    return max(0.0, total - frozen_total(lead, field))


def branch_splits(lead: dict) -> Dict[str, Dict[str, float]]:
    """Every branch's share of one lead's money — `{branch_id: {field: amount}}`.

    The per-branch form of `branch_share`, for the callers building a breakdown across all
    branches at once rather than asking about one. A lead nobody has transferred has a
    single entry, which is the ordinary case and the same numbers as before.
    """
    splits: Dict[str, Dict[str, float]] = {}
    for row in (lead.get("revenue_frozen") or []):
        bid = row.get("branch_id")
        if not bid:
            continue
        acc = splits.setdefault(bid, {})
        for field in PAID_FIELDS:
            acc[field] = acc.get(field, 0.0) + float(row.get(field) or 0)
    here = lead.get("branch_id")
    if here:
        acc = splits.setdefault(here, {})
        for field in PAID_FIELDS:
            acc[field] = acc.get(field, 0.0) + max(
                0.0, float(lead.get(field) or 0) - frozen_total(lead, field)
            )
    return splits


def activity_branch(activity: dict, lead: dict) -> Optional[str]:
    """Which branch one payment row belongs to.

    The stamp when there is one — put on at transfer time, naming the till the money
    actually went through — and the lead's current branch when there is not, which is
    every collection made by the branch the patient is at now.
    """
    return activity.get("branch_id") or (lead or {}).get("branch_id")
