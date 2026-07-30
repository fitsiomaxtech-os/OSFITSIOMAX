"""Packages module — Super Admin creates packages; Branch Admin sells them."""
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from database import v3_col
from deps import v3_require_roles
from schemas.v3 import (
    V3UserOut, V3LeadOut, V3DiagnosisInput, V3SellStoreItemInput,
    V3CollectPackagePaymentInput, V3CollectTreatmentFeeInput,
    V3PhysioDiagnosisInput, V3TreatmentSummaryInput,
)

router = APIRouter(prefix="/api/v3", tags=["packages"])


def _now():
    return datetime.now(timezone.utc).isoformat()


class PackageIn(BaseModel):
    name: str
    weeks: int = Field(ge=1, le=104)
    sessions_per_week: int = Field(ge=1, le=14, default=2)
    price: float = Field(ge=0)
    description: Optional[str] = ""
    services: List[str] = []
    active: bool = True


class PackageOut(PackageIn):
    id: str
    total_sessions: int
    created_at: str
    updated_at: str


@router.get("/packages", response_model=List[PackageOut])
async def list_packages(active_only: bool = False, _: V3UserOut = Depends(v3_require_roles("super_admin", "branch_admin", "head_physio"))):
    q = {"active": True} if active_only else {}
    docs = await v3_col("packages").find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return docs


