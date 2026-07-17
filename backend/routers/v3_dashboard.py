from fastapi import APIRouter, Depends, Query
from datetime import datetime, timezone, timedelta
from typing import Optional

from database import v3_col
from deps import v3_current_user, v3_require_roles
from constants import V3_STAGES, V3_BRANCH_STAGES
from schemas.v3 import V3UserOut, V3LeadOut

router = APIRouter(prefix="/api/v3")


async def _stage_names(stage_type: str, fallback: list) -> list:
    """Live stage names from Super Admin > Pipeline Stage Management, falling back to the
    built-in defaults if none have been configured yet (mirrors v3_branch_admin.py)."""
    rows = await v3_col("pipeline_stages").find({"type": stage_type}, {"_id": 0, "name": 1}).sort("order", 1).to_list(200)
    names = [r["name"] for r in rows]
    return names or fallback


@router.get("/dashboard/bd-summary")
async def v3_bd_summary(_: V3UserOut = Depends(v3_require_roles("business_dev", "super_admin"))):
    total_leads = await v3_col("leads").count_documents({})
    stage_counts = {}
    for stage in await _stage_names("pre_sales", V3_STAGES):
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
    for stage in await _stage_names("pre_sales", V3_STAGES):
        stage_counts[stage] = await v3_col("leads").count_documents({"stage": stage})
    total = await v3_col("leads").count_documents({})
    return {"stage_counts": stage_counts, "total": total}


@router.get("/boards/branch-master")
async def v3_branch_master_board(_: V3UserOut = Depends(v3_require_roles("super_admin", "branch_admin", "head_physio"))):
    """Aggregated counts across all branches keyed by branch_stage (for Super Admin Master View)."""
    branch_stages = await _stage_names("sales", V3_BRANCH_STAGES)
    branch_stage_counts = {}
    for stage in branch_stages:
        branch_stage_counts[stage] = await v3_col("leads").count_documents({"branch_stage": stage})
    total = await v3_col("leads").count_documents({"branch_stage": {"$in": branch_stages}})
    return {"branch_stage_counts": branch_stage_counts, "total": total}


@router.get("/boards/branch/{branch_id}")
async def v3_branch_board(branch_id: str, _: V3UserOut = Depends(v3_current_user)):
    stage_counts = {}
    for stage in await _stage_names("pre_sales", V3_STAGES):
        stage_counts[stage] = await v3_col("leads").count_documents({"stage": stage, "branch_id": branch_id})
    return {"branch_id": branch_id, "stage_counts": stage_counts}


