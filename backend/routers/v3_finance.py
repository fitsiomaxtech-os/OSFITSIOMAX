import re
import uuid
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException
from typing import Optional

from database import v3_col
from deps import v3_require_roles, is_branch_admin_role
from schemas.v3 import V3UserOut, V3MarkInstallmentPaidInput
from stage_utils import entry_branch_stage_names
from utils import generate_transaction_id


def _now():
    return datetime.now(timezone.utc).isoformat()

router = APIRouter(prefix="/api/v3")


@router.get("/branch/finance")
async def get_branch_finance(
    fee_type: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    search: Optional[str] = None,
    branch_id: Optional[str] = None,
    user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin", "accountant")),
):
    # Branch Admin is always locked to their own branch. Super Admin and Accountant can
    # optionally scope to one branch_id — or, if none is passed, see every branch
    # aggregated together (Accountant's default view: all branches' finance at once).
    if is_branch_admin_role(user.role):
        branch_id = user.branch_id
        if not branch_id:
            return {"summary": {}, "transactions": []}

    base_query = {"branch_id": branch_id} if branch_id else {}

    consultation_query = {**base_query, "consultation_fee": {"$gt": 0}}
    package_query = {**base_query, "package_paid": {"$gt": 0}}

    consultation_leads = await v3_col("leads").find(consultation_query, {"_id": 0}).to_list(2000)
    package_leads = await v3_col("leads").find(package_query, {"_id": 0}).to_list(2000)

    total_consultation = sum(l.get("consultation_fee", 0) for l in consultation_leads)
    total_package = sum(l.get("package_paid", 0) for l in package_leads)

    all_branch_leads = await v3_col("leads").find(base_query, {"_id": 0}).to_list(2000)
    # Both modes' entry stages, since this list spans branches under either Lead Control —
    # a lead still sitting where it landed hasn't been worked yet and owes nothing.
    untouched_stages = {None} | await entry_branch_stage_names()
    leads_with_no_fee = [l for l in all_branch_leads if (l.get("consultation_fee") or 0) == 0 and l.get("branch_stage") not in untouched_stages]
    pending_count = len(leads_with_no_fee)

    # Per-branch breakdown — only meaningfully populated when viewing more than one
    # branch at once (Accountant's default, or Super Admin leaving branch_id unset),
    # but cheap to compute always since all_branch_leads is already in memory.
    branch_ids = list({l["branch_id"] for l in all_branch_leads if l.get("branch_id")})
    branch_docs = await v3_col("branches").find(
        {"id": {"$in": branch_ids}}, {"_id": 0, "id": 1, "branch_name": 1}
    ).to_list(500)
    branch_name_map = {b["id"]: b.get("branch_name", "") for b in branch_docs}

    by_branch_acc = {}
    for l in all_branch_leads:
        bid = l.get("branch_id")
        if not bid:
            continue
        acc = by_branch_acc.setdefault(bid, {
            "branch_id": bid,
            "branch_name": branch_name_map.get(bid, "Unknown"),
            "consultation_total": 0.0,
            "package_total": 0.0,
            "total_patients": 0,
        })
        acc["consultation_total"] += l.get("consultation_fee") or 0
        acc["package_total"] += l.get("package_paid") or 0
        acc["total_patients"] += 1
    by_branch = sorted(by_branch_acc.values(), key=lambda r: -(r["consultation_total"] + r["package_total"]))
    for r in by_branch:
        r["total_revenue"] = r["consultation_total"] + r["package_total"]

    summary = {
        "total_revenue": total_consultation + total_package,
        "consultation_total": total_consultation,
        "consultation_count": len(consultation_leads),
        "package_total": total_package,
        "package_count": len(package_leads),
        "pending_count": pending_count,
        "total_patients": len(all_branch_leads),
        "by_branch": by_branch,
    }

    activity_query = {"action": {"$in": ["consultation_paid", "package_payment_collected"]}}
    lead_ids = [l["id"] for l in all_branch_leads]
    if lead_ids:
        activity_query["lead_id"] = {"$in": lead_ids}

    activities = await v3_col("lead_activity").find(activity_query, {"_id": 0}).sort("created_at", -1).to_list(2000)

    lead_map = {l["id"]: l for l in all_branch_leads}

    transactions = []
    for act in activities:
        lead = lead_map.get(act.get("lead_id"), {})
        details = act.get("details", "")

        is_consultation = "consultation" in details.lower()
        is_package = "package" in details.lower()

        amount = 0.0
        weeks = None
        try:
            amt_part = details.split("Rs.")[1] if "Rs." in details else ""
            amt_str = amt_part.split(" ")[0].split("(")[0].strip()
            amount = float(amt_str)
        except (IndexError, ValueError):
            pass

        if "weeks" in details.lower():
            try:
                weeks_part = details.split("(")[1].split("weeks")[0].strip() if "(" in details else ""
                weeks = int(weeks_part)
            except (IndexError, ValueError):
                pass

        tx_type = "package" if is_package else "consultation"

        if fee_type and fee_type != "all" and tx_type != fee_type:
            continue

        if start_date and act.get("created_at", "") < start_date:
            continue
        if end_date and act.get("created_at", "") > end_date + "T23:59:59":
            continue

        if search:
            q = search.lower()
            name = lead.get("name", "").lower()
            phone = lead.get("phone", "").lower()
            if q not in name and q not in phone:
                continue

        transactions.append({
            "id": act.get("id", ""),
            # The readable id printed on the patient's receipt. Empty on collections taken
            # before this existed, so every reader has to tolerate a blank.
            "transaction_id": act.get("transaction_id") or "",
            "lead_id": act.get("lead_id", ""),
            "patient_name": lead.get("name", "Unknown"),
            "patient_phone": lead.get("phone", ""),
            "fee_type": tx_type,
            "amount": amount,
            "package_weeks": weeks,
            "collected_by": act.get("created_by", ""),
            "collected_at": act.get("created_at", ""),
            "branch_stage": lead.get("branch_stage", ""),
            "branch_name": branch_name_map.get(lead.get("branch_id"), ""),
        })

    return {"summary": summary, "transactions": transactions}


