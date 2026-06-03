"""
Google Sheets OAuth + Sync.

Endpoints (all under /api/v3/marketing/google-sheets):
- GET  /status       — is the company-wide OAuth connection active?
- GET  /auth         — start OAuth flow (returns URL or 302 redirect)
- GET  /callback     — Google redirects here with ?code= and ?state=
- POST /disconnect   — revoke + clear token
- POST /pull/{source_id} — pull rows from Google Sheets API, dedupe + import via marketing sync logic
"""
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional
import asyncio
import os
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2.credentials import Credentials

from database import v3_col
from utils import now_iso
from deps import v3_require_roles
from schemas.v3 import V3UserOut
from routers.v3_marketing import (
    auto_map_columns, normalize_phone, STANDARD_FIELDS, round_robin_assign,
)


router = APIRouter(prefix="/api/v3/marketing/google-sheets")


CLIENT_ID = os.environ.get("GOOGLE_SHEETS_CLIENT_ID")
CLIENT_SECRET = os.environ.get("GOOGLE_SHEETS_CLIENT_SECRET")
REDIRECT_URI = os.environ.get("GOOGLE_SHEETS_REDIRECT_URI")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "")

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
]


TOKEN_DOC_ID = "_company_shared_"


def _client_config() -> Dict[str, Any]:
    if not CLIENT_ID or not CLIENT_SECRET or not REDIRECT_URI:
        raise HTTPException(
            status_code=500,
            detail="Google OAuth not configured. Set GOOGLE_SHEETS_CLIENT_ID, GOOGLE_SHEETS_CLIENT_SECRET, GOOGLE_SHEETS_REDIRECT_URI.",
        )
    return {
        "web": {
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [REDIRECT_URI],
        }
    }


async def _get_creds() -> Optional[Credentials]:
    doc = await v3_col("google_sheets_tokens").find_one({"id": TOKEN_DOC_ID}, {"_id": 0})
    if not doc or not doc.get("refresh_token"):
        return None
    creds = Credentials(
        token=doc.get("access_token"),
        refresh_token=doc.get("refresh_token"),
        token_uri="https://oauth2.googleapis.com/token",
        client_id=CLIENT_ID,
        client_secret=CLIENT_SECRET,
        scopes=doc.get("scopes") or SCOPES,
    )
    expires_at = doc.get("expires_at")
    if expires_at:
        try:
            dt = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) >= dt - timedelta(seconds=60):
                await asyncio.to_thread(creds.refresh, GoogleRequest())
                await v3_col("google_sheets_tokens").update_one(
                    {"id": TOKEN_DOC_ID},
                    {"$set": {
                        "access_token": creds.token,
                        "expires_at": (creds.expiry.replace(tzinfo=timezone.utc).isoformat() if creds.expiry else None),
                    }},
                )
        except Exception:
            pass
    return creds


# ---------- endpoints ----------

@router.get("/status")
async def status(_: V3UserOut = Depends(v3_require_roles("super_admin", "business_dev", "marketing_head"))):
    doc = await v3_col("google_sheets_tokens").find_one({"id": TOKEN_DOC_ID}, {"_id": 0})
    if not doc:
        return {"connected": False}
    return {
        "connected": bool(doc.get("refresh_token")),
        "connected_at": doc.get("connected_at"),
        "scopes": doc.get("scopes", []),
    }