@router.post("/packages", response_model=PackageOut)
async def create_package(payload: PackageIn, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    doc = payload.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["total_sessions"] = payload.weeks * payload.sessions_per_week
    doc["created_at"] = _now()
    doc["updated_at"] = _now()
    await v3_col("packages").insert_one(doc)
    return doc


@router.put("/packages/{package_id}", response_model=PackageOut)
async def update_package(package_id: str, payload: PackageIn, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    update = payload.model_dump()
    update["total_sessions"] = payload.weeks * payload.sessions_per_week
    update["updated_at"] = _now()
    res = await v3_col("packages").update_one({"id": package_id}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Package not found")
    doc = await v3_col("packages").find_one({"id": package_id}, {"_id": 0})
    return doc


@router.delete("/packages/{package_id}")
async def delete_package(package_id: str, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    res = await v3_col("packages").delete_one({"id": package_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Package not found")
    return {"message": "Package deleted"}


class SellPackageInput(BaseModel):
    package_id: str
    paid_amount: Optional[float] = None
    notes: Optional[str] = ""


@router.post("/leads/{lead_id}/sell-package", response_model=dict)
async def sell_package(lead_id: str, payload: SellPackageInput, user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin", "head_physio"))):
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    pkg = await v3_col("packages").find_one({"id": payload.package_id}, {"_id": 0})
    if not pkg:
        raise HTTPException(status_code=404, detail="Package not found")
    paid = payload.paid_amount if payload.paid_amount is not None else pkg.get("price", 0)
    await v3_col("leads").update_one({"id": lead_id}, {"$set": {
        "package_id": pkg["id"],
        "package_name": pkg["name"],
        "package_weeks": pkg["weeks"],
        "package_price": pkg["price"],
        "package_paid": paid,
        "consultation_stage": "Treatment Fee",
        "updated_at": _now(),
    }})
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "package_sold",
        "details": f"Sold package: {pkg['name']} · {pkg['weeks']}w · ₹{paid}" + (f" · {payload.notes}" if payload.notes else ""),
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": _now(),
    })
    return {"message": "Package sold", "lead_id": lead_id, "package": pkg, "paid": paid}


@router.post("/leads/{lead_id}/diagnosis", response_model=V3LeadOut)
async def save_diagnosis(lead_id: str, payload: V3DiagnosisInput, user: V3UserOut = Depends(v3_require_roles("head_physio", "branch_admin", "super_admin"))):
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    await v3_col("leads").update_one({"id": lead_id}, {"$set": {"diagnosis": payload.diagnosis, "updated_at": _now()}})
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "diagnosis_recorded",
        "details": f"Diagnosis recorded by {user.full_name}: {payload.diagnosis}",
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": _now(),
    })
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return V3LeadOut(**updated)


@router.post("/leads/{lead_id}/sell-store-item", response_model=dict)
async def sell_store_item(lead_id: str, payload: V3SellStoreItemInput, user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin"))):
    """Branch admin sells + collects payment for a consultation item, in one step."""
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    item = await v3_col("store_items").find_one({"id": payload.item_id}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Store item not found")
    if item.get("item_type", "consultation") == "session":
        raise HTTPException(status_code=400, detail="Session packages are assigned by the consultant, then collected separately — use assign-package / collect-package-payment")

    price = item.get("price_online") if payload.mode == "online" else item.get("price_offline")
    paid = payload.paid_amount if payload.paid_amount is not None else price

    await v3_col("leads").update_one({"id": lead_id}, {"$set": {
        "consultation_fee": paid,
        "consultation_item_name": item["name"],
        "consultation_mode": payload.mode,
        "consultation_payment_mode": payload.payment_mode,
        "consultation_stage": "Consultation Visit",
        "updated_at": _now(),
    }})
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "consultation_paid",
        "details": f"Consultation '{item['name']}' ({payload.mode}) paid: Rs.{paid} via {payload.payment_mode}" + (f" · {payload.notes}" if payload.notes else ""),
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": _now(),
    })
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return {"message": "Sold", "lead_id": lead_id, "item": item, "mode": payload.mode, "paid": paid, "lead": V3LeadOut(**updated).model_dump()}


CONSULTATION_FEE_PAYMENT_MODES = {"cash", "upi", "card"}
TREATMENT_FEE_PAYMENT_MODES = {"cash", "upi", "card", "cheque", "partial"}


@router.post("/leads/{lead_id}/collect-package-payment", response_model=dict)
async def collect_package_payment(lead_id: str, payload: V3CollectPackagePaymentInput, user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin"))):
    """Branch admin collects the Consultation Fee for the package the consultant
    already assigned — Cash/UPI/Card. The amount defaults to package_price but Branch
    Admin can manually override it (discount, rounding, partial cash collected).
    Every mode requires an explicit `confirmed` acknowledgement before it's accepted —
    a deliberate double-check, not a single click. Callable while the lead is at
    'Consultation Visit' (first collection) or already at 'Fee Collected' (correcting/
    updating a payment already on file)."""
    if payload.payment_mode not in CONSULTATION_FEE_PAYMENT_MODES:
        raise HTTPException(status_code=400, detail=f"Consultation Fee only accepts: {sorted(CONSULTATION_FEE_PAYMENT_MODES)}")
    if not payload.confirmed:
        raise HTTPException(status_code=400, detail="Please confirm the payment before submitting")
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if lead.get("consultation_stage") not in ("Consultation Visit", "Fee Collected"):
        raise HTTPException(status_code=400, detail="Consultation Fee can only be collected once the Head Physio has completed the consultation")
    if not lead.get("package_id") or lead.get("package_price") is None:
        raise HTTPException(status_code=400, detail="No consultation package assigned yet")

    original_price = lead["package_price"]
    amount = payload.amount if payload.amount is not None else original_price
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than zero")

    # Assigned price vs what was actually collected — Branch Admin can negotiate a
    # discount on the spot (e.g. Rs.800 assigned, client only has Rs.750). The gap is
    # logged on the activity record so Transaction History shows the reason, not just
    # the final number.
    discount_amount = round(original_price - amount, 2) if original_price is not None else 0
    discount_suffix = ""
    discount_reason = None
    if discount_amount > 0:
        discount_reason = "Negotiated discount"
        discount_suffix = f" · Actual Price Rs.{original_price}, Negotiated Discount Rs.{discount_amount}"
    elif discount_amount < 0:
        discount_reason = "Additional amount collected"
        discount_suffix = f" · Actual Price Rs.{original_price}, Rs.{abs(discount_amount)} above assigned fee"

    payment_details = {}
    detail_suffix = ""
    if payload.payment_mode == "upi":
        if not payload.upi_transaction_id or not payload.upi_transaction_id.strip() or not payload.upi_utr or not payload.upi_utr.strip():
            raise HTTPException(status_code=400, detail="UPI Transaction ID and UTR are required")
        payment_details = {"upi_transaction_id": payload.upi_transaction_id.strip(), "upi_utr": payload.upi_utr.strip()}
        detail_suffix = f" · UPI txn {payload.upi_transaction_id.strip()}, UTR {payload.upi_utr.strip()}"
    elif payload.payment_mode == "card":
        if not all([payload.account_number and payload.account_number.strip(), payload.account_holder_name and payload.account_holder_name.strip(),
                    payload.bank_name and payload.bank_name.strip(), payload.ifsc_code and payload.ifsc_code.strip()]):
            raise HTTPException(status_code=400, detail="Account Number, Account Holder Name, Bank Name and IFSC Code are required")
        last4 = "".join(ch for ch in payload.account_number if ch.isdigit())[-4:]
        payment_details = {
            "account_last4": last4,
            "account_holder_name": payload.account_holder_name.strip(),
            "bank_name": payload.bank_name.strip(),
            "ifsc_code": payload.ifsc_code.strip().upper(),
        }
        detail_suffix = f" · A/C ****{last4}, {payload.account_holder_name.strip()}, {payload.bank_name.strip()} ({payload.ifsc_code.strip().upper()})"

    is_update = lead.get("package_paid") is not None
    await v3_col("leads").update_one({"id": lead_id}, {"$set": {
        "package_paid": amount,
        "package_payment_mode": payload.payment_mode,
        "package_payment_details": payment_details or None,
        "consultation_stage": "Fee Collected",
        "updated_at": _now(),
    }})
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "package_payment_collected",
        "details": f"{'Updated' if is_update else 'Collected'} Consultation Fee Rs.{amount} for package '{lead.get('package_name')}' via {payload.payment_mode}{detail_suffix}{discount_suffix}",
        "original_amount": original_price,
        "collected_amount": amount,
        "discount_amount": discount_amount if discount_amount != 0 else None,
        "discount_reason": discount_reason,
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": _now(),
    })
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return {"message": "Payment collected", "lead": V3LeadOut(**updated).model_dump()}


@router.post("/leads/{lead_id}/collect-treatment-fee", response_model=dict)
async def collect_treatment_fee(lead_id: str, payload: V3CollectTreatmentFeeInput, user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin"))):
    """Branch admin collects the Treatment Fee for the Session package the Head
    Physio already chose during the consultation decision (Consultation + Treatment).
    The package itself is locked in from session_package_id — Cash/UPI/Card can
    manually override the amount (discount, rounding, partial cash collected) and
    require an explicit confirmation; Cheque/Partial Payment keep the locked
    session_package_price as before. Both Consultation Fee and Treatment Fee are
    collected while the lead rests in the 'Fee Collected' stage; it stays there
    after this call — moving on to Physio Assign is a separate, explicit action
    (assign-consultation-physio), not an automatic side effect of payment."""
    if payload.payment_mode not in TREATMENT_FEE_PAYMENT_MODES:
        raise HTTPException(status_code=400, detail=f"Treatment Fee only accepts: {sorted(TREATMENT_FEE_PAYMENT_MODES)}")
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if lead.get("consultation_decision") != "consultation_treatment":
        raise HTTPException(status_code=400, detail="This patient's consultation was marked 'Consultation Only' — no Treatment Fee to collect")
    if lead.get("consultation_stage") not in ("Fee Collected", "Physio Assign"):
        raise HTTPException(status_code=400, detail="Treatment Fee can only be collected after the Consultation Fee has been collected")
    if not lead.get("session_package_id") or lead.get("session_package_price") is None:
        raise HTTPException(status_code=400, detail="No treatment package was selected by the Head Physio yet")

    # Cash/UPI/Card can be manually adjusted (discount, rounding, partial cash
    # collected); Cheque and Partial Payment keep the locked session_package_price.
    original_price = lead["session_package_price"]
    total_sessions = lead.get("session_package_sessions") or 0
    per_session_rate = (original_price / total_sessions) if total_sessions else 0

    # Cash/UPI/Card/Cheque can ALSO collect for only some of the package's sessions
    # right now (e.g. 5 of 10) — sessions_now defaults to every session (today's
    # full-collection behavior) when the caller doesn't specify it.
    sessions_now = total_sessions
    is_partial_sessions = False
    if payload.payment_mode in ("cash", "upi", "card", "cheque") and payload.sessions_now is not None:
        sessions_now = payload.sessions_now
        if total_sessions and (sessions_now <= 0 or sessions_now > total_sessions):
            raise HTTPException(status_code=400, detail="Sessions Covered Now must be between 1 and the package's total sessions")
        is_partial_sessions = total_sessions > 0 and sessions_now < total_sessions
        if is_partial_sessions and not payload.balance_due_date:
            raise HTTPException(status_code=400, detail="A due date is required for the balance sessions")

    computed_amount = round(sessions_now * per_session_rate, 2) if total_sessions else original_price

    if payload.payment_mode in ("cash", "upi", "card"):
        amount = payload.amount if payload.amount is not None else computed_amount
        if amount <= 0:
            raise HTTPException(status_code=400, detail="Amount must be greater than zero")
    elif payload.payment_mode == "cheque":
        amount = computed_amount
    else:
        amount = original_price

    if payload.payment_mode in ("cash", "upi", "card") and not payload.confirmed:
        raise HTTPException(status_code=400, detail="Please confirm the payment before submitting")

    # Same negotiated-discount tracking as the Consultation Fee — compared against
    # what these specific sessions should cost (not the whole package's price),
    # so collecting for fewer sessions is never mistaken for a discount.
    discount_amount = 0
    discount_reason = None
    discount_suffix = ""
    if payload.payment_mode in ("cash", "upi", "card"):
        discount_amount = round(computed_amount - amount, 2)
        if discount_amount > 0:
            discount_reason = "Negotiated discount"
            discount_suffix = f" · Actual Price Rs.{computed_amount}, Negotiated Discount Rs.{discount_amount}"
        elif discount_amount < 0:
            discount_reason = "Additional amount collected"
            discount_suffix = f" · Actual Price Rs.{computed_amount}, Rs.{abs(discount_amount)} above assigned fee"

    # Mode-specific required fields + a structured payment_details record for the
    # receipt/activity log. Account number is never persisted beyond its last 4 digits.
    payment_details = {}
    detail_suffix = ""
    installments = []
    if payload.payment_mode == "upi":
        if not payload.upi_transaction_id or not payload.upi_transaction_id.strip() or not payload.upi_utr or not payload.upi_utr.strip():
            raise HTTPException(status_code=400, detail="UPI Transaction ID and UTR are required")
        payment_details = {"upi_transaction_id": payload.upi_transaction_id.strip(), "upi_utr": payload.upi_utr.strip()}
        detail_suffix = f" · UPI txn {payload.upi_transaction_id.strip()}, UTR {payload.upi_utr.strip()}"
    elif payload.payment_mode == "card":
        if not all([payload.account_number and payload.account_number.strip(), payload.account_holder_name and payload.account_holder_name.strip(),
                    payload.bank_name and payload.bank_name.strip(), payload.ifsc_code and payload.ifsc_code.strip()]):
            raise HTTPException(status_code=400, detail="Account Number, Account Holder Name, Bank Name and IFSC Code are required")
        last4 = "".join(ch for ch in payload.account_number if ch.isdigit())[-4:]
        payment_details = {
            "account_last4": last4,
            "account_holder_name": payload.account_holder_name.strip(),
            "bank_name": payload.bank_name.strip(),
            "ifsc_code": payload.ifsc_code.strip().upper(),
        }
        detail_suffix = f" · A/C ****{last4}, {payload.account_holder_name.strip()}, {payload.bank_name.strip()} ({payload.ifsc_code.strip().upper()})"
    elif payload.payment_mode == "cheque":
        if not payload.bank_name or not payload.bank_name.strip() or not payload.cheque_number or not payload.cheque_number.strip():
            raise HTTPException(status_code=400, detail="Bank Name and Cheque Number are required")
        payment_details = {
            "bank_name": payload.bank_name.strip(),
            "cheque_number": payload.cheque_number.strip(),
            "amount": amount,
        }
        detail_suffix = f" · Cheque #{payload.cheque_number.strip()}, {payload.bank_name.strip()}"
    elif payload.payment_mode == "partial":
        installments = payload.partial_installments or []
        if len(installments) < 2:
            raise HTTPException(status_code=400, detail="At least two installments are required for Partial Payment")
        if any(inst.amount <= 0 or not inst.due_date for inst in installments):
            raise HTTPException(status_code=400, detail="Every installment needs an amount and a due date")
        installments_total = round(sum(inst.amount for inst in installments), 2)
        if installments_total != round(amount, 2):
            raise HTTPException(status_code=400, detail="Installment amounts must add up to the Treatment Fee")
        payment_details = {
            # This call only schedules the plan — every installment starts unpaid.
            # Collecting one (including one due today) is a separate, explicit action
            # (mark_installment_paid), not an automatic side effect of scheduling.
            "installments": [{"amount": inst.amount, "due_date": inst.due_date, "paid": False} for inst in installments],
        }
        ordinals = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth"]
        parts = [
            f"{ordinals[i] if i < len(ordinals) else f'#{i + 1}'} Rs.{inst.amount} due {inst.due_date}"
            for i, inst in enumerate(installments)
        ]
        detail_suffix = f" · {', '.join(parts)}"

    # Cash/UPI/Card/Cheque covering only some sessions right now — schedule the
    # remaining sessions as a single balance installment, reusing the exact same
    # `installments` shape Partial Payment uses so Payment Schedules / Outstanding
    # Amount / the client's own Payment Schedule panel all pick it up for free.
    balance_suffix = ""
    if payload.payment_mode in ("cash", "upi", "card", "cheque") and is_partial_sessions:
        remaining_sessions = total_sessions - sessions_now
        remaining_amount = round(original_price - amount, 2)
        payment_details["installments"] = [
            {"sessions": sessions_now, "amount": amount, "due_date": _now()[:10], "paid": True},
            {"sessions": remaining_sessions, "amount": remaining_amount, "due_date": payload.balance_due_date, "paid": False},
        ]
        balance_suffix = f" · covers {sessions_now} of {total_sessions} sessions, balance Rs.{remaining_amount} ({remaining_sessions} sessions) due {payload.balance_due_date}"

    is_update = lead.get("treatment_fee_paid") is not None
    # Rests at 'Fee Collected' on first collection — Physio Assign only happens via
    # the separate assign-consultation-physio action. If this is just a payment-mode
    # correction on a lead that's already past that (physio already assigned), leave
    # its stage where it is rather than moving it backward.
    stage_after = "Physio Assign" if lead.get("consultation_stage") == "Physio Assign" else "Fee Collected"
    await v3_col("leads").update_one({"id": lead_id}, {"$set": {
        "treatment_fee_paid": amount,
        "treatment_fee_payment_mode": payload.payment_mode,
        "treatment_fee_payment_details": payment_details or None,
        "consultation_stage": stage_after,
        "updated_at": _now(),
    }})
    # Partial Payment schedules nothing as collected yet — the log should say a
    # schedule was created, not that money came in, since collecting any one
    # installment (including one due today) is now its own separate action.
    if payload.payment_mode == "partial":
        details = f"{'Updated' if is_update else 'Created'} Payment Schedule for session package '{lead.get('session_package_name')}' ({lead.get('session_package_sessions')} sessions) · Rs.{amount} across {len(installments)} installments{detail_suffix}"
    else:
        details = f"{'Updated' if is_update else 'Collected'} Treatment Fee for session package '{lead.get('session_package_name')}' ({lead.get('session_package_sessions')} sessions) · Rs.{amount} via {payload.payment_mode}{detail_suffix}{discount_suffix}{balance_suffix}"
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "treatment_fee_collected",
        "details": details,
        "original_amount": computed_amount if payload.payment_mode in ("cash", "upi", "card") else None,
        "collected_amount": amount if payload.payment_mode in ("cash", "upi", "card") else None,
        "discount_amount": discount_amount if discount_amount != 0 else None,
        "discount_reason": discount_reason,
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": _now(),
    })
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return {"message": "Payment collected", "lead": V3LeadOut(**updated).model_dump()}


@router.post("/leads/{lead_id}/mark-consultation-completed", response_model=dict)
async def mark_consultation_completed(lead_id: str, user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin"))):
    """Branch Admin closes out a 'Consultation Only' patient once the Consultation
    Fee has been collected — no Treatment Fee is ever collected on this path."""
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if lead.get("consultation_decision") != "consultation_only":
        raise HTTPException(status_code=400, detail="Only a 'Consultation Only' patient can be marked completed here")
    if lead.get("consultation_stage") not in ("Fee Collected", "Consultation Completed"):
        raise HTTPException(status_code=400, detail="Consultation Fee must be collected before marking the consultation completed")

    await v3_col("leads").update_one({"id": lead_id}, {"$set": {
        "consultation_stage": "Consultation Completed",
        "updated_at": _now(),
    }})
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "consultation_completed",
        "details": "Consultation marked completed (Consultation Only — no treatment sessions)",
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": _now(),
    })
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return {"message": "Consultation completed", "lead": V3LeadOut(**updated).model_dump()}


