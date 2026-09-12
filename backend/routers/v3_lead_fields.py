from fastapi import APIRouter, Depends, HTTPException
from typing import Optional, List, Literal, Any, Dict
from pydantic import BaseModel
import uuid

from database import v3_col
from utils import now_iso
from deps import v3_require_roles, v3_current_user
from schemas.v3 import V3UserOut


router = APIRouter(prefix="/api/v3/lead-fields")


FIELD_TYPES = ["text", "textarea", "number", "date", "email", "phone", "select"]


class FieldCreate(BaseModel):
    label: str
    key: Optional[str] = None
    type: Literal["text", "textarea", "number", "date", "email", "phone", "select"] = "text"
    options: Optional[List[str]] = None
    placeholder: Optional[str] = ""
    required: Optional[bool] = False


class FieldUpdate(BaseModel):
    label: Optional[str] = None
    type: Optional[Literal["text", "textarea", "number", "date", "email", "phone", "select"]] = None
    options: Optional[List[str]] = None
    placeholder: Optional[str] = None
    required: Optional[bool] = None


def _slugify(label: str) -> str:
    out = "".join(ch.lower() if ch.isalnum() else "_" for ch in label).strip("_")
    while "__" in out:
        out = out.replace("__", "_")
    return out or "field"


@router.get("")
async def list_custom_fields(_: V3UserOut = Depends(v3_current_user)):
    rows = await v3_col("custom_lead_fields").find({}, {"_id": 0}).sort("created_at", 1).to_list(200)
    return rows


@router.post("")
async def create_custom_field(payload: FieldCreate, _: V3UserOut = Depends(v3_require_roles("super_admin", "business_dev"))):
    key = _slugify(payload.key) if payload.key else _slugify(payload.label)
    existing = await v3_col("custom_lead_fields").find_one({"key": key}, {"_id": 0, "id": 1})
    if existing:
        raise HTTPException(status_code=409, detail=f"Field key '{key}' already exists")
    doc = {
        "id": str(uuid.uuid4()),
        "label": payload.label,
        "key": key,
        "type": payload.type,
        "options": payload.options or [],
        "placeholder": payload.placeholder or "",
        "required": bool(payload.required),
        "created_at": now_iso(),
    }
    await v3_col("custom_lead_fields").insert_one(doc.copy())
    return doc


@router.patch("/{field_id}")
async def update_custom_field(field_id: str, payload: FieldUpdate, _: V3UserOut = Depends(v3_require_roles("super_admin", "business_dev"))):
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No updates")
    res = await v3_col("custom_lead_fields").update_one({"id": field_id}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Field not found")
    return await v3_col("custom_lead_fields").find_one({"id": field_id}, {"_id": 0})


@router.delete("/{field_id}")
async def delete_custom_field(field_id: str, _: V3UserOut = Depends(v3_require_roles("super_admin", "business_dev"))):
    res = await v3_col("custom_lead_fields").delete_one({"id": field_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Field not found")
    return {"message": "Field deleted"}
