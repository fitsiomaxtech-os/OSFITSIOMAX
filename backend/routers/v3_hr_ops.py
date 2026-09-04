"""HR's running month: attendance, approvals, payroll, and the quote board.

Four desks that share one set of records. They are written together because they are not
independent of each other -- an approved leave is an attendance mark, and attendance is
what payroll pro-rates a salary against -- and keeping them apart would have meant three
copies of the rule that decides whether a day is paid.

The chain runs one way, so each desk can be read without knowing the next:

    Approvals  ->  Attendance  ->  Payroll

An approved leave writes the days it covers into attendance as `leave`; attendance's
loss-of-pay days are what payroll deducts. Nothing runs backwards: deleting a payroll run
leaves attendance alone, and revoking an approval only clears the marks that approval put
there (see `_clear_leave_marks`).

One thing feeds in from outside that chain: the hours each person is rostered on, set per
login in Super Admin -> Credentials. The register reads them to say how late a check-in
was -- see _shift_by_employee -- and reports that beside the mark rather than instead of
it. What the clock says and what HR decided about it are two different facts, and payroll
still reads only the second.

Lives beside routers/v3_hr.py rather than inside it. Same URL prefix -- these are all
/api/v3/hr to whoever is calling -- but that file is the org's *structure* (who exists,
what department they sit in, what they may log in to), which changes when the company
changes shape, and this one is the month, which changes every day.

Salary figures pass through here. Every endpoint is Super Admin or HR, the same two who
can already read `net_salary` off the employee record in the Employees tab.
"""

import calendar
import uuid
from datetime import date, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from database import v3_col
from deps import v3_current_user, is_hr_role
from schemas.v3 import V3UserOut
from utils import clinic_today, now_iso
# The hours Super Admin rosters an account on in Credentials. The register reads them;
# routers/v3_hr.py writes them. See work_timing.py for why the rules live apart from
# both -- "late" has to mean the same thing on the screen that sets a shift and on the
# one that measures a day against it.
from work_timing import LATE_GRACE_MINUTES, WORK_TIMING_FIELDS, is_rostered, late_by, timing_of

router = APIRouter(prefix="/api/v3/hr")


# ---------- who may work these desks ----------

# Reading the month and marking it are the same job: an HR Admin who can see the register
# is the person who fills it in. Split gates would have meant an HR Admin watching a screen
# they cannot act on, which is not a permission, it is a tease.
#
# is_hr_role rather than a literal "hr_admin": this install's HR role was typed by hand in
# Credentials and its slug is whatever wording was used. That predicate already answers
# this question for the recruitment board -- see deps.py -- and it returns True for
# super_admin, so both desks are covered by the one call.
async def require_hr(user: V3UserOut = Depends(v3_current_user)) -> V3UserOut:
    if not is_hr_role(user.role):
        raise HTTPException(status_code=403, detail="Not allowed")
    return user


# ---------- the day, and whether it is paid ----------

PRESENT = "present"
LATE = "late"
HALF_DAY = "half_day"
ABSENT = "absent"
LEAVE = "leave"
WEEK_OFF = "week_off"
HOLIDAY = "holiday"

ATTENDANCE_STATUSES = (PRESENT, LATE, HALF_DAY, ABSENT, LEAVE, WEEK_OFF, HOLIDAY)

# What each mark costs the person in pay, in days.
#
# Late is 0 on purpose. It is a punctuality fact, counted and shown on its own, not a pay
# cut -- docking someone for arriving at 09:12 is a decision a company makes deliberately,
# not one a default should make on its behalf. Leave is 0 too: an approved leave is paid
# leave here, and an unpaid one is marked `absent`, which is the honest name for it.
LOP_DAYS = {
    PRESENT: 0.0,
    LATE: 0.0,
    LEAVE: 0.0,
    WEEK_OFF: 0.0,
    HOLIDAY: 0.0,
    HALF_DAY: 0.5,
    ABSENT: 1.0,
}


def _valid_date(value: str, field: str = "date") -> str:
    """A YYYY-MM-DD that is a real calendar date, or a 400 naming the field."""
    try:
        return date.fromisoformat(str(value or "").strip()).isoformat()
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{field} must be a date, as YYYY-MM-DD")


def _valid_month(value: str) -> str:
    """A YYYY-MM, or a 400. Blank means the month the clinic is in now."""
    text = str(value or "").strip()
    if not text:
        return clinic_today()[:7]
    _valid_date(f"{text}-01", "month")
    return text


