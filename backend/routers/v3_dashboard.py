from fastapi import APIRouter, Depends, HTTPException, Query
from datetime import datetime, timezone, timedelta
from typing import Optional

from database import v3_col
from stage_utils import get_closing_stage_name
from deps import v3_current_user, v3_require_roles
from constants import V3_STAGES, V3_BRANCH_STAGES
from schemas.v3 import V3UserOut, V3LeadOut
from routers.v3_finance import REVENUE_ACTIONS, CONSULTATION_FEE_ACTIONS, _parse_rs_amount, _revenue_category

router = APIRouter(prefix="/api/v3")

# The vertical names already used when creating leads/branches (see CRMPage.jsx's
# verticalDefaults / defaultBranch) — Physiotherapy gets its own branch-by-branch
# breakdown (2x2 cards); the other three are shown as one aggregate card each.
DASHBOARD_VERTICAL_LABELS = {
    "offline_fitness_gym": "Offline Fitness",
    "online_physiotherapy": "Online Physiotherapy",
    "online_fitness": "Online Fitness",
}


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


def _date_range_query(field: str, start_date: Optional[str], end_date: Optional[str]) -> dict:
    if not start_date and not end_date:
        return {}
    rng: dict = {}
    if start_date:
        rng["$gte"] = start_date
    if end_date:
        rng["$lte"] = f"{end_date}T23:59:59"
    return {field: rng}


