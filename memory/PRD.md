# FITSIOMAX OS PRD

## Original Problem Statement
Build FITSIOMAX OS - multi-role SaaS for physiotherapy/fitness business with:
- 6 Roles: Super Admin, Business Dev, Pre-sales, Branch Admin, Head Physio, Physio
- Lead pipeline: Google Sheets -> Pre-sales -> Branch -> Appointment
- Branch management, doctor scheduling, appointment booking

## What's Implemented

### Login & Auth
- JWT-based auth with 6 roles, demo user dropdown for quick login
- Password hashing with bcrypt (auto-upgrades plain-text passwords on login)

### Business Development Dashboard (5 Tabs)
- Dashboard: Metrics, pipeline, source/branch breakdown, recent leads
- Branches: Branch list + create form with admin user (Add/Edit/Delete)
- Lead Master: Full leads table with qualify/assign
- Google Sheet Connection: Create + mapping + JSON sync
- Lead Source: Aggregation with stage breakdown

### Pre-sales Board (Full Redesign)
- Stage metric cards, search, date filter, Kanban/List toggle, stage tabs
- Add New Lead popup, Lead Detail Modal (Overview, Remarks, Follow-up, Activity)
- Branch Picker Popup, Appointment Booking Flow (Calendly-style)

### Branch Admin Board (3 Tabs)
#### Tab 1: Appointment (renamed from Patient Pipeline — Feb 2026)
- **8-stage Kanban**: New Appointment · Qualified · Portfolio · Follow Up · Appointment Date & Time · Branch · Assigned Physio · Cancelled
- **Clickable dashboard cards** above the kanban — click any card (e.g. "Qualified · 5") to filter the kanban to that single stage; click again or "Clear" to reset; "All Stages" card shows full board.
- One-time idempotent migration (`seed.migrate_branch_stages`) maps legacy stage names ("Call & Confirm", "Head Physio Appointment", "Consultation Fee Collected", "Consultation Done", "Follow-up Package Upsell", "Package Paid", "Jr. Physio Assigned") → new stages on backend startup.
- `pipeline_stages` collection auto-reseeded with new sales-type stages.
- Backend `v3_branch_admin.assign_physio` now sets `branch_stage="Assigned Physio"`; `collect_fee` no longer auto-changes stage.

#### Tab 2: Head Physio Calendar
- Left: Doctor list + Add Head Physio (creates user + doctor)
- Right: Calendly-style calendar — month nav, time slot grid (8AM-8PM), duration (15/30/45/60m), consultation type (Initial/Follow-up/Review), batch save/discard

#### Tab 3: Finance Board (NEW - Feb 2026)
- Summary cards: Total Revenue, Consultation Fees, Package Payments, Pending Collection
- Filters: Fee type toggle (All/Consultation/Package), patient search, date range
- Transactions table: Patient, Type badge, Amount, Details (weeks), Collected By, Date, Stage
- Footer with transaction count + total

### Multi-Role Session Lifecycle (NEW - Feb 2026) ✅
- Head Physio Board: My Patients + Weekly Reviews tabs. Recommend package (weeks + sessions/week + amount), file weekly assessment with internal notes hidden from patient.
- Branch Admin: package-recommendations panel + Assign Sessions to Jr. Physio + Create Jr. Physio account.
- Jr. Physio Board (PhysioBoard): Today / Calendar / Patients views. Complete a session with remarks. Submit weekly self-assessment.
- Patient View token endpoint (`/api/v3/patient/view/{token}`): patient-facing JSON only — strips `head_physio_notes`, `head_physio_suggestions`, `head_physio_id`, `consultation_fee`, `package_amount`. Validated by iteration_21 tests for no internal-data leak.

### Code-Review Pass (Feb 2026) ✅
**Applied (cheap wins, no behaviour change):**
- Fixed array-index `key` in MarketingBoard Performance lists (Leads-per-Pre-Sales & Deals-per-Sales) → use `r.name`.
- Fixed array-index `key` + `data-testid` in BranchDetailPage post-treatment reviews → composite `${lead_id}-${week}`.
- Replaced silent `.catch(() => {})` and `} catch { /* silent */ }` blocks with `console.warn` in 8 files (LeadEditModal, BranchManagementBoard, HRBoard, CreateLeadModal, MarketingBoard, BusinessLeadsDashboard, PreSalesBoard, CRMPage). Failures are now debuggable without spamming user toasts.