def _month_span(month: str) -> tuple:
    """(first day, last day, number of days) for a YYYY-MM."""
    year, mon = int(month[:4]), int(month[5:7])
    days = calendar.monthrange(year, mon)[1]
    return f"{month}-01", f"{month}-{days:02d}", days


def _dates_between(start: str, end: str) -> List[str]:
    a, b = date.fromisoformat(start), date.fromisoformat(end)
    return [(a + timedelta(days=n)).isoformat() for n in range((b - a).days + 1)]


# ---------- the clock each person is rostered on ----------


async def _shift_by_employee() -> Dict[str, Dict[str, str]]:
    """Each employee's rostered clock, read off the login account that belongs to them.

    The timing is set against the account, in Credentials, because that is the screen that
    lists everyone who signs in. The register is drawn against the employee record. The
    employee_id on the account is the join between the two, and someone with no account --
    or an account nobody has rostered yet -- simply has no shift here, which the register
    shows as "no timing set" rather than as an on-time arrival at midnight.
    """
    fields = {"_id": 0, "employee_id": 1, **{f: 1 for f in WORK_TIMING_FIELDS}}
    rows = await v3_col("users").find({"employee_id": {"$nin": [None, ""]}}, fields).to_list(2000)
    out: Dict[str, Dict[str, str]] = {}
    for r in rows:
        timing = timing_of(r)
        # An account with nothing set is not an answer, and skipping it lets a second
        # account on the same employee -- one person, two logins -- be the one that
        # carries the hours.
        if not is_rostered(timing):
            continue
        out.setdefault(r["employee_id"], timing)
    return out


# ---------- attendance ----------

class AttendanceMark(BaseModel):
    employee_id: str
    status: str
    check_in: Optional[str] = ""
    check_out: Optional[str] = ""
    note: Optional[str] = ""


class AttendanceDay(BaseModel):
    date: str
    entries: List[AttendanceMark]


async def _roster() -> List[Dict[str, Any]]:
    """The people a register is drawn for: everyone currently on the books.

    Inactive employees are left out rather than shown greyed. Someone who has left does
    not have days to mark, and a register that lists them invites a mark that would then
    have to be reasoned about at payroll time.
    """
    fields = {
        "_id": 0, "id": 1, "full_name": 1, "employee_code": 1, "department": 1,
        "designation": 1, "photo_url": 1, "gross_salary": 1, "net_salary": 1,
    }
    rows = await v3_col("employees").find({"status": "active"}, fields).to_list(1000)
    return sorted(rows, key=lambda e: str(e.get("full_name") or "").lower())


@router.get("/attendance")
async def attendance_day(
    day: Optional[str] = Query(None, alias="date"),
    _: V3UserOut = Depends(require_hr),
):
    """The register for one day: every active employee, with their mark if they have one.

    Unmarked is its own answer, not an absence. A day nobody has filled in yet reads as
    blank rather than as everybody being away, because the second is a claim about people
    that nobody made.
    """
    on = _valid_date(day) if day else clinic_today()
    roster = await _roster()
    marks = await v3_col("attendance").find({"date": on}, {"_id": 0}).to_list(2000)
    by_emp = {m["employee_id"]: m for m in marks}
    shifts = await _shift_by_employee()

    rows = []
    summary = {s: 0 for s in ATTENDANCE_STATUSES}
    summary["unmarked"] = 0
    # Arrivals past the rostered login, counted separately from the `late` mark. The two
    # answer different questions -- this one is what the clock says, that one is what HR
    # decided about it -- and a day where they disagree is worth being able to see.
    summary["late_by_clock"] = 0
    summary["unrostered"] = 0
    for e in roster:
        m = by_emp.get(e["id"]) or {}
        status = m.get("status") or ""
        shift = shifts.get(e["id"]) or timing_of({})
        late = late_by(shift, m.get("check_in") or "")
        if late > LATE_GRACE_MINUTES:
            summary["late_by_clock"] += 1
        if not is_rostered(shift):
            summary["unrostered"] += 1
        rows.append({
            "employee_id": e["id"],
            "full_name": e.get("full_name") or "",
            "employee_code": e.get("employee_code") or "",
            "department": e.get("department") or "",
            "designation": e.get("designation") or "",
            "photo_url": e.get("photo_url") or "",
            "status": status,
            "check_in": m.get("check_in") or "",
            "check_out": m.get("check_out") or "",
            "note": m.get("note") or "",
            # Marks an approval wrote are shown as locked, so nobody quietly overwrites a
            # leave that was signed off and then wonders why payroll disagrees with them.
            "locked": bool(m.get("approval_id")),
            "marked_by": m.get("marked_by") or "",
            # The hours this person is rostered on, so the register is filled in against
            # what was expected rather than from memory. All four keys are always here,
            # blank where nobody has set them.
            "shift": shift,
            "late_by_minutes": late,
            "is_late": late > LATE_GRACE_MINUTES,
        })
        summary[status if status in summary else "unmarked"] += 1

    return {
        "date": on,
        "today": clinic_today(),
        "rows": rows,
        "summary": summary,
        "late_grace_minutes": LATE_GRACE_MINUTES,
    }


