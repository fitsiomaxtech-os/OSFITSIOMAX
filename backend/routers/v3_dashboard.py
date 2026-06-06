from fastapi import APIRouter, Depends

from database import v3_col
from deps import v3_current_user, v3_require_roles
from constants import V3_STAGES, V3_BRANCH_STAGES
from schemas.v3 import V3UserOut, V3LeadOut

router = APIRouter(prefix="/api/v3")


@router.get("/dashboard/bd-summary")
async def v3_bd_summary(_: V3UserOut = Depends(v3_require_roles("business_dev", "super_admin"))):
    total_leads = await v3_col("leads").count_documents({})
    stage_counts = {}
    for stage in V3_STAGES:
        stage_counts[stage] = await v3_col("leads").count_documents({"stage": stage})

    source_pipeline = [
        {"$group": {"_id": {"$ifNull": ["$source_tab", "$source_type"]}, "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]
    source_agg = await v3_col("leads").aggregate(source_pipeline).to_list(100)
    source_counts = {item["_id"]: item["count"] for item in source_agg if item["_id"]}

    branch_pipeline = [
        {"$match": {"branch_id": {"$ne": None}}},
        {"$group": {"_id": "$branch_id", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]
    branch_agg = await v3_col("leads").aggregate(branch_pipeline).to_list(100)
    branches_all = await v3_col("branches").find({}, {"_id": 0, "id": 1, "branch_name": 1}).to_list(1000)
    branch_map = {b["id"]: b["branch_name"] for b in branches_all}
    branch_counts = [
        {"branch_id": item["_id"], "branch_name": branch_map.get(item["_id"], "Unknown"), "count": item["count"]}
        for item in branch_agg
    ]

    total_appointments = await v3_col("appointments").count_documents({})
    completed_appointments = await v3_col("appointments").count_documents({"status": "completed"})
    total_branches = await v3_col("branches").count_documents({})
    total_connections = await v3_col("sheet_connections").count_documents({})

    recent_leads = await v3_col("leads").find({}, {"_id": 0}).sort("created_at", -1).to_list(10)
    recent_out = [V3LeadOut(**r) for r in recent_leads]

    return {
        "total_leads": total_leads,
        "stage_counts": stage_counts,
        "source_counts": source_counts,
        "branch_counts": branch_counts,
        "total_appointments": total_appointments,
        "completed_appointments": completed_appointments,
        "total_branches": total_branches,
        "total_connections": total_connections,
        "recent_leads": [r.model_dump() for r in recent_out],
    }


@router.get("/lead-sources")
async def v3_lead_sources(_: V3UserOut = Depends(v3_require_roles("business_dev", "super_admin"))):
    pipeline = [
        {"$group": {
            "_id": {"source_tab": {"$ifNull": ["$source_tab", "Manual"]}, "source_type": "$source_type"},
            "count": {"$sum": 1},
            "stages": {"$push": "$stage"},
        }},
        {"$sort": {"count": -1}},
    ]
    agg = await v3_col("leads").aggregate(pipeline).to_list(200)
    sources = []
    for item in agg:
        stage_breakdown = {}
        for s in item["stages"]:
            stage_breakdown[s] = stage_breakdown.get(s, 0) + 1
        sources.append({
            "source_tab": item["_id"]["source_tab"],
            "source_type": item["_id"]["source_type"],
            "total": item["count"],
            "stage_breakdown": stage_breakdown,
        })
    return sources


@router.get("/boards/master")
async def v3_master_board(_: V3UserOut = Depends(v3_current_user)):
    stage_counts = {}
    for stage in V3_STAGES:
        stage_counts[stage] = await v3_col("leads").count_documents({"stage": stage})
    total = await v3_col("leads").count_documents({})
    return {"stage_counts": stage_counts, "total": total}


@router.get("/boards/branch-master")
async def v3_branch_master_board(_: V3UserOut = Depends(v3_require_roles("super_admin", "branch_admin", "head_physio"))):
    """Aggregated counts across all branches keyed by branch_stage (for Super Admin Master View)."""
    branch_stage_counts = {}
    for stage in V3_BRANCH_STAGES:
        branch_stage_counts[stage] = await v3_col("leads").count_documents({"branch_stage": stage})
    total = await v3_col("leads").count_documents({"branch_stage": {"$in": V3_BRANCH_STAGES}})
    return {"branch_stage_counts": branch_stage_counts, "total": total}


@router.get("/boards/branch/{branch_id}")
async def v3_branch_board(branch_id: str, _: V3UserOut = Depends(v3_current_user)):
    stage_counts = {}
    for stage in V3_STAGES:
        stage_counts[stage] = await v3_col("leads").count_documents({"stage": stage, "branch_id": branch_id})
    return {"branch_id": branch_id, "stage_counts": stage_counts}