@router.get("/auth")
async def auth_start(redirect: bool = Query(False), _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    flow = Flow.from_client_config(_client_config(), scopes=SCOPES, redirect_uri=REDIRECT_URI)
    state = str(uuid.uuid4())
    url, _state = flow.authorization_url(access_type="offline", prompt="consent", state=state, include_granted_scopes="true")
    # google-auth-oauthlib 1.x auto-generates a PKCE code_verifier. Persist it so /callback can complete the exchange.
    await v3_col("google_sheets_states").insert_one({
        "state": state,
        "code_verifier": flow.code_verifier,
        "created_at": now_iso(),
    })
    if redirect:
        return RedirectResponse(url)
    return {"auth_url": url, "state": state}


@router.get("/callback")
async def auth_callback(code: str, state: Optional[str] = None):
    # Verify state and retrieve the matching code_verifier (required for PKCE token exchange).
    code_verifier = None
    if state:
        valid = await v3_col("google_sheets_states").find_one({"state": state}, {"_id": 0})
        if not valid:
            return RedirectResponse(f"{FRONTEND_URL}/?sheets_connect=failed&reason=invalid_state")
        code_verifier = valid.get("code_verifier")
        await v3_col("google_sheets_states").delete_one({"state": state})

    try:
        flow = Flow.from_client_config(_client_config(), scopes=SCOPES, redirect_uri=REDIRECT_URI)
        if code_verifier:
            flow.code_verifier = code_verifier
        await asyncio.to_thread(flow.fetch_token, code=code)
    except Exception as e:
        return RedirectResponse(f"{FRONTEND_URL}/?sheets_connect=failed&reason={re.sub(r'[^a-zA-Z0-9_-]', '_', str(e)[:60])}")

    creds: Credentials = flow.credentials

    expires_iso = creds.expiry.replace(tzinfo=timezone.utc).isoformat() if creds.expiry else None
    await v3_col("google_sheets_tokens").update_one(
        {"id": TOKEN_DOC_ID},
        {"$set": {
            "id": TOKEN_DOC_ID,
            "access_token": creds.token,
            "refresh_token": creds.refresh_token,
            "expires_at": expires_iso,
            "scopes": list(creds.scopes or SCOPES),
            "connected_at": now_iso(),
        }},
        upsert=True,
    )
    return RedirectResponse(f"{FRONTEND_URL}/?sheets_connect=success")


@router.post("/disconnect")
async def disconnect(_: V3UserOut = Depends(v3_require_roles("super_admin"))):
    await v3_col("google_sheets_tokens").delete_one({"id": TOKEN_DOC_ID})
    return {"disconnected": True}


# ---------- Sheets list ----------
# Disabled: listing all spreadsheets requires Drive scope.
# We intentionally use only `spreadsheets.readonly` (no Drive, no email).
# Users paste the Google Sheet URL in the Add Source dialog; the spreadsheet
# ID is extracted from the URL and used directly to read rows.

@router.get("/spreadsheets")
async def list_spreadsheets(_: V3UserOut = Depends(v3_require_roles("super_admin"))):
    raise HTTPException(
        status_code=400,
        detail="Listing your sheets is disabled by design (no Drive access requested). Paste the Google Sheet URL in 'Add Source' instead.",
    )


# ---------- Pull (real Sheets API → existing dedupe/import logic) ----------

@router.post("/pull/{source_id}")
async def pull_source(source_id: str, range_: str = Query("A1:Z10000"), _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    source = await v3_col("marketing_sources").find_one({"id": source_id}, {"_id": 0})
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    if not source.get("spreadsheet_id"):
        raise HTTPException(status_code=400, detail="Source has no spreadsheet_id. Edit the source and paste the Google Sheet URL.")

    creds = await _get_creds()
    if not creds:
        raise HTTPException(status_code=400, detail="Not connected to Google. Click 'Continue with Google' first.")

    sheet_name = source.get("sheet_name") or "Sheet1"
    a1_range = f"'{sheet_name}'!{range_}"

    try:
        svc = await asyncio.to_thread(lambda: build("sheets", "v4", credentials=creds))
        resp = await asyncio.to_thread(lambda: svc.spreadsheets().values().get(spreadsheetId=source["spreadsheet_id"], range=a1_range).execute())
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Sheets API error: {str(e)[:200]}")

    values = resp.get("values", [])
    if not values:
        await v3_col("marketing_sources").update_one({"id": source_id}, {"$set": {"last_synced": now_iso()}})
        return {"imported": 0, "skipped": 0, "rows_received": 0, "message": "Sheet is empty"}

    headers = [str(h).strip() for h in values[0]]
    rows = []
    for r in values[1:]:
        # pad to headers length
        padded = list(r) + [""] * (len(headers) - len(r))
        rows.append({headers[i]: padded[i] for i in range(len(headers))})

    # Ensure mapping
    mapping = dict(source.get("column_mapping") or {})
    if not all(k in mapping for k in ("name", "phone")):
        inferred = auto_map_columns(headers)
        for k, v in inferred.items():
            mapping.setdefault(k, v)
    if "phone" not in mapping:
        mapping["phone"] = headers[0] if headers else "phone"

    phone_key = mapping["phone"]
    imported = 0
    skipped_no_phone = 0
    skipped_duplicate = 0
    sample_errors = []

    for idx, row in enumerate(rows):
        phone_raw = str(row.get(phone_key, "") or "").strip()
        phone_norm = normalize_phone(phone_raw)
        if not phone_norm:
            skipped_no_phone += 1
            if len(sample_errors) < 3:
                sample_errors.append(f"row {idx + 2}: missing phone in column '{phone_key}'")
            continue
        exists = await v3_col("leads").find_one({"phone_normalized": phone_norm}, {"_id": 0, "id": 1})
        if exists:
            skipped_duplicate += 1
            continue
        std_payload = {}
        for std in STANDARD_FIELDS:
            src_key = mapping.get(std)
            if src_key and src_key in row:
                std_payload[std] = row[src_key]
        custom_payload = {}
        mapped_values = set(mapping.values())
        for key, value in row.items():
            if key not in mapped_values and value not in (None, ""):
                custom_payload[key] = value

        assigned = await round_robin_assign("pre_sales")
        lead = {
            "id": str(uuid.uuid4()),
            "name": (std_payload.get("name") or "").strip() or "Unknown",
            "phone": phone_raw,
            "phone_normalized": phone_norm,
            "email": std_payload.get("email", ""),
            "vertical": std_payload.get("vertical") or "offline_physiotherapy",
            "source_tab": source["name"],
            "source_type": "google_sheets",
            "stage": "New Leads",
            "branch_id": None,
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
    update = {"last_synced": now_iso(), "row_count": new_row_count, "headers_detected": headers}
    if mapping != (source.get("column_mapping") or {}):
        update["column_mapping"] = mapping
    await v3_col("marketing_sources").update_one({"id": source_id}, {"$set": update})

    return {
        "imported": imported,
        "skipped": skipped_no_phone + skipped_duplicate,
        "skipped_no_phone": skipped_no_phone,
        "skipped_duplicate": skipped_duplicate,
        "rows_received": len(rows),
        "phone_column_used": phone_key,
        "mapping_used": mapping,
        "sample_errors": sample_errors,
    }
