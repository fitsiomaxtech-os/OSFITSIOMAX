import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from dotenv import load_dotenv


load_dotenv("/app/frontend/.env")
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")


def _iso_future(minutes: int = 90) -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).strftime("%Y-%m-%dT%H:%M")


@pytest.fixture(scope="session")
def api_client():
    # Shared API client module for v3 retest
    if not BASE_URL:
        pytest.skip("REACT_APP_BACKEND_URL is not configured")
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


def _login(api_client, email: str, password: str):
    # Auth module for role-token acquisition
    response = api_client.post(
        f"{BASE_URL}/api/v3/auth/login",
        json={"email": email, "password": password},
        timeout=25,
    )
    assert response.status_code == 200
    payload = response.json()
    assert isinstance(payload.get("token"), str) and payload["token"]
    return {"Authorization": f"Bearer {payload['token']}", "Content-Type": "application/json"}, payload["user"]


def _get_lead_by_id(api_client, headers, lead_id: str):
    # Lead fetch module to verify persistence after state transitions
    response = api_client.get(f"{BASE_URL}/api/v3/leads", headers=headers, timeout=25)
    assert response.status_code == 200
    rows = response.json()
    return next((row for row in rows if row["id"] == lead_id), None)


def test_default_branch_admin_has_non_null_branch_id(api_client):
    # Seed integrity module for default branch admin linkage
    _, user = _login(api_client, "branchadmin@fitsiomax.com", "branch123")
    assert user["role"] == "branch_admin"
    assert user.get("branch_id")


def test_confirm_endpoint_returns_scoped_error_for_out_of_branch_lead(api_client):
    # Confirm endpoint module for branch scope enforcement and non-silent failure
    admin_headers, _ = _login(api_client, "fitsiomaxtech@gmail.com", "FitsioMax06")
    presales_headers, _ = _login(api_client, "presales@fitsiomax.com", "presales123")

    suffix = uuid.uuid4().hex[:8]
    branch_a_resp = api_client.post(
        f"{BASE_URL}/api/v3/branches",
        json={
            "branch_name": f"TEST_SCOPE_A_{suffix}",
            "address": "Chennai",
            "admin_name": f"TEST_SCOPE_ADMIN_A_{suffix}",
            "admin_email": f"scope.a.{suffix}@fitsiomax.com",
            "admin_password": "branch321",
            "admin_phone": "9000000001",
            "vertical": "offline_physiotherapy",
        },
        headers=admin_headers,
        timeout=25,
    )
    assert branch_a_resp.status_code == 200
    branch_a = branch_a_resp.json()

    branch_b_resp = api_client.post(
        f"{BASE_URL}/api/v3/branches",
        json={
            "branch_name": f"TEST_SCOPE_B_{suffix}",
            "address": "Chennai",
            "admin_name": f"TEST_SCOPE_ADMIN_B_{suffix}",
            "admin_email": f"scope.b.{suffix}@fitsiomax.com",
            "admin_password": "branch321",
            "admin_phone": "9000000002",
            "vertical": "offline_physiotherapy",
        },
        headers=admin_headers,
        timeout=25,
    )
    assert branch_b_resp.status_code == 200
    branch_b = branch_b_resp.json()

    lead_resp = api_client.post(
        f"{BASE_URL}/api/v3/leads/manual",
        json={
            "name": f"TEST_SCOPE_LEAD_{suffix}",
            "phone": f"90{suffix}",
            "email": f"scope.lead.{suffix}@mail.com",
            "vertical": "offline_physiotherapy",
            "source_type": "manual",
        },
        headers=presales_headers,
        timeout=25,
    )
    assert lead_resp.status_code == 200
    lead_id = lead_resp.json()["id"]

    qualify_resp = api_client.post(
        f"{BASE_URL}/api/v3/leads/{lead_id}/qualify",
        headers=presales_headers,
        timeout=25,
    )
    assert qualify_resp.status_code == 200
    assert qualify_resp.json()["stage"] == "Pre-sales Qualified"

    assign_resp = api_client.post(
        f"{BASE_URL}/api/v3/leads/{lead_id}/assign-branch",
        json={"branch_id": branch_a["id"]},
        headers=presales_headers,
        timeout=25,
    )
    assert assign_resp.status_code == 200
    assert assign_resp.json()["stage"] == "Assigned to Branch"
    assert assign_resp.json()["branch_id"] == branch_a["id"]

    branch_b_headers, branch_b_user = _login(api_client, branch_b["admin_email"], "branch321")
    assert branch_b_user.get("branch_id") == branch_b["id"]

    out_of_scope_confirm = api_client.post(
        f"{BASE_URL}/api/v3/leads/{lead_id}/confirm",
        headers=branch_b_headers,
        timeout=25,
    )
    assert out_of_scope_confirm.status_code == 403
    detail = out_of_scope_confirm.json().get("detail", "")
    assert "scope" in detail.lower() or "branch" in detail.lower()

    persisted = _get_lead_by_id(api_client, admin_headers, lead_id)
    assert persisted is not None
    assert persisted["stage"] == "Assigned to Branch"
    assert persisted["branch_id"] == branch_a["id"]


