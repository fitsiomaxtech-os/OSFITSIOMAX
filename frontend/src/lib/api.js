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
export const deleteVertical = async (id) => (await api.delete(`/verticals/${id}`)).data;

// Treatment catalogue — Super Admin > Treatment.
export const getTreatmentTypes = async () => (await api.get("/treatment-types")).data;
export const createTreatmentType = async (payload) => (await api.post("/treatment-types", payload)).data;
export const deleteTreatmentType = async (id) => (await api.delete(`/treatment-types/${id}`)).data;

// Type of Physios — the physiotherapy services offered, Super Admin > Services and
// Products. A name each, like treatments; prices live on the store packages.
export const getPhysioTypes = async () => (await api.get("/physio-types")).data;
export const createPhysioType = async (payload) => (await api.post("/physio-types", payload)).data;
export const updatePhysioType = async (id, payload) => (await api.patch(`/physio-types/${id}`, payload)).data;
export const deletePhysioType = async (id) => (await api.delete(`/physio-types/${id}`)).data;
// Which service an expert is offered under, set where their calendar is published.
export const setDoctorService = async (doctorId, serviceType) => (await api.patch(`/doctors/${doctorId}/service`, { service_type: serviceType })).data;
// The video room an expert takes appointments in. Saved against the person rather than
// the record, so one link covers every branch they cover — see v3_set_doctor_meet_link.
export const setDoctorMeetLink = async (doctorId, meetLink) => (await api.patch(`/doctors/${doctorId}/meet-link`, { meet_link: meetLink || "" })).data;

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
// Clearing several at once. Returns what was deleted and what was refused, with reasons.
export const bulkDeleteLeads = async (leadIds, confirm) => (await api.post("/branch/leads/bulk-delete", { lead_ids: leadIds, confirm })).data;
export const getPortalAccountStatus = async (leadId) => (await api.get(`/leads/${leadId}/portal-account`)).data;
export const createOrResetPortalAccount = async (leadId, payload) => (await api.post(`/leads/${leadId}/portal-account`, payload)).data;
export const getClientPortalPreview = async (leadId) => (await api.get(`/leads/${leadId}/portal-preview`)).data;

export const listTestimonials = async () => (await api.get("/testimonials/manage")).data;
export const addTestimonial = async (payload) => (await api.post("/testimonials", payload)).data;
export const deleteTestimonial = async (id) => (await api.delete(`/testimonials/${id}`)).data;
// The two marks a branch puts on a patient by hand — VIP, and needs attention. Its own
// endpoint rather than updateLead: this is a one-click toggle from a row, and the full PUT
// would send every other field back with it. Pass only the flag that changed.
export const setLeadFlags = async (leadId, flags) => (await api.patch(`/leads/${leadId}/flags`, flags)).data;
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
export const getLeadsAnalytics = async (params = {}) => (await api.get("/dashboard/leads-analytics", { params })).data;
export const getDashboardBranchBreakdown = async (params = {}) => (await api.get("/dashboard/branch-breakdown", { params })).data;
export const getDashboardLeadsTrend = async (months = 6) => (await api.get("/dashboard/leads-trend", { params: { months } })).data;
export const getDashboardLeadMetrics = async (params = {}) => (await api.get("/dashboard/lead-metrics", { params })).data;
export const getDashboardLeadMetricDetail = async (params = {}) => (await api.get("/dashboard/lead-metric-detail", { params })).data;
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
// The same board for an admin who runs an online arm instead of a branch. Takes no
// argument on purpose: the arm is read off the caller's own role server-side, so there is
// nothing here for one arm's admin to point at the other's patients.
export const getArmBoard = async () => (await api.get("/arm-board")).data;
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
export const setDoctorSlotCapacity = async (doctorId, slotCapacity) => (await api.patch(`/doctors/${doctorId}/slot-capacity`, { slot_capacity: slotCapacity })).data;

