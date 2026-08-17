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
ACTIVE_DOCTOR = {"is_active": {"$ne": False}}


def active_doctor_query(query: dict = None) -> dict:
    """Add the still-with-us condition to a `doctors` query.

    A helper rather than a spelled-out clause at each call site because there are a dozen
    of those — the consultant calendars, the assign pickers, the review dispatcher, the
    diet coach list — and a list that forgets it offers someone who cannot log in.
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