# ---------- AC Overview > Total Revenue (Super Admin / Accountant) ----------

# "session" = Treatment Fee (the multi-visit Session Package collected after Consultation
# Fee); everything else collected at/around the consultation itself is "consultation".
REVENUE_ACTIONS = ["consultation_paid", "package_sold", "package_payment_collected", "treatment_fee_collected", "diet_fee_collected", "fee_collected"]

# The Consultation Fee itself: the actions that mean "this patient paid to be seen today".
# Deliberately narrower than _revenue_category(...) == "consultation", which is a reporting
# bucket that also holds the Diet Consultation Fee. Spot joining keys off THIS set — a diet
# fee taken on the same day as a treatment fee is not evidence the patient signed up on the
# spot, and folding it in would inflate spot joining with unrelated same-day payments.
CONSULTATION_FEE_ACTIONS = {"consultation_paid", "package_sold", "package_payment_collected", "fee_collected"}


def _revenue_category(action: str) -> str:
    """Which revenue line a payment belongs to: consultation, session, or diet.

    Diet has its own line rather than sitting inside consultation. It is a separate
    service sold at its own price by its own clinician, and a branch reporting on it
    cannot answer "how much did diet bring in" if it is folded into the consultation
    figure. Anything not named here is consultation, which keeps every older action
    reporting exactly where it always did.
    """
    if action == "treatment_fee_collected":
        return "session"
    if action == "diet_fee_collected":
        return "diet"
    return "consultation"


def _parse_rs_amount(details: str) -> float:
    try:
        amt_part = details.split("Rs.")[1] if "Rs." in details else ""
        amt_str = amt_part.split(" ")[0].split("(")[0].strip()
        return float(amt_str)
    except (IndexError, ValueError):
        return 0.0


def _parse_payment_mode(details: str) -> str:
    m = re.search(r"\bvia (\w+)", details, re.IGNORECASE)
    return m.group(1).lower() if m else "unknown"


def _installment_status(inst: dict, today: str) -> str:
    if inst.get("paid"):
        return "paid"
    due = inst.get("due_date")
    if due and due < today:
        return "overdue"
    if due and due == today:
        return "due_today"
    return "upcoming"


def _treatment_installments(lead: dict) -> list:
    """A Treatment Fee installment schedule exists whenever the record has one —
    whether it came from choosing 'Partial Payment' outright, or from collecting
    Cash/UPI/Card/Cheque for only some of the package's sessions right now (the
    remaining sessions get scheduled the same way). Keyed off the data shape
    itself rather than the stored payment_mode, so both paths share every
    downstream balance/schedule/status calculation for free."""
    return (lead.get("treatment_fee_payment_details") or {}).get("installments") or []


def _lead_outstanding_balance(lead: dict) -> float:
    """Total still owed by this client across everything on their record: the
    Consultation Fee's assigned price if it hasn't been collected yet at all,
    plus every Treatment Fee installment not yet marked paid. Once a Consultation
    Fee payment has been confirmed (even at a Branch-Admin-negotiated discount
    below the assigned price), it's settled in full — the discount is a
    deliberate decision, not money still owed."""
    balance = 0.0
    if lead.get("package_id") and lead.get("package_paid") is None:
        balance += lead.get("package_price") or 0
    installments = _treatment_installments(lead)
    if installments:
        balance += sum(i.get("amount", 0) for i in installments if not i.get("paid"))
    return round(balance, 2)


