"""EVERY PERSON'S OWN RECORD -- the two things somebody asks about themselves.

    My Profile     who I am on this company's books
    Attendance     what hours I have worked this month

Both used to be somebody else's screen. The profile was four lines in a dialog off the
header -- a name, a role, a joining date -- and everything HR actually holds about a person
(their address, their emergency contact, where their salary is paid) could only be read by
opening HR's Employees tab, which is Super Admin's. The month was the same story: it lived
on HR's register, gated to HR, so a physio could not answer "how many hours did I do last
week" without asking somebody.

Nothing here takes an id. Every endpoint answers for whoever is holding the token, which is
what makes it safe to give to every role at once: there is no parameter to point at another
person's record. Reading anybody else's is still HR's register and HR's Employees tab,
gated exactly as they were.

Two collections meet here, keyed differently, and that is the one complication worth
knowing about:

    users        the login. Carries `employee_id` when Credentials linked it to somebody.
    employees    the person on the books. Everything HR filled in.
    clock_days   what they pressed, keyed by the login (routers/v3_clock.py)
    attendance   what HR marked, keyed by the employee (routers/v3_hr_ops.py)

So a login with no employee behind it -- every seeded and shared account is one -- still
gets its clock back in full, and gets a profile that says plainly that no employee record
is linked rather than inventing blanks. See `linked` on both replies.
"""

import calendar
from datetime import date
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from database import v3_col
from deps import v3_current_user
from schemas.v3 import V3UserOut
from utils import clinic_today, now_iso

# How long a day adds up to, from the module that owns the presses. The same function HR's
# board reads (see routers/v3_hr_ops.py), so a person's own screen and the register cannot
# disagree about how long they were in.
from routers.v3_clock import day_totals
# The register's marks, named once. Importing them rather than restating the strings means
# a status the register learns is a status this screen already understands.
from routers.v3_hr_ops import ABSENT, HALF_DAY, HOLIDAY, LATE, LEAVE, PRESENT, WEEK_OFF
# How an employee's branch is worked out -- not a lookup, and a multi-branch desk holds
# several. Same reason v3_hr_ops.py imports it: two implementations would print one branch
# on HR's tab and another on the person's own profile.
from routers.v3_hr import resolve_employee_branches

router = APIRouter(prefix="/api/v3/me")


# ---------- the standard day ----------

# The shape of a full working day, against which a month is measured.
#
# Constants rather than settings, deliberately: a screen that needs a config row written
# before it can show anything is a screen that shows nothing on its first day. When a
# clinic wants its own hours, this is the one place to lift into Settings.
STANDARD_START = "09:00"
STANDARD_END = "18:00"
STANDARD_MINUTES = 8 * 60

# The day of the week nobody is expected in when HR has marked nothing. Sunday.
#
# Only a default. A week off HR actually marked wins over it -- see _expected_day -- so a
# clinic that works Sundays and rests Tuesdays says so on the register and this follows.
DEFAULT_WEEK_OFF = 6  # Monday is 0, as date.weekday() counts

# Marks that mean the person was not expected at work that day. No expected hours are
# counted against them, so a month is not "behind" by the holidays in it.
NOT_EXPECTED = (WEEK_OFF, HOLIDAY, LEAVE, ABSENT)

# Marks that say somebody was in. Late is one of them: arriving at 09:12 is a punctuality
# fact, counted on its own, not an absence.
PRESENT_MARKS = (PRESENT, LATE)

COUNTED_STATUSES = (PRESENT, LATE, HALF_DAY, ABSENT, LEAVE, WEEK_OFF, HOLIDAY)


def _valid_month(value: Optional[str]) -> str:
    """A YYYY-MM, or a 400. Blank is the month the clinic is in now."""
    text = str(value or "").strip()
    if not text:
        return clinic_today()[:7]
    try:
        date.fromisoformat(text + "-01")
    except ValueError:
        raise HTTPException(status_code=400, detail="month must be YYYY-MM")
    return text


def _month_days(month: str) -> List[str]:
    year, mon = int(month[:4]), int(month[5:7])
    last = calendar.monthrange(year, mon)[1]
    return ["%s-%02d" % (month, d) for d in range(1, last + 1)]


def _expected_day(iso: str, status: str) -> bool:
    """Was this person expected at work on this date?

    HR's mark decides where there is one: a marked week off, holiday, approved leave or
    absence costs nobody expected hours. Where there is no mark, the weekly rest day is
    assumed and every other day is expected.
    """
    if status in NOT_EXPECTED:
        return False
    if status:
        return True
    return date.fromisoformat(iso).weekday() != DEFAULT_WEEK_OFF