@router.get("/dashboard/overview")
async def v3_dashboard_overview(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    _: V3UserOut = Depends(v3_require_roles("super_admin")),
):
    """Super Admin's new Dashboard (the default landing view) — Leads / Appointments /
    Treatments / Revenue for a date range, each split into the Physiotherapy branches
    (one count per branch) plus one aggregate per other vertical. Revenue is built off
    the lead_activity payment trail like finance/revenue-overview — leads/appointments/
    sessions carry no payment date of their own, activity log entries do."""
    branches = await v3_col("branches").find({}, {"_id": 0, "id": 1, "branch_name": 1, "vertical": 1}).to_list(500)
    branch_by_id = {b["id"]: b for b in branches}
    physio_branches = [b for b in branches if b.get("vertical") == "offline_physiotherapy"]
    other_verticals = list(DASHBOARD_VERTICAL_LABELS.keys())

    def branch_vertical(branch_id):
        return (branch_by_id.get(branch_id) or {}).get("vertical")

    def new_bucket():
        return {"total": 0.0, "physio_branches": {b["id"]: 0.0 for b in physio_branches}, "verticals": {v: 0.0 for v in other_verticals}}

    def add_to_bucket(bucket, branch_id, vertical, amount=1.0):
        bucket["total"] += amount
        if branch_id in bucket["physio_branches"]:
            bucket["physio_branches"][branch_id] += amount
        elif vertical in bucket["verticals"]:
            bucket["verticals"][vertical] += amount

    def format_bucket(bucket, currency=False):
        rnd = (lambda v: round(v, 2)) if currency else int
        return {
            "total": rnd(bucket["total"]),
            "physio_branches": [
                {"branch_id": b["id"], "branch_name": b["branch_name"], "value": rnd(bucket["physio_branches"][b["id"]])}
                for b in physio_branches
            ],
            "verticals": [
                {"vertical": v, "label": DASHBOARD_VERTICAL_LABELS[v], "value": rnd(bucket["verticals"][v])}
                for v in other_verticals
            ],
        }

    leads_bucket = new_bucket()
    lead_rows = await v3_col("leads").find(
        _date_range_query("created_at", start_date, end_date), {"_id": 0, "branch_id": 1, "vertical": 1}
    ).to_list(50000)
    for l in lead_rows:
        bid = l.get("branch_id")
        add_to_bucket(leads_bucket, bid, l.get("vertical") or branch_vertical(bid))

    appt_bucket = new_bucket()
    appt_rows = await v3_col("leads").find(
        _date_range_query("appointment_date", start_date, end_date), {"_id": 0, "branch_id": 1, "vertical": 1}
    ).to_list(50000)
    for l in appt_rows:
        bid = l.get("branch_id")
        add_to_bucket(appt_bucket, bid, l.get("vertical") or branch_vertical(bid))

    treat_bucket = new_bucket()
    sess_query = {"status": "completed"}
    sess_query.update(_date_range_query("slot_time", start_date, end_date))
    sess_rows = await v3_col("sessions").find(sess_query, {"_id": 0, "branch_id": 1}).to_list(50000)
    for s in sess_rows:
        bid = s.get("branch_id")
        add_to_bucket(treat_bucket, bid, branch_vertical(bid))

    revenue_bucket = new_bucket()
    # The same Consultation / Session split Accountant Manage reports, so the Dashboard's
    # headline figures and the Collections boards can't disagree about what a payment was
    # for. `action` and `created_at` have to be projected for this — the branch buckets
    # below never needed either.
    # "diet" is seeded because _revenue_category can return it — without the key the
    # increment below raises the moment a Diet Consultation Fee lands in range.
    revenue_split = {"consultation": 0.0, "session": 0.0, "diet": 0.0, "spot_joining": 0.0}
    activity_query = {"action": {"$in": REVENUE_ACTIONS}}
    activity_query.update(_date_range_query("created_at", start_date, end_date))
    activities = await v3_col("lead_activity").find(
        activity_query, {"_id": 0, "lead_id": 1, "details": 1, "action": 1, "created_at": 1}
    ).to_list(50000)
    activity_lead_ids = list({a["lead_id"] for a in activities if a.get("lead_id")})
    activity_leads = await v3_col("leads").find(
        {"id": {"$in": activity_lead_ids}}, {"_id": 0, "id": 1, "branch_id": 1, "vertical": 1}
    ).to_list(50000)
    activity_lead_map = {l["id"]: l for l in activity_leads}

    # Which days each patient paid a consultation fee on. Spot joining is a treatment fee
    # collected on one of those same days — the patient signed up on the spot rather than
    # going away to think about it.
    #
    # Reading this off the in-range activities alone is safe: the filter is whole days
    # either way, so a same-day pair is either both inside the range or both outside it.
    # A treatment fee whose consultation fell in some earlier range isn't spot joining
    # anyway.
    # Keyed on the Consultation Fee actions themselves, not on the "consultation" reporting
    # bucket — that bucket also holds the Diet Consultation Fee, and a diet fee taken on the
    # same day as a treatment fee would otherwise mark that treatment fee as spot joining.
    consult_days: dict[str, set] = {}
    for a in activities:
        if a.get("action", "") in CONSULTATION_FEE_ACTIONS:
            consult_days.setdefault(a.get("lead_id"), set()).add(str(a.get("created_at", ""))[:10])

    for a in activities:
        lead = activity_lead_map.get(a.get("lead_id"), {})
        bid = lead.get("branch_id")
        amount = _parse_rs_amount(a.get("details", ""))
        add_to_bucket(revenue_bucket, bid, lead.get("vertical") or branch_vertical(bid), amount)
        category = _revenue_category(a.get("action", ""))
        revenue_split[category] += amount
        if category == "session" and str(a.get("created_at", ""))[:10] in consult_days.get(a.get("lead_id"), ()):
            revenue_split["spot_joining"] += amount

    return {
        "applied_filters": {"start_date": start_date, "end_date": end_date},
        "leads": format_bucket(leads_bucket),
        "appointments": format_bucket(appt_bucket),
        "treatments": format_bucket(treat_bucket),
        # spot_joining is a slice of session, not money on top of it — total stays
        # consultation + session + diet.
        "revenue": {
            **format_bucket(revenue_bucket, currency=True),
            "consultation": round(revenue_split["consultation"], 2),
            "session": round(revenue_split["session"], 2),
            "diet": round(revenue_split["diet"], 2),
            "spot_joining": round(revenue_split["spot_joining"], 2),
        },
    }


