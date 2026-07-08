"""Iteration 25 — Tests for Custom Lead Fields CRUD + extended /leads/manual payload."""
import os
import pytest
import requests
import uuid

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "https://lead-manager-100.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api/v3"

CREDS = {
    "super_admin": ("fitsiomaxtech@gmail.com", "FitsioMax06"),
    "pre_sales": ("presales@fitsiomax.com", "presales123"),
    "branch_admin": ("branchadmin@fitsiomax.com", "branch123"),
    "head_physio": ("headphysio@fitsiomax.com", "head123"),
    "physio": ("physio@fitsiomax.com", "physio123"),
    "business_dev": ("businessdev@fitsiomax.com", "bd123"),
}


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"Login failed for {email}: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def tokens():
    return {role: _login(email, pwd) for role, (email, pwd) in CREDS.items()}


@pytest.fixture
def super_h(tokens):
    return {"Authorization": f"Bearer {tokens['super_admin']}"}


@pytest.fixture
def presales_h(tokens):
    return {"Authorization": f"Bearer {tokens['pre_sales']}"}


@pytest.fixture
def branch_h(tokens):
    return {"Authorization": f"Bearer {tokens['branch_admin']}"}


@pytest.fixture(autouse=True)
def cleanup_test_fields(super_h):
    yield
    rows = requests.get(f"{API}/lead-fields", headers=super_h, timeout=30).json()
    for r in rows:
        if r.get("label", "").startswith("TEST_") or r.get("key", "").startswith("test_"):
            requests.delete(f"{API}/lead-fields/{r['id']}", headers=super_h, timeout=30)


# --- /api/v3/lead-fields ---

class TestLeadFieldsList:
    def test_list_requires_auth(self):
        r = requests.get(f"{API}/lead-fields", timeout=30)
        assert r.status_code in (401, 403, 422)

    def test_list_for_all_roles(self, tokens):
        for role, tok in tokens.items():
            r = requests.get(f"{API}/lead-fields", headers={"Authorization": f"Bearer {tok}"}, timeout=30)
            assert r.status_code == 200, f"role={role} got {r.status_code}"
            assert isinstance(r.json(), list), f"role={role} body not list"


