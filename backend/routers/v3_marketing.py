from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional, Dict, List, Any
from urllib.parse import urlparse
import uuid
import re

from database import v3_col
from utils import now_iso, generate_patient_number
from deps import v3_require_roles, v3_current_user
from constants import V3_STAGES
from security import hash_password
from schemas.v3 import V3UserOut
from stage_utils import get_first_stage_name
from pydantic import BaseModel
from typing import Literal


router = APIRouter(prefix="/api/v3/marketing")


# ============ helpers ============

STANDARD_FIELDS = ["name", "phone", "email", "vertical", "condition", "age", "preferred_branch", "budget", "notes"]

FIELD_ALIASES = {
    "name": ["name", "lead name", "full name", "fullname", "customer name", "patient name"],
    "phone": ["phone", "phone number", "mobile", "mobile number", "contact", "contact number", "whatsapp"],
    "email": ["email", "email id", "email address", "mail"],
    "vertical": ["vertical", "service", "service type", "category", "product"],
    "condition": ["condition", "issue", "ailment", "problem", "concern"],
    "age": ["age", "patient age"],
    "preferred_branch": ["branch", "preferred branch", "city", "location"],
    "budget": ["budget", "amount", "price range"],
    "notes": ["notes", "remarks", "comments", "message"],
}

SOURCE_TYPES = ["meta", "seo", "referral", "walk_in", "website", "csv_import", "google_sheets", "other"]


def normalize_phone(value: str) -> str:
    digits = re.sub(r"\D", "", value or "")
    return digits[-10:] if len(digits) >= 10 else digits


def extract_spreadsheet_id(url: str) -> str:
    m = re.search(r"/d/([a-zA-Z0-9-_]+)", url or "")
    if m:
        return m.group(1)
    parsed = urlparse(url or "")
    return parsed.path.strip("/") or url


def auto_map_columns(headers: List[str]) -> Dict[str, str]:
    mapping: Dict[str, str] = {}
    lowered = {h.strip().lower(): h for h in headers}
    used: set = set()
    for std, aliases in FIELD_ALIASES.items():
        for alias in aliases:
            if alias in lowered and lowered[alias] not in used:
                mapping[std] = lowered[alias]
                used.add(lowered[alias])
                break
    return mapping


async def round_robin_assign(stage_type: str) -> Optional[Dict[str, str]]:
    settings = await v3_col("marketing_settings").find_one({"id": "_singleton_"}, {"_id": 0})
    if not settings or not settings.get("enabled"):
        return None
    if settings.get("distribution_type") != "round_robin":
        return None
    key = "pre_sales_team" if stage_type == "pre_sales" else "sales_team"
    idx_key = "pre_sales_current_index" if stage_type == "pre_sales" else "sales_current_index"
    team: List[str] = settings.get(key, []) or []
    if not team:
        return None
    idx = settings.get(idx_key, 0) % len(team)
    assigned_user_id = team[idx]
    new_idx = (idx + 1) % len(team)
    await v3_col("marketing_settings").update_one(
        {"id": "_singleton_"},
        {"$set": {idx_key: new_idx, "updated_at": now_iso()}},
    )
    user = await v3_col("users").find_one({"id": assigned_user_id}, {"_id": 0, "password": 0})
    if not user:
        return None
    return {"id": user["id"], "full_name": user.get("full_name", "")}


async def ensure_settings_doc() -> Dict[str, Any]:
    existing = await v3_col("marketing_settings").find_one({"id": "_singleton_"}, {"_id": 0})
    if existing:
        return existing
    doc = {
        "id": "_singleton_",
        "enabled": False,
        "distribution_type": "round_robin",
        "pre_sales_team": [],
        "sales_team": [],
        "pre_sales_current_index": 0,
        "sales_current_index": 0,
        "updated_at": now_iso(),
    }
    await v3_col("marketing_settings").insert_one(doc.copy())
    return doc


# ============ schemas (local) ============

class MarketingSourceCreate(BaseModel):
    name: str
    sheet_url: Optional[str] = ""
    sheet_name: Optional[str] = "Sheet1"
    spreadsheet_id: Optional[str] = ""
    source_type: Literal["meta", "seo", "referral", "walk_in", "website", "csv_import", "google_sheets", "other"] = "google_sheets"
    headers: Optional[List[str]] = None
    branch_id: Optional[str] = None  # if set, every lead pulled from this source auto-assigns to this branch


