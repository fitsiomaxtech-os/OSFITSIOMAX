import axios from "axios";
import { loadSession, clearSession } from "@/lib/session";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

const api = axios.create({
  baseURL: `${BACKEND_URL}/api/v3`,
});

api.interceptors.request.use((config) => {
  const token = loadSession()?.token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Auto-logout on stale/invalid JWT so we don't show a runtime error overlay
let _redirecting = false;
api.interceptors.response.use(
  (resp) => resp,
  (error) => {
    const status = error?.response?.status;
    const url = error?.config?.url || "";
    const isAuthCall = url.includes("/auth/login") || url.includes("/auth/logout");
    if (status === 401 && !isAuthCall && !_redirecting) {
      _redirecting = true;
      clearSession();
      try { window.dispatchEvent(new Event("auth:expired")); } catch (e) { /* noop */ }
      setTimeout(() => { _redirecting = false; window.location.reload(); }, 100);
    }
    return Promise.reject(error);
  },
);

export const apiLogin = async (email, password) => {
  const { data } = await api.post("/auth/login", { email, password });
  return data;
};

export const apiMe = async () => (await api.get("/auth/me")).data;

export const apiLogout = async () => {
  const { data } = await api.post("/auth/logout");
  return data;
};

export const forgotPassword = async (identifier) => (await api.post("/auth/forgot-password", { identifier })).data;
export const verifyResetOtp = async (payload) => (await api.post("/auth/verify-reset-otp", payload)).data;
export const validateResetToken = async (token) => (await api.get("/auth/reset-password/validate", { params: { token } })).data;
export const resetPassword = async (payload) => (await api.post("/auth/reset-password", payload)).data;

export const getRoleSelectionMock = async () => {
  return {
    leads_preview: [
      {
        id: "lead_01",
        name: "Priya",
        phone: "9000000001",
        source_tab: "Instagram",
        stage: "New Lead",
      },
      {
        id: "lead_02",
        name: "Arun",
        phone: "9000000002",
        source_tab: "Meta",
        stage: "Pre-sales Qualified",
      },
    ],
  };
};

export const getVerticals = async () => (await api.get("/verticals")).data;
export const createVertical = async (payload) => (await api.post("/verticals", payload)).data;

export const getBranches = async () => (await api.get("/branches")).data;
export const createBranch = async (payload) => (await api.post("/branches", payload)).data;
export const updateBranch = async (branchId, payload) => (await api.put(`/branches/${branchId}`, payload)).data;
export const deleteBranch = async (branchId) => (await api.delete(`/branches/${branchId}`)).data;

export const getDoctors = async (params) => (await api.get("/doctors", { params })).data;
export const createDoctor = async (payload) => (await api.post("/doctors", payload)).data;
export const deleteDoctor = async (doctorId) => (await api.delete(`/doctors/${doctorId}`)).data;
export const addDoctorSlots = async (doctorId, payload) => (await api.post(`/doctors/${doctorId}/slots`, payload)).data;
export const getAvailableDoctors = async (params) => (await api.get("/doctors/available", { params })).data;

export const getLeads = async (params) => (await api.get("/leads", { params })).data;
export const createManualLead = async (payload) => (await api.post("/leads/manual", payload)).data;
export const updateLead = async (leadId, payload) => (await api.put(`/leads/${leadId}`, payload)).data;
export const deleteLead = async (leadId) => (await api.delete(`/leads/${leadId}`)).data;
export const getPortalAccountStatus = async (leadId) => (await api.get(`/leads/${leadId}/portal-account`)).data;
export const createOrResetPortalAccount = async (leadId, payload) => (await api.post(`/leads/${leadId}/portal-account`, payload)).data;

export const listTestimonials = async () => (await api.get("/testimonials/manage")).data;
export const addTestimonial = async (payload) => (await api.post("/testimonials", payload)).data;
export const deleteTestimonial = async (id) => (await api.delete(`/testimonials/${id}`)).data;
export const rnrAttempt = async (leadId) => (await api.post(`/leads/${leadId}/rnr-attempt`)).data;
export const scheduleFollowUp = async (leadId, payload) => (await api.post(`/leads/${leadId}/follow-up`, payload)).data;
export const rescheduleFollowUp = async (leadId, followupId, payload) => (await api.post(`/leads/${leadId}/follow-up/${followupId}/reschedule`, payload)).data;
export const scheduleAppointment = async (leadId, payload) => (await api.post(`/leads/${leadId}/schedule-appointment`, payload)).data;
export const leadActivity = async (leadId) => (await api.get(`/leads/${leadId}/activity`)).data;
export const qualifyLead = async (leadId) => (await api.post(`/leads/${leadId}/qualify`)).data;
export const assignLeadBranch = async (leadId, payload) => (await api.post(`/leads/${leadId}/assign-branch`, payload)).data;
export const confirmLead = async (leadId) => (await api.post(`/leads/${leadId}/confirm`)).data;
export const bookLeadAppointment = async (leadId, payload) => (await api.post(`/leads/${leadId}/book-appointment`, payload)).data;

export const getAppointments = async (params) => (await api.get("/appointments", { params })).data;
export const completeAppointment = async (appointmentId) => (await api.post(`/appointments/${appointmentId}/complete`)).data;

export const createSheetConnection = async (payload) => (await api.post("/sheets/connections", payload)).data;
export const getSheetConnections = async () => (await api.get("/sheets/connections")).data;
export const saveSheetMapping = async (connectionId, payload) =>
  (await api.post(`/sheets/connections/${connectionId}/mapping`, payload)).data;
export const syncSheetConnection = async (connectionId, payload) =>
  (await api.post(`/sheets/connections/${connectionId}/sync`, payload)).data;

export const getMasterBoard = async () => (await api.get("/boards/master")).data;
export const getBranchMasterBoard = async () => (await api.get("/boards/branch-master")).data;
export const getMasterControl = async (params = {}) => (await api.get("/boards/master-control", { params })).data;
export const getDashboardOverview = async (params = {}) => (await api.get("/dashboard/overview", { params })).data;
export const getBranchBoardOld = async (branchId) => (await api.get(`/boards/branch/${branchId}`)).data;

export const getTeamMembers = async (params) => (await api.get("/team-members", { params })).data;
export const addTeamMember = async (payload) => (await api.post("/team-members", payload)).data;

export const getBdSummary = async (params = {}) => (await api.get("/dashboard/bd-summary", { params })).data;
export const getLeadSources = async () => (await api.get("/lead-sources")).data;

export const getLeadRemarks = async (leadId) => (await api.get(`/leads/${leadId}/remarks`)).data;
export const addLeadRemark = async (leadId, payload) => (await api.post(`/leads/${leadId}/remarks`, payload)).data;
export const getLeadFollowUps = async (leadId) => (await api.get(`/leads/${leadId}/follow-ups`)).data;
export const addLeadFollowUp = async (leadId, payload) => (await api.post(`/leads/${leadId}/follow-ups`, payload)).data;
export const completeLeadFollowUp = async (leadId, followupId) => (await api.post(`/leads/${leadId}/follow-ups/${followupId}/complete`)).data;
export const getLeadActivity = async (leadId) => (await api.get(`/leads/${leadId}/activity`)).data;
export const moveLeadStage = async (leadId, payload) => (await api.post(`/leads/${leadId}/move-stage`, payload)).data;
export const bookAppointment = async (leadId, payload) => (await api.post(`/leads/${leadId}/book-appointment`, payload)).data;

export const getBranchBoard = async (branchId) => (await api.get(`/branch-board/${branchId}`)).data;
export const moveBranchStage = async (leadId, payload) => (await api.post(`/leads/${leadId}/branch-stage`, payload)).data;
export const schedulePortfolio = async (leadId, payload) => (await api.post(`/leads/${leadId}/schedule-portfolio`, payload)).data;
export const scheduleBranchFollowUp = async (leadId, payload) => (await api.post(`/leads/${leadId}/branch-follow-up`, payload)).data;
export const rescheduleBranchFollowUp = async (leadId, followupId, payload) => (await api.post(`/leads/${leadId}/branch-follow-up/${followupId}/reschedule`, payload)).data;
export const collectFee = async (leadId, payload) => (await api.post(`/leads/${leadId}/collect-fee`, payload)).data;
export const assignPhysio = async (leadId, payload) => (await api.post(`/leads/${leadId}/assign-physio`, payload)).data;
export const scheduleBranchAppointment = async (leadId, payload) => (await api.post(`/leads/${leadId}/schedule-branch-appointment`, payload)).data;
// The patient's own confirmation page. Server-rendered HTML rather than an SPA route:
// chat apps fetch a shared link with a crawler that doesn't run JavaScript, and only
// real HTML gets them to draw the preview card above the message.
export const publicAppointmentUrl = (token) => `${BACKEND_URL}/api/v3/public/appointment/${token}`;
export const getConsultationsBoard = async (branchId, pipeline) => (await api.get(`/branch-admin/consultations/${branchId}/board`, { params: pipeline ? { pipeline } : {} })).data;
// Consultation Appointment Scheduling (Branch Admin > Calendar > Schedule)
export const listConsultAppointments = async (branchId) => (await api.get(`/branch-admin/${branchId}/consult-appointments`)).data;
export const getConsultAvailability = async (branchId, date, doctorId) => (await api.get(`/branch-admin/${branchId}/consult-availability`, { params: { date, doctor_id: doctorId } })).data;
export const getConsultDay = async (branchId, date) => (await api.get(`/branch-admin/${branchId}/consult-day`, { params: { date } })).data;
export const createConsultAppointment = async (branchId, payload) => (await api.post(`/branch-admin/${branchId}/consult-appointments`, payload)).data;
export const updateConsultAppointment = async (apptId, payload) => (await api.patch(`/branch-admin/consult-appointments/${apptId}`, payload)).data;
export const cancelConsultAppointment = async (apptId) => (await api.post(`/branch-admin/consult-appointments/${apptId}/cancel`)).data;
export const getAvailableExperts = async (branchId, date, time, leadId) => (await api.get(`/branch-admin/available-experts/${branchId}`, { params: { date, ...(time ? { time } : {}), ...(leadId ? { lead_id: leadId } : {}) } })).data;
export const getAvailableDates = async (branchId, month, leadId) => (await api.get(`/branch-admin/available-dates/${branchId}`, { params: { month, ...(leadId ? { lead_id: leadId } : {}) } })).data;

// ---- Post-treatment Review: Physio raises -> Branch Admin sends -> Head Physio writes it
export const physioReviews = async (physioId) => (await api.get("/physio/reviews", { params: physioId ? { physio_id: physioId } : {} })).data;
export const physioRaiseReview = async (leadId, payload, physioId) => (await api.post(`/physio/reviews/raise/${leadId}`, payload, { params: physioId ? { physio_id: physioId } : {} })).data;
export const branchReviews = async (branchId, status) => (await api.get(`/branch-admin/reviews/${branchId}`, { params: status ? { status } : {} })).data;
export const branchSendReview = async (reviewId, payload) => (await api.post(`/branch-admin/reviews/${reviewId}/send`, payload)).data;
export const hpReviews = async () => (await api.get("/head-physio/reviews")).data;
export const hpCompleteReview = async (reviewId, payload) => (await api.post(`/head-physio/reviews/${reviewId}/complete`, payload)).data;
export const getCalendarAvailability = async (branchId, month) => (await api.get(`/branch-admin/calendar-availability/${branchId}`, { params: { month } })).data;
export const getDaySlots = async (branchId, date) => (await api.get(`/branch-admin/day-slots/${branchId}`, { params: { date } })).data;
export const getExpertCalendar = async (expertId, month) => (await api.get(`/branch-admin/expert-calendar/${expertId}`, { params: { month } })).data;
export const listPackages = async (params = {}) => (await api.get("/packages", { params })).data;
export const createPackage = async (payload) => (await api.post("/packages", payload)).data;
export const updatePackage = async (id, payload) => (await api.put(`/packages/${id}`, payload)).data;
export const deletePackage = async (id) => (await api.delete(`/packages/${id}`)).data;
export const sellPackage = async (leadId, payload) => (await api.post(`/leads/${leadId}/sell-package`, payload)).data;
export const moveConsultationStage = async (leadId, consultation_stage) => (await api.post(`/leads/${leadId}/move-consultation-stage`, { consultation_stage })).data;
export const moveHeadConsultationStage = async (leadId, head_consultation_stage) => (await api.post(`/leads/${leadId}/move-head-consultation-stage`, { head_consultation_stage })).data;
export const scheduleConsultationFollowUp = async (leadId, payload) => (await api.post(`/leads/${leadId}/consultation-follow-up`, payload)).data;
export const rescheduleConsultationFollowUp = async (leadId, followupId, payload) => (await api.post(`/leads/${leadId}/consultation-follow-up/${followupId}/reschedule`, payload)).data;

export const getDoctorCalendar = async (doctorId) => (await api.get(`/doctors/${doctorId}/calendar`)).data;
export const addCalendarSlots = async (doctorId, payload) => (await api.post(`/doctors/${doctorId}/calendar-slots`, payload)).data;
export const removeCalendarSlots = async (doctorId, payload) => (await api.post(`/doctors/${doctorId}/remove-slots`, payload)).data;

export const getBranchFinance = async (params = {}) => {
  const query = new URLSearchParams();
  if (params.fee_type) query.set("fee_type", params.fee_type);
  if (params.start_date) query.set("start_date", params.start_date);
  if (params.end_date) query.set("end_date", params.end_date);
  if (params.search) query.set("search", params.search);
  if (params.branch_id) query.set("branch_id", params.branch_id);
  return (await api.get(`/branch/finance?${query.toString()}`)).data;
};

export const getRevenueOverview = async (params = {}) => (await api.get("/finance/revenue-overview", { params })).data;

export const getClientTransactionHistory = async (leadId) => (await api.get(`/finance/client/${leadId}`)).data;
export const markInstallmentPaid = async (leadId, installmentNumber, payload) => (await api.post(`/finance/installment/${leadId}/${installmentNumber}/mark-paid`, payload)).data;

export const getHPMyCalendar = async (branchId) => (await api.get("/head-physio/my-calendar", { params: branchId ? { branch_id: branchId } : {} })).data;
export const getHPMyPatients = async (branchId) => (await api.get("/head-physio/my-patients", { params: branchId ? { branch_id: branchId } : {} })).data;
export const hpRecommendPackage = async (payload) => (await api.post("/head-physio/recommend-package", payload)).data;
export const hpGetSessions = async (leadId) => (await api.get(`/head-physio/sessions/${leadId}`)).data;
export const hpGetAssessments = async (leadId) => (await api.get(`/head-physio/weekly-assessments/${leadId}`)).data;
export const hpWeeklyReview = async (leadId, week, payload) => (await api.post(`/head-physio/weekly-review/${leadId}/${week}`, payload)).data;

export const physioConsultations = async (physioId) => (await api.get("/physio/consultations", { params: physioId ? { physio_id: physioId } : {} })).data;
export const physioCompleteConsultation = async (leadId, physioId) => (await api.post(`/physio/leads/${leadId}/complete-consultation`, null, { params: physioId ? { physio_id: physioId } : {} })).data;
export const physioToday = async (physioId) => (await api.get("/physio/today", { params: physioId ? { physio_id: physioId } : {} })).data;
export const physioCalendar = async (month, year, physioId) => (await api.get("/physio/calendar", { params: { month, year, ...(physioId ? { physio_id: physioId } : {}) } })).data;
export const physioPatients = async (physioId) => (await api.get("/physio/patients", { params: physioId ? { physio_id: physioId } : {} })).data;
export const physioPatientDetail = async (leadId, physioId) => (await api.get(`/physio/patient/${leadId}`, { params: physioId ? { physio_id: physioId } : {} })).data;
export const physioSessions = async (leadId) => (await api.get(`/physio/sessions/${leadId}`)).data;
export const physioCompleteSession = async (sessionId, payload) => (await api.post(`/physio/sessions/${sessionId}/complete`, payload)).data;
export const physioWeeklyAssessment = async (leadId, week, payload, physioId) => (await api.post(`/physio/weekly-assessment/${leadId}/${week}`, payload, { params: physioId ? { physio_id: physioId } : {} })).data;

export const getBranchRecommendations = async () => (await api.get("/branch/package-recommendations")).data;
export const assignSessions = async (payload) => (await api.post("/branch/assign-sessions", payload)).data;
export const createJrPhysio = async (payload) => (await api.post("/branch/jr-physios", payload)).data;

export const patientView = async (token) => (await api.get(`/patient/view/${token}`)).data;


// Marketing Module
export const mkDashboard = async () => (await api.get("/marketing/dashboard")).data;
export const mkGetDistribution = async () => (await api.get("/marketing/distribution-settings")).data;
export const mkPatchDistribution = async (payload) => (await api.patch("/marketing/distribution-settings", payload)).data;
export const mkRefreshDistribution = async () => (await api.post("/marketing/distribution-settings/refresh")).data;
export const mkGetTeam = async () => (await api.get("/marketing/team-members")).data;
export const mkCreateTeamMember = async (payload) => (await api.post("/marketing/team-members", payload)).data;
export const mkAllLeads = async (params = {}) => {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== "") q.set(k, v); });
  return (await api.get(`/marketing/all-leads?${q.toString()}`)).data;
};
export const mkAssignLead = async (leadId, assignedTo) => (await api.post(`/marketing/assign-lead/${leadId}?assigned_to=${assignedTo}`)).data;
export const mkDeleteLead = async (leadId) => (await api.delete(`/marketing/leads/${leadId}`)).data;
export const mkBulkDelete = async (lead_ids) => (await api.post("/marketing/leads/bulk-delete", { lead_ids })).data;
export const mkGetSources = async () => (await api.get("/marketing/sources")).data;
export const mkCreateSource = async (payload) => (await api.post("/marketing/sources", payload)).data;
export const mkUpdateSource = async (sourceId, payload) => (await api.patch(`/marketing/sources/${sourceId}`, payload)).data;
export const mkDeleteSource = async (sourceId) => (await api.delete(`/marketing/sources/${sourceId}`)).data;
export const mkSyncSource = async (sourceId, rows) => (await api.post(`/marketing/sources/${sourceId}/sync`, { rows })).data;
export const mkPerformance = async () => (await api.get("/marketing/performance")).data;


