import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from dotenv import load_dotenv


load_dotenv("/app/frontend/.env")
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")


def _iso_future(minutes: int = 60) -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).replace(microsecond=0).isoformat()


@pytest.fixture(scope="session")
def api_client():
    if not BASE_URL:
        pytest.skip("REACT_APP_BACKEND_URL is not configured")
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


def _login(api_client, email: str, password: str):
    resp = api_client.post(
        f"{BASE_URL}/api/v3/auth/login",
        json={"email": email, "password": password},
        timeout=25,
    )
    assert resp.status_code == 200
    data = resp.json()
    return {"Authorization": f"Bearer {data['token']}", "Content-Type": "application/json"}, data["user"]


@pytest.fixture(scope="session")
def role_headers(api_client):
    # Auth module: login for role visibility + completion checks
    creds = {
        "admin": ("fitsiomaxtech@gmail.com", "FitsioMax06"),
        "pre_sales": ("presales@fitsiomax.com", "presales123"),
        "head_physio": ("headphysio@fitsiomax.com", "head123"),
        "physio": ("physio@fitsiomax.com", "physio123"),
    }
    result = {}
    for key, (email, password) in creds.items():
        headers, user = _login(api_client, email, password)
        result[key] = {"headers": headers, "user": user}
    return result


@pytest.fixture(scope="session")
def seeded_appointment(api_client, role_headers):
    # Pipeline module: create branch+doctor+lead and book one new appointment for visibility checks
    suffix = uuid.uuid4().hex[:8]
    admin_headers = role_headers["admin"]["headers"]
    pre_sales_headers = role_headers["pre_sales"]["headers"]

    branch_resp = api_client.post(
        f"{BASE_URL}/api/v3/branches",
        json={
            "branch_name": f"TEST_VIS_{suffix}",
            "address": "Chennai",
            "admin_name": f"TEST_VIS_ADMIN_{suffix}",
            "admin_email": f"test.vis.admin.{suffix}@fitsiomax.com",
            "admin_password": "branch321",
            "admin_phone": "9888877777",
            "vertical": "offline_physiotherapy",
        },
        headers=admin_headers,
        timeout=25,
    )
    assert branch_resp.status_code == 200
    branch = branch_resp.json()

    doctor_resp = api_client.post(
        f"{BASE_URL}/api/v3/doctors",
        json={
            "full_name": f"TEST_VIS_DOCTOR_{suffix}",
            "profile_type": "physio",
            "branch_id": branch["id"],
            "specialization": "General",
        },
        headers=admin_headers,
        timeout=25,
    )
    assert doctor_resp.status_code == 200
    doctor = doctor_resp.json()

    slot_time = _iso_future(120)
    slot_resp = api_client.post(
        f"{BASE_URL}/api/v3/doctors/{doctor['id']}/slots",
        json={"slots": [slot_time]},
        headers=admin_headers,
        timeout=25,
    )
    assert slot_resp.status_code == 200

    lead_resp = api_client.post(
        f"{BASE_URL}/api/v3/leads/manual",
        json={
            "name": f"TEST_VIS_LEAD_{suffix}",
            "phone": f"97{suffix}",
            "email": f"test.vis.lead.{suffix}@mail.com",
            "vertical": "offline_physiotherapy",
            "source_type": "manual",
        },
        headers=pre_sales_headers,
        timeout=25,
    )
    assert lead_resp.status_code == 200
    lead = lead_resp.json()

    qualify_resp = api_client.post(
        f"{BASE_URL}/api/v3/leads/{lead['id']}/qualify",
        headers=pre_sales_headers,
        timeout=25,
    )
    assert qualify_resp.status_code == 200

    assign_resp = api_client.post(
        f"{BASE_URL}/api/v3/leads/{lead['id']}/assign-branch",
        json={"branch_id": branch["id"]},
        headers=pre_sales_headers,
        timeout=25,
    )
    assert assign_resp.status_code == 200

    branch_admin_headers, _ = _login(
        api_client,
        branch["admin_email"],
        "branch321",
    )

    confirm_resp = api_client.post(
        f"{BASE_URL}/api/v3/leads/{lead['id']}/confirm",
        headers=branch_admin_headers,
        timeout=25,
    )
    assert confirm_resp.status_code == 200

    book_resp = api_client.post(
        f"{BASE_URL}/api/v3/leads/{lead['id']}/book-appointment",
        json={"doctor_id": doctor["id"], "slot_time": slot_time},
        headers=branch_admin_headers,
        timeout=25,
    )
    assert book_resp.status_code == 200
    appointment = book_resp.json()
    assert appointment["status"] == "new_appointment"

    return {
        "lead_id": lead["id"],
        "appointment_id": appointment["id"],
        "slot_time": slot_time,
    }


