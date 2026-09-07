"""EVERY PERSON'S OWN RECORD -- the things somebody asks about themselves.

    My Profile     who I am on this company's books
    Attendance     what hours I have worked this month
    Requests       leave and permission: asking for time off, and what came of it

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
is linked rather than inventing blanks. See `linked` on every reply.

Requests are the one section here that writes, and the only one that reaches anybody else.
They land in the same `approvals` collection HR already decides on, shaped by the same
builder HR's own form posts through -- see routers/v3_hr_ops.py. One queue, one decision,
and one thing that reaches the register: an approved leave marks the days, an approved
permission notes the hours on a day still worked. This adds a door, not a second system.
"""

import calendar
from datetime import date
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

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
# And the vocabulary of a request, from the same module. What a leave is, what states a
# request passes through, and how one is built and checked are decided in one place -- this
# file owns who may ask and for what, and nothing else.
from routers.v3_hr_ops import (
    APPROVED, LEAVE_KIND, MAX_PERMISSION_MINUTES, MIN_PERMISSION_MINUTES, PENDING,
    PERMISSION_KIND, REJECTED, SELF_SERVICE_KINDS, SOURCE_SELF,
    _dates_between, build_request, permission_of,
)
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
        # The hours an approved permission agreed on this day. Not a status -- they were
        # here -- but the reason a short day is a short day on purpose, and the one thing
        # on this row that answers "why does this Tuesday read two hours light".
        "permission": permission_of(mark),
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
            # Time off inside working days, agreed in advance. Beside the balance rather
            # than folded into it: the hours are genuinely not worked, and quietly
            # crediting them would make the figure below stop meaning hours at a desk.
            "permission_minutes": sum((r["permission"] or {}).get("minutes", 0) for r in rows),
            "permission_days": len([r for r in rows if r["permission"]]),
        },
        "days": list(reversed(rows)),
    }


# ---------- my requests: leave and permission ----------
# How far ahead a request may be dated. Not a policy about notice periods -- it is a typo
# guard: a leave booked for 2036 is a slipped finger on the year, and it would sit in the
# pending list forever because nobody would ever have reason to scroll to it.
MAX_YEARS_AHEAD = 1


class RequestCreate(BaseModel):
    kind: str = LEAVE_KIND
    # Leave: the first and last day. Permission: `from_date` is the day, and the two times
    # below are the hours of it.
    from_date: Optional[str] = ""
    to_date: Optional[str] = ""
    from_time: Optional[str] = ""
    to_time: Optional[str] = ""
    reason: Optional[str] = ""


NOT_LINKED = (
    "Your login isn't linked to an employee record yet, so there's nowhere to file this. "
    "Ask HR to link it on Credentials."
)


async def _my_employee(user: V3UserOut) -> Optional[Dict[str, Any]]:
    """The employee record behind the signed-in account, if the two are linked.

    Read off the account rather than matched by name or email: a person's login and their
    employee record are joined in Credentials by somebody who knew they were the same
    person, and guessing at that join is how one person's leave ends up on another's
    payslip.
    """
    row = await v3_col("users").find_one({"id": user.id}, {"_id": 0, "employee_id": 1})
    emp_id = (row or {}).get("employee_id") or ""
    if not emp_id:
        return None
    return await v3_col("employees").find_one({"id": emp_id}, {"_id": 0})


async def _employee_or_400(user: V3UserOut) -> Dict[str, Any]:
    emp = await _my_employee(user)
    if not emp:
        raise HTTPException(status_code=400, detail=NOT_LINKED)
    return emp


