"""
V3 API Regression Tests - Post-Refactoring
Tests all V3 endpoints after backend modularization from monolithic server.py
"""
import pytest
import requests
import os
import uuid
from datetime import datetime, timezone, timedelta

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Demo users credentials
DEMO_USERS = [
    {"email": "fitsiomaxtech@gmail.com", "password": "FitsioMax06", "role": "super_admin"},
    {"email": "businessdev@fitsiomax.com", "password": "bd123", "role": "business_dev"},
    {"email": "presales@fitsiomax.com", "password": "presales123", "role": "pre_sales"},
    {"email": "branchadmin@fitsiomax.com", "password": "branch123", "role": "branch_admin"},
    {"email": "headphysio@fitsiomax.com", "password": "head123", "role": "head_physio"},
    {"email": "physio@fitsiomax.com", "password": "physio123", "role": "physio"},
]


class TestV3Root:
    """Test V3 API root endpoint"""
    
    def test_v3_root(self):
        response = requests.get(f"{BASE_URL}/api/v3/")
        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        assert "FITSIOMAX" in data["message"]
        print(f"✓ V3 root endpoint working: {data['message']}")


class TestV3AuthLogin:
    """Test all 6 demo user logins - critical regression test for bcrypt password hashing"""
    
    @pytest.mark.parametrize("user", DEMO_USERS)
    def test_demo_user_login(self, user):
        """Test each demo user can login with their credentials"""
        response = requests.post(f"{BASE_URL}/api/v3/auth/login", json={
            "email": user["email"],
            "password": user["password"]
        })
        assert response.status_code == 200, f"Login failed for {user['email']}: {response.text}"
        
        data = response.json()
        assert "token" in data, f"No token in response for {user['email']}"
        assert "user" in data, f"No user in response for {user['email']}"
        assert data["user"]["email"] == user["email"]
        assert data["user"]["role"] == user["role"]
        assert len(data["token"]) > 0
        print(f"✓ Login successful for {user['email']} (role: {user['role']})")
    
    def test_login_invalid_credentials(self):
        """Test login with wrong password fails"""
        response = requests.post(f"{BASE_URL}/api/v3/auth/login", json={
            "email": "fitsiomaxtech@gmail.com",
            "password": "wrongpassword"
        })
        assert response.status_code == 401
        print("✓ Invalid credentials correctly rejected")
    
    def test_login_nonexistent_user(self):
        """Test login with non-existent user fails"""
        response = requests.post(f"{BASE_URL}/api/v3/auth/login", json={
            "email": "nonexistent@fitsiomax.com",
            "password": "password123"
        })
        assert response.status_code == 401
        print("✓ Non-existent user correctly rejected")


