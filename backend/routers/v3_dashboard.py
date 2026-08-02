from fastapi import APIRouter, Depends, Query
from datetime import datetime, timezone, timedelta
from typing import Optional

from database import v3_col
from stage_utils import get_closing_stage_name
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
async def v3_bd_summary(
    branch_id: Optional[str] = Query(None),
    source_tab: Optional[str] = Query(None),
    stage: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    _: V3UserOut = Depends(v3_require_roles("business_dev", "super_admin")),
):
    # Filter toolbar support — every lead-derived metric below respects these, so switching
    # Branch/Lead Source/Status/Date Range re-scopes the whole dashboard, not just the table.
    lead_match: dict = {}
    if branch_id:
        lead_match["branch_id"] = branch_id
    if source_tab:
        lead_match["source_tab"] = source_tab
    if stage:
        lead_match["stage"] = stage
    if start_date or end_date:
        created_range: dict = {}
        if start_date:
            created_range["$gte"] = start_date
        if end_date:
            created_range["$lte"] = end_date
        lead_match["created_at"] = created_range

    appt_match: dict = {}
    if branch_id:
        appt_match["branch_id"] = branch_id
    if start_date or end_date:
        appt_match["created_at"] = lead_match.get("created_at", {})

    def lead_filter(extra: Optional[dict] = None) -> dict:
        out = dict(lead_match)
        if extra:
            out.update(extra)
        return out

    total_leads = await v3_col("leads").count_documents(lead_filter())
    stage_counts = {}
    for s in await _stage_names("pre_sales", V3_STAGES):
        stage_counts[s] = await v3_col("leads").count_documents(lead_filter({"stage": s}))

    source_pipeline = [
        {"$match": lead_match},
        {"$group": {"_id": {"$ifNull": ["$source_tab", "$source_type"]}, "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]
    source_agg = await v3_col("leads").aggregate(source_pipeline).to_list(100)
    source_counts = {item["_id"]: item["count"] for item in source_agg if item["_id"]}

    branch_pipeline = [
        {"$match": lead_filter({"branch_id": {"$ne": None}})},
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

    total_appointments = await v3_col("appointments").count_documents(appt_match)
    completed_appointments = await v3_col("appointments").count_documents({**appt_match, "status": "completed"})
    total_branches = await v3_col("branches").count_documents({})
    total_connections = await v3_col("sheet_connections").count_documents({})

    recent_leads = await v3_col("leads").find(lead_match, {"_id": 0}).sort("created_at", -1).to_list(10)
    recent_out = [V3LeadOut(**r) for r in recent_leads]

    # Time-bucketed lead volume — real, computed straight off created_at, no invented figures.
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_leads = await v3_col("leads").count_documents(lead_filter({"created_at": {"$gte": today_start.isoformat()}}))

    week_start = today_start - timedelta(days=6)
    prev_week_start = week_start - timedelta(days=7)
    leads_this_week = await v3_col("leads").count_documents(lead_filter({"created_at": {"$gte": week_start.isoformat()}}))
    leads_last_week = await v3_col("leads").count_documents(lead_filter({
        "created_at": {"$gte": prev_week_start.isoformat(), "$lt": week_start.isoformat()}
    }))

    week_trend = []
    for i in range(6, -1, -1):
        day_start = today_start - timedelta(days=i)
        day_end = day_start + timedelta(days=1)
        count = await v3_col("leads").count_documents(lead_filter({
            "created_at": {"$gte": day_start.isoformat(), "$lt": day_end.isoformat()}
        }))
        week_trend.append({"date": day_start.strftime("%Y-%m-%d"), "count": count})

    month_trend = []
    month_cursor = today_start.replace(day=1)
    months = []
    for _ in range(6):
        months.append(month_cursor)
        prev_month_end = month_cursor - timedelta(days=1)
        month_cursor = prev_month_end.replace(day=1)
    for month_start in reversed(months):
        if month_start.month == 12:
            next_month = month_start.replace(year=month_start.year + 1, month=1)
        else:
            next_month = month_start.replace(month=month_start.month + 1)
        count = await v3_col("leads").count_documents(lead_filter({
            "created_at": {"$gte": month_start.isoformat(), "$lt": next_month.isoformat()}
        }))
        month_trend.append({"month": month_start.strftime("%Y-%m"), "count": count})

    # Revenue actually collected against leads (Consultation + Treatment Fee) — real ledger sum.
    revenue_pipeline = [
        {"$match": lead_match},
        {"$group": {
            "_id": None,
            "total": {"$sum": {"$add": [
                {"$ifNull": ["$package_paid", 0]},
                {"$ifNull": ["$treatment_fee_paid", 0]},
            ]}},
        }},
    ]
    revenue_agg = await v3_col("leads").aggregate(revenue_pipeline).to_list(1)
    revenue_generated = revenue_agg[0]["total"] if revenue_agg else 0

    conversion_rate = round((completed_appointments / total_leads) * 100, 1) if total_leads else 0.0

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
        "today_leads": today_leads,
        "leads_this_week": leads_this_week,
        "leads_last_week": leads_last_week,
        "week_trend": week_trend,
        "month_trend": month_trend,
        "revenue_generated": revenue_generated,
        "conversion_rate": conversion_rate,
        "applied_filters": {"branch_id": branch_id, "source_tab": source_tab, "stage": stage, "start_date": start_date, "end_date": end_date},
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
    # The Head Physio pipeline's closing stage — renamed since it shipped, so counting the
    # old literal here reported zero consultations however many there were.
    head_closing_stage = await get_closing_stage_name("head_consultation", "Consultation Visit")

    # Patient journey counts (label → count).
    # The displayed Journey Flow Map pills follow the real lifecycle
    # Branch → Head Physio → Branch → End (see MasterControlBoard JOURNEY_PILLS):
    #   New Appointment → Appointment Date & Time → Consultation → Fee Collected
    #   → Physio Assign → Patient.
    # The pre-sales (stage) and Portfolio counts are kept only to feed the Live
    # Analytics workflow split below; they are not rendered as journey pills.
    journey = {
        # Pre-sales + Portfolio — analytics only, not shown as pills
        "New Lead": await leads.count_documents(merged({"stage": "New Leads"})),
        "Follow Up": await leads.count_documents(merged({"stage": "Follow Up"})),
        "Appointment": await leads.count_documents(merged({"stage": "Appointment"})),
        "Portfolio": await leads.count_documents(merged({"branch_stage": "Portfolio"})),
        # Branch (leads) → Head Physio (consultation) → Branch (consultation) → End
        "New Appointment": await leads.count_documents(merged({"branch_stage": first_branch_stage})),
        "Appointment Date & Time": await leads.count_documents(merged({"branch_stage": "Appointment Date & Time"})),
        "Consultation": await leads.count_documents(merged({"head_consultation_stage": head_closing_stage})),
        "Fee Collected": await leads.count_documents(merged({"consultation_stage": "Fee Collected"})),
        "Physio Assign": await leads.count_documents(merged({"consultation_stage": "Physio Assign"})),
        "Patient": await leads.count_documents(merged({"consultation_stage": "Consultation Completed"})),
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
        {"name": "In Review", "value": journey["Follow Up"]},
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
