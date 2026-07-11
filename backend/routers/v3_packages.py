"""Packages module — Super Admin creates packages; Branch Admin sells them."""
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from database import v3_col
from deps import v3_require_roles
from schemas.v3 import V3UserOut

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
        "consultation_stage": "Package Chosen",
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