class TestV3Branches:
    """Test Branches CRUD operations"""
    
    @pytest.fixture
    def admin_token(self):
        response = requests.post(f"{BASE_URL}/api/v3/auth/login", json={
            "email": "fitsiomaxtech@gmail.com",
            "password": "FitsioMax06"
        })
        if response.status_code != 200:
            pytest.skip("Admin login failed")
        return response.json()["token"]
    
    @pytest.fixture
    def bd_token(self):
        response = requests.post(f"{BASE_URL}/api/v3/auth/login", json={
            "email": "businessdev@fitsiomax.com",
            "password": "bd123"
        })
        if response.status_code != 200:
            pytest.skip("Business Dev login failed")
        return response.json()["token"]
    
    def test_list_branches(self, admin_token):
        """Test GET /api/v3/branches"""
        response = requests.get(
            f"{BASE_URL}/api/v3/branches",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Listed {len(data)} branches")
    
    def test_create_branch(self, admin_token):
        """Test POST /api/v3/branches"""
        unique_email = f"TEST_branchadmin_{uuid.uuid4().hex[:8]}@test.com"
        response = requests.post(
            f"{BASE_URL}/api/v3/branches",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "branch_name": f"TEST_Branch_{uuid.uuid4().hex[:6]}",
                "address": "Test Address, Chennai",
                "admin_name": "Test Branch Admin",
                "admin_email": unique_email,
                "admin_password": "testpass123",
                "admin_phone": "9876543210",
                "vertical": "offline_physiotherapy"
            }
        )
        assert response.status_code == 200, f"Create branch failed: {response.text}"
        data = response.json()
        assert "id" in data
        assert data["admin_email"] == unique_email.lower()
        print(f"✓ Created branch: {data['branch_name']}")
        return data["id"]
    
    def test_update_branch(self, admin_token):
        """Test PUT /api/v3/branches/{branch_id}"""
        # First create a branch
        unique_email = f"TEST_update_{uuid.uuid4().hex[:8]}@test.com"
        create_resp = requests.post(
            f"{BASE_URL}/api/v3/branches",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "branch_name": f"TEST_UpdateBranch_{uuid.uuid4().hex[:6]}",
                "address": "Original Address",
                "admin_name": "Test Admin",
                "admin_email": unique_email,
                "admin_password": "testpass123",
                "vertical": "offline_physiotherapy"
            }
        )
        assert create_resp.status_code == 200
        branch_id = create_resp.json()["id"]
        
        # Update the branch
        update_resp = requests.put(
            f"{BASE_URL}/api/v3/branches/{branch_id}",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"address": "Updated Address, Chennai"}
        )
        assert update_resp.status_code == 200
        assert update_resp.json()["address"] == "Updated Address, Chennai"
        print(f"✓ Updated branch {branch_id}")
    
    def test_delete_branch(self, admin_token):
        """Test DELETE /api/v3/branches/{branch_id}"""
        # First create a branch
        unique_email = f"TEST_delete_{uuid.uuid4().hex[:8]}@test.com"
        create_resp = requests.post(
            f"{BASE_URL}/api/v3/branches",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "branch_name": f"TEST_DeleteBranch_{uuid.uuid4().hex[:6]}",
                "address": "To Be Deleted",
                "admin_name": "Test Admin",
                "admin_email": unique_email,
                "admin_password": "testpass123",
                "vertical": "offline_physiotherapy"
            }
        )
        assert create_resp.status_code == 200
        branch_id = create_resp.json()["id"]
        
        # Delete the branch
        delete_resp = requests.delete(
            f"{BASE_URL}/api/v3/branches/{branch_id}",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert delete_resp.status_code == 200
        print(f"✓ Deleted branch {branch_id}")


class TestV3Leads:
    """Test Leads CRUD and stage management"""
    
    @pytest.fixture
    def presales_token(self):
        response = requests.post(f"{BASE_URL}/api/v3/auth/login", json={
            "email": "presales@fitsiomax.com",
            "password": "presales123"
        })
        if response.status_code != 200:
            pytest.skip("Pre-sales login failed")
        return response.json()["token"]
    
    @pytest.fixture
    def admin_token(self):
        response = requests.post(f"{BASE_URL}/api/v3/auth/login", json={
            "email": "fitsiomaxtech@gmail.com",
            "password": "FitsioMax06"
        })
        if response.status_code != 200:
            pytest.skip("Admin login failed")
        return response.json()["token"]
    
    def test_list_leads(self, presales_token):
        """Test GET /api/v3/leads"""
        response = requests.get(
            f"{BASE_URL}/api/v3/leads",
            headers={"Authorization": f"Bearer {presales_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Listed {len(data)} leads")
    
    def test_create_manual_lead(self, presales_token):
        """Test POST /api/v3/leads/manual"""
        unique_phone = f"TEST_{uuid.uuid4().hex[:10]}"
        response = requests.post(
            f"{BASE_URL}/api/v3/leads/manual",
            headers={"Authorization": f"Bearer {presales_token}"},
            json={
                "name": f"TEST_Lead_{uuid.uuid4().hex[:6]}",
                "phone": unique_phone,
                "email": f"test_{uuid.uuid4().hex[:6]}@test.com",
                "vertical": "offline_physiotherapy",
                "source_type": "manual",
                "notes": "Test lead created by regression test"
            }
        )
        assert response.status_code == 200, f"Create lead failed: {response.text}"
        data = response.json()
        assert "id" in data
        assert data["stage"] == "New Lead"
        print(f"✓ Created manual lead: {data['name']}")
        return data["id"]
    
    def test_qualify_lead(self, presales_token):
        """Test POST /api/v3/leads/{lead_id}/qualify"""
        # Create a lead first
        unique_phone = f"TEST_{uuid.uuid4().hex[:10]}"
        create_resp = requests.post(
            f"{BASE_URL}/api/v3/leads/manual",
            headers={"Authorization": f"Bearer {presales_token}"},
            json={
                "name": "TEST_QualifyLead",
                "phone": unique_phone,
                "vertical": "offline_physiotherapy",
                "source_type": "manual"
            }
        )
        assert create_resp.status_code == 200
        lead_id = create_resp.json()["id"]
        
        # Qualify the lead
        qualify_resp = requests.post(
            f"{BASE_URL}/api/v3/leads/{lead_id}/qualify",
            headers={"Authorization": f"Bearer {presales_token}"}
        )
        assert qualify_resp.status_code == 200
        assert qualify_resp.json()["stage"] == "Pre-sales Qualified"
        print(f"✓ Qualified lead {lead_id}")
    
    def test_assign_branch(self, presales_token, admin_token):
        """Test POST /api/v3/leads/{lead_id}/assign-branch"""
        # Get a branch
        branches_resp = requests.get(
            f"{BASE_URL}/api/v3/branches",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        if branches_resp.status_code != 200 or len(branches_resp.json()) == 0:
            pytest.skip("No branches available")
        branch_id = branches_resp.json()[0]["id"]
        
        # Create a lead
        unique_phone = f"TEST_{uuid.uuid4().hex[:10]}"
        create_resp = requests.post(
            f"{BASE_URL}/api/v3/leads/manual",
            headers={"Authorization": f"Bearer {presales_token}"},
            json={
                "name": "TEST_AssignBranchLead",
                "phone": unique_phone,
                "vertical": "offline_physiotherapy",
                "source_type": "manual"
            }
        )
        assert create_resp.status_code == 200
        lead_id = create_resp.json()["id"]
        
        # Assign to branch
        assign_resp = requests.post(
            f"{BASE_URL}/api/v3/leads/{lead_id}/assign-branch",
            headers={"Authorization": f"Bearer {presales_token}"},
            json={"branch_id": branch_id}
        )
        assert assign_resp.status_code == 200
        assert assign_resp.json()["branch_id"] == branch_id
        assert assign_resp.json()["stage"] == "Assigned to Branch"
        print(f"✓ Assigned lead {lead_id} to branch {branch_id}")
    
    def test_move_stage(self, presales_token):
        """Test POST /api/v3/leads/{lead_id}/move-stage"""
        # Create a lead
        unique_phone = f"TEST_{uuid.uuid4().hex[:10]}"
        create_resp = requests.post(
            f"{BASE_URL}/api/v3/leads/manual",
            headers={"Authorization": f"Bearer {presales_token}"},
            json={
                "name": "TEST_MoveStageLead",
                "phone": unique_phone,
                "vertical": "offline_physiotherapy",
                "source_type": "manual"
            }
        )
        assert create_resp.status_code == 200
        lead_id = create_resp.json()["id"]
        
        # Move stage
        move_resp = requests.post(
            f"{BASE_URL}/api/v3/leads/{lead_id}/move-stage",
            headers={"Authorization": f"Bearer {presales_token}"},
            json={"stage": "Pre-sales Qualified"}
        )
        assert move_resp.status_code == 200
        assert move_resp.json()["stage"] == "Pre-sales Qualified"
        print(f"✓ Moved lead {lead_id} to Pre-sales Qualified")


class TestV3BranchBoard:
    """Test Branch Board endpoint"""
    
    @pytest.fixture
    def branch_admin_token(self):
        response = requests.post(f"{BASE_URL}/api/v3/auth/login", json={
            "email": "branchadmin@fitsiomax.com",
            "password": "branch123"
        })
        if response.status_code != 200:
            pytest.skip("Branch Admin login failed")
        return response.json()
    
    def test_get_branch_board(self, branch_admin_token):
        """Test GET /api/v3/branch-board/{branch_id}"""
        branch_id = branch_admin_token["user"].get("branch_id")
        if not branch_id:
            pytest.skip("Branch admin has no branch_id")
        
        response = requests.get(
            f"{BASE_URL}/api/v3/branch-board/{branch_id}",
            headers={"Authorization": f"Bearer {branch_admin_token['token']}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "leads" in data
        assert "stage_counts" in data
        print(f"✓ Branch board retrieved with {len(data['leads'])} leads")


class TestV3BranchAdminActions:
    """Test Branch Admin specific actions"""
    
    @pytest.fixture
    def branch_admin_auth(self):
        response = requests.post(f"{BASE_URL}/api/v3/auth/login", json={
            "email": "branchadmin@fitsiomax.com",
            "password": "branch123"
        })
        if response.status_code != 200:
            pytest.skip("Branch Admin login failed")
        return response.json()
    
    @pytest.fixture
    def admin_token(self):
        response = requests.post(f"{BASE_URL}/api/v3/auth/login", json={
            "email": "fitsiomaxtech@gmail.com",
            "password": "FitsioMax06"
        })
        if response.status_code != 200:
            pytest.skip("Admin login failed")
        return response.json()["token"]
    
    def test_branch_stage_move(self, branch_admin_auth, admin_token):
        """Test POST /api/v3/leads/{lead_id}/branch-stage"""
        branch_id = branch_admin_auth["user"].get("branch_id")
        if not branch_id:
            pytest.skip("Branch admin has no branch_id")
        
        # Create a lead assigned to this branch
        unique_phone = f"TEST_{uuid.uuid4().hex[:10]}"
        create_resp = requests.post(
            f"{BASE_URL}/api/v3/leads/manual",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "name": "TEST_BranchStageLead",
                "phone": unique_phone,
                "vertical": "offline_physiotherapy",
                "source_type": "manual",
                "branch_id": branch_id
            }
        )
        assert create_resp.status_code == 200
        lead_id = create_resp.json()["id"]
        
        # Move branch stage
        move_resp = requests.post(
            f"{BASE_URL}/api/v3/leads/{lead_id}/branch-stage",
            headers={"Authorization": f"Bearer {branch_admin_auth['token']}"},
            json={"branch_stage": "Call & Confirm"}
        )
        assert move_resp.status_code == 200
        assert move_resp.json()["branch_stage"] == "Call & Confirm"
        print(f"✓ Moved lead {lead_id} to branch stage 'Call & Confirm'")
    
    def test_collect_consultation_fee(self, branch_admin_auth, admin_token):
        """Test POST /api/v3/leads/{lead_id}/collect-fee (consultation)"""
        branch_id = branch_admin_auth["user"].get("branch_id")
        if not branch_id:
            pytest.skip("Branch admin has no branch_id")
        
        # Create a lead
        unique_phone = f"TEST_{uuid.uuid4().hex[:10]}"
        create_resp = requests.post(
            f"{BASE_URL}/api/v3/leads/manual",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "name": "TEST_ConsultationFeeLead",
                "phone": unique_phone,
                "vertical": "offline_physiotherapy",
                "source_type": "manual",
                "branch_id": branch_id
            }
        )
        assert create_resp.status_code == 200
        lead_id = create_resp.json()["id"]
        
        # Collect consultation fee
        fee_resp = requests.post(
            f"{BASE_URL}/api/v3/leads/{lead_id}/collect-fee",
            headers={"Authorization": f"Bearer {branch_admin_auth['token']}"},
            json={"fee_type": "consultation", "amount": 500}
        )
        assert fee_resp.status_code == 200
        assert fee_resp.json()["consultation_fee"] == 500
        assert fee_resp.json()["branch_stage"] == "Consultation Fee Collected"
        print(f"✓ Collected consultation fee for lead {lead_id}")
    
    def test_collect_package_fee(self, branch_admin_auth, admin_token):
        """Test POST /api/v3/leads/{lead_id}/collect-fee (package)"""
        branch_id = branch_admin_auth["user"].get("branch_id")
        if not branch_id:
            pytest.skip("Branch admin has no branch_id")
        
        # Create a lead
        unique_phone = f"TEST_{uuid.uuid4().hex[:10]}"
        create_resp = requests.post(
            f"{BASE_URL}/api/v3/leads/manual",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "name": "TEST_PackageFeeLead",
                "phone": unique_phone,
                "vertical": "offline_physiotherapy",
                "source_type": "manual",
                "branch_id": branch_id
            }
        )
        assert create_resp.status_code == 200
        lead_id = create_resp.json()["id"]
        
        # Collect package fee
        fee_resp = requests.post(
            f"{BASE_URL}/api/v3/leads/{lead_id}/collect-fee",
            headers={"Authorization": f"Bearer {branch_admin_auth['token']}"},
            json={"fee_type": "package", "amount": 15000, "package_weeks": 8}
        )
        assert fee_resp.status_code == 200
        assert fee_resp.json()["package_amount"] == 15000
        assert fee_resp.json()["package_weeks"] == 8
        assert fee_resp.json()["branch_stage"] == "Package Paid"
        print(f"✓ Collected package fee for lead {lead_id}")


class TestV3Doctors:
    """Test Doctors CRUD and slots"""
    
    @pytest.fixture
    def admin_token(self):
        response = requests.post(f"{BASE_URL}/api/v3/auth/login", json={
            "email": "fitsiomaxtech@gmail.com",
            "password": "FitsioMax06"
        })
        if response.status_code != 200:
            pytest.skip("Admin login failed")
        return response.json()["token"]
    
    @pytest.fixture
    def branch_admin_auth(self):
        response = requests.post(f"{BASE_URL}/api/v3/auth/login", json={
            "email": "branchadmin@fitsiomax.com",
            "password": "branch123"
        })
        if response.status_code != 200:
            pytest.skip("Branch Admin login failed")
        return response.json()
    
    def test_list_doctors(self, admin_token):
        """Test GET /api/v3/doctors"""
        response = requests.get(
            f"{BASE_URL}/api/v3/doctors",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Listed {len(data)} doctors")
    
    def test_create_doctor(self, branch_admin_auth):
        """Test POST /api/v3/doctors"""
        branch_id = branch_admin_auth["user"].get("branch_id")
        if not branch_id:
            pytest.skip("Branch admin has no branch_id")
        
        response = requests.post(
            f"{BASE_URL}/api/v3/doctors",
            headers={"Authorization": f"Bearer {branch_admin_auth['token']}"},
            json={
                "full_name": f"TEST_Dr_{uuid.uuid4().hex[:6]}",
                "profile_type": "physio",
                "branch_id": branch_id,
                "specialization": "Sports Rehab"
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert data["branch_id"] == branch_id
        print(f"✓ Created doctor: {data['full_name']}")
        return data["id"]
    
    def test_add_slots(self, branch_admin_auth):
        """Test POST /api/v3/doctors/{doctor_id}/slots"""
        branch_id = branch_admin_auth["user"].get("branch_id")
        if not branch_id:
            pytest.skip("Branch admin has no branch_id")
        
        # Create a doctor first
        create_resp = requests.post(
            f"{BASE_URL}/api/v3/doctors",
            headers={"Authorization": f"Bearer {branch_admin_auth['token']}"},
            json={
                "full_name": f"TEST_DrSlots_{uuid.uuid4().hex[:6]}",
                "profile_type": "head_physio",
                "branch_id": branch_id,
                "specialization": "General"
            }
        )
        assert create_resp.status_code == 200
        doctor_id = create_resp.json()["id"]
        
        # Add slots
        tomorrow = (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%dT10:00")
        slots_resp = requests.post(
            f"{BASE_URL}/api/v3/doctors/{doctor_id}/slots",
            headers={"Authorization": f"Bearer {branch_admin_auth['token']}"},
            json={"slots": [tomorrow, f"{tomorrow[:11]}11:00", f"{tomorrow[:11]}14:00"]}
        )
        assert slots_resp.status_code == 200
        assert len(slots_resp.json()["slots"]) >= 3
        print(f"✓ Added slots to doctor {doctor_id}")
    
    def test_available_doctors(self, branch_admin_auth):
        """Test GET /api/v3/doctors/available"""
        branch_id = branch_admin_auth["user"].get("branch_id")
        if not branch_id:
            pytest.skip("Branch admin has no branch_id")
        
        tomorrow = (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%dT10:00")
        response = requests.get(
            f"{BASE_URL}/api/v3/doctors/available",
            headers={"Authorization": f"Bearer {branch_admin_auth['token']}"},
            params={"branch_id": branch_id, "slot_time": tomorrow}
        )
        assert response.status_code == 200
        data = response.json()
        assert "available_doctors" in data
        print(f"✓ Found {len(data['available_doctors'])} available doctors")


class TestV3Appointments:
    """Test Appointments CRUD"""
    
    @pytest.fixture
    def admin_token(self):
        response = requests.post(f"{BASE_URL}/api/v3/auth/login", json={
            "email": "fitsiomaxtech@gmail.com",
            "password": "FitsioMax06"
        })
        if response.status_code != 200:
            pytest.skip("Admin login failed")
        return response.json()["token"]
    
    @pytest.fixture
    def head_physio_token(self):
        response = requests.post(f"{BASE_URL}/api/v3/auth/login", json={
            "email": "headphysio@fitsiomax.com",
            "password": "head123"
        })
        if response.status_code != 200:
            pytest.skip("Head Physio login failed")
        return response.json()["token"]
    
    def test_list_appointments(self, admin_token):
        """Test GET /api/v3/appointments"""
        response = requests.get(
            f"{BASE_URL}/api/v3/appointments",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Listed {len(data)} appointments")


class TestV3Dashboard:
    """Test Dashboard endpoints"""
    
    @pytest.fixture
    def bd_token(self):
        response = requests.post(f"{BASE_URL}/api/v3/auth/login", json={
            "email": "businessdev@fitsiomax.com",
            "password": "bd123"
        })
        if response.status_code != 200:
            pytest.skip("Business Dev login failed")
        return response.json()["token"]
    
    @pytest.fixture
    def admin_token(self):
        response = requests.post(f"{BASE_URL}/api/v3/auth/login", json={
            "email": "fitsiomaxtech@gmail.com",
            "password": "FitsioMax06"
        })
        if response.status_code != 200:
            pytest.skip("Admin login failed")
        return response.json()["token"]
    
    def test_bd_summary(self, bd_token):
        """Test GET /api/v3/dashboard/bd-summary"""
        response = requests.get(
            f"{BASE_URL}/api/v3/dashboard/bd-summary",
            headers={"Authorization": f"Bearer {bd_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "total_leads" in data
        assert "stage_counts" in data
        assert "source_counts" in data
        assert "branch_counts" in data
        print(f"✓ BD Summary: {data['total_leads']} total leads")
    
    def test_lead_sources(self, bd_token):
        """Test GET /api/v3/lead-sources"""
        response = requests.get(
            f"{BASE_URL}/api/v3/lead-sources",
            headers={"Authorization": f"Bearer {bd_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Lead sources: {len(data)} sources")
    
    def test_master_board(self, admin_token):
        """Test GET /api/v3/boards/master"""
        response = requests.get(
            f"{BASE_URL}/api/v3/boards/master",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "stage_counts" in data
        print(f"✓ Master board retrieved")
    
    def test_branch_board(self, admin_token):
        """Test GET /api/v3/boards/branch/{branch_id}"""
        # Get a branch first
        branches_resp = requests.get(
            f"{BASE_URL}/api/v3/branches",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        if branches_resp.status_code != 200 or len(branches_resp.json()) == 0:
            pytest.skip("No branches available")
        branch_id = branches_resp.json()[0]["id"]
        
        response = requests.get(
            f"{BASE_URL}/api/v3/boards/branch/{branch_id}",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "stage_counts" in data
        assert data["branch_id"] == branch_id
        print(f"✓ Branch board retrieved for {branch_id}")


class TestV3LeadDetails:
    """Test Lead details - remarks, follow-ups, activity"""
    
    @pytest.fixture
    def presales_token(self):
        response = requests.post(f"{BASE_URL}/api/v3/auth/login", json={
            "email": "presales@fitsiomax.com",
            "password": "presales123"
        })
        if response.status_code != 200:
            pytest.skip("Pre-sales login failed")
        return response.json()["token"]
    
    @pytest.fixture
    def test_lead(self, presales_token):
        """Create a test lead for detail tests"""
        unique_phone = f"TEST_{uuid.uuid4().hex[:10]}"
        response = requests.post(
            f"{BASE_URL}/api/v3/leads/manual",
            headers={"Authorization": f"Bearer {presales_token}"},
            json={
                "name": "TEST_DetailLead",
                "phone": unique_phone,
                "vertical": "offline_physiotherapy",
                "source_type": "manual"
            }
        )
        if response.status_code != 200:
            pytest.skip("Failed to create test lead")
        return response.json()["id"]
    
    def test_add_remark(self, presales_token, test_lead):
        """Test POST /api/v3/leads/{lead_id}/remarks"""
        response = requests.post(
            f"{BASE_URL}/api/v3/leads/{test_lead}/remarks",
            headers={"Authorization": f"Bearer {presales_token}"},
            json={"text": "Test remark from regression test"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert data["text"] == "Test remark from regression test"
        print(f"✓ Added remark to lead {test_lead}")
    
    def test_get_remarks(self, presales_token, test_lead):
        """Test GET /api/v3/leads/{lead_id}/remarks"""
        response = requests.get(
            f"{BASE_URL}/api/v3/leads/{test_lead}/remarks",
            headers={"Authorization": f"Bearer {presales_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Retrieved {len(data)} remarks for lead {test_lead}")
    
    def test_add_follow_up(self, presales_token, test_lead):
        """Test POST /api/v3/leads/{lead_id}/follow-ups"""
        tomorrow = (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%d")
        response = requests.post(
            f"{BASE_URL}/api/v3/leads/{test_lead}/follow-ups",
            headers={"Authorization": f"Bearer {presales_token}"},
            json={"note": "Follow up call", "scheduled_date": tomorrow}
        )
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert data["status"] == "pending"
        print(f"✓ Added follow-up to lead {test_lead}")
        return data["id"]
    
    def test_get_follow_ups(self, presales_token, test_lead):
        """Test GET /api/v3/leads/{lead_id}/follow-ups"""
        response = requests.get(
            f"{BASE_URL}/api/v3/leads/{test_lead}/follow-ups",
            headers={"Authorization": f"Bearer {presales_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Retrieved {len(data)} follow-ups for lead {test_lead}")
    
    def test_get_activity(self, presales_token, test_lead):
        """Test GET /api/v3/leads/{lead_id}/activity"""
        response = requests.get(
            f"{BASE_URL}/api/v3/leads/{test_lead}/activity",
            headers={"Authorization": f"Bearer {presales_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Retrieved {len(data)} activity items for lead {test_lead}")


class TestV3TeamMembers:
    """Test Team Members CRUD"""
    
    @pytest.fixture
    def bd_token(self):
        response = requests.post(f"{BASE_URL}/api/v3/auth/login", json={
            "email": "businessdev@fitsiomax.com",
            "password": "bd123"
        })
        if response.status_code != 200:
            pytest.skip("Business Dev login failed")
        return response.json()["token"]
    
    def test_list_team_members(self, bd_token):
        """Test GET /api/v3/team-members"""
        response = requests.get(
            f"{BASE_URL}/api/v3/team-members",
            headers={"Authorization": f"Bearer {bd_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Listed {len(data)} team members")
    
    def test_create_team_member(self, bd_token):
        """Test POST /api/v3/team-members"""
        unique_email = f"TEST_team_{uuid.uuid4().hex[:8]}@test.com"
        response = requests.post(
            f"{BASE_URL}/api/v3/team-members",
            headers={"Authorization": f"Bearer {bd_token}"},
            json={
                "full_name": f"TEST_TeamMember_{uuid.uuid4().hex[:6]}",
                "email": unique_email,
                "team_type": "pre_sales"
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert data["team_type"] == "pre_sales"
        print(f"✓ Created team member: {data['full_name']}")


class TestV3Sheets:
    """Test Sheets connections"""
    
    @pytest.fixture
    def bd_token(self):
        response = requests.post(f"{BASE_URL}/api/v3/auth/login", json={
            "email": "businessdev@fitsiomax.com",
            "password": "bd123"
        })
        if response.status_code != 200:
            pytest.skip("Business Dev login failed")
        return response.json()["token"]
    
    def test_create_sheet_connection(self, bd_token):
        """Test POST /api/v3/sheets/connections"""
        response = requests.post(
            f"{BASE_URL}/api/v3/sheets/connections",
            headers={"Authorization": f"Bearer {bd_token}"},
            json={
                "connection_name": f"TEST_Connection_{uuid.uuid4().hex[:6]}",
                "spreadsheet_id": "test_spreadsheet_id_123",
                "sync_interval_minutes": 30
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        print(f"✓ Created sheet connection: {data['connection_name']}")
        return data["id"]
    
    def test_list_sheet_connections(self, bd_token):
        """Test GET /api/v3/sheets/connections"""
        response = requests.get(
            f"{BASE_URL}/api/v3/sheets/connections",
            headers={"Authorization": f"Bearer {bd_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Listed {len(data)} sheet connections")
    
    def test_save_mapping(self, bd_token):
        """Test POST /api/v3/sheets/connections/{connection_id}/mapping"""
        # Create a connection first
        create_resp = requests.post(
            f"{BASE_URL}/api/v3/sheets/connections",
            headers={"Authorization": f"Bearer {bd_token}"},
            json={
                "connection_name": f"TEST_MappingConn_{uuid.uuid4().hex[:6]}",
                "spreadsheet_id": "test_spreadsheet_id_456",
                "sync_interval_minutes": 30
            }
        )
        assert create_resp.status_code == 200
        connection_id = create_resp.json()["id"]
        
        # Save mapping
        mapping_resp = requests.post(
            f"{BASE_URL}/api/v3/sheets/connections/{connection_id}/mapping",
            headers={"Authorization": f"Bearer {bd_token}"},
            json={
                "field_map": {"name": "Name", "phone": "Phone", "email": "Email"},
                "create_new_fields": True
            }
        )
        assert mapping_resp.status_code == 200
        print(f"✓ Saved mapping for connection {connection_id}")


class TestV3Verticals:
    """Test Verticals endpoints"""
    
    @pytest.fixture
    def admin_token(self):
        response = requests.post(f"{BASE_URL}/api/v3/auth/login", json={
            "email": "fitsiomaxtech@gmail.com",
            "password": "FitsioMax06"
        })
        if response.status_code != 200:
            pytest.skip("Admin login failed")
        return response.json()["token"]
    
    def test_list_verticals(self, admin_token):
        """Test GET /api/v3/verticals"""
        response = requests.get(
            f"{BASE_URL}/api/v3/verticals",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 4  # Should have at least 4 default verticals
        print(f"✓ Listed {len(data)} verticals")


class TestV3Logout:
    """Test logout endpoint"""
    
    def test_logout(self):
        """Test POST /api/v3/auth/logout"""
        # Login first
        login_resp = requests.post(f"{BASE_URL}/api/v3/auth/login", json={
            "email": "fitsiomaxtech@gmail.com",
            "password": "FitsioMax06"
        })
        assert login_resp.status_code == 200
        token = login_resp.json()["token"]
        
        # Logout
        logout_resp = requests.post(
            f"{BASE_URL}/api/v3/auth/logout",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert logout_resp.status_code == 200
        print("✓ Logout successful")
        
        # Verify token is invalidated
        verify_resp = requests.get(
            f"{BASE_URL}/api/v3/leads",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert verify_resp.status_code == 401
        print("✓ Token invalidated after logout")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
