"""The clock a login is expected to keep, and what the register makes of it.

Four marks, set per account in Super Admin -> Credentials: on at LOGIN, away from BREAK IN
until BREAK OUT, off at LOGOUT. "Break in" is the start of the break and "break out" the
return from it -- the same reading as login and logout, where "in" is the beginning of the
thing named.

They are stored on the account rather than on the employee record because Credentials is
the screen that lists everyone who signs in, and because plenty of logins have no employee
row behind them at all.

Its own module because two desks share these rules and neither owns them. routers/v3_hr.py
writes the times (Credentials), routers/v3_hr_ops.py reads them (Attendance, which measures
a check-in against `login_time`), and the arithmetic that decides what "late" means has to
be the same on both sides -- one copy of it, or a register that disagrees with the roster
it was drawn from.

Nothing here touches the database. It takes a dict and returns one, which is also what
lets the rules be tested without a server -- see tests/test_hr_ops_payroll.py.
"""

from typing import Any, Dict, Optional

from fastapi import HTTPException

# Named once, and read from here everywhere. A fifth mark added later has one place to be
# added and every reader picks it up.
WORK_TIMING_FIELDS = ("login_time", "logout_time", "break_in_time", "break_out_time")

DAY_MINUTES = 24 * 60

# How long after the rostered login a check-in still counts as on time.
#
# Not zero. A register that calls 09:01 late for a 09:00 start is one nobody trusts by the
# end of the first week, and the mark HR sets is still theirs to choose -- this only decides
# when the register says "late by 14m" beside the time somebody typed.
LATE_GRACE_MINUTES = 10


def parse_time(value: Any) -> Optional[int]:
    """"09:30" -> 570 minutes past midnight. None for blank or anything unparseable."""
    parts = str(value or "").strip().split(":")
    if len(parts) != 2:
        return None
    try:
        hours, minutes = int(parts[0]), int(parts[1])
    except ValueError:
        return None
    if not (0 <= hours <= 23 and 0 <= minutes <= 59):
        return None
    return hours * 60 + minutes


def _required_time(value: Optional[str], field: str) -> Optional[int]:
    """As parse_time, but a value that was given and cannot be read is a 400 naming it.

    Blank is still None -- an unset time, not midnight -- because leaving a box empty is
    how a time is removed.
    """
    if not str(value or "").strip():
        return None
    minutes = parse_time(value)
    if minutes is None:
        raise HTTPException(status_code=400, detail=f"{field} must be a 24-hour time, as HH:MM")
    return minutes


def _span(start: int, end: int) -> int:
    """How long a window runs in minutes, reading a wrap past midnight as the next day.

    A night shift is a real shift -- 22:00 to 06:00 is eight hours, not minus sixteen -- so
    the arithmetic is modular rather than a subtraction that would refuse it. Equal start
    and end is zero, which every caller treats as an error rather than as a day.
    """
    return (end - start) % DAY_MINUTES


def clean_work_timing(raw: Dict[str, Any]) -> Dict[str, str]:
    """The four times, checked against each other. Blank stays blank and means unset.

    What is refused is only what could not be worked: a shift that ends the minute it
    starts, half a break, and a break that falls outside the shift it is supposed to
    interrupt. Anything else -- including a shift with no break, or a break set before the
    shift around it -- is a half-filled roster, which is allowed because it is how one gets
    filled in.
    """
    out = {f: str(raw.get(f) or "").strip() for f in WORK_TIMING_FIELDS}
    login = _required_time(out["login_time"], "Login time")
    logout = _required_time(out["logout_time"], "Logout time")
    brk_in = _required_time(out["break_in_time"], "Break in time")
    brk_out = _required_time(out["break_out_time"], "Break out time")

    shift_len = None
    if login is not None and logout is not None:
        shift_len = _span(login, logout)
        if shift_len == 0:
            raise HTTPException(status_code=400, detail="Logout time cannot be the same as login time")

    if (brk_in is None) != (brk_out is None):
        raise HTTPException(status_code=400, detail="A break needs both a break in and a break out time")

    if brk_in is not None and brk_out is not None:
        break_len = _span(brk_in, brk_out)
        if break_len == 0:
            raise HTTPException(status_code=400, detail="Break out time cannot be the same as break in time")
        if shift_len is not None:
            # Measured from the login rather than off the clock face, so a break inside a
            # night shift (23:00 start, break at 02:00) reads as three hours in rather than
            # as twenty-one hours before.
            if _span(login, brk_in) + break_len > shift_len:
                raise HTTPException(status_code=400, detail="The break must fall between login and logout")

    return out


def timing_of(row: Dict[str, Any]) -> Dict[str, str]:
    """The four times off a stored row -- always all four, blank where unset.

    One shape for every reader, so a column, a form and the register are not each guessing
    at a key that may or may not be on the document.
    """
    return {f: str(row.get(f) or "") for f in WORK_TIMING_FIELDS}


def is_rostered(timing: Dict[str, Any]) -> bool:
    """Whether anybody has set hours here at all. An empty roster is not a 00:00 start."""
    return any(str(timing.get(f) or "").strip() for f in WORK_TIMING_FIELDS)


def late_by(timing: Dict[str, Any], check_in: Any) -> int:
    """Minutes a check-in ran past the rostered login. 0 for early, unset or unrostered.

    Both times are clock faces with no date on them, so the gap is read as the nearer of
    the two directions: twelve hours either way. That is what makes an 08:50 arrival on a
    09:00 start ten minutes early rather than twenty-three hours and fifty minutes late.

    Half a comparison is not a late arrival. Somebody nobody has rostered, and a mark with
    no time typed on it, both come back 0 -- the register says it cannot tell, rather than
    reporting an overrun measured from midnight.
    """
    start, actual = parse_time((timing or {}).get("login_time")), parse_time(check_in)
    if start is None or actual is None:
        return 0
    diff = (actual - start + DAY_MINUTES // 2) % DAY_MINUTES - DAY_MINUTES // 2
    return diff if diff > 0 else 0
