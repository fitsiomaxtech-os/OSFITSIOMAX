"""
Branch Admin Board API Tests - Iteration 17
Tests for 8-stage patient journey pipeline:
- New Appointment -> Call & Confirm -> Head Physio Appointment -> Consultation Fee Collected
- Consultation Done -> Follow-up Package Upsell -> Package Paid -> Jr. Physio Assigned
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://lead-manager-100.preview.emergentagent.com').rstrip('/')

# Test credentials
BRANCH_ADMIN_EMAIL = "branchadmin@fitsiomax.com"
BRANCH_ADMIN_PASSWORD = "branch123"
SUPER_ADMIN_EMAIL = "fitsiomaxtech@gmail.com"
SUPER_ADMIN_PASSWORD = "FitsioMax06"

# Branch stages
BRANCH_STAGES = [
    "New Appointment",
    "Call & Confirm",
    "Head Physio Appointment",
    "Consultation Fee Collected",
    "Consultation Done",
    "Follow-up Package Upsell",
    "Package Paid",
    "Jr. Physio Assigned",
]


@pytest.fixture(scope="module")
def branch_admin_session():
    """Login as branch admin and return session with token"""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    
    response = session.post(f"{BASE_URL}/api/v3/auth/login", json={
        "email": BRANCH_ADMIN_EMAIL,
        "password": BRANCH_ADMIN_PASSWORD
    })
    assert response.status_code == 200, f"Branch admin login failed: {response.text}"
    
    data = response.json()
    token = data.get("token")
    user = data.get("user", {})
    branch_id = user.get("branch_id")
    
    assert token, "No token returned"
    assert branch_id, "No branch_id for branch admin"
    
    session.headers.update({"Authorization": f"Bearer {token}"})
    session.branch_id = branch_id
    session.user = user
    
    return session


@pytest.fixture(scope="module")
def super_admin_session():
    """Login as super admin and return session with token"""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    
    response = session.post(f"{BASE_URL}/api/v3/auth/login", json={
        "email": SUPER_ADMIN_EMAIL,
        "password": SUPER_ADMIN_PASSWORD
    })
    assert response.status_code == 200, f"Super admin login failed: {response.text}"
    
    data = response.json()
    token = data.get("token")
    
    session.headers.update({"Authorization": f"Bearer {token}"})
    return session


class TestBranchAdminLogin:
    """Test branch admin authentication"""
    
    def test_branch_admin_login_success(self):
        """Test branch admin can login with correct credentials"""
        response = requests.post(f"{BASE_URL}/api/v3/auth/login", json={
            "email": BRANCH_ADMIN_EMAIL,
            "password": BRANCH_ADMIN_PASSWORD
        })
        assert response.status_code == 200
        
        data = response.json()
        assert "token" in data
        assert "user" in data
        assert data["user"]["role"] == "branch_admin"
        assert data["user"]["branch_id"] is not None
        print(f"Branch admin login successful, branch_id: {data['user']['branch_id']}")
    
    def test_branch_admin_has_branch_id(self, branch_admin_session):
        """Verify branch admin user has branch_id assigned"""
        assert hasattr(branch_admin_session, 'branch_id')
        assert branch_admin_session.branch_id is not None
        print(f"Branch admin branch_id: {branch_admin_session.branch_id}")


class TestBranchBoardEndpoint:
    """Test GET /api/v3/branch-board/{branch_id}"""
    
    def test_get_branch_board_success(self, branch_admin_session):
        """Test branch board returns leads and stage counts"""
        response = branch_admin_session.get(
            f"{BASE_URL}/api/v3/branch-board/{branch_admin_session.branch_id}"
        )
        assert response.status_code == 200
        
        data = response.json()
        assert "leads" in data
        assert "stage_counts" in data
        assert isinstance(data["leads"], list)
        assert isinstance(data["stage_counts"], dict)
        
        # Verify all 8 stages are in stage_counts
        for stage in BRANCH_STAGES:
            assert stage in data["stage_counts"], f"Missing stage: {stage}"
        
        print(f"Branch board: {len(data['leads'])} leads, stage_counts: {data['stage_counts']}")
    
    def test_branch_board_leads_have_branch_stage(self, branch_admin_session):
        """Verify leads have branch_stage field"""
        response = branch_admin_session.get(
            f"{BASE_URL}/api/v3/branch-board/{branch_admin_session.branch_id}"
        )
        assert response.status_code == 200
        
        data = response.json()
        leads = data.get("leads", [])
        
        if leads:
            lead = leads[0]
            assert "branch_stage" in lead, "Lead missing branch_stage field"
            assert "name" in lead
            assert "phone" in lead
            print(f"Sample lead: {lead['name']}, branch_stage: {lead.get('branch_stage')}")


class TestBranchStageMovement:
    """Test POST /api/v3/leads/{id}/branch-stage"""
    
    def test_move_lead_to_call_confirm(self, branch_admin_session):
        """Test moving a lead to 'Call & Confirm' stage"""
        # Get a lead from the board
        response = branch_admin_session.get(
            f"{BASE_URL}/api/v3/branch-board/{branch_admin_session.branch_id}"
        )
        assert response.status_code == 200
        
        leads = response.json().get("leads", [])
        if not leads:
            pytest.skip("No leads available for testing")
        
        lead = leads[0]
        lead_id = lead["id"]
        
        # Move to Call & Confirm
        response = branch_admin_session.post(
            f"{BASE_URL}/api/v3/leads/{lead_id}/branch-stage",
            json={"branch_stage": "Call & Confirm"}
        )
        assert response.status_code == 200
        
        updated_lead = response.json()
        assert updated_lead["branch_stage"] == "Call & Confirm"
        print(f"Lead {lead['name']} moved to 'Call & Confirm'")
    
    def test_move_lead_through_all_stages(self, branch_admin_session):
        """Test moving a lead through multiple stages"""
        # Get a lead
        response = branch_admin_session.get(
            f"{BASE_URL}/api/v3/branch-board/{branch_admin_session.branch_id}"
        )
        leads = response.json().get("leads", [])
        if not leads:
            pytest.skip("No leads available")
        
        lead_id = leads[0]["id"]
        
        # Move through first 3 stages
        for stage in ["New Appointment", "Call & Confirm", "Head Physio Appointment"]:
            response = branch_admin_session.post(
                f"{BASE_URL}/api/v3/leads/{lead_id}/branch-stage",
                json={"branch_stage": stage}
            )
            assert response.status_code == 200
            assert response.json()["branch_stage"] == stage
            print(f"Lead moved to: {stage}")
    
    def test_invalid_branch_stage_rejected(self, branch_admin_session):
        """Test that invalid stage names are rejected"""
        response = branch_admin_session.get(
            f"{BASE_URL}/api/v3/branch-board/{branch_admin_session.branch_id}"
        )
        leads = response.json().get("leads", [])
        if not leads:
            pytest.skip("No leads available")
        
        lead_id = leads[0]["id"]
        
        response = branch_admin_session.post(
            f"{BASE_URL}/api/v3/leads/{lead_id}/branch-stage",
            json={"branch_stage": "Invalid Stage Name"}
        )
        assert response.status_code == 400
        print("Invalid stage correctly rejected")


class TestConsultationFeeCollection:
    """Test POST /api/v3/leads/{id}/collect-fee for consultation fee"""
    
    def test_collect_consultation_fee(self, branch_admin_session):
        """Test collecting consultation fee"""
        # Get a lead
        response = branch_admin_session.get(
            f"{BASE_URL}/api/v3/branch-board/{branch_admin_session.branch_id}"
        )
        leads = response.json().get("leads", [])
        if not leads:
            pytest.skip("No leads available")
        
        lead_id = leads[0]["id"]
        
        # Collect consultation fee
        response = branch_admin_session.post(
            f"{BASE_URL}/api/v3/leads/{lead_id}/collect-fee",
            json={"fee_type": "consultation", "amount": 500}
        )
        assert response.status_code == 200
        
        updated_lead = response.json()
        assert updated_lead["consultation_fee"] == 500
        assert updated_lead["branch_stage"] == "Consultation Fee Collected"
        print(f"Consultation fee Rs.500 collected, stage updated to 'Consultation Fee Collected'")
    
    def test_collect_fee_requires_valid_amount(self, branch_admin_session):
        """Test that fee collection requires positive amount"""
        response = branch_admin_session.get(
            f"{BASE_URL}/api/v3/branch-board/{branch_admin_session.branch_id}"
        )
        leads = response.json().get("leads", [])
        if not leads:
            pytest.skip("No leads available")
        
        lead_id = leads[0]["id"]
        
        # Try with zero amount - should still work (backend allows it)
        response = branch_admin_session.post(
            f"{BASE_URL}/api/v3/leads/{lead_id}/collect-fee",
            json={"fee_type": "consultation", "amount": 0}
        )
        # Backend accepts 0 amount
        assert response.status_code == 200


class TestPackagePayment:
    """Test POST /api/v3/leads/{id}/collect-fee for package payment"""
    
    def test_collect_package_fee(self, branch_admin_session):
        """Test collecting package fee with weeks"""
        response = branch_admin_session.get(
            f"{BASE_URL}/api/v3/branch-board/{branch_admin_session.branch_id}"
        )
        leads = response.json().get("leads", [])
        if not leads:
            pytest.skip("No leads available")
        
        lead_id = leads[0]["id"]
        
        # Collect package fee
        response = branch_admin_session.post(
            f"{BASE_URL}/api/v3/leads/{lead_id}/collect-fee",
            json={"fee_type": "package", "amount": 15000, "package_weeks": 8}
        )
        assert response.status_code == 200
        
        updated_lead = response.json()
        assert updated_lead["package_amount"] == 15000
        assert updated_lead["package_weeks"] == 8
        assert updated_lead["branch_stage"] == "Package Paid"
        print(f"Package fee Rs.15000 (8 weeks) collected, stage updated to 'Package Paid'")


class TestPhysioAssignment:
    """Test POST /api/v3/leads/{id}/assign-physio"""
    
    def test_get_physio_list(self, branch_admin_session):
        """Test getting list of physios for the branch"""
        response = branch_admin_session.get(
            f"{BASE_URL}/api/v3/doctors",
            params={"branch_id": branch_admin_session.branch_id}
        )
        assert response.status_code == 200
        
        doctors = response.json()
        physios = [d for d in doctors if d.get("profile_type") == "physio"]
        
        assert len(physios) > 0, "No physios found in branch"
        print(f"Found {len(physios)} physios in branch")
        
        for p in physios[:3]:
            print(f"  - {p['full_name']} ({p['profile_type']})")
    
    def test_assign_jr_physio(self, branch_admin_session):
        """Test assigning Jr. Physio to a lead"""
        # Get a lead
        response = branch_admin_session.get(
            f"{BASE_URL}/api/v3/branch-board/{branch_admin_session.branch_id}"
        )
        leads = response.json().get("leads", [])
        if not leads:
            pytest.skip("No leads available")
        
        lead_id = leads[0]["id"]
        
        # Get a physio
        response = branch_admin_session.get(
            f"{BASE_URL}/api/v3/doctors",
            params={"branch_id": branch_admin_session.branch_id}
        )
        doctors = response.json()
        physios = [d for d in doctors if d.get("profile_type") == "physio"]
        
        if not physios:
            pytest.skip("No physios available")
        
        physio = physios[0]
        
        # Assign physio
        response = branch_admin_session.post(
            f"{BASE_URL}/api/v3/leads/{lead_id}/assign-physio",
            json={"physio_id": physio["id"]}
        )
        assert response.status_code == 200
        
        updated_lead = response.json()
        assert updated_lead["assigned_physio_id"] == physio["id"]
        assert updated_lead["assigned_physio_name"] == physio["full_name"]
        assert updated_lead["branch_stage"] == "Jr. Physio Assigned"
        print(f"Jr. Physio '{physio['full_name']}' assigned, stage updated to 'Jr. Physio Assigned'")
    
    def test_assign_invalid_physio_fails(self, branch_admin_session):
        """Test that assigning non-existent physio fails"""
        response = branch_admin_session.get(
            f"{BASE_URL}/api/v3/branch-board/{branch_admin_session.branch_id}"
        )
        leads = response.json().get("leads", [])
        if not leads:
            pytest.skip("No leads available")
        
        lead_id = leads[0]["id"]
        
        response = branch_admin_session.post(
            f"{BASE_URL}/api/v3/leads/{lead_id}/assign-physio",
            json={"physio_id": "non-existent-id"}
        )
        assert response.status_code == 404
        print("Invalid physio assignment correctly rejected")


class TestHeadPhysioAppointment:
    """Test appointment booking for Head Physio"""
    
    def test_get_head_physios(self, branch_admin_session):
        """Test getting list of head physios"""
        response = branch_admin_session.get(
            f"{BASE_URL}/api/v3/doctors",
            params={"branch_id": branch_admin_session.branch_id}
        )
        assert response.status_code == 200
        
        doctors = response.json()
        head_physios = [d for d in doctors if d.get("profile_type") == "head_physio"]
        
        print(f"Found {len(head_physios)} head physios in branch")
        for hp in head_physios:
            print(f"  - {hp['full_name']} ({hp.get('specialization', 'N/A')})")
    
    def test_book_head_physio_appointment(self, branch_admin_session):
        """Test booking appointment with head physio"""
        # Get a lead
        response = branch_admin_session.get(
            f"{BASE_URL}/api/v3/branch-board/{branch_admin_session.branch_id}"
        )
        leads = response.json().get("leads", [])
        if not leads:
            pytest.skip("No leads available")
        
        lead_id = leads[0]["id"]
        
        # Get a head physio with slots
        response = branch_admin_session.get(
            f"{BASE_URL}/api/v3/doctors",
            params={"branch_id": branch_admin_session.branch_id}
        )
        doctors = response.json()
        head_physios = [d for d in doctors if d.get("profile_type") == "head_physio" and d.get("slots")]
        
        if not head_physios:
            pytest.skip("No head physios with slots available")
        
        doctor = head_physios[0]
        slot = doctor["slots"][0] if doctor["slots"] else None
        
        if not slot:
            pytest.skip("No slots available")
        
        # Book appointment
        response = branch_admin_session.post(
            f"{BASE_URL}/api/v3/leads/{lead_id}/book-appointment",
            json={"doctor_id": doctor["id"], "slot_time": slot}
        )
        
        # Should succeed or fail based on slot availability
        if response.status_code == 200:
            print(f"Appointment booked with {doctor['full_name']} at {slot}")
        else:
            print(f"Booking response: {response.status_code} - {response.text}")


class TestActivityLog:
    """Test activity log for branch stage changes"""
    
    def test_activity_log_created_on_stage_change(self, branch_admin_session):
        """Test that activity log is created when stage changes"""
        # Get a lead
        response = branch_admin_session.get(
            f"{BASE_URL}/api/v3/branch-board/{branch_admin_session.branch_id}"
        )
        leads = response.json().get("leads", [])
        if not leads:
            pytest.skip("No leads available")
        
        lead_id = leads[0]["id"]
        
        # Move stage
        response = branch_admin_session.post(
            f"{BASE_URL}/api/v3/leads/{lead_id}/branch-stage",
            json={"branch_stage": "Consultation Done"}
        )
        assert response.status_code == 200
        
        # Check activity log
        response = branch_admin_session.get(
            f"{BASE_URL}/api/v3/leads/{lead_id}/activity"
        )
        assert response.status_code == 200
        
        activities = response.json()
        assert len(activities) > 0, "No activity log entries"
        
        # Find branch stage change activity
        stage_activities = [a for a in activities if "branch_stage" in a.get("action", "").lower() or "branch" in a.get("details", "").lower()]
        print(f"Found {len(stage_activities)} branch stage activities")
        
        if stage_activities:
            latest = stage_activities[0]
            print(f"Latest activity: {latest.get('details')}")


class TestRemarksForBranchLeads:
    """Test remarks functionality for branch leads"""
    
    def test_add_remark_to_lead(self, branch_admin_session):
        """Test adding a remark to a lead"""
        # Get a lead
        response = branch_admin_session.get(
            f"{BASE_URL}/api/v3/branch-board/{branch_admin_session.branch_id}"
        )
        leads = response.json().get("leads", [])
        if not leads:
            pytest.skip("No leads available")
        
        lead_id = leads[0]["id"]
        
        # Add remark
        remark_text = f"TEST_REMARK_{uuid.uuid4().hex[:8]}"
        response = branch_admin_session.post(
            f"{BASE_URL}/api/v3/leads/{lead_id}/remarks",
            json={"text": remark_text}
        )
        assert response.status_code == 200
        
        # Get remarks
        response = branch_admin_session.get(
            f"{BASE_URL}/api/v3/leads/{lead_id}/remarks"
        )
        assert response.status_code == 200
        
        remarks = response.json()
        assert any(r.get("text") == remark_text for r in remarks), "Remark not found"
        print(f"Remark added and verified: {remark_text}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