// Pipeline Stages
export const stagesList = async (type) => (await api.get(`/stages${type ? `?type=${type}` : ""}`)).data;
export const stagesCreate = async (payload) => (await api.post("/stages", payload)).data;
export const stagesUpdate = async (id, payload) => (await api.patch(`/stages/${id}`, payload)).data;
export const stagesDelete = async (id) => (await api.delete(`/stages/${id}`)).data;
export const stagesReorder = async (items) => (await api.post("/stages/reorder", { items })).data;
export const resetAllLeads = async () => (await api.post("/admin/reset-all-leads", null, { params: { confirm: true } })).data;

// HR
export const hrDashboard = async () => (await api.get("/hr/dashboard")).data;
export const hrMeta = async () => (await api.get("/hr/meta")).data;
export const hrAddCustomRole = async (label) => (await api.post("/hr/roles", { label })).data;
export const hrEmployees = async (params = {}) => {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v) q.set(k, v); });
  return (await api.get(`/hr/employees${q.toString() ? `?${q.toString()}` : ""}`)).data;
};

// Branch Management
export const bmList = async () => (await api.get("/branch-mgmt")).data;
export const bmCreateWithExistingAdmin = async (payload) => (await api.post("/branch-mgmt/with-existing-admin", payload)).data;
export const bmReassignAdmin = async (branchId, admin_user_id) => (await api.patch(`/branch-mgmt/${branchId}/admin`, { admin_user_id })).data;
export const bmHeadPhysioCandidates = async () => (await api.get("/branch-mgmt/head-physio-candidates")).data;
export const bmAssignHeadPhysio = async (branchId, doctor_id) => (await api.patch(`/branch-mgmt/${branchId}/head-physio`, { doctor_id })).data;
export const bmPerformance = async (branchId) => (await api.get(`/branch-mgmt/${branchId}/performance`)).data;
export const bmPerformanceSummary = async () => (await api.get("/branch-mgmt/performance-summary")).data;
export const bmDetail = async (branchId) => (await api.get(`/branch-mgmt/${branchId}/detail`)).data;