def _lead_payment_progress(lead: dict) -> Optional[dict]:
    """For a Partial Payment treatment fee — what Collections tables' Due Date /
    Due Amount / Paid Amount columns show: the next unpaid installment (its date
    and amount, whether it's overdue or just upcoming), plus the total already
    paid. None of the fields apply once every installment is settled."""
    installments = _treatment_installments(lead)
    if not installments:
        return None
    paid_amount = sum(i.get("amount", 0) for i in installments if i.get("paid"))
    unpaid = sorted((i for i in installments if not i.get("paid")), key=lambda i: i.get("due_date", ""))
    next_due = unpaid[0] if unpaid else None
    return {
        "paid_amount": round(paid_amount, 2),
        "due_date": next_due.get("due_date") if next_due else None,
        "due_amount": round(next_due["amount"], 2) if next_due else None,
    }


def _lead_outstanding_detail(lead: dict, today: str) -> dict:
    """Outstanding Amount table — full bill/paid/balance picture per client, plus
    the next due date (from the Partial Payment schedule, if any) and a status
    badge: overdue (past due date), due_soon (due within 3 days), or partial
    (owes money but nothing scheduled yet / due further out)."""
    # A confirmed Consultation Fee (even at a negotiated discount) is fully
    # settled -- its "bill" for outstanding-balance purposes is whatever was
    # actually collected, not the original assigned price.
    package_paid = lead.get("package_paid")
    total_bill = package_paid if package_paid is not None else (lead.get("package_price") or 0)
    paid_amount = package_paid or 0
    due_date = None
    next_installment_number = None

    installments = _treatment_installments(lead)
    if installments:
        total_bill += sum(i.get("amount", 0) for i in installments)
        paid_amount += sum(i.get("amount", 0) for i in installments if i.get("paid"))
        unpaid = sorted((i for i in installments if not i.get("paid")), key=lambda i: i.get("due_date", ""))
        if unpaid:
            due_date = unpaid[0].get("due_date")
            next_installment_number = installments.index(unpaid[0]) + 1
    elif lead.get("treatment_fee_paid"):
        total_bill += lead.get("treatment_fee_paid") or 0
        paid_amount += lead.get("treatment_fee_paid") or 0

    balance = round(max(total_bill - paid_amount, 0), 2)
    due_soon_cutoff = (datetime.fromisoformat(today).date() + timedelta(days=3)).isoformat()

    if due_date and due_date < today:
        status = "overdue"
    elif due_date and due_date <= due_soon_cutoff:
        status = "due_soon"
    else:
        status = "partial"

    return {
        "total_bill": round(total_bill, 2),
        "paid_amount": round(paid_amount, 2),
        "balance": balance,
        "due_date": due_date,
        "status": status,
        "next_installment_number": next_installment_number,
    }


def _lead_session_summary(lead: dict) -> dict:
    """Session Collections — the Treatment Fee / session package side only (not
    the Consultation package): its label, total fee, what's been paid, what's
    still due, and a paid/partial/pending status badge."""
    sessions = lead.get("session_package_sessions") or lead.get("package_sessions")
    package_name = lead.get("session_package_name") or lead.get("package_name")
    label = f"{sessions} Sessions" if sessions else (package_name or "—")

    total = 0.0
    paid = 0.0
    next_installment_number = None
    installments = _treatment_installments(lead)
    if installments:
        total = sum(i.get("amount", 0) for i in installments)
        paid = sum(i.get("amount", 0) for i in installments if i.get("paid"))
        unpaid = sorted((i for i in installments if not i.get("paid")), key=lambda i: i.get("due_date", ""))
        if unpaid:
            next_installment_number = installments.index(unpaid[0]) + 1
    elif lead.get("treatment_fee_paid"):
        total = lead.get("treatment_fee_paid") or 0
        paid = total

    due = round(max(total - paid, 0), 2)
    if total > 0 and due <= 0:
        status = "paid"
    elif paid > 0:
        status = "partial"
    else:
        status = "pending"

    return {
        "package_label": label,
        "total": round(total, 2),
        "paid": round(paid, 2),
        "due": due,
        "status": status,
        "next_installment_number": next_installment_number,
    }


def _empty_day(day: str) -> dict:
    """One day's revenue row, with every line seeded. Both loops that build these use it,
    so a row can never be missing the key the other loop is about to add to."""
    return {"date": day, "consultation": 0.0, "session": 0.0, "diet": 0.0, "store": 0.0}


def _empty_branch(bid, bname: str) -> dict:
    return {
        "branch_id": bid, "branch_name": bname,
        "consultation_total": 0.0, "session_total": 0.0, "diet_total": 0.0, "store_total": 0.0,
    }