@router.get("/dashboard/leads-trend")
async def v3_dashboard_leads_trend(
    months: int = Query(6, ge=2, le=24),
    _: V3UserOut = Depends(v3_require_roles("super_admin")),
):
    """Leads, Appointments, Treatments and Revenue per Physiotherapy branch, by calendar
    month, most recent last. The route keeps its leads-trend name because callers and
    tests already use it; each branch now carries a `series` of all four alongside the
    original `values`, which stays the leads row.

    All four are counted exactly as /dashboard/overview counts them, field for field, so
    a headline card and the line drawn under it cannot disagree about what the metric is.

    Takes no date filter of its own. A trend answers "which way is this going", and a
    six-month line inside a one-day filter would be a single point — the board's range
    control narrows the figures above it, not the shape of the history behind them.

    Every branch gets a full-length row, zeros included. A branch that took no leads in
    March has a real value of 0 there, and dropping the point would draw a line straight
    from February to April as though the month never happened.
    """
    branches = await v3_col("branches").find(
        {"vertical": "offline_physiotherapy"}, {"_id": 0, "id": 1, "branch_name": 1}
    ).to_list(500)
    if not branches:
        return {"months": [], "branches": []}

    now = datetime.now(timezone.utc)
    keys: list = []
    y, m = now.year, now.month
    for _i in range(months):
        keys.append(f"{y}-{str(m).zfill(2)}")
        m -= 1
        if m == 0:
            m = 12
            y -= 1
    keys.reverse()

    branch_ids = [b["id"] for b in branches]
    floor = f"{keys[0]}-01"

    # One bucket per metric. Each is {branch_id: {month_key: number}}, and `key in bucket`
    # rather than a date comparison guards every add: the $gte bounds below are string
    # comparisons, so a malformed date can slip past one and would otherwise land in no
    # month at all — or worse, create one.
    def empty():
        return {bid: {k: 0.0 for k in keys} for bid in branch_ids}

    def add(bucket, branch_id, raw_date, amount=1.0):
        row = bucket.get(branch_id)
        key = str(raw_date or "")[:7]
        if row is not None and key in row:
            row[key] += amount

    # The four are counted exactly as /dashboard/overview counts them, field for field, so
    # a card and the line under it can never disagree about what a metric means: leads by
    # created_at, appointments by appointment_date, treatments as completed sessions by
    # slot_time, revenue off the lead_activity payment trail.
    leads_b, appts_b, treat_b, rev_b = empty(), empty(), empty(), empty()

    for r in await v3_col("leads").find(
        {"branch_id": {"$in": branch_ids}, "created_at": {"$gte": floor}},
        {"_id": 0, "branch_id": 1, "created_at": 1},
    ).to_list(100000):
        add(leads_b, r.get("branch_id"), r.get("created_at"))

    for r in await v3_col("leads").find(
        {"branch_id": {"$in": branch_ids}, "appointment_date": {"$gte": floor}},
        {"_id": 0, "branch_id": 1, "appointment_date": 1},
    ).to_list(100000):
        add(appts_b, r.get("branch_id"), r.get("appointment_date"))

    for s in await v3_col("sessions").find(
        {"branch_id": {"$in": branch_ids}, "status": "completed", "slot_time": {"$gte": floor}},
        {"_id": 0, "branch_id": 1, "slot_time": 1},
    ).to_list(100000):
        add(treat_b, s.get("branch_id"), s.get("slot_time"))

    # Revenue has no branch on the activity itself, so each payment is attributed through
    # its lead — the same hop /dashboard/overview makes.
    activities = await v3_col("lead_activity").find(
        {"action": {"$in": REVENUE_ACTIONS}, "created_at": {"$gte": floor}},
        {"_id": 0, "lead_id": 1, "details": 1, "created_at": 1},
    ).to_list(100000)
    act_lead_ids = list({a["lead_id"] for a in activities if a.get("lead_id")})
    lead_branch = {
        l["id"]: l.get("branch_id")
        for l in await v3_col("leads").find({"id": {"$in": act_lead_ids}}, {"_id": 0, "id": 1, "branch_id": 1}).to_list(100000)
    }
    for a in activities:
        add(rev_b, lead_branch.get(a.get("lead_id")), a.get("created_at"), _parse_rs_amount(a.get("details", "")))

    def series(bucket, bid, currency=False):
        return [round(bucket[bid][k], 2) if currency else int(bucket[bid][k]) for k in keys]

    return {
        "months": keys,
        "branches": [
            {
                "branch_id": b["id"],
                "branch_name": b.get("branch_name", ""),
                # Kept as the leads series so any older caller reading `values` is unaffected.
                "values": series(leads_b, b["id"]),
                "series": {
                    "leads": series(leads_b, b["id"]),
                    "appointments": series(appts_b, b["id"]),
                    "treatments": series(treat_b, b["id"]),
                    "revenue": series(rev_b, b["id"], currency=True),
                },
            }
            for b in branches
        ],
    }