@router.post("/attendance")
async def mark_attendance(payload: AttendanceDay, user: V3UserOut = Depends(require_hr)):
    """Save a day's marks. One row per employee per day, replaced rather than appended.

    The whole day is posted at once because that is how it is filled in -- a register is
    worked down in one sitting -- and one call means the screen cannot end up half saved.
    Which is also why every status is checked before the first write: a bad one found
    half way down would otherwise leave the day part-written and the screen showing a
    failure over marks that had in fact been stored.
    """
    on = _valid_date(payload.date)
    if on > clinic_today():
        raise HTTPException(status_code=400, detail="That day hasn't happened yet")

    known = {e["id"] for e in await _roster()}
    # Marks an approval wrote are not HR's to edit here. Changing one would put the
    # register and the decision that produced it into disagreement, with payroll reading
    # whichever it found -- so the approval is the place to change it, and revoking there
    # removes the mark (see _clear_leave_marks).
    locked = {
        r["employee_id"]
        for r in await v3_col("attendance").find(
            {"date": on, "approval_id": {"$nin": [None, ""]}}, {"_id": 0, "employee_id": 1}
        ).to_list(2000)
    }

    writable, skipped = [], 0
    for entry in payload.entries:
        if entry.employee_id not in known:
            continue
        if entry.employee_id in locked:
            skipped += 1
            continue
        status = (entry.status or "").strip()
        if status and status not in ATTENDANCE_STATUSES:
            raise HTTPException(status_code=400, detail=f"Unknown attendance status: {status}")
        writable.append((entry, status))

    shifts = await _shift_by_employee()
    saved, cleared, late = 0, 0, 0
    for entry, status in writable:
        # Clearing a mark is a real action -- it is how a wrong entry is taken back -- so
        # an empty status deletes the row rather than storing "" as an eighth status.
        if not status:
            res = await v3_col("attendance").delete_one({"date": on, "employee_id": entry.employee_id})
            cleared += res.deleted_count
            continue
        check_in = (entry.check_in or "").strip()
        # Worked out here and stored, not left to be recomputed on every read: the roster
        # can change next month, and how late somebody was on a day that has already been
        # marked is a fact about that day rather than about the hours they are on now.
        late_minutes = late_by(shifts.get(entry.employee_id) or {}, check_in)
        if late_minutes > LATE_GRACE_MINUTES:
            late += 1
        await v3_col("attendance").update_one(
            {"date": on, "employee_id": entry.employee_id},
            {
                "$set": {
                    "status": status,
                    "check_in": check_in,
                    "check_out": (entry.check_out or "").strip(),
                    "note": (entry.note or "").strip(),
                    "late_by_minutes": late_minutes,
                    "marked_by": user.full_name,
                    "marked_at": now_iso(),
                },
                "$setOnInsert": {"id": str(uuid.uuid4()), "date": on, "employee_id": entry.employee_id},
            },
            upsert=True,
        )
        saved += 1

    return {"date": on, "saved": saved, "cleared": cleared, "locked_skipped": skipped, "late_by_clock": late}


async def _month_marks(month: str) -> Dict[str, Dict[str, float]]:
    """Per-employee counts of each status across a month, keyed by employee id."""
    start, end, _ = _month_span(month)
    rows = await v3_col("attendance").find(
        {"date": {"$gte": start, "$lte": end}}, {"_id": 0, "employee_id": 1, "status": 1}
    ).to_list(50000)
    tally: Dict[str, Dict[str, float]] = {}
    for r in rows:
        emp = tally.setdefault(r["employee_id"], {s: 0 for s in ATTENDANCE_STATUSES})
        if r.get("status") in emp:
            emp[r["status"]] += 1
    return tally