class MarketingSourceUpdate(BaseModel):
    name: Optional[str] = None
    source_type: Optional[Literal["meta", "seo", "referral", "walk_in", "website", "csv_import", "google_sheets", "other"]] = None
    sheet_url: Optional[str] = None
    spreadsheet_id: Optional[str] = None
    sheet_name: Optional[str] = None
    headers: Optional[List[str]] = None
    branch_id: Optional[str] = None  # pass "" to clear back to "All Branches"
    column_mapping: Optional[Dict[str, str]] = None
    custom_fields: Optional[List[str]] = None
    is_active: Optional[bool] = None
    auto_sync_enabled: Optional[bool] = None
    auto_sync_interval_minutes: Optional[int] = None


class MarketingSyncInput(BaseModel):
    rows: List[Dict[str, Any]]


class DistributionUpdate(BaseModel):
    enabled: Optional[bool] = None
    distribution_type: Optional[Literal["round_robin", "manual"]] = None
    pre_sales_team: Optional[List[str]] = None
    sales_team: Optional[List[str]] = None


class TeamMemberCreate(BaseModel):
    full_name: str
    email: str
    password: str
    team_type: Literal["pre_sales", "branch_admin"]
    branch_id: Optional[str] = None


class BulkDelete(BaseModel):
    lead_ids: List[str]


# ============ dashboard ============