ROLE_LABELS = {
    "branch_admin": "Branch Admin",
    "pre_sales": "Pre-Sales",
    "super_admin": "Super Admin",
    "head_physio": "CONSULTANT",
    "physio": "Physio",
}


@router.get("/dashboard/branch-breakdown")
async def v3_dashboard_branch_breakdown(
    branch_id: str = Query(...),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    _: V3UserOut = Depends(v3_require_roles("super_admin")),
):
    """Who did the work behind one branch's Dashboard number, for the same date range.

    Four groups, each a total and a per-person count:

      Pre Sales           leads owned by a Pre-Sales agent  (leads.assigned_user_id)
      Branch Appointment  consultation appointments, by who booked them
                          (appointments.created_by — the only record of *who*; nothing
                          assigns an appointment to a person the way a lead is assigned)
      Head Physio         those same appointments, by the doctor seen
      Physio              leads with a physio assigned  (leads.assigned_physio_id)

    Every roster is drawn from the branch's own staff first, so someone who did nothing
    in the period still shows with 0 rather than vanishing — an empty week is a fact
    about that person, not an absence of one. Anyone who appears in the data but isn't
    on the roster (left the branch, moved role) is appended, so the member counts always
    add up to the group total.
    """
    branch = await v3_col("branches").find_one({"id": branch_id}, {"_id": 0, "id": 1, "branch_name": 1})
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")

    lead_rows = await v3_col("leads").find(
        {"branch_id": branch_id, **_date_range_query("created_at", start_date, end_date)},
        {"_id": 0, "assigned_user_id": 1, "assigned_user_name": 1, "assigned_physio_id": 1, "assigned_physio_name": 1},
    ).to_list(50000)

    appt_rows = await v3_col("appointments").find(
        {"branch_id": branch_id, "appt_kind": "consultation", **_date_range_query("created_at", start_date, end_date)},
        {"_id": 0, "doctor_id": 1, "doctor_name": 1, "created_by": 1, "created_by_role": 1},
    ).to_list(50000)

    users = await v3_col("users").find(
        {"$or": [{"branch_id": branch_id}, {"branch_ids": branch_id}]},
        {"_id": 0, "id": 1, "full_name": 1, "role": 1},
    ).to_list(500)
    doctors = await v3_col("doctors").find(
        {"branch_id": branch_id}, {"_id": 0, "id": 1, "full_name": 1, "profile_type": 1}
    ).to_list(500)

    def build(roster, rows, key_of, name_of, unassigned_as=None):
        """roster seeds the zeros; rows supply the counts. Keyed by id where there is
        one, otherwise by name — appointments record `created_by` as a name only.

        `unassigned_as` names a bucket for rows carrying nobody. Without it those rows
        are dropped, which is right for "how many leads has a physio" but wrong for a
        group whose total is meant to match a branch card: Pre Sales read 0 against a
        card of 2230 purely because none of those leads had ever been assigned to an
        agent. Dropped rows make that look like no data; a named bucket makes it look
        like what it is."""
        counts: dict = {}
        labels: dict = {}
        for r in roster:
            counts[r["key"]] = 0
            labels[r["key"]] = r["name"]
        total = 0
        for row in rows:
            k = key_of(row)
            if k:
                nm = name_of(row) or "Unknown"
            elif unassigned_as:
                k, nm = "__unassigned__", unassigned_as
            else:
                continue
            total += 1
            counts[k] = counts.get(k, 0) + 1
            labels.setdefault(k, nm)
        members = [
            {"key": k, "name": labels.get(k) or "Unknown", "count": counts[k]}
            for k in counts
        ]
        # Busiest first; the zeros settle at the bottom in name order.
        members.sort(key=lambda m: (-m["count"], m["name"].lower()))
        return {"total": total, "members": members}

    pre_sales_roster = [
        {"key": u["id"], "name": u.get("full_name") or "Unknown"} for u in users if u.get("role") == "pre_sales"
    ]
    # Keyed by name, to match what appointments store.
    booker_roster = [
        {"key": u.get("full_name") or "", "name": f"{u.get('full_name') or 'Unknown'} · {ROLE_LABELS.get(u.get('role'), u.get('role') or '')}".strip(" ·")}
        for u in users if u.get("role") == "branch_admin" and u.get("full_name")
    ]
    head_physio_roster = [
        {"key": d["id"], "name": d.get("full_name") or "Unknown"} for d in doctors if d.get("profile_type") == "head_physio"
    ]
    physio_roster = [
        {"key": d["id"], "name": d.get("full_name") or "Unknown"} for d in doctors if d.get("profile_type") == "physio"
    ]

    return {
        "branch_id": branch_id,
        "branch_name": branch.get("branch_name", ""),
        "applied_filters": {"start_date": start_date, "end_date": end_date},
        "groups": [
            {
                "key": "pre_sales",
                "label": "Pre Sales (Total Leads)",
                # Labelled "Total Leads", so its total has to be the branch's lead count
                # off the Dashboard card — including the ones no agent ever owned.
                **build(
                    pre_sales_roster, lead_rows,
                    lambda r: r.get("assigned_user_id"), lambda r: r.get("assigned_user_name"),
                    unassigned_as="No agent assigned",
                ),
            },
            {
                "key": "branch_appointment",
                "label": "Branch Appointment",
                **build(booker_roster, appt_rows, lambda r: r.get("created_by"), lambda r: r.get("created_by")),
            },
            {
                "key": "head_physio",
                "label": "CONSULTANT",
                **build(head_physio_roster, appt_rows, lambda r: r.get("doctor_id"), lambda r: r.get("doctor_name")),
            },
            {
                "key": "physio",
                "label": "Physio",
                **build(physio_roster, lead_rows, lambda r: r.get("assigned_physio_id"), lambda r: r.get("assigned_physio_name")),
            },
        ],
    }


