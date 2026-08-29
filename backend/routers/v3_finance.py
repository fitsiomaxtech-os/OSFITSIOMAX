import re
import uuid
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

from database import v3_col
from physio_scope import physio_owns_lead, resolve_physio_doctor
from deps import v3_require_roles, is_branch_admin_role, is_physio_role
from schemas.v3 import V3UserOut, V3MarkInstallmentPaidInput
from stage_utils import entry_branch_stage_names
from utils import generate_transaction_id
# An installment is the Treatment Fee arriving in pieces, so it is counted under exactly
# the rules the fee itself is -- imported rather than copied. v3_fitness.py and
# v3_zumba.py already each carry their own copy of this counter; a fourth would be a
# fourth place for the note list and the must-agree rule to drift apart.
from routers.v3_packages import _notes_label, _settle_cash_count


def _now():
    return datetime.now(timezone.utc).isoformat()


# Every default vertical is named "online_.../offline_..." — same helper as
# _is_online_vertical in v3_dashboard.py, read off the same prefix.
def _is_online_vertical(vertical) -> bool:
    return str(vertical or "").startswith("online_")


# What one tender in a split installment is allowed to be. The same four the Treatment
# Fee itself splits across in v3_packages.py: money that settles today, which a cheque
# does not.
SPLIT_TENDER_MODES = ("cash", "upi", "card", "account_transfer")


router = APIRouter(prefix="/api/v3")


@router.get("/branch/finance")
async def get_branch_finance(
    fee_type: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    search: Optional[str] = None,
    branch_id: Optional[str] = None,
    # "online" | "offline" — filtered off each lead's own vertical, same split as
    # Branches & Verticals' own mode pills. Accountant's Summary tab.
    mode: Optional[str] = None,
    # Approvals tab: pass False to see what still needs review, True for what's
    # cleared. Left unset for Summary, which shows every collection either way.
    approved: Optional[bool] = None,
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
    if mode in ("online", "offline"):
        base_query["vertical"] = {"$regex": f"^{mode}_"}

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

    # package_sold (sell_package's own action, set the moment a package is assigned at a
    # negotiated price — no transaction_id or payment_mode, unlike package_payment_collected)
    # belongs in this list too: leads whose package_paid only ever came from that flow would
    # otherwise count in the cards above and never appear as a row below.
    activity_query = {"action": {"$in": ["consultation_paid", "package_payment_collected", "package_sold"]}}
    lead_ids = [l["id"] for l in all_branch_leads]
    # Applied whenever a branch or a mode was asked for, empty list included. Guarding this
    # on "if lead_ids" dropped the filter for a scope with nobody in it instead of matching
    # nothing -- so a branch with no leads reported every payment in the company as its own.
    # The guard existed to skip a needless $in over every lead when nothing was scoped,
    # which is the one case it should still skip.
    if base_query:
        activity_query["lead_id"] = {"$in": lead_ids}

    activities = await v3_col("lead_activity").find(activity_query, {"_id": 0}).sort("created_at", -1).to_list(2000)

    lead_map = {l["id"]: l for l in all_branch_leads}

    transactions = []
    for act in activities:
        lead = lead_map.get(act.get("lead_id"), {})
        details = act.get("details", "")

        is_consultation = "consultation" in details.lower()
        is_package = "package" in details.lower()

        amount = _parse_rs_amount(details)
        weeks = None

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

        is_approved = bool(act.get("approved"))
        if approved is not None and is_approved != approved:
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
            "vertical": lead.get("vertical", ""),
            # Whether the Accountant has cleared this collection — set only via
            # POST /finance/transactions/{id}/approve, never at collection time, so a
            # branch's own book never reads as pre-approved before anyone reviewed it.
            "approved": is_approved,
            "approved_by": act.get("approved_by") or "",
            "approved_at": act.get("approved_at") or "",
        })

    approved_total = sum(t["amount"] for t in transactions if t["approved"])
    pending_approval = [t for t in transactions if not t["approved"]]
    summary["approved_total"] = approved_total
    summary["pending_approval_total"] = sum(t["amount"] for t in pending_approval)
    summary["pending_approval_count"] = len(pending_approval)

    return {"summary": summary, "transactions": transactions}


class ApproveTransactionInput(BaseModel):
    # What the Approve popup asks for is chosen by the row's own payment mode: Cash asks
    # to re-enter the amount, Bank Transfer/UPI ask for the transaction/UTR reference,
    # Cheque asks for the cheque number. Stored as typed — an independent, manual
    # re-check by whoever approves, not a re-parse of what the collector already
    # recorded. All optional: a row with no recognised payment mode (package_sold,
    # store sales with no mode) can still be approved with nothing to confirm against.
    confirmed_amount: Optional[float] = None
    transaction_ref: Optional[str] = None
    cheque_number: Optional[str] = None


