"""Iteration 27 - Branch Detail endpoint + extended V3BranchUpdate (opened_date, opening_hours)."""
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


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="session")
def super_token():
    return _login("fitsiomaxtech@gmail.com", "FitsioMax06")


@pytest.fixture(scope="session")
def presales_token():
    return _login("presales@fitsiomax.com", "presales123")


@pytest.fixture(scope="session")
def branch_admin_token():
    return _login("branchadmin@fitsiomax.com", "branch123")


@pytest.fixture(scope="session")
def physio_token():
    return _login("physio@fitsiomax.com", "physio123")


@pytest.fixture(scope="session")
def any_branch_id(super_token):
    bs = requests.get(f"{BASE}/branch-mgmt", headers=H(super_token)).json()
    if not bs:
        pytest.skip("No branches in DB")
    return bs[0]["id"]


# ---- /detail endpoint ----
class TestBranchDetail:
    def test_detail_super_admin_full_payload(self, super_token, any_branch_id):
        r = requests.get(f"{BASE}/branch-mgmt/{any_branch_id}/detail", headers=H(super_token))
        assert r.status_code == 200, r.text
        d = r.json()
        # top-level keys
        for k in ("branch", "admin_user", "staff", "performance", "head_physio_section"):
            assert k in d, f"missing top key: {k}"
        # staff sub-keys
        for k in ("branch_admins", "head_physios", "physios", "doctors"):
            assert k in d["staff"], f"missing staff.{k}"
            assert isinstance(d["staff"][k], list)
        # performance
        perf = d["performance"]
        for k in ("kpis", "appointments", "consultations", "packages", "follow_ups"):
            assert k in perf, f"missing performance.{k}"
        # kpis
        for k in ("leads_total", "leads_open", "leads_completed"):
            assert k in perf["kpis"]
        # appointments
        for k in ("list", "total", "completed", "scheduled", "cancelled"):
            assert k in perf["appointments"], f"missing appointments.{k}"
        # consultations/packages
        for k in ("list", "total_count", "total_amount"):
            assert k in perf["consultations"]
            assert k in perf["packages"]
        # follow_ups
        for k in ("list", "open", "done", "total"):
            assert k in perf["follow_ups"]
        # head_physio_section
        for k in ("calendars", "physio_calendars", "post_treatment_reviews"):
            assert k in d["head_physio_section"]
            assert isinstance(d["head_physio_section"][k], list)

        # math sanity
        assert perf["appointments"]["total"] == len(
            (requests.get(f"{BASE}/branch-mgmt/{any_branch_id}/detail", headers=H(super_token)).json())["performance"]["appointments"]["list"][:50]
        ) or perf["appointments"]["total"] >= len(perf["appointments"]["list"])
        assert perf["follow_ups"]["open"] + perf["follow_ups"]["done"] == perf["follow_ups"]["total"]

    def test_detail_business_dev_role_allowed(self, super_token):
        # spawn a temporary business_dev user? We don't have one in creds.
        # Skip if no bd account login works.
        try:
            tok = _login("businessdev@fitsiomax.com", "bd123")
        except Exception:
            pytest.skip("business_dev seed not present")
        bs = requests.get(f"{BASE}/branch-mgmt", headers=H(tok))
        assert bs.status_code == 200
        if not bs.json():
            pytest.skip("No branches")
        bid = bs.json()[0]["id"]
        r = requests.get(f"{BASE}/branch-mgmt/{bid}/detail", headers=H(tok))
        assert r.status_code == 200

    def test_detail_forbidden_presales(self, presales_token, any_branch_id):
        r = requests.get(f"{BASE}/branch-mgmt/{any_branch_id}/detail", headers=H(presales_token))
        assert r.status_code == 403

    def test_detail_forbidden_branch_admin(self, branch_admin_token, any_branch_id):
        r = requests.get(f"{BASE}/branch-mgmt/{any_branch_id}/detail", headers=H(branch_admin_token))
        assert r.status_code == 403

    def test_detail_forbidden_physio(self, physio_token, any_branch_id):
        r = requests.get(f"{BASE}/branch-mgmt/{any_branch_id}/detail", headers=H(physio_token))
        assert r.status_code == 403

    def test_detail_404_bad_branch_id(self, super_token):
        r = requests.get(f"{BASE}/branch-mgmt/{uuid.uuid4()}/detail", headers=H(super_token))
        assert r.status_code == 404

    def test_detail_admin_user_returned(self, super_token, any_branch_id):
        r = requests.get(f"{BASE}/branch-mgmt/{any_branch_id}/detail", headers=H(super_token))
        d = r.json()
        branch = d["branch"]
        if branch.get("admin_user_id"):
            assert d["admin_user"] is not None
            assert d["admin_user"]["id"] == branch["admin_user_id"]
            assert "password" not in d["admin_user"]


# ---- PUT /branches/{id} with new optional fields ----
class TestExtendedUpdate:
    def test_update_opened_date_and_opening_hours_persist(self, super_token, any_branch_id):
        payload = {
            "opened_date": "2026-01-15",
            "opening_hours": "Mon-Sat 7am-9pm",
        }
        r = requests.put(f"{BASE}/branches/{any_branch_id}", json=payload, headers=H(super_token))
        assert r.status_code == 200, r.text
        out = r.json()
        assert out["opened_date"] == "2026-01-15"
        assert out["opening_hours"] == "Mon-Sat 7am-9pm"

        # GET via /detail to verify persistence
        d = requests.get(f"{BASE}/branch-mgmt/{any_branch_id}/detail", headers=H(super_token)).json()
        assert d["branch"]["opened_date"] == "2026-01-15"
        assert d["branch"]["opening_hours"] == "Mon-Sat 7am-9pm"

    def test_update_partial_only_opened_date(self, super_token, any_branch_id):
        r = requests.put(f"{BASE}/branches/{any_branch_id}", json={"opened_date": "2025-06-01"}, headers=H(super_token))
        assert r.status_code == 200
        assert r.json()["opened_date"] == "2025-06-01"

    def test_v3branchout_includes_new_fields(self, super_token):
        bs = requests.get(f"{BASE}/branch-mgmt", headers=H(super_token)).json()
        if not bs:
            pytest.skip("no branches")
        # opened_date/opening_hours may be empty string default but must be present in payload of /branches PUT response
        # Confirm by updating one and reading back via list (list returns raw branch dicts, so presence is contingent on update having occurred)
        b = bs[0]
        r = requests.put(f"{BASE}/branches/{b['id']}", json={"opened_date": "2026-01-15", "opening_hours": "Test"}, headers=H(super_token))
        assert r.status_code == 200
        out = r.json()
        assert "opened_date" in out
        assert "opening_hours" in out