# ---------------------------------------------------------------- Dashboard > Leads tab

# What "converted" means here, and why each line is drawn where it is. Every one of these
# is a judgement about the branch's funnel, not a fact the data states, so they are named
# once and read from here rather than being re-decided inside the loop.
#
#   Enquiries    every lead. The top of the funnel and the denominator for the rest.
#   Slot Fixed   an appointment date exists. A slot was actually fixed for them.
#   Consultation the Consultation Fee was collected — the consultation HAPPENED. Booked is
#                already counted by Slot Fixed, so counting booked here would print the
#                same number twice and hide every no-show.
#   Converted    they bought something beyond the consultation: a treatment package, or a
#                diet plan. That is the moment a lead becomes a customer of a service.


def _is_converted(lead: dict) -> bool:
    return (
        lead.get("treatment_fee_paid") is not None
        or bool(lead.get("session_package_id"))
        or lead.get("diet_fee_paid") is not None
    )


def _due_today(lead: dict, today: str) -> bool:
    return (
        str(lead.get("next_follow_up_at") or "").startswith(today)
        or str(lead.get("next_consultation_follow_up_at") or "").startswith(today)
    )


def _payment_due_today(lead: dict, today: str) -> bool:
    return any(
        not i.get("paid") and str(i.get("due_date") or "") == today
        for i in ((lead.get("treatment_fee_payment_details") or {}).get("installments") or [])
    )