// Google Sheets OAuth
export const gsStatus = async () => (await api.get("/marketing/google-sheets/status")).data;
export const gsAuthUrl = async () => (await api.get("/marketing/google-sheets/auth")).data;
export const gsDisconnect = async (secret) => (await api.post("/marketing/google-sheets/disconnect", { secret })).data;
export const gsVerifySecret = async (secret) => (await api.post("/marketing/google-sheets/verify-secret", { secret })).data;
export const gsListSpreadsheets = async (nameContains) => (await api.get(`/marketing/google-sheets/spreadsheets${nameContains ? `?name_contains=${encodeURIComponent(nameContains)}` : ""}`)).data;
export const gsPull = async (sourceId) => (await api.post(`/marketing/google-sheets/pull/${sourceId}`)).data;
export const gsAutoSyncSources = async () => (await api.get("/marketing/google-sheets/auto-sync/sources")).data;
export const gsAutoSyncToggle = async (sourceId, payload) => (await api.patch(`/marketing/google-sheets/auto-sync/sources/${sourceId}`, payload)).data;

export const hrCreateEmployee = async (payload) => (await api.post("/hr/employees", payload)).data;
export const hrUpdateEmployee = async (id, payload) => (await api.patch(`/hr/employees/${id}`, payload)).data;
export const hrDeleteEmployee = async (id) => (await api.delete(`/hr/employees/${id}`)).data;
export const hrUsers = async (params = {}) => {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v) q.set(k, v); });
  return (await api.get(`/hr/users${q.toString() ? `?${q.toString()}` : ""}`)).data;
};
export const hrCreateUser = async (payload) => (await api.post("/hr/users", payload)).data;
export const hrUpdateUser = async (id, payload) => (await api.patch(`/hr/users/${id}`, payload)).data;
export const hrUpdateUserRole = async (id, role) => (await api.patch(`/hr/users/${id}/role?role=${role}`)).data;
export const hrResetPassword = async (id, password) => (await api.patch(`/hr/users/${id}/reset-password?password=${encodeURIComponent(password)}`)).data;
export const hrDeactivateUser = async (id) => (await api.delete(`/hr/users/${id}`)).data;
export const hrActivateUser = async (id) => (await api.patch(`/hr/users/${id}/activate`)).data;
export const hrDeleteUserPermanent = async (id) => (await api.delete(`/hr/users/${id}/permanent`)).data;