// ---- Shifts (MANAGEMENT → TIME MANAGEMENT) ----
// The working windows a branch runs, and who is on each. An expert's shift is what their
// CONSULTANT / PHYSIO / DIET calendar is cut across, so an evening physio's day is offered
// 3 PM – 7 PM rather than the whole clock. The four standard shifts seed themselves on the
// first read; every one of them is editable.
export const listShifts = async (branchId) => (await api.get(`/branches/${branchId}/shifts`)).data;
export const createShift = async (branchId, payload) => (await api.post(`/branches/${branchId}/shifts`, payload)).data;
export const updateShift = async (shiftId, payload) => (await api.patch(`/shifts/${shiftId}`, payload)).data;
export const deleteShift = async (shiftId) => (await api.delete(`/shifts/${shiftId}`)).data;
export const getShiftRoster = async (branchId, profileType) => (await api.get(`/branches/${branchId}/shift-roster`, { params: { profile_type: profileType } })).data;
export const setDoctorShift = async (doctorId, shiftId) => (await api.patch(`/doctors/${doctorId}/shift`, { shift_id: shiftId || null })).data;
// A one-off: these particular days run on a different shift, without moving the expert off
// their usual one. Passing shift_id null puts the days back on it.
export const setDoctorDayShift = async (doctorId, dates, shiftId) => (await api.patch(`/doctors/${doctorId}/day-shift`, { dates, shift_id: shiftId || null })).data;

// ---- Diet Consultation (Nutrition Coach) ----
export const dietToday = async (params = {}) => (await api.get("/diet/today", { params })).data;
export const dietCalendar = async (month, year, coachId) => (await api.get("/diet/calendar", { params: { month, year, coach_id: coachId } })).data;
export const dietConsultations = async (coachId) => (await api.get("/diet/consultations", { params: { coach_id: coachId } })).data;
export const dietPatients = async (coachId) => (await api.get("/diet/patients", { params: { coach_id: coachId } })).data;
export const dietSessions = async (leadId) => (await api.get(`/diet/sessions/${leadId}`)).data;
export const dietCompleteDay = async (sessionId, payload) => (await api.post(`/diet/sessions/${sessionId}/complete`, payload)).data;
export const listNutritionCoaches = async () => (await api.get("/branch/nutrition-coaches")).data;
export const createNutritionCoach = async (payload) => (await api.post("/branch/nutrition-coaches", payload)).data;
export const assignDiet = async (payload) => (await api.post("/branch/assign-diet", payload)).data;
export const bookDietAppointment = async (payload) => (await api.post("/branch/diet-appointment", payload)).data;
export const collectDietFee = async (leadId, payload) => (await api.post(`/leads/${leadId}/collect-diet-fee`, payload)).data;
// The Diet Chart's own fee. Its own call rather than a flag on the one above, because the
// two land on different fields and a patient can be sold both — see the backend's
// collect_diet_chart_fee.
export const collectDietChartFee = async (leadId, payload) => (await api.post(`/leads/${leadId}/collect-diet-chart-fee`, payload)).data;
export const collectRehabFee = async (leadId, payload) => (await api.post(`/leads/${leadId}/collect-rehab-fee`, payload)).data;
export const saveDietConsultationReport = async (leadId, report) => (await api.post(`/diet/consultation-report/${leadId}`, { report })).data;

// ---- The Diet Chart ----
/** The Nutrition Coach sends a chart. Multipart, and deliberately without an explicit
 *  Content-Type: the browser has to set it itself so the multipart boundary matches the
 *  body it just built. Naming it by hand is how an upload arrives as an unparseable form. */
export const sendDietChart = async (leadId, file, label) => {
  const form = new FormData();
  form.append("file", file);
  if (label) form.append("label", label);
  return (await api.post(`/diet/chart/${leadId}`, form)).data;
};
/** The chart's bytes as an object URL, for staff. Fetched as a blob rather than linked to,
 *  because the route needs the session token in a header and a plain <a href> cannot send
 *  one. The caller owns the URL and must revokeObjectURL it when done. */