# One predicate per metric, and the ONLY definition of each. The card's figure and the list
# of people behind it are both built from this, so a card can never show a number the drill
# -down then fails to account for — the commonest way a dashboard loses trust.
#
# `ranged` says whether the metric answers to the date filter. The two daily ones do not:
# a follow-up due today on a lead from March is still due today, so they read every lead
# and filter on the day instead.
METRIC_DEFS = {
    "day_follow_up_calls": {
        "label": "Day Follow Up Calls", "sub": "People due a follow-up call today",
        "ranged": False, "match": lambda l, today: _due_today(l, today),
    },
    "day_follow_up_payment": {
        "label": "Day Follow Up Payment", "sub": "Installments falling due today",
        "ranged": False, "match": lambda l, today: _payment_due_today(l, today),
        # A count says how many calls to make; the amount says how much is riding on them.
        # Carried on the card itself rather than as a separate tile, so the two figures
        # can never be read as describing different sets of people.
        "amount": lambda l, today: sum(
            float(i.get("amount") or 0)
            for i in ((l.get("treatment_fee_payment_details") or {}).get("installments") or [])
            if not i.get("paid") and str(i.get("due_date") or "") == today
        ),
    },
    "enquiries": {
        "label": "Number Of Enquiries", "sub": "Every lead that came in",
        "ranged": True, "match": lambda l, today: True,
    },
    "consultations": {
        "label": "Number Of Consultation", "sub": "Consultation Fee collected",
        "ranged": True, "match": lambda l, today: l.get("package_paid") is not None,
    },
    "converted": {
        "label": "Number Of Converted", "sub": "Took treatment or a diet plan",
        "ranged": True, "match": lambda l, today: _is_converted(l),
    },
    "assigned_follow_up": {
        "label": "Assign To Follow Up Person", "sub": "Leads with an owner",
        "ranged": True, "match": lambda l, today: bool(l.get("assigned_user_id")),
    },
    "slot_fixed": {
        "label": "Slot Fixed", "sub": "Appointment date fixed",
        "ranged": True, "match": lambda l, today: bool(l.get("appointment_date")),
    },
}
METRIC_ORDER = list(METRIC_DEFS.keys())




async def _physio_branches() -> list:
    rows = await v3_col("branches").find({}, {"_id": 0}).to_list(200)
    return [b for b in rows if b.get("vertical") == "offline_physiotherapy"]


def _lead_source(lead: dict) -> str:
    return lead.get("source_tab") or lead.get("source_type") or "unknown"


@router.get("/dashboard/lead-metrics")
async def dashboard_lead_metrics(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    _: V3UserOut = Depends(v3_require_roles("super_admin", "branch_admin")),
):
    """The Pre Sales tab: one card per metric, each carrying its branch split.

    Two of the seven are daily by name and stay daily whatever the date filter says — a
    "Day Follow Up Calls" figure for a three-month range is not a thing anyone asked for.
    Each card states its own period so the difference is on screen, not in someone's head.
    """
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    branches = await _physio_branches()
    branch_ids = {b["id"] for b in branches}

    ranged = await v3_col("leads").find(
        _date_range_query("created_at", start_date, end_date), {"_id": 0}
    ).to_list(50000)
    everyone = await v3_col("leads").find({}, {"_id": 0}).to_list(50000)

    cards = []
    for key in METRIC_ORDER:
        d = METRIC_DEFS[key]
        pool = ranged if d["ranged"] else everyone
        counts = {bid: 0 for bid in branch_ids}
        amount = 0.0
        for l in pool:
            bid = l.get("branch_id")
            if bid in counts and d["match"](l, today):
                counts[bid] += 1
                if d.get("amount"):
                    amount += d["amount"](l, today)
        cards.append({
            "key": key,
            "label": d["label"],
            "sub": d["sub"],
            "period": "range" if d["ranged"] else "today",
            "total": sum(counts.values()),
            # Only the metrics that carry money have one, so a card with nothing to say
            # about rupees says nothing rather than printing Rs.0.
            "amount": round(amount, 2) if d.get("amount") else None,
            "branches": [
                {"branch_id": b["id"], "branch_name": b.get("branch_name", ""), "value": counts[b["id"]]}
                for b in branches
            ],
        })

    return {
        "applied_filters": {"start_date": start_date, "end_date": end_date},
        "today": today,
        "branches": [{"branch_id": b["id"], "branch_name": b.get("branch_name", "")} for b in branches],
        "cards": cards,
    }


