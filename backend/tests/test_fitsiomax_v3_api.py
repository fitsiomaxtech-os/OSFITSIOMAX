import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from dotenv import load_dotenv


load_dotenv("/app/frontend/.env")
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")


def _iso_future(minutes: int) -> str:
    # Match UI datetime-local style (YYYY-MM-DDTHH:MM) used by v3 slot normalization
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).strftime("%Y-%m-%dT%H:%M")


@pytest.fixture(scope="session")
def api_client():
    if not BASE_URL:
        pytest.skip("REACT_APP_BACKEND_URL is not configured")
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


def _login(api_client, email, password):
    response = api_client.post(
        f"{BASE_URL}/api/v3/auth/login",
        json={"email": email, "password": password},
        timeout=25,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["token"]
    return {"Authorization": f"Bearer {data['token']}", "Content-Type": "application/json"}, data["user"]


@pytest.fixture(scope="session")
def auth_headers(api_client):
    # Auth module: validate all six requested role logins
    creds = {
        "super_admin": ("fitsiomaxtech@gmail.com", "FitsioMax06"),
        "business_dev": ("businessdev@fitsiomax.com", "bd123"),
        "pre_sales": ("presales@fitsiomax.com", "presales123"),
        "branch_admin": ("branchadmin@fitsiomax.com", "branch123"),
        "head_physio": ("headphysio@fitsiomax.com", "head123"),
        "physio": ("physio@fitsiomax.com", "physio123"),
    }
    auth = {}
    for role, (email, password) in creds.items():
        headers, user = _login(api_client, email, password)
        assert user["role"] == role
        auth[role] = {"headers": headers, "user": user}
    return auth


@pytest.fixture(scope="session")
def v3_state(api_client, auth_headers):
    # Core pipeline module: branch/doctor/lead/appointment shared setup for stage progression checks
    suffix = uuid.uuid4().hex[:8]
    admin_headers = auth_headers["super_admin"]["headers"]
    pre_sales_headers = auth_headers["pre_sales"]["headers"]
    bd_headers = auth_headers["business_dev"]["headers"]

    branch_payload = {
        "branch_name": f"TEST_Branch_{suffix}",
        "address": "Chennai",
        "admin_name": f"TEST Branch Admin {suffix}",
        "admin_email": f"test.branchadmin.{suffix}@fitsiomax.com",
        "admin_password": "branch321",
        "admin_phone": "9000011111",
        "vertical": "offline_physiotherapy",
    }
    branch_resp = api_client.post(
        f"{BASE_URL}/api/v3/branches",
        json=branch_payload,
        headers=admin_headers,
        timeout=25,
    )
    assert branch_resp.status_code == 200
    branch = branch_resp.json()
    assert branch["branch_name"] == branch_payload["branch_name"]

    branch_login_headers, branch_user = _login(api_client, branch_payload["admin_email"], branch_payload["admin_password"])
    assert branch_user["branch_id"] == branch["id"]

    doctor_resp = api_client.post(
        f"{BASE_URL}/api/v3/doctors",
        json={
            "full_name": f"TEST Doctor {suffix}",
            "profile_type": "physio",
            "branch_id": branch["id"],
            "specialization": "Ortho",
        },
        headers=admin_headers,
        timeout=25,
    )
    assert doctor_resp.status_code == 200
    doctor = doctor_resp.json()

    slot_time = _iso_future(90)
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
            "name": f"TEST Lead {suffix}",
            "phone": f"91{suffix}",
            "email": f"test.lead.{suffix}@mail.com",
            "vertical": "offline_physiotherapy",
            "source_tab": "ManualTab",
            "source_type": "manual",
            "notes": "pipeline test",
        },
        headers=pre_sales_headers,
        timeout=25,
    )
    assert lead_resp.status_code == 200
    lead = lead_resp.json()
    assert lead["stage"] == "New Lead"

    qualify_resp = api_client.post(
        f"{BASE_URL}/api/v3/leads/{lead['id']}/qualify",
        headers=pre_sales_headers,
        timeout=25,
    )
    assert qualify_resp.status_code == 200
    assert qualify_resp.json()["stage"] == "Pre-sales Qualified"

    assign_resp = api_client.post(
        f"{BASE_URL}/api/v3/leads/{lead['id']}/assign-branch",
        json={"branch_id": branch["id"]},
        headers=pre_sales_headers,
        timeout=25,
    )
    assert assign_resp.status_code == 200
    assert assign_resp.json()["stage"] == "Assigned to Branch"

    # Sheets module: connection + mapping + multi-tab sync with source_tab stamping
    connection_resp = api_client.post(
        f"{BASE_URL}/api/v3/sheets/connections",
        json={
            "connection_name": f"TEST_Conn_{suffix}",
            "spreadsheet_id": f"sheet_{suffix}",
            "sync_interval_minutes": 15,
        },
        headers=bd_headers,
        timeout=25,
    )
    assert connection_resp.status_code == 200
    connection = connection_resp.json()

    mapping_resp = api_client.post(
        f"{BASE_URL}/api/v3/sheets/connections/{connection['id']}/mapping",
        json={
            "field_map": {"name": "name", "phone": "phone", "email": "email", "vertical": "vertical"},
            "create_new_fields": True,
        },
        headers=bd_headers,
        timeout=25,
    )
    assert mapping_resp.status_code == 200

    sheet_phone_1 = f"93{suffix}1"
    sheet_phone_2 = f"93{suffix}2"
    sync_resp = api_client.post(
        f"{BASE_URL}/api/v3/sheets/connections/{connection['id']}/sync",
        json={
            "tabs": [
                {
                    "tab_name": "Instagram",
                    "rows": [
                        {
                            "name": f"TEST Insta {suffix}",
                            "phone": sheet_phone_1,
                            "email": f"insta.{suffix}@mail.com",
                            "vertical": "offline_physiotherapy",
                        }
                    ],
                },
                {
                    "tab_name": "Walkins",
                    "rows": [
                        {
                            "name": f"TEST Walkin {suffix}",
                            "phone": sheet_phone_2,
                            "email": f"walkin.{suffix}@mail.com",
                            "vertical": "offline_physiotherapy",
                        }
                    ],
                },
            ]
        },
        headers=bd_headers,
        timeout=25,
    )
    assert sync_resp.status_code == 200

    return {
        "suffix": suffix,
        "branch": branch,
        "branch_login": {"headers": branch_login_headers, "user": branch_user},
        "doctor": doctor,
        "slot_time": slot_time,
        "lead": lead,
        "sheet_connection": connection,
        "sheet_phones": [sheet_phone_1, sheet_phone_2],
    }


