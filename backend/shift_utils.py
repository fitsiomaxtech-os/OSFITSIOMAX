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

Assignment lives on the `doctors` row (`shift_ids`), not on the shift, because a calendar
has to be able to answer "which hours are mine?" without scanning every shift in the
branch. It is a *list* because a split day is ordinary on this floor: a consultant works
8:00 AM – 1:00 PM, goes home, and is back 5:00 PM – 9:00 PM. Stored as one shift that
happens to run 8 to 9 it would publish the whole afternoon they are not there; stored as
two rows it publishes both halves and nothing between them.

`shift_id` is still written alongside as the first of the list, so every older reader of a
doctor row keeps working and sees the day's first window rather than nothing.

Nothing here touches slots that are already published: narrowing a shift changes what the
*next* day opened will contain, and never silently deletes a slot a patient may already be
booked into — see remove-slots for that.
"""

import re
import uuid
from typing import Dict, Iterable, List, Optional

from database import v3_col
from utils import now_iso

# The window a calendar falls back to when its expert has no shift — the same 8:00 AM to
# 10:00 PM the calendar was hardcoded to before shifts existed, so an unassigned expert
# behaves exactly as they did.
FALLBACK_START = "08:00"
FALLBACK_END = "22:00"

# A calendar day, as the frontend sends it. Used to keep the free-form override map honest.
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

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


# How many windows one expert's day may be cut into. Four is already a day nobody works —
# the real answer is one or two — and the cap is here so a bad caller cannot turn a
# calendar into a hundred fragments the grid then has to render.
MAX_SHIFTS_PER_EXPERT = 4


def shift_ids_of(doctor: Optional[dict]) -> List[str]:
    """The shifts an expert works, oldest storage shape included.

    `shift_ids` is the list; `shift_id` is the single value every row carried before split
    days existed and is still written as the first of the list. Reading both means a row
    saved by an older build keeps its window instead of re-opening across the full day.
    """
    doc = doctor or {}
    raw = doc.get("shift_ids")
    if isinstance(raw, list):
        ids = [s for s in raw if isinstance(s, str) and s]
        if ids:
            # De-duplicated in order: the same shift picked twice is one window, and left
            # in would publish every hour of it twice over.
            seen, out = set(), []
            for s in ids:
                if s not in seen:
                    seen.add(s)
                    out.append(s)
            return out[:MAX_SHIFTS_PER_EXPERT]
    single = doc.get("shift_id")
    return [single] if isinstance(single, str) and single else []


def _valid_rows(rows: Iterable[Optional[dict]]) -> List[dict]:
    """The shifts that describe a real window, in clock order.

    A row whose ends are unreadable or inverted is dropped rather than repaired: it would
    generate no slots anyway, and carrying it forward only puts a window on screen that the
    grid then refuses to fill.
    """
    good = []
    for row in rows or []:
        if not row:
            continue
        from_min, to_min = parse_hhmm(row.get("start_time")), parse_hhmm(row.get("end_time"))
        if from_min is None or to_min is None or to_min <= from_min:
            continue
        good.append(row)
    good.sort(key=lambda r: parse_hhmm(r.get("start_time")))
    return good


def merge_segments(rows: List[dict]) -> List[dict]:
    """Windows that overlap or touch become one.

    Morning (7–14) and Online (7–19) on the same expert are not two days' work, they are
    one stretch of 7 to 7 — and left as two the grid would offer every hour before 2 PM
    twice. Split shifts, the case this is all for, do not overlap and so stay two.
    """
    merged: List[dict] = []
    for row in rows:
        start, end = row.get("start_time"), row.get("end_time")
        if merged and parse_hhmm(start) <= parse_hhmm(merged[-1]["end_time"]):
            if parse_hhmm(end) > parse_hhmm(merged[-1]["end_time"]):
                merged[-1]["end_time"] = end
            # The absorbed shift still named part of this window, so it keeps its place in
            # the label and its id in the list.
            if row.get("name") and row.get("name") not in merged[-1]["shift_names"]:
                merged[-1]["shift_names"].append(row.get("name"))
            merged[-1]["shift_ids"].append(row.get("id"))
            continue
        merged.append({
            "shift_id": row.get("id"),
            "shift_ids": [row.get("id")],
            "shift_names": [row.get("name")] if row.get("name") else [],
            "start_time": start,
            "end_time": end,
        })
    out = []
    for seg in merged:
        # One segment, one label — "Morning", or "Morning + Online" where two windows ran
        # into each other.
        out.append({**seg, "shift_name": " + ".join(seg["shift_names"])})
        out[-1].pop("shift_names", None)
    return out


def window_of(shift) -> dict:
    """The window(s) a calendar should be cut across, with a name for display.

    Takes one shift row or a list of them. The reply keeps `start_time` / `end_time` as the
    outer edges of the day, so every older reader still gets the one answer it expects, and
    carries `segments` for the callers that publish slots — which must skip the gap between
    a morning and an evening rather than fill it.
    """
    rows = list(shift) if isinstance(shift, (list, tuple)) else ([shift] if shift else [])
    segments = merge_segments(_valid_rows(rows))
    if not segments:
        return {
            "shift_id": None,
            "shift_ids": [],
            "shift_name": "",
            "start_time": FALLBACK_START,
            "end_time": FALLBACK_END,
            "segments": [],
        }
    ids = [i for seg in segments for i in seg["shift_ids"]]
    return {
        "shift_id": ids[0],
        "shift_ids": ids,
        "shift_name": " + ".join([s["shift_name"] for s in segments if s["shift_name"]]),
        "start_time": segments[0]["start_time"],
        "end_time": segments[-1]["end_time"],
        "segments": [
            {
                "shift_id": seg["shift_id"],
                "shift_name": seg["shift_name"],
                "start_time": seg["start_time"],
                "end_time": seg["end_time"],
            }
            for seg in segments
        ],
    }


def overrides_of(doctor: dict) -> Dict[str, List[str]]:
    """The one-off day shifts stored on an expert: {"2026-08-18": ["<shift_id>", ...]}.

    A shift is the usual pattern, not a contract. Akshya is on Morning and still comes in
    full-time some days, and a roster that cannot say that forces the exception to be
    entered as a permanent change and then remembered back — which nobody does.

    A day's exception is a list for the same reason the usual roster is: "this Saturday she
    works both halves" is one answer, not two. A day stored as a bare id by an older build
    reads as a list of one.

    Filtered to well-formed dates on the way out: this is a free-form map on a document, so
    a stray key must not reach the calendar as a date it will then fail to render.
    """
    raw = (doctor or {}).get("shift_overrides") or {}
    if not isinstance(raw, dict):
        return {}
    out: Dict[str, List[str]] = {}
    for date, value in raw.items():
        if not (isinstance(date, str) and DATE_RE.match(date)):
            continue
        ids = [s for s in (value if isinstance(value, list) else [value]) if isinstance(s, str) and s]
        if ids:
            out[date] = ids[:MAX_SHIFTS_PER_EXPERT]
    return out


def override_shift_ids(doctor: dict) -> List[str]:
    """Every shift id the overrides mention — what `shift_map` has to be asked for."""
    return [i for ids in overrides_of(doctor).values() for i in ids]


def day_windows_of(doctor: dict, shifts: Dict[str, dict]) -> Dict[str, dict]:
    """Resolve those overrides to real windows, dropping any whose shift has been deleted.

    Dropped rather than kept as a dangling name: a deleted shift leaves the day falling back
    to the expert's usual window, which is the same thing that happens to their other days
    and is therefore the answer that needs no explaining.
    """
    out = {}
    for date, ids in overrides_of(doctor).items():
        rows = [shifts[i] for i in ids if shifts.get(i)]
        if rows:
            out[date] = window_of(rows)
    return out


async def attach_shifts(doctors: List[dict]) -> List[dict]:
    """Fill each doctor row's shift_name / shift_start / shift_end from its shift ids.

    Resolved on read instead of copied onto the doctor at assignment time, so editing a
    shift's hours moves every expert on it at once — which is what a shared, named window
    is for.
    """
    shifts = await shift_map(i for d in doctors for i in shift_ids_of(d))
    for doc in doctors:
        window = window_of([shifts.get(i) for i in shift_ids_of(doc)])
        # The ids are rewritten from what actually resolved, so a shift that has since been
        # deleted leaves the UI showing "No shift" rather than a control stuck on a value
        # it has no option for.
        doc["shift_id"] = window["shift_id"]
        doc["shift_ids"] = window["shift_ids"]
        doc["shift_name"] = window["shift_name"]
        doc["shift_start"] = window["start_time"]
        doc["shift_end"] = window["end_time"]
        # The halves of a split day, each with its own ends. shift_start/shift_end are only
        # the outer edges of it, and a grid cut across those would publish the gap between
        # a morning and an evening as workable time.
        doc["shift_windows"] = window["segments"]
    return doctors