@router.post("/finance/transactions/{activity_id}/approve")
async def approve_transaction(
    activity_id: str,
    payload: ApproveTransactionInput = ApproveTransactionInput(),
    user: V3UserOut = Depends(v3_require_roles("super_admin", "accountant")),
):
    """Accountant's Approvals tab: marks one collected payment reviewed. Written onto
    the record itself (approved/approved_by/approved_at, plus whatever confirmation the
    popup collected) rather than a separate collection, since every reader — Summary
    (get_branch_finance), revenue_overview, /finance/approvals, this endpoint — already
    keys off its id and needs no second lookup to know a row's approval state. Tried
    against lead_activity first, then inventory_movements (Store sales carry no lead),
    since /finance/approvals lists rows from both. Branch Admin cannot approve:
    approval exists to have someone other than whoever collected it sign off.
    """
    update = {"approved": True, "approved_by": user.full_name, "approved_at": _now()}
    if payload.confirmed_amount is not None:
        update["approval_confirmed_amount"] = payload.confirmed_amount
    if payload.transaction_ref:
        update["approval_transaction_ref"] = payload.transaction_ref.strip()
    if payload.cheque_number:
        update["approval_cheque_number"] = payload.cheque_number.strip()

    res = await v3_col("lead_activity").update_one({"id": activity_id}, {"$set": update})
    if res.matched_count == 0:
        res = await v3_col("inventory_movements").update_one({"id": activity_id}, {"$set": update})
    if res.matched_count == 0:
        res = await v3_col("zumba_registrations").update_one({"id": activity_id}, {"$set": update})
    if res.matched_count == 0:
        # Fitness keeps its money on the registration exactly as Zumba does, so a gym fee
        # reaches the approvals list from its own collection and has to be signed off in
        # it. Without this line the row appears with a button that 404s.
        res = await v3_col("fitness_registrations").update_one({"id": activity_id}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return {"message": "Approved"}


@router.post("/finance/transactions/{activity_id}/unapprove")
async def unapprove_transaction(
    activity_id: str,
    user: V3UserOut = Depends(v3_require_roles("super_admin", "accountant")),
):
    """Undoes an approval taken by mistake. Clears who/when/confirmation rather than
    leaving them on a row that is, again, unreviewed. Same collections as approve, tried in
    the same order."""
    unset = {"approved_by": "", "approved_at": "", "approval_confirmed_amount": "", "approval_transaction_ref": "", "approval_cheque_number": ""}
    update = {"$set": {"approved": False}, "$unset": unset}
    res = await v3_col("lead_activity").update_one({"id": activity_id}, update)
    if res.matched_count == 0:
        res = await v3_col("inventory_movements").update_one({"id": activity_id}, update)
    if res.matched_count == 0:
        res = await v3_col("zumba_registrations").update_one({"id": activity_id}, update)
    if res.matched_count == 0:
        res = await v3_col("fitness_registrations").update_one({"id": activity_id}, update)
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return {"message": "Approval removed"}


@router.get("/finance/approvals")
async def finance_approvals(
    branch_id: Optional[str] = None,
    mode: Optional[str] = None,  # "online" | "offline", off each lead's/branch's own vertical
    category: Optional[str] = None,  # "consultation" | "session" | "diet" | "store" | "other"
    # "cash" | "upi" | "card" | "account_transfer" | "cheque" — same set a Branch Admin
    # picks from when collecting a fee (V3MarkInstallmentPaidInput.payment_mode and its
    # siblings across v3_packages.py).
    payment_mode: Optional[str] = None,
    approved: Optional[bool] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin", "accountant")),
):
    """Accountant's Approvals tab. Every kind of collection revenue_overview counts
    (REVENUE_ACTIONS, plus Store sales) rather than just get_branch_finance's narrower
    consultation/package set — "new income collected" means all of it, not only two of
    its five sources. A dedicated query rather than reusing revenue_overview's own
    transactions: that endpoint's list feeds Payment Paid/Unpaid and Outstanding too,
    and filtering it here by approval state would silently drop rows out of those.
    """
    if is_branch_admin_role(user.role):
        branch_id = user.branch_id

    branch_docs = await v3_col("branches").find({}, {"_id": 0, "id": 1, "branch_name": 1, "vertical": 1}).to_list(500)
    branch_map = {b["id"]: b for b in branch_docs}
    mode_branch_ids = None
    if mode in ("online", "offline"):
        mode_branch_ids = {bid for bid, b in branch_map.items() if _is_online_vertical(b.get("vertical")) == (mode == "online")}
        if branch_id and branch_id not in mode_branch_ids:
            return {"transactions": [], "summary": {"pending_count": 0, "pending_total": 0.0, "approved_count": 0, "approved_total": 0.0}}

    lead_query = {"branch_id": branch_id} if branch_id else {}
    leads = await v3_col("leads").find(lead_query, {"_id": 0, "id": 1, "name": 1, "phone": 1, "branch_id": 1}).to_list(20000)
    if mode_branch_ids is not None:
        leads = [l for l in leads if l.get("branch_id") in mode_branch_ids]
    lead_ids = [l["id"] for l in leads]
    lead_map = {l["id"]: l for l in leads}

    date_query = {}
    if start_date:
        date_query["$gte"] = start_date
    if end_date:
        date_query["$lte"] = end_date + "T23:59:59"

    rows = []
    # Whether the caller narrowed to particular leads at all (a branch and/or a
    # vertical). Unscoped, activity_query has no lead_id clause and reads every lead's
    # activity. Scoped with zero matching leads, nothing can match either — skipped
    # rather than querying with an empty $in, which Mongo would (correctly) also match
    # nothing on, but only after the round trip.
    scoped = bool(branch_id) or mode_branch_ids is not None
    if not (scoped and not lead_ids):
        activity_query = {"action": {"$in": REVENUE_ACTIONS}}
        if scoped:
            activity_query["lead_id"] = {"$in": lead_ids}
        if date_query:
            activity_query["created_at"] = date_query
        activities = await v3_col("lead_activity").find(activity_query, {"_id": 0}).sort("created_at", -1).to_list(5000)

        for act in activities:
            lead = lead_map.get(act.get("lead_id"), {})
            cat = _revenue_category(act.get("action", ""))
            if category and category not in ("all", "") and cat != category:
                continue
            is_approved = bool(act.get("approved"))
            if approved is not None and is_approved != approved:
                continue
            details = act.get("details", "")
            pm = _parse_payment_mode(details)
            if payment_mode and payment_mode not in ("all", "") and pm != payment_mode:
                continue
            rows.append({
                "id": act.get("id", ""),
                "lead_id": act.get("lead_id", ""),
                "patient_name": lead.get("name", "Unknown"),
                "patient_phone": lead.get("phone", ""),
                "branch_id": lead.get("branch_id"),
                "branch_name": branch_map.get(lead.get("branch_id"), {}).get("branch_name", ""),
                "category": cat,
                "amount": _parse_rs_amount(details),
                "payment_mode": pm,
                "collected_by": act.get("created_by", ""),
                "collected_at": act.get("created_at", ""),
                "approved": is_approved,
                "approved_by": act.get("approved_by") or "",
                "approved_at": act.get("approved_at") or "",
            })

    if category in (None, "", "all", "store"):
        store_query = {"kind": "sale"}
        if branch_id:
            store_query["branch_id"] = branch_id
        if date_query:
            store_query["created_at"] = date_query
        store_sales = await v3_col("inventory_movements").find(store_query, {"_id": 0}).to_list(5000)
        for sale in store_sales:
            bid = sale.get("branch_id")
            if mode_branch_ids is not None and bid not in mode_branch_ids:
                continue
            is_approved = bool(sale.get("approved"))
            if approved is not None and is_approved != approved:
                continue
            pm = sale.get("payment_mode") or "unknown"
            if payment_mode and payment_mode not in ("all", "") and pm != payment_mode:
                continue
            rows.append({
                "id": sale.get("id", ""),
                "lead_id": "",
                "patient_name": (sale.get("customer_name") or "").strip() or "Counter sale",
                "patient_phone": "",
                "branch_id": bid,
                "branch_name": branch_map.get(bid, {}).get("branch_name", ""),
                "category": "store",
                "amount": float(sale.get("amount") or 0),
                "payment_mode": pm,
                "collected_by": sale.get("by_user_name", ""),
                "collected_at": sale.get("created_at", ""),
                "approved": is_approved,
                "approved_by": sale.get("approved_by") or "",
                "approved_at": sale.get("approved_at") or "",
            })

    # Zumba class fees. Collected onto the registration rather than through the lead
    # fee machinery -- see revenue_overview's own zumba loop for why -- and this tab
    # reads lead_activity and store sales, so until now every rupee of class money was
    # counted as revenue that nobody could sign off: it appeared in the Total and in
    # no approval queue, approved or pending.
    if category in (None, "", "all", "zumba"):
        zumba_query = {}
        if branch_id:
            zumba_query["branch_id"] = branch_id
        if date_query:
            zumba_query["created_at"] = date_query
        regs = await v3_col("zumba_registrations").find(zumba_query, {"_id": 0}).to_list(5000)
        for reg in regs:
            bid = reg.get("branch_id")
            if mode_branch_ids is not None and bid not in mode_branch_ids:
                continue
            # fee_paid, not fee_amount, and nothing to review when it is zero: a
            # registration with no money on it yet is the Zumba tab's business, not
            # this one's. Same rule revenue_overview counts by.
            amount = float(reg.get("fee_paid") or 0)
            if amount <= 0:
                continue
            is_approved = bool(reg.get("approved"))
            if approved is not None and is_approved != approved:
                continue
            pm = reg.get("payment_mode") or "unknown"
            if payment_mode and payment_mode not in ("all", "") and pm != payment_mode:
                continue
            rows.append({
                "id": reg.get("id", ""),
                # No lead behind a class fee -- the dancer is a registration, not a
                # patient -- so this stays empty rather than faked, the same way a
                # counter sale's does.
                "lead_id": "",
                "patient_name": (reg.get("name") or "").strip() or "Zumba registration",
                "patient_phone": reg.get("phone") or "",
                "branch_id": bid,
                "branch_name": branch_map.get(bid, {}).get("branch_name", ""),
                "category": "zumba",
                "amount": amount,
                "payment_mode": pm,
                "collected_by": reg.get("created_by", ""),
                "collected_at": reg.get("created_at", ""),
                "approved": is_approved,
                "approved_by": reg.get("approved_by") or "",
                "approved_at": reg.get("approved_at") or "",
            })

    # Gym memberships, on the same footing as the class fees above: v3_fitness.py keeps the
    # money on the registration, so this tab — which reads the lead activity trail and store
    # sales — never saw a rupee of it. Same consequence as Zumba had: counted in the Total
    # and present in no approval queue, so nobody could sign it off or query it.
    if category in (None, "", "all", "fitness"):
        fitness_query = {}
        if branch_id:
            fitness_query["branch_id"] = branch_id
        if date_query:
            fitness_query["created_at"] = date_query
        regs = await v3_col("fitness_registrations").find(fitness_query, {"_id": 0}).to_list(5000)
        for reg in regs:
            bid = reg.get("branch_id")
            if mode_branch_ids is not None and bid not in mode_branch_ids:
                continue
            # fee_paid, not fee_amount, and nothing to review when it is zero: a
            # membership with no money on it yet is the Fitness tab's business, not
            # this one's. Same rule revenue_overview counts by.
            amount = float(reg.get("fee_paid") or 0)
            if amount <= 0:
                continue
            is_approved = bool(reg.get("approved"))
            if approved is not None and is_approved != approved:
                continue
            pm = reg.get("payment_mode") or "unknown"
            if payment_mode and payment_mode not in ("all", "") and pm != payment_mode:
                continue
            rows.append({
                "id": reg.get("id", ""),
                # No lead behind a membership -- the member is a registration, not a
                # patient -- so this stays empty rather than faked, the same way a
                # counter sale's does.
                "lead_id": "",
                "patient_name": (reg.get("name") or "").strip() or "Fitness registration",
                "patient_phone": reg.get("phone") or "",
                "branch_id": bid,
                "branch_name": branch_map.get(bid, {}).get("branch_name", ""),
                "category": "fitness",
                "amount": amount,
                "payment_mode": pm,
                "collected_by": reg.get("created_by", ""),
                "collected_at": reg.get("created_at", ""),
                "approved": is_approved,
                "approved_by": reg.get("approved_by") or "",
                "approved_at": reg.get("approved_at") or "",
            })

    rows.sort(key=lambda r: r["collected_at"], reverse=True)
    pending = [r for r in rows if not r["approved"]]
    approved_rows = [r for r in rows if r["approved"]]
    return {
        "transactions": rows[:1000],
        "summary": {
            "pending_count": len(pending),
            "pending_total": sum(r["amount"] for r in pending),
            "approved_count": len(approved_rows),
            "approved_total": sum(r["amount"] for r in approved_rows),
        },
    }


# ---------- Expenses (Accountant) ----------

class ExpenseCreate(BaseModel):
    category: str
    amount: float
    branch_id: Optional[str] = None  # blank = an org-wide expense, not one branch's own
    note: Optional[str] = ""
    expense_date: Optional[str] = None  # defaults to today if omitted


@router.get("/finance/expenses")
async def list_expenses(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    branch_id: Optional[str] = None,
    mode: Optional[str] = None,  # "online" | "offline"
    user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin", "accountant")),
):
    if is_branch_admin_role(user.role):
        branch_id = user.branch_id
    query = {}
    if branch_id:
        query["branch_id"] = branch_id
    date_query = {}
    if start_date:
        date_query["$gte"] = start_date
    if end_date:
        date_query["$lte"] = end_date
    if date_query:
        query["expense_date"] = date_query
    rows = await v3_col("expenses").find(query, {"_id": 0}).sort("expense_date", -1).to_list(2000)
    branch_docs = await v3_col("branches").find({}, {"_id": 0, "id": 1, "branch_name": 1, "vertical": 1}).to_list(500)
    branch_name_map = {b["id"]: b.get("branch_name", "") for b in branch_docs}
    if mode in ("online", "offline"):
        online_ids = {b["id"] for b in branch_docs if _is_online_vertical(b.get("vertical"))}
        # An org-wide expense (no branch_id) isn't exclusively either — it counts under
        # both, the same way an untagged Lead Source shows under both Online and Offline.
        rows = [r for r in rows if not r.get("branch_id") or (r["branch_id"] in online_ids) == (mode == "online")]
    for r in rows:
        r["branch_name"] = branch_name_map.get(r.get("branch_id"), "") if r.get("branch_id") else "All Branches"
    return {"expenses": rows, "total": sum(r.get("amount", 0) for r in rows)}


@router.post("/finance/expenses")
async def create_expense(payload: ExpenseCreate, user: V3UserOut = Depends(v3_require_roles("super_admin", "accountant"))):
    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than zero")
    if not payload.category.strip():
        raise HTTPException(status_code=400, detail="Category is required")
    doc = {
        "id": str(uuid.uuid4()),
        "category": payload.category.strip(),
        "amount": payload.amount,
        "branch_id": payload.branch_id or None,
        "note": (payload.note or "").strip(),
        "expense_date": payload.expense_date or _now()[:10],
        "created_by": user.full_name,
        "created_at": _now(),
    }
    await v3_col("expenses").insert_one(doc.copy())
    return doc


@router.delete("/finance/expenses/{expense_id}")
async def delete_expense(expense_id: str, _: V3UserOut = Depends(v3_require_roles("super_admin", "accountant"))):
    res = await v3_col("expenses").delete_one({"id": expense_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Expense not found")
    return {"message": "Expense deleted"}


# ---------- Profit (Accountant) ----------

@router.get("/finance/profit")
async def finance_profit(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    branch_id: Optional[str] = None,
    mode: Optional[str] = None,  # "online" | "offline"
    user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin", "accountant")),
):
    """Revenue for the window (every collection — same total Accountant Manage's own
    Total Revenue tile shows, not only approved ones: approval is a review step, not a
    gate on whether money collected counts as revenue) minus Expenses logged against
    the same window and branch."""
    if is_branch_admin_role(user.role):
        branch_id = user.branch_id

    online_ids = set()
    if mode in ("online", "offline"):
        branch_docs = await v3_col("branches").find({}, {"_id": 0, "id": 1, "vertical": 1}).to_list(500)
        online_ids = {b["id"] for b in branch_docs if _is_online_vertical(b.get("vertical"))}

    lead_query = {"branch_id": branch_id} if branch_id else {}
    if mode in ("online", "offline"):
        lead_query["vertical"] = {"$regex": f"^{mode}_"}
    leads = await v3_col("leads").find(lead_query, {"_id": 0, "id": 1}).to_list(20000)
    lead_ids = [l["id"] for l in leads]

    activity_query = {"action": {"$in": REVENUE_ACTIONS}}
    # See get_branch_finance above: scoped means scoped, even to nobody.
    if lead_query:
        activity_query["lead_id"] = {"$in": lead_ids}
    date_query = {}
    if start_date:
        date_query["$gte"] = start_date
    if end_date:
        date_query["$lte"] = end_date + "T23:59:59"
    if date_query:
        activity_query["created_at"] = date_query
    activities = await v3_col("lead_activity").find(activity_query, {"_id": 0, "details": 1}).to_list(20000)
    revenue = sum(_parse_rs_amount(a.get("details", "")) for a in activities)

    store_query = {"kind": "sale"}
    if branch_id:
        store_query["branch_id"] = branch_id
    if date_query:
        store_query["created_at"] = date_query
    store_sales = await v3_col("inventory_movements").find(store_query, {"_id": 0, "amount": 1, "branch_id": 1}).to_list(5000)
    if mode in ("online", "offline"):
        store_sales = [s for s in store_sales if (s.get("branch_id") in online_ids) == (mode == "online")]
    revenue += sum(float(s.get("amount") or 0) for s in store_sales)

    expense_query = {"branch_id": branch_id} if branch_id else {}
    expense_date_query = {}
    if start_date:
        expense_date_query["$gte"] = start_date
    if end_date:
        expense_date_query["$lte"] = end_date
    if expense_date_query:
        expense_query["expense_date"] = expense_date_query
    expenses = await v3_col("expenses").find(expense_query, {"_id": 0, "amount": 1, "category": 1, "branch_id": 1}).to_list(2000)
    if mode in ("online", "offline"):
        # Org-wide (no branch_id) counts under both — same as the Expense tab's own
        # mode filter, so the two stay in step for the same window.
        expenses = [e for e in expenses if not e.get("branch_id") or (e["branch_id"] in online_ids) == (mode == "online")]
    total_expense = sum(e.get("amount", 0) for e in expenses)

    by_category = {}
    for e in expenses:
        cat = e.get("category") or "Uncategorized"
        by_category[cat] = by_category.get(cat, 0) + (e.get("amount") or 0)

    return {
        "revenue": revenue,
        "expense": total_expense,
        "profit": revenue - total_expense,
        "expense_by_category": [{"category": k, "amount": v} for k, v in sorted(by_category.items(), key=lambda kv: -kv[1])],
    }


# ---------- AC Overview > Total Revenue (Super Admin / Accountant) ----------

# "session" = Treatment Fee (the multi-visit Session Package collected after Consultation
# Fee); everything else collected at/around the consultation itself is "consultation".
REVENUE_ACTIONS = ["consultation_paid", "package_sold", "package_payment_collected", "treatment_fee_collected", "diet_fee_collected", "diet_chart_fee_collected", "rehab_fee_collected", "fee_collected"]

# The Consultation Fee itself: the actions that mean "this patient paid to be seen today".
# Deliberately narrower than _revenue_category(...) == "consultation", which is a reporting
# bucket that also holds the Diet Consultation Fee. Spot joining keys off THIS set — a diet
# fee taken on the same day as a treatment fee is not evidence the patient signed up on the
# spot, and folding it in would inflate spot joining with unrelated same-day payments.
CONSULTATION_FEE_ACTIONS = {"consultation_paid", "package_sold", "package_payment_collected", "fee_collected"}


def _revenue_category(action: str) -> str:
    """Which revenue line a payment belongs to: consultation, session, diet or rehab.

    Diet has its own line rather than sitting inside consultation. It is a separate
    service sold at its own price by its own clinician, and a branch reporting on it
    cannot answer "how much did diet bring in" if it is folded into the consultation
    figure. Anything not named here is consultation, which keeps every older action
    reporting exactly where it always did.
    """
    if action == "treatment_fee_collected":
        return "session"
    # Both diet fees land on the one diet line. They are two products, but a branch
    # asking "how much did diet bring in" means the vertical, not the shelf, and splitting
    # them into two report lines would answer a question nobody asked while making the one
    # they did ask take two numbers to read.
    if action in ("diet_fee_collected", "diet_chart_fee_collected"):
        return "diet"
    if action == "rehab_fee_collected":
        return "rehab"
    return "consultation"


def _parse_rs_amount(details: str) -> float:
    """Most collection flows write "Rs.1200" into details; sell_package (action
    "package_sold") writes "₹1200" instead. Rs. is tried first since it's the far
    more common case; ₹ is a fallback, not a replacement, so nothing that already
    parsed correctly changes."""
    try:
        if "Rs." in details:
            amt_part = details.split("Rs.")[1]
        elif "₹" in details:
            amt_part = details.split("₹")[1]
        else:
            return 0.0
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


# Every fee that can leave a balance behind, and the fields its schedule lives on.
#
# A balance is recorded identically for all five — one unpaid installment on that fee's
# own payment_details — so one map is enough to read any of them, collect against any of
# them, and report on any of them. Keyed by the name a caller passes; "treatment" is the
# default everywhere, since it was the only fee that could carry a schedule when this
# endpoint was written and every existing caller still sends nothing.
FEE_SCHEDULES = {
    "treatment": {
        "details": "treatment_fee_payment_details", "paid": "treatment_fee_paid",
        "mode": "treatment_fee_payment_mode", "package": "session_package_name",
        "label": "Treatment Fee", "action": "treatment_fee_collected",
    },
    "consultation": {
        "details": "package_payment_details", "paid": "package_paid",
        "mode": "package_payment_mode", "package": "package_name",
        "label": "Consultation Fee", "action": "package_payment_collected",
    },
    "rehab": {
        "details": "rehab_fee_payment_details", "paid": "rehab_fee_paid",
        "mode": "rehab_fee_payment_mode", "package": "rehab_package_name",
        "label": "Rehab Fee", "action": "rehab_fee_collected",
    },
    "diet": {
        "details": "diet_fee_payment_details", "paid": "diet_fee_paid",
        "mode": "diet_fee_payment_mode", "package": "diet_package_name",
        "label": "Diet Consultation Fee", "action": "diet_fee_collected",
    },
    "diet_chart": {
        "details": "diet_chart_fee_payment_details", "paid": "diet_chart_fee_paid",
        "mode": "diet_chart_fee_payment_mode", "package": "diet_chart_package_name",
        "label": "Diet Chart Fee", "action": "diet_chart_fee_collected",
    },
}


def _fee_installments(lead: dict, fee: str = "treatment") -> list:
    """One fee's installment schedule, whatever put it there. A schedule exists whenever
    the record has one — from choosing 'Partial Payment' outright, from collecting for
    only some of a package's sessions, or from a collection that came up short of what
    was payable. Keyed off the data shape rather than the stored payment_mode, so every
    path shares every downstream balance/schedule/status calculation for free."""
    return (lead.get(FEE_SCHEDULES[fee]["details"]) or {}).get("installments") or []


def _treatment_installments(lead: dict) -> list:
    """The Treatment Fee's schedule — the one most of this file means when it says
    "installments", kept as its own name because most of this file only wants that one."""
    return _fee_installments(lead, "treatment")


def _all_unpaid_installments(lead: dict) -> list:
    """Every balance still owed across all five fees, as (fee, index, installment).

    A patient can owe on more than one at once — a part-paid Consultation Fee and a
    part-paid Diet Fee are two separate debts on two separate schedules — so anything
    reporting what someone owes has to look at all of them, not only the treatment one."""
    out = []
    for fee in FEE_SCHEDULES:
        for idx, inst in enumerate(_fee_installments(lead, fee)):
            if not inst.get("paid"):
                out.append((fee, idx, inst))
    return sorted(out, key=lambda row: row[2].get("due_date") or "")


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
    # Every fee's unpaid rows, not only the Treatment Fee's. Any of the five can be part
    # collected now with the rest scheduled, and a Diet balance is owed exactly as much
    # as a treatment one — counting only treatment would drop it off what this says.
    balance += sum(inst.get("amount", 0) for _, _, inst in _all_unpaid_installments(lead))
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
    the next due date (from whichever fee's schedule falls due first) and a status
    badge: overdue (past due date), due_soon (due within 3 days), or partial
    (owes money but nothing scheduled yet / due further out)."""
    # A fee settled in one payment is settled in full, even at a discount that was
    # negotiated down: its "bill" here is what was actually collected, since the
    # discount was a decision rather than money still owed. A fee with a schedule is a
    # different matter — the schedule is the bill, both halves of it, so what has been
    # collected and what has not are read off the rows rather than off *_paid.
    package_installments = _fee_installments(lead, "consultation")
    if package_installments:
        total_bill = sum(i.get("amount", 0) for i in package_installments)
        paid_amount = sum(i.get("amount", 0) for i in package_installments if i.get("paid"))
    else:
        package_paid = lead.get("package_paid")
        total_bill = package_paid if package_paid is not None else (lead.get("package_price") or 0)
        paid_amount = package_paid or 0

    installments = _treatment_installments(lead)
    if installments:
        total_bill += sum(i.get("amount", 0) for i in installments)
        paid_amount += sum(i.get("amount", 0) for i in installments if i.get("paid"))
    elif lead.get("treatment_fee_paid"):
        total_bill += lead.get("treatment_fee_paid") or 0
        paid_amount += lead.get("treatment_fee_paid") or 0

    # Rehab and Diet have never been part of this picture, and a fee collected in one
    # payment still isn't — adding them wholesale would restate every existing row.
    # A balance is different: it is money the branch is owed and has to chase, so a fee
    # that left one is counted here, both halves, the same way the two above are.
    for fee in ("rehab", "diet", "diet_chart"):
        rows = _fee_installments(lead, fee)
        if rows:
            total_bill += sum(i.get("amount", 0) for i in rows)
            paid_amount += sum(i.get("amount", 0) for i in rows if i.get("paid"))

    # The nearest thing owed across every fee, so the badge and the date describe what
    # actually falls due next rather than only what the Treatment Fee does.
    unpaid = _all_unpaid_installments(lead)
    due_date = None
    next_installment_number = None
    next_installment_fee = None
    if unpaid:
        next_fee, next_idx, next_inst = unpaid[0]
        due_date = next_inst.get("due_date")
        # 1-based, matching what the Payment Schedules table shows, and named by the fee
        # it belongs to — the quick-collect action posts both back, so a balance on any
        # fee can be taken from here rather than only a Treatment Fee one.
        next_installment_number = next_idx + 1
        next_installment_fee = next_fee

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
        "next_installment_fee": next_installment_fee,
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
    return {"date": day, "consultation": 0.0, "session": 0.0, "diet": 0.0, "store": 0.0, "zumba": 0.0, "rehab": 0.0, "fitness": 0.0}


def _branch_label(bid, names: dict) -> str:
    """What to call a payment's branch when it has none to call.

    "Unknown" read as a lookup that failed. Two different things end up here and both
    are real: money on a lead that was never given a branch, and money pointing at a
    branch id nothing answers to any more -- a branch deleted and recreated leaves its
    clients behind on the old one. Neither can appear under any branch anybody can pick
    from the dropdown, so All Branches comes out larger than its branches add up to.
    Naming them is the difference between that gap being on the page and being a
    discrepancy somebody has to find by hand.
    """
    if bid in names:
        return names[bid]
    return "Unassigned" if bid in (None, "") else "Former branch"


def _empty_branch(bid, bname: str) -> dict:
    return {
        "branch_id": bid, "branch_name": bname,
        "consultation_total": 0.0, "session_total": 0.0, "diet_total": 0.0, "store_total": 0.0,
        "zumba_total": 0.0, "rehab_total": 0.0, "fitness_total": 0.0,
    }


@router.get("/finance/revenue-overview")
async def revenue_overview(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    branch_id: Optional[str] = None,
    # "online" | "offline", off each lead's own vertical — named apart from the loop's
    # own `mode` (payment mode: cash/upi/card/...) below so the two can never collide.
    vertical_mode: Optional[str] = None,
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
    if vertical_mode in ("online", "offline"):
        lead_query["vertical"] = {"$regex": f"^{vertical_mode}_"}
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

    branch_docs = await v3_col("branches").find({}, {"_id": 0, "id": 1, "branch_name": 1, "vertical": 1}).to_list(500)
    branch_name_map = {b["id"]: b.get("branch_name", "") for b in branch_docs}
    # Store sales carry no lead, so they can't be filtered by vertical_mode through the
    # lead_query above — resolved off their own branch's vertical instead, further down.
    online_branch_ids = {b["id"] for b in branch_docs if _is_online_vertical(b.get("vertical"))}

    activity_query = {"action": {"$in": REVENUE_ACTIONS}}
    # See get_branch_finance above: scoped means scoped, even to nobody.
    if lead_query:
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
    rehab_total = 0.0
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
        bname = _branch_label(bid, branch_name_map)

        if category == "session":
            session_total += amount
        elif category == "diet":
            diet_total += amount
        elif category == "rehab":
            rehab_total += amount
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
        is_approved = bool(act.get("approved"))
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
            # Set only via POST /finance/transactions/{id}/approve — see get_branch_finance
            # for why this lives on the activity record itself rather than a second table.
            "approved": is_approved,
            "approved_by": act.get("approved_by") or "",
            "approved_at": act.get("approved_at") or "",
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
    if vertical_mode in ("online", "offline"):
        store_sales = [s for s in store_sales if (s.get("branch_id") in online_branch_ids) == (vertical_mode == "online")]

    store_total = 0.0
    for sale in store_sales:
        amount = float(sale.get("amount") or 0)
        store_total += amount
        bid = sale.get("branch_id")
        bname = _branch_label(bid, branch_name_map)
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
            # Store sales aren't reviewed here — see approve_transaction's docstring —
            # so this stays permanently false rather than left out, keeping every
            # transaction dict in this list the same shape.
            "approved": False,
            "approved_by": "",
            "approved_at": "",
        })

    # Zumba class fees. Like the store sales above, they come from their own collection
    # rather than the lead activity trail — v3_zumba.py keeps the money on the
    # registration because a class fee is flat, has no package or installments behind it,
    # and hanging it on the leads' fee machinery would have meant inventing a lead per
    # dancer. Same money either way, so it belongs in the same total.
    #
    # fee_paid, never fee_amount: what was agreed is not what is in the drawer, and every
    # other figure on this payload is money actually collected.
    zumba_query = {}
    if branch_id:
        zumba_query["branch_id"] = branch_id
    if date_query:
        zumba_query["created_at"] = date_query
    zumba_rows = await v3_col("zumba_registrations").find(zumba_query, {"_id": 0}).sort("created_at", -1).to_list(5000)
    if vertical_mode in ("online", "offline"):
        zumba_rows = [z for z in zumba_rows if (z.get("branch_id") in online_branch_ids) == (vertical_mode == "online")]

    zumba_total = 0.0
    for reg in zumba_rows:
        amount = float(reg.get("fee_paid") or 0)
        if amount <= 0:
            continue  # registered but not paid — counted by the Zumba tab, not by revenue
        zumba_total += amount
        bid = reg.get("branch_id")
        bname = _branch_label(bid, branch_name_map)
        day = (reg.get("created_at") or "")[:10]
        # Off the registration, which does record it: the single mode when the fee
        # arrived in one piece, "split" when it came in several. This was hardcoded to
        # "unknown", which put every rupee of class money in a bucket the Cash/UPI/Card
        # pills can never match -- so picking any mode dropped Zumba from the total
        # even though the mode was sitting on the record all along.
        mode = reg.get("payment_mode") or "unknown"

        d = by_day.setdefault(day, _empty_day(day))
        d["zumba"] = d.get("zumba", 0.0) + amount

        b = by_branch_acc.setdefault(bid or "unknown", _empty_branch(bid, bname))
        b["zumba_total"] = b.get("zumba_total", 0.0) + amount

        payment_modes[mode] = payment_modes.get(mode, 0.0) + amount

        transactions.append({
            "id": reg.get("id", ""),
            "transaction_id": "",
            "date": reg.get("created_at", ""),
            "branch_name": bname,
            "source": "zumba",
            "gross": amount,
            # A class fee is the flat price; there is no listed-versus-collected concept
            # to discount against. Carried so every transaction in this list is one shape.
            "discount": 0.0,
            "original_amount": None,
            "discount_reason": None,
            "tax": 0.0,
            "net": amount,
            "collected_by": reg.get("created_by", ""),
            # No lead behind a dancer, same as a counter sale — left empty rather than
            # faked, so the client-history eye skips these instead of opening on nothing.
            "lead_id": "",
            "client_name": (reg.get("name") or "").strip() or "Zumba registration",
            "phone": reg.get("phone", ""),
            "payment_mode": mode,
            "client_balance": max(float(reg.get("fee_amount") or 0) - amount, 0.0),
            # Read off the registration now that a class fee can actually be approved.
            # Hardcoded False was true while the Approvals tab could not see Zumba at
            # all; leaving it would have shown every signed-off class fee as still
            # pending on this page, for good.
            "approved": bool(reg.get("approved")),
            "approved_by": reg.get("approved_by") or "",
            "approved_at": reg.get("approved_at") or "",
        })

    # Gym memberships, on exactly the terms Zumba's are above: v3_fitness.py keeps the
    # money on the registration because a membership is a flat fee with no package or
    # installments behind it, so there is no lead-fee trail for this loop to have found it
    # in. It was the one desk taking money that never reached this page — collected at the
    # branch, counted by the Fitness tab, and invisible to every figure an accountant looks
    # at.
    #
    # fee_paid, never fee_amount, like every other figure on this payload: what was agreed
    # is not what is in the drawer.
    fitness_query = {}
    if branch_id:
        fitness_query["branch_id"] = branch_id
    if date_query:
        fitness_query["created_at"] = date_query
    fitness_rows = await v3_col("fitness_registrations").find(fitness_query, {"_id": 0}).sort("created_at", -1).to_list(5000)
    if vertical_mode in ("online", "offline"):
        fitness_rows = [f for f in fitness_rows if (f.get("branch_id") in online_branch_ids) == (vertical_mode == "online")]

    fitness_total = 0.0
    for reg in fitness_rows:
        amount = float(reg.get("fee_paid") or 0)
        if amount <= 0:
            continue  # signed up but not paid — the Fitness tab's question, not revenue's
        fitness_total += amount
        bid = reg.get("branch_id")
        bname = _branch_label(bid, branch_name_map)
        day = (reg.get("created_at") or "")[:10]
        # Read off the record rather than hardcoded, so the Cash/UPI/Card pills can match
        # it — the mistake Zumba's loop above had to be corrected for.
        mode = reg.get("payment_mode") or "unknown"

        d = by_day.setdefault(day, _empty_day(day))
        d["fitness"] = d.get("fitness", 0.0) + amount

        b = by_branch_acc.setdefault(bid or "unknown", _empty_branch(bid, bname))
        b["fitness_total"] = b.get("fitness_total", 0.0) + amount

        payment_modes[mode] = payment_modes.get(mode, 0.0) + amount

        transactions.append({
            "id": reg.get("id", ""),
            "transaction_id": "",
            "date": reg.get("created_at", ""),
            "branch_name": bname,
            "source": "fitness",
            "gross": amount,
            # A membership is a flat price, so there is no listed-versus-collected gap to
            # discount against. Carried anyway so every row in this list is one shape.
            "discount": 0.0,
            "original_amount": None,
            "discount_reason": None,
            "tax": 0.0,
            "net": amount,
            "collected_by": reg.get("created_by", ""),
            # No lead behind a gym member, same as a counter sale — left empty rather than
            # faked, so the client-history eye skips these instead of opening on nothing.
            "lead_id": "",
            "client_name": (reg.get("name") or "").strip() or "Fitness registration",
            "phone": reg.get("phone", ""),
            "payment_mode": mode,
            "client_balance": max(float(reg.get("fee_amount") or 0) - amount, 0.0),
            "approved": bool(reg.get("approved")),
            "approved_by": reg.get("approved_by") or "",
            "approved_at": reg.get("approved_at") or "",
        })

    total_collected = consultation_total + session_total + diet_total + store_total + zumba_total + rehab_total + fitness_total
    trend = sorted(by_day.values(), key=lambda r: r["date"])
    for r in trend:
        r["total"] = r["consultation"] + r["session"] + r["diet"] + r["store"] + r.get("zumba", 0.0) + r.get("rehab", 0.0) + r.get("fitness", 0.0)
    for r in by_branch_acc.values():
        r["total_revenue"] = r["consultation_total"] + r["session_total"] + r["diet_total"] + r["store_total"] + r.get("zumba_total", 0.0) + r.get("rehab_total", 0.0) + r.get("fitness_total", 0.0)
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
                "next_installment_fee": detail["next_installment_fee"],
            })
        # Every fee's schedule, not only the Treatment Fee's. A schedule is a schedule
        # whichever fee left it — a Consultation Fee part paid today with the rest due
        # Friday is exactly the thing this table exists to show — and each row carries
        # the fee it belongs to so a collect action knows which one to post against.
        for fee, cfg in FEE_SCHEDULES.items():
            installments = _fee_installments(l, fee)
            if not installments:
                continue
            installments_total = len(installments)
            installments_paid = len([i for i in installments if i.get("paid")])
            for idx, inst in enumerate(installments, start=1):
                payment_schedule.append({
                    "lead_id": l["id"],
                    "client_name": l.get("name", "Unknown"),
                    "phone": l.get("phone", ""),
                    "branch_name": branch_name_map.get(l.get("branch_id"), ""),
                    # "session" kept for the Treatment Fee so nothing reading this
                    # table by its old category has to change.
                    "category": "session" if fee == "treatment" else fee,
                    "fee": fee,
                    "fee_label": cfg["label"],
                    "installment_number": idx,
                    "amount": inst.get("amount", 0),
                    "due_date": inst.get("due_date", ""),
                    "status": _installment_status(inst, today),
                    "installments_total": installments_total,
                    "installments_paid": installments_paid,
                })
    outstanding_clients.sort(key=lambda r: -r["balance"])
    payment_schedule.sort(key=lambda r: r["due_date"])

    # Off the full list, not the 500-row slice returned below — a branch with more than
    # 500 collections in the window would otherwise under-count its own approved total.
    total_approved = sum(t["gross"] for t in transactions if t["approved"])

    return {
        "kpis": {
            "total_collected": total_collected,
            "pending_count": pending_count,
            "refunds": 0.0,  # not tracked yet — no refund flow exists in the system
            "net_revenue": total_collected,
            # Reviewed via the Accountant's own Approvals tab — see approve_transaction.
            # Store sales are never approvable, so this can never reach total_collected.
            "total_approved": total_approved,
            "total_pending_approval": total_collected - total_approved,
        },
        "breakdown": {
            "consultation_revenue": consultation_total,
            "session_revenue": session_total,
            "diet_revenue": diet_total,
            "store_revenue": store_total,
            "zumba_revenue": zumba_total,
            "rehab_revenue": rehab_total,
            "fitness_revenue": fitness_total,
            "consultation_pct": round(consultation_total / total_collected * 100, 1) if total_collected else 0,
            "session_pct": round(session_total / total_collected * 100, 1) if total_collected else 0,
            "diet_pct": round(diet_total / total_collected * 100, 1) if total_collected else 0,
            "store_pct": round(store_total / total_collected * 100, 1) if total_collected else 0,
            "zumba_pct": round(zumba_total / total_collected * 100, 1) if total_collected else 0,
            "fitness_pct": round(fitness_total / total_collected * 100, 1) if total_collected else 0,
            "rehab_pct": round(rehab_total / total_collected * 100, 1) if total_collected else 0,
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
    if is_physio_role(user.role):
        # Every record they hold, not the one row that happens to carry the login link.
        # Through find_one this was the fourth place reading a physio's identity its own
        # way, and here it denies rather than empties: a physio whose patient was booked
        # against a duplicate row of themselves was told, on their own patient's Payment
        # History tab, that the client did not exist. See resolve_physio_doctor.
        doctor = await resolve_physio_doctor(user.id, user.role)
        ids = (doctor or {}).get("physio_ids") or []
        # Rehab counts as theirs here too, for the reason physio_owns_lead sets out.
        if not ids or not await physio_owns_lead(ids, lead_id):
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
    #
    # Every fee's schedule, each row saying which fee it belongs to: a client can owe on
    # more than one at a time (a part-paid Consultation Fee and a part-paid Diet Fee are
    # two debts, not one), and a row that did not name its fee could not be collected
    # against the right one. Numbers restart per fee, so "fee + number" is what
    # identifies a row here, not the number alone.
    schedule = [
        {
            "fee": fee,
            "fee_label": FEE_SCHEDULES[fee]["label"],
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
        for fee in FEE_SCHEDULES
        for idx, inst in enumerate(_fee_installments(lead, fee), start=1)
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
            # The next thing owed on any fee, not only the Treatment Fee's schedule —
            # both halves of the answer, since the number alone no longer identifies a
            # row now that every fee can have one.
            "next_installment_number": outstanding_detail["next_installment_number"],
            "next_installment_fee": outstanding_detail["next_installment_fee"],
            "next_installment_label": (
                FEE_SCHEDULES[outstanding_detail["next_installment_fee"]]["label"]
                if outstanding_detail["next_installment_fee"] else None
            ),
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
    """Payment Schedules — mark one installment as collected.
    installment_number is 1-based (matches what the Payment Schedules table shows).
    When payload.payment_mode is sent (the Branch Admin's per-row Collect popup),
    this records the same mode-specific details a fresh collection does and logs that
    fee's own activity entry, so it shows up in Session Collections / Accountant Manage
    exactly like one. Omitting payment_mode keeps the old bare "just flip paid" behavior
    (e.g. the Outstanding Amount panel's quick-collect action).

    payload.fee names which fee's schedule the row belongs to — any of the five can leave
    a balance behind, and a balance is collectable under any payment mode regardless of
    how the first part of the fee was paid. It defaults to the Treatment Fee, so callers
    written before the other four could carry a balance keep working unchanged."""
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Client not found")
    if is_branch_admin_role(user.role) and lead.get("branch_id") != user.branch_id:
        raise HTTPException(status_code=404, detail="Client not found")

    cfg = FEE_SCHEDULES[payload.fee]
    details = lead.get(cfg["details"]) or {}
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
        # One installment paid half in cash and half by UPI -- the same split the fee
        # itself can arrive in, and the same rules: every tender settles today, the
        # server sums them rather than trusting a total sent beside them, and the mode
        # on the record reads "split" because naming either half would be half a lie.
        lines = payload.payment_lines or []
        if lines:
            for line in lines:
                if line.mode not in SPLIT_TENDER_MODES:
                    raise HTTPException(status_code=400, detail=f"A split payment accepts: {sorted(SPLIT_TENDER_MODES)}")
                if line.amount is None or line.amount <= 0:
                    raise HTTPException(status_code=400, detail="Every payment in a split must be more than zero")
            lines_total = round(sum(line.amount for line in lines), 2)
            if payload.amount is not None and abs(payload.amount - lines_total) > 0.01:
                raise HTTPException(
                    status_code=400,
                    detail=f"The payments add up to Rs.{lines_total:g}, but the installment being collected is Rs.{payload.amount:g}",
                )
            amount = lines_total
            mode = "split"
        if amount <= 0:
            raise HTTPException(status_code=400, detail="Amount must be greater than zero")

        mode_fields = {}
        detail_suffix = ""
        if lines:
            # Counted against the tender's own amount, never the installment total --
            # see the same zip in collect_treatment_fee.
            line_notes = [
                _settle_cash_count(ln.denominations, ln.amount, f" for the Rs.{ln.amount:g} cash payment") if ln.mode == "cash" else {}
                for ln in lines
            ]
            mode_fields = {"payment_lines": [
                {
                    "mode": ln.mode,
                    "amount": ln.amount,
                    "reference": (ln.reference or "").strip(),
                    "denominations": counted,
                }
                for ln, counted in zip(lines, line_notes)
            ]}
            detail_suffix = " · Split: " + ", ".join(
                f"Rs.{ln.amount:g} {ln.mode}"
                + (f" ({ln.reference.strip()})" if (ln.reference or "").strip() else "")
                + (f" [{_notes_label(counted)}]" if counted else "")
                for ln, counted in zip(lines, line_notes)
            )
        elif mode == "cash":
            # The installment's own notes. Optional, and refused when they disagree with
            # the money -- the fee's rule, applied to the piece of it being collected.
            counted = _settle_cash_count(payload.denominations, amount)
            if counted:
                mode_fields = {"denominations": counted}
                detail_suffix = f" · Counted {_notes_label(counted)}"
        elif mode == "upi":
            # UTR is named in the log only when there is one. The Collect popups stopped
            # asking for it, so the old unconditional line wrote "UTR " with nothing after
            # it onto every installment collected from here.
            txn = (payload.upi_transaction_id or "").strip()
            utr = (payload.upi_utr or "").strip()
            mode_fields = {"upi_transaction_id": txn}
            if utr:
                mode_fields["upi_utr"] = utr
            if txn or utr:
                detail_suffix = f" · UPI txn {txn}"
                if utr:
                    detail_suffix += f", UTR {utr}"
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
        activity_details = f"Collected {cfg['label']} Installment #{installment_number} for '{lead.get(cfg['package']) or cfg['label']}' · Rs.{amount} via {mode}{detail_suffix} · Txn {transaction_id}"
    else:
        installments[idx]["paid"] = True

    # Keep the fee's own *_paid field in step with the money that has actually arrived,
    # but only where it is tracking that. A Treatment Fee Partial Payment plan books the
    # whole price the moment the schedule is created, so adding to it here would count the
    # same money twice. Every other schedule — including all four of the other fees' —
    # exists because a collection came up short and books only what was handed over that
    # day, so the balance has to be added as it arrives or no revenue total ever sees it.
    set_fields = {f"{cfg['details']}.installments": installments}
    if not (payload.fee == "treatment" and lead.get(cfg["mode"]) == "partial"):
        collected = installments[idx].get("amount") or 0
        set_fields[cfg["paid"]] = round((lead.get(cfg["paid"]) or 0) + collected, 2)

    await v3_col("leads").update_one({"id": lead_id}, {"$set": set_fields})

    if activity_details:
        await v3_col("lead_activity").insert_one({
            "id": str(uuid.uuid4()),
            "transaction_id": transaction_id,
            "lead_id": lead_id,
            "action": cfg["action"],
            "details": activity_details,
            "created_by": user.full_name,
            "created_by_role": user.role,
            "created_at": _now(),
        })

    updated_details = {**details, "installments": installments}
    return {"message": "Installment marked as paid", "transaction_id": transaction_id, "balance": _lead_outstanding_balance({**lead, cfg["details"]: updated_details})}