def test_v3_login_all_6_roles(auth_headers):
    # Auth module: explicit assertion of six role sessions
    assert set(auth_headers.keys()) == {
        "super_admin",
        "business_dev",
        "pre_sales",
        "branch_admin",
        "head_physio",
        "physio",
    }


def test_business_dev_can_manage_sheet_connection(auth_headers, api_client, v3_state):
    # Sheets module: business dev can list created connection and save mapping already persisted
    resp = api_client.get(
        f"{BASE_URL}/api/v3/sheets/connections",
        headers=auth_headers["business_dev"]["headers"],
        timeout=25,
    )
    assert resp.status_code == 200
    rows = resp.json()
    assert any(row["id"] == v3_state["sheet_connection"]["id"] for row in rows)


def test_sync_multitab_import_sets_source_tab(auth_headers, api_client, v3_state):
    # Sheets import module: verify leads from multiple tabs and source_tab values
    headers = auth_headers["business_dev"]["headers"]

    insta_resp = api_client.get(
        f"{BASE_URL}/api/v3/leads",
        params={"source_tab": "Instagram"},
        headers=headers,
        timeout=25,
    )
    assert insta_resp.status_code == 200
    insta_rows = insta_resp.json()
    assert any(row["phone"] == v3_state["sheet_phones"][0] for row in insta_rows)

    walkin_resp = api_client.get(
        f"{BASE_URL}/api/v3/leads",
        params={"source_tab": "Walkins"},
        headers=headers,
        timeout=25,
    )
    assert walkin_resp.status_code == 200
    walkin_rows = walkin_resp.json()
    assert any(row["phone"] == v3_state["sheet_phones"][1] for row in walkin_rows)


