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
    V3AssignPackageInput, V3CollectPackagePaymentInput,
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
async def list_packages(active_only: bool = False, _: V3UserOut = Depends(v3_require_roles("super_admin", "branch_admin", "head_physio", "pre_sales"))):
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


@router.post("/leads/{lead_id}/assign-package", response_model=dict)
async def assign_package(lead_id: str, payload: V3AssignPackageInput, user: V3UserOut = Depends(v3_require_roles("head_physio", "super_admin"))):
    """Consultant assigns a package to the patient at the Consultation Pack stage.
    Session items (e.g. 7 sessions for 1 week) default to their preset count, which
    the consultant can override — price scales proportionally from the per-session
    rate. Consultation items (a single-visit item, e.g. "Initial Consultation — 30
    min") carry no session count, so they're assigned as-is with a flat price and
    package_sessions left unset. No payment is collected here — branch admin
    collects it separately via collect-package-payment."""
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    item = await v3_col("store_items").find_one({"id": payload.item_id}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Store item not found")
    if item.get("item_type") not in ("session", "consultation"):
        raise HTTPException(status_code=400, detail="Only session or consultation items can be assigned")

    base_price = item.get("price_online") if payload.mode == "online" else item.get("price_offline")

    if item.get("item_type") == "session":
        base_sessions = item.get("sessions_online") if payload.mode == "online" else item.get("sessions_offline")
        sessions = payload.sessions_override if payload.sessions_override and payload.sessions_override > 0 else base_sessions
        if base_sessions and base_price is not None:
            per_session_rate = base_price / base_sessions
            price = round(per_session_rate * sessions, 2)
        else:
            price = base_price
        detail_suffix = f" · {sessions} sessions"
    else:
        sessions = None
        price = base_price
        detail_suffix = f" · {item.get('duration_minutes', '?')} min"

    await v3_col("leads").update_one({"id": lead_id}, {"$set": {
        "package_id": item["id"],
        "package_name": item["name"],
        "package_price": price,
        "package_sessions": sessions,
        "package_mode": payload.mode,
        "package_paid": None,
        "package_payment_mode": None,
        "head_consultation_stage": "Consultation Pack",
        "consultation_stage": "Consultation Pack",  # mirrored onto Branch's view-only stage
        "updated_at": _now(),
    }})
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "package_assigned",
        "details": f"Assigned package '{item['name']}' ({payload.mode}){detail_suffix} · Rs.{price} — awaiting payment collection",
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": _now(),
    })
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return {"message": "Package assigned", "lead": V3LeadOut(**updated).model_dump()}


@router.post("/leads/{lead_id}/collect-package-payment", response_model=dict)
async def collect_package_payment(lead_id: str, payload: V3CollectPackagePaymentInput, user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin"))):
    """Branch admin collects payment for a session package the consultant already assigned."""
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if not lead.get("package_id"):
        raise HTTPException(status_code=400, detail="No package assigned yet")

    await v3_col("leads").update_one({"id": lead_id}, {"$set": {
        "package_paid": payload.paid_amount,
        "package_payment_mode": payload.payment_mode,
        "updated_at": _now(),
    }})
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "package_payment_collected",
        "details": f"Collected Rs.{payload.paid_amount} for package '{lead.get('package_name')}' via {payload.payment_mode}",
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": _now(),
    })
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return {"message": "Payment collected", "lead": V3LeadOut(**updated).model_dump()}


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
