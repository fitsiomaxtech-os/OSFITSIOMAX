"""FITSIO STORE — consultation catalog items (name, description, image, online/offline)."""
import os
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from database import v3_col
from deps import v3_require_roles
from schemas.v3 import V3UserOut

router = APIRouter(prefix="/api/v3/store", tags=["store"])

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads", "store")
os.makedirs(UPLOAD_DIR, exist_ok=True)

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
MAX_UPLOAD_BYTES = 5 * 1024 * 1024


def _now():
    return datetime.now(timezone.utc).isoformat()


@router.post("/upload-image")
async def upload_store_image(file: UploadFile = File(...), _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Only JPG, PNG, or WEBP images are allowed")
    contents = await file.read()
    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="Image must be under 5MB")
    filename = f"{uuid.uuid4()}{ext}"
    with open(os.path.join(UPLOAD_DIR, filename), "wb") as f:
        f.write(contents)
    return {"url": f"/api/v3/uploads/store/{filename}"}


class StoreItemIn(BaseModel):
    category: str
    name: str
    description: Optional[str] = ""
    image_url: Optional[str] = None
    mode: str  # "online" | "offline"


class StoreItemOut(StoreItemIn):
    id: str
    created_at: str
    updated_at: str


@router.post("/items", response_model=StoreItemOut)
async def create_store_item(payload: StoreItemIn, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="Name is required")
    if payload.mode not in ("online", "offline"):
        raise HTTPException(status_code=400, detail="Mode must be 'online' or 'offline'")
    doc = payload.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = _now()
    doc["updated_at"] = _now()
    await v3_col("store_items").insert_one(doc.copy())
    return doc


@router.get("/items", response_model=List[StoreItemOut])
async def list_store_items(category: Optional[str] = None, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    q = {"category": category} if category else {}
    docs = await v3_col("store_items").find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return docs


@router.delete("/items/{item_id}")
async def delete_store_item(item_id: str, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    res = await v3_col("store_items").delete_one({"id": item_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Item not found")
    return {"message": "Item deleted"}
