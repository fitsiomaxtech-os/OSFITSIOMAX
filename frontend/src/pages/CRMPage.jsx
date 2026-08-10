import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BadgeIndianRupee,
  Briefcase,
  Building2,
  CalendarDays,
  Headphones,
  LayoutDashboard,
  LogOut,
  Mail,
  Megaphone,
  MoreHorizontal,
  Network,
  Salad,
  Search,
  ShieldCheck,
  Store,
  Stethoscope,
  UserCircle,
  UserPlus,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  addDoctorSlots,
  apiLogout,
  assignLeadBranch,
  bookLeadAppointment,
  completeAppointment,
  confirmLead,
  createBranch,
  createDoctor,
  createManualLead,
  createSheetConnection,
  createVertical,
  getAppointments,
  getAvailableDoctors,
  getBranchBoard,
  getBranches,
  getDoctors,
  getLeads,
  getMasterBoard,
  getBranchMasterBoard,
  getSheetConnections,
  getVerticals,
  qualifyLead,
  saveSheetMapping,
  syncSheetConnection,
  updateLead,
} from "@/lib/api";
import { toast, Toaster } from "@/components/ui/sonner";
import { BusinessLeadsDashboard } from "@/components/BusinessLeadsDashboard";
import { PreSalesBoard } from "@/components/PreSalesBoard";
import { BranchAdminBoard } from "@/components/BranchAdminBoard";
import { HeadPhysioBoard, HeadPhysioCalendarModal } from "@/components/HeadPhysioBoard";
import { PhysioBoard, CalendarPage as PhysioCalendarPage } from "@/components/PhysioBoard";
import { DietBoard } from "@/components/DietBoard";
import { MarketingBoard } from "@/components/marketing/MarketingBoard";
import { PreSalesCRM } from "@/components/PreSalesCRM";
import { DashboardBoard } from "@/components/DashboardBoard";
import { PipelineStageManagement } from "@/components/PipelineStageManagement";
import { HRBoard } from "@/components/hr/HRBoard";
import { HumanResourceBoard } from "@/components/hr/HumanResourceBoard";
import { BranchManagementBoard } from "@/components/branch/BranchManagementBoard";
import { BranchWiseBoard } from "@/components/branch/BranchWiseBoard";
import { PackagesBoard } from "@/components/PackagesBoard";
import { FinanceBoard } from "@/components/FinanceBoard";

const ROLE_META = {
  super_admin: { label: "Super Admin", icon: ShieldCheck },
  business_dev: { label: "Business Development", icon: Briefcase },
  pre_sales: { label: "Pre-sales", icon: Headphones },
  branch_admin: { label: "Branch Admin", icon: Building2 },
  head_physio: { label: "Head Physio", icon: Stethoscope },
  physio: { label: "Physio", icon: Activity },
  accountant: { label: "Accountant", icon: BadgeIndianRupee },
  human_resource: { label: "Human Resource", icon: UserPlus },
  nutrition_coach: { label: "Diet", icon: Salad },
};

/** Whether a role slug should land on the recruitment board.
 *
 * The HR role is added by hand in Super Admin -> HR Admin, so its slug is whatever label
 * was typed. Matching the shape of the slug rather than one literal means a different
 * wording ("HR Manager", "Recruiter") still reaches the board instead of falling through
 * to a blank screen. Kept in step with _is_hr_role in backend/routers/v3_recruitment.py —
 * a role that passes here and fails there would render the board and 403 every call.
 */
/** Whether a role slug reads as the Diet vertical.
 *
 * Same reason isHumanResourceRole exists: the role is typed by hand in Roles &
 * Credentials, so its slug is whatever wording was used — this install has "diet_manage",
 * not "nutrition_coach", and that user logged in to a blank page. Kept in step with
 * is_diet_role in backend/deps.py; a role that passes here and fails there would render
 * the board and 403 every call.
 */
const isDietRole = (role) => {
  const r = String(role || "").trim().toLowerCase();
  if (r === "super_admin") return false;
  if (r.includes("nutrition_coach")) return true;
  return r.split("_").some((t) => ["diet", "nutrition", "nutritionist", "dietician", "dietitian"].includes(t));
};

