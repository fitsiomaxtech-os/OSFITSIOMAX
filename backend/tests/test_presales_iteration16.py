"""
Backend API tests for Pre-sales Board - Iteration 16
Tests: Branch picker, Appointment booking flow, Move stage, Doctors endpoints
"""
import pytest
import requests
import os
from datetime import datetime, timedelta

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
PRESALES_EMAIL = "presales@fitsiomax.com"
PRESALES_PASSWORD = "presales123"
ADMIN_EMAIL = "fitsiomaxtech@gmail.com"
ADMIN_PASSWORD = "FitsioMax06"


class TestAuthAndSetup:
    """Authentication and setup tests"""
    
    def test_presales_login(self):
        """Test pre-sales user can login"""
        response = requests.post(f"{BASE_URL}/api/v3/auth/login", json={
            "email": PRESALES_EMAIL,
            "password": PRESALES_PASSWORD
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        assert "token" in data
        assert "user" in data
        assert data["user"]["role"] == "pre_sales"
        print(f"Pre-sales login successful: {data['user']['full_name']}")
        
    def test_admin_login(self):
        """Test admin user can login"""
        response = requests.post(f"{BASE_URL}/api/v3/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        assert "token" in data
        assert data["user"]["role"] == "super_admin"
        print(f"Admin login successful: {data['user']['full_name']}")


@pytest.fixture
def presales_token():
    """Get pre-sales auth token"""
    response = requests.post(f"{BASE_URL}/api/v3/auth/login", json={
        "email": PRESALES_EMAIL,
        "password": PRESALES_PASSWORD
    })
    if response.status_code == 200:
        return response.json()["token"]
    pytest.skip("Pre-sales authentication failed")


@pytest.fixture
def admin_token():
    """Get admin auth token"""
    response = requests.post(f"{BASE_URL}/api/v3/auth/login", json={
        "email": ADMIN_EMAIL,
        "password": ADMIN_PASSWORD
    })
    if response.status_code == 200:
        return response.json()["token"]
    pytest.skip("Admin authentication failed")


@pytest.fixture
def presales_headers(presales_token):
    """Headers with pre-sales auth"""
    return {"Authorization": f"Bearer {presales_token}", "Content-Type": "application/json"}


@pytest.fixture
def admin_headers(admin_token):
    """Headers with admin auth"""
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


class TestBranches:
    """Branch-related endpoint tests"""
    
    def test_get_branches(self, presales_headers):
        """Test GET /api/v3/branches returns branches list"""
        response = requests.get(f"{BASE_URL}/api/v3/branches", headers=presales_headers)
        assert response.status_code == 200, f"Get branches failed: {response.text}"
        data = response.json()
        assert isinstance(data, list)
        print(f"Found {len(data)} branches")
        if data:
            branch = data[0]
            assert "id" in branch
            assert "branch_name" in branch
            print(f"First branch: {branch['branch_name']}")


class TestLeads:
    """Lead-related endpoint tests"""
    
    def test_get_leads(self, presales_headers):
        """Test GET /api/v3/leads returns leads list"""
        response = requests.get(f"{BASE_URL}/api/v3/leads", headers=presales_headers)
        assert response.status_code == 200, f"Get leads failed: {response.text}"
        data = response.json()
        assert isinstance(data, list)
        print(f"Found {len(data)} leads")
        
    def test_create_lead_for_testing(self, presales_headers):
        """Create a test lead for branch assignment testing"""
        lead_data = {
            "name": "TEST_Iteration16_Lead",
            "phone": f"TEST16{datetime.now().strftime('%H%M%S')}",
            "email": "test16@example.com",
            "vertical": "offline_physiotherapy",
            "source_tab": "Manual",
            "source_type": "manual",
            "notes": "Test lead for iteration 16"
        }
        response = requests.post(f"{BASE_URL}/api/v3/leads/manual", json=lead_data, headers=presales_headers)
        assert response.status_code == 200, f"Create lead failed: {response.text}"
        data = response.json()
        assert data["name"] == lead_data["name"]
        assert data["stage"] == "New Lead"
        print(f"Created test lead: {data['id']}")
        return data["id"]


class TestMoveStage:
    """Move stage endpoint tests"""
    
    def test_move_stage_endpoint(self, presales_headers):
        """Test POST /api/v3/leads/{id}/move-stage works"""
        # First get a lead
        response = requests.get(f"{BASE_URL}/api/v3/leads", headers=presales_headers)
        assert response.status_code == 200
        leads = response.json()
        
        if not leads:
            pytest.skip("No leads available for testing")
            
        # Find a lead in New Lead stage
        test_lead = None
        for lead in leads:
            if lead["stage"] == "New Lead" and "TEST" in lead.get("name", ""):
                test_lead = lead
                break
        
        if not test_lead:
            test_lead = leads[0]
            
        lead_id = test_lead["id"]
        original_stage = test_lead["stage"]
        
        # Move to Pre-sales Qualified
        response = requests.post(
            f"{BASE_URL}/api/v3/leads/{lead_id}/move-stage",
            json={"stage": "Pre-sales Qualified"},
            headers=presales_headers
        )
        assert response.status_code == 200, f"Move stage failed: {response.text}"
        data = response.json()
        assert data["stage"] == "Pre-sales Qualified"
        print(f"Moved lead {lead_id} from {original_stage} to Pre-sales Qualified")
        
        # Move back to original stage
        requests.post(
            f"{BASE_URL}/api/v3/leads/{lead_id}/move-stage",
            json={"stage": original_stage},
            headers=presales_headers
        )


class TestAssignBranch:
    """Assign branch endpoint tests"""
    
    def test_assign_branch_endpoint(self, presales_headers):
        """Test POST /api/v3/leads/{id}/assign-branch works"""
        # Get branches
        branches_response = requests.get(f"{BASE_URL}/api/v3/branches", headers=presales_headers)
        assert branches_response.status_code == 200
        branches = branches_response.json()
        
        if not branches:
            pytest.skip("No branches available for testing")
            
        branch_id = branches[0]["id"]
        branch_name = branches[0]["branch_name"]
        
        # Get leads
        leads_response = requests.get(f"{BASE_URL}/api/v3/leads", headers=presales_headers)
        assert leads_response.status_code == 200
        leads = leads_response.json()
        
        if not leads:
            pytest.skip("No leads available for testing")
            
        # Find a lead without branch_id or create one
        test_lead = None
        for lead in leads:
            if not lead.get("branch_id") and "TEST" in lead.get("name", ""):
                test_lead = lead
                break
                
        if not test_lead:
            # Create a new test lead
            lead_data = {
                "name": f"TEST_Branch_Assign_{datetime.now().strftime('%H%M%S')}",
                "phone": f"TEST{datetime.now().strftime('%H%M%S')}",
                "email": "testbranch@example.com",
                "vertical": "offline_physiotherapy",
                "source_type": "manual"
            }
            create_response = requests.post(f"{BASE_URL}/api/v3/leads/manual", json=lead_data, headers=presales_headers)
            if create_response.status_code == 200:
                test_lead = create_response.json()
            else:
                pytest.skip("Could not create test lead")
        
        lead_id = test_lead["id"]
        
        # Assign to branch
        response = requests.post(
            f"{BASE_URL}/api/v3/leads/{lead_id}/assign-branch",
            json={"branch_id": branch_id},
            headers=presales_headers
        )
        assert response.status_code == 200, f"Assign branch failed: {response.text}"
        data = response.json()
        assert data["branch_id"] == branch_id
        assert data["stage"] == "Assigned to Branch"
        print(f"Assigned lead {lead_id} to branch {branch_name}")


class TestDoctors:
    """Doctor-related endpoint tests"""
    
    def test_get_doctors(self, presales_headers):
        """Test GET /api/v3/doctors returns doctors list"""
        response = requests.get(f"{BASE_URL}/api/v3/doctors", headers=presales_headers)
        assert response.status_code == 200, f"Get doctors failed: {response.text}"
        data = response.json()
        assert isinstance(data, list)
        print(f"Found {len(data)} doctors")
        if data:
            doctor = data[0]
            assert "id" in doctor
            assert "full_name" in doctor
            assert "slots" in doctor
            print(f"First doctor: {doctor['full_name']} with {len(doctor.get('slots', []))} slots")
            
    def test_get_doctors_by_branch(self, presales_headers):
        """Test GET /api/v3/doctors?branch_id=X returns filtered doctors"""
        # Get branches first
        branches_response = requests.get(f"{BASE_URL}/api/v3/branches", headers=presales_headers)
        if branches_response.status_code != 200:
            pytest.skip("Could not get branches")
            
        branches = branches_response.json()
        if not branches:
            pytest.skip("No branches available")
            
        branch_id = branches[0]["id"]
        
        response = requests.get(f"{BASE_URL}/api/v3/doctors?branch_id={branch_id}", headers=presales_headers)
        assert response.status_code == 200, f"Get doctors by branch failed: {response.text}"
        data = response.json()
        assert isinstance(data, list)
        print(f"Found {len(data)} doctors in branch {branches[0]['branch_name']}")
        
    def test_get_available_doctors(self, presales_headers):
        """Test GET /api/v3/doctors/available returns available doctors for a slot"""
        # Get branches first
        branches_response = requests.get(f"{BASE_URL}/api/v3/branches", headers=presales_headers)
        if branches_response.status_code != 200:
            pytest.skip("Could not get branches")
            
        branches = branches_response.json()
        if not branches:
            pytest.skip("No branches available")
            
        branch_id = branches[0]["id"]
        
        # Use a future slot time
        tomorrow = datetime.now() + timedelta(days=1)
        slot_time = tomorrow.replace(hour=10, minute=0, second=0, microsecond=0).isoformat()[:16]
        
        response = requests.get(
            f"{BASE_URL}/api/v3/doctors/available",
            params={"branch_id": branch_id, "slot_time": slot_time},
            headers=presales_headers
        )
        assert response.status_code == 200, f"Get available doctors failed: {response.text}"
        data = response.json()
        assert "available_doctors" in data
        print(f"Found {len(data['available_doctors'])} available doctors for slot {slot_time}")


class TestBookAppointment:
    """Book appointment endpoint tests"""
    
    def test_book_appointment_requires_auth(self):
        """Test book appointment requires authentication"""
        response = requests.post(
            f"{BASE_URL}/api/v3/leads/fake-id/book-appointment",
            json={"doctor_id": "fake", "slot_time": "2026-03-25T10:00"}
        )
        assert response.status_code == 401 or response.status_code == 422
        
    def test_book_appointment_endpoint_exists(self, admin_headers):
        """Test POST /api/v3/leads/{id}/book-appointment endpoint exists"""
        # Get a lead with branch_id
        leads_response = requests.get(f"{BASE_URL}/api/v3/leads", headers=admin_headers)
        assert leads_response.status_code == 200
        leads = leads_response.json()
        
        # Find a lead with branch_id
        test_lead = None
        for lead in leads:
            if lead.get("branch_id") and lead.get("stage") in ["Assigned to Branch", "Branch Confirmed"]:
                test_lead = lead
                break
                
        if not test_lead:
            pytest.skip("No lead with branch_id available for testing")
            
        lead_id = test_lead["id"]
        branch_id = test_lead["branch_id"]
        
        # Get doctors for this branch
        doctors_response = requests.get(f"{BASE_URL}/api/v3/doctors?branch_id={branch_id}", headers=admin_headers)
        if doctors_response.status_code != 200:
            pytest.skip("Could not get doctors")
            
        doctors = doctors_response.json()
        if not doctors:
            pytest.skip("No doctors in branch")
            
        doctor = doctors[0]
        doctor_id = doctor["id"]
        
        # Check if doctor has slots
        if not doctor.get("slots"):
            pytest.skip("Doctor has no slots configured")
            
        slot_time = doctor["slots"][0]
        
        # Try to book appointment
        response = requests.post(
            f"{BASE_URL}/api/v3/leads/{lead_id}/book-appointment",
            json={"doctor_id": doctor_id, "slot_time": slot_time},
            headers=admin_headers
        )
        # Could be 200 (success), 400 (slot unavailable), 409 (already booked), or 403 (permission)
        assert response.status_code in [200, 400, 403, 409], f"Unexpected status: {response.status_code} - {response.text}"
        print(f"Book appointment response: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            assert "id" in data
            assert data["lead_id"] == lead_id
            print(f"Successfully booked appointment: {data['id']}")


class TestMasterBoard:
    """Master board endpoint tests"""
    
    def test_get_master_board(self, presales_headers):
        """Test GET /api/v3/boards/master returns stage counts"""
        response = requests.get(f"{BASE_URL}/api/v3/boards/master", headers=presales_headers)
        assert response.status_code == 200, f"Get master board failed: {response.text}"
        data = response.json()
        assert "stage_counts" in data
        print(f"Master board stage counts: {data['stage_counts']}")


class TestLeadActivity:
    """Lead activity endpoint tests"""
    
    def test_get_lead_activity(self, presales_headers):
        """Test GET /api/v3/leads/{id}/activity returns activity log"""
        # Get a lead
        leads_response = requests.get(f"{BASE_URL}/api/v3/leads", headers=presales_headers)
        assert leads_response.status_code == 200
        leads = leads_response.json()
        
        if not leads:
            pytest.skip("No leads available")
            
        lead_id = leads[0]["id"]
        
        response = requests.get(f"{BASE_URL}/api/v3/leads/{lead_id}/activity", headers=presales_headers)
        assert response.status_code == 200, f"Get activity failed: {response.text}"
        data = response.json()
        assert isinstance(data, list)
        print(f"Found {len(data)} activity entries for lead {lead_id}")


class TestLeadRemarks:
    """Lead remarks endpoint tests"""
    
    def test_get_lead_remarks(self, presales_headers):
        """Test GET /api/v3/leads/{id}/remarks returns remarks"""
        leads_response = requests.get(f"{BASE_URL}/api/v3/leads", headers=presales_headers)
        assert leads_response.status_code == 200
        leads = leads_response.json()
        
        if not leads:
            pytest.skip("No leads available")
            
        lead_id = leads[0]["id"]
        
        response = requests.get(f"{BASE_URL}/api/v3/leads/{lead_id}/remarks", headers=presales_headers)
        assert response.status_code == 200, f"Get remarks failed: {response.text}"
        data = response.json()
        assert isinstance(data, list)
        print(f"Found {len(data)} remarks for lead {lead_id}")


class TestLeadFollowUps:
    """Lead follow-ups endpoint tests"""
    
    def test_get_lead_followups(self, presales_headers):
        """Test GET /api/v3/leads/{id}/follow-ups returns follow-ups"""
        leads_response = requests.get(f"{BASE_URL}/api/v3/leads", headers=presales_headers)
        assert leads_response.status_code == 200
        leads = leads_response.json()
        
        if not leads:
            pytest.skip("No leads available")
            
        lead_id = leads[0]["id"]
        
        response = requests.get(f"{BASE_URL}/api/v3/leads/{lead_id}/follow-ups", headers=presales_headers)
        assert response.status_code == 200, f"Get follow-ups failed: {response.text}"
        data = response.json()
        assert isinstance(data, list)
        print(f"Found {len(data)} follow-ups for lead {lead_id}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
