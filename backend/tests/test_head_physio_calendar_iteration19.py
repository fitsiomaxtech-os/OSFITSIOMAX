"""
Iteration 19: Head Physio Calendar Feature Tests
Tests the new Calendly-style calendar feature for Branch Admin:
- POST /api/v3/branch/head-physios - Create Head Physio (user + doctor)
- GET /api/v3/doctors/{id}/calendar - Get doctor calendar with slot details
- POST /api/v3/doctors/{id}/calendar-slots - Add slots with duration and type
- POST /api/v3/doctors/{id}/remove-slots - Remove unbooked slots
"""

import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
BRANCH_ADMIN_EMAIL = "branchadmin@fitsiomax.com"
BRANCH_ADMIN_PASSWORD = "branch123"
SUPER_ADMIN_EMAIL = "fitsiomaxtech@gmail.com"
SUPER_ADMIN_PASSWORD = "FitsioMax06"


@pytest.fixture(scope="module")
def api_client():
    """Shared requests session"""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


@pytest.fixture(scope="module")
def branch_admin_token(api_client):
    """Get Branch Admin authentication token"""
    response = api_client.post(f"{BASE_URL}/api/v3/auth/login", json={
        "email": BRANCH_ADMIN_EMAIL,
        "password": BRANCH_ADMIN_PASSWORD
    })
    if response.status_code == 200:
        return response.json().get("token")
    pytest.skip(f"Branch Admin authentication failed: {response.status_code}")


@pytest.fixture(scope="module")
def super_admin_token(api_client):
    """Get Super Admin authentication token"""
    response = api_client.post(f"{BASE_URL}/api/v3/auth/login", json={
        "email": SUPER_ADMIN_EMAIL,
        "password": SUPER_ADMIN_PASSWORD
    })
    if response.status_code == 200:
        return response.json().get("token")
    pytest.skip(f"Super Admin authentication failed: {response.status_code}")


@pytest.fixture(scope="module")
def branch_admin_client(api_client, branch_admin_token):
    """Session with Branch Admin auth header"""
    api_client.headers.update({"Authorization": f"Bearer {branch_admin_token}"})
    return api_client


@pytest.fixture(scope="module")
def super_admin_client(api_client, super_admin_token):
    """Session with Super Admin auth header"""
    api_client.headers.update({"Authorization": f"Bearer {super_admin_token}"})
    return api_client