export const requestSuperAdminOtp = async (payload) => (await api.post("/public/super-admin/request-otp", payload)).data;
export const verifySuperAdminOtp = async (payload) => (await api.post("/public/super-admin/verify-otp", payload)).data;

// Custom Lead Fields
export const leadFieldsList = async () => (await api.get("/lead-fields")).data;
export const leadFieldsCreate = async (payload) => (await api.post("/lead-fields", payload)).data;
export const leadFieldsUpdate = async (id, payload) => (await api.patch(`/lead-fields/${id}`, payload)).data;
export const leadFieldsDelete = async (id) => (await api.delete(`/lead-fields/${id}`)).data;

export const hrBranchAdminCandidates = async () => (await api.get("/hr/branch-admin-candidates")).data;

// FITSIO STORE
export const uploadStoreImage = async (file) => {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post("/store/upload-image", form);
  return data;
};
export const createStoreItem = async (payload) => (await api.post("/store/items", payload)).data;
export const listStoreItems = async (category, itemType) => {
  const params = {};
  if (category) params.category = category;
  if (itemType) params.item_type = itemType;
  return (await api.get("/store/items", { params })).data;
};
export const updateStoreItem = async (id, payload) => (await api.put(`/store/items/${id}`, payload)).data;
export const deleteStoreItem = async (id) => (await api.delete(`/store/items/${id}`)).data;
export const getStoreHistory = async (limit) => (await api.get("/store/history", { params: limit ? { limit } : {} })).data;
export const getPaymentHistory = async (limit) => (await api.get("/store/payment-history", { params: limit ? { limit } : {} })).data;
export const getFollowUpHistory = async (limit) => (await api.get("/store/follow-up-history", { params: limit ? { limit } : {} })).data;
export const getLoginHistory = async (limit) => (await api.get("/store/login-history", { params: limit ? { limit } : {} })).data;

