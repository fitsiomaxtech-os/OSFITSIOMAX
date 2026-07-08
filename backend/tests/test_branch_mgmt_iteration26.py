"""Iteration 26 - Branch Management module (/api/v3/branch-mgmt/*)."""
import os
import uuid
import pytest
import requests

def _read_frontend_env():
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip()
    except Exception:
        return None
    return None


BASE = (os.environ.get("REACT_APP_BACKEND_URL") or _read_frontend_env()).rstrip("/") + "/api/v3"


def _login(email, password):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login failed for {email}: {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def super_token():
    return _login("fitsiomaxtech@gmail.com", "FitsioMax06")


@pytest.fixture(scope="session")
def presales_token():
    return _login("presales@fitsiomax.com", "presales123")


@pytest.fixture(scope="session")
def branch_admin_token():
    return _login("branchadmin@fitsiomax.com", "branch123")


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


# --- listing ---
class TestList:
    def test_list_as_super_admin(self, super_token):
        r = requests.get(f"{BASE}/branch-mgmt", headers=H(super_token))
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        if data:
            b = data[0]
            for k in ("leads_total", "leads_open", "leads_completed",
                     "appointments_count", "doctors_count", "id", "branch_name"):
                assert k in b, f"missing {k}"

    def test_list_forbidden_for_presales(self, presales_token):
        r = requests.get(f"{BASE}/branch-mgmt", headers=H(presales_token))
        assert r.status_code == 403

    def test_list_unauthorized_without_token(self):
        r = requests.get(f"{BASE}/branch-mgmt")
        assert r.status_code in (401, 403, 422)


# --- Create-with-existing-admin + reassign flows ---
@pytest.fixture
def fresh_branch_admin(super_token):
    """Create a fresh branch_admin user that is not yet assigned to any branch."""
    suffix = uuid.uuid4().hex[:6]
    payload = {
        "full_name": f"TEST_BA_{suffix}",
        "email": f"test_ba_{suffix}@fitsiomax.com",
        "phone": "+910000000000",
        "password": "test123",
        "role": "branch_admin",
        "branch_id": None,
        "is_active": True,
    }
    r = requests.post(f"{BASE}/hr/users", json=payload, headers=H(super_token))
    assert r.status_code in (200, 201), f"user create failed: {r.text}"
    u = r.json()
    yield u
    # Cleanup
    try:
        requests.delete(f"{BASE}/hr/users/{u['id']}", headers=H(super_token))
    except Exception:
        pass


@pytest.fixture
def fresh_branch_admin_2(super_token):
    suffix = uuid.uuid4().hex[:6]
    payload = {
        "full_name": f"TEST_BA2_{suffix}",
        "email": f"test_ba2_{suffix}@fitsiomax.com",
        "phone": "+910000000001",
        "password": "test123",
        "role": "branch_admin",
        "branch_id": None,
        "is_active": True,
    }
    r = requests.post(f"{BASE}/hr/users", json=payload, headers=H(super_token))
    assert r.status_code in (200, 201)
    u = r.json()
    yield u
    try:
        requests.delete(f"{BASE}/hr/users/{u['id']}", headers=H(super_token))
    except Exception:
        pass


@pytest.fixture
def fresh_non_branch_admin(super_token):
    suffix = uuid.uuid4().hex[:6]
    payload = {
        "full_name": f"TEST_PRE_{suffix}",
        "email": f"test_pre_{suffix}@fitsiomax.com",
        "phone": "+910000000002",
        "password": "test123",
        "role": "pre_sales",
        "branch_id": None,
        "is_active": True,
    }
    r = requests.post(f"{BASE}/hr/users", json=payload, headers=H(super_token))
    assert r.status_code in (200, 201)
    u = r.json()
    yield u
    try:
        requests.delete(f"{BASE}/hr/users/{u['id']}", headers=H(super_token))
    except Exception:
        pass


def _cleanup_branch(token, branch_id):
    try:
        requests.delete(f"{BASE}/branches/{branch_id}", headers=H(token))
    except Exception:
        pass


class TestCreateWithExistingAdmin:
    def test_create_success_and_user_branch_id_updated(self, super_token, fresh_branch_admin):
        suffix = uuid.uuid4().hex[:6]
        payload = {
            "branch_name": f"TEST_Branch_{suffix}",
            "address": "Some Address, City",
            "admin_user_id": fresh_branch_admin["id"],
            "admin_phone": "+919999999999",
            "vertical": "offline_physiotherapy",
        }
        r = requests.post(f"{BASE}/branch-mgmt/with-existing-admin", json=payload, headers=H(super_token))
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["branch_name"] == payload["branch_name"]
        assert b["admin_user_id"] == fresh_branch_admin["id"]
        assert b["admin_email"] == fresh_branch_admin["email"]
        bid = b["id"]

        # Verify user.branch_id updated via hr listing
        rlist = requests.get(f"{BASE}/hr/users", headers=H(super_token))
        assert rlist.status_code == 200
        u = next((x for x in rlist.json() if x["id"] == fresh_branch_admin["id"]), None)
        assert u is not None
        assert u.get("branch_id") == bid, f"expected branch_id={bid}, got {u.get('branch_id')}"

        # GET via list to verify persistence + enriched fields
        r2 = requests.get(f"{BASE}/branch-mgmt", headers=H(super_token))
        assert r2.status_code == 200
        match = next((x for x in r2.json() if x["id"] == bid), None)
        assert match is not None
        for k in ("leads_total", "leads_open", "leads_completed",
                  "appointments_count", "doctors_count"):
            assert k in match

        _cleanup_branch(super_token, bid)

    def test_create_user_not_found(self, super_token):
        payload = {
            "branch_name": "TEST_NoUser",
            "address": "x",
            "admin_user_id": "00000000-0000-0000-0000-000000000000",
        }
        r = requests.post(f"{BASE}/branch-mgmt/with-existing-admin", json=payload, headers=H(super_token))
        assert r.status_code == 404

    def test_create_role_mismatch(self, super_token, fresh_non_branch_admin):
        payload = {
            "branch_name": "TEST_RoleMismatch",
            "address": "x",
            "admin_user_id": fresh_non_branch_admin["id"],
        }
        r = requests.post(f"{BASE}/branch-mgmt/with-existing-admin", json=payload, headers=H(super_token))
        assert r.status_code == 400

    def test_create_user_already_assigned(self, super_token, fresh_branch_admin):
        suffix = uuid.uuid4().hex[:6]
        payload1 = {
            "branch_name": f"TEST_First_{suffix}",
            "address": "addr1",
            "admin_user_id": fresh_branch_admin["id"],
        }
        r1 = requests.post(f"{BASE}/branch-mgmt/with-existing-admin", json=payload1, headers=H(super_token))
        assert r1.status_code == 200
        bid = r1.json()["id"]

        # Try again with same admin
        payload2 = {
            "branch_name": f"TEST_Second_{suffix}",
            "address": "addr2",
            "admin_user_id": fresh_branch_admin["id"],
        }
        r2 = requests.post(f"{BASE}/branch-mgmt/with-existing-admin", json=payload2, headers=H(super_token))
        assert r2.status_code == 409, r2.text

        _cleanup_branch(super_token, bid)

    def test_create_forbidden_for_presales(self, presales_token, fresh_branch_admin):
        payload = {
            "branch_name": "TEST_Forbid",
            "address": "x",
            "admin_user_id": fresh_branch_admin["id"],
        }
        r = requests.post(f"{BASE}/branch-mgmt/with-existing-admin", json=payload, headers=H(presales_token))
        assert r.status_code == 403

    def test_create_forbidden_for_branch_admin(self, branch_admin_token, fresh_branch_admin):
        payload = {
            "branch_name": "TEST_Forbid2",
            "address": "x",
            "admin_user_id": fresh_branch_admin["id"],
        }
        r = requests.post(f"{BASE}/branch-mgmt/with-existing-admin", json=payload, headers=H(branch_admin_token))
        assert r.status_code == 403


# --- Reassign ---
class TestReassign:
    def test_reassign_success(self, super_token, fresh_branch_admin, fresh_branch_admin_2):
        # Create branch with admin 1
        suffix = uuid.uuid4().hex[:6]
        r = requests.post(f"{BASE}/branch-mgmt/with-existing-admin", json={
            "branch_name": f"TEST_Reassign_{suffix}",
            "address": "addr",
            "admin_user_id": fresh_branch_admin["id"],
        }, headers=H(super_token))
        assert r.status_code == 200
        bid = r.json()["id"]

        # Reassign to admin 2
        r2 = requests.patch(f"{BASE}/branch-mgmt/{bid}/admin",
                            json={"admin_user_id": fresh_branch_admin_2["id"]},
                            headers=H(super_token))
        assert r2.status_code == 200, r2.text
        upd = r2.json()
        assert upd["admin_user_id"] == fresh_branch_admin_2["id"]
        assert upd["admin_email"] == fresh_branch_admin_2["email"]

        # Verify prev admin branch_id is None, new admin branch_id is bid
        rlist = requests.get(f"{BASE}/hr/users", headers=H(super_token))
        users = {u["id"]: u for u in rlist.json()}
        assert users[fresh_branch_admin["id"]].get("branch_id") in (None, "")
        assert users[fresh_branch_admin_2["id"]].get("branch_id") == bid

        _cleanup_branch(super_token, bid)

    def test_reassign_branch_not_found(self, super_token, fresh_branch_admin):
        r = requests.patch(f"{BASE}/branch-mgmt/{uuid.uuid4()}/admin",
                           json={"admin_user_id": fresh_branch_admin["id"]},
                           headers=H(super_token))
        assert r.status_code == 404

    def test_reassign_role_mismatch(self, super_token, fresh_branch_admin, fresh_non_branch_admin):
        # Create branch
        r = requests.post(f"{BASE}/branch-mgmt/with-existing-admin", json={
            "branch_name": f"TEST_RA_{uuid.uuid4().hex[:6]}",
            "address": "x",
            "admin_user_id": fresh_branch_admin["id"],
        }, headers=H(super_token))
        bid = r.json()["id"]
        r2 = requests.patch(f"{BASE}/branch-mgmt/{bid}/admin",
                            json={"admin_user_id": fresh_non_branch_admin["id"]},
                            headers=H(super_token))
        assert r2.status_code == 400
        _cleanup_branch(super_token, bid)

    def test_reassign_forbidden_for_presales(self, presales_token, super_token, fresh_branch_admin):
        # create branch first as super
        r = requests.post(f"{BASE}/branch-mgmt/with-existing-admin", json={
            "branch_name": f"TEST_RF_{uuid.uuid4().hex[:6]}",
            "address": "x",
            "admin_user_id": fresh_branch_admin["id"],
        }, headers=H(super_token))
        bid = r.json()["id"]
        r2 = requests.patch(f"{BASE}/branch-mgmt/{bid}/admin",
                            json={"admin_user_id": fresh_branch_admin["id"]},
                            headers=H(presales_token))
        assert r2.status_code == 403
        _cleanup_branch(super_token, bid)


# --- Performance ---
class TestPerformance:
    def test_performance_summary(self, super_token):
        r = requests.get(f"{BASE}/branch-mgmt/performance-summary", headers=H(super_token))
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        if data:
            row = data[0]
            for k in ("branch_id", "branch_name", "admin_name", "address",
                     "leads_total", "leads_completed", "conversion_rate", "total_revenue"):
                assert k in row, f"missing {k}"

    def test_performance_summary_forbidden(self, presales_token):
        r = requests.get(f"{BASE}/branch-mgmt/performance-summary", headers=H(presales_token))
        assert r.status_code == 403

    def test_performance_detail_existing_branch(self, super_token):
        # Pick any existing branch
        bs = requests.get(f"{BASE}/branch-mgmt", headers=H(super_token)).json()
        if not bs:
            pytest.skip("No branches in DB to test detail")
        bid = bs[0]["id"]
        r = requests.get(f"{BASE}/branch-mgmt/{bid}/performance", headers=H(super_token))
        assert r.status_code == 200, r.text
        d = r.json()
        assert "branch" in d and "kpis" in d and "stage_breakdown" in d
        for k in ("leads_total", "leads_completed", "conversion_rate",
                  "appointments_total", "appointments_completed",
                  "consultation_fees", "package_revenue", "total_revenue",
                  "doctors", "physios", "head_physios"):
            assert k in d["kpis"], f"missing kpi {k}"
        assert isinstance(d["stage_breakdown"], list)
        # math sanity
        if d["kpis"]["leads_total"] > 0:
            calc = (d["kpis"]["leads_completed"] / d["kpis"]["leads_total"]) * 100
            assert abs(calc - d["kpis"]["conversion_rate"]) <= 0.2
        assert d["kpis"]["total_revenue"] == d["kpis"]["consultation_fees"] + d["kpis"]["package_revenue"]

    def test_performance_detail_not_found(self, super_token):
        r = requests.get(f"{BASE}/branch-mgmt/{uuid.uuid4()}/performance", headers=H(super_token))
        assert r.status_code == 404
