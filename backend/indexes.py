"""The indexes every board reads through.

The collections were created without any index but `_id_`, which Mongo makes on its own.
Nothing in this codebase looks a document up by `_id`: leads, users, sessions, branches and
the rest all carry their own string `id`, and every query filters on that or on a scoping
field beside it. So every one of them was a full collection scan, and every sort a
in-memory sort of whatever it returned.

Two of those scans ran on *every authenticated request* before the endpoint did any work of
its own — `v3_current_user` looks up the bearer token in `sessions` and then the login in
`users` (see deps.py). A board that fires eight requests to draw itself therefore paid
sixteen collection scans before fetching a single lead, and `sessions` is the collection
that grows with every login for the life of the install.

Called first thing at startup, ahead of the seed and migration passes, so those run through
the indexes too. `create_index` is idempotent: an index that already exists with the same
spec and name is a no-op, so this costs nothing on later boots.

None of these are unique. An index that enforces a constraint would fail to build against
data that already violates it, and a startup that dies on an index is worse than a slow
query — dedupe belongs in a migration that can report what it found, not here.
"""

import logging

from database import v3_col

logger = logging.getLogger(__name__)

# (collection, keys, name). Keys are the pymongo [(field, direction)] form.
#
# Each one is here because a query in this repo actually asks for it; the comment says
# which. Compound keys are ordered equality-first, then the sort, so one index serves both
# halves of the query rather than filtering through the index and sorting in memory.
CORE_INDEXES = [
    # Every authenticated request, before anything else happens. `sessions` holds auth
    # tokens and treatment days in one collection, so this scan grows with both.
    ("sessions", [("token", 1)], "token"),
    # ...and the login behind the token, second half of the same dependency.
    ("users", [("id", 1)], "id"),
    # _stamp_session_progress aggregates a branch's whole board through this, and the
    # physio boards read a patient's days by it.
    ("sessions", [("lead_id", 1)], "lead_id"),
    ("sessions", [("id", 1)], "id"),
    # 107 find_one and 58 update_one across the routers, all keyed on the lead's own id.
    ("leads", [("id", 1)], "id"),
    # /branch-board/{branch_id} and /branch-admin/consultations/{branch_id}/board: the same
    # filter and the same sort, so one compound index answers both without a memory sort.
    ("leads", [("branch_id", 1), ("updated_at", -1)], "branch_recent"),
    # The consultations board with branch_id="all" — a Head Physio covers every branch and
    # so filters on the pipeline field alone.
    ("leads", [("consultation_stage", 1)], "consultation_stage"),
    ("leads", [("head_consultation_stage", 1)], "head_consultation_stage"),
    # The Pre-Sales pipeline's own lists.
    ("leads", [("stage", 1)], "stage"),
    # Duplicate detection on import and on Create Lead.
    ("leads", [("phone_normalized", 1)], "phone_normalized"),
    ("leads", [("created_at", -1)], "created_at"),
    ("branches", [("id", 1)], "id"),
    ("doctors", [("id", 1)], "id"),
    ("doctors", [("profile_type", 1)], "profile_type"),
    ("employees", [("id", 1)], "id"),
    ("store_items", [("id", 1)], "id"),
    ("users", [("email", 1)], "email"),
    # _branch_stages / _consultation_stage_names: filter by type, read in order.
    ("pipeline_stages", [("type", 1), ("order", 1)], "type_order"),
    ("pipeline_stages", [("id", 1)], "id"),
    ("appointments", [("id", 1)], "id"),
    ("appointments", [("branch_id", 1), ("slot_time", 1)], "branch_slot"),
    ("appointments", [("lead_id", 1)], "lead_id"),
    ("lead_activity", [("lead_id", 1), ("created_at", -1)], "lead_recent"),
    # A patient's documents, and the one question the Consultation Fee is gated on: the
    # consultations board asks "which of these leads has a prescription" once per load, and
    # collect-package-payment asks it of one lead before it takes any money. Equality on
    # both fields, so the compound key answers either — and the documents tab's own
    # {lead_id} / {lead_id, kind} listings read through its prefix.
    ("lead_documents", [("lead_id", 1), ("kind", 1)], "lead_kind"),
]


async def ensure_core_indexes() -> None:
    """Build the indexes above, one at a time, and keep going if one of them fails.

    A failure here is a slow install, not a broken one — every query still returns the same
    documents without its index. So it is logged and stepped over rather than raised: an
    index that cannot be built (a name already taken by a different spec, a permission the
    deploy user lacks) must not stop the app from starting.
    """
    built = 0
    for collection, keys, name in CORE_INDEXES:
        try:
            await v3_col(collection).create_index(keys, name=name)
            built += 1
        except Exception as e:
            logger.warning(f"index {collection}.{name} not built: {type(e).__name__}: {e}")
    logger.info(f"core indexes ready ({built}/{len(CORE_INDEXES)})")