const isHumanResourceRole = (role) => {
  const r = String(role || "").trim().toLowerCase();
  if (r.includes("human_resource")) return true;
  return r.split("_").some((t) => ["hr", "recruiter", "recruitment", "talent"].includes(t));
};

// Same 9 destinations as the desktop tab strip below. On a phone, the 5 most-used
// get a direct bottom-nav slot each; the rest sit behind a "More" popover — both
// derived from this one array so the two surfaces can't drift out of sync.
// Dashboard is the default landing view. Master View was retired from here — the
// Dashboard now carries the same headline counts, per branch and per date range.
const SUPER_ADMIN_TABS = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "marketing", label: "Marketing Source", icon: Megaphone },
  { key: "stages", label: "Rehabilitation Phase", icon: Activity },
  { key: "hr", label: "HR Admin", icon: Users },
  { key: "presales", label: "Pre-Sales CRM", icon: Headphones },
  { key: "branches", label: "Branch Management", icon: Building2 },
  { key: "branch_wise", label: "Branch Wise", icon: Network },
  { key: "packages", label: "FITSIO STORE", icon: Store },
];

const SUPER_ADMIN_BOTTOM_KEYS = ["dashboard", "marketing", "hr", "presales", "branch_wise"];
const SUPER_ADMIN_BOTTOM_TABS = SUPER_ADMIN_TABS.filter((t) => SUPER_ADMIN_BOTTOM_KEYS.includes(t.key));
const SUPER_ADMIN_MORE_TABS = SUPER_ADMIN_TABS.filter((t) => !SUPER_ADMIN_BOTTOM_KEYS.includes(t.key) && t.key !== "stages");


const verticalDefaults = [
  "offline_physiotherapy",
  "online_physiotherapy",
  "online_fitness",
  "offline_fitness_gym",
];

const defaultLead = {
  name: "",
  phone: "",
  email: "",
  vertical: "offline_physiotherapy",
  source_tab: "Manual",
  notes: "",
};

const defaultBranch = {
  branch_name: "",
  address: "",
  admin_name: "",
  admin_email: "",
  admin_password: "",
  admin_phone: "",
  vertical: "offline_physiotherapy",
};

const defaultDoctor = {
  full_name: "",
  profile_type: "physio",
  branch_id: "",
  specialization: "",
};

const defaultSheetConnection = {
  connection_name: "",
  spreadsheet_id: "",
  sync_interval_minutes: 30,
};

const defaultMapping = {
  name: "name",
  phone: "phone",
  email: "email",
  vertical: "vertical",
};

const defaultSyncPayload = `{
  "tabs": [
    {
      "tab_name": "Instagram",
      "rows": [
        {
          "name": "Priya",
          "phone": "9000010001",
          "email": "priya@example.com",
          "vertical": "offline_physiotherapy",
          "campaign": "meta_1"
        }
      ]
    }
  ]
}`;

const LOGO_URL =
  "https://customer-assets.emergentagent.com/job_3d74aa9e-a241-4207-b148-2bbe29802707/artifacts/nozl77ti_Logo%20Icon.webp";

