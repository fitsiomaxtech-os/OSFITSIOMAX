"""THE CLOCK -- every person's own record of the day they worked.

Four marks, all of them made by the person they are about, from the button in the header:

    Clock In  ->  Break Out  ->  Break In  ->  Clock Out
                     (why?)

Nobody types anybody else's day in here. HR's register (routers/v3_hr_ops.py) is still
where a month is decided -- a day can be marked absent, half, leave -- but the times on it
are no longer somebody's recollection of when other people arrived. They are what those
people pressed, when they pressed it.

Two things follow from that, and both are deliberate:

The server stamps the time, never the browser. A clock somebody can set is not a clock, and
a laptop with the wrong date would otherwise file a day under the wrong one.

A break is not a gap. "Break Out" asks what the break is for and refuses to start one
without an answer, because "where was this person for fifty minutes" is the question the
record exists to answer, and an unlabelled hole in the day does not answer it.

One document per person per clinic day (see clinic_today in utils.py -- the server's UTC
date rolls over at 05:30 IST, which would file the first hours of every morning under
yesterday). The document is the state: what may be pressed next is worked out from what is
already on it, in `_state`, rather than stored as a status that could disagree with it.
"""

import uuid
from datetime import date, datetime, timedelta
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from database import v3_col
from deps import v3_current_user
from schemas.v3 import V3UserOut
from utils import CLINIC_UTC_OFFSET, clinic_today, now_iso, now_utc

router = APIRouter(prefix="/api/v3/clock")


# The reasons offered as one tap each. Not a closed list -- anything can be typed instead --
# but the six that cover most days, so the common case is a tap rather than a sentence.
#
# Kept here rather than in a settings collection on purpose: a list somebody has to
# configure before the feature works is a feature that does not work on its first day.
BREAK_REASONS = ["Lunch", "Tea break", "Personal", "Meeting", "Prayer", "Stepped out"]

MAX_REASON_LEN = 80

# The four states a day can be in, and what may be pressed in each.
OUT = "out"              # not clocked in yet
WORKING = "working"      # clocked in, at work
ON_BREAK = "on_break"    # clocked in, away, with a reason on record
DONE = "done"            # clocked out

ACTIONS = {
    OUT: ["clock_in"],
    WORKING: ["break_out", "clock_out"],
    # Only one. Clocking out from a break would leave the break open forever, and the
    # honest fix is the button that ends it -- see clock_out, which says so.
    ON_BREAK: ["break_in"],
    DONE: [],
}


def _clinic_now() -> Dict[str, str]:
    """The moment, twice: the clinic's wall clock, and the UTC instant behind it.

    "HH:MM" is what a person reads and what the register shows. The ISO stamp is kept
    beside it because a wall clock cannot be subtracted across midnight, and a night shift
    crosses one every time.
    """
    moment = now_utc()
    return {"hhmm": (moment + CLINIC_UTC_OFFSET).strftime("%H:%M"), "at": moment.isoformat()}


