import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Briefcase,
  Building2,
  CalendarDays,
  Database,
  Headphones,
  LogOut,
  Mail,
  ShieldCheck,
  Stethoscope,
  UserCircle,
  UserRound,
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
import { HeadPhysioBoard } from "@/components/HeadPhysioBoard";
import { PhysioBoard } from "@/components/PhysioBoard";
import { MarketingBoard } from "@/components/marketing/MarketingBoard";
import { PreSalesCRM } from "@/components/PreSalesCRM";
import { MasterControlBoard } from "@/components/MasterControlBoard";
import { PipelineStageManagement } from "@/components/PipelineStageManagement";
import { HRBoard } from "@/components/hr/HRBoard";
import { BranchManagementBoard } from "@/components/branch/BranchManagementBoard";
import { PackagesBoard } from "@/components/PackagesBoard";

const ROLE_META = {
  super_admin: { label: "Super Admin", icon: ShieldCheck },
  business_dev: { label: "Business Development", icon: Briefcase },
  pre_sales: { label: "Pre-sales", icon: Headphones },
  branch_admin: { label: "Branch Admin", icon: Building2 },
  head_physio: { label: "Head Physio", icon: Stethoscope },
  physio: { label: "Physio", icon: Activity },
};

const PIPELINE_STAGES = [
  "New Leads",
  "RNR",
  "Follow Up",
  "Appointment",
];

const PRESALES_HEX = {
  "New Leads": "#3b82f6",
  "RNR": "#f43f5e",
  "Follow Up": "#f59e0b",
  "Appointment": "#10b981",
};

const BRANCH_PIPELINE_STAGES = [
  "New Appointment",
  "Portfolio",
  "Follow Up",
  "Appointment Date & Time",
  "Cancelled",
];

const BRANCH_HEX = {
  "New Appointment": "#3b82f6",
  "Portfolio": "#8b5cf6",
  "Follow Up": "#f97316",
  "Appointment Date & Time": "#14b8a6",
  "Cancelled": "#f43f5e",
};

const SnapshotCard = ({ label, value, color, testid }) => (
  <div
    className="rounded-2xl p-4 text-left transition"
    style={{ background: `${color}14`, border: `1px solid ${color}33` }}
    data-testid={testid}
  >
    <p className="text-xs font-medium" style={{ color }}>{label}</p>
    <p className="mt-1 text-3xl font-bold" style={{ color }}>{value}</p>
  </div>
);