export const CRMPage = ({ auth, onLogout }) => {
  const [masterBoard, setMasterBoard] = useState({ stage_counts: {}, total: 0 });
  const [branchMaster, setBranchMaster] = useState({ branch_stage_counts: {}, total: 0 });
  const [branchBoard, setBranchBoard] = useState({ stage_counts: {} });
  const [verticals, setVerticals] = useState([]);
  const [branches, setBranches] = useState([]);
  const [leads, setLeads] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [sheetConnections, setSheetConnections] = useState([]);

  const [leadForm, setLeadForm] = useState(defaultLead);
  const [branchForm, setBranchForm] = useState(defaultBranch);
  const [doctorForm, setDoctorForm] = useState(defaultDoctor);
  const [verticalName, setVerticalName] = useState("");
  const [slotDoctorId, setSlotDoctorId] = useState("");
  const [slotTime, setSlotTime] = useState("");

  const [assignBranchSelection, setAssignBranchSelection] = useState({});
  const [selectedLeadForBooking, setSelectedLeadForBooking] = useState("");
  const [bookingTime, setBookingTime] = useState("");
  const [availableDoctors, setAvailableDoctors] = useState([]);
  const [selectedDoctorForBooking, setSelectedDoctorForBooking] = useState("");

  const [sheetConnectionForm, setSheetConnectionForm] = useState(defaultSheetConnection);
  const [selectedConnectionId, setSelectedConnectionId] = useState("");
  const [mappingFields, setMappingFields] = useState(defaultMapping);
  const [syncPayload, setSyncPayload] = useState(defaultSyncPayload);

  const [leadStageFilter, setLeadStageFilter] = useState("");
  const [leadBranchFilter, setLeadBranchFilter] = useState("");
  const [leadDateFrom, setLeadDateFrom] = useState("");
  const [leadDateTo, setLeadDateTo] = useState("");
  const [appointmentFilter, setAppointmentFilter] = useState("all");

  const [customFieldName, setCustomFieldName] = useState("");
  const [customFieldType, setCustomFieldType] = useState("text");
  const [customFieldOptions, setCustomFieldOptions] = useState("");
  const [customFieldDefs, setCustomFieldDefs] = useState([]);

  const [editingLeadId, setEditingLeadId] = useState("");
  const [leadEditForm, setLeadEditForm] = useState({
    name: "",
    phone: "",
    email: "",
    notes: "",
    extra_fields: {},
  });

  const [loading, setLoading] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showPhysioCalendar, setShowPhysioCalendar] = useState(false);
  const [showHPCalendar, setShowHPCalendar] = useState(false);
  // Lead search lives in the header for a Head Physio on a phone: the board is all list,
  // and a search box inside it scrolls away the moment you start reading. On a desktop
  // that box is always in view, so the header button is hidden there.
  const [showHPSearch, setShowHPSearch] = useState(false);
  const [hpSearch, setHpSearch] = useState("");
  const [showSuperAdminMenu, setShowSuperAdminMenu] = useState(false);

  const role = auth.user.role;
  // A hand-created HR role can carry any slug, so fall back to the board's own name
  // rather than printing "hr_manager Master View" in the header.
  // A hand-created role's slug is not a title — "diet_manage Master View" is what the
  // raw value gives. Named roles come from ROLE_META; the two families that accept
  // arbitrary wording are named by what they are.
  const roleLabel = ROLE_META[role]?.label
    || (isDietRole(role) ? "Diet" : null)
    || (isHumanResourceRole(role) ? "Human Resource" : role);
  const boardTitle = role === "pre_sales" ? "Pre-sales Master View" : `${roleLabel} Master View`;
  const myBranch = branches.find((b) => b.id === auth.user.branch_id);
  const myBranchName = myBranch?.branch_name || "";
  const VERTICAL_LABELS = { offline_physiotherapy: "Physiotherapy", offline_fitness_gym: "Fitness", offline_fitness: "Fitness" };
  const myVerticalLabel = VERTICAL_LABELS[myBranch?.vertical] || "";

  const [superAdminView, setSuperAdminView] = useState(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("sheets_connect")) {
      return "marketing";
    }
    return "dashboard";
  });

  const safeCall = async (fn, fallback) => {
    try {
      return await fn();
    } catch {
      return fallback;
    }
  };

  const loadEverything = async () => {
    setLoading(true);
    const canManageSheets = ["super_admin", "business_dev"].includes(role);

    const [masterData, branchMasterData, branchRows, leadRows, doctorRows, appointmentRows, verticalRows, sheetRows] =
      await Promise.all([
        safeCall(() => getMasterBoard(), { stage_counts: {}, total: 0 }),
        role === "super_admin" ? safeCall(() => getBranchMasterBoard(), { branch_stage_counts: {}, total: 0 }) : Promise.resolve({ branch_stage_counts: {}, total: 0 }),
        safeCall(() => getBranches(), []),
        safeCall(() =>
          getLeads({
            stage: leadStageFilter || undefined,
            branch_id: leadBranchFilter || undefined,
            start_date: leadDateFrom ? `${leadDateFrom}T00:00:00` : undefined,
            end_date: leadDateTo ? `${leadDateTo}T23:59:59` : undefined,
          }),
        []),
        safeCall(() => getDoctors({}), []),
        safeCall(() => getAppointments(appointmentFilter === "all" ? {} : { view: appointmentFilter }), []),
        safeCall(() => getVerticals(), []),
        canManageSheets ? safeCall(() => getSheetConnections(), []) : Promise.resolve([]),
      ]);

    setMasterBoard(masterData);
    setBranchMaster(branchMasterData);
    setBranches(branchRows);
    setLeads(leadRows);
    setDoctors(doctorRows);
    setAppointments(appointmentRows);
    setVerticals(verticalRows.length ? verticalRows : verticalDefaults.map((name) => ({ id: name, name })));
    setSheetConnections(sheetRows);

    const branchId = role === "branch_admin" ? auth.user.branch_id : branchRows[0]?.id;
    if (branchId) {
      const data = await safeCall(() => getBranchBoard(branchId), { stage_counts: {} });
      setBranchBoard(data);
    } else {
      setBranchBoard({ stage_counts: {} });
    }

    setLoading(false);
  };

  useEffect(() => {
    loadEverything();
  }, [leadStageFilter, leadBranchFilter, leadDateFrom, leadDateTo, appointmentFilter]);

  // The header search is phone-only, so a window growing past the breakpoint takes the
  // bar off screen. Drop the query with it — otherwise the list stays filtered by text
  // the user can no longer see or clear.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const desktop = window.matchMedia("(min-width: 640px)");
    const sync = () => {
      if (!desktop.matches) return;
      setShowHPSearch(false);
      setHpSearch("");
    };
    sync();
    desktop.addEventListener("change", sync);
    return () => desktop.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!editingLeadId) {
      return;
    }
    const selected = leads.find((lead) => lead.id === editingLeadId);
    if (!selected) {
      return;
    }
    setLeadEditForm({
      name: selected.name || "",
      phone: selected.phone || "",
      email: selected.email || "",
      notes: selected.notes || "",
      extra_fields: selected.extra_fields || {},
    });
  }, [editingLeadId, leads]);

  const logout = async () => {
    try {
      await apiLogout();
    } catch {
      // no-op
    }
    onLogout();
  };

  const createLeadNow = async (event) => {
    event.preventDefault();
    try {
      await createManualLead({ ...leadForm, source_type: "manual" });
      setLeadForm(defaultLead);
      toast.success("Lead created");
      await loadEverything();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Lead create failed");
    }
  };

  const createBranchNow = async (event) => {
    event.preventDefault();
    try {
      await createBranch(branchForm);
      setBranchForm(defaultBranch);
      toast.success("Branch and branch admin created");
      await loadEverything();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Branch create failed");
    }
  };

  const createDoctorNow = async (event) => {
    event.preventDefault();
    try {
      await createDoctor({ ...doctorForm, branch_id: doctorForm.branch_id || null });
      setDoctorForm(defaultDoctor);
      toast.success("Doctor profile created");
      await loadEverything();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Doctor create failed");
    }
  };

  const addSlotNow = async (event) => {
    event.preventDefault();
    try {
      await addDoctorSlots(slotDoctorId, { slots: [slotTime] });
      setSlotTime("");
      toast.success("Slot added");
      await loadEverything();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Slot add failed");
    }
  };

  const addVerticalNow = async (event) => {
    event.preventDefault();
    if (!verticalName.trim()) {
      toast.error("Vertical name required");
      return;
    }
    try {
      await createVertical({ name: verticalName.trim(), active: true });
      setVerticalName("");
      toast.success("Vertical created");
      await loadEverything();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Vertical create failed");
    }
  };

  const qualifyNow = async (leadId) => {
    try {
      await qualifyLead(leadId);
      toast.success("Lead qualified");
      await loadEverything();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Qualify failed");
    }
  };

  const assignBranchNow = async (leadId) => {
    const branchId = assignBranchSelection[leadId];
    if (!branchId) {
      toast.error("Select branch first");
      return;
    }
    try {
      await assignLeadBranch(leadId, { branch_id: branchId });
      toast.success("Assigned to branch");
      await loadEverything();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Assign failed");
    }
  };

  const confirmNow = async (leadId) => {
    try {
      await confirmLead(leadId);
      toast.success("Branch confirmed lead");
      await loadEverything();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Confirm failed");
    }
  };

  const checkDoctorsNow = async () => {
    const lead = leads.find((item) => item.id === selectedLeadForBooking);
    const branchId = lead?.branch_id || auth.user.branch_id;
    if (!branchId || !bookingTime) {
      toast.error("Pick lead and booking time");
      return;
    }
    try {
      const result = await getAvailableDoctors({ branch_id: branchId, slot_time: bookingTime });
      setAvailableDoctors(result.available_doctors || []);
      if (!(result.available_doctors || []).length) {
        toast.error("No doctors available at selected slot");
      }
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Availability check failed");
    }
  };

  const bookNow = async () => {
    if (!selectedLeadForBooking || !selectedDoctorForBooking || !bookingTime) {
      toast.error("Lead, slot and doctor required");
      return;
    }
    try {
      await bookLeadAppointment(selectedLeadForBooking, {
        doctor_id: selectedDoctorForBooking,
        slot_time: bookingTime,
      });
      toast.success("Appointment booked");
      setSelectedLeadForBooking("");
      setBookingTime("");
      setSelectedDoctorForBooking("");
      setAvailableDoctors([]);
      await loadEverything();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Booking failed");
    }
  };

  const completeNow = async (appointmentId) => {
    try {
      await completeAppointment(appointmentId);
      toast.success("Appointment completed");
      await loadEverything();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Complete failed");
    }
  };

  const createSheetConnectionNow = async (event) => {
    event.preventDefault();
    try {
      await createSheetConnection(sheetConnectionForm);
      setSheetConnectionForm(defaultSheetConnection);
      toast.success("Sheet connection created");
      await loadEverything();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Sheet connection failed");
    }
  };

  const saveMappingNow = async () => {
    if (!selectedConnectionId) {
      toast.error("Select a sheet connection first");
      return;
    }
    try {
      await saveSheetMapping(selectedConnectionId, {
        field_map: mappingFields,
        create_new_fields: true,
      });
      toast.success("Mapping saved");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Save mapping failed");
    }
  };

  const runSyncNow = async () => {
    if (!selectedConnectionId) {
      toast.error("Select a sheet connection first");
      return;
    }
    try {
      const parsed = JSON.parse(syncPayload);
      await syncSheetConnection(selectedConnectionId, parsed);
      toast.success("Sheet sync complete");
      await loadEverything();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Sync failed: verify JSON");
    }
  };

  const addCustomFieldDef = () => {
    const cleanName = customFieldName.trim();
    if (!cleanName) {
      toast.error("Custom field name required");
      return;
    }
    if (customFieldDefs.some((item) => item.name.toLowerCase() === cleanName.toLowerCase())) {
      toast.error("Custom field already exists");
      return;
    }

    setCustomFieldDefs((prev) => [
      ...prev,
      {
        name: cleanName,
        type: customFieldType,
        options:
          customFieldType === "select"
            ? customFieldOptions
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean)
            : [],
      },
    ]);
    setCustomFieldName("");
    setCustomFieldOptions("");
    toast.success("Custom field added");
  };

  const saveLeadEdit = async () => {
    if (!editingLeadId) {
      toast.error("Select lead to edit");
      return;
    }
    try {
      await updateLead(editingLeadId, {
        name: leadEditForm.name,
        phone: leadEditForm.phone,
        email: leadEditForm.email,
        notes: leadEditForm.notes,
        extra_fields: leadEditForm.extra_fields,
      });
      toast.success("Lead updated");
      await loadEverything();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Lead update failed");
    }
  };

  const showSuperAdminBoard = role === "super_admin";
  const showBusinessDevBoard = role === "business_dev";
  const showPreSalesBoard = role === "pre_sales";
  const showBranchBoard = role === "branch_admin";
  const showHeadPhysioBoard = role === "head_physio";
  const showPhysioBoard = role === "physio";
  const showDietBoard = isDietRole(role);
  const showAccountantBoard = role === "accountant";
  const showHumanResourceBoard = isHumanResourceRole(role);

  const filteredAppointmentsForPhysioBoards = appointments;

  return (
    <div className="min-h-screen bg-slate-50" data-testid="role-board-page">
      <Toaster richColors position="top-right" />

      <div className="w-full" data-testid="role-board-full-width-wrap">
        <header className="sticky top-0 z-20 w-full border-b border-slate-200 bg-white px-3 py-3 shadow-sm sm:px-6 sm:py-4" data-testid="role-board-header">
          {/* Physio, mobile only: name + FitsiomaxOS subline on the left, Calendar /
              Profile / Logout icons on the right — replaces the desktop header below,
              which stays exactly as-is for every other role and at sm:+ for physio. */}
          {showPhysioBoard && (
            <div className="flex items-center justify-between gap-2 sm:hidden" data-testid="physio-mobile-header">
              <div className="flex min-w-0 items-center gap-2">
                <img src={LOGO_URL} alt="Fitsiomax" className="h-9 w-9 shrink-0 rounded-lg object-contain" data-testid="header-left-logo-mobile" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-900" data-testid="physio-mobile-header-name">{auth.user.full_name}</p>
                  <p className="truncate text-[10px] font-semibold tracking-wide text-sky-600" data-testid="physio-mobile-header-brand">
                    {myBranchName}{myVerticalLabel && ` ${myVerticalLabel}`}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button type="button" onClick={() => setShowPhysioCalendar(true)} className="rounded-md p-2 text-slate-500 hover:bg-slate-50" data-testid="physio-mobile-header-calendar">
                  <CalendarDays className="h-5 w-5" />
                </button>
                <button type="button" onClick={() => setShowProfile(true)} className="rounded-md p-2 text-slate-500 hover:bg-slate-50" data-testid="physio-mobile-header-profile">
                  <UserCircle className="h-5 w-5" />
                </button>
                <button type="button" onClick={logout} className="rounded-md p-2 text-slate-500 hover:bg-slate-50" data-testid="physio-mobile-header-logout">
                  <LogOut className="h-5 w-5" />
                </button>
              </div>
            </div>
          )}
          <div className={`flex flex-wrap items-center justify-between gap-2 ${showPhysioBoard ? "hidden sm:flex" : ""}`}>
            <div className="flex min-w-0 items-center gap-2 sm:gap-4">
              <img src={LOGO_URL} alt="Fitsiomax" className="h-9 w-9 shrink-0 rounded-lg object-contain sm:h-14 sm:w-14" data-testid="header-left-logo" />
              <div className="min-w-0">
                <p className="text-[10px] font-semibold tracking-wide text-sky-600 sm:text-xs" data-testid="role-board-brand-subtitle">
                  FitsiomaxOS
                </p>
                {/* On a phone the board title costs a whole line to say something the user
                    already knows, so these two boards show who is signed in instead. The
                    desktop header is untouched. */}
                <h1 className="truncate text-base font-bold text-slate-900 sm:text-2xl" data-testid="role-board-title">
                  {showHeadPhysioBoard || showHumanResourceBoard ? (
                    <>
                      <span className="sm:hidden">{auth.user.full_name}</span>
                      <span className="hidden sm:inline">{boardTitle}</span>
                    </>
                  ) : boardTitle}
                </h1>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              {/* Phone only. On a desktop the board already carries its own search box
                  above the list, so a second one in the header was the same job twice —
                  it's only on a phone, where that box is a scroll away, that reaching it
                  from the header earns its place. */}
              {showHeadPhysioBoard && (
                <button
                  type="button"
                  onClick={() => setShowHPSearch((v) => !v)}
                  className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-sm font-medium sm:hidden ${
                    hpSearch || showHPSearch
                      ? "border-teal-300 bg-teal-50 text-teal-700"
                      : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                  aria-label="Search leads"
                  data-testid="hp-header-search-button"
                >
                  <Search className="h-4 w-4" />
                </button>
              )}
              {/* A Head Physio's own calendar sits beside their profile rather than in the
                  board's tab row — it's a reference, not one of the lists they work. */}
              {showHeadPhysioBoard && (
                <button
                  type="button"
                  onClick={() => setShowHPCalendar(true)}
                  className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 sm:px-3"
                  data-testid="hp-header-calendar-button"
                >
                  <CalendarDays className="h-4 w-4" />
                  <span className="hidden sm:inline">Calendar</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowProfile(true)}
                className="flex items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-slate-50"
                data-testid="role-board-profile-button"
              >
                <UserCircle className="h-7 w-7 shrink-0 text-slate-300 sm:h-8 sm:w-8" />
                <span className="hidden sm:block">
                  <span className="block text-sm font-semibold leading-tight text-slate-900" data-testid="role-board-user-greeting">
                    {auth.user.full_name}
                  </span>
                  <span className="block text-[10px] font-medium uppercase tracking-wide text-slate-400" data-testid="role-board-user-subtitle">
                    {roleLabel}{myBranchName && ` · ${myBranchName}`}
                  </span>
                </span>
              </button>
              <Button
                variant="outline"
                size="sm"
                onClick={logout}
                className="border-slate-200 px-2 text-slate-600 hover:bg-slate-50 sm:px-3"
                data-testid="role-board-logout-button"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </header>

        {showProfile && (
          <MyProfileModal user={auth.user} roleLabel={roleLabel} branchName={myBranchName} onClose={() => setShowProfile(false)} />
        )}

        {showPhysioBoard && showPhysioCalendar && (
          <PhysioCalendarPage onClose={() => setShowPhysioCalendar(false)} />
        )}

        {showHeadPhysioBoard && showHPSearch && (
          <div className="border-b border-slate-200 bg-white px-3 pb-3 sm:hidden" data-testid="hp-header-search-bar">
            <div className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2">
              <Search className="h-4 w-4 shrink-0 text-slate-400" />
              <input
                autoFocus
                value={hpSearch}
                onChange={(e) => setHpSearch(e.target.value)}
                placeholder="Search leads by name, phone or patient no..."
                className="min-w-0 flex-1 border-0 p-0 text-sm outline-none placeholder:text-slate-400"
                data-testid="hp-header-search-input"
              />
              {hpSearch && (
                <button type="button" onClick={() => setHpSearch("")} className="shrink-0 text-slate-400 hover:text-slate-600" aria-label="Clear search">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        )}

        {showHeadPhysioBoard && showHPCalendar && (
          <HeadPhysioCalendarModal branchId={auth?.user?.branch_id} onClose={() => setShowHPCalendar(false)} />
        )}

        <div className={`w-full space-y-4 px-3 py-4 sm:space-y-6 sm:px-6 sm:py-6 ${showSuperAdminBoard ? "pb-20 md:pb-6" : ""}`}>

        {showSuperAdminBoard && (
          <div className="hidden flex-wrap gap-2 border-b border-slate-200 pb-2 md:flex" data-testid="super-admin-nav">
            {SUPER_ADMIN_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setSuperAdminView(t.key)}
                className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${superAdminView === t.key ? "bg-sky-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}
                data-testid={`super-admin-tab-${t.key === "branch_wise" ? "branch-wise" : t.key}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {/* Phone equivalent of the tab strip above: a real bottom nav with the 5
            most-used destinations as direct icons, plus a "More" slot for the rest —
            same pattern as the Physio/Branch Admin/Pre-Sales bottom navs. */}
        {showSuperAdminBoard && (
          <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white md:hidden" data-testid="super-admin-bottom-nav">
            <div className="flex items-stretch justify-around">
              {SUPER_ADMIN_BOTTOM_TABS.map((t) => {
                const Icon = t.icon;
                const active = superAdminView === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => { setSuperAdminView(t.key); setShowSuperAdminMenu(false); }}
                    className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium leading-tight ${active ? "text-sky-600" : "text-slate-400"}`}
                    data-testid={`super-admin-nav-${t.key === "branch_wise" ? "branch-wise" : t.key}`}
                  >
                    <Icon className="h-5 w-5" />
                    {t.label}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setShowSuperAdminMenu((v) => !v)}
                className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium leading-tight ${
                  SUPER_ADMIN_MORE_TABS.some((t) => t.key === superAdminView) || showSuperAdminMenu ? "text-sky-600" : "text-slate-400"
                }`}
                data-testid="super-admin-nav-more"
              >
                <MoreHorizontal className="h-5 w-5" />
                More
              </button>
            </div>
          </div>
        )}

        {showSuperAdminBoard && showSuperAdminMenu && (
          <div
            className="fixed inset-0 z-50 flex items-end bg-slate-900/40 md:hidden"
            onClick={() => setShowSuperAdminMenu(false)}
            data-testid="super-admin-menu-sheet"
          >
            <div className="w-full rounded-t-2xl bg-white p-2 pb-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-3 py-2">
                <p className="text-sm font-semibold text-slate-700">More</p>
                <button type="button" onClick={() => setShowSuperAdminMenu(false)} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100" data-testid="super-admin-menu-close">
                  <X className="h-4 w-4" />
                </button>
              </div>
              {SUPER_ADMIN_MORE_TABS.map((t) => {
                const Icon = t.icon;
                const active = superAdminView === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => { setSuperAdminView(t.key); setShowSuperAdminMenu(false); }}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-medium ${active ? "bg-sky-50 text-sky-700" : "text-slate-700 hover:bg-slate-50"}`}
                    data-testid={`super-admin-menu-${t.key}`}
                  >
                    <Icon className="h-4 w-4" />
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {showSuperAdminBoard && superAdminView === "hr" && (
          <HRBoard />
        )}

        {showSuperAdminBoard && superAdminView === "branches" && (
          <BranchManagementBoard actingUser={auth.user} />
        )}

        {showSuperAdminBoard && superAdminView === "branch_wise" && (
          <BranchWiseBoard branches={branches} />
        )}

        {showSuperAdminBoard && superAdminView === "packages" && (
          <PackagesBoard />
        )}

        {showSuperAdminBoard && superAdminView === "marketing" && (
          <MarketingBoard branches={branches} />
        )}

        {showSuperAdminBoard && superAdminView === "presales" && (
          <PreSalesCRM onManageStages={() => setSuperAdminView("stages")} role={role} currentUser={auth.user} />
        )}

        {showSuperAdminBoard && superAdminView === "stages" && (
          <PipelineStageManagement onBack={() => setSuperAdminView("presales")} />
        )}

        {showPreSalesBoard && (
          <PreSalesCRM role={role} currentUser={auth.user} onLogout={logout} />
        )}

        {showSuperAdminBoard && superAdminView === "dashboard" && (
          <DashboardBoard />
        )}

        {showBusinessDevBoard && (
          <BusinessLeadsDashboard />
        )}

        {showBranchBoard && (
          <BranchAdminBoard branchId={auth?.user?.branch_id} />
        )}

        {showHeadPhysioBoard && (
          <HeadPhysioBoard branchId={auth?.user?.branch_id} branchIds={auth?.user?.branch_ids} user={auth?.user} search={hpSearch} />
        )}

        {showPhysioBoard && (
          <PhysioBoard />
        )}

        {showDietBoard && (
          <DietBoard />
        )}

        {showHumanResourceBoard && (
          <HumanResourceBoard user={auth.user} />
        )}

        {showAccountantBoard && (
          <div className="space-y-4" data-testid="accountant-board-root">
            <div>
              <h2 className="text-2xl font-bold text-slate-900">Finance</h2>
              <p className="text-sm text-slate-500">Fees collected across every branch.</p>
            </div>
            <FinanceBoard />
          </div>
        )}

        </div>
      </div>

      {loading && (
        <div className="fixed bottom-4 right-4 rounded-md bg-slate-900 px-3 py-2 text-sm text-white" data-testid="role-board-loading-indicator">
          Loading boards...
        </div>
      )}
    </div>
  );
};

const MyProfileModal = ({ user, roleLabel, branchName, onClose }) => {
  if (!user) return null;
  const joinedOn = user.created_at
    ? new Date(user.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })
    : "—";
  const fields = [
    { label: "Employee ID", value: user.id ? `#${user.id.slice(-8).toUpperCase()}` : "—" },
    { label: "Role", value: roleLabel || user.role },
    ...(branchName ? [{ label: "Branch", value: branchName }] : []),
    { label: "Joined On", value: joinedOn },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      data-testid="my-profile-modal"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between">
          <h3 className="text-base font-semibold text-slate-900">My Profile</h3>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            data-testid="my-profile-modal-close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-sky-100 text-xl font-bold text-sky-700">
            {user.full_name?.charAt(0)?.toUpperCase() || "?"}
          </div>
          <div>
            <p className="text-base font-semibold text-slate-800">{user.full_name}</p>
            <p className="flex items-center gap-1 text-xs text-slate-400"><Mail className="h-3 w-3" />{user.email}</p>
          </div>
        </div>

        <div className="space-y-3">
          {fields.map((f) => (
            <div key={f.label} className="flex items-center justify-between border-b border-slate-100 pb-2">
              <span className="text-xs text-slate-400">{f.label}</span>
              <span className="text-sm font-medium text-slate-700">{f.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