**Triaged as false positives / skipped (with reasoning):**
- "Hardcoded secrets in test files" — these are PUBLIC demo seed credentials (`admin123` etc.) documented in `/app/memory/test_credentials.md`. Not secrets.
- "Hardcoded API keys in LoginPage.jsx" — the demo-user dropdown values. Intentional.
- "localStorage tokens" — switching to httpOnly cookies needs backend CSRF/SameSite redesign + cookie domain plumbing through the Emergent proxy. Deferred to deployment hardening phase.
- `utils.py:15` `is not None` — correct Python idiom, not a `is "literal"` bug.
- "useEffect missing deps (53)" — most are eslint-react-hooks false positives where the missing deps are module-level imports (`toast`, `console`, axios fns). Adding them all would cause infinite loops; not changed without specific repro.

**Deferred to backlog (P2 — works fine today):**
- Refactor `v3_finance.get_branch_finance`, `v3_branch_mgmt.branch_detail`, `v1.import_from_sheets`, `v3_session_assign.assign_sessions` into smaller helpers.
- Split CRMPage (740 lines), PreSalesBoard LeadDetailModal (534 lines), HeadPhysioCalendar (439 lines), BranchAdminBoard BranchLeadModal (361 lines).
- Add type hints to `server.py` + test files (currently 38%).

### Branch Detail Drill-in (NEW - Feb 2026) ✅
- Clicking any branch card in Branch Management → comprehensive `BranchDetailPage` (not a modal).
- 4 tabs: **Summary** (Name, Address, Opened Date, Opening Hours, Vertical, Created + Branch Admin contact card), **Staff** (4 toggle cards: branch admins / head physios / physios / doctors with full member listing), **Performance** (3 KPI cards + 4 sub-tabs: Appointments / Consultations / Packages / Follow-ups, each with Mini stats + ListTable), **Head Physio** (head-physio calendars, physio calendars, weekly post-treatment reviews).
- New endpoint `GET /api/v3/branch-mgmt/{id}/detail` returns the full bundle in one call.
- `V3BranchOut` + `V3BranchUpdate` extended with `opened_date`, `opening_hours`. Edit dialog persists both fields.
- Tested in iter 27: backend 10/10 PASS · frontend ~100% PASS · zero new bugs.

### Branch Management Module (NEW - Feb 2026) ✅
- New Super Admin top-level tab **"Branch Management"** (6th tab). Two sub-tabs:
  - **Creation & Manager**: 4 KPI cards (Total Branches / Available Managers / Active Leads / Total Doctors), branch cards with manager block + 4 stat tiles + reassign link + edit/delete; Add Branch dialog requires `branch_name + address + admin_user_id` (dropdown of un-assigned branch_admin users only); Edit dialog hides admin select; dedicated Reassign Manager dialog wires PATCH /admin.
  - **Performance**: 4 overall KPI cards + summary table with View → drill-in dialog showing 10 stat tiles (leads/completed/conversion/appointments/consultation_fees/package_revenue/total_revenue/doctors/head_physios/physios) + stage_breakdown horizontal bars.
- Backend `/app/backend/routers/v3_branch_mgmt.py` — endpoints: `GET /branch-mgmt` (enriched list), `POST /with-existing-admin`, `PATCH /{id}/admin`, `GET /{id}/performance`, `GET /performance-summary`. Strict role-gating: super_admin only for writes; super_admin/business_dev/marketing_head for reads.
- Inverse user.branch_id sync on create & reassign (previous admin unlinked).
- Tested in iter 26: backend 17/17 PASS · frontend ~100% (all 6 nav tabs, KPIs, dialogs, performance drill-in) · zero new bugs.