export const dietChartUrl = async (leadId) => {
  const { data } = await api.get(`/diet/chart/${leadId}/download`, { responseType: "blob" });
  return URL.createObjectURL(data);
};
export const setDocumentShared = async (leadId, docId, shared) => (await api.patch(`/leads/${leadId}/documents/${docId}/share`, null, { params: { shared } })).data;
export const branchDietPatients = async () => (await api.get("/branch/diet-patients")).data;

// ---- Reusable report wording (Head Physio's Diagnosis Report / Treatment Summary) ----
// Org-wide, so one list holds across branches. A preset only ever fills the box; what is
// saved against a patient is whatever was actually written for them.
export const listTextPresets = async (kind) => (await api.get("/text-presets", { params: kind ? { kind } : {} })).data;
export const addTextPreset = async (kind, text) => (await api.post("/text-presets", { kind, text })).data;
export const deleteTextPreset = async (presetId) => (await api.delete(`/text-presets/${presetId}`)).data;

// ---- Client documents ----
// Never served from the static /uploads mount — these are patient records, so the bytes
// come back through an authenticated route as a blob.
export const leadDocuments = async (leadId, kind) => (await api.get(`/leads/${leadId}/documents`, { params: kind ? { kind } : {} })).data;
export const uploadLeadDocument = async (leadId, file, label = "", kind = "general") => {
  const body = new FormData();
  body.append("file", file);
  body.append("label", label);
  body.append("kind", kind);
  // No explicit Content-Type: the browser has to set the multipart boundary itself, and
  // naming the header strips it and the request arrives unparseable.
  return (await api.post(`/leads/${leadId}/documents`, body)).data;
};
// Progression — the four things a case sheet cannot close without, and the check on them.
// Verifying is deliberately a different endpoint from uploading: the physio gathers the
// clips, the branch or the consultant confirms them.
export const leadProgression = async (leadId) => (await api.get(`/leads/${leadId}/progression`)).data;
export const verifyLeadDocument = async (leadId, docId, verified = true) => (await api.patch(`/leads/${leadId}/documents/${docId}/verify`, { verified })).data;
// The Google review is typed, not filed — a picture of a review cannot be followed back
// to the review. Saving it clears any previous verification, since the tick belonged to the
// words that were there when it was made.
export const setGoogleReview = async (leadId, text) => (await api.put(`/leads/${leadId}/google-review`, { text })).data;
export const verifyGoogleReview = async (leadId, verified = true) => (await api.patch(`/leads/${leadId}/google-review/verify`, { verified })).data;
export const closeCaseSheet = async (leadId) => (await api.post(`/leads/${leadId}/close-case-sheet`)).data;
export const deleteLeadDocument = async (leadId, docId) => (await api.delete(`/leads/${leadId}/documents/${docId}`)).data;
export const openLeadDocument = async (leadId, docId) => {
  const res = await api.get(`/leads/${leadId}/documents/${docId}/download`, { responseType: "blob" });
  return URL.createObjectURL(res.data);
};
export const addCalendarSlots = async (doctorId, payload) => (await api.post(`/doctors/${doctorId}/calendar-slots`, payload)).data;
export const removeCalendarSlots = async (doctorId, payload) => (await api.post(`/doctors/${doctorId}/remove-slots`, payload)).data;

export const getBranchFinance = async (params = {}) => {
  const query = new URLSearchParams();
  if (params.fee_type) query.set("fee_type", params.fee_type);
  if (params.start_date) query.set("start_date", params.start_date);
  if (params.end_date) query.set("end_date", params.end_date);
  if (params.search) query.set("search", params.search);
  if (params.branch_id) query.set("branch_id", params.branch_id);
  if (params.mode) query.set("mode", params.mode);
  if (params.approved !== undefined && params.approved !== null) query.set("approved", params.approved);
  return (await api.get(`/branch/finance?${query.toString()}`)).data;
};