@router.get("/attendance/month")
async def attendance_month(
    month: Optional[str] = Query(None),
    _: V3UserOut = Depends(require_hr),
):
    """The month at a glance: each employee's counts, and their days lost to pay."""
    mon = _valid_month(month)
    _, _, days = _month_span(mon)
    tally = await _month_marks(mon)
    roster = await _roster()
    rows = []
    for e in roster:
        counts = tally.get(e["id"]) or {s: 0 for s in ATTENDANCE_STATUSES}
        marked = sum(counts.values())
        rows.append({
            "employee_id": e["id"],
            "full_name": e.get("full_name") or "",
            "employee_code": e.get("employee_code") or "",
            "department": e.get("department") or "",
            **counts,
            "marked": marked,
            "unmarked": max(days - marked, 0),
            "lop_days": round(sum(counts[s] * LOP_DAYS[s] for s in ATTENDANCE_STATUSES), 2),
        })
    return {"month": mon, "days_in_month": days, "rows": rows}


# ---------- approvals ----------

LEAVE_KIND = "leave"
KINDS = (LEAVE_KIND, "comp_off", "advance", "expense", "other")
# The three states a request is ever in. There is no "cancelled": a request withdrawn
# before anybody looked at it is deleted, and one already decided stays on the record.
PENDING, APPROVED, REJECTED = "pending", "approved", "rejected"


class ApprovalCreate(BaseModel):
    employee_id: str
    kind: str = LEAVE_KIND
    from_date: Optional[str] = ""
    to_date: Optional[str] = ""
    amount: Optional[float] = 0
    reason: Optional[str] = ""


class ApprovalDecision(BaseModel):
    decision: str
    note: Optional[str] = ""


async def _employee_or_404(emp_id: str) -> Dict[str, Any]:
    emp = await v3_col("employees").find_one({"id": emp_id}, {"_id": 0})
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    return emp


async def _apply_leave_marks(row: dict, by: str) -> int:
    """Write an approved leave into the register, and say how many days it covered.

    An approval that does not reach attendance is a note in a drawer: payroll reads the
    register, so a leave signed off here has to land there or the person is paid as though
    nobody decided anything. The marks carry `approval_id`, which is what makes them
    locked on the register and removable again if the decision is taken back.

    A day already marked something else is left alone -- if HR wrote `present` for the
    12th, they were there on the 12th, and a leave approved afterwards does not undo that.
    """
    if row.get("kind") != LEAVE_KIND or not row.get("from_date") or not row.get("to_date"):
        return 0
    written = 0
    for day in _dates_between(row["from_date"], row["to_date"]):
        existing = await v3_col("attendance").find_one({"date": day, "employee_id": row["employee_id"]}, {"_id": 0})
        if existing:
            continue
        await v3_col("attendance").insert_one({
            "id": str(uuid.uuid4()),
            "date": day,
            "employee_id": row["employee_id"],
            "status": LEAVE,
            "check_in": "", "check_out": "",
            "note": (row.get("reason") or "")[:200],
            "approval_id": row["id"],
            "marked_by": by,
            "marked_at": now_iso(),
        })
        written += 1
    return written


async def _clear_leave_marks(approval_id: str) -> int:
    """Take back only the marks this approval wrote. Anything HR typed by hand stays."""
    res = await v3_col("attendance").delete_many({"approval_id": approval_id})
    return res.deleted_count


@router.get("/approvals")
async def list_approvals(
    status: Optional[str] = Query(None),
    kind: Optional[str] = Query(None),
    _: V3UserOut = Depends(require_hr),
):
    query: Dict[str, Any] = {}
    if status in (PENDING, APPROVED, REJECTED):
        query["status"] = status
    if kind in KINDS:
        query["kind"] = kind
    rows = await v3_col("approvals").find(query, {"_id": 0}).sort("requested_at", -1).to_list(1000)
    counts = {s: await v3_col("approvals").count_documents({"status": s}) for s in (PENDING, APPROVED, REJECTED)}
    return {"approvals": rows, "counts": counts}