def test_sheet_connection_callback_url_is_env_driven(api_client):
    # Sheet connection module for callback URL configuration behavior
    bd_headers, _ = _login(api_client, "businessdev@fitsiomax.com", "bd123")
    expected = os.environ.get("GOOGLE_SHEETS_CALLBACK_URL") or os.environ.get("GOOGLE_REDIRECT_URI") or ""

    suffix = uuid.uuid4().hex[:8]
    response = api_client.post(
        f"{BASE_URL}/api/v3/sheets/connections",
        json={
            "connection_name": f"TEST_CB_{suffix}",
            "spreadsheet_id": f"sheet_{suffix}",
            "sync_interval_minutes": 30,
        },
        headers=bd_headers,
        timeout=25,
    )
    assert response.status_code == 200
    row = response.json()
    assert "callback_url" in row
    assert row["callback_url"] == expected


def test_default_branch_admin_confirm_check_doctor_and_book_flow(api_client):
    # End-to-end branch-admin flow module using default branchadmin credentials
    admin_headers, _ = _login(api_client, "fitsiomaxtech@gmail.com", "FitsioMax06")
    presales_headers, _ = _login(api_client, "presales@fitsiomax.com", "presales123")
    branch_headers, branch_user = _login(api_client, "branchadmin@fitsiomax.com", "branch123")

    branch_id = branch_user.get("branch_id")
    assert branch_id

    suffix = uuid.uuid4().hex[:8]
    slot_time = _iso_future(110)

    doctor_resp = api_client.post(
        f"{BASE_URL}/api/v3/doctors",
        json={
            "full_name": f"TEST_DEFAULT_BRANCH_DOC_{suffix}",
            "profile_type": "physio",
            "branch_id": branch_id,
            "specialization": "General",
        },
        headers=admin_headers,
        timeout=25,
    )
    assert doctor_resp.status_code == 200
    doctor = doctor_resp.json()

    slot_resp = api_client.post(
        f"{BASE_URL}/api/v3/doctors/{doctor['id']}/slots",
        json={"slots": [slot_time]},
        headers=admin_headers,
        timeout=25,
    )
    assert slot_resp.status_code == 200
    assert slot_time in slot_resp.json()["slots"]

    lead_resp = api_client.post(
        f"{BASE_URL}/api/v3/leads/manual",
        json={
            "name": f"TEST_DEFAULT_BRANCH_LEAD_{suffix}",
            "phone": f"91{suffix}",
            "email": f"default.branch.{suffix}@mail.com",
            "vertical": "offline_physiotherapy",
            "source_type": "manual",
            "source_tab": "Manual",
        },
        headers=presales_headers,
        timeout=25,
    )
    assert lead_resp.status_code == 200
    lead_id = lead_resp.json()["id"]

    qualify_resp = api_client.post(
        f"{BASE_URL}/api/v3/leads/{lead_id}/qualify",
        headers=presales_headers,
        timeout=25,
    )
    assert qualify_resp.status_code == 200

    assign_resp = api_client.post(
        f"{BASE_URL}/api/v3/leads/{lead_id}/assign-branch",
        json={"branch_id": branch_id},
        headers=presales_headers,
        timeout=25,
    )
    assert assign_resp.status_code == 200
    assert assign_resp.json()["stage"] == "Assigned to Branch"

    confirm_resp = api_client.post(
        f"{BASE_URL}/api/v3/leads/{lead_id}/confirm",
        headers=branch_headers,
        timeout=25,
    )
    assert confirm_resp.status_code == 200
    assert confirm_resp.json()["stage"] == "Branch Confirmed"

    available_resp = api_client.get(
        f"{BASE_URL}/api/v3/doctors/available",
        params={"branch_id": branch_id, "slot_time": slot_time},
        headers=branch_headers,
        timeout=25,
    )
    assert available_resp.status_code == 200
    available = available_resp.json().get("available_doctors", [])
    assert any(item["id"] == doctor["id"] for item in available)

    book_resp = api_client.post(
        f"{BASE_URL}/api/v3/leads/{lead_id}/book-appointment",
        json={"doctor_id": doctor["id"], "slot_time": slot_time},
        headers=branch_headers,
        timeout=25,
    )
    assert book_resp.status_code == 200
    appointment = book_resp.json()
    assert appointment["status"] == "new_appointment"
    assert appointment["doctor_id"] == doctor["id"]

    lead_after = _get_lead_by_id(api_client, branch_headers, lead_id)
    assert lead_after is not None
    assert lead_after["stage"] == "Appointment Booked"