// ---- Finance: Approvals / Expenses / Profit (Accountant) ----
export const getFinanceApprovals = async (params = {}) => (await api.get("/finance/approvals", { params })).data;
// payload: { confirmed_amount } for Cash, { transaction_ref } for Bank Transfer/UPI,
// { cheque_number } for Cheque — whichever the row's own payment mode calls for.
export const approveTransaction = async (activityId, payload = {}) => (await api.post(`/finance/transactions/${activityId}/approve`, payload)).data;
export const unapproveTransaction = async (activityId) => (await api.post(`/finance/transactions/${activityId}/unapprove`)).data;
export const getFinanceExpenses = async (params = {}) => (await api.get("/finance/expenses", { params })).data;
export const createFinanceExpense = async (payload) => (await api.post("/finance/expenses", payload)).data;
export const deleteFinanceExpense = async (expenseId) => (await api.delete(`/finance/expenses/${expenseId}`)).data;
export const getFinanceProfit = async (params = {}) => (await api.get("/finance/profit", { params })).data;

export const getRevenueOverview = async (params = {}) => (await api.get("/finance/revenue-overview", { params })).data;

export const getClientTransactionHistory = async (leadId) => (await api.get(`/finance/client/${leadId}`)).data;
export const markInstallmentPaid = async (leadId, installmentNumber, payload) => (await api.post(`/finance/installment/${leadId}/${installmentNumber}/mark-paid`, payload)).data;

// Whose consultant book the board will show, and whether it belongs to the caller. My
// Consultation reads it so it can never present somebody else's appointments as your own.
export const hpResolvedConsultant = async () => (await api.get("/head-physio/resolved")).data;
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
// The patient did not turn up: this day takes the next day's slot, and every day after it
// steps down one. The last day comes off the end and goes to the Branch Admin for a date.
export const physioMarkAbsent = async (sessionId, payload) => (await api.post(`/physio/sessions/${sessionId}/absent`, payload)).data;

export const physioWeeklyAssessment = async (leadId, week, payload, physioId) => (await api.post(`/physio/weekly-assessment/${leadId}/${week}`, payload, { params: physioId ? { physio_id: physioId } : {} })).data;

export const getBranchRecommendations = async () => (await api.get("/branch/package-recommendations")).data;
export const assignSessions = async (payload) => (await api.post("/branch/assign-sessions", payload)).data;
export const createJrPhysio = async (payload) => (await api.post("/branch/jr-physios", payload)).data;
// Treatment days an absence pushed off the end of the booked slots, and the booking that puts one back.
export const unscheduledSessions = async () => (await api.get("/branch/sessions/unscheduled")).data;
export const scheduleSession = async (sessionId, slotTime) => (await api.post(`/branch/sessions/${sessionId}/schedule`, { slot_time: slotTime })).data;

export const patientView = async (token) => (await api.get(`/patient/view/${token}`)).data;