def test_manual_lead_creation_works_for_presales(auth_headers, api_client):
    # Lead module: pre-sales can create manual lead with expected defaults
    suffix = uuid.uuid4().hex[:6]
    resp = api_client.post(
        f"{BASE_URL}/api/v3/leads/manual",
        json={
            "name": f"TEST Manual {suffix}",
            "phone": f"95{suffix}",
            "email": f"manual.{suffix}@mail.com",
            "vertical": "offline_physiotherapy",
            "source_type": "manual",
            "notes": "manual lead flow",
        },
        headers=auth_headers["pre_sales"]["headers"],
        timeout=25,
    )
    assert resp.status_code == 200
    row = resp.json()
    assert row["stage"] == "New Lead"
    assert row["source_type"] == "manual"


def test_presales_qualify_and_assign_branch(auth_headers, api_client, v3_state):
    # Pre-sales module: stage progression to assigned branch
    suffix = uuid.uuid4().hex[:6]
    pre_headers = auth_headers["pre_sales"]["headers"]

    lead_resp = api_client.post(
        f"{BASE_URL}/api/v3/leads/manual",
        json={
            "name": f"TEST Qualify {suffix}",
            "phone": f"94{suffix}",
            "vertical": "offline_physiotherapy",
            "source_type": "manual",
        },
        headers=pre_headers,
        timeout=25,
    )
    assert lead_resp.status_code == 200
    lead_id = lead_resp.json()["id"]

    qualify_resp = api_client.post(
        f"{BASE_URL}/api/v3/leads/{lead_id}/qualify",
        headers=pre_headers,
        timeout=25,
    )
    assert qualify_resp.status_code == 200
    assert qualify_resp.json()["stage"] == "Pre-sales Qualified"

    assign_resp = api_client.post(
        f"{BASE_URL}/api/v3/leads/{lead_id}/assign-branch",
        json={"branch_id": v3_state["branch"]["id"]},
        headers=pre_headers,
        timeout=25,
    )
    assert assign_resp.status_code == 200
    assigned = assign_resp.json()
    assert assigned["stage"] == "Assigned to Branch"
    assert assigned["branch_id"] == v3_state["branch"]["id"]


def test_branch_admin_confirm_booking_available_doctors_and_stage_update(api_client, v3_state):
    # Branch module: confirm lead, check availability, book appointment and verify stage updated
    branch_headers = v3_state["branch_login"]["headers"]
    lead_id = v3_state["lead"]["id"]
    branch_id = v3_state["branch"]["id"]
    slot_time = v3_state["slot_time"]
    doctor_id = v3_state["doctor"]["id"]

    available_resp = api_client.get(
        f"{BASE_URL}/api/v3/doctors/available",
        params={"branch_id": branch_id, "slot_time": slot_time},
        headers=branch_headers,
        timeout=25,
    )
    assert available_resp.status_code == 200
    available = available_resp.json()["available_doctors"]
    assert any(doc["id"] == doctor_id for doc in available)

    confirm_resp = api_client.post(
        f"{BASE_URL}/api/v3/leads/{lead_id}/confirm",
        headers=branch_headers,
        timeout=25,
    )
    assert confirm_resp.status_code == 200
    assert confirm_resp.json()["stage"] == "Branch Confirmed"

    book_resp = api_client.post(
        f"{BASE_URL}/api/v3/leads/{lead_id}/book-appointment",
        json={"doctor_id": doctor_id, "slot_time": slot_time},
        headers=branch_headers,
        timeout=25,
    )
    assert book_resp.status_code == 200
    booked = book_resp.json()
    assert booked["status"] == "new_appointment"
    assert booked["doctor_id"] == doctor_id

    lead_resp = api_client.get(
        f"{BASE_URL}/api/v3/leads",
        params={"branch_id": branch_id, "stage": "Appointment Booked"},
        headers=branch_headers,
        timeout=25,
    )
    assert lead_resp.status_code == 200
    assert any(row["id"] == lead_id for row in lead_resp.json())

    available_after_resp = api_client.get(
        f"{BASE_URL}/api/v3/doctors/available",
        params={"branch_id": branch_id, "slot_time": slot_time},
        headers=branch_headers,
        timeout=25,
    )
    assert available_after_resp.status_code == 200
    available_after = available_after_resp.json()["available_doctors"]
    assert all(doc["id"] != doctor_id for doc in available_after)