# ---------- my profile ----------

def _masked(value: str, keep: int = 4) -> str:
    """The last few digits of an identity number, the rest as dots.

    Their own number on their own screen -- but a profile page is the kind of thing that
    ends up on a shared desk or in a screenshot, and the last four are enough to confirm
    which document is on file, which is the only question this page is asked about it.
    """
    text = str(value or "").strip()
    if not text or len(text) <= keep:
        return text
    return ("•" * (len(text) - keep)) + text[-keep:]


# What the profile page draws, taken off the employee record as stored. Named here rather
# than returning the record whole: that document also carries net_salary and gross_salary,
# and payroll is a screen of its own with a run behind it -- a figure lifted out of the HR
# record and printed on a profile page would be a salary with no payslip to check it
# against.
PROFILE_FIELDS = (
    # who they are
    "full_name", "email", "phone", "dob", "gender", "blood_group", "marital_status",
    "father_name", "mother_name", "photo_url",
    # what they do here
    "employee_code", "department", "designation", "work_type", "service",
    "joining_date", "reporting_to", "status",
    # where they live, and who to call
    "address", "emergency_contact_name", "emergency_contact_phone",
    # where the salary lands. The account, not the amount: "is my account on file
    # correctly" is the question somebody opens their own profile with.
    "bank_name", "bank_account", "ifsc",
)


@router.get("/profile")
async def my_profile(user: V3UserOut = Depends(v3_current_user)):
    """Everything this company holds about the person signed in.

    The login is always answered for. The employee record behind it is answered for when
    Credentials linked one -- `linked` says which, so the screen can name the gap ("no
    employee record is linked to this login") rather than drawing a form full of dashes
    that reads as lost data.
    """
    account = await v3_col("users").find_one(
        {"id": user.id}, {"_id": 0, "employee_id": 1, "mobile_number": 1, "branch_id": 1},
    ) or {}
    emp: Dict[str, Any] = {}
    if account.get("employee_id"):
        emp = await v3_col("employees").find_one({"id": account["employee_id"]}, {"_id": 0}) or {}
    if emp:
        # One row through the same resolver HR's tab uses, so "Anna Nagar + Parrys" reads
        # the same on both screens.
        emp = (await resolve_employee_branches([emp]))[0]

    branch_name = emp.get("branch_name") or ""
    if not branch_name and account.get("branch_id"):
        branch = await v3_col("branches").find_one(
            {"id": account["branch_id"]}, {"_id": 0, "branch_name": 1},
        )
        branch_name = (branch or {}).get("branch_name") or ""

    profile = {k: emp.get(k) or "" for k in PROFILE_FIELDS}
    # The login's own copies stand in where the employee record is silent. Somebody who
    # typed their mobile into Credentials and never had it written onto their HR record
    # should still see it here rather than a dash.
    profile["full_name"] = profile["full_name"] or user.full_name
    profile["email"] = profile["email"] or user.email
    profile["phone"] = profile["phone"] or (account.get("mobile_number") or "")
    profile["photo_url"] = profile["photo_url"] or (user.photo_url or "")

    return {
        "linked": bool(emp),
        # The login's own facts, which exist whether or not anybody is on the books.
        "account": {
            "id": user.id,
            # What the header dialog has always called the Employee ID: the tail of the
            # login's id. Kept for the account that has no employee code of its own.
            "short_id": "#" + user.id[-8:].upper(),
            "role": user.role,
            "created_at": user.created_at,
            "branch_name": branch_name,
        },
        "pan": _masked(emp.get("pan") or ""),
        "aadhar": _masked(emp.get("aadhar") or ""),
        **profile,
    }


# ---------- my attendance ----------