@router.get("/finance/revenue-overview")
async def revenue_overview(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    branch_id: Optional[str] = None,
    user: V3UserOut = Depends(v3_require_roles("super_admin", "accountant", "branch_admin")),
):
    """AC Overview > Total Revenue, and Accountant Manage (Super Admin's per-branch
    view and Branch Admin's own read-only tab) — date-range + branch scoped, built
    from the lead_activity payment trail (the only place these collections carry a
    real timestamp) rather than summing lead fields, which have no date dimension."""
    if is_branch_admin_role(user.role):
        branch_id = user.branch_id
    today = datetime.now(timezone.utc).date().isoformat()
    lead_query = {"branch_id": branch_id} if branch_id else {}
    leads = await v3_col("leads").find(lead_query, {"_id": 0}).to_list(20000)
    lead_ids = [l["id"] for l in leads]
    lead_branch_map = {l["id"]: l.get("branch_id") for l in leads}
    lead_name_map = {l["id"]: l.get("name", "Unknown") for l in leads}
    lead_phone_map = {l["id"]: l.get("phone", "") for l in leads}
    lead_balance_map = {l["id"]: _lead_outstanding_balance(l) for l in leads}
    lead_progress_map = {l["id"]: _lead_payment_progress(l) for l in leads}
    lead_session_map = {l["id"]: _lead_session_summary(l) for l in leads}
    lead_first_installment_map = {
        l["id"]: ((l.get("treatment_fee_payment_details") or {}).get("installments") or [{}])[0].get("amount")
        for l in leads if l.get("treatment_fee_payment_mode") == "partial"
    }

    branch_docs = await v3_col("branches").find({}, {"_id": 0, "id": 1, "branch_name": 1}).to_list(500)
    branch_name_map = {b["id"]: b.get("branch_name", "") for b in branch_docs}

    activity_query = {"action": {"$in": REVENUE_ACTIONS}}
    if lead_ids:
        activity_query["lead_id"] = {"$in": lead_ids}
    date_query = {}
    if start_date:
        date_query["$gte"] = start_date
    if end_date:
        date_query["$lte"] = end_date + "T23:59:59"
    if date_query:
        activity_query["created_at"] = date_query

    activities = await v3_col("lead_activity").find(activity_query, {"_id": 0}).sort("created_at", 1).to_list(20000)

    consultation_total = 0.0
    session_total = 0.0
    diet_total = 0.0
    by_day = {}
    by_branch_acc = {}
    payment_modes = {}
    transactions = []

    for act in activities:
        details = act.get("details", "")
        amount = _parse_rs_amount(details)
        category = _revenue_category(act.get("action", ""))
        mode = _parse_payment_mode(details)
        if category == "session" and mode == "partial":
            # The activity log's Rs. figure is the Partial Payment schedule's total,
            # not what was actually collected at that moment — only the first
            # installment is ever collected here (later ones via mark-paid, which
            # logs no new activity), so the real amount lives on the lead itself.
            first_amount = lead_first_installment_map.get(act.get("lead_id"))
            if first_amount is not None:
                amount = first_amount
        day = (act.get("created_at") or "")[:10]
        bid = lead_branch_map.get(act.get("lead_id"))
        bname = branch_name_map.get(bid, "Unknown")

        if category == "session":
            session_total += amount
        elif category == "diet":
            diet_total += amount
        else:
            consultation_total += amount

        # Every category is seeded on both of the setdefaults below, here and in the store
        # loop — `d[category] += amount` needs the key to exist whichever loop created the
        # day, and a day with only store sales in it would otherwise KeyError the moment an
        # activity row landed on it.
        d = by_day.setdefault(day, _empty_day(day))
        d[category] += amount

        b = by_branch_acc.setdefault(bid or "unknown", _empty_branch(bid, bname))
        b[f"{category}_total"] += amount

        payment_modes[mode] = payment_modes.get(mode, 0.0) + amount

        progress = lead_progress_map.get(act.get("lead_id"))
        session = lead_session_map.get(act.get("lead_id")) or {}
        # The listed price and what was taken off it, both written onto the activity by
        # v3_packages when the collection was confirmed. `discount` was hardcoded to zero
        # here, so nothing downstream could see a negotiated price at all.
        #
        # gross stays what was actually collected — every total, day, branch and payment
        # mode on this payload is summed from it — so the discount rides alongside rather
        # than redefining it. discount_amount is negative when more than the listed fee was
        # collected; it is passed through as-is and left to the caller to read.
        discount_amount = act.get("discount_amount")
        transactions.append({
            "id": act.get("id", ""),
            "transaction_id": act.get("transaction_id") or "",
            "date": act.get("created_at", ""),
            "branch_name": bname,
            "source": category,
            "gross": amount,
            "discount": float(discount_amount) if discount_amount is not None else 0.0,
            "original_amount": act.get("original_amount"),
            "discount_reason": act.get("discount_reason"),
            "tax": 0.0,
            "net": amount,
            "collected_by": act.get("created_by", ""),
            "lead_id": act.get("lead_id", ""),
            "client_name": lead_name_map.get(act.get("lead_id"), "Unknown"),
            "phone": lead_phone_map.get(act.get("lead_id"), ""),
            "payment_mode": mode,
            "client_balance": lead_balance_map.get(act.get("lead_id"), 0.0),
            "payment_paid_amount": progress["paid_amount"] if progress else None,
            "payment_due_amount": progress["due_amount"] if progress else None,
            "payment_due_date": progress["due_date"] if progress else None,
            "session_package_label": session.get("package_label"),
            "session_total": session.get("total"),
            "session_paid": session.get("paid"),
            "session_due": session.get("due"),
            "session_status": session.get("status"),
        })

    # Fitsiomax Store counter sales — tablets, supplements and equipment handed over the
    # desk. They come from their own ledger rather than the lead activity trail because a
    # walk-in buying a strip of painkillers is not a lead, and inventing a lead to make the
    # money countable would put a patient record behind every sale. Same money either way,
    # so it belongs in the same total.
    store_query = {"kind": "sale"}
    if branch_id:
        store_query["branch_id"] = branch_id
    if date_query:
        store_query["created_at"] = date_query
    store_sales = await v3_col("inventory_movements").find(store_query, {"_id": 0}).sort("created_at", -1).to_list(5000)

    store_total = 0.0
    for sale in store_sales:
        amount = float(sale.get("amount") or 0)
        store_total += amount
        bid = sale.get("branch_id")
        bname = branch_name_map.get(bid, "Unknown")
        day = (sale.get("created_at") or "")[:10]
        mode = sale.get("payment_mode") or "unknown"

        d = by_day.setdefault(day, _empty_day(day))
        d["store"] = d.get("store", 0.0) + amount

        b = by_branch_acc.setdefault(bid or "unknown", _empty_branch(bid, bname))
        b["store_total"] = b.get("store_total", 0.0) + amount

        payment_modes[mode] = payment_modes.get(mode, 0.0) + amount

        transactions.append({
            "id": sale.get("id", ""),
            "transaction_id": sale.get("transaction_id") or "",
            "date": sale.get("created_at", ""),
            "branch_name": bname,
            "source": "store",
            # Which Store shelf it came off, and what was actually handed over. Nothing
            # else in this payload carries an item, so the Store Payment tab reads these
            # and every other tab ignores them.
            "store_category": sale.get("category", ""),
            "item_name": sale.get("item_name", ""),
            "qty": sale.get("qty", 0),
            "gross": amount,
            # Genuinely zero, not unset: a counter sale is rung up at the shelf price and
            # has no negotiated-fee concept. Carried anyway so both halves of this list
            # have one shape.
            "discount": 0.0,
            "original_amount": None,
            "discount_reason": None,
            "tax": 0.0,
            "net": amount,
            "collected_by": sale.get("by_user_name", ""),
            # No lead: a counter sale is to whoever was standing there. Left empty rather
            # than faked, so the client-history eye and the Payment Paid roll-up — both
            # keyed on a lead — skip these instead of opening on nothing.
            "lead_id": "",
            "client_name": (sale.get("customer_name") or "").strip() or "Counter sale",
            "phone": "",
            "payment_mode": mode,
            "client_balance": 0.0,
        })

    total_collected = consultation_total + session_total + diet_total + store_total
    trend = sorted(by_day.values(), key=lambda r: r["date"])
    for r in trend:
        r["total"] = r["consultation"] + r["session"] + r["diet"] + r["store"]
    for r in by_branch_acc.values():
        r["total_revenue"] = r["consultation_total"] + r["session_total"] + r["diet_total"] + r["store_total"]
    by_branch = sorted(by_branch_acc.values(), key=lambda r: -r["total_revenue"])

    untouched_stages = {None} | await entry_branch_stage_names()
    pending_leads_raw = [
        l for l in leads
        if not (l.get("consultation_fee") or l.get("package_paid") or l.get("treatment_fee_paid"))
        and l.get("branch_stage") not in untouched_stages
    ]
    pending_count = len(pending_leads_raw)
    pending_leads = [
        {
            "lead_id": l["id"],
            "client_name": l.get("name", "Unknown"),
            "phone": l.get("phone", ""),
            "branch_name": branch_name_map.get(l.get("branch_id"), ""),
            "stage": l.get("branch_stage") or "—",
        }
        for l in pending_leads_raw
    ]

    # Accountant Manage > Outstanding Amount — every client who still owes something,
    # and > Payment Schedules — every Partial Payment installment (paid or not), so
    # the accountant can see the whole schedule per client, not just what's due.
    outstanding_clients = []
    payment_schedule = []
    for l in leads:
        balance = lead_balance_map.get(l["id"], 0.0)
        if balance > 0:
            detail = _lead_outstanding_detail(l, today)
            outstanding_clients.append({
                "lead_id": l["id"],
                "client_name": l.get("name", "Unknown"),
                "phone": l.get("phone", ""),
                "email": l.get("email", ""),
                "branch_name": branch_name_map.get(l.get("branch_id"), ""),
                "balance": detail["balance"],
                "total_bill": detail["total_bill"],
                "paid_amount": detail["paid_amount"],
                "due_date": detail["due_date"],
                "status": detail["status"],
                "next_installment_number": detail["next_installment_number"],
            })
        installments = _treatment_installments(l)
        if installments:
            installments_total = len(installments)
            installments_paid = len([i for i in installments if i.get("paid")])
            for idx, inst in enumerate(installments, start=1):
                payment_schedule.append({
                    "lead_id": l["id"],
                    "client_name": l.get("name", "Unknown"),
                    "phone": l.get("phone", ""),
                    "branch_name": branch_name_map.get(l.get("branch_id"), ""),
                    "category": "session",  # Treatment Fee installment schedule (Partial Payment, or a partial-sessions collection)
                    "installment_number": idx,
                    "amount": inst.get("amount", 0),
                    "due_date": inst.get("due_date", ""),
                    "status": _installment_status(inst, today),
                    "installments_total": installments_total,
                    "installments_paid": installments_paid,
                })
    outstanding_clients.sort(key=lambda r: -r["balance"])
    payment_schedule.sort(key=lambda r: r["due_date"])

    return {
        "kpis": {
            "total_collected": total_collected,
            "pending_count": pending_count,
            "refunds": 0.0,  # not tracked yet — no refund flow exists in the system
            "net_revenue": total_collected,
        },
        "breakdown": {
            "consultation_revenue": consultation_total,
            "session_revenue": session_total,
            "diet_revenue": diet_total,
            "store_revenue": store_total,
            "consultation_pct": round(consultation_total / total_collected * 100, 1) if total_collected else 0,
            "session_pct": round(session_total / total_collected * 100, 1) if total_collected else 0,
            "diet_pct": round(diet_total / total_collected * 100, 1) if total_collected else 0,
            "store_pct": round(store_total / total_collected * 100, 1) if total_collected else 0,
        },
        "trend": trend,
        "by_branch": by_branch,
        "payment_modes": payment_modes,
        "transactions": sorted(transactions, key=lambda t: t["date"], reverse=True)[:500],
        "outstanding_clients": outstanding_clients,
        "payment_schedule": payment_schedule,
        "pending_leads": pending_leads,
    }