export const saveLeadDiagnosis = async (leadId, diagnosis) => (await api.post(`/leads/${leadId}/diagnosis`, { diagnosis })).data;
export const sellStoreItem = async (leadId, payload) => (await api.post(`/leads/${leadId}/sell-store-item`, payload)).data;
export const collectPackagePayment = async (leadId, payload) => (await api.post(`/leads/${leadId}/collect-package-payment`, payload)).data;
export const collectTreatmentFee = async (leadId, payload) => (await api.post(`/leads/${leadId}/collect-treatment-fee`, payload)).data;
export const assignPhysioWithSessions = async (leadId, payload) => (await api.post(`/leads/${leadId}/assign-physio-sessions`, payload)).data;
export const saveConsultationDecision = async (leadId, payload) => (await api.post(`/leads/${leadId}/consultation-decision`, payload)).data;
export const markConsultationCompleted = async (leadId) => (await api.post(`/leads/${leadId}/mark-consultation-completed`)).data;

export const savePhysioDiagnosis = async (leadId, report, locked = false) => (await api.post(`/leads/${leadId}/physio-diagnosis`, { report, locked })).data;
export const unlockPhysioDiagnosis = async (leadId) => (await api.put(`/leads/${leadId}/physio-diagnosis/unlock`)).data;
export const saveTreatmentSummary = async (leadId, summary, locked = false) => (await api.post(`/leads/${leadId}/treatment-summary`, { summary, locked })).data;
export const unlockTreatmentSummary = async (leadId) => (await api.put(`/leads/${leadId}/treatment-summary/unlock`)).data;


