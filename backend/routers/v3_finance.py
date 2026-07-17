from fastapi import APIRouter, Depends
from typing import Optional

from database import v3_col
from deps import v3_require_roles
from schemas.v3 import V3UserOut
from stage_utils import get_first_stage_name

router = APIRouter(prefix="/api/v3")


@router.get("/branch/finance")
async def get_branch_finance(
    fee_type: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    search: Optional[str] = None,
    user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin")),
):
    branch_id = user.branch_id
    if not branch_id:
        return {"summary": {}, "transactions": []}

    base_query = {"branch_id": branch_id}

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

    summary = {
        "total_revenue": total_consultation + total_package,
        "consultation_total": total_consultation,
        "consultation_count": len(consultation_leads),
        "package_total": total_package,
        "package_count": len(package_leads),
        "pending_count": pending_count,
        "total_patients": len(all_branch_leads),
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
        })

    return {"summary": summary, "transactions": transactions}