@router.get("/boards/master-control")
async def v3_master_control(
    branch_id: Optional[str] = Query(None),
    service_type: Optional[str] = Query(None),   # vertical name
    expert_id: Optional[str] = Query(None),      # assigned_physio_id
    time_range: Optional[str] = Query("current"),
    _: V3UserOut = Depends(v3_require_roles("super_admin")),
):
    """Aggregated metrics for the Super Admin Master Control Board (attention, today queue, sync, analytics).

    Filters applied across all aggregations (counts, journey, analytics):
    - branch_id, service_type, expert_id, time_range ("current" | "last_30" | "last_90" | "all")
    """
    leads = v3_col("leads")
    now = datetime.now(timezone.utc)
    today_iso = now.date().isoformat()

    # Time range bounds
    range_start_iso = None
    if time_range == "last_30":
        range_start_iso = (now - timedelta(days=30)).isoformat()
    elif time_range == "last_90":
        range_start_iso = (now - timedelta(days=90)).isoformat()
    elif time_range in (None, "", "current"):
        # Current Academic Year: 1 April of current FY → 31 March next year
        fy_start_year = now.year if now.month >= 4 else now.year - 1
        range_start_iso = datetime(fy_start_year, 4, 1, tzinfo=timezone.utc).isoformat()

    # Build a base filter to merge into every count_documents() call
    base = {}
    if branch_id:
        base["branch_id"] = branch_id
    if service_type:
        base["vertical"] = service_type
    if expert_id:
        base["assigned_physio_id"] = expert_id
    if range_start_iso:
        base["created_at"] = {"$gte": range_start_iso}

    def merged(extra=None):
        out = dict(base)
        if extra:
            for k, v in extra.items():
                if k in out and isinstance(out[k], dict) and isinstance(v, dict):
                    out[k] = {**out[k], **v}
                else:
                    out[k] = v
        return out

    total_leads = await leads.count_documents(merged())
    first_branch_stage = (await _stage_names("sales", V3_BRANCH_STAGES))[0]

    # Patient journey counts (label → count) — 8 pills
    journey = {
        "New Lead": await leads.count_documents(merged({"stage": "New Leads"})),
        "RNR": await leads.count_documents(merged({"stage": "RNR"})),
        "Follow Up": await leads.count_documents(merged({"stage": "Follow Up"})),
        "Appointment": await leads.count_documents(merged({"stage": "Appointment"})),
        "New Appointment": await leads.count_documents(merged({"branch_stage": first_branch_stage})),
        "Portfolio": await leads.count_documents(merged({"branch_stage": "Portfolio"})),
        "Appointment Date & Time": await leads.count_documents(merged({"branch_stage": "Appointment Date & Time"})),
        "Patient": await leads.count_documents(merged({"branch_stage": "Appointment Date & Time", "appointment_date": {"$ne": None}})),
    }

    # Attention Required
    attention = {
        "follow_up_pending": await leads.count_documents(merged({"stage": "Follow Up"})),
        "date_time_pending": await leads.count_documents(merged({"branch_stage": "Portfolio"})),
        "branch_pending": await leads.count_documents(merged({"stage": "Appointment", "branch_id": None})),
        "expert_pending": await leads.count_documents(merged({"stage": "Appointment", "assigned_physio_id": None})),
        "sync_issue": 0,
    }

    # Today's Priority Queue
    todays_follow_ups = await leads.count_documents(merged({"stage": "Follow Up", "follow_up_date": today_iso}))
    appointments_today = await leads.count_documents(merged({"appointment_date": today_iso}))
    new_appointments = await leads.count_documents(merged({"branch_stage": first_branch_stage}))
    pending_branch_actions = attention["date_time_pending"] + attention["branch_pending"]
    today_queue = {
        "todays_follow_ups": todays_follow_ups,
        "appointments_today": appointments_today,
        "new_appointments": new_appointments,
        "pending_branch_actions": pending_branch_actions,
    }

    # Sync & System Health — read from marketing_sources (the actual production sheet ingestion collection)
    sources = await v3_col("marketing_sources").find({}, {"_id": 0}).to_list(1000)
    last_source = None
    latest_iso = None
    for src in sources:
        ls = src.get("last_synced") or src.get("last_synced_at")
        if ls and (latest_iso is None or ls > latest_iso):
            latest_iso = ls
            last_source = src

    connected_count = sum(1 for s in sources if s.get("oauth_connected") or s.get("last_synced") or s.get("last_synced_at"))
    new_rows_total = sum(int(s.get("last_sync_imported") or 0) for s in sources)
    duplicates_total = sum(int(s.get("last_sync_skipped_duplicate") or 0) for s in sources)

    # Mapping status — how many sources have column_mapping set vs total
    sources_with_mapping = sum(1 for s in sources if (s.get("column_mapping") or {}))
    if not sources:
        mapping_status = "—"
    elif sources_with_mapping == len(sources):
        mapping_status = "All Mapped"
    elif sources_with_mapping == 0:
        mapping_status = "Not Mapped"
    else:
        mapping_status = f"{sources_with_mapping}/{len(sources)} Mapped"

    sync_health = {
        "sheet_status": "Connected" if connected_count > 0 else ("Configured" if sources else "Not Connected"),
        "sources_total": len(sources),
        "sources_connected": connected_count,
        "last_sync": latest_iso,
        "last_sync_source": (last_source or {}).get("name") if last_source else None,
        "new_rows": new_rows_total,
        "duplicates_skipped": duplicates_total,
        "mapping_status": mapping_status,
    }

    # Live Analytics — Lead Workflow split (filter-aware via journey counts)
    workflow = [
        {"name": "New", "value": journey["New Lead"]},
        {"name": "In Review", "value": journey["Follow Up"] + journey["RNR"]},
        {"name": "Confirmed", "value": journey["Appointment"] + journey["New Appointment"] + journey["Portfolio"] + journey["Appointment Date & Time"]},
        {"name": "Archived", "value": await leads.count_documents(merged({"branch_stage": "Cancelled"}))},
    ]

    # Patient Information Completion
    not_empty = {"$nin": [None, ""]}
    completed = await leads.count_documents(merged({"name": not_empty, "phone": not_empty, "email": not_empty}))
    patient_info = [
        {"name": "Completed", "value": completed},
        {"name": "Incomplete", "value": max(total_leads - completed, 0)},
    ]

    # Period comparison — current vs previous (always 30-day window regardless of time_range)
    cur_start = (now - timedelta(days=30)).isoformat()
    prev_start = (now - timedelta(days=60)).isoformat()
    base_no_time = {k: v for k, v in base.items() if k != "created_at"}

    def merged_no_time(extra=None):
        out = dict(base_no_time)
        if extra:
            out.update(extra)
        return out

    current_records = await leads.count_documents(merged_no_time({"created_at": {"$gte": cur_start}}))
    previous_records = await leads.count_documents(merged_no_time({"created_at": {"$gte": prev_start, "$lt": cur_start}}))

    def pct(n, d):
        return round((n / d) * 100, 2) if d else 0.0

    patient_profile = await leads.count_documents(merged({"name": not_empty, "phone": not_empty}))
    appointment_details = await leads.count_documents(merged({"appointment_date": {"$ne": None}}))
    expert_assignment = await leads.count_documents(merged({"assigned_physio_id": {"$ne": None}}))

    progress = {
        "patient_profile": {"completed": patient_profile, "total": total_leads, "percent": pct(patient_profile, total_leads)},
        "appointment_details": {"completed": appointment_details, "total": total_leads, "percent": pct(appointment_details, total_leads)},
        "expert_assignment": {"completed": expert_assignment, "total": total_leads, "percent": pct(expert_assignment, total_leads)},
    }

    return {
        "live_time": now.isoformat(),
        "applied_filters": {"branch_id": branch_id, "service_type": service_type, "expert_id": expert_id, "time_range": time_range},
        "journey": journey,
        "attention": attention,
        "today_queue": today_queue,
        "sync_health": sync_health,
        "analytics": {
            "workflow": workflow,
            "workflow_total": total_leads,
            "patient_info": patient_info,
            "patient_info_total": total_leads,
            "current_period": {"label": "Current Period", "records": current_records, "percent": pct(current_records, total_leads)},
            "previous_period": {"label": "Previous Period", "records": previous_records, "percent": pct(previous_records, total_leads)},
            "progress": progress,
            "total_records": total_leads,
        },
    }