@router.get("/finance/client/{lead_id}")
async def client_transaction_history(
    lead_id: str,
    user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin", "accountant", "physio")),
):
    """Transactions History > eye icon — one client's full profile, every payment
    they've made, their current outstanding balance, and their complete activity
    timeline (stage moves, follow-ups, diagnosis notes — not just payments).
    A physio only ever sees their own assigned patient's history here, read-only —
    used by the Patient Detail page's Payment History tab."""
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Client not found")
    if is_branch_admin_role(user.role) and lead.get("branch_id") != user.branch_id:
        raise HTTPException(status_code=404, detail="Client not found")
    if user.role == "physio":
        doctor = await v3_col("doctors").find_one({"user_id": user.id, "profile_type": "physio"}, {"_id": 0, "id": 1})
        if not doctor or lead.get("assigned_physio_id") != doctor["id"]:
            raise HTTPException(status_code=404, detail="Client not found")

    branch_name = ""
    if lead.get("branch_id"):
        branch = await v3_col("branches").find_one({"id": lead["branch_id"]}, {"_id": 0, "branch_name": 1})
        branch_name = (branch or {}).get("branch_name", "")

    today = datetime.now(timezone.utc).date().isoformat()
    activity = await v3_col("lead_activity").find({"lead_id": lead_id}, {"_id": 0}).sort("created_at", -1).to_list(500)

    first_installment_amount = None
    if lead.get("treatment_fee_payment_mode") == "partial":
        lead_installments = (lead.get("treatment_fee_payment_details") or {}).get("installments") or []
        if lead_installments:
            first_installment_amount = lead_installments[0].get("amount")

    transactions = []
    for act in activity:
        if act.get("action") not in REVENUE_ACTIONS:
            continue
        details = act.get("details", "")
        category = _revenue_category(act.get("action", ""))
        mode = _parse_payment_mode(details)
        amount = _parse_rs_amount(details)
        if category == "session" and mode == "partial" and first_installment_amount is not None:
            # The logged Rs. figure is the Partial Payment schedule's total, not what
            # was actually collected at that moment — see revenue_overview for detail.
            amount = first_installment_amount
        transactions.append({
            "id": act.get("id", ""),
            "transaction_id": act.get("transaction_id") or "",
            "date": act.get("created_at", ""),
            "source": category,
            "amount": amount,
            "payment_mode": mode,
            "details": details,
            "collected_by": act.get("created_by", ""),
            # Who took it, in their role at the time — "Priya R. · Branch Admin" reads as
            # a record; the name alone doesn't say in what capacity.
            "collected_by_role": act.get("created_by_role", ""),
            "receipt_no": f"RCPT-{act.get('id', '')[-6:].upper()}" if act.get("id") else None,
            "original_amount": act.get("original_amount"),
            "discount_amount": act.get("discount_amount"),
            "discount_reason": act.get("discount_reason"),
        })

    balance = _lead_outstanding_balance(lead)
    outstanding_detail = _lead_outstanding_detail(lead, today)
    installments = (lead.get("treatment_fee_payment_details") or {}).get("installments") or []
    session = _lead_session_summary(lead)

    # A collected installment carries how it was paid and the reference that proves it
    # (UTR, cheque number, the account's last four). Those are written at collection
    # time but were never returned here, so the Client Details popup had no way to show
    # them -- the card number itself is never stored, only the last four digits.
    schedule = [
        {
            "installment_number": idx,
            "amount": inst.get("amount", 0),
            "due_date": inst.get("due_date", ""),
            "status": _installment_status(inst, today),
            "payment_mode": inst.get("payment_mode"),
            "upi_transaction_id": inst.get("upi_transaction_id"),
            "upi_utr": inst.get("upi_utr"),
            "account_last4": inst.get("account_last4"),
            "account_holder_name": inst.get("account_holder_name"),
            "bank_name": inst.get("bank_name"),
            "ifsc_code": inst.get("ifsc_code"),
            "cheque_number": inst.get("cheque_number"),
            "transfer_reference": inst.get("transfer_reference"),
            "transaction_id": inst.get("transaction_id"),
        }
        for idx, inst in enumerate(installments, start=1)
    ]

    consultation_status = None
    if lead.get("package_id"):
        # A confirmed collection (even a negotiated discount below the assigned
        # price) counts as fully paid -- not still-pending -- since it's a
        # deliberate confirmed payment, not a partial/outstanding one.
        consultation_status = "paid" if lead.get("package_paid") is not None else "pending"

    return {
        "client": {
            "id": lead["id"],
            "name": lead.get("name", "Unknown"),
            "phone": lead.get("phone", ""),
            "email": lead.get("email", ""),
            "branch_name": branch_name,
            # Identity and provenance the Client Details header shows. All of it already
            # lives on the lead; it simply wasn't being returned here.
            "patient_number": lead.get("patient_number"),
            "first_seen": lead.get("created_at"),
            "source": lead.get("source_tab") or lead.get("source_type") or "",
            "assigned_physio_name": lead.get("assigned_physio_name") or "",
        },
        "balance": balance,
        "balance_status": outstanding_detail["status"] if balance > 0 else "paid",
        "status": "done" if balance <= 0 else "processing",
        "last_payment_date": transactions[0]["date"] if transactions else None,
        "next_due_date": outstanding_detail["due_date"],
        "payment_details": {
            "consultation_fee_total": lead.get("package_price"),
            "consultation_fee_paid": lead.get("package_paid"),
            "consultation_payment_mode": lead.get("package_payment_mode"),
            "consultation_status": consultation_status,
            "treatment_fee_paid": lead.get("treatment_fee_paid"),
            "treatment_payment_mode": lead.get("treatment_fee_payment_mode"),
            "installments_total": len(installments) if installments else None,
            "installments_paid": len([i for i in installments if i.get("paid")]) if installments else None,
            "session_package_label": session["package_label"],
            # The course as quoted by the consultant: how many sessions and at what price.
            # Distinct from session_total, which is only what has actually been scheduled
            # for collection — a quoted-but-unpurchased package has a price and no total.
            "session_package_sessions": lead.get("session_package_sessions"),
            "session_package_price": lead.get("session_package_price"),
            "session_total": session["total"],
            "session_paid": session["paid"],
            "session_due": session["due"],
            "session_status": session["status"],
            "next_installment_number": session["next_installment_number"],
        },
        "schedule": schedule,
        "transactions": transactions,
        "timeline": activity,
    }