// Marketing Module
export const mkDashboard = async () => (await api.get("/marketing/dashboard")).data;
export const mkGetDistribution = async () => (await api.get("/marketing/distribution-settings")).data;
export const mkPatchDistribution = async (payload) => (await api.patch("/marketing/distribution-settings", payload)).data;
export const mkRefreshDistribution = async () => (await api.post("/marketing/distribution-settings/refresh")).data;
export const mkGetTeam = async () => (await api.get("/marketing/team-members")).data;
export const mkTeamMemberLeads = async (memberId, params = {}) => (await api.get(`/marketing/team-members/${memberId}/leads`, { params })).data;
export const mkUnassignedCount = async () => (await api.get("/marketing/unassigned-count")).data;
export const mkDistributeUnassigned = async () => (await api.post("/marketing/distribute-unassigned")).data;
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
export const hrAddCustomRole = async (label, color) => (await api.post("/hr/roles", { label, color })).data;
export const hrDeleteCustomRole = async (name) => (await api.delete(`/hr/roles/${name}`)).data;
export const hrDepartments = async () => (await api.get("/hr/departments")).data;
export const hrCreateDepartment = async (name) => (await api.post("/hr/departments", { name })).data;
export const hrRenameDepartment = async (id, name) => (await api.patch(`/hr/departments/${id}`, { name })).data;
export const hrDeleteDepartment = async (id) => (await api.delete(`/hr/departments/${id}`)).data;
export const hrAddDesignation = async (deptId, name) => (await api.post(`/hr/departments/${deptId}/designations`, { name })).data;
export const hrDeleteDesignation = async (deptId, name) => (await api.delete(`/hr/departments/${deptId}/designations`, { params: { name } })).data;
// `merge` folds this designation into one the department already has, rather than the
// rename being refused as a clash. See rename_designation for why it is opt-in.
export const hrRenameDesignation = async (deptId, oldName, newName, merge = false) => (await api.patch(`/hr/departments/${deptId}/designations`, { old_name: oldName, new_name: newName, merge })).data;
export const hrReorderDesignations = async (deptId, designations) => (await api.put(`/hr/departments/${deptId}/designations/order`, { designations })).data;
export const hrEmployees = async (params = {}) => {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v) q.set(k, v); });
  return (await api.get(`/hr/employees${q.toString() ? `?${q.toString()}` : ""}`)).data;
};

// Branch Management
export const bmList = async () => (await api.get("/branch-mgmt")).data;
export const bmListArchived = async () => (await api.get("/branch-mgmt", { params: { archived: true } })).data;
export const bmArchiveBranch = async (branchId, password) => (await api.post(`/branch-mgmt/${branchId}/archive`, { password })).data;
export const bmRestoreBranch = async (branchId) => (await api.post(`/branch-mgmt/${branchId}/restore`)).data;
export const bmCreateWithExistingAdmin = async (payload) => (await api.post("/branch-mgmt/with-existing-admin", payload)).data;
export const bmReassignAdmin = async (branchId, admin_user_id) => (await api.patch(`/branch-mgmt/${branchId}/admin`, { admin_user_id })).data;
export const bmHeadPhysioCandidates = async () => (await api.get("/branch-mgmt/head-physio-candidates")).data;
export const bmAssignHeadPhysio = async (branchId, doctor_id) => (await api.patch(`/branch-mgmt/${branchId}/head-physio`, { doctor_id })).data;
export const bmPerformance = async (branchId) => (await api.get(`/branch-mgmt/${branchId}/performance`)).data;
export const bmPerformanceSummary = async () => (await api.get("/branch-mgmt/performance-summary")).data;
export const bmDetail = async (branchId) => (await api.get(`/branch-mgmt/${branchId}/detail`)).data;
export const bmLeadControlHistory = async (branchId) => (await api.get(`/branches/${branchId}/lead-control-history`)).data;
export const bmPreSalesMembers = async (branchId) => (await api.get(`/branches/${branchId}/pre-sales-members`)).data;
// Who is posted to a branch, desk by desk. A posting, not a role — the account keeps the
// role it holds and only the branch it works at changes.
export const bmTeamCandidates = async (branchId, desk) => (await api.get(`/branch-mgmt/${branchId}/team-candidates`, { params: { desk } })).data;
export const bmTeamAdd = async (branchId, userId, desk) => (await api.post(`/branch-mgmt/${branchId}/team/${userId}`, null, { params: { desk } })).data;
export const bmTeamRemove = async (branchId, userId, desk) => (await api.delete(`/branch-mgmt/${branchId}/team/${userId}`, { params: { desk } })).data;

