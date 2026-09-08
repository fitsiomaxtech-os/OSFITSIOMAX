"""What a day of attendance is, worked out from the clock rather than typed by hand.

Attendance used to be two half-answers. The clock recorded when somebody arrived and left
(routers/v3_clock.py) and then wrote `present` on the register whatever the times said, so
a person who turned up at eleven and one who turned up at nine were the same word. The
rest -- late, half day, absent, week off -- was HR reading fifty rows and typing a
judgement onto each, which meant a month was only as marked as HR had had time to be.

So the day is derived now, from three things and in this order:

    what a person decided     an HR mark, or an approved leave. Always wins.
    what the branch expects   its hours, its grace, its week off. Set by the Branch Admin.
    what the clock recorded   when they pressed in, and how long they worked.

Nothing here writes. Every screen that shows attendance calls this over the rows it
already has, which is what keeps the register, the board, a person's own month and payroll
saying the same thing about the same Tuesday. Writing derived rows instead would need a
job that runs at midnight, and a register full of statuses nobody chose that go stale the
moment a rule changes.

The rules belong to the branch, because the working day does. A clinic that opens at seven
and closes on Tuesdays is not an exception to a company-wide rule, it is the rule where it
stands -- so the Branch Admin sets them (Management -> Time Management) and every employee
on that branch is measured against them. An employee on no branch, or on a branch nobody
has configured, falls back to DEFAULTS below rather than to nothing.

One guard matters more than the rest of the file. A day nobody clocked becomes `absent`,
which costs a day's pay -- and an employee with no login CANNOT clock, so deriving absence
for them would empty the salary of every person whose job never needed an account. They
are left unmarked, exactly as they were before any of this. See `has_login` in day_status.
"""

from datetime import date
from typing import Any, Dict, Iterable, List, Optional

# Monday is 0, as date.weekday() counts -- the same numbering the standard library uses, so
# nothing here has to remember an offset.
MONDAY, SUNDAY = 0, 6
WEEKDAY_NAMES = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")

# What a branch that has never opened the screen is measured against.
#
# Constants rather than a settings row, for the reason the rest of this OS gives: a feature
# that needs a row written before it does anything is a feature that does nothing on its
# first day. A branch that wants its own hours says so, and until it does these are a
# nine-to-six week with Sunday off, which is the shape of most of them.
DEFAULTS: Dict[str, Any] = {
    "work_start": "09:00",
    "work_end": "18:00",
    # How late is still on time. Not zero: a register that calls 09:00:40 late is a
    # register nobody believes, and the argument about the clinic clock being fast is one
    # no HR Admin should have to have.
    "grace_minutes": 15,
    # Below this, a day worked is half a day. It is the one derived status with pay
    # attached, so it is stated in minutes actually worked -- breaks already taken off --
    # rather than guessed from when somebody left.
    "half_day_minutes": 240,
    # Which days nobody is expected in. A list because a clinic closing Saturday and Sunday
    # is as ordinary as one closing neither, and a single day would have to be widened the
    # first time somebody asked.
    "week_offs": [SUNDAY],
}

MAX_GRACE_MINUTES = 120
MAX_HALF_DAY_MINUTES = 12 * 60

# The name the clock used to stamp on rows it wrote itself. Those rows are still in the
# database, carrying `present` for days that may have been late or half -- and a stored
# status wins over a derived one, so without this they would be frozen at the clock's old
# guess forever. Recognised and stepped over instead, which fixes the history without a
# migration touching a single row.
CLOCK_MARK = "Clocked in"

# Statuses, mirrored from routers/v3_hr_ops.py rather than imported, because that module
# imports this one and a top-level import back would close the loop. The tests hold the two
# lists to each other.
PRESENT, LATE, HALF_DAY, ABSENT, WEEK_OFF = "present", "late", "half_day", "absent", "week_off"


def parse_hhmm(value: Any) -> Optional[int]:
    """"07:30" -> 450 minutes past midnight. None if it isn't a 24-hour HH:MM.

    A second copy of shift_utils.parse_hhmm on purpose: this module is imported by the
    register, and shift_utils reaches the database at import time through its own imports.
    Held to the same answers by the tests.
    """
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