def test_head_physio_today_new_views_show_branch_appointments(auth_headers, api_client, v3_state):
    # Appointments module: head physio should see today's/new appointments for operational flow
    head_headers = auth_headers["head_physio"]["headers"]
    resp_today = api_client.get(
        f"{BASE_URL}/api/v3/appointments",
        params={"view": "today"},
        headers=head_headers,
        timeout=25,
    )
    assert resp_today.status_code == 200
    rows_today = resp_today.json()
    assert any(row["id"] for row in rows_today)

    resp_new = api_client.get(
        f"{BASE_URL}/api/v3/appointments",
        params={"view": "new"},
        headers=head_headers,
        timeout=25,
    )
    assert resp_new.status_code == 200
    rows_new = resp_new.json()
    assert len(rows_new) > 0


def test_complete_appointment_updates_appointment_and_lead_status(auth_headers, api_client, v3_state):
    # Completion module: complete action must update appointment and lead stage
    admin_headers = auth_headers["super_admin"]["headers"]
    list_resp = api_client.get(
        f"{BASE_URL}/api/v3/appointments",
        params={"view": "new"},
        headers=admin_headers,
        timeout=25,
    )
    assert list_resp.status_code == 200
    rows = list_resp.json()
    target = next((row for row in rows if row["lead_id"] == v3_state["lead"]["id"]), None)
    assert target is not None

    complete_resp = api_client.post(
        f"{BASE_URL}/api/v3/appointments/{target['id']}/complete",
        headers=auth_headers["head_physio"]["headers"],
        timeout=25,
    )
    assert complete_resp.status_code == 200
    completed = complete_resp.json()
    assert completed["status"] == "completed"

    lead_resp = api_client.get(
        f"{BASE_URL}/api/v3/leads",
        params={"stage": "Completed", "branch_id": v3_state["branch"]["id"]},
        headers=admin_headers,
        timeout=25,
    )
    assert lead_resp.status_code == 200
    assert any(row["id"] == v3_state["lead"]["id"] for row in lead_resp.json())


def test_branch_creation_with_admin_credentials_works(v3_state):
    # Branch module: verify newly created branch admin can authenticate
    assert v3_state["branch_login"]["user"]["role"] == "branch_admin"
    assert v3_state["branch_login"]["user"]["branch_id"] == v3_state["branch"]["id"]


def test_master_and_branch_board_counters_load(auth_headers, api_client, v3_state):
    # Dashboard boards module: stage counters should be present and numeric
    admin_headers = auth_headers["super_admin"]["headers"]
    master_resp = api_client.get(
        f"{BASE_URL}/api/v3/boards/master",
        headers=admin_headers,
        timeout=25,
    )
    assert master_resp.status_code == 200
    master = master_resp.json()
    assert "stage_counts" in master
    assert isinstance(master["stage_counts"].get("New Lead", 0), int)

    branch_resp = api_client.get(
        f"{BASE_URL}/api/v3/boards/branch/{v3_state['branch']['id']}",
        headers=admin_headers,
        timeout=25,
    )
    assert branch_resp.status_code == 200
    branch_board = branch_resp.json()
    assert "stage_counts" in branch_board
    assert isinstance(branch_board["stage_counts"].get("Completed", 0), int)
