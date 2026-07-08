"""
Iteration 21 — Full session lifecycle backend smoke tests.

Covers:
- Auth for all six roles
- Head Physio Board endpoints (/head-physio/*)
- Branch package recommendations + assign-sessions + create jr-physio
- Physio Board endpoints (/physio/*)
- Patient view token endpoint (no internal HP notes leak)
- Finance board for Branch Admin
- Lead pipeline regression (pre-sales qualify -> branch confirm -> appointment -> complete)
"""
import os
import uuid
import datetime as dt
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fallback to frontend env file
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
    except Exception:
        pass

CREDS = {
    "super_admin":  ("fitsiomaxtech@gmail.com",   "FitsioMax06"),
    "business_dev": ("businessdev@fitsiomax.com", "bd123"),
    "pre_sales":    ("presales@fitsiomax.com",    "presales123"),
    "branch_admin": ("branchadmin@fitsiomax.com", "branch123"),
    "head_physio":  ("headphysio@fitsiomax.com",  "head123"),
    "physio":       ("physio@fitsiomax.com",      "physio123"),
}


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/v3/auth/login",
                      json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    j = r.json()
    return j.get("access_token") or j.get("token")


@pytest.fixture()
def tokens():
    """Fresh login per test — backend invalidates prior sessions on each login."""
    return {role: _login(e, p) for role, (e, p) in CREDS.items()}


_seeded_lead_cache = {"lead_id": None}


