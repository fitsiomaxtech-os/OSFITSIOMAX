import re
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import List, Optional

from database import v3_col
from deps import v3_require_roles
from schemas.v3 import V3UserOut
from stage_utils import get_first_stage_name
from routers.v3_packages import CONSULTATION_FEE_PAYMENT_MODES, TREATMENT_FEE_PAYMENT_MODES

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
    if user.role == "branch_admin":
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
    first_branch_stage = await get_first_stage_name("sales", "New Appointment")
    leads_with_no_fee = [l for l in all_branch_leads if (l.get("consultation_fee") or 0) == 0 and l.get("branch_stage") not in (None, first_branch_stage)]
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
REVENUE_ACTIONS = ["consultation_paid", "package_sold", "package_payment_collected", "treatment_fee_collected", "fee_collected"]


def _revenue_category(action: str) -> str:
    return "session" if action == "treatment_fee_collected" else "consultation"


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


def _lead_outstanding_balance(lead: dict) -> float:
    """Total still owed by this client across everything on their record: the gap
    between an assigned Consultation package's price and what was actually
    collected for it, plus — for a Partial Payment treatment fee — every
    installment after the first (which is collected at booking time; the rest
    are scheduled for later and haven't been received yet)."""
    balance = 0.0
    if lead.get("package_id"):
        balance += max((lead.get("package_price") or 0) - (lead.get("package_paid") or 0), 0)
    if lead.get("treatment_fee_payment_mode") == "partial":
        installments = (lead.get("treatment_fee_payment_details") or {}).get("installments") or []
        if len(installments) > 1:
            balance += sum(i.get("amount", 0) for i in installments[1:])
    return round(balance, 2)


@router.get("/finance/revenue-overview")
async def revenue_overview(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    branch_id: Optional[str] = None,
    _: V3UserOut = Depends(v3_require_roles("super_admin", "accountant")),
):
    """AC Overview > Total Revenue — date-range + branch scoped, built from the
    lead_activity payment trail (the only place these collections carry a real
    timestamp) rather than summing lead fields, which have no date dimension."""
    lead_query = {"branch_id": branch_id} if branch_id else {}
    leads = await v3_col("leads").find(lead_query, {"_id": 0}).to_list(20000)
    lead_ids = [l["id"] for l in leads]
    lead_branch_map = {l["id"]: l.get("branch_id") for l in leads}
    lead_name_map = {l["id"]: l.get("name", "Unknown") for l in leads}
    lead_balance_map = {l["id"]: _lead_outstanding_balance(l) for l in leads}

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
    by_day = {}
    by_branch_acc = {}
    payment_modes = {}
    transactions = []

    for act in activities:
        details = act.get("details", "")
        amount = _parse_rs_amount(details)
        category = _revenue_category(act.get("action", ""))
        mode = _parse_payment_mode(details)
        day = (act.get("created_at") or "")[:10]
        bid = lead_branch_map.get(act.get("lead_id"))
        bname = branch_name_map.get(bid, "Unknown")

        if category == "session":
            session_total += amount
        else:
            consultation_total += amount

        d = by_day.setdefault(day, {"date": day, "consultation": 0.0, "session": 0.0})
        d[category] += amount

        b = by_branch_acc.setdefault(bid or "unknown", {
            "branch_id": bid, "branch_name": bname, "consultation_total": 0.0, "session_total": 0.0,
        })
        b[f"{category}_total"] += amount

        payment_modes[mode] = payment_modes.get(mode, 0.0) + amount

        transactions.append({
            "id": act.get("id", ""),
            "date": act.get("created_at", ""),
            "branch_name": bname,
            "source": category,
            "gross": amount,
            "discount": 0.0,
            "tax": 0.0,
            "net": amount,
            "collected_by": act.get("created_by", ""),
            "lead_id": act.get("lead_id", ""),
            "client_name": lead_name_map.get(act.get("lead_id"), "Unknown"),
            "payment_mode": mode,
            "client_balance": lead_balance_map.get(act.get("lead_id"), 0.0),
        })

    total_collected = consultation_total + session_total
    trend = sorted(by_day.values(), key=lambda r: r["date"])
    for r in trend:
        r["total"] = r["consultation"] + r["session"]
    by_branch = sorted(by_branch_acc.values(), key=lambda r: -(r["consultation_total"] + r["session_total"]))
    for r in by_branch:
        r["total_revenue"] = r["consultation_total"] + r["session_total"]

    first_branch_stage = await get_first_stage_name("sales", "New Appointment")
    pending_count = len([
        l for l in leads
        if not (l.get("consultation_fee") or l.get("package_paid") or l.get("treatment_fee_paid"))
        and l.get("branch_stage") not in (None, first_branch_stage)
    ])

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
            "consultation_pct": round(consultation_total / total_collected * 100, 1) if total_collected else 0,
            "session_pct": round(session_total / total_collected * 100, 1) if total_collected else 0,
        },
        "trend": trend,
        "by_branch": by_branch,
        "payment_modes": payment_modes,
        "transactions": sorted(transactions, key=lambda t: t["date"], reverse=True)[:500],
    }


