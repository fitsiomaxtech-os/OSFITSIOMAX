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
    already assigned — Cash/UPI/Card only. The amount is never client-supplied: it's
    always the package_price the Head Physio's package assignment set, so Branch
    Admin can confirm the payment mode but can never change the fee itself. Callable
    while the lead is at 'Consultation Visit' (first collection) or already at
    'Consultation Fee Collected' (correcting/updating a payment already on file)."""
    if payload.payment_mode not in CONSULTATION_FEE_PAYMENT_MODES:
        raise HTTPException(status_code=400, detail=f"Consultation Fee only accepts: {sorted(CONSULTATION_FEE_PAYMENT_MODES)}")
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if lead.get("consultation_stage") not in ("Consultation Visit", "Consultation Fee Collected"):
        raise HTTPException(status_code=400, detail="Consultation Fee can only be collected once the Head Physio has completed the consultation")
    if not lead.get("package_id") or lead.get("package_price") is None:
        raise HTTPException(status_code=400, detail="No consultation package assigned yet")

    amount = lead["package_price"]
    is_update = lead.get("package_paid") is not None
    await v3_col("leads").update_one({"id": lead_id}, {"$set": {
        "package_paid": amount,
        "package_payment_mode": payload.payment_mode,
        "consultation_stage": "Consultation Fee Collected",
        "updated_at": _now(),
    }})
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "package_payment_collected",
        "details": f"{'Updated' if is_update else 'Collected'} Consultation Fee Rs.{amount} for package '{lead.get('package_name')}' via {payload.payment_mode}",
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": _now(),
    })
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return {"message": "Payment collected", "lead": V3LeadOut(**updated).model_dump()}


@router.post("/leads/{lead_id}/collect-treatment-fee", response_model=dict)
async def collect_treatment_fee(lead_id: str, payload: V3CollectTreatmentFeeInput, user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin"))):
    """Branch admin collects the Treatment Fee for the Session package the Head
    Physio already chose during the consultation decision (Consultation + Treatment)
    — any payment method is allowed here, including Cheque/Partial, but neither the
    package nor the amount can be changed here; both are locked in from
    session_package_id/session_package_price. Moves on to Physio Assign once
    collected. Callable while at 'Consultation Fee Collected' (first collection) or
    already at 'Treatment Fee Collected' (correcting/updating a payment on file)."""
    if payload.payment_mode not in TREATMENT_FEE_PAYMENT_MODES:
        raise HTTPException(status_code=400, detail=f"Treatment Fee only accepts: {sorted(TREATMENT_FEE_PAYMENT_MODES)}")
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if lead.get("consultation_decision") != "consultation_treatment":
        raise HTTPException(status_code=400, detail="This patient's consultation was marked 'Consultation Only' — no Treatment Fee to collect")
    if lead.get("consultation_stage") not in ("Consultation Fee Collected", "Treatment Fee Collected"):
        raise HTTPException(status_code=400, detail="Treatment Fee can only be collected after the Consultation Fee has been collected")
    if not lead.get("session_package_id") or lead.get("session_package_price") is None:
        raise HTTPException(status_code=400, detail="No treatment package was selected by the Head Physio yet")

    amount = lead["session_package_price"]

    # Mode-specific required fields + a structured payment_details record for the
    # receipt/activity log. Card number is never persisted beyond its last 4 digits.
    payment_details = {}
    detail_suffix = ""
    installments = []
    if payload.payment_mode == "card":
        if not payload.card_number or not payload.card_number.strip() or not payload.card_holder_name or not payload.card_holder_name.strip():
            raise HTTPException(status_code=400, detail="Card Number and Card Holder Name are required")
        last4 = "".join(ch for ch in payload.card_number if ch.isdigit())[-4:]
        payment_details = {"card_last4": last4, "card_holder_name": payload.card_holder_name.strip()}
        detail_suffix = f" · Card ****{last4}, {payload.card_holder_name.strip()}"
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
            # The first installment is collected right now, as part of this same
            # transaction — every later one starts unpaid, due on its own date.
            "installments": [{"amount": inst.amount, "due_date": inst.due_date, "paid": i == 0} for i, inst in enumerate(installments)],
        }
        ordinals = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth"]
        parts = [
            f"{ordinals[i] if i < len(ordinals) else f'#{i + 1}'} Rs.{inst.amount} due {inst.due_date}"
            for i, inst in enumerate(installments)
        ]
        detail_suffix = f" · {', '.join(parts)}"

    is_update = lead.get("treatment_fee_paid") is not None
    await v3_col("leads").update_one({"id": lead_id}, {"$set": {
        "treatment_fee_paid": amount,
        "treatment_fee_payment_mode": payload.payment_mode,
        "treatment_fee_payment_details": payment_details or None,
        "consultation_stage": "Treatment Fee Collected",
        "updated_at": _now(),
    }})
    # For Partial Payment, only the first installment is actually collected right
    # now — the rest are just scheduled — so the log should say what was really
    # received today, not the full schedule's total.
    collected_now = installments[0].amount if payload.payment_mode == "partial" else amount
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "treatment_fee_collected",
        "details": f"{'Updated' if is_update else 'Collected'} Treatment Fee for session package '{lead.get('session_package_name')}' ({lead.get('session_package_sessions')} sessions) · Rs.{collected_now} via {payload.payment_mode}{detail_suffix}",
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
    if lead.get("consultation_stage") not in ("Consultation Fee Collected", "Consultation Completed"):
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