def _clashes(row: Dict[str, Any], existing: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """The request already on the list that covers a day this new one does, if any.

    Only leave against leave, and only against requests still live -- pending or approved.
    A rejected one is not holding the day, and a permission is hours inside a day somebody
    is working, so two of those on one day is a person with two errands rather than a
    mistake.

    Worth catching because a duplicate leave is otherwise silent: the second one approves
    onto days the first already marked, writes nothing, and reads on the list as though it
    had done something.
    """
    if row["kind"] != LEAVE_KIND:
        return None
    wanted = set(_dates_between(row["from_date"], row["to_date"]))
    for other in existing:
        if other.get("kind") != LEAVE_KIND or other.get("status") not in (PENDING, APPROVED):
            continue
        if not other.get("from_date"):
            continue
        covered = _dates_between(other["from_date"], other.get("to_date") or other["from_date"])
        if wanted & set(covered):
            return other
    return None


def _public_request(row: Dict[str, Any]) -> Dict[str, Any]:
    """One request as its own requester reads it.

    HR's internal columns are dropped rather than sent and ignored: the employee code and
    department on the row are facts this person already knows about themselves, and the
    decision note is the one part of HR's side that is addressed to them.
    """
    status = row.get("status") or PENDING
    return {
        "id": row.get("id") or "",
        "kind": row.get("kind") or "",
        "status": status,
        "from_date": row.get("from_date") or "",
        "to_date": row.get("to_date") or "",
        "days": int(row.get("days") or 0),
        "from_time": row.get("from_time") or "",
        "to_time": row.get("to_time") or "",
        "minutes": int(row.get("minutes") or 0),
        "reason": row.get("reason") or "",
        "requested_at": row.get("requested_at") or "",
        # Whether they raised it themselves or HR logged it for them. On the list because a
        # leave somebody else filed on your behalf is worth being able to tell apart from
        # one you filed.
        "raised_by_me": (row.get("source") or "") == SOURCE_SELF,
        "requested_by": row.get("requested_by") or "",
        "decided_by": row.get("decided_by") or "",
        "decided_at": row.get("decided_at") or "",
        "decision_note": row.get("decision_note") or "",
        # Only a request nobody has looked at can be taken back. Decided here rather than in
        # the browser, so the button and the endpoint cannot disagree about it.
        "can_withdraw": status == PENDING,
    }


def _empty_year(year: str) -> Dict[str, Any]:
    """What the screen is sent when there is no employee record behind the account.

    Not an error. Somebody opening this has done nothing wrong, and an empty list with a
    sentence explaining itself is something they can act on -- a 400 reads as a broken
    page and tells them nothing about who to ask.
    """
    return {
        "year": year,
        "linked": False,
        "reason": NOT_LINKED,
        "requests": [],
        "counts": {PENDING: 0, APPROVED: 0, REJECTED: 0},
        "taken": {"leave_days": 0, "permission_count": 0, "permission_minutes": 0},
        **_form_rules(),
    }


def _form_rules() -> Dict[str, Any]:
    """What the form is allowed to offer, decided here rather than in the browser.

    The two kinds and the two ends of a permission are this module's rules (they are
    checked again in build_request, which is where they are enforced). Sending them means
    a screen that says "up to 4 hours" says it because the server does, and changing the
    ceiling changes the sentence.
    """
    return {
        "kinds": list(SELF_SERVICE_KINDS),
        "permission_limits": {
            "min_minutes": MIN_PERMISSION_MINUTES,
            "max_minutes": MAX_PERMISSION_MINUTES,
        },
        # The clinic's own date, so a browser with the wrong day set cannot offer a picker
        # starting on the wrong tomorrow.
        "today": clinic_today(),
    }


@router.get("/requests")
async def my_requests(
    year: Optional[str] = Query(None),
    user: V3UserOut = Depends(v3_current_user),
):
    """Everything this person has asked for in a year, and what it adds up to.

    A year rather than a month, because leave is counted in years everywhere it is counted
    at all -- "how many days have I taken" is not a question about September.

    The totals count approved requests only. A pending leave is not time off yet, and
    putting it in the same figure would tell somebody they had spent days they may still be
    refused.
    """
    text = str(year or "").strip() or clinic_today()[:4]
    if not (text.isdigit() and len(text) == 4):
        raise HTTPException(status_code=400, detail="year must be four digits")

    emp = await _my_employee(user)
    if not emp:
        return _empty_year(text)

    rows = await v3_col("approvals").find(
        {
            "employee_id": emp["id"],
            "kind": {"$in": list(SELF_SERVICE_KINDS)},
            "from_date": {"$gte": f"{text}-01-01", "$lte": f"{text}-12-31"},
        },
        {"_id": 0},
    ).sort("from_date", -1).to_list(500)

    approved = [r for r in rows if r.get("status") == APPROVED]
    return {
        "year": text,
        "linked": True,
        "employee_name": emp.get("full_name") or "",
        "employee_code": emp.get("employee_code") or "",
        "requests": [_public_request(r) for r in rows],
        "counts": {s: len([r for r in rows if r.get("status") == s]) for s in (PENDING, APPROVED, REJECTED)},
        "taken": {
            "leave_days": sum(int(r.get("days") or 0) for r in approved if r.get("kind") == LEAVE_KIND),
            "permission_count": len([r for r in approved if r.get("kind") == PERMISSION_KIND]),
            "permission_minutes": sum(int(r.get("minutes") or 0) for r in approved if r.get("kind") == PERMISSION_KIND),
        },
        **_form_rules(),
    }


@router.post("/requests")
async def raise_request(payload: RequestCreate, user: V3UserOut = Depends(v3_current_user)):
    """Ask for leave or permission. Pending until HR says otherwise -- nothing self-approves.

    Backdating is allowed on purpose. Somebody who was ill on Monday files on Tuesday, and
    a form that refused them would only get a leave filed for the wrong day instead. What
    it will not take is a date so far ahead that it is a mistyped year.
    """
    kind = (payload.kind or LEAVE_KIND).strip()
    if kind not in SELF_SERVICE_KINDS:
        raise HTTPException(
            status_code=400,
            detail="You can raise leave or permission here. Anything else, ask HR to log it for you.",
        )
    emp = await _employee_or_400(user)

    reason = (payload.reason or "").strip()
    if not reason:
        # Required, unlike HR's own form. HR logging a request has already had the
        # conversation; a request that arrives on its own is read cold by whoever decides
        # it, and "no reason given" is not something anybody can decide on.
        raise HTTPException(status_code=400, detail="Say what this is for -- whoever decides it is reading it cold")

    # Every rule about shape -- real dates, a sane order, a permission that is neither a
    # break nor half a day -- is build_request's, so this asks for exactly what HR's own
    # form asks for and refuses it in the same words.
    row = build_request(
        emp,
        kind,
        from_date=payload.from_date or "",
        to_date=payload.to_date or "",
        from_time=payload.from_time or "",
        to_time=payload.to_time or "",
        reason=reason,
        requested_by=user.full_name,
        requested_by_user_id=user.id,
        source=SOURCE_SELF,
    )

    today = clinic_today()
    if row["from_date"][:4].isdigit() and int(row["from_date"][:4]) > int(today[:4]) + MAX_YEARS_AHEAD:
        raise HTTPException(status_code=400, detail="That date is more than a year away -- check the year")

    live = await v3_col("approvals").find(
        {"employee_id": emp["id"], "kind": LEAVE_KIND, "status": {"$in": [PENDING, APPROVED]}},
        {"_id": 0, "kind": 1, "status": 1, "from_date": 1, "to_date": 1},
    ).to_list(500)
    clash = _clashes(row, live)
    if clash:
        span = clash["from_date"] if clash["from_date"] == clash.get("to_date") else f"{clash['from_date']} to {clash['to_date']}"
        raise HTTPException(status_code=400, detail=f"You already have a {clash['status']} leave covering {span}")

    await v3_col("approvals").insert_one(row.copy())
    row.pop("_id", None)
    return _public_request(row)


@router.delete("/requests/{request_id}")
async def withdraw_request(request_id: str, user: V3UserOut = Depends(v3_current_user)):
    """Take back a request nobody has decided yet.

    Scoped to the requester's own employee record in the query itself rather than fetched
    and then checked -- an id belonging to somebody else simply does not match, so there is
    no path through here that deletes another person's request.
    """
    emp = await _employee_or_400(user)
    row = await v3_col("approvals").find_one(
        {"id": request_id, "employee_id": emp["id"]}, {"_id": 0, "status": 1}
    )
    if not row:
        raise HTTPException(status_code=404, detail="Request not found")
    if row.get("status") != PENDING:
        raise HTTPException(status_code=400, detail="This has already been decided. Ask HR if it needs changing.")
    await v3_col("approvals").delete_one({"id": request_id, "employee_id": emp["id"]})
    return {"deleted": True, "id": request_id, "withdrawn_at": now_iso()}