@router.get("/dashboard")
async def marketing_dashboard(_: V3UserOut = Depends(v3_require_roles("super_admin"))):
    pre_sales_count = await v3_col("leads").count_documents({"stage": {"$in": ["New Leads", "Follow Up"]}})
    sales_count = await v3_col("leads").count_documents({"stage": "Appointment"})
    completed_count = await v3_col("leads").count_documents({"branch_stage": "Assigned Physio"})
    total_pre_sales_ever = pre_sales_count + sales_count + completed_count
    conv = (completed_count / total_pre_sales_ever * 100.0) if total_pre_sales_ever else 0.0

    sources = await v3_col("marketing_sources").count_documents({"is_active": True})

    pipeline = [
        {"$group": {"_id": "$source_tab", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]
    by_source_raw = await v3_col("leads").aggregate(pipeline).to_list(50)
    by_source = [{"source": (row.get("_id") or "unknown"), "count": row["count"]} for row in by_source_raw]

    recent = await v3_col("leads").find({}, {"_id": 0}).sort("created_at", -1).to_list(20)
    return {
        "kpis": {
            "pre_sales_leads": pre_sales_count,
            "sales_leads": sales_count,
            "active_sources": sources,
            "conversion_rate": round(conv, 1),
        },
        "by_source": by_source,
        "recent_leads": recent,
    }


# ============ distribution settings ============

@router.get("/distribution-settings")
async def get_distribution_settings(_: V3UserOut = Depends(v3_require_roles("super_admin"))):
    return await ensure_settings_doc()


@router.patch("/distribution-settings")
async def patch_distribution_settings(payload: DistributionUpdate, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    await ensure_settings_doc()
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No updates provided")
    updates["updated_at"] = now_iso()
    await v3_col("marketing_settings").update_one({"id": "_singleton_"}, {"$set": updates})
    return await v3_col("marketing_settings").find_one({"id": "_singleton_"}, {"_id": 0})


@router.post("/distribution-settings/refresh")
async def refresh_distribution_settings(_: V3UserOut = Depends(v3_require_roles("super_admin"))):
    await ensure_settings_doc()
    pre_users = await v3_col("users").find({"role": "pre_sales", "is_active": True}, {"_id": 0, "password": 0}).to_list(500)
    sales_users = await v3_col("users").find({"role": "branch_admin", "is_active": True}, {"_id": 0, "password": 0}).to_list(500)
    pre_ids = [u["id"] for u in pre_users]
    sales_ids = [u["id"] for u in sales_users]
    await v3_col("marketing_settings").update_one(
        {"id": "_singleton_"},
        {"$set": {"pre_sales_team": pre_ids, "sales_team": sales_ids, "updated_at": now_iso()}},
    )
    return await v3_col("marketing_settings").find_one({"id": "_singleton_"}, {"_id": 0})


# ============ team members ============

@router.get("/team-members")
async def get_team_members(_: V3UserOut = Depends(v3_require_roles("super_admin"))):
    pre = await v3_col("users").find({"role": "pre_sales", "is_active": True}, {"_id": 0, "password": 0}).to_list(500)
    sales = await v3_col("users").find({"role": "branch_admin", "is_active": True}, {"_id": 0, "password": 0}).to_list(500)

    async def enrich(users: List[Dict[str, Any]], tier: str) -> List[Dict[str, Any]]:
        out = []
        for u in users:
            lead_filter = {"assigned_user_id": u["id"]}
            if tier == "sales":
                lead_filter = {"assigned_user_id": u["id"], "stage": "Appointment"}
            else:
                lead_filter = {"assigned_user_id": u["id"], "stage": {"$in": ["New Leads", "Follow Up"]}}
            current_leads = await v3_col("leads").count_documents(lead_filter)
            total_assigned = await v3_col("leads").count_documents({"assigned_user_id": u["id"]})
            closed = await v3_col("leads").count_documents({"assigned_user_id": u["id"], "branch_stage": "Assigned Physio"})
            conv = (closed / total_assigned * 100.0) if total_assigned else 0.0
            out.append({
                "id": u["id"],
                "full_name": u.get("full_name", ""),
                "email": u.get("email", ""),
                "branch_id": u.get("branch_id"),
                "current_leads": current_leads,
                "deals_closed": closed,
                "total_assigned": total_assigned,
                "conversion_rate": round(conv, 1),
            })
        return out

    return {
        "pre_sales": await enrich(pre, "pre_sales"),
        "sales": await enrich(sales, "sales"),
    }


@router.post("/team-members")
async def create_team_member(payload: TeamMemberCreate, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    existing = await v3_col("users").find_one({"email": payload.email}, {"_id": 0, "id": 1})
    if existing:
        raise HTTPException(status_code=409, detail="Email already in use")
    user = {
        "id": str(uuid.uuid4()),
        "full_name": payload.full_name,
        "email": payload.email,
        "password": hash_password(payload.password),
        "role": payload.team_type,
        "branch_id": payload.branch_id,
        "is_active": True,
        "created_at": now_iso(),
    }
    await v3_col("users").insert_one(user.copy())
    safe = {k: v for k, v in user.items() if k != "password"}
    return safe


# ============ all leads ============

@router.get("/all-leads")
async def all_leads(
    stage_type: Optional[Literal["pre_sales", "sales", "all"]] = "all",
    source: Optional[str] = None,
    assigned_to: Optional[str] = None,
    search: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    _: V3UserOut = Depends(v3_require_roles("super_admin")),
):
    query: Dict[str, Any] = {}
    if stage_type == "pre_sales":
        query["stage"] = {"$in": ["New Leads", "Follow Up"]}
    elif stage_type == "sales":
        query["stage"] = "Appointment"
    if source:
        query["source_tab"] = source
    if assigned_to:
        query["assigned_user_id"] = assigned_to
    if search:
        rgx = {"$regex": re.escape(search), "$options": "i"}
        query["$or"] = [{"name": rgx}, {"phone": rgx}, {"email": rgx}]

    total = await v3_col("leads").count_documents(query)
    rows = await v3_col("leads").find(query, {"_id": 0}).sort("created_at", -1).skip((page - 1) * page_size).limit(page_size).to_list(page_size)
    return {"total": total, "page": page, "page_size": page_size, "rows": rows}


@router.post("/assign-lead/{lead_id}")
async def assign_lead(lead_id: str, assigned_to: str, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    user = await v3_col("users").find_one({"id": assigned_to, "is_active": True}, {"_id": 0, "password": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    res = await v3_col("leads").update_one(
        {"id": lead_id},
        {"$set": {
            "assigned_user_id": assigned_to,
            "assigned_user_name": user.get("full_name", ""),
            "assigned_user_role": user.get("role", ""),
            "updated_at": now_iso(),
        }},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Lead not found")
    return {"message": "Lead reassigned", "assigned_user_id": assigned_to}


@router.delete("/leads/{lead_id}")
async def delete_lead(lead_id: str, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    res = await v3_col("leads").delete_one({"id": lead_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Lead not found")
    return {"message": "Lead deleted"}


@router.post("/leads/bulk-delete")
async def bulk_delete_leads(payload: BulkDelete, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    if not payload.lead_ids:
        return {"deleted": 0}
    res = await v3_col("leads").delete_many({"id": {"$in": payload.lead_ids}})
    return {"deleted": res.deleted_count}


# ============ sources ============

@router.get("/sources")
async def list_sources(_: V3UserOut = Depends(v3_require_roles("super_admin"))):
    rows = await v3_col("marketing_sources").find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return rows


@router.post("/sources")
async def create_source(payload: MarketingSourceCreate, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    if payload.branch_id:
        branch = await v3_col("branches").find_one({"id": payload.branch_id}, {"_id": 0, "id": 1})
        if not branch:
            raise HTTPException(status_code=404, detail="Branch not found")
    spreadsheet_id = payload.spreadsheet_id or (extract_spreadsheet_id(payload.sheet_url) if payload.sheet_url else "")
    column_mapping = auto_map_columns(payload.headers or []) if payload.headers else {}
    detected_custom = [h for h in (payload.headers or []) if h not in column_mapping.values()]
    source = {
        "id": str(uuid.uuid4()),
        "name": payload.name,
        "source_type": payload.source_type,
        "sheet_url": payload.sheet_url or "",
        "spreadsheet_id": spreadsheet_id,
        "sheet_name": payload.sheet_name or "Sheet1",
        "column_mapping": column_mapping,
        "custom_fields": detected_custom,
        "headers_detected": payload.headers or [],
        "branch_id": payload.branch_id or None,
        "row_count": 0,
        "last_synced": None,
        "is_active": True,
        "created_at": now_iso(),
    }
    await v3_col("marketing_sources").insert_one(source.copy())
    return source


@router.patch("/sources/{source_id}")
async def update_source(source_id: str, payload: MarketingSourceUpdate, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    if payload.branch_id:
        branch = await v3_col("branches").find_one({"id": payload.branch_id}, {"_id": 0, "id": 1})
        if not branch:
            raise HTTPException(status_code=404, detail="Branch not found")
    updates = {k: v for k, v in payload.model_dump().items() if v is not None and k != "headers"}
    if payload.sheet_url and not payload.spreadsheet_id:
        extracted = extract_spreadsheet_id(payload.sheet_url)
        if extracted:
            updates["spreadsheet_id"] = extracted
    if payload.headers is not None:
        column_mapping = auto_map_columns(payload.headers) if payload.headers else {}
        updates["headers_detected"] = payload.headers
        updates["column_mapping"] = column_mapping
        updates["custom_fields"] = [h for h in payload.headers if h not in column_mapping.values()]
    if not updates:
        raise HTTPException(status_code=400, detail="No updates provided")
    res = await v3_col("marketing_sources").update_one({"id": source_id}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Source not found")
    return await v3_col("marketing_sources").find_one({"id": source_id}, {"_id": 0})


@router.delete("/sources/{source_id}")
async def delete_source(source_id: str, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    res = await v3_col("marketing_sources").delete_one({"id": source_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Source not found")
    return {"message": "Source deleted"}


@router.post("/sources/{source_id}/sync")
async def sync_source(source_id: str, payload: MarketingSyncInput, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    source = await v3_col("marketing_sources").find_one({"id": source_id}, {"_id": 0})
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    mapping = dict(source.get("column_mapping", {}) or {})
    # If mapping is missing entries, auto-map from the FIRST row's keys
    if payload.rows and not all(k in mapping for k in ("name", "phone")):
        first_row_keys = list(payload.rows[0].keys())
        inferred = auto_map_columns(first_row_keys)
        for k, v in inferred.items():
            mapping.setdefault(k, v)

    if "phone" not in mapping:
        # Last-ditch fallback: treat row['phone'] as phone
        mapping["phone"] = "phone"

    phone_key = mapping["phone"]
    imported = 0
    skipped_no_phone = 0
    skipped_duplicate = 0
    sample_errors: List[str] = []
    first_branch_stage = await get_first_stage_name("sales", "New Appointment")

    for idx, row in enumerate(payload.rows):
        phone_raw = str(row.get(phone_key, "") or "").strip()
        phone_norm = normalize_phone(phone_raw)
        if not phone_norm:
            skipped_no_phone += 1
            if len(sample_errors) < 3:
                sample_errors.append(f"row {idx + 1}: missing/invalid phone (looking in column '{phone_key}')")
            continue
        exists = await v3_col("leads").find_one({"phone_normalized": phone_norm}, {"_id": 0, "id": 1})
        if exists:
            skipped_duplicate += 1
            if len(sample_errors) < 3:
                sample_errors.append(f"row {idx + 1}: duplicate phone {phone_raw}")
            continue

        std_payload: Dict[str, Any] = {}
        for std in STANDARD_FIELDS:
            src_key = mapping.get(std)
            if src_key and src_key in row:
                std_payload[std] = row[src_key]

        custom_payload: Dict[str, Any] = {}
        mapped_values = set(mapping.values())
        for key, value in row.items():
            if key not in mapped_values and value not in (None, ""):
                custom_payload[key] = value

        assigned = await round_robin_assign("pre_sales")
        source_branch_id = source.get("branch_id")
        patient_number = await generate_patient_number(source_branch_id) if source_branch_id else None
        lead = {
            "id": str(uuid.uuid4()),
            "patient_number": patient_number,
            "name": (std_payload.get("name") or "").strip() or "Unknown",
            "phone": phone_raw,
            "phone_normalized": phone_norm,
            "email": std_payload.get("email", ""),
            "vertical": std_payload.get("vertical") or "offline_physiotherapy",
            "source_tab": source["name"],
            "source_type": source.get("source_type", "google_sheets"),
            # Pre-Sales stage stays normal ("New Leads") regardless — a source tagged with a
            # branch only ADDS the branch assignment, landing the lead in that branch's New
            # Appointment column too, without pulling it out of the usual Pre-Sales workflow.
            "stage": "New Leads",
            "branch_id": source_branch_id,
            "branch_stage": first_branch_stage if source_branch_id else None,
            "notes": std_payload.get("notes", ""),
            "extra_fields": {**{k: v for k, v in std_payload.items() if k not in ("name", "email", "phone", "vertical", "notes")}, **custom_payload},
            "assigned_user_id": assigned["id"] if assigned else None,
            "assigned_user_name": assigned["full_name"] if assigned else None,
            "assigned_user_role": "pre_sales" if assigned else None,
            "marketing_source_id": source_id,
            "created_at": now_iso(),
            "updated_at": now_iso(),
        }
        await v3_col("leads").insert_one(lead.copy())
        imported += 1

    new_row_count = (source.get("row_count") or 0) + imported
    update = {"last_synced": now_iso(), "row_count": new_row_count}
    # Persist the inferred mapping so future syncs reuse it
    if mapping != (source.get("column_mapping") or {}):
        update["column_mapping"] = mapping
    await v3_col("marketing_sources").update_one({"id": source_id}, {"$set": update})

    skipped = skipped_no_phone + skipped_duplicate
    return {
        "imported": imported,
        "skipped": skipped,
        "skipped_no_phone": skipped_no_phone,
        "skipped_duplicate": skipped_duplicate,
        "rows_received": len(payload.rows),
        "phone_column_used": phone_key,
        "mapping_used": mapping,
        "sample_errors": sample_errors,
    }


# ============ performance ============

@router.get("/performance")
async def performance(_: V3UserOut = Depends(v3_require_roles("super_admin"))):
    funnel = []
    for stage in V3_STAGES:
        count = await v3_col("leads").count_documents({"stage": stage})
        funnel.append({"stage": stage, "count": count})

    pre_pipeline = [
        {"$match": {"assigned_user_role": "pre_sales"}},
        {"$group": {"_id": {"id": "$assigned_user_id", "name": "$assigned_user_name"}, "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]
    sales_pipeline = [
        {"$match": {"assigned_user_role": "branch_admin", "stage": "Completed"}},
        {"$group": {"_id": {"id": "$assigned_user_id", "name": "$assigned_user_name"}, "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]
    pre_rows = await v3_col("leads").aggregate(pre_pipeline).to_list(50)
    sales_rows = await v3_col("leads").aggregate(sales_pipeline).to_list(50)

    return {
        "funnel": funnel,
        "leads_per_pre_sales": [{"name": r["_id"].get("name") or "Unassigned", "count": r["count"]} for r in pre_rows],
        "deals_per_sales": [{"name": r["_id"].get("name") or "Unassigned", "count": r["count"]} for r in sales_rows],
    }