### Comprehensive Add-Lead Modal + Custom Fields (NEW - Feb 2026) ✅
- Pre-Sales CRM "Create Lead" now opens a full comprehensive modal mapped to physio patients (matches user's screenshot):
  - Standard: Name*, Source, Email, Phone*, Alternative Phone, Address, City, State.
  - Patient Details: Department (Offline Physio / Online Physio / Fitness), Condition, Months of Pain, Age, Gender, Occupation, Expected Consultation Date.
  - When Department=Offline Physio, branch radio cards appear with Branch Admin name.
  - **+ Add Field** (super_admin only) to create a custom field on the fly; **Manage** dialog to edit/delete custom fields.
- Backend: new `/api/v3/lead-fields` CRUD (collection `custom_lead_fields`). Slugified keys (`Insurance Provider` → `insurance_provider`). Field types: text/textarea/number/date/email/phone/select.
- Extended `V3LeadCreate` + `V3LeadOut` + `V3LeadUpdate` with `alternative_phone, address, city, state, condition`. `extra_fields` upgraded to `Dict[str, Any]` so numeric/object custom values persist.
- Tested in iter 25: backend 13/13 PASS · frontend ~95% PASS · zero new bugs.

### HR Module (NEW - Feb 2026) ✅
- New Super Admin top tab **"HR Admin"** (5th tab alongside Master / Marketing / Pre-Sales / Pipeline Stages).
- 3 sub-tabs: **Dashboard** (5 KPI cards + Monthly Salary Budget + Department Strength grid), **Employees** (Active/Left filter + search + 5-tab Add/Edit modal Personal/Employment/ID & Docs/Address & Emergency/Salary & Bank), **Roles & Credentials** (user table with linked-employee chip, role select, password reset modal, deactivate, Create User dialog that links to any employee + bcrypt-hashed password).
- New collection `employees` (auto employee_code EMP0001 — race-safe via max(employee_code)+1).
- `users` extended with `employee_id` link.
- Endpoints: `/api/v3/hr/dashboard`, `/meta`, `/employees` CRUD, `/users` CRUD with linked_employee enrichment + role/password endpoints, `/branch-admin-candidates` (active branch_admins for branch picker).
- End-to-end flow validated (iter 24): create Employee → Create User (branch_admin) → user appears in candidates → user can log in.
- Tested: backend 23/23 PASS + frontend ~95% PASS (full nav, all sub-tabs, employee/user creation flows).

### Pre-Sales CRM + Dynamic Pipeline Stages (NEW - Feb 2026) ✅
- New Super Admin top tabs: **Pre-Sales CRM** and **Pipeline Stages** (alongside Master / Marketing Board).
- Dynamic pipeline stages — backend `/app/backend/routers/v3_stages.py` with CRUD + reorder + safe rename (propagates rename to existing lead.stage / lead.branch_stage) + delete-protect (409 if leads still reference it). Seeds defaults from V3_STAGES (6 pre-sales) + V3_BRANCH_STAGES (8 sales) on first GET.
- Pre-Sales CRM page: KPI cards per stage, search, source filter, sort, stage chips, Create Lead dialog, leads table with masked phone/email, eye-icon opens Lead Detail Dialog.
- Lead Detail Dialog: Overview tab + Move-to-Stage buttons rendered dynamically from stages. Edit button opens Lead Edit Modal.
- Lead Edit Modal: name, email, phone, location, expected_consultation_date, months_of_pain, age, gender, occupation, **department** (Offline Physio / Online Physio / Fitness). When `department=offline_physio`, branch picker section appears showing each branch + Branch Admin name + address as radio cards.
- V3LeadUpdate + V3LeadOut extended with the new fields (location, expected_consultation_date, months_of_pain, age, gender, occupation, department, assigned_user_id, assigned_user_name).
- Pre-sales role users also see the same `PreSalesCRM` component (replaced the old `PreSalesBoard` for that role).
- Tested in iteration_23: 10/10 backend + frontend nav/KPI/chips/role-gating all green.

### Marketing Module (NEW - Feb 2026) ✅
- New Super Admin top-level tab ("Marketing Board") alongside the existing "Master View" — no router change.
- 5 sub-tabs: Overview · Lead Sources · All Leads · Team & Distribution · Performance.
- **Overview**: 4 KPI cards (pre-sales leads, sales leads, active sources, conversion %), Leads-by-Source bar list, Recent Leads table.
- **Lead Sources**: multi-source CSV/Sheet ingestion — paste headers, auto-map to standard Fitsiomax fields (name, phone, email, vertical, condition, age, preferred_branch, budget, notes). Sync via JSON rows; dedupe by phone last-10-digits (`phone_normalized`); auto-run round-robin assignment.
- **All Leads**: filter by stage_type / source / assignee / search; bulk delete; per-row reassign; pagination; MaskedContact reveals phone/email on hover.
- **Team & Distribution**: round-robin engine (Tier1=pre_sales, Tier2=branch_admin); Auto-Distribute toggle; "Refresh Team from Users" auto-detects role members; create new team member with bcrypt-hashed password.
- **Performance**: Conversion funnel using Fitsiomax stages, leads/agent (pre-sales), deals-closed/agent (sales).
- Backend: `/app/backend/routers/v3_marketing.py` — 16 endpoints. New Mongo collections: `marketing_sources`, `marketing_settings` (singleton).
- 11/11 backend tests + frontend smoke + role-gating + master-view regression (iteration_22).

### Backend Architecture (Modular - Feb 2026)
- server.py (entry), database.py, security.py, deps.py, seed.py, constants.py, utils.py
- Schemas: schemas/v1.py, v2.py, v3.py
- Routers: v3_auth, v3_config, v3_leads, v3_branch_admin, v3_appointments, v3_sheets, v3_dashboard, v3_head_physio, v3_finance, v3_head_physio_board, v3_physio_board, v3_session_assign, v3_patient_view, v3_marketing
- Legacy: v1.py, v2.py
- Tests: test_session_lifecycle_iteration21.py, test_marketing_iteration22.py (all green)

### Deployment
- `/app/memory/DEPLOYMENT_PLAYBOOK.md` saved — Hostinger VPS + GitHub + PM2 + Nginx + Let's Encrypt recipe.

## Prioritized Backlog

### P0
- Domain → VPS connection (user is starting deployment; awaiting domain name + VPS IP)
- Live end-to-end Google Sheets OAuth — **manual user verification pending** (technical wiring complete; PKCE fix applied Feb 2026)

### Google Sheets OAuth (Feb 2026) ✅ Technical wiring complete — minimal scope
- **Scopes requested:** `https://www.googleapis.com/auth/spreadsheets.readonly` ONLY. No Drive, no email, no profile, no OpenID (user explicitly requested privacy-first).
- Trade-off: no "Browse my Sheets" picker (Drive scope removed). Users **paste the Google Sheet URL** in Add Source → the spreadsheet ID is auto-extracted client-side via regex `/spreadsheets/d/([a-zA-Z0-9_-]+)/`.
- Backend `/api/v3/marketing/google-sheets/{status,auth,callback,disconnect,pull/{id}}` (`routers/v3_google_sheets.py`). `/spreadsheets` endpoint returns 400 by design (no Drive scope).
- **PKCE fix**: `code_verifier` is persisted in `google_sheets_states` alongside `state` so `/callback` can complete the token exchange (google-auth-oauthlib 1.3.0 auto-enables PKCE on web flows).
- Tokens stored in `google_sheets_tokens` collection (single shared doc `_company_shared_`).
- Frontend Marketing Board → Lead Sources: "Continue with Google" → Google consent (Sheets only) → callback → redirect with `?sheets_connect=success`.
- CRMPage + MarketingBoard auto-deep-link to **Marketing → Lead Sources** when callback param present.
- Pull rows via Sheets API → same dedupe + round-robin engine as JSON sync.
- `.env` keys: `GOOGLE_SHEETS_CLIENT_ID`, `GOOGLE_SHEETS_CLIENT_SECRET`, `GOOGLE_SHEETS_REDIRECT_URI`, `FRONTEND_URL`.
- **User requirement on the sheet:** must be accessible to the connected Google account OR shared as "Anyone with the link can view".

### P1
- Patient-facing magic-link email (Resend / SendGrid) when Head Physio recommends a package
- Marketing module: round-robin index advance after successful insert (currently advances before)
- Hide super-admin-only API calls from non-super_admin roles (currently triggers 403 console warnings on Pre-sales view)

### P2
- Visual weekly calendar for Branch Admin
- Drag-and-drop on Kanban boards
- Notification system
- Auto-sync scheduler for Google Sheets
