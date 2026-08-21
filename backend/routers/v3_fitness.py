"""Fitness (gym) memberships, per branch — Branch Admin > Fitness.

The gym's own roll: who is a member, what they bought off the Fitness shelf, what they
have paid, and whether they are currently training, on leave, or gone.

Modelled on the Zumba desk next to it, and deliberately not folded into it. Zumba carries
a referral pipeline, masters who own a class roll, and a revenue share; the gym has none
of those — it has memberships that run out and need renewing. Sharing one collection would
mean every Zumba query filtering out gym rows and every gym query filtering out students,
and the first feature either one grew would have to be excluded from the other by hand.

What it does share is the branch scoping, because that rule is about who may read what and
should not have two answers in one OS.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
from datetime import date, datetime, timedelta
import uuid

from database import v3_col
from utils import now_iso
from deps import v3_require_roles, is_branch_admin_role
from schemas.v3 import V3UserOut

router = APIRouter(prefix="/api/v3")


# Where a member stands with the gym. "leave" is a pause, not an ending: the membership is
# still theirs and they are expected back, which is why it is counted apart from both the
# people training now and the people who have gone.
STATUS_ACTIVE = "active"
STATUS_LEAVE = "leave"
STATUS_DISCONTINUED = "discontinued"
STATUSES = (STATUS_ACTIVE, STATUS_LEAVE, STATUS_DISCONTINUED)

PAYMENT_MODES = ("cash", "upi", "card", "account_transfer")
# A cash payment has nothing to reference. The other three all produce a number worth
# keeping, which is what the reference field holds.
REFERENCE_MODES = ("upi", "card", "account_transfer")

# What each mode is called when a payment is read back to whoever handed it over.
PAYMENT_MODE_LABELS = {"cash": "Cash", "upi": "UPI", "card": "Card", "account_transfer": "Bank Transfer"}

# What to call the number behind each of those, so a refusal names the thing it wants
# rather than asking for a generic "reference" and leaving the desk to guess which.
REFERENCE_LABELS = {"upi": "UPI ID", "card": "transaction ID", "account_transfer": "transaction ID"}

GENDERS = ("female", "male", "other")


def _status(value) -> str:
    v = (value or "").strip().lower()
    return v if v in STATUSES else STATUS_ACTIVE


def _amount(value) -> float:
    """A money field as a number, never None and never negative.

    A blank box and a zero mean the same thing here — nothing collected — and letting one
    of them through as None would make every comparison against it fail silently.
    """
    try:
        n = float(value or 0)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, round(n, 2))


def _age(value) -> Optional[int]:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return None
    return n if 0 < n < 120 else None


def _own_branch_only(user: V3UserOut) -> bool:
    """Everyone but Super Admin reads one branch: their own.

    Same rule as the Zumba desk and the finance endpoints — a Branch Admin runs one gym.
    """
    return user.role != "super_admin" and is_branch_admin_role(user.role)


def _scoped_branch(user: V3UserOut, branch_id: Optional[str]) -> Optional[str]:
    if _own_branch_only(user):
        return user.branch_id
    return branch_id


async def _write_branch(user: V3UserOut, branch_id: Optional[str]) -> Optional[str]:
    """The branch a new membership is filed against."""
    target = _scoped_branch(user, branch_id)
    if not target:
        return None
    exists = await v3_col("branches").find_one({"id": target}, {"_id": 0, "id": 1})
    if not exists:
        # A stale id from a form left open writes a row nobody's board reads. Better to say
        # so than to file it somewhere invisible.
        raise HTTPException(status_code=400, detail="That branch no longer exists")
    return target


class FitnessInput(BaseModel):
    name: str
    phone: Optional[str] = ""
    age: Optional[int] = None
    gender: Optional[str] = ""
    email: Optional[str] = ""
    address: Optional[str] = ""
    # The membership bought off Services and Products > Fitness. The package's own name and
    # price are copied onto the row rather than looked up through the id, so renaming or
    # repricing the shelf cannot rewrite what this member was actually sold.
    package_id: Optional[str] = ""
    package_name: Optional[str] = ""
    package_mode: Optional[str] = ""
    package_sessions: Optional[int] = None
    fee_amount: Optional[float] = 0
    fee_paid: Optional[float] = 0
    # Only meaningful once something has been collected, and cleared when nothing has, so a
    # mode can never sit against a membership that has paid zero.
    payment_mode: Optional[str] = ""
    payment_reference: Optional[str] = ""
    joined_date: Optional[str] = ""      # YYYY-MM-DD
    # When the next payment is owed. A gym is sold by the month, so "who has not paid this
    # month" is a question about this date rather than about the balance alone — a member
    # who owes nothing until next month is not in arrears today.
    due_date: Optional[str] = ""         # YYYY-MM-DD
    status: Optional[str] = STATUS_ACTIVE
    notes: Optional[str] = ""


class FitnessStatusInput(BaseModel):
    status: str
    remarks: Optional[str] = ""


def _clean(payload: FitnessInput, *, check_paid: bool = True) -> dict:
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Member name is required")

    fee_amount = _amount(payload.fee_amount)
    fee_paid = _amount(payload.fee_paid)
    # Refused rather than clamped: a paid figure above the fee is a typo somewhere, and
    # quietly trimming it hides which of the two numbers was wrong.
    #
    # Skipped on an update, where the payload's figure is discarded in favour of what has
    # actually been collected — checking a number that is about to be thrown away would
    # reject an edit over a value the caller never sent.
    if check_paid and fee_paid > fee_amount:
        raise HTTPException(
            status_code=400,
            detail=f"Paid ({fee_paid:g}) is more than the fee ({fee_amount:g})",
        )

    mode = (payload.payment_mode or "").strip().lower()
    if mode and mode not in PAYMENT_MODES:
        raise HTTPException(status_code=400, detail="Unknown payment mode")
    # Nothing collected means no mode and no reference — otherwise a membership that has
    # paid zero reads as having been paid by cash.
    if fee_paid <= 0:
        mode = ""
    reference = (payload.payment_reference or "").strip() if mode in REFERENCE_MODES else ""

    gender = (payload.gender or "").strip().lower()
    if gender and gender not in GENDERS:
        gender = ""

    return {
        "name": name,
        "phone": (payload.phone or "").strip(),
        "age": _age(payload.age),
        "gender": gender,
        "email": (payload.email or "").strip(),
        "address": (payload.address or "").strip(),
        "package_id": (payload.package_id or "").strip(),
        "package_name": (payload.package_name or "").strip(),
        "package_mode": (payload.package_mode or "").strip().lower(),
        "package_sessions": payload.package_sessions,
        "fee_amount": fee_amount,
        "fee_paid": fee_paid,
        "payment_mode": mode,
        "payment_reference": reference,
        "joined_date": (payload.joined_date or "").strip()[:10],
        "due_date": (payload.due_date or "").strip()[:10],
        "status": _status(payload.status),
        "notes": (payload.notes or "").strip(),
        "updated_at": now_iso(),
    }


def _as_date(value):
    """A stored YYYY-MM-DD as a date, or None. Only the day matters: a membership taken out
    in the morning and one taken out at closing run out on the same day."""
    try:
        return datetime.strptime(str(value or "")[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


# How close to the end a membership has to be before the branch is offered a renewal. A
# week: near enough that the conversation is due, far enough that it is not being had in
# the doorway on the last day.
RENEWAL_WINDOW_DAYS = 7


def _shape(row: dict) -> dict:
    out = {k: v for k, v in row.items() if k != "_id"}
    amount = _amount(out.get("fee_amount"))
    paid = _amount(out.get("fee_paid"))
    out["fee_due"] = round(max(0.0, amount - paid), 2)
    # How much of the term is left, and whether that is little enough to be worth asking
    # about. Worked out here rather than in the browser so the tab and anything else
    # reading this row agree about when a renewal is due.
    ends = _as_date(out.get("due_date"))
    out["days_left"] = (ends - date.today()).days if ends else None
    out["renewal_due"] = bool(
        ends
        and _status(out.get("status")) != STATUS_DISCONTINUED
        and (ends - date.today()).days <= RENEWAL_WINDOW_DAYS
    )
    # Fully paid only counts when there was something to pay. A membership recorded with no
    # fee at all is not "paid up", it is unpriced, and calling it paid would hide it from
    # the very list meant to catch it.
    out["fully_paid"] = amount > 0 and paid >= amount
    return out


def _month_bounds(today: Optional[date] = None):
    d = today or date.today()
    start = d.replace(day=1)
    end = (start.replace(year=start.year + 1, month=1) if start.month == 12
           else start.replace(month=start.month + 1))
    return start.isoformat(), end.isoformat()


def _unpaid_this_month(row: dict, month_start: str, month_end: str) -> bool:
    """Whether this member owes money that is already due within the current month.

    Three things have to be true, and each excludes a case the branch would otherwise be
    chasing wrongly: there is a balance outstanding, the member is still with the gym (a
    discontinued membership is a write-off, not an arrear), and the money was due by the
    end of this month rather than at some point later.

    A membership with no due date recorded counts as due — the fee was agreed and nothing
    says it is owed later, so leaving it out would hide a genuine arrear behind an empty
    field.
    """
    if _amount(row.get("fee_paid")) >= _amount(row.get("fee_amount")):
        return False
    if _amount(row.get("fee_amount")) <= 0:
        return False
    if _status(row.get("status")) == STATUS_DISCONTINUED:
        return False
    due = (row.get("due_date") or "").strip()[:10]
    return (not due) or due < month_end


@router.get("/branch/fitness")
async def list_fitness(
    branch_id: Optional[str] = Query(None),
    user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin")),
):
    """The gym's roll for a branch, with the counts the tab's cards read.

    Counted here rather than in the browser so every card is over the whole roll, not over
    whichever page or filter happens to be on screen.
    """
    query: dict = {}
    scoped = _scoped_branch(user, branch_id)
    if scoped:
        query["branch_id"] = scoped

    rows = await v3_col("fitness_registrations").find(query, {"_id": 0}).to_list(2000)
    rows.sort(key=lambda r: r.get("created_at") or "", reverse=True)
    shaped = [_shape(r) for r in rows]

    month_start, month_end = _month_bounds()
    counts = {
        "all": len(shaped),
        # Two states, not three: a member is on the roll or they have gone. "leave" was
        # dropped from the board, so anybody still carrying it counts as on the roll —
        # the alternative is a row that belongs to neither card and is findable only
        # under All.
        "current": sum(1 for r in shaped if _status(r.get("status")) != STATUS_DISCONTINUED),
        "leave": sum(1 for r in shaped if _status(r.get("status")) == STATUS_LEAVE),
        "unpaid_this_month": sum(1 for r in rows if _unpaid_this_month(r, month_start, month_end)),
        "discontinued": sum(1 for r in shaped if _status(r.get("status")) == STATUS_DISCONTINUED),
        "paid": sum(1 for r in shaped if r.get("fully_paid")),
    }
    totals = {
        "fee_amount": round(sum(_amount(r.get("fee_amount")) for r in shaped), 2),
        "fee_paid": round(sum(_amount(r.get("fee_paid")) for r in shaped), 2),
    }
    totals["fee_due"] = round(max(0.0, totals["fee_amount"] - totals["fee_paid"]), 2)

    return {
        "registrations": shaped,
        "counts": counts,
        "totals": totals,
        "month_start": month_start,
        "statuses": list(STATUSES),
        "payment_modes": list(PAYMENT_MODES),
        "genders": list(GENDERS),
    }


async def _row_or_404(registration_id: str, user: V3UserOut) -> dict:
    row = await v3_col("fitness_registrations").find_one({"id": registration_id}, {"_id": 0})
    if not row:
        raise HTTPException(status_code=404, detail="Membership not found")
    # A Branch Admin reaching another branch's member by id is refused the same way the
    # list refuses to show it — a request is not a screen.
    if _own_branch_only(user) and row.get("branch_id") != user.branch_id:
        raise HTTPException(status_code=404, detail="Membership not found")
    return row


@router.post("/branch/fitness")
async def add_fitness(
    payload: FitnessInput,
    branch_id: Optional[str] = Query(None),
    user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin")),
):
    target = await _write_branch(user, branch_id)
    if not target:
        raise HTTPException(status_code=400, detail="Pick a branch to register against")

    row = {
        "id": str(uuid.uuid4()),
        "branch_id": target,
        **_clean(payload),
        "created_at": now_iso(),
        "created_by": user.full_name or user.email,
    }
    await v3_col("fitness_registrations").insert_one(dict(row))
    return _shape(row)


@router.patch("/branch/fitness/{registration_id}")
async def update_fitness(
    registration_id: str,
    payload: FitnessInput,
    user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin")),
):
    row = await _row_or_404(registration_id, user)
    updates = _clean(payload, check_paid=False)

    # What has been collected is not editable here. It moves through /collect, which records
    # how each payment arrived — the mode, the reference, the notes counted, who took it and
    # when. Letting a fee be typed over on this form would move the balance with none of
    # that behind it, and the two would then disagree about the same money.
    #
    # Held back rather than trusted from the payload: the form no longer sends these, and a
    # missing field would otherwise $set the collected total to zero.
    collected = _amount(row.get("fee_paid"))
    updates["fee_paid"] = collected
    updates["payment_mode"] = row.get("payment_mode", "")
    updates["payment_reference"] = row.get("payment_reference", "")

    # Refused rather than left inconsistent: a fee below what has already been taken makes
    # the membership overpaid, and there is no way to read that as anything but an error.
    # Refunding is a payment problem, not a rename.
    if collected > _amount(updates.get("fee_amount")):
        raise HTTPException(
            status_code=400,
            detail=f"{collected:g} has already been collected — the fee cannot be set below that",
        )

    await v3_col("fitness_registrations").update_one({"id": registration_id}, {"$set": updates})
    row = await v3_col("fitness_registrations").find_one({"id": registration_id}, {"_id": 0})
    return _shape(row)


@router.patch("/branch/fitness/{registration_id}/status")
async def set_fitness_status(
    registration_id: str,
    payload: FitnessStatusInput,
    user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin")),
):
    """Move a member between training, on leave, and gone.

    Its own endpoint rather than a field on the edit form: pausing somebody is one decision
    taken on its own, and making it require the whole membership to be re-submitted is how
    a fee gets changed by accident while marking somebody on leave.
    """
    row = await _row_or_404(registration_id, user)
    status = (payload.status or "").strip().lower()
    if status not in STATUSES:
        raise HTTPException(status_code=400, detail=f"Status must be one of {list(STATUSES)}")

    await v3_col("fitness_registrations").update_one(
        {"id": registration_id},
        {"$set": {
            "status": status,
            "status_remarks": (payload.remarks or "").strip(),
            "status_changed_at": now_iso(),
            "status_changed_by": user.full_name or user.email,
            "updated_at": now_iso(),
        }},
    )
    updated = await v3_col("fitness_registrations").find_one({"id": registration_id}, {"_id": 0})
    return {"message": f"{row.get('name', 'Member')} marked {status}", "registration": _shape(updated)}


@router.delete("/branch/fitness/{registration_id}")
async def delete_fitness(
    registration_id: str,
    user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin")),
):
    row = await _row_or_404(registration_id, user)
    await v3_col("fitness_registrations").delete_one({"id": registration_id})
    return {"message": f"{row.get('name', 'Membership')} removed"}


# ------------------------------------------------------------------ Collecting the fee
#
# A membership is not always paid in one go or in one way: a member hands over two thousand
# in cash and sends the rest by UPI, and the branch needs both halves recorded against the
# same membership rather than one of them typed over the other.
#
# So a collection is a list of lines, each with its own mode. What it adds up to is what
# went on the balance, and the lines stay on the row as a record of how it was taken.


# The notes a gym fee is actually handed over in, largest first -- which is the order a
# drawer is emptied in. The same four the Zumba desk takes: the 2000 is out of circulation,
# and nobody counts a membership out in fives, tens or twenties.
#
# Anything not listed here is dropped when a payment is settled, so a count in a note this
# desk does not take cannot quietly become part of the total. A payment recorded before this
# keeps whatever it was counted in -- the list governs what may be entered, not what has
# already happened.
DENOMINATIONS = (500, 200, 100, 50)


class PaymentLine(BaseModel):
    mode: str
    amount: Optional[float] = 0
    reference: Optional[str] = ""
    # Cash only: how many of each note. Keyed by the note's value as a string, because that
    # is what survives a JSON round trip.
    denominations: Optional[dict] = None


class CollectPaymentInput(BaseModel):
    lines: List[PaymentLine]
    note: Optional[str] = ""


def _denomination_total(raw) -> tuple:
    """What a pile of notes comes to, and the tidied count behind it.

    Anything that is not a note this counter holds, or not a positive whole number of them,
    is dropped rather than guessed at — a "3.5 x 500" is a typo, and turning it into 1750
    would put a figure in the drawer nobody counted.
    """
    if not isinstance(raw, dict):
        return 0.0, {}
    clean: dict = {}
    total = 0.0
    for note in DENOMINATIONS:
        for key in (str(note), note):
            if key in raw:
                try:
                    count = int(raw[key])
                except (TypeError, ValueError):
                    count = 0
                if count > 0:
                    clean[str(note)] = count
                    total += note * count
                break
    return round(total, 2), clean


def _month_after(start: date, months: int = 1) -> date:
    """The same day, that many months on, clamping rather than spilling.

    A term beginning on the 31st ends on the 30th of a thirty-day month, not on the 1st of
    the one after -- which is a date nobody recognises as their own membership.
    """
    year = start.year + (start.month - 1 + months) // 12
    month = (start.month - 1 + months) % 12 + 1
    day = start.day
    while day > 28:
        try:
            return date(year, month, day)
        except ValueError:
            day -= 1
    return date(year, month, day)


class FitnessRenewInput(BaseModel):
    """A fresh term on an existing membership."""
    package_id: Optional[str] = ""
    package_name: Optional[str] = ""
    package_sessions: Optional[int] = None
    fee_amount: Optional[float] = 0
    months: Optional[int] = 1
    lines: Optional[List[PaymentLine]] = None


@router.post("/branch/fitness/{registration_id}/renew")
async def renew_fitness(
    registration_id: str,
    payload: FitnessRenewInput,
    user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin")),
):
    """Sell the same member another term.

    The new term runs on from the end of the old one rather than from the day the button is
    pressed. A member who renews a week early has paid for those days and should not lose
    them; one who renews late does not get to backdate the gap -- so it is whichever of the
    two is later.

    What they owe accumulates rather than being replaced, and the payment taken now is
    appended to the same list of lines the membership already carries. The balance answers
    "is this member square with us", and resetting it every term would let an unpaid one
    disappear behind a renewal.

    Renewing puts them back on the roll: somebody who has just bought another month has not
    left the gym, whatever the row said a minute ago.
    """
    row = await _row_or_404(registration_id, user)

    charged = _amount(payload.fee_amount)
    if charged <= 0:
        raise HTTPException(status_code=400, detail="What does this term cost?")
    months = max(1, int(payload.months or 1))

    cleaned = []
    total = 0.0
    for line in payload.lines or []:
        mode = (line.mode or "").strip().lower()
        if mode not in PAYMENT_MODES:
            raise HTTPException(status_code=400, detail=f"Unknown payment mode: {line.mode}")
        note_total, counted = _denomination_total(line.denominations)
        amount = note_total if (mode == "cash" and counted) else _amount(line.amount)
        if amount <= 0:
            continue
        reference = (line.reference or "").strip()
        if mode in REFERENCE_MODES and not reference:
            raise HTTPException(status_code=400, detail=f"Enter the {REFERENCE_LABELS[mode]}")
        cleaned.append({
            "mode": mode,
            "amount": amount,
            "reference": reference if mode in REFERENCE_MODES else "",
            "denominations": counted if mode == "cash" else {},
        })
        total += amount
    total = round(total, 2)
    if total > charged:
        raise HTTPException(status_code=400, detail=f"That is {total:g} against a {charged:g} term")

    today = date.today()
    current_end = _as_date(row.get("due_date"))
    term_start = max(current_end, today) if current_end else today
    changes = {
        "package_id": (payload.package_id or "").strip(),
        "package_name": (payload.package_name or "").strip(),
        "package_sessions": payload.package_sessions,
        "due_date": _month_after(term_start, months).isoformat(),
        "fee_amount": round(_amount(row.get("fee_amount")) + charged, 2),
        "fee_paid": round(_amount(row.get("fee_paid")) + total, 2),
        "status": STATUS_ACTIVE,
        "updated_at": now_iso(),
    }
    entry = {
        "id": str(uuid.uuid4()),
        "amount": total,
        "lines": cleaned,
        "note": f"Renewed to {changes['due_date']}",
        "collected_at": now_iso(),
        "collected_by": user.full_name or user.email,
    }
    update = {"$set": changes}
    if cleaned:
        update["$push"] = {"payments": entry}
    await v3_col("fitness_registrations").update_one({"id": registration_id}, update)

    updated = await v3_col("fitness_registrations").find_one({"id": registration_id}, {"_id": 0})
    shaped = _shape(updated)
    summary = f"Renewed {row.get('name', 'the member')} to {changes['due_date']}"
    summary += f". {shaped['fee_due']:g} still due" if shaped["fee_due"] > 0 else ". Paid up"
    return {"message": summary, "registration": shaped}


@router.post("/branch/fitness/{registration_id}/collect")
async def collect_fitness_payment(
    registration_id: str,
    payload: CollectPaymentInput,
    user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin")),
):
    """Take a payment against a membership, in one mode or several.

    The lines are the record of how it was taken; their sum is what moves the balance. Both
    are kept: a total alone cannot answer "how much of today came in as cash", and lines
    without a total would have to be re-added every time the balance is read.
    """
    row = await _row_or_404(registration_id, user)

    fee_amount = _amount(row.get("fee_amount"))
    already = _amount(row.get("fee_paid"))
    outstanding = round(max(0.0, fee_amount - already), 2)
    if fee_amount <= 0:
        raise HTTPException(status_code=400, detail="Set this membership's fee before collecting against it")
    if outstanding <= 0:
        raise HTTPException(status_code=400, detail="This membership is already paid up")

    cleaned = []
    total = 0.0
    for line in payload.lines or []:
        mode = (line.mode or "").strip().lower()
        if mode not in PAYMENT_MODES:
            raise HTTPException(status_code=400, detail=f"Unknown payment mode: {line.mode}")

        note_total, counted = _denomination_total(line.denominations)
        # Counted notes settle the figure rather than sitting beside it. Two numbers that
        # can disagree is one number nobody can trust, and the count is the one somebody
        # actually looked at.
        amount = note_total if (mode == "cash" and counted) else _amount(line.amount)
        if amount <= 0:
            continue

        cleaned.append({
            "mode": mode,
            "amount": amount,
            "reference": (line.reference or "").strip() if mode in REFERENCE_MODES else "",
            "denominations": counted if mode == "cash" else {},
        })
        total += amount

    total = round(total, 2)
    if not cleaned or total <= 0:
        raise HTTPException(status_code=400, detail="Enter an amount to collect")
    # Refused rather than capped: taking more than is owed means one of the figures is
    # wrong, and silently keeping the change hides which.
    if total > outstanding:
        raise HTTPException(
            status_code=400,
            detail=f"That is {total:g} against {outstanding:g} outstanding",
        )

    entry = {
        "id": str(uuid.uuid4()),
        "amount": total,
        "lines": cleaned,
        "note": (payload.note or "").strip(),
        "collected_at": now_iso(),
        "collected_by": user.full_name or user.email,
    }

    new_paid = round(already + total, 2)
    # The mode on the membership stays the one it was last paid by, and reads "split" when a
    # single collection came in more than one way — a row that says "cash" for a payment
    # half of which arrived by UPI is worse than one that says it was split.
    last_mode = cleaned[0]["mode"] if len(cleaned) == 1 else "split"
    last_reference = cleaned[0]["reference"] if len(cleaned) == 1 else ""

    await v3_col("fitness_registrations").update_one(
        {"id": registration_id},
        {
            "$set": {
                "fee_paid": new_paid,
                "payment_mode": last_mode,
                "payment_reference": last_reference,
                "updated_at": now_iso(),
            },
            "$push": {"payments": entry},
        },
    )

    updated = await v3_col("fitness_registrations").find_one({"id": registration_id}, {"_id": 0})
    shaped = _shape(updated)
    # The sentence the branch reads back to the member, built here so the board and any
    # other caller say the same thing about the same payment.
    parts = ", ".join(f"{PAYMENT_MODE_LABELS.get(l['mode'], l['mode'])} {l['amount']:g}" for l in cleaned)
    summary = f"Collected {total:g} from {row.get('name', 'member')} — {parts}"
    if shaped["fee_due"] > 0:
        summary += f". {shaped['fee_due']:g} still due"
    else:
        summary += ". Paid up"

    return {"message": summary, "payment": entry, "registration": shaped}