@router.post("/leads/{lead_id}/physio-diagnosis", response_model=V3LeadOut)
async def save_physio_diagnosis(lead_id: str, payload: V3PhysioDiagnosisInput, user: V3UserOut = Depends(v3_require_roles("head_physio", "super_admin"))):
    """Head Physio's own diagnosis report — separate from Pre-Sales' basic
    `diagnosis` field, which stays read-only reference material here."""
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if lead.get("physio_diagnosis_locked"):
        raise HTTPException(status_code=400, detail="Diagnosis report is locked — unlock it first to edit")
    await v3_col("leads").update_one({"id": lead_id}, {"$set": {
        "physio_diagnosis_report": payload.report,
        "physio_diagnosis_locked": payload.locked,
        "updated_at": _now(),
    }})
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "physio_diagnosis_saved",
        "details": f"Diagnosis report {'saved & locked' if payload.locked else 'saved'} by {user.full_name}",
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": _now(),
    })
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return V3LeadOut(**updated)


@router.put("/leads/{lead_id}/physio-diagnosis/unlock", response_model=V3LeadOut)
async def unlock_physio_diagnosis(lead_id: str, user: V3UserOut = Depends(v3_require_roles("head_physio", "super_admin"))):
    await v3_col("leads").update_one({"id": lead_id}, {"$set": {"physio_diagnosis_locked": False, "updated_at": _now()}})
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not updated:
        raise HTTPException(status_code=404, detail="Lead not found")
    return V3LeadOut(**updated)