def _row(iso: str, clock: Optional[dict], mark: dict, now_at: str) -> Dict[str, Any]:
    """One line of the month: what was pressed, what was marked, and what it adds up to."""
    totals = day_totals(clock, now_at)
    status = mark.get("status") or ""
    # Only a day somebody was expected on can be behind. A Sunday worked is all credit and
    # no debit, which is what makes the extra hours at the foot of the month mean anything.
    target = STANDARD_MINUTES if _expected_day(iso, status) else 0
    return {
        "date": iso,
        "weekday": date.fromisoformat(iso).strftime("%a"),
        # One clock document per person per day, so a day is one session or none. Kept as a
        # count rather than a yes/no because the register speaks in sessions, and a second
        # one would land here unchanged if the clock ever grew them.
        "sessions": 1 if (clock or {}).get("clock_in") else 0,
        "clock_in": (clock or {}).get("clock_in") or mark.get("check_in") or "",
        "clock_out": (clock or {}).get("clock_out") or mark.get("check_out") or "",
        "login_minutes": totals["login_minutes"],
        "worked_minutes": totals["worked_minutes"],
        "break_minutes": totals["break_minutes"],
        "break_count": totals["break_count"],
        "balance_minutes": totals["worked_minutes"] - target,
        "expected_minutes": target,
        # What HR called the day, empty where nobody has said anything. The screen falls
        # back to the clock for an unmarked day -- the same rule as _board_status in
        # routers/v3_hr_ops.py, which is HR's side of this table.
        "status": status,
        "state": totals["state"],
        "note": mark.get("note") or "",
        "breaks": [
            {"out": b.get("out") or "", "in": b.get("in") or "", "reason": b.get("reason") or ""}
            for b in ((clock or {}).get("breaks") or [])
        ],
    }


@router.get("/attendance")
async def my_attendance(
    month: Optional[str] = Query(None),
    user: V3UserOut = Depends(v3_current_user),
):
    """The signed-in person's month: the totals, and every day that has happened in it.

    Theirs alone -- there is no id to pass, exactly as /clock/history has none. Every role
    gets this, because it answers a question about the person holding the account.

    Two sources, joined by date. The clock is keyed by the login and carries the times; the
    register is keyed by the employee and carries the marks HR made -- leave, absent, half
    day. A login with no employee record simply has no marks, and its month is what it
    pressed.
    """
    mon = _valid_month(month)
    days = _month_days(mon)
    first, last = days[0], days[-1]
    today = clinic_today()

    account = await v3_col("users").find_one({"id": user.id}, {"_id": 0, "employee_id": 1}) or {}
    employee_id = account.get("employee_id") or ""

    clocks = await v3_col("clock_days").find(
        {"user_id": user.id, "date": {"$gte": first, "$lte": last}}, {"_id": 0},
    ).to_list(40)
    clock_by = {c["date"]: c for c in clocks}

    marks: Dict[str, dict] = {}
    if employee_id:
        rows = await v3_col("attendance").find(
            {"employee_id": employee_id, "date": {"$gte": first, "$lte": last}}, {"_id": 0},
        ).to_list(40)
        marks = {r["date"]: r for r in rows}

    now_at = now_iso()
    # The current month stops at today rather than running to the 30th. Rows for days that
    # have not happened are not attendance, they are a calendar, and a run of empty ones
    # under the last real day reads as a fortnight of absences.
    shown = [d for d in days if d <= today] if mon == today[:7] else days
    rows = [_row(d, clock_by.get(d), marks.get(d) or {}, now_at) for d in shown]

    # Counted off the same rows the table draws, so a tile and the column under it cannot
    # disagree. The expected figure is the whole month; the balance is measured only
    # against the days that have happened -- telling somebody on the 5th that they are 150
    # hours behind is arithmetic, not information.
    counts = {s: 0 for s in COUNTED_STATUSES}
    for r in rows:
        if r["status"] in counts:
            counts[r["status"]] += 1

    worked = sum(r["worked_minutes"] for r in rows)
    expected_so_far = sum(r["expected_minutes"] for r in rows)
    expected_month = sum(
        STANDARD_MINUTES if _expected_day(d, (marks.get(d) or {}).get("status") or "") else 0
        for d in days
    )
    # Present is what somebody did, not only what they were marked: a day clocked is a day
    # present whether or not HR has got to the register yet.
    present_days = len([r for r in rows if r["sessions"] or r["status"] in PRESENT_MARKS])

    return {
        "month": mon,
        "today": today,
        "standard": {"start": STANDARD_START, "end": STANDARD_END, "minutes": STANDARD_MINUTES},
        "linked": bool(employee_id),
        "totals": {
            "working_days": expected_month // STANDARD_MINUTES,
            "present_days": present_days,
            "absent_days": counts[ABSENT],
            "leave_days": counts[LEAVE],
            "half_days": counts[HALF_DAY],
            "late_days": counts[LATE],
            "off_days": counts[WEEK_OFF] + counts[HOLIDAY],
            "expected_minutes": expected_month,
            # What was expected of the days that have actually happened. What the balance
            # below is measured against.
            "expected_to_date_minutes": expected_so_far,
            "worked_minutes": worked,
            "break_minutes": sum(r["break_minutes"] for r in rows),
            "extra_minutes": sum(max(r["balance_minutes"], 0) for r in rows),
            "balance_minutes": worked - expected_so_far,
        },
        "days": list(reversed(rows)),
    }