// Google Sheets OAuth
export const gsStatus = async () => (await api.get("/marketing/google-sheets/status")).data;
export const gsAuthUrl = async () => (await api.get("/marketing/google-sheets/auth")).data;
export const gsDisconnect = async () => (await api.post("/marketing/google-sheets/disconnect", {})).data;
export const gsListSpreadsheets = async (nameContains) => (await api.get(`/marketing/google-sheets/spreadsheets${nameContains ? `?name_contains=${encodeURIComponent(nameContains)}` : ""}`)).data;
export const gsListTabs = async (spreadsheetId) => (await api.get("/marketing/google-sheets/tabs", { params: { spreadsheet_id: spreadsheetId } })).data;
export const gsPull = async (sourceId) => (await api.post(`/marketing/google-sheets/pull/${sourceId}`)).data;
export const gsAutoSyncSources = async () => (await api.get("/marketing/google-sheets/auto-sync/sources")).data;
export const gsAutoSyncToggle = async (sourceId, payload) => (await api.patch(`/marketing/google-sheets/auto-sync/sources/${sourceId}`, payload)).data;

export const hrCreateEmployee = async (payload) => (await api.post("/hr/employees", payload)).data;
export const hrUpdateEmployee = async (id, payload) => (await api.patch(`/hr/employees/${id}`, payload)).data;
// The employee's photo, sent before the record that points at it — the file has to exist
// for photo_url to mean anything. Answers with { url }; no explicit Content-Type, because
// the browser has to set the multipart boundary itself.
export const uploadEmployeePhoto = async (file) => {
  const form = new FormData();
  form.append("file", file);
  return (await api.post("/hr/employees/upload-photo", form)).data;
};
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
/** Every diet product the branch has priced, from both shelves.
 *
 *  Two calls because they are two item types: "diet", the timed bookable item under
 *  Consultations, and "diet_package", the flat-priced one under the Diet Package tab. A
 *  branch may have put its Diet Consultation and its Diet Chart on either, and asking for
 *  only one type is how the Collect Diet Fee button came to tell a branch to add a package
 *  they had already added. Deduplicated by id in case an item is ever returned by both. */
export const listDietStoreItems = async () => {
  const lists = await Promise.all([
    listStoreItems(undefined, "diet").catch(() => []),
    listStoreItems(undefined, "diet_package").catch(() => []),
  ]);
  const byId = new Map();
  for (const item of lists.flat()) if (item?.id) byId.set(item.id, item);
  return [...byId.values()];
};
export const updateStoreItem = async (id, payload) => (await api.put(`/store/items/${id}`, payload)).data;
export const deleteStoreItem = async (id) => (await api.delete(`/store/items/${id}`)).data;
export const getStoreHistory = async (limit) => (await api.get("/store/history", { params: limit ? { limit } : {} })).data;
export const getPaymentHistory = async (limit) => (await api.get("/store/payment-history", { params: limit ? { limit } : {} })).data;
export const getFollowUpHistory = async (limit) => (await api.get("/store/follow-up-history", { params: limit ? { limit } : {} })).data;
export const getLoginHistory = async (limit) => (await api.get("/store/login-history", { params: limit ? { limit } : {} })).data;

// FITSIOMAX STORE > Tablet — branch stock. `category` is here so Supplementary and
// Equipment can call the same endpoints once their panels exist; the backend already
// takes them. A Branch Admin's own branch is resolved server-side from their login, so
// branch_id is only ever sent by a Super Admin looking at someone else's shelf.
export const listInventoryItems = async (params = {}) => (await api.get("/inventory/items", { params: { category: "tablet", ...params } })).data;
export const inventorySummary = async (params = {}) => (await api.get("/inventory/summary", { params: { category: "tablet", ...params } })).data;
export const inventoryMovements = async (params = {}) => (await api.get("/inventory/movements", { params: { category: "tablet", ...params } })).data;
// The catalogue is org-wide, so create and delete carry no branch. Everything that moves
// stock does: the backend pins a Branch Admin to their own branch whatever they send, and
// requires a Super Admin — who has none — to name one.
export const createInventoryItem = async (payload) => (await api.post("/inventory/items", payload)).data;
export const updateInventoryItem = async (id, payload, params = {}) => (await api.put(`/inventory/items/${id}`, payload, { params })).data;
export const deleteInventoryItem = async (id) => (await api.delete(`/inventory/items/${id}`)).data;
export const addInventoryStock = async (id, payload, params = {}) => (await api.post(`/inventory/items/${id}/add-stock`, payload, { params })).data;
export const sellInventoryItem = async (id, payload, params = {}) => (await api.post(`/inventory/items/${id}/sell`, payload, { params })).data;
export const transferInventoryItem = async (id, payload, params = {}) => (await api.post(`/inventory/items/${id}/transfer`, payload, { params })).data;


