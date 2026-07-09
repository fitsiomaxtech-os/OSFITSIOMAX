from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.middleware.cors import CORSMiddleware
import os
import logging

from database import client
from seed import ensure_v1_seed_data, v2_seed, v3_seed, migrate_branch_stages, deactivate_legacy_demo_admin
from routers.v3_google_sheets import start_auto_sync_scheduler
from routers import v1, v2, v3_auth, v3_config, v3_leads, v3_branch_admin, v3_appointments, v3_sheets, v3_dashboard, v3_head_physio, v3_finance, v3_head_physio_board, v3_physio_board, v3_session_assign, v3_patient_view, v3_marketing, v3_stages, v3_hr, v3_lead_fields, v3_branch_mgmt, v3_google_sheets, v3_packages, v3_public_super_admin, v3_password_reset, v3_store

app = FastAPI()

app.include_router(v1.router)
app.include_router(v2.router)
app.include_router(v3_auth.router)
app.include_router(v3_config.router)
app.include_router(v3_leads.router)
app.include_router(v3_branch_admin.router)
app.include_router(v3_appointments.router)
app.include_router(v3_sheets.router)
app.include_router(v3_dashboard.router)
app.include_router(v3_head_physio.router)
app.include_router(v3_finance.router)
app.include_router(v3_head_physio_board.router)
app.include_router(v3_physio_board.router)
app.include_router(v3_session_assign.router)
app.include_router(v3_patient_view.router)
app.include_router(v3_marketing.router)
app.include_router(v3_stages.router)
app.include_router(v3_hr.router)
app.include_router(v3_lead_fields.router)
app.include_router(v3_branch_mgmt.router)
app.include_router(v3_google_sheets.router)
app.include_router(v3_packages.router)
app.include_router(v3_public_super_admin.router)
app.include_router(v3_password_reset.router)
app.include_router(v3_store.router)

UPLOAD_ROOT = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_ROOT, exist_ok=True)
app.mount("/api/v3/uploads", StaticFiles(directory=UPLOAD_ROOT), name="uploads")

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_seed_data():
    await ensure_v1_seed_data()
    await v2_seed()
    await v3_seed()
    await deactivate_legacy_demo_admin()
    await migrate_branch_stages()
    start_auto_sync_scheduler()


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()


logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)