def _minutes_between(start_at: Any, end_at: Any) -> int:
    """Whole minutes between two ISO stamps. 0 if either is missing or unreadable.

    Off the stamps rather than the wall clock, so a break taken across midnight is counted
    as the minutes it took rather than as most of a day backwards.
    """
    try:
        a = datetime.fromisoformat(str(start_at))
        b = datetime.fromisoformat(str(end_at))
    except (TypeError, ValueError):
        return 0
    return max(int((b - a).total_seconds() // 60), 0)


def _open_break(day: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """The break somebody is on right now, if they are on one."""
    for entry in reversed(day.get("breaks") or []):
        if not entry.get("in"):
            return entry
    return None


def _state(day: Optional[Dict[str, Any]]) -> str:
    """Which of the four states a day's document is in.

    Derived, never stored. A stored status would be a second copy of what the timestamps
    already say, and the two can be made to disagree -- by a failed write, or by two tabs
    pressing at once -- at which point neither can be trusted.
    """
    if not day or not day.get("clock_in"):
        return OUT
    if day.get("clock_out"):
        return DONE
    return ON_BREAK if _open_break(day) else WORKING


def _break_minutes(day: Dict[str, Any], upto_at: str) -> int:
    """Minutes spent on breaks, counting one still running up to `upto_at`."""
    return sum(
        _minutes_between(b.get("out_at"), b.get("in_at") or upto_at)
        for b in (day.get("breaks") or [])
    )


def _public(day: Optional[Dict[str, Any]], on: str) -> Dict[str, Any]:
    """One day, in the shape every screen reads.

    A day nobody has touched comes back as an empty day rather than as nothing, so the
    header has something to draw before the first press of the morning.
    """
    now = _clinic_now()
    day = day or {}
    state = _state(day)
    # A day still running is measured up to now, a finished one up to the clock-out. Both
    # are honest -- the first says "so far", and the screen labels it that way.
    end_at = day.get("clock_out_at") or now["at"]
    breaks = [
        {
            "out": b.get("out") or "",
            "in": b.get("in") or "",
            "reason": b.get("reason") or "",
            "minutes": _minutes_between(b.get("out_at"), b.get("in_at") or now["at"]),
            "running": not b.get("in"),
        }
        for b in (day.get("breaks") or [])
    ]
    break_minutes = sum(b["minutes"] for b in breaks)
    worked = 0
    if day.get("clock_in_at"):
        worked = max(_minutes_between(day["clock_in_at"], end_at) - break_minutes, 0)
    open_break = _open_break(day) or {}
    return {
        "date": day.get("date") or on,
        "state": state,
        "actions": ACTIONS[state],
        "clock_in": day.get("clock_in") or "",
        "clock_out": day.get("clock_out") or "",
        "breaks": breaks,
        "break_minutes": break_minutes,
        "worked_minutes": worked,
        # What the header shows while somebody is away, so it does not have to hunt back
        # through the list for the one break with no end on it.
        "on_break_since": open_break.get("out") or "",
        "break_reason": open_break.get("reason") or "",
    }


async def _employee_id_of(user_id: str) -> str:
    row = await v3_col("users").find_one({"id": user_id}, {"_id": 0, "employee_id": 1})
    return (row or {}).get("employee_id") or ""


async def _day_doc(user_id: str, on: str) -> Optional[Dict[str, Any]]:
    return await v3_col("clock_days").find_one({"user_id": user_id, "date": on}, {"_id": 0})


async def _mirror_to_register(user_id: str, on: str, day: Dict[str, Any]) -> None:
    """Write the times through to HR's register, which is where payroll reads them.

    The register is keyed by employee, and an account with nobody linked simply does not
    reach it -- their clock is still their own record, and Credentials is where the link is
    made. Nothing is invented on their behalf.

    Two things are never touched. A row an approved leave wrote (`approval_id`) belongs to
    that decision rather than to a button. And a status HR set by hand stands: somebody who
    clocks in on a day marked half-day was still marked half-day by a person who knew why.
    The clock fills in a status only where nobody has given one, and only ever `present` --
    what the other marks mean is HR's to decide, and this reports one thing, that somebody
    was here.
    """
    employee_id = await _employee_id_of(user_id)
    if not employee_id:
        return
    existing = await v3_col("attendance").find_one(
        {"date": on, "employee_id": employee_id}, {"_id": 0, "status": 1, "approval_id": 1}
    )
    if existing and existing.get("approval_id"):
        return
    fields: Dict[str, Any] = {
        "check_in": day.get("clock_in") or "",
        "check_out": day.get("clock_out") or "",
        "break_minutes": _break_minutes(day, day.get("clock_out_at") or now_iso()),
        "breaks": [
            {"out": b.get("out") or "", "in": b.get("in") or "", "reason": b.get("reason") or ""}
            for b in (day.get("breaks") or [])
        ],
        "clocked": True,
        "marked_at": now_iso(),
    }
    if not (existing or {}).get("status"):
        fields["status"] = "present"
        # Named rather than left as the person's own name, so the register can tell at a
        # glance which marks somebody decided and which are simply what happened.
        fields["marked_by"] = "Clocked in"
    await v3_col("attendance").update_one(
        {"date": on, "employee_id": employee_id},
        {"$set": fields, "$setOnInsert": {"id": str(uuid.uuid4()), "date": on, "employee_id": employee_id}},
        upsert=True,
    )


async def _save(user: V3UserOut, on: str, updates: Dict[str, Any], push: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    change: Dict[str, Any] = {
        "$set": {**updates, "updated_at": now_iso()},
        "$setOnInsert": {"id": str(uuid.uuid4()), "user_id": user.id, "date": on},
    }
    if push:
        change["$push"] = push
    await v3_col("clock_days").update_one({"user_id": user.id, "date": on}, change, upsert=True)
    day = await _day_doc(user.id, on)
    await _mirror_to_register(user.id, on, day or {})
    return _public(day, on)


# ---------- the day, as it stands ----------

@router.get("/today")
async def my_day(user: V3UserOut = Depends(v3_current_user)):
    """What the header draws: today's record, and what may be pressed next."""
    on = clinic_today()
    day = await _day_doc(user.id, on)
    return {**_public(day, on), "now": _clinic_now()["hhmm"], "break_reasons": BREAK_REASONS}


# ---------- the four marks ----------

class BreakOut(BaseModel):
    reason: str


@router.post("/in")
async def clock_in(user: V3UserOut = Depends(v3_current_user)):
    """Start the day.

    The refusals name what the day already looks like rather than saying "not allowed":
    every one of these is reached by a double tap or a second tab, and the person pressing
    needs to know which of the two happened.
    """
    on = clinic_today()
    state = _state(await _day_doc(user.id, on))
    if state != OUT:
        raise HTTPException(
            status_code=400,
            detail="You have already clocked out for today" if state == DONE else "You are already clocked in",
        )
    now = _clinic_now()
    return await _save(user, on, {
        "clock_in": now["hhmm"],
        "clock_in_at": now["at"],
        # Denormalised so the register mirror and any later report can find the person
        # without a second lookup. Refreshed on every write, so linking an employee to an
        # account later fixes the days that follow rather than needing a backfill.
        "employee_id": await _employee_id_of(user.id),
    })


@router.post("/break-out")
async def break_out(payload: BreakOut, user: V3UserOut = Depends(v3_current_user)):
    """Start a break. The reason is the point of the button, so it is required.

    Free text, with the six common ones offered as taps. A field that only accepted its own
    six would turn every unusual break into whichever preset was least wrong, which is a
    worse record than the sentence somebody would have typed.
    """
    reason = (payload.reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="Say what the break is for")
    if len(reason) > MAX_REASON_LEN:
        raise HTTPException(status_code=400, detail=f"Keep the reason under {MAX_REASON_LEN} characters")
    on = clinic_today()
    state = _state(await _day_doc(user.id, on))
    if state != WORKING:
        raise HTTPException(status_code=400, detail={
            OUT: "Clock in before taking a break",
            ON_BREAK: "You are already on a break",
            DONE: "You have clocked out for today",
        }[state])
    now = _clinic_now()
    return await _save(user, on, {}, push={"breaks": {
        "out": now["hhmm"], "out_at": now["at"], "reason": reason, "in": "", "in_at": "",
    }})


@router.post("/break-in")
async def break_in(user: V3UserOut = Depends(v3_current_user)):
    """Come back from a break. Ends the open one -- there is only ever one open."""
    on = clinic_today()
    day = await _day_doc(user.id, on)
    if _state(day) != ON_BREAK:
        raise HTTPException(status_code=400, detail="You are not on a break")
    index = len(day.get("breaks") or []) - 1
    now = _clinic_now()
    return await _save(user, on, {f"breaks.{index}.in": now["hhmm"], f"breaks.{index}.in_at": now["at"]})


@router.post("/out")
async def clock_out(user: V3UserOut = Depends(v3_current_user)):
    """End the day. Final: today cannot be clocked into again.

    A break has to be closed first. Clocking out of one would leave a break with no end on
    it, and the arithmetic would then be guessing whether the rest of the day was a break
    or work -- so the button that answers it is the one offered.
    """
    on = clinic_today()
    state = _state(await _day_doc(user.id, on))
    if state != WORKING:
        raise HTTPException(status_code=400, detail={
            OUT: "You have not clocked in today",
            ON_BREAK: "End your break first, then clock out",
            DONE: "You have already clocked out today",
        }[state])
    now = _clinic_now()
    return await _save(user, on, {"clock_out": now["hhmm"], "clock_out_at": now["at"]})


# ---------- their own history ----------

def _month_span(month: str) -> tuple:
    try:
        first = date.fromisoformat(f"{month}-01")
    except ValueError:
        raise HTTPException(status_code=400, detail="month must be YYYY-MM")
    nxt = date(first.year + (first.month == 12), (first.month % 12) + 1, 1)
    return first.isoformat(), (nxt - timedelta(days=1)).isoformat()


@router.get("/history")
async def my_history(month: Optional[str] = Query(None), user: V3UserOut = Depends(v3_current_user)):
    """The signed-in person's own month. Theirs alone -- there is no id to pass.

    Every account gets this, whatever its role, because it answers a question about the
    person holding it: what hours did I work, and where did the day go. Reading anybody
    else's is HR's register, gated as it always was.
    """
    mon = month or clinic_today()[:7]
    start, end = _month_span(mon)
    rows = await v3_col("clock_days").find(
        {"user_id": user.id, "date": {"$gte": start, "$lte": end}}, {"_id": 0}
    ).sort("date", -1).to_list(40)
    days = [_public(r, r["date"]) for r in rows]
    return {
        "month": mon,
        "days": days,
        "totals": {
            "days_clocked": len(days),
            "worked_minutes": sum(d["worked_minutes"] for d in days),
            "break_minutes": sum(d["break_minutes"] for d in days),
            "breaks": sum(len(d["breaks"]) for d in days),
        },
    }