@router.post("/approvals")
async def create_approval(payload: ApprovalCreate, user: V3UserOut = Depends(require_hr)):
    kind = (payload.kind or LEAVE_KIND).strip()
    if kind not in KINDS:
        raise HTTPException(status_code=400, detail=f"Unknown request type: {kind}")
    emp = await _employee_or_404(payload.employee_id)

    row: Dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "employee_id": emp["id"],
        # Denormalised so the list reads without a second query per row, and so a request
        # decided last year still names the person as they were on the record then.
        "employee_name": emp.get("full_name") or "",
        "employee_code": emp.get("employee_code") or "",
        "department": emp.get("department") or "",
        "kind": kind,
        "from_date": "", "to_date": "", "days": 0,
        "amount": round(float(payload.amount or 0), 2),
        "reason": (payload.reason or "").strip(),
        "status": PENDING,
        "requested_by": user.full_name,
        "requested_at": now_iso(),
        "decided_by": "", "decided_at": "", "decision_note": "",
    }

    if kind in (LEAVE_KIND, "comp_off"):
        if not payload.from_date:
            raise HTTPException(status_code=400, detail="Pick the dates this covers")
        start = _valid_date(payload.from_date, "from_date")
        end = _valid_date(payload.to_date or payload.from_date, "to_date")
        if end < start:
            raise HTTPException(status_code=400, detail="The last day can't be before the first")
        row.update({"from_date": start, "to_date": end, "days": len(_dates_between(start, end))})
    elif kind in ("advance", "expense") and row["amount"] <= 0:
        raise HTTPException(status_code=400, detail="Enter the amount being asked for")

    await v3_col("approvals").insert_one(row.copy())
    row.pop("_id", None)
    return row


@router.patch("/approvals/{approval_id}")
async def decide_approval(
    approval_id: str,
    payload: ApprovalDecision,
    user: V3UserOut = Depends(require_hr),
):
    """Approve or reject, or send a decided request back to pending.

    Reversible on purpose. A leave approved onto the wrong person is caught on the
    register, not in the request list, and the fix has to undo the marks it wrote -- so
    every path through here settles the attendance side as well as the status.
    """
    decision = (payload.decision or "").strip()
    if decision not in (APPROVED, REJECTED, PENDING):
        raise HTTPException(status_code=400, detail="Decision must be approved, rejected or pending")
    row = await v3_col("approvals").find_one({"id": approval_id}, {"_id": 0})
    if not row:
        raise HTTPException(status_code=404, detail="Request not found")

    marks = 0
    if decision == APPROVED:
        marks = await _apply_leave_marks(row, user.full_name)
    else:
        marks = -(await _clear_leave_marks(approval_id))

    await v3_col("approvals").update_one({"id": approval_id}, {"$set": {
        "status": decision,
        "decided_by": user.full_name if decision != PENDING else "",
        "decided_at": now_iso() if decision != PENDING else "",
        "decision_note": (payload.note or "").strip(),
    }})
    updated = await v3_col("approvals").find_one({"id": approval_id}, {"_id": 0})
    return {**updated, "attendance_days_changed": marks}


@router.delete("/approvals/{approval_id}")
async def delete_approval(approval_id: str, _: V3UserOut = Depends(require_hr)):
    cleared = await _clear_leave_marks(approval_id)
    res = await v3_col("approvals").delete_one({"id": approval_id})
    if not res.deleted_count:
        raise HTTPException(status_code=404, detail="Request not found")
    return {"deleted": True, "attendance_days_cleared": cleared}


# ---------- payroll ----------

DRAFT, FINALISED, PAID = "draft", "finalised", "paid"
# One way only. A month that has been paid is a fact about money that left the account,
# so it does not go back to draft -- correcting it means an adjustment in the next run,
# the way an accountant would do it.
RUN_FLOW = {DRAFT: (FINALISED,), FINALISED: (DRAFT, PAID), PAID: ()}


class PayrollGenerate(BaseModel):
    month: Optional[str] = ""


class SlipAdjust(BaseModel):
    bonus: Optional[float] = None
    deduction: Optional[float] = None
    note: Optional[str] = None


class RunStatus(BaseModel):
    status: str


def _monthly_base(emp: dict) -> float:
    """What a full month pays this person.

    Gross first, net as the fallback. Most records here carry only one of the two, and a
    base of 0 would quietly print a payslip for nothing -- which reads as a bug in the
    payroll rather than as the missing salary figure it actually is. Which one was used
    is reported on the slip as `base_from`, so a surprising figure can be traced to the
    employee record it came from.
    """
    gross = float(emp.get("gross_salary") or 0)
    return gross if gross > 0 else float(emp.get("net_salary") or 0)