const STAGE_THEME = {
  "New Leads": {
    active: "border-blue-300 bg-blue-50 text-blue-700",
    inactive: "border-blue-200 bg-white text-blue-600",
    column: "border-blue-200 bg-blue-50",
    metric: "text-blue-600",
  },
  "RNR": {
    active: "border-rose-300 bg-rose-50 text-rose-700",
    inactive: "border-rose-200 bg-white text-rose-700",
    column: "border-rose-200 bg-rose-50",
    metric: "text-rose-600",
  },
  "Follow Up": {
    active: "border-amber-300 bg-amber-50 text-amber-700",
    inactive: "border-amber-200 bg-white text-amber-700",
    column: "border-amber-200 bg-amber-50",
    metric: "text-amber-600",
  },
  "Appointment": {
    active: "border-emerald-300 bg-emerald-50 text-emerald-700",
    inactive: "border-emerald-200 bg-white text-emerald-700",
    column: "border-emerald-200 bg-emerald-50",
    metric: "text-emerald-600",
  },
};

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

  const role = auth.user.role;
  const roleLabel = ROLE_META[role]?.label || role;
  const boardTitle = role === "pre_sales" ? "Pre-sales Master View" : `${roleLabel} Master View`;

  const [preSalesStageTab, setPreSalesStageTab] = useState("All");
  const [preSalesViewType, setPreSalesViewType] = useState("kanban");
  const [superAdminView, setSuperAdminView] = useState(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("sheets_connect")) {
      return "marketing";
    }
    return "master";
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

  const filteredAppointmentsForPhysioBoards = appointments;

  const preSalesLeads = useMemo(() => {
    const rows = leads.filter((lead) => !lead.branch_id || ["New Lead", "Pre-sales Qualified"].includes(lead.stage));
    if (preSalesStageTab === "All") {
      return rows;
    }
    return rows.filter((lead) => lead.stage === preSalesStageTab);
  }, [leads, preSalesStageTab]);

  const preSalesKanbanStages = useMemo(
    () => ["New Lead", "Pre-sales Qualified", "Assigned to Branch"],
    [],
  );

  return (
    <div className="min-h-screen bg-slate-50" data-testid="role-board-page">
      <Toaster richColors position="top-right" />

      <div className="w-full" data-testid="role-board-full-width-wrap">
        <header className="sticky top-0 z-20 w-full border-b border-slate-200 bg-white px-6 py-4 shadow-sm" data-testid="role-board-header">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <img src={LOGO_URL} alt="Fitsiomax" className="h-14 w-14 rounded-lg object-contain" data-testid="header-left-logo" />
              <div>
                <p className="text-xs font-semibold tracking-wide text-sky-600" data-testid="role-board-brand-subtitle">
                  FitsiomaxOS
                </p>
                <h1 className="text-2xl font-bold text-slate-900" data-testid="role-board-title">
                  {boardTitle}
                </h1>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-sky-700" data-testid="role-board-user-greeting">
                Hi {(showPreSalesBoard || showBranchBoard || showHeadPhysioBoard) ? auth.user.full_name : auth.user.full_name?.split(" ")[0]}
              </span>
              {(showPreSalesBoard || showBranchBoard || showHeadPhysioBoard) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowProfile(true)}
                  className="border-slate-200 text-slate-600 hover:bg-slate-50"
                  data-testid="role-board-profile-button"
                >
                  <UserCircle className="h-4 w-4 mr-1.5" />My Profile
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={logout}
                className="border-slate-200 text-slate-600 hover:bg-slate-50"
                data-testid="role-board-logout-button"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </header>

        {showProfile && (
          <MyProfileModal user={auth.user} roleLabel={roleLabel} onClose={() => setShowProfile(false)} />
        )}

        <div className="w-full space-y-6 px-6 py-6">

        {showSuperAdminBoard && (
          <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2" data-testid="super-admin-nav">
            <button onClick={() => setSuperAdminView("master")} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${superAdminView === "master" ? "bg-sky-600 text-white" : "text-slate-600 hover:bg-slate-100"}`} data-testid="super-admin-tab-master">Master View</button>
            <button onClick={() => setSuperAdminView("marketing")} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${superAdminView === "marketing" ? "bg-sky-600 text-white" : "text-slate-600 hover:bg-slate-100"}`} data-testid="super-admin-tab-marketing">Marketing Board</button>
            <button onClick={() => setSuperAdminView("presales")} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${superAdminView === "presales" ? "bg-sky-600 text-white" : "text-slate-600 hover:bg-slate-100"}`} data-testid="super-admin-tab-presales">Pre-Sales CRM</button>
            <button onClick={() => setSuperAdminView("stages")} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${superAdminView === "stages" ? "bg-sky-600 text-white" : "text-slate-600 hover:bg-slate-100"}`} data-testid="super-admin-tab-stages">Pipeline Stages</button>
            <button onClick={() => setSuperAdminView("hr")} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${superAdminView === "hr" ? "bg-sky-600 text-white" : "text-slate-600 hover:bg-slate-100"}`} data-testid="super-admin-tab-hr">HR Admin</button>
            <button onClick={() => setSuperAdminView("branches")} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${superAdminView === "branches" ? "bg-sky-600 text-white" : "text-slate-600 hover:bg-slate-100"}`} data-testid="super-admin-tab-branches">Branch Management</button>
            <button onClick={() => setSuperAdminView("packages")} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${superAdminView === "packages" ? "bg-sky-600 text-white" : "text-slate-600 hover:bg-slate-100"}`} data-testid="super-admin-tab-packages">FITSIO STORE</button>
          </div>
        )}

        {showSuperAdminBoard && superAdminView === "hr" && (
          <HRBoard />
        )}

        {showSuperAdminBoard && superAdminView === "branches" && (
          <BranchManagementBoard />
        )}

        {showSuperAdminBoard && superAdminView === "packages" && (
          <PackagesBoard />
        )}

        {showSuperAdminBoard && superAdminView === "marketing" && (
          <MarketingBoard branches={branches} />
        )}

        {showSuperAdminBoard && superAdminView === "presales" && (
          <PreSalesCRM onManageStages={() => setSuperAdminView("stages")} role={role} />
        )}

        {showSuperAdminBoard && superAdminView === "stages" && (
          <PipelineStageManagement onBack={() => setSuperAdminView("presales")} />
        )}

        {showPreSalesBoard && (
          <PreSalesCRM role={role} />
        )}

        {(showSuperAdminBoard && superAdminView === "master") && (
          <div className="space-y-4" data-testid="super-admin-master-snapshot">
            {/* Master Control Board + Live Analytics Overview */}
            <MasterControlBoard />
          </div>
        )}

        {showBusinessDevBoard && (
          <BusinessLeadsDashboard />
        )}

        {showBranchBoard && (
          <BranchAdminBoard branchId={auth?.user?.branch_id} />
        )}

        {showHeadPhysioBoard && (
          <HeadPhysioBoard branchId={auth?.user?.branch_id} user={auth?.user} />
        )}

        {showPhysioBoard && (
          <PhysioBoard />
        )}

        {showSuperAdminBoard && superAdminView === "master" && (
          <div data-testid="doctor-appointments-section" />
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

const MyProfileModal = ({ user, roleLabel, onClose }) => {
  if (!user) return null;
  const joinedOn = user.created_at
    ? new Date(user.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })
    : "—";
  const fields = [
    { label: "Employee ID", value: user.id ? `#${user.id.slice(-8).toUpperCase()}` : "—" },
    { label: "Role", value: roleLabel || user.role },
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