def test_head_physio_can_view_today_and_new_appointments(api_client, role_headers, seeded_appointment):
    # Appointments module: head physio visibility for today/new views
    headers = role_headers["head_physio"]["headers"]

    today_resp = api_client.get(
        f"{BASE_URL}/api/v3/appointments",
        params={"view": "today"},
        headers=headers,
        timeout=25,
    )
    assert today_resp.status_code == 200
    today_rows = today_resp.json()
    assert any(row["id"] == seeded_appointment["appointment_id"] for row in today_rows)

    new_resp = api_client.get(
        f"{BASE_URL}/api/v3/appointments",
        params={"view": "new"},
        headers=headers,
        timeout=25,
    )
    assert new_resp.status_code == 200
    new_rows = new_resp.json()
    assert any(row["id"] == seeded_appointment["appointment_id"] for row in new_rows)


def test_physio_can_view_today_and_new_appointments(api_client, role_headers, seeded_appointment):
    # Appointments module: physio visibility for today/new views
    headers = role_headers["physio"]["headers"]

    today_resp = api_client.get(
        f"{BASE_URL}/api/v3/appointments",
        params={"view": "today"},
        headers=headers,
        timeout=25,
    )
    assert today_resp.status_code == 200
    today_rows = today_resp.json()
    assert any(row["id"] == seeded_appointment["appointment_id"] for row in today_rows)

    new_resp = api_client.get(
        f"{BASE_URL}/api/v3/appointments",
        params={"view": "new"},
        headers=headers,
        timeout=25,
    )
    assert new_resp.status_code == 200
    new_rows = new_resp.json()
    assert any(row["id"] == seeded_appointment["appointment_id"] for row in new_rows)


def test_head_physio_complete_updates_status_and_lead_stage(api_client, role_headers, seeded_appointment):
    # Completion module: head physio complete action updates appointment and lead
    complete_resp = api_client.post(
        f"{BASE_URL}/api/v3/appointments/{seeded_appointment['appointment_id']}/complete",
        headers=role_headers["head_physio"]["headers"],
        timeout=25,
    )
    assert complete_resp.status_code == 200
    completed = complete_resp.json()
    assert completed["status"] == "completed"

    lead_resp = api_client.get(
        f"{BASE_URL}/api/v3/leads",
        params={"stage": "Completed"},
        headers=role_headers["admin"]["headers"],
        timeout=25,
    )
    assert lead_resp.status_code == 200
    rows = lead_resp.json()
    assert any(row["id"] == seeded_appointment["lead_id"] for row in rows)


def test_physio_complete_endpoint_available_for_role(api_client, role_headers):
    # Completion module: physio can access complete endpoint (404 allowed for unknown appointment id)
    fake_id = str(uuid.uuid4())
    resp = api_client.post(
        f"{BASE_URL}/api/v3/appointments/{fake_id}/complete",
        headers=role_headers["physio"]["headers"],
        timeout=25,
    )
    assert resp.status_code == 404
    data = resp.json()
    assert "detail" in data