def clean_rules(payload: Dict[str, Any]) -> Dict[str, Any]:
    """A branch's rules, checked and complete, whatever the caller left out.

    Every field falls back to its default rather than to nothing, so a screen that saves
    only the week off does not silently blank the hours beside it. Returns the whole set
    because the whole set is what gets stored: a partial rules document would mean every
    reader having to merge defaults itself, and one of them eventually forgetting.
    """
    out = dict(DEFAULTS)

    for field in ("work_start", "work_end"):
        given = payload.get(field)
        if given is not None:
            if parse_hhmm(given) is None:
                raise ValueError(f"{field.replace('_', ' ')} must be a time, as HH:MM")
            out[field] = str(given).strip()
    if parse_hhmm(out["work_end"]) <= parse_hhmm(out["work_start"]):
        # A window that closes before it opens would make every day a half day, which
        # reads as the register being broken rather than as the hours being wrong.
        raise ValueError("The working day has to end after it starts")

    for field, ceiling in (("grace_minutes", MAX_GRACE_MINUTES), ("half_day_minutes", MAX_HALF_DAY_MINUTES)):
        given = payload.get(field)
        if given is None:
            continue
        try:
            number = int(given)
        except (TypeError, ValueError):
            raise ValueError(f"{field.replace('_', ' ')} must be a whole number of minutes")
        if not (0 <= number <= ceiling):
            raise ValueError(f"{field.replace('_', ' ')} must be between 0 and {ceiling} minutes")
        out[field] = number

    given = payload.get("week_offs")
    if given is not None:
        if not isinstance(given, (list, tuple)):
            raise ValueError("Week off must be a list of days")
        days = sorted({int(d) for d in given if str(d).strip() != ""})
        if any(d < MONDAY or d > SUNDAY for d in days):
            raise ValueError("A week off day must be 0 (Monday) to 6 (Sunday)")
        if len(days) >= 7:
            # Every day off is not a roster, it is a closed branch, and it would mark the
            # whole month week_off and pay everybody in full for it.
            raise ValueError("A branch cannot have every day of the week off")
        out["week_offs"] = days

    return out


def rules_of(branch: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """The rules stored on a branch document, filled out with the defaults.

    Tolerant on purpose. This runs over every branch on every read of the register, and a
    branch whose stored rules are half-written or hand-edited must produce a working day
    rather than a 500 on a screen that is only trying to list who came in.
    """
    stored = (branch or {}).get("attendance_rules") or {}
    try:
        return clean_rules(stored)
    except (ValueError, TypeError):
        return dict(DEFAULTS)


def is_week_off(rules: Dict[str, Any], iso: str) -> bool:
    try:
        return date.fromisoformat(iso).weekday() in (rules.get("week_offs") or [])
    except (TypeError, ValueError):
        return False


def working_days(rules: Dict[str, Any], days: Iterable[str]) -> List[str]:
    """Of these dates, the ones the branch expects somebody in on."""
    return [d for d in days if not is_week_off(rules, d)]


def decided_status(mark: Optional[Dict[str, Any]]) -> str:
    """The status a person actually chose for this day, or "" if nobody did.

    An approved leave counts as chosen -- somebody signed it off, and it carries the id of
    the decision. A row the clock stamped does not: it was this file's job before this file
    existed, and treating it as a decision would freeze those days at `present` forever.
    """
    mark = mark or {}
    status = mark.get("status") or ""
    if not status:
        return ""
    if mark.get("approval_id"):
        return status
    if mark.get("marked_by") == CLOCK_MARK:
        return ""
    return status


def day_status(
    rules: Dict[str, Any],
    iso: str,
    clock: Optional[Dict[str, Any]],
    totals: Optional[Dict[str, Any]],
    mark: Optional[Dict[str, Any]] = None,
    today: str = "",
    has_login: bool = True,
) -> Dict[str, Any]:
    """What one employee's one day is, and whether anybody chose it.

    `totals` is day_totals from routers/v3_clock.py -- passed in rather than computed here
    so this module needs nothing from the clock, and so the hours on the board and the
    status beside them are the same arithmetic.

    `auto` is what the screens draw the difference with: a derived status is a reading and
    can change when the rules or the clock do, a decided one is somebody's word and does
    not. HR overriding a day is the whole point of the distinction.

    The order below is the argument of the module, in five lines.
    """
    decided = decided_status(mark)
    if decided:
        return {"status": decided, "auto": False}

    # Nobody is expected in, so nothing about the clock can make the day anything else. A
    # person who does come in on their week off is still on their week off as far as pay is
    # concerned; the hours they worked are on the row beside it either way.
    if is_week_off(rules, iso):
        return {"status": WEEK_OFF, "auto": True}

    clocked_in = (clock or {}).get("clock_in") or ""
    if clocked_in:
        worked = int((totals or {}).get("worked_minutes") or 0)
        # Only once the day is finished. Judging a day still running by the hours so far
        # would call everybody a half day at ten in the morning.
        done = bool((clock or {}).get("clock_out")) or (today and iso < today)
        if done and worked < int(rules.get("half_day_minutes") or 0):
            return {"status": HALF_DAY, "auto": True}
        start = parse_hhmm(rules.get("work_start")) or 0
        arrived = parse_hhmm(clocked_in)
        if arrived is not None and arrived > start + int(rules.get("grace_minutes") or 0):
            return {"status": LATE, "auto": True}
        return {"status": PRESENT, "auto": True}

    # Nothing pressed. Today is not an absence yet -- the day is still going, and nine in
    # the morning is too early to have decided anything about it.
    if today and iso >= today:
        return {"status": "", "auto": True}
    # And somebody with no login could not have pressed anything. Their silence says
    # nothing about whether they were here, so it is not read as saying they were not.
    if not has_login:
        return {"status": "", "auto": True}
    return {"status": ABSENT, "auto": True}