export const saveLeadDiagnosis = async (leadId, diagnosis) => (await api.post(`/leads/${leadId}/diagnosis`, { diagnosis })).data;
export const sellStoreItem = async (leadId, payload) => (await api.post(`/leads/${leadId}/sell-store-item`, payload)).data;
export const collectPackagePayment = async (leadId, payload) => (await api.post(`/leads/${leadId}/collect-package-payment`, payload)).data;
export const collectTreatmentFee = async (leadId, payload) => (await api.post(`/leads/${leadId}/collect-treatment-fee`, payload)).data;
export const assignPhysioWithSessions = async (leadId, payload) => (await api.post(`/leads/${leadId}/assign-physio-sessions`, payload)).data;
// Rehab — a parallel course on the same physio's calendar. Its own endpoint and its own
// collection: a rehab day is not a day of the treatment package (see backend/v3_rehab).
export const assignRehab = async (payload) => (await api.post("/branch/assign-rehab", payload)).data;
export const rehabSessionsForLead = async (leadId) => (await api.get(`/branch/rehab-sessions/${leadId}`)).data;
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

// Candidate lead sheets — HR's own Google Sheet sources, separate from Marketing's.
export const recruitmentSheetStatus = async () => (await api.get("/recruitment/sheets/status")).data;
export const recruitmentSources = async () => (await api.get("/recruitment/sources")).data;
export const recruitmentCreateSource = async (payload) => (await api.post("/recruitment/sources", payload)).data;
export const recruitmentUpdateSource = async (id, payload) => (await api.patch(`/recruitment/sources/${id}`, payload)).data;
export const recruitmentDeleteSource = async (id) => (await api.delete(`/recruitment/sources/${id}`)).data;
export const recruitmentPullSource = async (id) => (await api.post(`/recruitment/sources/${id}/pull`)).data;
export const recruitmentCreateStage = async (payload) => (await api.post("/recruitment/stages", payload)).data;
export const recruitmentUpdateStage = async (id, payload) => (await api.patch(`/recruitment/stages/${id}`, payload)).data;
export const recruitmentDeleteStage = async (id) => (await api.delete(`/recruitment/stages/${id}`)).data;
export const recruitmentReorderStages = async (ids) => (await api.post("/recruitment/stages/reorder", { ids })).data;

// ---- Patient feedback (the bell on the branch's header) ----
// The bell's number is the New column rather than a flag of its own, so what it counts and
// what the board shows can never disagree.
// The starred and the flagged, both lists in one request so the cards and the rows they
// count cannot arrive a moment apart.
export const getDashboardClients = async (branchId) => (await api.get("/dashboard/clients", { params: branchId ? { branch_id: branchId } : {} })).data;
export const listBranchFeedback = async (branchId) => (await api.get("/branch/feedback", { params: branchId ? { branch_id: branchId } : {} })).data;
export const moveBranchFeedback = async (feedbackId, status, reply, note) => (await api.patch(`/branch/feedback/${feedbackId}`, { status, reply, note })).data;
// Writing back to the patient on their own thread. ask_resolved is how a branch closes one
// — it says what was done and asks whether that settled it; the patient's answer resolves
// it, and nothing on this side can.
export const replyBranchFeedback = async (feedbackId, body, askResolved = false) => (await api.post(`/branch/feedback/${feedbackId}/message`, { body, ask_resolved: askResolved })).data;