@router.get("/finance/client/{lead_id}")
async def client_transaction_history(
    lead_id: str,
    _: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin", "accountant")),
):
    """Transactions History > eye icon — one client's full profile, every payment
    they've made, their current outstanding balance, and their complete activity
    timeline (stage moves, follow-ups, diagnosis notes — not just payments)."""
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Client not found")

    branch_name = ""
    if lead.get("branch_id"):
        branch = await v3_col("branches").find_one({"id": lead["branch_id"]}, {"_id": 0, "branch_name": 1})
        branch_name = (branch or {}).get("branch_name", "")

    activity = await v3_col("lead_activity").find({"lead_id": lead_id}, {"_id": 0}).sort("created_at", -1).to_list(500)

    transactions = []
    for act in activity:
        if act.get("action") not in REVENUE_ACTIONS:
            continue
        details = act.get("details", "")
        transactions.append({
            "id": act.get("id", ""),
            "date": act.get("created_at", ""),
            "source": _revenue_category(act.get("action", "")),
            "amount": _parse_rs_amount(details),
            "payment_mode": _parse_payment_mode(details),
            "details": details,
            "collected_by": act.get("created_by", ""),
        })

    return {
        "client": {
            "id": lead["id"],
            "name": lead.get("name", "Unknown"),
            "phone": lead.get("phone", ""),
            "email": lead.get("email", ""),
            "branch_name": branch_name,
        },
        "balance": _lead_outstanding_balance(lead),
        "transactions": transactions,
        "timeline": activity,
    }


# ---------- Accountant Manage > branch-by-branch payment mode settings ----------
# Every branch accepts every payment mode by default (matches pre-existing behavior);
# Super Admin can narrow either list down per branch. Stored directly on the branch
# document since it's simple per-branch config, not its own growing collection.

class V3BranchFinanceSettingsInput(BaseModel):
    consultation_fee_payment_modes: List[str]
    treatment_fee_payment_modes: List[str]


@router.get("/branch-finance-settings/{branch_id}")
async def get_branch_finance_settings(branch_id: str, _: V3UserOut = Depends(v3_require_roles("super_admin", "branch_admin"))):
    branch = await v3_col("branches").find_one({"id": branch_id}, {"_id": 0})
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")
    return {
        "branch_id": branch_id,
        "branch_name": branch.get("branch_name", ""),
        "consultation_fee_payment_modes": branch.get("consultation_fee_payment_modes") or sorted(CONSULTATION_FEE_PAYMENT_MODES),
        "treatment_fee_payment_modes": branch.get("treatment_fee_payment_modes") or sorted(TREATMENT_FEE_PAYMENT_MODES),
    }


@router.put("/branch-finance-settings/{branch_id}")
async def update_branch_finance_settings(
    branch_id: str,
    payload: V3BranchFinanceSettingsInput,
    _: V3UserOut = Depends(v3_require_roles("super_admin")),
):
    if not await v3_col("branches").find_one({"id": branch_id}, {"_id": 0}):
        raise HTTPException(status_code=404, detail="Branch not found")
    consult_modes = [m for m in payload.consultation_fee_payment_modes if m in CONSULTATION_FEE_PAYMENT_MODES]
    treatment_modes = [m for m in payload.treatment_fee_payment_modes if m in TREATMENT_FEE_PAYMENT_MODES]
    if not consult_modes:
        raise HTTPException(status_code=400, detail="At least one Consultation Fee payment mode must stay enabled")
    if not treatment_modes:
        raise HTTPException(status_code=400, detail="At least one Treatment Fee payment mode must stay enabled")
    await v3_col("branches").update_one({"id": branch_id}, {"$set": {
        "consultation_fee_payment_modes": consult_modes,
        "treatment_fee_payment_modes": treatment_modes,
    }})
    return await get_branch_finance_settings(branch_id)