class TestLeadFieldsCreate:
    def test_create_select_field_super_admin(self, super_h):
        payload = {
            "label": "TEST_Insurance Provider",
            "type": "select",
            "options": ["Apollo", "Star", "HDFC Ergo"],
            "required": True,
        }
        r = requests.post(f"{API}/lead-fields", json=payload, headers=super_h, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["key"] == "test_insurance_provider"
        assert data["label"] == payload["label"]
        assert data["type"] == "select"
        assert data["options"] == ["Apollo", "Star", "HDFC Ergo"]
        assert data["required"] is True
        assert "id" in data

        # Verify GET picks it up
        lst = requests.get(f"{API}/lead-fields", headers=super_h, timeout=30).json()
        assert any(x["id"] == data["id"] for x in lst)

    def test_duplicate_label_returns_409(self, super_h):
        payload = {"label": "TEST_Dup Field", "type": "text"}
        r1 = requests.post(f"{API}/lead-fields", json=payload, headers=super_h, timeout=30)
        assert r1.status_code == 200
        r2 = requests.post(f"{API}/lead-fields", json=payload, headers=super_h, timeout=30)
        assert r2.status_code == 409, r2.text

    def test_non_super_admin_forbidden(self, presales_h, branch_h):
        payload = {"label": "TEST_Forbidden", "type": "text"}
        r1 = requests.post(f"{API}/lead-fields", json=payload, headers=presales_h, timeout=30)
        assert r1.status_code == 403, r1.text
        r2 = requests.post(f"{API}/lead-fields", json=payload, headers=branch_h, timeout=30)
        assert r2.status_code == 403, r2.text


class TestLeadFieldsUpdateDelete:
    def test_patch_updates_field(self, super_h):
        c = requests.post(f"{API}/lead-fields", json={"label": "TEST_Patch Me", "type": "text"}, headers=super_h, timeout=30)
        fid = c.json()["id"]
        r = requests.patch(f"{API}/lead-fields/{fid}",
                           json={"label": "TEST_Patched", "type": "number", "required": True},
                           headers=super_h, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["label"] == "TEST_Patched"
        assert body["type"] == "number"
        assert body["required"] is True

    def test_patch_bad_id_404(self, super_h):
        r = requests.patch(f"{API}/lead-fields/does-not-exist-xyz",
                           json={"label": "x"}, headers=super_h, timeout=30)
        assert r.status_code == 404

    def test_delete_field(self, super_h):
        c = requests.post(f"{API}/lead-fields", json={"label": "TEST_Delete Me", "type": "text"}, headers=super_h, timeout=30)
        fid = c.json()["id"]
        d = requests.delete(f"{API}/lead-fields/{fid}", headers=super_h, timeout=30)
        assert d.status_code == 200, d.text
        # Verify deletion
        lst = requests.get(f"{API}/lead-fields", headers=super_h, timeout=30).json()
        assert not any(x["id"] == fid for x in lst)

    def test_delete_bad_id_404(self, super_h):
        r = requests.delete(f"{API}/lead-fields/does-not-exist-xyz", headers=super_h, timeout=30)
        assert r.status_code == 404


# --- /api/v3/leads/manual extended payload ---

class TestLeadsManualExtended:
    def _seed_branch_id(self, super_h):
        r = requests.get(f"{API}/branches", headers=super_h, timeout=30)
        assert r.status_code == 200, r.text
        branches = r.json()
        assert branches, "No branches seeded"
        return branches[0]["id"]

    def test_create_lead_full_payload(self, super_h):
        branch_id = self._seed_branch_id(super_h)
        suffix = uuid.uuid4().hex[:6]
        payload = {
            "name": f"TEST_FullLead_{suffix}",
            "phone": "9000000001",
            "alternative_phone": "9000000002",
            "address": "12 Main St",
            "city": "Bengaluru",
            "state": "Karnataka",
            "location": "Indiranagar",
            "department": "offline_physio",
            "condition": "Lower back pain",
            "months_of_pain": 6,
            "age": 42,
            "gender": "male",
            "occupation": "Engineer",
            "expected_consultation_date": "2026-02-10",
            "branch_id": branch_id,
            "extra_fields": {"insurance_provider": "Apollo", "deposit_paid": 5000},
        }
        r = requests.post(f"{API}/leads/manual", json=payload, headers=super_h, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["name"] == payload["name"]
        assert d["phone"] == "9000000001"
        assert d["alternative_phone"] == "9000000002"
        assert d["address"] == "12 Main St"
        assert d["city"] == "Bengaluru"
        assert d["state"] == "Karnataka"
        assert d["department"] == "offline_physio"
        assert d["condition"] == "Lower back pain"
        assert d["months_of_pain"] == 6
        assert d["age"] == 42
        assert d["gender"] == "male"
        assert d["occupation"] == "Engineer"
        assert d["expected_consultation_date"] == "2026-02-10"
        assert d["branch_id"] == branch_id
        assert d["stage"] == "New Lead"
        assert d["extra_fields"]["insurance_provider"] == "Apollo"
        # numeric extra_field preserved (Dict[str, Any])
        assert d["extra_fields"]["deposit_paid"] == 5000

        # Read back via GET /leads
        gl = requests.get(f"{API}/leads", headers=super_h, timeout=30).json()
        found = next((x for x in gl if x["id"] == d["id"]), None)
        assert found is not None
        assert found["extra_fields"]["deposit_paid"] == 5000

    def test_online_physio_no_branch_required(self, super_h):
        suffix = uuid.uuid4().hex[:6]
        payload = {
            "name": f"TEST_OnlineLead_{suffix}",
            "phone": "9000000003",
            "department": "online_physio",
        }
        r = requests.post(f"{API}/leads/manual", json=payload, headers=super_h, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["department"] == "online_physio"
        assert d["branch_id"] in (None, "", )

    def test_offline_branch_id_persists_when_provided(self, super_h):
        branch_id = self._seed_branch_id(super_h)
        suffix = uuid.uuid4().hex[:6]
        r = requests.post(f"{API}/leads/manual", json={
            "name": f"TEST_OfflineWithBranch_{suffix}",
            "phone": "9000000004",
            "department": "offline_physio",
            "branch_id": branch_id,
        }, headers=super_h, timeout=30)
        assert r.status_code == 200
        assert r.json()["branch_id"] == branch_id

    def test_put_partial_update(self, super_h):
        branch_id = self._seed_branch_id(super_h)
        suffix = uuid.uuid4().hex[:6]
        c = requests.post(f"{API}/leads/manual", json={
            "name": f"TEST_PutLead_{suffix}",
            "phone": "9000000005",
            "department": "offline_physio",
            "branch_id": branch_id,
        }, headers=super_h, timeout=30)
        lead_id = c.json()["id"]
        upd = requests.put(f"{API}/leads/{lead_id}", json={
            "alternative_phone": "9999988888",
            "city": "Mumbai",
            "condition": "Knee pain",
            "months_of_pain": 12,
            "age": 35,
            "extra_fields": {"insurance_provider": "Star", "premium": 12000},
            "notes": "Updated by test",
        }, headers=super_h, timeout=30)
        assert upd.status_code == 200, upd.text
        b = upd.json()
        assert b["alternative_phone"] == "9999988888"
        assert b["city"] == "Mumbai"
        assert b["condition"] == "Knee pain"
        assert b["months_of_pain"] == 12
        assert b["age"] == 35
        assert b["extra_fields"]["premium"] == 12000
        assert b["notes"] == "Updated by test"
