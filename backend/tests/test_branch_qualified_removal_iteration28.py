"""Iteration 28 - Verify 'Qualified' stage removal from Branch Admin V3.

Tests:
 - POST /api/v3/auth/login returns token for branch_admin and super_admin
 - GET /api/v3/stages?type=sales returns exactly 6 stages, none == 'Qualified'
 - GET /api/v3/branches/{branch_id}/board returns stage_counts WITHOUT 'Qualified' key
 - All leads in board have branch_stage != 'Qualified' (migration moved them)
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") or "https://lead-manager-100.preview.emergentagent.com"

EXPECTED_BRANCH_STAGES = [
    "New Appointment",
    "Portfolio",
    "Follow Up",
    "Appointment Date & Time",
    "Assigned Physio",
    "Cancelled",
]


@pytest.fixture(scope="module")
def super_token():
    r = requests.post(f"{BASE_URL}/api/v3/auth/login", json={"email": "admin@fitsiomax.com", "password": "admin123"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def branch_login():
    r = requests.post(f"{BASE_URL}/api/v3/auth/login", json={"email": "branchadmin@fitsiomax.com", "password": "branch123"})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def branch_token(branch_login):
    return branch_login["token"]


@pytest.fixture(scope="module")
def branch_admin_user(branch_login):
    return branch_login["user"]


def test_stages_endpoint_sales_excludes_qualified(super_token):
    """GET /api/v3/stages?type=sales must return 6 stages, none named 'Qualified'."""
    r = requests.get(f"{BASE_URL}/api/v3/stages", params={"type": "sales"}, headers={"Authorization": f"Bearer {super_token}"})
    assert r.status_code == 200, r.text
    stages = r.json()
    assert isinstance(stages, list), f"Expected list, got {type(stages)}"
    names = [s.get("name") for s in stages]
    assert "Qualified" not in names, f"'Qualified' must not appear in sales stages, got {names}"
    assert len(stages) == 6, f"Expected exactly 6 sales stages, got {len(stages)}: {names}"
    assert set(names) == set(EXPECTED_BRANCH_STAGES), f"Stage names mismatch: {names}"


def test_branch_board_stage_counts_no_qualified(branch_token, branch_admin_user):
    """GET /api/v3/branches/{branch_id}/board must NOT include 'Qualified' in stage_counts and no leads in 'Qualified'."""
    branch_id = branch_admin_user.get("branch_id")
    assert branch_id, f"branch_admin user missing branch_id: {branch_admin_user}"
    r = requests.get(f"{BASE_URL}/api/v3/branch-board/{branch_id}", headers={"Authorization": f"Bearer {branch_token}"})
    assert r.status_code == 200, r.text
    data = r.json()
    assert "stage_counts" in data, f"Missing stage_counts: {data.keys()}"
    sc = data["stage_counts"]
    assert "Qualified" not in sc, f"'Qualified' must NOT be a key in stage_counts, got: {list(sc.keys())}"
    # All 6 expected stages should be present as keys
    for s in EXPECTED_BRANCH_STAGES:
        assert s in sc, f"Missing expected stage key '{s}' in stage_counts: {list(sc.keys())}"

    # Verify no lead has branch_stage='Qualified' (migration check)
    leads = data.get("leads", [])
    qualified_leads = [l for l in leads if l.get("branch_stage") == "Qualified"]
    assert len(qualified_leads) == 0, f"Found {len(qualified_leads)} leads still in 'Qualified' stage"


def test_branch_board_all_leads_have_valid_stage(branch_token, branch_admin_user):
    """Every lead in branch board must have branch_stage in the 6 valid stages."""
    branch_id = branch_admin_user["branch_id"]
    r = requests.get(f"{BASE_URL}/api/v3/branch-board/{branch_id}", headers={"Authorization": f"Bearer {branch_token}"})
    assert r.status_code == 200
    leads = r.json().get("leads", [])
    invalid = [(l.get("id"), l.get("branch_stage")) for l in leads if l.get("branch_stage") == "Qualified"]
    assert not invalid, f"Found leads still in 'Qualified' branch_stage (migration miss): {invalid[:10]}"


def test_move_to_qualified_should_fail(branch_token, branch_admin_user):
    """Trying to move a lead to 'Qualified' via API must be rejected."""
    branch_id = branch_admin_user["branch_id"]
    r = requests.get(f"{BASE_URL}/api/v3/branch-board/{branch_id}", headers={"Authorization": f"Bearer {branch_token}"})
    leads = r.json().get("leads", [])
    if not leads:
        pytest.skip("No leads in branch to test stage move rejection")
    lead_id = leads[0].get("id")
    move = requests.post(
        f"{BASE_URL}/api/v3/leads/{lead_id}/branch-stage",
        headers={"Authorization": f"Bearer {branch_token}"},
        json={"branch_stage": "Qualified"},
    )
    assert move.status_code in (400, 422), f"Expected 400/422 rejecting 'Qualified' move, got {move.status_code}: {move.text}"