// ---- Zumba (Branch Admin's own tab) ----
// Not a clinical journey and so not a lead: no stage, no consultation, no discharge. The
// summary splits by where the registration came from, which is the question the branch
// actually asks of it.
export const listZumba = async (branchId) => (await api.get("/branch/zumba", { params: branchId ? { branch_id: branchId } : {} })).data;
export const addZumba = async (payload, branchId) => (await api.post("/branch/zumba", payload, { params: branchId ? { branch_id: branchId } : {} })).data;
export const updateZumba = async (registrationId, payload) => (await api.patch(`/branch/zumba/${registrationId}`, payload)).data;
export const deleteZumba = async (registrationId) => (await api.delete(`/branch/zumba/${registrationId}`)).data;

// The Zumba master accounts at a branch, for the Branch Admin's assign control. Separate
// from the `masters` list listZumba returns: that one is names typed onto referrals, this
// one is accounts a student can actually be handed to.
export const listZumbaMasters = async (branchId) => (await api.get("/branch/zumba/masters", { params: branchId ? { branch_id: branchId } : {} })).data;
// Moving somebody along the class pipeline is the daily action, so it is its own call
// rather than a field on the edit form. The stages themselves come back on listZumba,
// straight from what Super Admin has in CI/CD ROOTS.
export const moveZumbaStage = async (registrationId, stage) => (await api.patch(`/branch/zumba/${registrationId}/stage`, { stage })).data;
export const setZumbaStatus = async (registrationId, status, remarks) => (await api.patch(`/branch/zumba/${registrationId}/status`, { status, remarks })).data;

// Another term on an existing membership. The server works out when the new term starts —
// when the old one ends, not when the button was pressed — so nothing here has to.
export const renewZumba = async (registrationId, payload) => (await api.post(`/branch/zumba/${registrationId}/renew`, payload)).data;

// Money against a balance already owed. Adds to what has been collected rather than
// replacing it, and refuses more than is outstanding.
export const collectZumba = async (registrationId, paymentLines) => (await api.post(`/branch/zumba/${registrationId}/collect`, { payment_lines: paymentLines })).data;
export const acceptZumbaReferral = async (leadId) => (await api.post(`/branch/zumba/accept/${leadId}`)).data;

// Fitness (gym) memberships — Branch Admin > Fitness. Its own desk beside Zumba: the gym
// sells memberships that run out and need renewing, with no referral pipeline behind it.
export const listFitness = async (branchId) => (await api.get("/branch/fitness", { params: branchId ? { branch_id: branchId } : {} })).data;
export const addFitness = async (payload, branchId) => (await api.post("/branch/fitness", payload, { params: branchId ? { branch_id: branchId } : {} })).data;
export const updateFitness = async (registrationId, payload) => (await api.patch(`/branch/fitness/${registrationId}`, payload)).data;
export const setFitnessStatus = async (registrationId, status, remarks) => (await api.patch(`/branch/fitness/${registrationId}/status`, { status, remarks })).data;
export const deleteFitness = async (registrationId) => (await api.delete(`/branch/fitness/${registrationId}`)).data;
// A collection is a list of lines, one per mode — a member can hand over cash and send
// the rest by UPI, and both halves belong against the same membership.
export const collectFitnessPayment = async (registrationId, lines, note) => (await api.post(`/branch/fitness/${registrationId}/collect`, { lines, note })).data;

// Another term on an existing membership. The server works out when the new term starts —
// when the old one ends, not when the button was pressed — so nothing here has to.
export const renewFitness = async (registrationId, payload) => (await api.post(`/branch/fitness/${registrationId}/renew`, payload)).data;
