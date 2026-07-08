import os

import pytest
import requests
from dotenv import load_dotenv


load_dotenv("/app/frontend/.env")
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")


# Screen 1 auth module: login + me + logout for all six role credentials
ROLE_CREDENTIALS = [
    ("fitsiomaxtech@gmail.com", "FitsioMax06", "super_admin"),
    ("businessdev@fitsiomax.com", "bd123", "business_dev"),
    ("presales@fitsiomax.com", "presales123", "pre_sales"),
    ("branchadmin@fitsiomax.com", "branch123", "branch_admin"),
    ("headphysio@fitsiomax.com", "head123", "head_physio"),
    ("physio@fitsiomax.com", "physio123", "physio"),
]


@pytest.fixture(scope="session")
def api_client():
    if not BASE_URL:
        pytest.skip("REACT_APP_BACKEND_URL is not configured")
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


@pytest.mark.parametrize("email,password,expected_role", ROLE_CREDENTIALS)
def test_v3_login_with_all_screen1_roles(api_client, email, password, expected_role):
    response = api_client.post(
        f"{BASE_URL}/api/v3/auth/login",
        json={"email": email, "password": password},
        timeout=25,
    )

    assert response.status_code == 200
    data = response.json()
    assert isinstance(data.get("token"), str) and len(data["token"]) > 0
    assert data["user"]["email"] == email
    assert data["user"]["role"] == expected_role


@pytest.mark.parametrize("email,password,_expected_role", ROLE_CREDENTIALS)
def test_v3_protected_route_access_after_login(api_client, email, password, _expected_role):
    login_resp = api_client.post(
        f"{BASE_URL}/api/v3/auth/login",
        json={"email": email, "password": password},
        timeout=25,
    )
    assert login_resp.status_code == 200

    token = login_resp.json()["token"]
    me_resp = api_client.get(
        f"{BASE_URL}/api/v3/verticals",
        headers={"Authorization": f"Bearer {token}"},
        timeout=25,
    )

    assert me_resp.status_code == 200
    rows = me_resp.json()
    assert isinstance(rows, list)
    assert len(rows) >= 1


def test_v3_invalid_login_fails(api_client):
    response = api_client.post(
        f"{BASE_URL}/api/v3/auth/login",
        json={"email": "fitsiomaxtech@gmail.com", "password": "wrong-pass"},
        timeout=25,
    )

    assert response.status_code == 401
    body = response.json()
    assert "detail" in body


def test_v3_logout_invalidates_session(api_client):
    login_resp = api_client.post(
        f"{BASE_URL}/api/v3/auth/login",
        json={"email": "fitsiomaxtech@gmail.com", "password": "FitsioMax06"},
        timeout=25,
    )
    assert login_resp.status_code == 200

    token = login_resp.json()["token"]
    headers = {"Authorization": f"Bearer {token}"}

    logout_resp = api_client.post(f"{BASE_URL}/api/v3/auth/logout", headers=headers, timeout=25)
    assert logout_resp.status_code == 200

    me_after_logout = api_client.get(f"{BASE_URL}/api/v3/verticals", headers=headers, timeout=25)
    assert me_after_logout.status_code == 401
