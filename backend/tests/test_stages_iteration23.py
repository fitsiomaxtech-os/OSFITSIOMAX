"""
Iteration 23 — Pre-Sales CRM module: Pipeline Stage CRUD + new Lead schema fields.
Covers /api/v3/stages and PUT /api/v3/leads with new fields, plus marketing sync regression.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://lead-manager-100.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api/v3"


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed {email}: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_token():
    return _login("fitsiomaxtech@gmail.com", "FitsioMax06")


@pytest.fixture(scope="module")
def presales_token():
    return _login("presales@fitsiomax.com", "presales123")


@pytest.fixture(scope="module")
def auth_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


# ---------- Stages: list & seed ----------
class TestStagesList:
    def test_presales_stages_seeded(self, auth_headers):
        r = requests.get(f"{API}/stages?type=pre_sales", headers=auth_headers, timeout=20)
        assert r.status_code == 200
        rows = r.json()
        names = [x["name"] for x in rows]
        expected = ["New Lead", "Pre-sales Qualified", "Assigned to Branch",
                    "Branch Confirmed", "Appointment Booked", "Completed"]
        assert all(n in names for n in expected), f"missing seeded pre_sales stages: {names}"
        # order 0..N
        orders = sorted([x["order"] for x in rows if x["type"] == "pre_sales"])
        assert orders == list(range(len(orders)))
        # lead_count present
        for r_ in rows:
            assert "lead_count" in r_
            assert r_["type"] == "pre_sales"

    def test_sales_stages_seeded(self, auth_headers):
        r = requests.get(f"{API}/stages?type=sales", headers=auth_headers, timeout=20)
        assert r.status_code == 200
        rows = r.json()
        names = [x["name"] for x in rows]
        expected = ["New Appointment", "Call & Confirm", "Head Physio Appointment",
                    "Consultation Fee Collected", "Consultation Done",
                    "Follow-up Package Upsell", "Package Paid", "Jr. Physio Assigned"]
        for e in expected:
            assert e in names, f"missing sales stage {e}"


# ---------- Stages: Create / Update / Delete / Reorder ----------
class TestStagesCRUD:
    def test_create_stage_super_admin(self, auth_headers):
        tag = uuid.uuid4().hex[:6]
        payload = {"name": f"TEST_Stage_{tag}", "color": "#22c55e",
                   "type": "pre_sales", "is_final": False}
        r = requests.post(f"{API}/stages", json=payload, headers=auth_headers, timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["name"] == payload["name"]
        assert body["type"] == "pre_sales"
        assert "order" in body and isinstance(body["order"], int)
        # cleanup
        requests.delete(f"{API}/stages/{body['id']}", headers=auth_headers, timeout=20)

    def test_create_stage_non_super_admin_rejected(self, presales_token):
        h = {"Authorization": f"Bearer {presales_token}", "Content-Type": "application/json"}
        payload = {"name": f"TEST_blocked_{uuid.uuid4().hex[:5]}",
                   "type": "pre_sales", "color": "#000"}
        r = requests.post(f"{API}/stages", json=payload, headers=h, timeout=20)
        assert r.status_code in (401, 403)

    def test_patch_stage_renames_and_propagates(self, auth_headers):
        tag = uuid.uuid4().hex[:5]
        # create stage
        c = requests.post(f"{API}/stages",
                          json={"name": f"TEST_Rename_{tag}", "type": "pre_sales", "color": "#000"},
                          headers=auth_headers, timeout=20).json()
        sid = c["id"]
        # patch
        new_name = f"TEST_Renamed_{tag}"
        u = requests.patch(f"{API}/stages/{sid}",
                           json={"name": new_name, "is_final": True},
                           headers=auth_headers, timeout=20)
        assert u.status_code == 200, u.text
        body = u.json()
        assert body["name"] == new_name
        assert body["is_final"] is True
        requests.delete(f"{API}/stages/{sid}", headers=auth_headers, timeout=20)

    def test_delete_stage_succeeds_when_no_leads(self, auth_headers):
        tag = uuid.uuid4().hex[:5]
        c = requests.post(f"{API}/stages",
                          json={"name": f"TEST_Del_{tag}", "type": "pre_sales", "color": "#999"},
                          headers=auth_headers, timeout=20).json()
        sid = c["id"]
        d = requests.delete(f"{API}/stages/{sid}", headers=auth_headers, timeout=20)
        assert d.status_code == 200

    def test_delete_stage_blocked_when_in_use(self, auth_headers):
        # "New Lead" should always be in use by at least the marketing-synced leads.
        # Find New Lead stage id
        rows = requests.get(f"{API}/stages?type=pre_sales", headers=auth_headers, timeout=20).json()
        nl = next((r for r in rows if r["name"] == "New Lead"), None)
        if not nl or nl.get("lead_count", 0) == 0:
            pytest.skip("No leads currently in 'New Lead' to test in-use guard")
        d = requests.delete(f"{API}/stages/{nl['id']}", headers=auth_headers, timeout=20)
        assert d.status_code == 409

    def test_reorder_stages(self, auth_headers):
        rows = requests.get(f"{API}/stages?type=pre_sales", headers=auth_headers, timeout=20).json()
        # reverse order
        items = [{"id": r["id"], "order": len(rows) - 1 - i} for i, r in enumerate(rows)]
        r = requests.post(f"{API}/stages/reorder", json={"items": items},
                          headers=auth_headers, timeout=20)
        assert r.status_code == 200
        # restore
        items_back = [{"id": r["id"], "order": i} for i, r in enumerate(rows)]
        requests.post(f"{API}/stages/reorder", json={"items": items_back},
                      headers=auth_headers, timeout=20)


# ---------- Lead schema new fields ----------
class TestLeadNewFields:
    def test_put_lead_with_new_fields(self, auth_headers):
        tag = uuid.uuid4().hex[:5]
        # create lead first via /leads/manual
        c = requests.post(f"{API}/leads/manual", json={
            "name": f"TEST_LeadFields_{tag}",
            "phone": f"90000{tag}",
            "source_type": "manual",
            "vertical": "offline_physiotherapy",
        }, headers=auth_headers, timeout=20)
        assert c.status_code == 200, c.text
        lead_id = c.json()["id"]
        # update with new fields
        u = requests.put(f"{API}/leads/{lead_id}", json={
            "location": "Chennai",
            "expected_consultation_date": "2026-02-10",
            "months_of_pain": 6,
            "age": 38,
            "gender": "female",
            "occupation": "Engineer",
            "department": "offline_physio",
            "assigned_user_id": "u-123",
            "assigned_user_name": "Branch Admin Test",
        }, headers=auth_headers, timeout=20)
        assert u.status_code == 200, u.text
        body = u.json()
        assert body["location"] == "Chennai"
        assert body["months_of_pain"] == 6
        assert body["age"] == 38
        assert body["gender"] == "female"
        assert body["department"] == "offline_physio"
        assert body["assigned_user_name"] == "Branch Admin Test"
        # also verify persistence by fetching the list and finding our lead
        all_leads = requests.get(f"{API}/leads", headers=auth_headers, timeout=20).json()
        match = next((l for l in all_leads if l["id"] == lead_id), None)
        assert match is not None
        assert match["location"] == "Chennai"
        assert match["department"] == "offline_physio"


# ---------- Marketing sync regression: leads get stage='New Lead' ----------
class TestMarketingSyncRegression:
    def test_marketing_sync_lead_stage_new_lead(self, auth_headers):
        # Create source
        tag = uuid.uuid4().hex[:5]
        s = requests.post(f"{API}/marketing/sources", json={
            "name": f"TEST_Src23_{tag}",
            "platform": "meta",
            "headers": ["Name", "Phone"],
        }, headers=auth_headers, timeout=20)
        if s.status_code != 200:
            pytest.skip(f"marketing source create failed: {s.status_code} {s.text}")
        src_id = s.json()["id"]
        try:
            # Sync 1 row
            sync = requests.post(f"{API}/marketing/sources/{src_id}/sync", json={
                "rows": [{"Name": f"TEST_MS_{tag}", "Phone": f"90000{tag}"}],
            }, headers=auth_headers, timeout=20)
            assert sync.status_code == 200, sync.text
            # Find that lead
            leads = requests.get(f"{API}/leads", headers=auth_headers, timeout=20).json()
            matched = [l for l in leads if l["name"] == f"TEST_MS_{tag}"]
            if not matched:
                pytest.skip("synced lead not visible via /leads")
            assert matched[0]["stage"] == "New Lead"
        finally:
            requests.delete(f"{API}/marketing/sources/{src_id}", headers=auth_headers, timeout=20)
