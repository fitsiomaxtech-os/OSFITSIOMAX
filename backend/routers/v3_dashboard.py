from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta

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


@router.get("/boards/master-control")
async def v3_master_control(_: V3UserOut = Depends(v3_require_roles("super_admin"))):
    """Aggregated metrics for the Super Admin Master Control Board (attention, today queue, sync, analytics)."""
    leads = v3_col("leads")
    now = datetime.now(timezone.utc)
    today_iso = now.date().isoformat()
    period_start = (now - timedelta(days=30)).isoformat()
    prev_start = (now - timedelta(days=60)).isoformat()
    total_leads = await leads.count_documents({})

    # Patient journey counts (label → count) — 8 pills
    journey = {
        "New Lead": await leads.count_documents({"stage": "New Leads"}),
        "RNR": await leads.count_documents({"stage": "RNR"}),
        "Follow Up": await leads.count_documents({"stage": "Follow Up"}),
        "Appointment": await leads.count_documents({"stage": "Appointment"}),
        "New Appointment": await leads.count_documents({"branch_stage": "New Appointment"}),
        "Portfolio": await leads.count_documents({"branch_stage": "Portfolio"}),
        "Appointment Date & Time": await leads.count_documents({"branch_stage": "Appointment Date & Time"}),
        "Patient": await leads.count_documents({"branch_stage": "Appointment Date & Time", "appointment_date": {"$ne": None}}),
    }

    # Attention Required
    attention = {
        "follow_up_pending": await leads.count_documents({"stage": "Follow Up"}),
        "date_time_pending": await leads.count_documents({"branch_stage": "Portfolio"}),
        "branch_pending": await leads.count_documents({"stage": "Appointment", "branch_id": None}),
        "expert_pending": await leads.count_documents({"stage": "Appointment", "assigned_physio_id": None}),
        "sync_issue": 0,
    }

    # Today's Priority Queue
    todays_follow_ups = await leads.count_documents({"stage": "Follow Up", "follow_up_date": today_iso})
    appointments_today = await leads.count_documents({"appointment_date": today_iso})
    new_appointments = await leads.count_documents({"branch_stage": "New Appointment"})
    pending_branch_actions = attention["date_time_pending"] + attention["branch_pending"]
    today_queue = {
        "todays_follow_ups": todays_follow_ups,
        "appointments_today": appointments_today,
        "new_appointments": new_appointments,
        "pending_branch_actions": pending_branch_actions,
    }

    # Sync & System Health (placeholder data — real wiring once sheet connectors expose telemetry)
    last_conn = await v3_col("sheet_connections").find_one({}, {"_id": 0, "last_synced_at": 1, "status": 1})
    sync_health = {
        "sheet_status": "Connected" if last_conn else "Not Connected",
        "last_sync": last_conn.get("last_synced_at") if last_conn else None,
        "new_rows": 0,
        "duplicates_skipped": 0,
        "mapping_status": "All Mapped" if last_conn else "—",
    }

    # Live Analytics — Lead Workflow split (pre-sales heavy buckets)
    workflow = [
        {"name": "New", "value": journey["New Lead"]},
        {"name": "In Review", "value": journey["Follow Up"] + journey["RNR"]},
        {"name": "Confirmed", "value": journey["Appointment"] + journey["New Appointment"] + journey["Portfolio"] + journey["Appointment Date & Time"]},
        {"name": "Archived", "value": await leads.count_documents({"branch_stage": "Cancelled"})},
    ]

    # Patient Information Completion
    not_empty = {"$nin": [None, ""]}
    completed = await leads.count_documents({"name": not_empty, "phone": not_empty, "email": not_empty})
    patient_info = [
        {"name": "Completed", "value": completed},
        {"name": "Incomplete", "value": max(total_leads - completed, 0)},
    ]

    current_records = await leads.count_documents({"created_at": {"$gte": period_start}})
    previous_records = await leads.count_documents({"created_at": {"$gte": prev_start, "$lt": period_start}})

    def pct(n, d):
        return round((n / d) * 100, 2) if d else 0.0

    patient_profile = await leads.count_documents({"name": not_empty, "phone": not_empty})
    appointment_details = await leads.count_documents({"appointment_date": {"$ne": None}})
    expert_assignment = await leads.count_documents({"assigned_physio_id": {"$ne": None}})

    progress = {
        "patient_profile": {"completed": patient_profile, "total": total_leads, "percent": pct(patient_profile, total_leads)},
        "appointment_details": {"completed": appointment_details, "total": total_leads, "percent": pct(appointment_details, total_leads)},
        "expert_assignment": {"completed": expert_assignment, "total": total_leads, "percent": pct(expert_assignment, total_leads)},
    }

    return {
        "live_time": now.isoformat(),
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