def test_head_physio_and_physio_operational_endpoints_load(api_client):
    # Head-physio/physio board backing endpoint module for load verification
    _, head_user = _login(api_client, "headphysio@fitsiomax.com", "head123")
    _, physio_user = _login(api_client, "physio@fitsiomax.com", "physio123")
    head_headers, _ = _login(api_client, "headphysio@fitsiomax.com", "head123")
    physio_headers, _ = _login(api_client, "physio@fitsiomax.com", "physio123")

    assert head_user.get("branch_id")
    assert physio_user.get("branch_id")

    head_appt = api_client.get(f"{BASE_URL}/api/v3/appointments", params={"view": "today"}, headers=head_headers, timeout=25)
    assert head_appt.status_code == 200
    assert isinstance(head_appt.json(), list)

    physio_appt = api_client.get(f"{BASE_URL}/api/v3/appointments", params={"view": "new"}, headers=physio_headers, timeout=25)
    assert physio_appt.status_code == 200
    assert isinstance(physio_appt.json(), list)


def test_source_tab_filter_returns_live_backend_leads(api_client):
    # Lead source preview backing module ensuring source_tab-driven backend retrieval
    presales_headers, _ = _login(api_client, "presales@fitsiomax.com", "presales123")

    suffix = uuid.uuid4().hex[:8]
    source_tab = f"IG_TEST_{suffix}"
    lead_resp = api_client.post(
        f"{BASE_URL}/api/v3/leads/manual",
        json={
            "name": f"TEST_SOURCE_{suffix}",
            "phone": f"92{suffix}",
            "email": f"source.{suffix}@mail.com",
            "vertical": "offline_physiotherapy",
            "source_type": "manual",
            "source_tab": source_tab,
        },
        headers=presales_headers,
        timeout=25,
    )
    assert lead_resp.status_code == 200
    created = lead_resp.json()
    assert created["source_tab"] == source_tab

    list_resp = api_client.get(
        f"{BASE_URL}/api/v3/leads",
        params={"source_tab": source_tab},
        headers=presales_headers,
        timeout=25,
    )
    assert list_resp.status_code == 200
    rows = list_resp.json()
    match = next((row for row in rows if row["id"] == created["id"]), None)
    assert match is not None
    assert match["source_tab"] == source_tab