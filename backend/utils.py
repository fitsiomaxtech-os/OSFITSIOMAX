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