@router.get("/dashboard/lead-metric-detail")
async def dashboard_lead_metric_detail(
    metric: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    branch_id: Optional[str] = None,
    source: Optional[str] = None,
    stage: Optional[str] = None,
    limit: int = 500,
    _: V3UserOut = Depends(v3_require_roles("super_admin", "branch_admin")),
):
    """The people behind one card.

    Built from the same METRIC_DEFS predicate the card counted with, so the drill-down can
    never fail to account for the figure that opened it.

    Its own filters narrow further and are reported separately: `total` is what the card
    said, `filtered` is what is left after the popup's own branch/source/stage narrowing.
    Collapsing the two into one number is how a filtered list starts looking like the whole
    truth about the metric.
    """
    d = METRIC_DEFS.get(metric)
    if not d:
        raise HTTPException(status_code=404, detail=f"Unknown metric '{metric}'")

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    branches = await _physio_branches()
    branch_ids = {b["id"] for b in branches}
    branch_names = {b["id"]: b.get("branch_name", "") for b in branches}

    query = _date_range_query("created_at", start_date, end_date) if d["ranged"] else {}
    pool = await v3_col("leads").find(query, {"_id": 0}).to_list(50000)

    matched = [l for l in pool if l.get("branch_id") in branch_ids and d["match"](l, today)]

    # Every branch, source and stage present in the metric BEFORE the popup's own filters —
    # a dropdown that only lists what survives the current filter is one you can never use
    # to widen the selection again.
    by_branch: dict = {}
    by_source: dict = {}
    by_stage: dict = {}
    for l in matched:
        by_branch[l["branch_id"]] = by_branch.get(l["branch_id"], 0) + 1
        by_source[_lead_source(l)] = by_source.get(_lead_source(l), 0) + 1
        st = l.get("branch_stage") or l.get("stage") or "—"
        by_stage[st] = by_stage.get(st, 0) + 1

    rows = matched
    if branch_id:
        rows = [l for l in rows if l.get("branch_id") == branch_id]
    if source:
        rows = [l for l in rows if _lead_source(l) == source]
    if stage:
        rows = [l for l in rows if (l.get("branch_stage") or l.get("stage") or "—") == stage]

    rows.sort(key=lambda l: str(l.get("created_at") or ""), reverse=True)

    return {
        "metric": metric,
        "label": d["label"],
        "sub": d["sub"],
        "period": "range" if d["ranged"] else "today",
        "total": len(matched),
        "filtered": len(rows),
        "branches": [
            {"branch_id": b["id"], "branch_name": branch_names[b["id"]], "value": by_branch.get(b["id"], 0)}
            for b in branches
        ],
        "sources": sorted(
            ({"name": k, "value": v} for k, v in by_source.items()),
            key=lambda r: -r["value"],
        ),
        "stages": sorted(
            ({"name": k, "value": v} for k, v in by_stage.items()),
            key=lambda r: -r["value"],
        ),
        "leads": [
            {
                "id": l.get("id"),
                "name": l.get("name", "Unknown"),
                "phone": l.get("phone", ""),
                "branch_name": branch_names.get(l.get("branch_id"), ""),
                "source": _lead_source(l),
                "stage": l.get("branch_stage") or l.get("stage") or "—",
                "created_at": l.get("created_at"),
                "assigned_user_name": l.get("assigned_user_name"),
            }
            for l in rows[:limit]
        ],
    }
