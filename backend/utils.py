from datetime import datetime, timezone
from typing import Optional
import re


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def now_iso() -> str:
    return now_utc().isoformat()


def derive_branch_code(branch_name: str, existing_codes) -> str:
    """First 3 letters of the branch name, uppercased (e.g. 'Anna Nagar' -> 'ANN').
    Appends a numeric suffix if that collides with an already-assigned code."""
    letters = re.sub(r"[^A-Za-z]", "", branch_name or "").upper()
    base = letters[:3] or "BRN"
    candidate = base
    i = 1
    while candidate in existing_codes:
        i += 1
        candidate = f"{base}{i}"
    return candidate


async def generate_patient_number(branch_id: Optional[str], at: Optional[str] = None) -> Optional[str]:
    """Unique per-branch Patient Number: BRANCHCODE-YYMMDD-SEQUENCE (e.g. ANN-260727-0000).
    SEQUENCE resets daily per branch via an atomic counter, so it's safe to call
    concurrently. `at` lets a backfill migration generate the number for the date the
    lead was actually created, instead of today. Returns None if the branch has no code
    yet (e.g. not migrated) or branch_id is empty."""
    if not branch_id:
        return None
    from database import v3_col
    from pymongo import ReturnDocument

    branch = await v3_col("branches").find_one({"id": branch_id}, {"_id": 0, "code": 1})
    code = branch.get("code") if branch else None
    if not code:
        return None

    if at:
        try:
            dt = datetime.fromisoformat(at.replace("Z", "+00:00"))
        except Exception:
            dt = now_utc()
    else:
        dt = now_utc()
    day_key = dt.strftime("%y%m%d")

    counter = await v3_col("counters").find_one_and_update(
        {"_id": f"patient_number:{branch_id}:{day_key}"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    seq = counter["seq"] - 1
    return f"{code}-{day_key}-{seq:04d}"


async def generate_transaction_id(branch_id: Optional[str]) -> str:
    """Unique, human-readable id for one collection: TXN-BRANCHCODE-YYMMDD-SEQUENCE
    (e.g. TXN-ANN-260806-0000). Same shape and same atomic per-branch-per-day counter as
    generate_patient_number, so two tills collecting at once can't land on one number.

    Every payment gets one, cash included -- it's the only identifier a cash payment has,
    and the receipt printed for the patient is traced by it. A branch with no code yet
    (or a payment with no branch, e.g. an online consultation) falls back to 'GEN' rather
    than returning nothing, because a payment without an id is the case this exists to
    stop."""
    from database import v3_col
    from pymongo import ReturnDocument

    code = None
    if branch_id:
        branch = await v3_col("branches").find_one({"id": branch_id}, {"_id": 0, "code": 1})
        code = (branch or {}).get("code")
    code = code or "GEN"

    day_key = now_utc().strftime("%y%m%d")
    counter = await v3_col("counters").find_one_and_update(
        {"_id": f"transaction_id:{code}:{day_key}"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    seq = counter["seq"] - 1
    return f"TXN-{code}-{day_key}-{seq:04d}"


def normalize_slot_time(value: str) -> str:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is not None:
            parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
        return parsed.replace(second=0, microsecond=0).isoformat(timespec="minutes")
    except Exception:
        return value.strip()[:16]


# An expert who has left is hidden rather than deleted. Their `doctors` row is what a
# patient's appointments and treatment sessions point at, so removing it would orphan real
# history; is_active: False takes them out of every list they could be picked from while
# leaving what they did intact.
#
# Written as "not False" rather than "is True" because every record created before this
# existed has no such field at all, and those people are still working here. A filter of
# {"is_active": True} would empty the Experts list on the deploy that introduced it.
# Two separate facts, both of which have to be true for a record to be offered, and
# deliberately not folded into one field.
#
# `is_active` is about the person: their login is switched off or gone, so they are not
# somebody to book at all. It is owned end to end by the account — _set_expert_active
# writes it when a login is deactivated or reactivated, and retire_experts_without_a_login
# sweeps it back into line at every startup.
#
# `branch_active` is about one posting: the person is still here, still bookable, and has
# simply been unticked from this branch in HR's branch picker. Their record for it is kept
# rather than deleted, because the days already published there and the patients booked
# into them are real (see _sync_expert_branches in routers/v3_hr.py).
#
# Written as one field, the startup sweep would read "unticked from Anna Nagar" as "login
# works, so put them back" and undo the posting change on the next restart.
#
# Both are `$ne: False`, so every record written before either field existed still counts
# as active — a missing answer is not a retirement.
ACTIVE_DOCTOR = {"is_active": {"$ne": False}, "branch_active": {"$ne": False}}


def active_doctor_query(query: dict = None) -> dict:
    """Add the still-with-us conditions to a `doctors` query.

    A helper rather than a spelled-out clause at each call site because there are a dozen
    of those — the consultant calendars, the assign pickers, the review dispatcher, the
    diet coach list — and a list that forgets it offers someone who cannot log in, or
    someone at a branch they no longer work.
    """
    return {**(query or {}), **ACTIVE_DOCTOR}


# How many patients one physio takes in a single slot. A physio runs a floor: two or
# three people on adjacent beds inside the same hour is how the treatment room actually
# works, so one-per-slot was blocking bookings that happen in real life.
DEFAULT_PHYSIO_SLOT_CAPACITY = 3
MAX_PHYSIO_SLOT_CAPACITY = 10


def slot_capacity_of(doctor: dict) -> int:
    """Patients this doctor can hold in one slot.

    Only a Physio runs a floor. A Head Physio consultation is one-to-one however this is
    configured — it is a conversation, not a treatment room — and a Nutrition Coach's
    check-in is the same shape: a weigh-in and a talk, one patient at a time. Both stay at
    1 regardless of any value stored on the record. If group check-ins are ever wanted,
    this is the one line that changes.
    """
    if (doctor or {}).get("profile_type") != "physio":
        return 1
    raw = (doctor or {}).get("slot_capacity")
    try:
        n = int(raw)
    except (TypeError, ValueError):
        return DEFAULT_PHYSIO_SLOT_CAPACITY
    # Clamped rather than trusted: a 0 or a negative would take the physio off the
    # calendar entirely, which no one would set on purpose and nothing else would explain.
    return max(1, min(n, MAX_PHYSIO_SLOT_CAPACITY))


# The two courses a physio delivers off one published calendar: treatment days in
# `sessions`, rehab days in `rehab_sessions`. They are separate collections on purpose —
# v3_rehab's docstring sets out at length what folding rehab into `sessions` breaks — but
# they are the same physio, in the same room, in the same half hour, so "how full is this
# slot" has to read both. Counting only one is how a physio ends up owing two patients the
# same hour; counting them differently in two places is how the picker draws an open seat
# and the assign endpoint then refuses it.
PHYSIO_COURSE_COLLECTIONS = ("sessions", "rehab_sessions")

# What a row in each collection is called, so a refusal names the thing the branch has to
# go and move rather than just reporting a number.
PHYSIO_COURSE_DAY = {"sessions": "treatment day", "rehab_sessions": "rehab day"}


async def physio_slot_load(physio_id: str, slots, lead_id: str = None, replacing: str = None):
    """How busy each of these slots already is for this physio, and where this lead sits in it.

    Returns `(taken, lead_elsewhere)`.

    `taken[slot]` is the patients holding that slot across both courses. Rows belonging to
    `lead_id` in the `replacing` collection are left out: an assign call rewrites that
    lead's whole course in one go, so the days they hold today are not a clash with the
    days they are being given — without this, re-confirming a patient onto the very times
    they already have is refused as a conflict with themselves.

    This is deliberately the same arithmetic the slot picker does to draw its seat dots.
    get_doctor_calendar tags every occupant with the course it came from so the picker can
    discount exactly this lead's rows on exactly the course being replaced and nothing
    else. The two have to agree: when they drifted apart, a patient's own treatment day
    silently filled a seat the picker had already shown as free, and booking their rehab
    course came back "Full for this physio" on slots the branch had just been offered.

    `lead_elsewhere[slot]` is set when this lead already holds that slot on the *other*
    course. The physio may well have a free seat there, but the patient cannot be on the
    treatment floor and in rehab in the same half hour, so it is refused on its own terms
    rather than folded into the seat count — which would have reported the patient's own
    booking as somebody else's and given the branch nothing to act on.
    """
    from database import v3_col

    slots = list(slots)
    taken: dict = {}
    lead_elsewhere: dict = {}
    for collection in PHYSIO_COURSE_COLLECTIONS:
        rows = await v3_col(collection).find(
            {"physio_id": physio_id, "status": "upcoming", "slot_time": {"$in": slots}},
            {"_id": 0, "slot_time": 1, "lead_id": 1},
        ).to_list(1000)
        for row in rows:
            slot = row["slot_time"]
            if lead_id and row.get("lead_id") == lead_id:
                if collection == replacing:
                    continue
                lead_elsewhere[slot] = PHYSIO_COURSE_DAY[collection]
            taken[slot] = taken.get(slot, 0) + 1
    return taken, lead_elsewhere