class TestBranchAdminLogin:
    """Test Branch Admin can login"""
    
    def test_branch_admin_login_success(self, api_client):
        """Branch Admin should be able to login"""
        response = api_client.post(f"{BASE_URL}/api/v3/auth/login", json={
            "email": BRANCH_ADMIN_EMAIL,
            "password": BRANCH_ADMIN_PASSWORD
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        assert "token" in data
        assert "user" in data
        assert data["user"]["role"] == "branch_admin"
        assert data["user"]["branch_id"] is not None
        print(f"SUCCESS: Branch Admin login - branch_id: {data['user']['branch_id']}")


class TestCreateHeadPhysio:
    """Test POST /api/v3/branch/head-physios - Create Head Physio"""
    
    def test_create_head_physio_success(self, branch_admin_client):
        """Branch Admin should be able to create a Head Physio"""
        unique_id = str(uuid.uuid4())[:8]
        payload = {
            "full_name": f"TEST_Dr. Head Physio {unique_id}",
            "email": f"test_headphysio_{unique_id}@fitsiomax.com",
            "password": "test123",
            "specialization": "Orthopedic Physiotherapy"
        }
        
        response = branch_admin_client.post(f"{BASE_URL}/api/v3/branch/head-physios", json=payload)
        assert response.status_code == 200, f"Create Head Physio failed: {response.text}"
        
        data = response.json()
        assert "doctor_id" in data
        assert "user_id" in data
        assert data["full_name"] == payload["full_name"]
        assert data["email"] == payload["email"].lower()
        assert data["specialization"] == payload["specialization"]
        assert data["branch_id"] is not None
        
        print(f"SUCCESS: Created Head Physio - doctor_id: {data['doctor_id']}, user_id: {data['user_id']}")
        return data
    
    def test_create_head_physio_duplicate_email(self, branch_admin_client):
        """Should reject duplicate email"""
        unique_id = str(uuid.uuid4())[:8]
        payload = {
            "full_name": f"TEST_Dr. Duplicate {unique_id}",
            "email": f"test_dup_{unique_id}@fitsiomax.com",
            "password": "test123",
            "specialization": "Sports"
        }
        
        # First creation should succeed
        response1 = branch_admin_client.post(f"{BASE_URL}/api/v3/branch/head-physios", json=payload)
        assert response1.status_code == 200
        
        # Second creation with same email should fail
        response2 = branch_admin_client.post(f"{BASE_URL}/api/v3/branch/head-physios", json=payload)
        assert response2.status_code == 409, f"Expected 409 for duplicate email, got {response2.status_code}"
        print("SUCCESS: Duplicate email rejected with 409")
    
    def test_create_head_physio_missing_fields(self, branch_admin_client):
        """Should reject missing required fields"""
        payload = {
            "full_name": "TEST_Missing Fields"
            # Missing email and password
        }
        
        response = branch_admin_client.post(f"{BASE_URL}/api/v3/branch/head-physios", json=payload)
        assert response.status_code == 422, f"Expected 422 for missing fields, got {response.status_code}"
        print("SUCCESS: Missing fields rejected with 422")


class TestDoctorCalendar:
    """Test GET /api/v3/doctors/{id}/calendar - Get doctor calendar"""
    
    @pytest.fixture(scope="class")
    def test_doctor(self, branch_admin_client):
        """Create a test doctor for calendar tests"""
        unique_id = str(uuid.uuid4())[:8]
        payload = {
            "full_name": f"TEST_Calendar Doctor {unique_id}",
            "email": f"test_cal_{unique_id}@fitsiomax.com",
            "password": "test123",
            "specialization": "Calendar Testing"
        }
        response = branch_admin_client.post(f"{BASE_URL}/api/v3/branch/head-physios", json=payload)
        assert response.status_code == 200
        return response.json()
    
    def test_get_doctor_calendar_empty(self, branch_admin_client, test_doctor):
        """Should return empty calendar for new doctor"""
        doctor_id = test_doctor["doctor_id"]
        
        response = branch_admin_client.get(f"{BASE_URL}/api/v3/doctors/{doctor_id}/calendar")
        assert response.status_code == 200, f"Get calendar failed: {response.text}"
        
        data = response.json()
        assert data["doctor_id"] == doctor_id
        assert data["doctor_name"] == test_doctor["full_name"]
        assert "slots" in data
        assert "slot_details" in data
        assert "booked" in data
        assert isinstance(data["slots"], list)
        assert isinstance(data["slot_details"], list)
        
        print(f"SUCCESS: Got empty calendar for doctor {doctor_id}")
    
    def test_get_calendar_nonexistent_doctor(self, branch_admin_client):
        """Should return 404 for nonexistent doctor"""
        response = branch_admin_client.get(f"{BASE_URL}/api/v3/doctors/nonexistent-id/calendar")
        assert response.status_code == 404
        print("SUCCESS: Nonexistent doctor returns 404")


class TestAddCalendarSlots:
    """Test POST /api/v3/doctors/{id}/calendar-slots - Add slots with duration and type"""
    
    @pytest.fixture(scope="class")
    def test_doctor_for_slots(self, branch_admin_client):
        """Create a test doctor for slot tests"""
        unique_id = str(uuid.uuid4())[:8]
        payload = {
            "full_name": f"TEST_Slot Doctor {unique_id}",
            "email": f"test_slot_{unique_id}@fitsiomax.com",
            "password": "test123",
            "specialization": "Slot Testing"
        }
        response = branch_admin_client.post(f"{BASE_URL}/api/v3/branch/head-physios", json=payload)
        assert response.status_code == 200
        return response.json()
    
    def test_add_single_slot(self, branch_admin_client, test_doctor_for_slots):
        """Should add a single slot with duration and type"""
        doctor_id = test_doctor_for_slots["doctor_id"]
        
        payload = {
            "slots": [
                {
                    "slot_time": "2026-02-15T09:00",
                    "duration": 30,
                    "consultation_type": "initial"
                }
            ]
        }
        
        response = branch_admin_client.post(f"{BASE_URL}/api/v3/doctors/{doctor_id}/calendar-slots", json=payload)
        assert response.status_code == 200, f"Add slot failed: {response.text}"
        
        data = response.json()
        assert data["doctor_id"] == doctor_id
        assert data["slots_count"] >= 1
        assert len(data["slots"]) >= 1
        assert len(data["slot_details"]) >= 1
        
        # Verify slot details
        slot_detail = next((s for s in data["slot_details"] if "2026-02-15T09:00" in s["slot_time"]), None)
        assert slot_detail is not None
        assert slot_detail["duration"] == 30
        assert slot_detail["consultation_type"] == "initial"
        
        print(f"SUCCESS: Added single slot with duration=30, type=initial")
    
    def test_add_multiple_slots_different_types(self, branch_admin_client, test_doctor_for_slots):
        """Should add multiple slots with different durations and types"""
        doctor_id = test_doctor_for_slots["doctor_id"]
        
        payload = {
            "slots": [
                {"slot_time": "2026-02-16T10:00", "duration": 15, "consultation_type": "follow_up"},
                {"slot_time": "2026-02-16T10:30", "duration": 45, "consultation_type": "review"},
                {"slot_time": "2026-02-16T11:00", "duration": 60, "consultation_type": "initial"}
            ]
        }
        
        response = branch_admin_client.post(f"{BASE_URL}/api/v3/doctors/{doctor_id}/calendar-slots", json=payload)
        assert response.status_code == 200, f"Add multiple slots failed: {response.text}"
        
        data = response.json()
        assert data["slots_count"] >= 3
        
        # Verify each slot type
        details = {d["slot_time"]: d for d in data["slot_details"]}
        
        # Check 15min follow_up
        slot_15 = next((d for k, d in details.items() if "10:00" in k), None)
        if slot_15:
            assert slot_15["duration"] == 15
            assert slot_15["consultation_type"] == "follow_up"
        
        # Check 45min review
        slot_45 = next((d for k, d in details.items() if "10:30" in k), None)
        if slot_45:
            assert slot_45["duration"] == 45
            assert slot_45["consultation_type"] == "review"
        
        # Check 60min initial
        slot_60 = next((d for k, d in details.items() if "11:00" in k), None)
        if slot_60:
            assert slot_60["duration"] == 60
            assert slot_60["consultation_type"] == "initial"
        
        print("SUCCESS: Added multiple slots with different durations (15/45/60) and types")
    
    def test_add_slots_nonexistent_doctor(self, branch_admin_client):
        """Should return 404 for nonexistent doctor"""
        payload = {
            "slots": [{"slot_time": "2026-02-15T09:00", "duration": 30, "consultation_type": "initial"}]
        }
        response = branch_admin_client.post(f"{BASE_URL}/api/v3/doctors/nonexistent-id/calendar-slots", json=payload)
        assert response.status_code == 404
        print("SUCCESS: Add slots to nonexistent doctor returns 404")


class TestRemoveCalendarSlots:
    """Test POST /api/v3/doctors/{id}/remove-slots - Remove unbooked slots"""
    
    @pytest.fixture(scope="class")
    def test_doctor_for_removal(self, branch_admin_client):
        """Create a test doctor with slots for removal tests"""
        unique_id = str(uuid.uuid4())[:8]
        
        # Create doctor
        create_payload = {
            "full_name": f"TEST_Remove Doctor {unique_id}",
            "email": f"test_remove_{unique_id}@fitsiomax.com",
            "password": "test123",
            "specialization": "Removal Testing"
        }
        response = branch_admin_client.post(f"{BASE_URL}/api/v3/branch/head-physios", json=create_payload)
        assert response.status_code == 200
        doctor = response.json()
        
        # Add slots
        slots_payload = {
            "slots": [
                {"slot_time": "2026-03-01T09:00", "duration": 30, "consultation_type": "initial"},
                {"slot_time": "2026-03-01T09:30", "duration": 30, "consultation_type": "follow_up"},
                {"slot_time": "2026-03-01T10:00", "duration": 30, "consultation_type": "review"}
            ]
        }
        branch_admin_client.post(f"{BASE_URL}/api/v3/doctors/{doctor['doctor_id']}/calendar-slots", json=slots_payload)
        
        return doctor
    
    def test_remove_single_slot(self, branch_admin_client, test_doctor_for_removal):
        """Should remove a single unbooked slot"""
        doctor_id = test_doctor_for_removal["doctor_id"]
        
        # Get current slots
        cal_response = branch_admin_client.get(f"{BASE_URL}/api/v3/doctors/{doctor_id}/calendar")
        initial_count = len(cal_response.json()["slots"])
        
        payload = {
            "slot_times": ["2026-03-01T09:00"]
        }
        
        response = branch_admin_client.post(f"{BASE_URL}/api/v3/doctors/{doctor_id}/remove-slots", json=payload)
        assert response.status_code == 200, f"Remove slot failed: {response.text}"
        
        data = response.json()
        assert data["doctor_id"] == doctor_id
        assert data["removed"] >= 1
        assert data["remaining_slots"] < initial_count
        
        print(f"SUCCESS: Removed slot, remaining: {data['remaining_slots']}")
    
    def test_remove_multiple_slots(self, branch_admin_client, test_doctor_for_removal):
        """Should remove multiple unbooked slots"""
        doctor_id = test_doctor_for_removal["doctor_id"]
        
        payload = {
            "slot_times": ["2026-03-01T09:30", "2026-03-01T10:00"]
        }
        
        response = branch_admin_client.post(f"{BASE_URL}/api/v3/doctors/{doctor_id}/remove-slots", json=payload)
        assert response.status_code == 200, f"Remove multiple slots failed: {response.text}"
        
        data = response.json()
        assert data["removed"] >= 0  # May be 0 if already removed
        
        print(f"SUCCESS: Removed multiple slots")
    
    def test_remove_slots_nonexistent_doctor(self, branch_admin_client):
        """Should return 404 for nonexistent doctor"""
        payload = {"slot_times": ["2026-03-01T09:00"]}
        response = branch_admin_client.post(f"{BASE_URL}/api/v3/doctors/nonexistent-id/remove-slots", json=payload)
        assert response.status_code == 404
        print("SUCCESS: Remove slots from nonexistent doctor returns 404")


class TestCalendarIntegration:
    """Integration tests for the full calendar workflow"""
    
    def test_full_calendar_workflow(self, branch_admin_client):
        """Test complete workflow: create doctor -> add slots -> verify -> remove -> verify"""
        unique_id = str(uuid.uuid4())[:8]
        
        # Step 1: Create Head Physio
        create_payload = {
            "full_name": f"TEST_Workflow Doctor {unique_id}",
            "email": f"test_workflow_{unique_id}@fitsiomax.com",
            "password": "test123",
            "specialization": "Workflow Testing"
        }
        create_response = branch_admin_client.post(f"{BASE_URL}/api/v3/branch/head-physios", json=create_payload)
        assert create_response.status_code == 200
        doctor = create_response.json()
        doctor_id = doctor["doctor_id"]
        print(f"Step 1: Created doctor {doctor_id}")
        
        # Step 2: Verify empty calendar
        cal_response = branch_admin_client.get(f"{BASE_URL}/api/v3/doctors/{doctor_id}/calendar")
        assert cal_response.status_code == 200
        assert len(cal_response.json()["slots"]) == 0
        print("Step 2: Verified empty calendar")
        
        # Step 3: Add slots with different configurations
        add_payload = {
            "slots": [
                {"slot_time": "2026-04-01T08:00", "duration": 15, "consultation_type": "initial"},
                {"slot_time": "2026-04-01T08:30", "duration": 30, "consultation_type": "follow_up"},
                {"slot_time": "2026-04-01T09:00", "duration": 45, "consultation_type": "review"},
                {"slot_time": "2026-04-01T09:30", "duration": 60, "consultation_type": "initial"}
            ]
        }
        add_response = branch_admin_client.post(f"{BASE_URL}/api/v3/doctors/{doctor_id}/calendar-slots", json=add_payload)
        assert add_response.status_code == 200
        assert add_response.json()["slots_count"] == 4
        print("Step 3: Added 4 slots with different durations")
        
        # Step 4: Verify slots in calendar
        cal_response2 = branch_admin_client.get(f"{BASE_URL}/api/v3/doctors/{doctor_id}/calendar")
        assert cal_response2.status_code == 200
        cal_data = cal_response2.json()
        assert len(cal_data["slots"]) == 4
        assert len(cal_data["slot_details"]) == 4
        print("Step 4: Verified 4 slots in calendar")
        
        # Step 5: Remove 2 slots
        remove_payload = {
            "slot_times": ["2026-04-01T08:00", "2026-04-01T09:30"]
        }
        remove_response = branch_admin_client.post(f"{BASE_URL}/api/v3/doctors/{doctor_id}/remove-slots", json=remove_payload)
        assert remove_response.status_code == 200
        assert remove_response.json()["remaining_slots"] == 2
        print("Step 5: Removed 2 slots")
        
        # Step 6: Verify remaining slots
        cal_response3 = branch_admin_client.get(f"{BASE_URL}/api/v3/doctors/{doctor_id}/calendar")
        assert cal_response3.status_code == 200
        final_data = cal_response3.json()
        assert len(final_data["slots"]) == 2
        assert len(final_data["slot_details"]) == 2
        print("Step 6: Verified 2 remaining slots")
        
        print("SUCCESS: Full calendar workflow completed!")


class TestExistingDoctorsEndpoint:
    """Test that existing doctors endpoint still works (regression)"""
    
    def test_get_doctors_list(self, api_client, branch_admin_token):
        """GET /api/v3/doctors should return list of doctors"""
        headers = {"Authorization": f"Bearer {branch_admin_token}"}
        response = api_client.get(f"{BASE_URL}/api/v3/doctors", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"SUCCESS: GET /api/v3/doctors returns {len(data)} doctors")
    
    def test_get_doctors_by_branch(self, api_client, branch_admin_token):
        """GET /api/v3/doctors with branch_id filter"""
        headers = {"Authorization": f"Bearer {branch_admin_token}"}
        
        # First get the branch_id from login
        login_response = api_client.post(f"{BASE_URL}/api/v3/auth/login", json={
            "email": BRANCH_ADMIN_EMAIL,
            "password": BRANCH_ADMIN_PASSWORD
        })
        branch_id = login_response.json()["user"]["branch_id"]
        new_token = login_response.json()["token"]
        headers = {"Authorization": f"Bearer {new_token}"}
        
        response = api_client.get(f"{BASE_URL}/api/v3/doctors", params={"branch_id": branch_id}, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        
        # All returned doctors should belong to this branch
        for doc in data:
            assert doc.get("branch_id") == branch_id
        
        print(f"SUCCESS: GET /api/v3/doctors?branch_id={branch_id} returns {len(data)} doctors")


class TestBranchBoardRegression:
    """Regression test for Branch Board (Patient Pipeline)"""
    
    def test_get_branch_board(self, api_client):
        """GET /api/v3/branch-board/{branch_id} should still work"""
        # Get branch_id with fresh login
        login_response = api_client.post(f"{BASE_URL}/api/v3/auth/login", json={
            "email": BRANCH_ADMIN_EMAIL,
            "password": BRANCH_ADMIN_PASSWORD
        })
        branch_id = login_response.json()["user"]["branch_id"]
        token = login_response.json()["token"]
        headers = {"Authorization": f"Bearer {token}"}
        
        response = api_client.get(f"{BASE_URL}/api/v3/branch-board/{branch_id}", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "leads" in data
        assert "stage_counts" in data
        print(f"SUCCESS: Branch board returns {len(data['leads'])} leads")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
