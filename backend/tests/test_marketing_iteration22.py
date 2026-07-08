"""Iteration 22: Marketing Module backend tests."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://lead-manager-100.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api/v3"

CREDS = {
    "super_admin": ("fitsiomaxtech@gmail.com", "FitsioMax06"),
    "pre_sales":   ("presales@fitsiomax.com", "presales123"),
    "branch_admin":("branchadmin@fitsiomax.com", "branch123"),
    "head_physio": ("headphysio@fitsiomax.com", "head123"),
    "physio":      ("physio@fitsiomax.com", "physio123"),
    "business_dev":("businessdev@fitsiomax.com", "bd123"),
}


def login(role):
    email, pwd = CREDS[role]
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pwd}, timeout=20)
    assert r.status_code == 200, f"login {role} -> {r.status_code} {r.text}"
    return r.json()["token"]


def H(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def admin_token():
    return login("super_admin")


# ---------------- Dashboard ----------------
def test_dashboard_super_admin(admin_token):
    r = requests.get(f"{API}/marketing/dashboard", headers=H(admin_token), timeout=20)
    assert r.status_code == 200
    j = r.json()
    assert "kpis" in j and "by_source" in j and "recent_leads" in j
    for k in ("pre_sales_leads", "sales_leads", "active_sources", "conversion_rate"):
        assert k in j["kpis"]


def test_dashboard_forbidden_for_other_roles():
    for role in ["pre_sales", "branch_admin", "head_physio", "physio"]:
        tok = login(role)
        r = requests.get(f"{API}/marketing/dashboard", headers=H(tok), timeout=20)
        assert r.status_code == 403, f"{role} should be 403, got {r.status_code}"


# ---------------- Distribution Settings ----------------
def test_distribution_settings_flow(admin_token):
    r = requests.get(f"{API}/marketing/distribution-settings", headers=H(admin_token), timeout=20)
    assert r.status_code == 200
    s = r.json()
    assert s["id"] == "_singleton_"

    r2 = requests.patch(f"{API}/marketing/distribution-settings",
                        json={"enabled": True, "distribution_type": "round_robin"},
                        headers=H(admin_token), timeout=20)
    assert r2.status_code == 200
    assert r2.json()["enabled"] is True
    assert r2.json()["distribution_type"] == "round_robin"

    r3 = requests.post(f"{API}/marketing/distribution-settings/refresh", headers=H(admin_token), timeout=20)
    assert r3.status_code == 200
    s3 = r3.json()
    assert isinstance(s3["pre_sales_team"], list)
    assert isinstance(s3["sales_team"], list)


# ---------------- Team Members ----------------
def test_team_members_get_and_create(admin_token):
    r = requests.get(f"{API}/marketing/team-members", headers=H(admin_token), timeout=20)
    assert r.status_code == 200
    j = r.json()
    assert "pre_sales" in j and "sales" in j
    if j["pre_sales"]:
        m = j["pre_sales"][0]
        for k in ("current_leads", "deals_closed", "conversion_rate"):
            assert k in m

    suffix = uuid.uuid4().hex[:6]
    payload = {
        "full_name": f"TEST_PreSales_{suffix}",
        "email": f"TEST_presales_{suffix}@example.com",
        "password": "Pass123!",
        "team_type": "pre_sales",
    }
    r2 = requests.post(f"{API}/marketing/team-members", json=payload, headers=H(admin_token), timeout=20)
    assert r2.status_code == 200, r2.text
    assert r2.json()["role"] == "pre_sales"
    # dedupe
    r3 = requests.post(f"{API}/marketing/team-members", json=payload, headers=H(admin_token), timeout=20)
    assert r3.status_code == 409


# ---------------- Sources CRUD ----------------
@pytest.fixture(scope="module")
def created_source(admin_token):
    payload = {
        "name": f"TEST_Meta_{uuid.uuid4().hex[:6]}",
        "sheet_url": "https://docs.google.com/spreadsheets/d/abc123XYZ/edit",
        "source_type": "meta",
        "headers": ["Lead Name", "Mobile", "Email", "Service", "City", "Remarks", "Campaign"],
    }
    r = requests.post(f"{API}/marketing/sources", json=payload, headers=H(admin_token), timeout=20)
    assert r.status_code == 200, r.text
    src = r.json()
    assert src["spreadsheet_id"] == "abc123XYZ"
    cm = src["column_mapping"]
    assert cm.get("name") == "Lead Name"
    assert cm.get("phone") == "Mobile"
    assert cm.get("email") == "Email"
    assert "Campaign" in src.get("custom_fields", [])
    yield src
    requests.delete(f"{API}/marketing/sources/{src['id']}", headers=H(admin_token), timeout=20)


def test_sources_list(admin_token, created_source):
    r = requests.get(f"{API}/marketing/sources", headers=H(admin_token), timeout=20)
    assert r.status_code == 200
    ids = [s["id"] for s in r.json()]
    assert created_source["id"] in ids


def test_source_update(admin_token, created_source):
    r = requests.patch(f"{API}/marketing/sources/{created_source['id']}",
                       json={"is_active": False}, headers=H(admin_token), timeout=20)
    assert r.status_code == 200
    assert r.json()["is_active"] is False
    # revert
    requests.patch(f"{API}/marketing/sources/{created_source['id']}",
                   json={"is_active": True}, headers=H(admin_token), timeout=20)


# ---------------- Sync + Dedupe + Round-Robin ----------------
def test_sync_dedupe_and_round_robin(admin_token, created_source):
    # ensure enabled + round_robin + refresh team
    requests.patch(f"{API}/marketing/distribution-settings",
                   json={"enabled": True, "distribution_type": "round_robin"},
                   headers=H(admin_token), timeout=20)
    settings = requests.post(f"{API}/marketing/distribution-settings/refresh",
                             headers=H(admin_token), timeout=20).json()
    pre_team = settings.get("pre_sales_team", [])

    sid = created_source["id"]
    phones = [f"90000{uuid.uuid4().hex[:5]}"[:10] for _ in range(3)]
    # Ensure 10-digit unique
    phones = [(p + "0000000000")[:10] for p in phones]
    rows = [{"Lead Name": f"TEST_L{i}", "Mobile": phones[i], "Email": f"l{i}@x.com",
             "Service": "offline_physiotherapy", "City": "Mumbai", "Remarks": "test",
             "Campaign": "Spring2026"} for i in range(3)]
    r = requests.post(f"{API}/marketing/sources/{sid}/sync", json={"rows": rows},
                      headers=H(admin_token), timeout=30)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["imported"] == 3, j

    # Dedupe — second sync with same phones
    r2 = requests.post(f"{API}/marketing/sources/{sid}/sync", json={"rows": rows},
                      headers=H(admin_token), timeout=30)
    assert r2.status_code == 200
    assert r2.json()["imported"] == 0
    assert r2.json()["skipped"] == 3

    # Round-robin check: query all-leads filtered by marketing_source_id via search
    r3 = requests.get(f"{API}/marketing/all-leads", params={"source": created_source["name"], "page_size": 200},
                      headers=H(admin_token), timeout=20)
    assert r3.status_code == 200
    inserted = [l for l in r3.json()["rows"] if l.get("marketing_source_id") == sid]
    assigned_ids = [l.get("assigned_user_id") for l in inserted[:3]]
    if pre_team and len(pre_team) >= 2:
        # at least two unique assignees among first 3 if team size >= 2
        assert len(set(assigned_ids)) >= min(2, len(pre_team)), f"Round-robin failed, assignments={assigned_ids}, team={pre_team}"

    # Cleanup leads
    ids = [l["id"] for l in inserted]
    if ids:
        requests.post(f"{API}/marketing/leads/bulk-delete", json={"lead_ids": ids},
                      headers=H(admin_token), timeout=20)


# ---------------- All Leads filter ----------------
def test_all_leads_filters(admin_token):
    r = requests.get(f"{API}/marketing/all-leads", params={"stage_type": "all", "page_size": 10},
                     headers=H(admin_token), timeout=20)
    assert r.status_code == 200
    j = r.json()
    for k in ("total", "page", "page_size", "rows"):
        assert k in j


# ---------------- Performance ----------------
def test_performance(admin_token):
    r = requests.get(f"{API}/marketing/performance", headers=H(admin_token), timeout=20)
    assert r.status_code == 200
    j = r.json()
    assert "funnel" in j and len(j["funnel"]) == 6
    assert "leads_per_pre_sales" in j and "deals_per_sales" in j


# ---------------- Regression: existing endpoints still work ----------------
def test_regression_master_board(admin_token):
    r = requests.get(f"{API}/boards/master", headers=H(admin_token), timeout=20)
    assert r.status_code == 200


def test_regression_all_roles_login():
    for role in CREDS:
        tok = login(role)
        assert tok