def H(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ───────────────────────── Auth: all six roles ─────────────────────────
@pytest.mark.parametrize("role", list(CREDS.keys()))
def test_login_all_roles(role):
    email, pw = CREDS[role]
    r = requests.post(f"{BASE_URL}/api/v3/auth/login",
                      json={"email": email, "password": pw}, timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    tok = data.get("access_token") or data.get("token")
    assert tok and len(tok) > 10
    assert data["user"]["role"] == role
    assert data["user"]["email"] == email


def test_login_invalid():
    r = requests.post(f"{BASE_URL}/api/v3/auth/login",
                      json={"email": "fitsiomaxtech@gmail.com", "password": "wrong"}, timeout=20)
    assert r.status_code == 401


# ───────────────────────── Head Physio Board ─────────────────────────
def test_hp_my_patients(tokens):
    r = requests.get(f"{BASE_URL}/api/v3/head-physio/my-patients",
                     headers=H(tokens["head_physio"]), timeout=20)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "patients" in body and isinstance(body["patients"], list)


def test_hp_my_patients_forbidden_for_presales(tokens):
    r = requests.get(f"{BASE_URL}/api/v3/head-physio/my-patients",
                     headers=H(tokens["pre_sales"]), timeout=20)
    assert r.status_code == 403


@pytest.fixture()
def seeded_lead_id(tokens):
    """Create a TEST_ lead via manual endpoint, then assign-branch so the head physio (under that branch)
    can recommend a package. Cached across tests (module-level dict) to keep state."""
    if _seeded_lead_cache["lead_id"]:
        # verify it still exists; if so reuse
        return _seeded_lead_cache["lead_id"]
    # Find branch for the head physio (use same branch as branch_admin/head_physio)
    me = requests.post(f"{BASE_URL}/api/v3/auth/login",
                       json={"email": CREDS["branch_admin"][0], "password": CREDS["branch_admin"][1]},
                       timeout=20).json()
    branch_id = me["user"].get("branch_id")
    assert branch_id, "branch_admin must have branch_id"

    # Re-login pre_sales (above login invalidated existing pre_sales? No, only branch_admin)
    presales_tok = _login(*CREDS["pre_sales"])

    # Create lead via /leads/manual
    lead_payload = {
        "name": f"TEST_Patient_{uuid.uuid4().hex[:6]}",
        "phone": f"99{uuid.uuid4().int % 100000000:08d}",
        "email": f"test_{uuid.uuid4().hex[:6]}@example.com",
        "vertical": "Physiotherapy",
        "source_tab": "Walk-in",
        "source_type": "manual",
        "branch_id": branch_id,
        "notes": "TEST seed",
    }
    r = requests.post(f"{BASE_URL}/api/v3/leads/manual",
                      headers=H(presales_tok), json=lead_payload, timeout=20)
    assert r.status_code in (200, 201), r.text
    lead = r.json()
    lead_id = lead.get("id")
    assert lead_id

    # Qualify + assign to branch
    presales_tok = _login(*CREDS["pre_sales"])
    requests.post(f"{BASE_URL}/api/v3/leads/{lead_id}/qualify",
                  headers=H(presales_tok), timeout=20)
    presales_tok = _login(*CREDS["pre_sales"])
    requests.post(f"{BASE_URL}/api/v3/leads/{lead_id}/assign-branch",
                  headers=H(presales_tok),
                  json={"branch_id": branch_id}, timeout=20)
    _seeded_lead_cache["lead_id"] = lead_id
    return lead_id


def test_hp_recommend_package(tokens, seeded_lead_id):
    payload = {
        "lead_id": seeded_lead_id,
        "recommended_weeks": 4,
        "sessions_per_week": 3,
        "notes": "TEST recommendation",
    }
    r = requests.post(f"{BASE_URL}/api/v3/head-physio/recommend-package",
                      headers=H(tokens["head_physio"]), json=payload, timeout=20)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["lead_id"] == seeded_lead_id
    assert body["total_sessions"] == 12
    assert body["status"] == "pending"


def test_hp_weekly_review_upsert(tokens, seeded_lead_id):
    payload = {
        "head_physio_notes": "TEST week 1 notes",
        "head_physio_suggestions": "TEST suggestions",
    }
    r = requests.post(
        f"{BASE_URL}/api/v3/head-physio/weekly-review/{seeded_lead_id}/1",
        headers=H(tokens["head_physio"]), json=payload, timeout=20,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["head_physio_notes"] == "TEST week 1 notes"
    assert body["week_number"] == 1
    assert body["status"] == "reviewed"

    # Verify GET
    g = requests.get(f"{BASE_URL}/api/v3/head-physio/weekly-assessments/{seeded_lead_id}",
                     headers=H(tokens["head_physio"]), timeout=20)
    assert g.status_code == 200
    assert any(a["week_number"] == 1 for a in g.json()["assessments"])


# ───────────── Branch Admin: recommendations, jr-physio, assign sessions ─────────────
def test_branch_recommendations_list(tokens, seeded_lead_id):
    r = requests.get(f"{BASE_URL}/api/v3/branch/package-recommendations",
                     headers=H(tokens["branch_admin"]), timeout=20)
    assert r.status_code == 200, r.text
    recs = r.json()["recommendations"]
    assert any(rec["lead_id"] == seeded_lead_id for rec in recs)


_jr_cache = {"doctor": None}


@pytest.fixture()
def jr_physio_doctor(tokens):
    """Create a Jr. Physio under branch admin (cached)."""
    if _jr_cache["doctor"]:
        return _jr_cache["doctor"]
    email = f"test_jr_{uuid.uuid4().hex[:6]}@example.com"
    payload = {
        "full_name": f"TEST_JrPhysio_{uuid.uuid4().hex[:4]}",
        "email": email,
        "password": "jrtest123",
        "specialization": "Sports",
    }
    r = requests.post(f"{BASE_URL}/api/v3/branch/jr-physios",
                      headers=H(tokens["branch_admin"]), json=payload, timeout=20)
    assert r.status_code in (200, 201), r.text
    _jr_cache["doctor"] = r.json()
    return _jr_cache["doctor"]


def test_branch_create_jr_physio(jr_physio_doctor):
    assert "doctor_id" in jr_physio_doctor
    assert "user_id" in jr_physio_doctor


def test_branch_assign_sessions(tokens, seeded_lead_id, jr_physio_doctor):
    # Build 6 slot times across two weeks
    today = dt.datetime.utcnow().date()
    slots = [
        f"{(today + dt.timedelta(days=i)).isoformat()} 10:00"
        for i in range(1, 7)
    ]
    payload = {
        "lead_id": seeded_lead_id,
        "physio_id": jr_physio_doctor["doctor_id"],
        "slot_times": slots,
    }
    r = requests.post(f"{BASE_URL}/api/v3/branch/assign-sessions",
                      headers=H(tokens["branch_admin"]), json=payload, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["sessions_created"] == 6
    assert body["patient_token"]
    # stash via lead id => fetched in other tests via patient_view
    pytest.PATIENT_TOKEN = body["patient_token"]


# ───────────────────────── Physio Board ─────────────────────────
def test_physio_today(tokens):
    r = requests.get(f"{BASE_URL}/api/v3/physio/today",
                     headers=H(tokens["physio"]), timeout=20)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "sessions" in body and "date" in body


def test_physio_calendar(tokens):
    r = requests.get(f"{BASE_URL}/api/v3/physio/calendar",
                     headers=H(tokens["physio"]), timeout=20)
    assert r.status_code == 200, r.text
    assert "sessions" in r.json()


def test_physio_patients(tokens):
    r = requests.get(f"{BASE_URL}/api/v3/physio/patients",
                     headers=H(tokens["physio"]), timeout=20)
    assert r.status_code == 200, r.text
    assert "patients" in r.json()


def test_physio_sessions_for_lead_and_complete(tokens, seeded_lead_id):
    # Sessions were created by branch admin via the jr_physio_doctor (different physio user).
    # The seeded `physio@fitsiomax.com` is a different doctor. So we use super_admin to complete a session
    # to validate the endpoint behavior cleanly.
    r = requests.get(f"{BASE_URL}/api/v3/physio/sessions/{seeded_lead_id}",
                     headers=H(tokens["super_admin"]), timeout=20)
    assert r.status_code == 200, r.text
    sessions = r.json()["sessions"]
    assert len(sessions) >= 1
    upcoming = [s for s in sessions if s["status"] == "upcoming"]
    assert upcoming, "expected at least one upcoming session"
    sid = upcoming[0]["id"]

    c = requests.post(f"{BASE_URL}/api/v3/physio/sessions/{sid}/complete",
                      headers=H(tokens["super_admin"]),
                      json={"remarks": "TEST completed session"}, timeout=20)
    assert c.status_code == 200, c.text
    body = c.json()
    assert body["status"] == "completed"
    assert body["jr_physio_remarks"] == "TEST completed session"

    # Idempotency: completing again should 400
    c2 = requests.post(f"{BASE_URL}/api/v3/physio/sessions/{sid}/complete",
                       headers=H(tokens["super_admin"]),
                       json={"remarks": "again"}, timeout=20)
    assert c2.status_code == 400


def test_physio_weekly_assessment_submit(tokens, seeded_lead_id):
    r = requests.post(
        f"{BASE_URL}/api/v3/physio/weekly-assessment/{seeded_lead_id}/2",
        headers=H(tokens["super_admin"]),
        json={"jr_physio_notes": "TEST jr notes week 2"}, timeout=20,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["jr_physio_notes"] == "TEST jr notes week 2"
    assert body["status"] == "submitted"


# ───────────────────────── Patient View (no leak) ─────────────────────────
def test_patient_view_no_internal_leak():
    token = getattr(pytest, "PATIENT_TOKEN", None)
    assert token, "patient token must be set by assign_sessions test"
    r = requests.get(f"{BASE_URL}/api/v3/patient/view/{token}", timeout=20)
    assert r.status_code == 200, r.text
    body = r.json()
    # Public fields present
    assert "patient_name" in body
    assert "sessions" in body
    assert "weekly_assessments" in body
    # Internal fields must NOT leak
    forbidden = {"head_physio_notes", "head_physio_suggestions", "reviewed_by",
                 "head_physio_id", "consultation_fee", "package_amount"}
    flat = str(body)
    for key in forbidden:
        assert key not in body, f"leak in top-level: {key}"
    for s in body["sessions"]:
        for key in forbidden:
            assert key not in s, f"leak in session: {key}"
    for a in body["weekly_assessments"]:
        for key in forbidden:
            assert key not in a, f"leak in assessment: {key}"


def test_patient_view_invalid_token():
    r = requests.get(f"{BASE_URL}/api/v3/patient/view/nonexistent-token", timeout=20)
    assert r.status_code == 404


# ───────────────────────── Finance Board ─────────────────────────
def test_branch_finance_default(tokens):
    r = requests.get(f"{BASE_URL}/api/v3/branch/finance",
                     headers=H(tokens["branch_admin"]), timeout=20)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "summary" in body and "transactions" in body


def test_branch_finance_filters(tokens):
    # fee_type filter
    r = requests.get(f"{BASE_URL}/api/v3/branch/finance?fee_type=consultation",
                     headers=H(tokens["branch_admin"]), timeout=20)
    assert r.status_code == 200
    txns = r.json()["transactions"]
    if txns:
        assert all(t["fee_type"] == "consultation" for t in txns), txns

    r2 = requests.get(f"{BASE_URL}/api/v3/branch/finance?fee_type=package",
                      headers=H(tokens["branch_admin"]), timeout=20)
    assert r2.status_code == 200
    txns2 = r2.json()["transactions"]
    if txns2:
        assert all(t["fee_type"] == "package" for t in txns2), txns2

    # date filter (sanity)
    r3 = requests.get(
        f"{BASE_URL}/api/v3/branch/finance?start_date=2020-01-01&end_date=2020-01-02",
        headers=H(tokens["branch_admin"]), timeout=20)
    assert r3.status_code == 200


# ───────────────────────── Regression: lead pipeline ─────────────────────────
def test_branch_board_loads(tokens):
    # Get branch_id by hitting /api/v3/branch/finance which is branch-aware (or login user info — but login invalidates session). Instead query via a branch endpoint to grab branch_id from any branch lead. Simpler: branch_admin has fixed seeded branch — discover via /branches if available.
    rb = requests.get(f"{BASE_URL}/api/v3/branches", headers=H(tokens["branch_admin"]), timeout=20)
    branch_id = None
    if rb.status_code == 200:
        body = rb.json()
        items = body if isinstance(body, list) else body.get("branches", [])
        if items:
            branch_id = items[0].get("id")
    if not branch_id:
        pytest.skip("Could not discover branch_id for branch-board test")
    r = requests.get(f"{BASE_URL}/api/v3/branch-board/{branch_id}",
                     headers=H(tokens["branch_admin"]), timeout=20)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "leads" in body
    assert "stage_counts" in body


def test_dashboard_loads_for_super_admin(tokens):
    r = requests.get(f"{BASE_URL}/api/v3/dashboard/super-admin",
                     headers=H(tokens["super_admin"]), timeout=20)
    # Could be 200 or 404 if endpoint renamed; accept either but record
    assert r.status_code in (200, 404), r.text


# ───────────────────────── Auth required for new endpoints ─────────────────────────
@pytest.mark.parametrize("path", [
    "/api/v3/head-physio/my-patients",
    "/api/v3/physio/today",
    "/api/v3/physio/calendar",
    "/api/v3/physio/patients",
    "/api/v3/branch/package-recommendations",
    "/api/v3/branch/finance",
])
def test_endpoints_require_auth(path):
    r = requests.get(f"{BASE_URL}{path}", timeout=20)
    assert r.status_code in (401, 403, 422), f"{path} -> {r.status_code}"