def _compute_slip(emp: dict, counts: Dict[str, float], days: int, bonus: float, deduction: float) -> dict:
    """One employee's line for the month.

    Pro-rated on calendar days, which is the method that makes a month's pay independent
    of how many Sundays fell in it: a day of loss of pay costs base/days, whether the
    month is 28 long or 31.

    Days nobody marked are paid. The alternative -- treating silence as absence -- would
    dock somebody's salary because HR was busy, so the count is carried onto the slip as
    `unmarked_days` for the run to show, and the money stays with the employee until
    somebody actually marks the day.
    """
    base = _monthly_base(emp)
    lop = round(sum(counts.get(s, 0) * LOP_DAYS[s] for s in ATTENDANCE_STATUSES), 2)
    payable_days = round(max(days - lop, 0), 2)
    earned = round(base * payable_days / days, 2) if days else 0.0
    marked = sum(counts.get(s, 0) for s in ATTENDANCE_STATUSES)
    return {
        "employee_id": emp["id"],
        "employee_name": emp.get("full_name") or "",
        "employee_code": emp.get("employee_code") or "",
        "department": emp.get("department") or "",
        "designation": emp.get("designation") or "",
        "base": round(base, 2),
        "base_from": "gross_salary" if float(emp.get("gross_salary") or 0) > 0 else "net_salary",
        "days_in_month": days,
        "present_days": counts.get(PRESENT, 0) + counts.get(LATE, 0),
        "leave_days": counts.get(LEAVE, 0),
        "absent_days": counts.get(ABSENT, 0),
        "half_days": counts.get(HALF_DAY, 0),
        "unmarked_days": max(days - marked, 0),
        "lop_days": lop,
        "payable_days": payable_days,
        "earned": earned,
        "bonus": round(bonus, 2),
        "deduction": round(deduction, 2),
        "net_payable": round(earned + bonus - deduction, 2),
    }


async def _run_or_none(month: str) -> Optional[dict]:
    return await v3_col("payroll_runs").find_one({"month": month}, {"_id": 0})


def _totals(slips: List[dict]) -> dict:
    return {
        "employees": len(slips),
        "gross": round(sum(s["earned"] for s in slips), 2),
        "bonus": round(sum(s["bonus"] for s in slips), 2),
        "deduction": round(sum(s["deduction"] for s in slips), 2),
        "net_payable": round(sum(s["net_payable"] for s in slips), 2),
        "lop_days": round(sum(s["lop_days"] for s in slips), 2),
        "unmarked_days": sum(s["unmarked_days"] for s in slips),
    }


@router.get("/payroll")
async def payroll_month(
    month: Optional[str] = Query(None),
    _: V3UserOut = Depends(require_hr),
):
    """A month's payroll: the saved run if there is one, a live preview if there isn't.

    A month nobody has generated still answers, computed from the register as it stands
    right now, and says so via `run: null`. That is what makes the screen useful before
    the month ends -- what payroll would come to today, if it ran today -- without a
    half-finished run sitting in the database claiming to be a record.
    """
    mon = _valid_month(month)
    run = await _run_or_none(mon)
    if run:
        slips = await v3_col("payslips").find({"month": mon}, {"_id": 0}).to_list(2000)
        slips.sort(key=lambda s: str(s.get("employee_name") or "").lower())
        return {"month": mon, "run": run, "slips": slips, "totals": _totals(slips), "preview": False}

    _, _, days = _month_span(mon)
    tally = await _month_marks(mon)
    slips = [_compute_slip(e, tally.get(e["id"]) or {}, days, 0.0, 0.0) for e in await _roster()]
    return {"month": mon, "run": None, "slips": slips, "totals": _totals(slips), "preview": True}


