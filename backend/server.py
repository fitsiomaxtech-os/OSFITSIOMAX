from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.middleware.cors import CORSMiddleware
import os
import logging

from database import client
from seed import ensure_v1_seed_data, v2_seed, v3_seed, migrate_branch_stages, migrate_consultation_stages, migrate_head_consultation_stages, deactivate_legacy_demo_admin, sync_head_physio_doctors, consolidate_head_physio_doctors, retire_experts_without_a_login, backfill_login_history_from_sessions, normalize_session_item_prices, normalize_lead_session_package_prices, backfill_branch_codes, backfill_patient_numbers, ensure_rnr_stage, ensure_branch_admin_stages, undo_branch_leads_stage
from routers.v3_google_sheets import start_auto_sync_scheduler
from routers import v1, v2, v3_auth, v3_config, v3_leads, v3_branch_admin, v3_appointments, v3_sheets, v3_dashboard, v3_head_physio, v3_finance, v3_head_physio_board, v3_physio_board, v3_session_assign, v3_patient_view, v3_marketing, v3_stages, v3_hr, v3_lead_fields, v3_branch_mgmt, v3_google_sheets, v3_packages, v3_public_super_admin, v3_password_reset, v3_store, v3_consult_appointments, v3_reviews, v3_patient_portal, v3_testimonials, v3_recruitment, v3_diet, v3_lead_documents, v3_inventory, v3_text_presets, v3_shifts

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
app.include_router(v3_diet.router)
app.include_router(v3_lead_documents.router)
app.include_router(v3_session_assign.router)
app.include_router(v3_patient_view.router)
app.include_router(v3_marketing.router)
app.include_router(v3_stages.router)
app.include_router(v3_hr.router)
app.include_router(v3_text_presets.router)
app.include_router(v3_lead_fields.router)
app.include_router(v3_branch_mgmt.router)
app.include_router(v3_google_sheets.router)
app.include_router(v3_packages.router)
app.include_router(v3_public_super_admin.router)
app.include_router(v3_password_reset.router)
app.include_router(v3_store.router)
app.include_router(v3_consult_appointments.router)
app.include_router(v3_reviews.router)
app.include_router(v3_patient_portal.router)
app.include_router(v3_testimonials.router)
app.include_router(v3_recruitment.router)
app.include_router(v3_inventory.router)
app.include_router(v3_shifts.router)

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
    await ensure_rnr_stage()
    # Must follow migrate_branch_stages: that one may re-seed the whole sales list from the
    # built-in defaults, which would drop the two stages this adds on top of it.
    await ensure_branch_admin_stages()
    # Rollback of the real "Leads" stage. Must follow the above, which puts Branch Assign
    # back in place for the leads this returns to it.
    await undo_branch_leads_stage()
    await migrate_consultation_stages()
    await migrate_head_consultation_stages()
    await normalize_session_item_prices()
    await normalize_lead_session_package_prices()
    await backfill_branch_codes()
    await backfill_patient_numbers()
    await sync_head_physio_doctors()
    # Must follow the sync above: that one creates any missing record, this one collapses
    # every Head Physio's records down to the single branchless one they should have.
    await consolidate_head_physio_doctors()
    # Anyone whose login was switched off or deleted before that followed through to
    # their expert profile. Without this they stay in every consultant list.
    await retire_experts_without_a_login()
    await backfill_login_history_from_sessions()
    await v3_inventory.ensure_inventory_indexes()
    start_auto_sync_scheduler()


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()


logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)