@router.post("/leads/{lead_id}/treatment-summary", response_model=V3LeadOut)
async def save_treatment_summary(lead_id: str, payload: V3TreatmentSummaryInput, user: V3UserOut = Depends(v3_require_roles("head_physio", "super_admin"))):
    """Head Physio's treatment plan summary — what treatment to give the patient."""
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if lead.get("treatment_summary_locked"):
        raise HTTPException(status_code=400, detail="Treatment summary is locked — unlock it first to edit")
    await v3_col("leads").update_one({"id": lead_id}, {"$set": {
        "treatment_summary": payload.summary,
        "treatment_summary_locked": payload.locked,
        "updated_at": _now(),
    }})
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "treatment_summary_saved",
        "details": f"Treatment summary {'saved & locked' if payload.locked else 'saved'} by {user.full_name}",
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": _now(),
    })
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return V3LeadOut(**updated)


@router.put("/leads/{lead_id}/treatment-summary/unlock", response_model=V3LeadOut)
async def unlock_treatment_summary(lead_id: str, user: V3UserOut = Depends(v3_require_roles("head_physio", "super_admin"))):
    await v3_col("leads").update_one({"id": lead_id}, {"$set": {"treatment_summary_locked": False, "updated_at": _now()}})
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not updated:
        raise HTTPException(status_code=404, detail="Lead not found")
    return V3LeadOut(**updated)