@router.post("/payroll/generate")
async def generate_payroll(payload: PayrollGenerate, user: V3UserOut = Depends(require_hr)):
    """Freeze the month into a run of payslips, or refresh a draft against the register.

    Regenerating a draft keeps the adjustments already typed onto it -- a bonus entered
    on Tuesday survives Wednesday's regeneration -- because the reason to regenerate is
    almost always that attendance moved, not that the adjustments were wrong.
    """
    mon = _valid_month(payload.month)
    run = await _run_or_none(mon)
    if run and run.get("status") != DRAFT:
        raise HTTPException(status_code=400, detail=f"{mon} is {run['status']} — reopen it before regenerating")

    existing = {s["employee_id"]: s for s in await v3_col("payslips").find({"month": mon}, {"_id": 0}).to_list(2000)}
    _, _, days = _month_span(mon)
    tally = await _month_marks(mon)
    roster = await _roster()

    slips = []
    for emp in roster:
        prior = existing.get(emp["id"]) or {}
        slip = _compute_slip(
            emp, tally.get(emp["id"]) or {}, days,
            float(prior.get("bonus") or 0), float(prior.get("deduction") or 0),
        )
        slip.update({
            "id": prior.get("id") or str(uuid.uuid4()),
            "month": mon,
            "note": prior.get("note") or "",
        })
        slips.append(slip)

    await v3_col("payslips").delete_many({"month": mon})
    if slips:
        await v3_col("payslips").insert_many([s.copy() for s in slips])

    row = {
        "id": (run or {}).get("id") or str(uuid.uuid4()),
        "month": mon,
        "status": DRAFT,
        "days_in_month": days,
        "totals": _totals(slips),
        "generated_by": user.full_name,
        "generated_at": now_iso(),
        "paid_at": (run or {}).get("paid_at") or "",
    }
    await v3_col("payroll_runs").update_one({"month": mon}, {"$set": row}, upsert=True)
    slips.sort(key=lambda s: str(s.get("employee_name") or "").lower())
    return {"month": mon, "run": row, "slips": slips, "totals": row["totals"], "preview": False}


@router.patch("/payroll/{month}/slips/{employee_id}")
async def adjust_slip(
    month: str,
    employee_id: str,
    payload: SlipAdjust,
    _: V3UserOut = Depends(require_hr),
):
    """A bonus, a deduction or a note against one person's line. Draft runs only."""
    mon = _valid_month(month)
    run = await _run_or_none(mon)
    if not run:
        raise HTTPException(status_code=404, detail=f"No payroll run for {mon} yet")
    if run.get("status") != DRAFT:
        raise HTTPException(status_code=400, detail=f"{mon} is {run['status']} — reopen it to make changes")
    slip = await v3_col("payslips").find_one({"month": mon, "employee_id": employee_id}, {"_id": 0})
    if not slip:
        raise HTTPException(status_code=404, detail="No payslip for that employee this month")

    bonus = float(slip.get("bonus") or 0) if payload.bonus is None else round(float(payload.bonus), 2)
    deduction = float(slip.get("deduction") or 0) if payload.deduction is None else round(float(payload.deduction), 2)
    if bonus < 0 or deduction < 0:
        raise HTTPException(status_code=400, detail="Amounts can't be negative — a negative bonus is a deduction")

    updates = {
        "bonus": bonus,
        "deduction": deduction,
        "net_payable": round(float(slip.get("earned") or 0) + bonus - deduction, 2),
    }
    if payload.note is not None:
        updates["note"] = payload.note.strip()
    await v3_col("payslips").update_one({"month": mon, "employee_id": employee_id}, {"$set": updates})

    slips = await v3_col("payslips").find({"month": mon}, {"_id": 0}).to_list(2000)
    totals = _totals(slips)
    await v3_col("payroll_runs").update_one({"month": mon}, {"$set": {"totals": totals}})
    return {"slip": {**slip, **updates}, "totals": totals}


@router.post("/payroll/{month}/status")
async def set_run_status(month: str, payload: RunStatus, user: V3UserOut = Depends(require_hr)):
    mon = _valid_month(month)
    run = await _run_or_none(mon)
    if not run:
        raise HTTPException(status_code=404, detail=f"No payroll run for {mon} yet")
    want = (payload.status or "").strip()
    if want not in RUN_FLOW:
        raise HTTPException(status_code=400, detail="Unknown payroll status")
    if want not in RUN_FLOW[run.get("status", DRAFT)]:
        raise HTTPException(status_code=400, detail=f"A {run.get('status')} run can't move to {want}")

    updates = {"status": want}
    if want == PAID:
        updates.update({"paid_at": now_iso(), "paid_by": user.full_name})
    await v3_col("payroll_runs").update_one({"month": mon}, {"$set": updates})
    return {**run, **updates}


