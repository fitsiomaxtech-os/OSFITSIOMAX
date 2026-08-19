"""Zumba registrations for a branch.

Zumba is sold alongside the clinic's own verticals but is not a clinical journey: nobody
is consulted, treated or discharged, so it never belonged in the leads pipeline where
every row carries a branch_stage and a consultation decision. It gets its own small
collection and its own tab.

What the branch actually wants to know is where the registrations came from, so the
summary is a split by source rather than by stage: someone who walked in (Direct), someone
the CONSULTANT sent across, someone the branch signed up itself, someone a Zumba master
brought with them, and someone who arrived through Fitsiomax. Fee's Collected sits among
them counting the registrations whose money is actually in, which is a different question
from how many registered.

Money is stored on the registration rather than in the finance ledger: a Zumba fee is a
flat class fee with no package, no installments and no consultation behind it, and putting
it through the leads' fee machinery would have meant inventing a lead to hang it on.
"""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from database import v3_col
from deps import v3_require_roles, is_branch_admin_role
from schemas.v3 import V3UserOut
from utils import now_iso

router = APIRouter(prefix="/api/v3")

# The five ways a registration arrives. Stored as these slugs; the tab prints them.
SOURCES = ("direct", "consultant", "branch", "masters", "fitsiomax")
DEFAULT_SOURCE = "direct"

ROLES = ("branch_admin", "super_admin")


def _source(value) -> str:
    slug = str(value or "").strip().lower()
    return slug if slug in SOURCES else DEFAULT_SOURCE


def _amount(value) -> float:
    try:
        amount = float(value or 0)
    except (TypeError, ValueError):
        return 0.0
    return amount if amount > 0 else 0.0


class ZumbaInput(BaseModel):
    name: str
    phone: Optional[str] = ""
    source: Optional[str] = DEFAULT_SOURCE
    fee_amount: Optional[float] = 0
    fee_paid: Optional[float] = 0
    notes: Optional[str] = ""


def _scoped_branch(user: V3UserOut, branch_id: Optional[str]) -> Optional[str]:
    """Branch Admin is locked to their own branch; Super Admin may pass one or omit it to
    see every branch at once, the same rule the finance and board endpoints use."""
    if is_branch_admin_role(user.role):
        return user.branch_id
    return branch_id


@router.get("/branch/zumba")
async def list_zumba(
    branch_id: Optional[str] = Query(None),
    user: V3UserOut = Depends(v3_require_roles(*ROLES)),
):
    branch_id = _scoped_branch(user, branch_id)
    if is_branch_admin_role(user.role) and not branch_id:
        return {"summary": {}, "registrations": []}

    query = {"branch_id": branch_id} if branch_id else {}
    rows = await v3_col("zumba_registrations").find(query, {"_id": 0}).sort("created_at", -1).to_list(2000)

    summary = {"all": len(rows), "fee_collected": 0, "fee_total": 0.0}
    for slug in SOURCES:
        summary[slug] = 0
    for r in rows:
        summary[_source(r.get("source"))] += 1
        paid = _amount(r.get("fee_paid"))
        if paid > 0:
            summary["fee_collected"] += 1
            summary["fee_total"] += paid

    return {"summary": summary, "registrations": rows}


@router.post("/branch/zumba")
async def add_zumba(
    payload: ZumbaInput,
    branch_id: Optional[str] = Query(None),
    user: V3UserOut = Depends(v3_require_roles(*ROLES)),
):
    branch_id = _scoped_branch(user, branch_id)
    if not branch_id:
        raise HTTPException(status_code=400, detail="Pick a branch to register against")

    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")

    row = {
        "id": str(uuid.uuid4()),
        "branch_id": branch_id,
        "name": name,
        "phone": (payload.phone or "").strip(),
        "source": _source(payload.source),
        "fee_amount": _amount(payload.fee_amount),
        "fee_paid": _amount(payload.fee_paid),
        "notes": (payload.notes or "").strip(),
        "created_at": now_iso(),
        "created_by": user.full_name or user.email,
    }
    await v3_col("zumba_registrations").insert_one(dict(row))
    return row


@router.patch("/branch/zumba/{registration_id}")
async def update_zumba(
    registration_id: str,
    payload: ZumbaInput,
    user: V3UserOut = Depends(v3_require_roles(*ROLES)),
):
    existing = await v3_col("zumba_registrations").find_one({"id": registration_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Registration not found")
    # A Branch Admin edits their own branch's registrations and nobody else's.
    if is_branch_admin_role(user.role) and existing.get("branch_id") != user.branch_id:
        raise HTTPException(status_code=403, detail="Not your branch")

    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")

    changes = {
        "name": name,
        "phone": (payload.phone or "").strip(),
        "source": _source(payload.source),
        "fee_amount": _amount(payload.fee_amount),
        "fee_paid": _amount(payload.fee_paid),
        "notes": (payload.notes or "").strip(),
        "updated_at": now_iso(),
        "updated_by": user.full_name or user.email,
    }
    await v3_col("zumba_registrations").update_one({"id": registration_id}, {"$set": changes})
    return {**existing, **changes}


@router.delete("/branch/zumba/{registration_id}")
async def delete_zumba(
    registration_id: str,
    user: V3UserOut = Depends(v3_require_roles(*ROLES)),
):
    existing = await v3_col("zumba_registrations").find_one({"id": registration_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Registration not found")
    if is_branch_admin_role(user.role) and existing.get("branch_id") != user.branch_id:
        raise HTTPException(status_code=403, detail="Not your branch")
    await v3_col("zumba_registrations").delete_one({"id": registration_id})
    return {"deleted": True}