@router.post("/finance/installment/{lead_id}/{installment_number}/mark-paid")
async def mark_installment_paid(
    lead_id: str,
    installment_number: int,
    payload: V3MarkInstallmentPaidInput = V3MarkInstallmentPaidInput(),
    user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin", "accountant")),
):
    """Payment Schedules — mark one Partial Payment installment as collected.
    installment_number is 1-based (matches what the Payment Schedules table shows).
    When payload.payment_mode is sent (the Branch Admin's per-row Collect popup),
    this records the same mode-specific details every other Treatment Fee mode does
    and logs a 'treatment_fee_collected' activity entry, so the collection shows up
    in Session Collections / Accountant Manage exactly like a fresh collection would.
    Omitting payment_mode keeps the old bare "just flip paid" behavior (e.g. the
    Outstanding Amount panel's quick-collect action)."""
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Client not found")
    if is_branch_admin_role(user.role) and lead.get("branch_id") != user.branch_id:
        raise HTTPException(status_code=404, detail="Client not found")

    details = lead.get("treatment_fee_payment_details") or {}
    installments = details.get("installments") or []
    idx = installment_number - 1
    if idx < 0 or idx >= len(installments):
        raise HTTPException(status_code=404, detail="Installment not found")
    if installments[idx].get("paid"):
        raise HTTPException(status_code=400, detail="This installment has already been collected")

    activity_details = None
    transaction_id = None
    if payload.payment_mode:
        mode = payload.payment_mode
        amount = payload.amount if payload.amount is not None else installments[idx].get("amount", 0)
        if amount <= 0:
            raise HTTPException(status_code=400, detail="Amount must be greater than zero")

        mode_fields = {}
        detail_suffix = ""
        if mode == "upi":
            mode_fields = {"upi_transaction_id": (payload.upi_transaction_id or "").strip(), "upi_utr": (payload.upi_utr or "").strip()}
            if mode_fields["upi_transaction_id"] or mode_fields["upi_utr"]:
                detail_suffix = f" · UPI txn {mode_fields['upi_transaction_id']}, UTR {mode_fields['upi_utr']}"
        elif mode == "card":
            if not all([payload.account_number and payload.account_number.strip(), payload.account_holder_name and payload.account_holder_name.strip(),
                        payload.bank_name and payload.bank_name.strip(), payload.ifsc_code and payload.ifsc_code.strip()]):
                raise HTTPException(status_code=400, detail="Account Number, Account Holder Name, Bank Name and IFSC Code are required")
            last4 = "".join(ch for ch in payload.account_number if ch.isdigit())[-4:]
            mode_fields = {
                "account_last4": last4,
                "account_holder_name": payload.account_holder_name.strip(),
                "bank_name": payload.bank_name.strip(),
                "ifsc_code": payload.ifsc_code.strip().upper(),
            }
            detail_suffix = f" · A/C ****{last4}, {payload.account_holder_name.strip()}, {payload.bank_name.strip()} ({payload.ifsc_code.strip().upper()})"
        elif mode == "cheque":
            if not payload.bank_name or not payload.bank_name.strip() or not payload.cheque_number or not payload.cheque_number.strip():
                raise HTTPException(status_code=400, detail="Bank Name and Cheque Number are required")
            mode_fields = {"bank_name": payload.bank_name.strip(), "cheque_number": payload.cheque_number.strip()}
            detail_suffix = f" · Cheque #{payload.cheque_number.strip()}, {payload.bank_name.strip()}"
        elif mode == "account_transfer":
            if not all([payload.account_number and payload.account_number.strip(), payload.account_holder_name and payload.account_holder_name.strip(),
                        payload.bank_name and payload.bank_name.strip(), payload.ifsc_code and payload.ifsc_code.strip(),
                        payload.transfer_reference and payload.transfer_reference.strip()]):
                raise HTTPException(status_code=400, detail="Account Number, Account Holder Name, Bank Name, IFSC Code and Reference/UTR No. are required")
            last4 = "".join(ch for ch in payload.account_number if ch.isdigit())[-4:]
            mode_fields = {
                "account_last4": last4,
                "account_holder_name": payload.account_holder_name.strip(),
                "bank_name": payload.bank_name.strip(),
                "ifsc_code": payload.ifsc_code.strip().upper(),
                "transfer_reference": payload.transfer_reference.strip(),
            }
            detail_suffix = f" · A/C ****{last4}, {payload.account_holder_name.strip()}, {payload.bank_name.strip()} ({payload.ifsc_code.strip().upper()}) · Ref {payload.transfer_reference.strip()}"

        # Each installment is its own collection, so each earns its own transaction id --
        # the schedule they belong to has none, since scheduling moves no money.
        transaction_id = await generate_transaction_id(lead.get("branch_id"))
        installments[idx] = {**installments[idx], "paid": True, "amount": amount, "payment_mode": mode, "transaction_id": transaction_id, **mode_fields}
        activity_details = f"Collected Installment #{installment_number} for session package '{lead.get('session_package_name')}' · Rs.{amount} via {mode}{detail_suffix} · Txn {transaction_id}"
    else:
        installments[idx]["paid"] = True

    await v3_col("leads").update_one(
        {"id": lead_id},
        {"$set": {"treatment_fee_payment_details.installments": installments}},
    )

    if activity_details:
        await v3_col("lead_activity").insert_one({
            "id": str(uuid.uuid4()),
            "transaction_id": transaction_id,
            "lead_id": lead_id,
            "action": "treatment_fee_collected",
            "details": activity_details,
            "created_by": user.full_name,
            "created_by_role": user.role,
            "created_at": _now(),
        })

    updated_details = {**details, "installments": installments}
    return {"message": "Installment marked as paid", "transaction_id": transaction_id, "balance": _lead_outstanding_balance({**lead, "treatment_fee_payment_details": updated_details})}
