"""
Backend tests for Business Development Dashboard - Iteration 14
Tests BD-specific endpoints: /api/v3/dashboard/bd-summary and /api/v3/lead-sources
Also tests branch creation, lead management, sheet connections for BD role
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
BD_EMAIL = "businessdev@fitsiomax.com"
BD_PASSWORD = "bd123"
ADMIN_EMAIL = "fitsiomaxtech@gmail.com"
ADMIN_PASSWORD = "FitsioMax06"
PRESALES_EMAIL = "presales@fitsiomax.com"
PRESALES_PASSWORD = "presales123"


@pytest.fixture(scope="module")
def bd_token():
    """Get BD user token"""
    response = requests.post(f"{BASE_URL}/api/v3/auth/login", json={
        "email": BD_EMAIL,
        "password": BD_PASSWORD
    })
    assert response.status_code == 200, f"BD login failed: {response.text}"
    data = response.json()
    assert "token" in data
    assert data["user"]["role"] == "business_dev"
    return data["token"]


@pytest.fixture(scope="module")
def admin_token():
    """Get Super Admin token"""
    response = requests.post(f"{BASE_URL}/api/v3/auth/login", json={
        "email": ADMIN_EMAIL,
        "password": ADMIN_PASSWORD
    })
    assert response.status_code == 200, f"Admin login failed: {response.text}"
    return response.json()["token"]


@pytest.fixture(scope="module")
def presales_token():
    """Get Pre-sales token"""
    response = requests.post(f"{BASE_URL}/api/v3/auth/login", json={
        "email": PRESALES_EMAIL,
        "password": PRESALES_PASSWORD
    })
    assert response.status_code == 200, f"Pre-sales login failed: {response.text}"
    return response.json()["token"]


class TestBDLogin:
    """Test BD user authentication"""
    
    def test_bd_login_success(self):
        """BD user can login with correct credentials"""
        response = requests.post(f"{BASE_URL}/api/v3/auth/login", json={
            "email": BD_EMAIL,
            "password": BD_PASSWORD
        })
        assert response.status_code == 200
        data = response.json()
        assert "token" in data
        assert "user" in data
        assert data["user"]["email"] == BD_EMAIL
        assert data["user"]["role"] == "business_dev"
        assert data["user"]["full_name"] == "Business Development"
    
    def test_bd_login_invalid_password(self):
        """BD login fails with wrong password"""
        response = requests.post(f"{BASE_URL}/api/v3/auth/login", json={
            "email": BD_EMAIL,
            "password": "wrongpassword"
        })
        assert response.status_code == 401


class TestBDSummaryEndpoint:
    """Test GET /api/v3/dashboard/bd-summary endpoint"""
    
    def test_bd_summary_returns_correct_structure(self, bd_token):
        """BD summary returns all required fields"""
        response = requests.get(
            f"{BASE_URL}/api/v3/dashboard/bd-summary",
            headers={"Authorization": f"Bearer {bd_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        
        # Check required top-level fields
        assert "total_leads" in data
        assert "stage_counts" in data
        assert "source_counts" in data
        assert "branch_counts" in data
        assert "total_appointments" in data
        assert "completed_appointments" in data
        assert "total_branches" in data
        assert "total_connections" in data
        assert "recent_leads" in data
        
        # Validate types
        assert isinstance(data["total_leads"], int)
        assert isinstance(data["stage_counts"], dict)
        assert isinstance(data["source_counts"], dict)
        assert isinstance(data["branch_counts"], list)
        assert isinstance(data["total_appointments"], int)
        assert isinstance(data["completed_appointments"], int)
        assert isinstance(data["total_branches"], int)
        assert isinstance(data["total_connections"], int)
        assert isinstance(data["recent_leads"], list)
    
    def test_bd_summary_stage_counts_has_all_stages(self, bd_token):
        """BD summary stage_counts includes all 6 pipeline stages"""
        response = requests.get(
            f"{BASE_URL}/api/v3/dashboard/bd-summary",
            headers={"Authorization": f"Bearer {bd_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        
        expected_stages = [
            "New Lead",
            "Pre-sales Qualified",
            "Assigned to Branch",
            "Branch Confirmed",
            "Appointment Booked",
            "Completed"
        ]
        for stage in expected_stages:
            assert stage in data["stage_counts"], f"Missing stage: {stage}"
            assert isinstance(data["stage_counts"][stage], int)
    
    def test_bd_summary_accessible_by_super_admin(self, admin_token):
        """Super admin can also access BD summary"""
        response = requests.get(
            f"{BASE_URL}/api/v3/dashboard/bd-summary",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
    
    def test_bd_summary_forbidden_for_presales(self, presales_token):
        """Pre-sales user cannot access BD summary"""
        response = requests.get(
            f"{BASE_URL}/api/v3/dashboard/bd-summary",
            headers={"Authorization": f"Bearer {presales_token}"}
        )
        assert response.status_code == 403


class TestLeadSourcesEndpoint:
    """Test GET /api/v3/lead-sources endpoint"""
    
    def test_lead_sources_returns_list(self, bd_token):
        """Lead sources returns a list of source aggregations"""
        response = requests.get(
            f"{BASE_URL}/api/v3/lead-sources",
            headers={"Authorization": f"Bearer {bd_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
    
    def test_lead_sources_item_structure(self, bd_token):
        """Each lead source item has correct structure"""
        response = requests.get(
            f"{BASE_URL}/api/v3/lead-sources",
            headers={"Authorization": f"Bearer {bd_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        
        if len(data) > 0:
            item = data[0]
            assert "source_tab" in item
            assert "source_type" in item
            assert "total" in item
            assert "stage_breakdown" in item
            assert isinstance(item["total"], int)
            assert isinstance(item["stage_breakdown"], dict)
    
    def test_lead_sources_accessible_by_super_admin(self, admin_token):
        """Super admin can access lead sources"""
        response = requests.get(
            f"{BASE_URL}/api/v3/lead-sources",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
    
    def test_lead_sources_forbidden_for_presales(self, presales_token):
        """Pre-sales user cannot access lead sources"""
        response = requests.get(
            f"{BASE_URL}/api/v3/lead-sources",
            headers={"Authorization": f"Bearer {presales_token}"}
        )
        assert response.status_code == 403


class TestBDBranchManagement:
    """Test branch CRUD operations for BD role"""
    
    def test_bd_can_list_branches(self, bd_token):
        """BD user can list all branches"""
        response = requests.get(
            f"{BASE_URL}/api/v3/branches",
            headers={"Authorization": f"Bearer {bd_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
    
    def test_bd_can_create_branch(self, bd_token):
        """BD user can create a new branch with admin"""
        unique_id = str(uuid.uuid4())[:8]
        branch_data = {
            "branch_name": f"TEST_BD_Branch_{unique_id}",
            "address": "Test Address 123",
            "admin_name": f"Test Admin {unique_id}",
            "admin_email": f"testadmin_{unique_id}@test.com",
            "admin_password": "testpass123",
            "admin_phone": "9876543210",
            "vertical": "offline_physiotherapy"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/v3/branches",
            headers={"Authorization": f"Bearer {bd_token}"},
            json=branch_data
        )
        assert response.status_code == 200
        data = response.json()
        
        assert data["branch_name"] == branch_data["branch_name"]
        assert data["address"] == branch_data["address"]
        assert data["admin_name"] == branch_data["admin_name"]
        assert data["admin_email"] == branch_data["admin_email"].lower()
        assert data["vertical"] == branch_data["vertical"]
        assert "id" in data
        assert "created_at" in data
        
        # Verify branch appears in list
        list_response = requests.get(
            f"{BASE_URL}/api/v3/branches",
            headers={"Authorization": f"Bearer {bd_token}"}
        )
        branches = list_response.json()
        branch_ids = [b["id"] for b in branches]
        assert data["id"] in branch_ids


class TestBDLeadManagement:
    """Test lead operations for BD role"""
    
    def test_bd_can_list_leads(self, bd_token):
        """BD user can list leads"""
        response = requests.get(
            f"{BASE_URL}/api/v3/leads",
            headers={"Authorization": f"Bearer {bd_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
    
    def test_bd_can_qualify_lead(self, bd_token):
        """BD user can qualify a New Lead"""
        # First create a lead
        unique_id = str(uuid.uuid4())[:8]
        create_response = requests.post(
            f"{BASE_URL}/api/v3/leads/manual",
            headers={"Authorization": f"Bearer {bd_token}"},
            json={
                "name": f"TEST_BD_Lead_{unique_id}",
                "phone": f"900000{unique_id[:4]}",
                "email": f"testlead_{unique_id}@test.com",
                "vertical": "offline_physiotherapy",
                "source_tab": "Manual",
                "source_type": "manual"
            }
        )
        assert create_response.status_code == 200
        lead = create_response.json()
        lead_id = lead["id"]
        assert lead["stage"] == "New Lead"
        
        # Qualify the lead
        qualify_response = requests.post(
            f"{BASE_URL}/api/v3/leads/{lead_id}/qualify",
            headers={"Authorization": f"Bearer {bd_token}"}
        )
        assert qualify_response.status_code == 200
        qualified_lead = qualify_response.json()
        assert qualified_lead["stage"] == "Pre-sales Qualified"
    
    def test_bd_can_assign_lead_to_branch(self, bd_token):
        """BD user can assign a lead to a branch"""
        # Get branches
        branches_response = requests.get(
            f"{BASE_URL}/api/v3/branches",
            headers={"Authorization": f"Bearer {bd_token}"}
        )
        branches = branches_response.json()
        if not branches:
            pytest.skip("No branches available for assignment test")
        
        branch_id = branches[0]["id"]
        
        # Create a lead
        unique_id = str(uuid.uuid4())[:8]
        create_response = requests.post(
            f"{BASE_URL}/api/v3/leads/manual",
            headers={"Authorization": f"Bearer {bd_token}"},
            json={
                "name": f"TEST_BD_Assign_{unique_id}",
                "phone": f"900001{unique_id[:4]}",
                "email": f"testassign_{unique_id}@test.com",
                "vertical": "offline_physiotherapy",
                "source_tab": "Manual",
                "source_type": "manual"
            }
        )
        assert create_response.status_code == 200
        lead = create_response.json()
        lead_id = lead["id"]
        
        # Assign to branch
        assign_response = requests.post(
            f"{BASE_URL}/api/v3/leads/{lead_id}/assign-branch",
            headers={"Authorization": f"Bearer {bd_token}"},
            json={"branch_id": branch_id}
        )
        assert assign_response.status_code == 200
        assigned_lead = assign_response.json()
        assert assigned_lead["branch_id"] == branch_id
        assert assigned_lead["stage"] == "Assigned to Branch"


class TestBDSheetConnections:
    """Test Google Sheet connection operations for BD role"""
    
    def test_bd_can_list_sheet_connections(self, bd_token):
        """BD user can list sheet connections"""
        response = requests.get(
            f"{BASE_URL}/api/v3/sheets/connections",
            headers={"Authorization": f"Bearer {bd_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
    
    def test_bd_can_create_sheet_connection(self, bd_token):
        """BD user can create a sheet connection"""
        unique_id = str(uuid.uuid4())[:8]
        connection_data = {
            "connection_name": f"TEST_BD_Connection_{unique_id}",
            "spreadsheet_id": f"test_spreadsheet_{unique_id}",
            "sync_interval_minutes": 30
        }
        
        response = requests.post(
            f"{BASE_URL}/api/v3/sheets/connections",
            headers={"Authorization": f"Bearer {bd_token}"},
            json=connection_data
        )
        assert response.status_code == 200
        data = response.json()
        
        assert data["connection_name"] == connection_data["connection_name"]
        assert data["spreadsheet_id"] == connection_data["spreadsheet_id"]
        assert data["sync_interval_minutes"] == connection_data["sync_interval_minutes"]
        assert "id" in data
        
        return data["id"]
    
    def test_bd_can_save_field_mapping(self, bd_token):
        """BD user can save field mapping for a connection"""
        # First create a connection
        unique_id = str(uuid.uuid4())[:8]
        create_response = requests.post(
            f"{BASE_URL}/api/v3/sheets/connections",
            headers={"Authorization": f"Bearer {bd_token}"},
            json={
                "connection_name": f"TEST_BD_Mapping_{unique_id}",
                "spreadsheet_id": f"test_mapping_{unique_id}",
                "sync_interval_minutes": 30
            }
        )
        assert create_response.status_code == 200
        connection_id = create_response.json()["id"]
        
        # Save mapping
        mapping_response = requests.post(
            f"{BASE_URL}/api/v3/sheets/connections/{connection_id}/mapping",
            headers={"Authorization": f"Bearer {bd_token}"},
            json={
                "field_map": {
                    "name": "Name",
                    "phone": "Phone",
                    "email": "Email",
                    "vertical": "Vertical"
                },
                "create_new_fields": True
            }
        )
        assert mapping_response.status_code == 200
    
    def test_bd_can_run_sync(self, bd_token):
        """BD user can run sync with manual JSON payload"""
        # First create a connection
        unique_id = str(uuid.uuid4())[:8]
        create_response = requests.post(
            f"{BASE_URL}/api/v3/sheets/connections",
            headers={"Authorization": f"Bearer {bd_token}"},
            json={
                "connection_name": f"TEST_BD_Sync_{unique_id}",
                "spreadsheet_id": f"test_sync_{unique_id}",
                "sync_interval_minutes": 30
            }
        )
        assert create_response.status_code == 200
        connection_id = create_response.json()["id"]
        
        # Run sync with test data
        sync_payload = {
            "tabs": [
                {
                    "tab_name": "TestTab",
                    "rows": [
                        {
                            "name": f"SyncTest_{unique_id}",
                            "phone": f"800000{unique_id[:4]}",
                            "email": f"synctest_{unique_id}@test.com",
                            "vertical": "offline_physiotherapy"
                        }
                    ]
                }
            ]
        }
        
        sync_response = requests.post(
            f"{BASE_URL}/api/v3/sheets/connections/{connection_id}/sync",
            headers={"Authorization": f"Bearer {bd_token}"},
            json=sync_payload
        )
        assert sync_response.status_code == 200
        data = sync_response.json()
        assert "imported" in data
        assert "skipped" in data


class TestBDLeadFiltering:
    """Test lead filtering capabilities"""
    
    def test_filter_leads_by_stage(self, bd_token):
        """BD can filter leads by stage"""
        response = requests.get(
            f"{BASE_URL}/api/v3/leads",
            headers={"Authorization": f"Bearer {bd_token}"},
            params={"stage": "New Lead"}
        )
        assert response.status_code == 200
        data = response.json()
        # All returned leads should be New Lead stage
        for lead in data:
            assert lead["stage"] == "New Lead"
    
    def test_filter_leads_by_branch(self, bd_token):
        """BD can filter leads by branch"""
        # Get a branch first
        branches_response = requests.get(
            f"{BASE_URL}/api/v3/branches",
            headers={"Authorization": f"Bearer {bd_token}"}
        )
        branches = branches_response.json()
        if not branches:
            pytest.skip("No branches available")
        
        branch_id = branches[0]["id"]
        
        response = requests.get(
            f"{BASE_URL}/api/v3/leads",
            headers={"Authorization": f"Bearer {bd_token}"},
            params={"branch_id": branch_id}
        )
        assert response.status_code == 200
        data = response.json()
        # All returned leads should have the specified branch_id
        for lead in data:
            assert lead["branch_id"] == branch_id


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