# ---------- quotes ----------

MAX_QUOTE = 400


class QuoteInput(BaseModel):
    text: Optional[str] = None
    author: Optional[str] = None
    active: Optional[bool] = None
    pinned: Optional[bool] = None


def _pick_for_today(quotes: List[dict], on: str) -> Optional[dict]:
    """Which of the active quotes is today's.

    A pin wins. Otherwise the day picks one, by counting days since the epoch and taking
    that position in the list -- so it changes every morning on its own and shows the same
    quote to everyone who looks on the same day, with nobody having to post one. Sorted by
    id first so the rotation does not reshuffle when a quote is edited.
    """
    live = [q for q in quotes if q.get("active", True)]
    if not live:
        return None
    pinned = next((q for q in live if q.get("pinned")), None)
    if pinned:
        return pinned
    live.sort(key=lambda q: q["id"])
    return live[date.fromisoformat(on).toordinal() % len(live)]


@router.get("/quotes")
async def list_quotes(_: V3UserOut = Depends(require_hr)):
    quotes = await v3_col("hr_quotes").find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    today = clinic_today()
    return {"quotes": quotes, "today": _pick_for_today(quotes, today), "date": today}


@router.get("/quotes/today")
async def quote_of_the_day(_: V3UserOut = Depends(v3_current_user)):
    """Today's quote, for anybody logged in.

    Open to every role deliberately: a quote board that only HR can see is a noticeboard
    facing a wall. This is the endpoint any staff-facing screen reads to show it.
    """
    quotes = await v3_col("hr_quotes").find({"active": True}, {"_id": 0}).to_list(500)
    today = clinic_today()
    return {"date": today, "quote": _pick_for_today(quotes, today)}


@router.post("/quotes")
async def add_quote(payload: QuoteInput, user: V3UserOut = Depends(require_hr)):
    text = (payload.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Write the quote first")
    if len(text) > MAX_QUOTE:
        raise HTTPException(status_code=400, detail=f"Keep it under {MAX_QUOTE} characters")
    if await v3_col("hr_quotes").find_one({"text": text}, {"_id": 0}):
        raise HTTPException(status_code=400, detail="That quote is already on the board")

    row = {
        "id": str(uuid.uuid4()),
        "text": text,
        "author": (payload.author or "").strip(),
        "active": True if payload.active is None else bool(payload.active),
        "pinned": False,
        "added_by": user.full_name,
        "created_at": now_iso(),
    }
    await v3_col("hr_quotes").insert_one(row.copy())
    row.pop("_id", None)
    return row


@router.patch("/quotes/{quote_id}")
async def update_quote(quote_id: str, payload: QuoteInput, _: V3UserOut = Depends(require_hr)):
    row = await v3_col("hr_quotes").find_one({"id": quote_id}, {"_id": 0})
    if not row:
        raise HTTPException(status_code=404, detail="Quote not found")

    updates: Dict[str, Any] = {}
    if payload.text is not None:
        text = payload.text.strip()
        if not text:
            raise HTTPException(status_code=400, detail="A quote can't be empty")
        if len(text) > MAX_QUOTE:
            raise HTTPException(status_code=400, detail=f"Keep it under {MAX_QUOTE} characters")
        updates["text"] = text
    if payload.author is not None:
        updates["author"] = payload.author.strip()
    if payload.active is not None:
        updates["active"] = bool(payload.active)
        # An inactive quote can't be the pinned one -- that would pin the board to
        # something it has been told not to show, and today's quote would come back empty.
        if not updates["active"]:
            updates["pinned"] = False
    if payload.pinned is not None:
        updates["pinned"] = bool(payload.pinned)
        if updates["pinned"]:
            # One pin, so pinning is a choice of quote rather than a growing set of them.
            await v3_col("hr_quotes").update_many({"id": {"$ne": quote_id}}, {"$set": {"pinned": False}})
            updates["active"] = True

    if updates:
        await v3_col("hr_quotes").update_one({"id": quote_id}, {"$set": updates})
    return {**row, **updates}


@router.delete("/quotes/{quote_id}")
async def delete_quote(quote_id: str, _: V3UserOut = Depends(require_hr)):
    res = await v3_col("hr_quotes").delete_one({"id": quote_id})
    if not res.deleted_count:
        raise HTTPException(status_code=404, detail="Quote not found")
    return {"deleted": True}
