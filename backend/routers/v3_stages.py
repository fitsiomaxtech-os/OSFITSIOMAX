from fastapi import APIRouter, Depends, HTTPException
from typing import Optional, List, Literal
from pydantic import BaseModel
import uuid

from database import v3_col
from utils import now_iso
from deps import v3_require_roles, v3_current_user
from constants import V3_STAGES, V3_BRANCH_STAGES, V3_CONSULTATION_STAGES, V3_HEAD_CONSULTATION_STAGES
from schemas.v3 import V3UserOut


router = APIRouter(prefix="/api/v3/stages")


PRESALES_COLORS = ["#6366f1", "#ef4444", "#f97316", "#f59e0b", "#a855f7", "#22c55e", "#0ea5e9", "#64748b"]
SALES_COLORS = ["#0ea5e9", "#06b6d4", "#14b8a6", "#22c55e", "#84cc16", "#eab308", "#f59e0b", "#f97316",
                "#ef4444", "#ec4899", "#a855f7", "#6366f1"]
CONSULTATION_COLORS = ["#3b82f6", "#f43f5e", "#f97316", "#8b5cf6", "#14b8a6", "#22c55e", "#64748b"]
HEAD_CONSULTATION_COLORS = ["#3b82f6", "#0ea5e9", "#8b5cf6", "#a855f7"]

STAGE_TYPE_FIELD = {
    "pre_sales": "stage",
    "sales": "branch_stage",
    "consultation": "consultation_stage",
    "head_consultation": "head_consultation_stage",
}


class StageCreate(BaseModel):
    name: str
    color: Optional[str] = "#64748b"
    type: Literal["pre_sales", "sales", "consultation", "head_consultation"]
    is_final: Optional[bool] = False


class StageUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    is_final: Optional[bool] = None


class StageReorder(BaseModel):
    items: List[dict]  # [{id, order}]


async def _ensure_seed() -> None:
    existing = await v3_col("pipeline_stages").count_documents({})
    if existing > 0:
        return
    docs = []
    for idx, name in enumerate(V3_STAGES):
        docs.append({
            "id": str(uuid.uuid4()),
            "name": name,
            "color": PRESALES_COLORS[idx % len(PRESALES_COLORS)],
            "type": "pre_sales",
            "order": idx,
            "is_final": name in ("Completed",),
            "created_at": now_iso(),
        })
    for idx, name in enumerate(V3_BRANCH_STAGES):
        docs.append({
            "id": str(uuid.uuid4()),
            "name": name,
            "color": SALES_COLORS[idx % len(SALES_COLORS)],
            "type": "sales",
            "order": idx,
            "is_final": name in ("Assigned Physio", "Cancelled"),
            "created_at": now_iso(),
        })
    for idx, name in enumerate(V3_CONSULTATION_STAGES):
        docs.append({
            "id": str(uuid.uuid4()),
            "name": name,
            "color": CONSULTATION_COLORS[idx % len(CONSULTATION_COLORS)],
            "type": "consultation",
            "order": idx,
            "is_final": name in ("Treatment Fee", "Cancel"),
            "created_at": now_iso(),
        })
    for idx, name in enumerate(V3_HEAD_CONSULTATION_STAGES):
        docs.append({
            "id": str(uuid.uuid4()),
            "name": name,
            "color": HEAD_CONSULTATION_COLORS[idx % len(HEAD_CONSULTATION_COLORS)],
            "type": "head_consultation",
            "order": idx,
            "is_final": name in ("Physio Assign",),
            "created_at": now_iso(),
        })
    if docs:
        await v3_col("pipeline_stages").insert_many(docs)


@router.get("")
async def list_stages(type: Optional[Literal["pre_sales", "sales", "consultation", "head_consultation"]] = None, _: V3UserOut = Depends(v3_current_user)):
    await _ensure_seed()
    query = {"type": type} if type else {}
    rows = await v3_col("pipeline_stages").find(query, {"_id": 0}).sort([("type", 1), ("order", 1)]).to_list(500)
    counts = {}
    if type:
        field = STAGE_TYPE_FIELD[type]
        leads_pipeline = [{"$group": {"_id": f"${field}", "n": {"$sum": 1}}}]
        async for row in v3_col("leads").aggregate(leads_pipeline):
            counts[row["_id"]] = row["n"]
    for r in rows:
        r["lead_count"] = counts.get(r["name"], 0)
    return rows


@router.post("")
async def create_stage(payload: StageCreate, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    await _ensure_seed()
    last = await v3_col("pipeline_stages").find({"type": payload.type}, {"_id": 0, "order": 1}).sort("order", -1).limit(1).to_list(1)
    next_order = (last[0]["order"] + 1) if last else 0
    doc = {
        "id": str(uuid.uuid4()),
        "name": payload.name,
        "color": payload.color or "#64748b",
        "type": payload.type,
        "order": next_order,
        "is_final": bool(payload.is_final),
        "created_at": now_iso(),
    }
    await v3_col("pipeline_stages").insert_one(doc.copy())
    return doc


@router.patch("/{stage_id}")
async def update_stage(stage_id: str, payload: StageUpdate, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No updates provided")
    # If renaming, also rename references on existing leads
    if "name" in updates:
        old = await v3_col("pipeline_stages").find_one({"id": stage_id}, {"_id": 0, "name": 1, "type": 1})
        if old and old["name"] != updates["name"]:
            field = STAGE_TYPE_FIELD[old["type"]]
            await v3_col("leads").update_many({field: old["name"]}, {"$set": {field: updates["name"]}})
    res = await v3_col("pipeline_stages").update_one({"id": stage_id}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Stage not found")
    return await v3_col("pipeline_stages").find_one({"id": stage_id}, {"_id": 0})


@router.delete("/{stage_id}")
async def delete_stage(stage_id: str, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    stage = await v3_col("pipeline_stages").find_one({"id": stage_id}, {"_id": 0})
    if not stage:
        raise HTTPException(status_code=404, detail="Stage not found")
    field = STAGE_TYPE_FIELD[stage["type"]]
    in_use = await v3_col("leads").count_documents({field: stage["name"]})
    if in_use > 0:
        raise HTTPException(status_code=409, detail=f"Stage in use by {in_use} leads. Reassign first.")
    await v3_col("pipeline_stages").delete_one({"id": stage_id})
    return {"message": "Stage deleted"}


@router.post("/reorder")
async def reorder_stages(payload: StageReorder, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    for item in payload.items:
        if "id" not in item or "order" not in item:
            continue
        await v3_col("pipeline_stages").update_one({"id": item["id"]}, {"$set": {"order": int(item["order"])}})
    return {"message": "Reorder saved"}