// Recruitment — Human Resource Master View. Candidates live in their own collection and
// reference a stage by id, so nothing here passes a stage *name* around.
export const recruitmentBoard = async (params = {}) => {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v) q.set(k, v); });
  return (await api.get(`/recruitment/board${q.toString() ? `?${q.toString()}` : ""}`)).data;
};
export const recruitmentStages = async () => (await api.get("/recruitment/stages")).data;
export const recruitmentCreateCandidate = async (payload) => (await api.post("/recruitment/candidates", payload)).data;
export const recruitmentUpdateCandidate = async (id, payload) => (await api.patch(`/recruitment/candidates/${id}`, payload)).data;
export const recruitmentMoveCandidate = async (id, payload) => (await api.post(`/recruitment/candidates/${id}/move`, payload)).data;
export const recruitmentScheduleInterview = async (id, payload) => (await api.post(`/recruitment/candidates/${id}/interview`, payload)).data;
export const recruitmentRecordOffer = async (id, payload) => (await api.post(`/recruitment/candidates/${id}/offer`, payload)).data;
export const recruitmentAddNote = async (id, note) => (await api.post(`/recruitment/candidates/${id}/notes`, { note })).data;
export const recruitmentDeleteCandidate = async (id) => (await api.delete(`/recruitment/candidates/${id}`)).data;
