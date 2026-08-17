"""Working windows — the hours of the day an expert is actually at the clinic.

A calendar used to be opened across one fixed window for everybody (8:00 AM to 10:00 PM),
which is not how the floor runs: a morning physio leaves at 2, an evening consultant only
starts at 3, and publishing a 9:00 PM slot for either of them offers a patient a time
nobody will be there for.

A shift is that window, named and reusable — Morning, Evening, Online, Full Time — defined
once per branch and assigned to an expert. From then on their calendar is only cut across
those hours, so what MANAGEMENT publishes and what Branch Leads can book stay inside the
shift by construction rather than by the Branch Admin remembering it.

The four below are only the starting point. Every one of them is editable (name and both
ends), and a branch can add its own — the whole point of the tab is that a clinic sets its
own hours.

Assignment lives on the `doctors` row (`shift_id`), not on the shift, because an expert
works one shift and their calendar has to be able to answer "which window is mine?" without
scanning every shift in the branch. Nothing here touches slots that are already published:
narrowing a shift changes what the *next* day opened will contain, and never silently
deletes a slot a patient may already be booked into — see remove-slots for that.
"""

import uuid
from typing import Dict, Iterable, List, Optional

from database import v3_col
from utils import now_iso

# The window a calendar falls back to when its expert has no shift — the same 8:00 AM to
# 10:00 PM the calendar was hardcoded to before shifts existed, so an unassigned expert
# behaves exactly as they did.
FALLBACK_START = "08:00"
FALLBACK_END = "22:00"

# Seeded per branch on first read. `key` marks a row as one of these four so the seeding
# stays idempotent after a rename — a branch that renames "Online" to "Tele-consult" must
# not get a second Online row the next time the tab is opened.
DEFAULT_SHIFTS = [
    {"key": "morning", "name": "Morning", "start_time": "07:00", "end_time": "14:00"},
    {"key": "evening", "name": "Evening", "start_time": "15:00", "end_time": "19:00"},
    # Online consults are taken around the working day rather than in one block of it, so
    # this opens wide (7 AM to 7 PM) and is expected to be narrowed per branch.
    {"key": "online", "name": "Online", "start_time": "07:00", "end_time": "19:00"},
    {"key": "full_time", "name": "Full Time", "start_time": "10:00", "end_time": "19:00"},
]


def parse_hhmm(value: str) -> Optional[int]:
    """"07:30" -> 450 minutes past midnight. None if it isn't a 24-hour HH:MM."""
    if not isinstance(value, str):
        return None
    parts = value.strip().split(":")
    if len(parts) != 2:
        return None
    try:
        hours, minutes = int(parts[0]), int(parts[1])
    except ValueError:
        return None
    if not (0 <= hours <= 23 and 0 <= minutes <= 59):
        return None
    return hours * 60 + minutes


def public_shift(row: dict) -> dict:
    """The shape the frontend reads. `_id` never leaves the backend."""
    return {
        "id": row.get("id"),
        "branch_id": row.get("branch_id"),
        "key": row.get("key"),
        "name": row.get("name", ""),
        "start_time": row.get("start_time", FALLBACK_START),
        "end_time": row.get("end_time", FALLBACK_END),
        "order": row.get("order", 0),
    }


async def ensure_branch_shifts(branch_id: str) -> List[dict]:
    """This branch's shifts, seeding the four standard ones the first time it asks.

    Seeded on read rather than at branch creation so branches that already exist get them
    too — there is no migration to run and no branch that opens the tab to an empty list.
    """
    rows = await v3_col("shifts").find({"branch_id": branch_id}, {"_id": 0}).to_list(200)
    present = {r.get("key") for r in rows if r.get("key")}
    missing = [d for d in DEFAULT_SHIFTS if d["key"] not in present]
    if missing:
        seeded = []
        for index, default in enumerate(DEFAULT_SHIFTS):
            if default["key"] not in present:
                seeded.append({
                    "id": str(uuid.uuid4()),
                    "branch_id": branch_id,
                    "key": default["key"],
                    "name": default["name"],
                    "start_time": default["start_time"],
                    "end_time": default["end_time"],
                    "order": index,
                    "created_at": now_iso(),
                    "updated_at": now_iso(),
                })
        if seeded:
            await v3_col("shifts").insert_many([s.copy() for s in seeded])
            rows.extend([{k: v for k, v in s.items() if k != "_id"} for s in seeded])
    rows.sort(key=lambda r: (r.get("order", 0), r.get("name", "")))
    return rows


async def shift_map(shift_ids: Iterable[Optional[str]]) -> Dict[str, dict]:
    """Look shifts up by id, whichever branch defined them.

    Deliberately not scoped to the caller's branch: a CONSULTANT takes consultations across
    the whole organisation off one `doctors` row, so the shift assigned to them may have
    been defined by another branch. Scoping the lookup would silently drop their window and
    re-open their calendar across the full day.
    """
    wanted = sorted({s for s in shift_ids if s})
    if not wanted:
        return {}
    rows = await v3_col("shifts").find({"id": {"$in": wanted}}, {"_id": 0}).to_list(500)
    return {r["id"]: r for r in rows}


def window_of(shift: Optional[dict]) -> dict:
    """The start/end a calendar should be cut across, with the shift's name for display."""
    start = (shift or {}).get("start_time")
    end = (shift or {}).get("end_time")
    if not shift or parse_hhmm(start) is None or parse_hhmm(end) is None:
        return {"shift_id": None, "shift_name": "", "start_time": FALLBACK_START, "end_time": FALLBACK_END}
    return {
        "shift_id": shift.get("id"),
        "shift_name": shift.get("name", ""),
        "start_time": start,
        "end_time": end,
    }


async def attach_shifts(doctors: List[dict]) -> List[dict]:
    """Fill each doctor row's shift_name / shift_start / shift_end from its shift_id.

    Resolved on read instead of copied onto the doctor at assignment time, so editing a
    shift's hours moves every expert on it at once — which is what a shared, named window
    is for.
    """
    shifts = await shift_map(d.get("shift_id") for d in doctors)
    for doc in doctors:
        window = window_of(shifts.get(doc.get("shift_id")))
        # shift_id is cleared too when it points at a deleted shift, so the UI shows
        # "No shift" rather than a dropdown stuck on a value that no longer exists.
        doc["shift_id"] = window["shift_id"]
        doc["shift_name"] = window["shift_name"]
        doc["shift_start"] = window["start_time"]
        doc["shift_end"] = window["end_time"]
    return doctors
