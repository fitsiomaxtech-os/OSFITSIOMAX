import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Briefcase,
  Building2,
  CalendarDays,
  Database,
  Headphones,
  LogOut,
  RefreshCw,
  Settings,
  ShieldCheck,
  Stethoscope,
  UserRound,
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
import { PipelineStageManagement } from "@/components/PipelineStageManagement";
import { HRBoard } from "@/components/hr/HRBoard";
import { BranchManagementBoard } from "@/components/branch/BranchManagementBoard";

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
  const [masterBoard, setMasterBoard] = useState({ stage_counts: {} });
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

    const [masterData, branchRows, leadRows, doctorRows, appointmentRows, verticalRows, sheetRows] =
      await Promise.all([
        safeCall(() => getMasterBoard(), { stage_counts: {} }),
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
              <span className="text-sm font-medium text-sky-700" data-testid="role-board-user-greeting">Hi {auth.user.full_name?.split(" ")[0]}</span>
              <Button
                variant="outline"
                size="sm"
                className="border-slate-200 text-slate-600 hover:bg-slate-50"
                data-testid="role-board-settings-button"
              >
                <Settings className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={loadEverything}
                className="border-slate-200 text-slate-600 hover:bg-slate-50"
                data-testid="role-board-refresh-button"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
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

        <div className="w-full space-y-6 px-6 py-6">

        {showSuperAdminBoard && (
          <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2" data-testid="super-admin-nav">
            <button onClick={() => setSuperAdminView("master")} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${superAdminView === "master" ? "bg-sky-600 text-white" : "text-slate-600 hover:bg-slate-100"}`} data-testid="super-admin-tab-master">Master View</button>
            <button onClick={() => setSuperAdminView("marketing")} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${superAdminView === "marketing" ? "bg-sky-600 text-white" : "text-slate-600 hover:bg-slate-100"}`} data-testid="super-admin-tab-marketing">Marketing Board</button>
            <button onClick={() => setSuperAdminView("presales")} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${superAdminView === "presales" ? "bg-sky-600 text-white" : "text-slate-600 hover:bg-slate-100"}`} data-testid="super-admin-tab-presales">Pre-Sales CRM</button>
            <button onClick={() => setSuperAdminView("stages")} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${superAdminView === "stages" ? "bg-sky-600 text-white" : "text-slate-600 hover:bg-slate-100"}`} data-testid="super-admin-tab-stages">Pipeline Stages</button>
            <button onClick={() => setSuperAdminView("hr")} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${superAdminView === "hr" ? "bg-sky-600 text-white" : "text-slate-600 hover:bg-slate-100"}`} data-testid="super-admin-tab-hr">HR Admin</button>
            <button onClick={() => setSuperAdminView("branches")} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${superAdminView === "branches" ? "bg-sky-600 text-white" : "text-slate-600 hover:bg-slate-100"}`} data-testid="super-admin-tab-branches">Branch Management</button>
          </div>
        )}

        {showSuperAdminBoard && superAdminView === "hr" && (
          <HRBoard />
        )}

        {showSuperAdminBoard && superAdminView === "branches" && (
          <BranchManagementBoard />
        )}

        {showSuperAdminBoard && superAdminView === "marketing" && (
          <MarketingBoard branches={branches} />
        )}

        {showSuperAdminBoard && superAdminView === "presales" && (
          <PreSalesCRM onManageStages={() => setSuperAdminView("stages")} />
        )}

        {showSuperAdminBoard && superAdminView === "stages" && (
          <PipelineStageManagement onBack={() => setSuperAdminView("presales")} />
        )}

        {showPreSalesBoard && (
          <PreSalesCRM />
        )}

        {(showSuperAdminBoard && superAdminView === "master") && (
          <Card className="border-slate-200 bg-white" data-testid="top-board-card">
            <CardHeader>
              <CardTitle className="text-base text-slate-900" data-testid="top-board-title">
                Master Flow Snapshot
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3">
              {PIPELINE_STAGES.map((stage) => (
                <div key={stage} className={`rounded-md border p-3 ${STAGE_THEME[stage]?.column || "border-slate-200 bg-slate-50"}`} data-testid={`top-board-stage-${stage}`}>
                  <p className="text-xs text-slate-500" data-testid={`top-board-stage-label-${stage}`}>{stage}</p>
                  <p className={`text-2xl font-semibold ${STAGE_THEME[stage]?.metric || "text-sky-600"}`} data-testid={`top-board-stage-value-${stage}`}>
                    {masterBoard.stage_counts?.[stage] || 0}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {showBusinessDevBoard && (
          <BusinessLeadsDashboard />
        )}

        {showSuperAdminBoard && superAdminView === "master" && (
          <Card className="border-slate-200 bg-white" data-testid="lead-master-card">
            <CardHeader>
              <CardTitle className="text-base">Lead Master Board</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2 md:grid-cols-4">
                <Input value={leadForm.name} onChange={(e) => setLeadForm((p) => ({ ...p, name: e.target.value }))} placeholder="Lead name" data-testid="lead-master-name-input" />
                <Input value={leadForm.phone} onChange={(e) => setLeadForm((p) => ({ ...p, phone: e.target.value }))} placeholder="Phone" data-testid="lead-master-phone-input" />
                <Input value={leadForm.email} onChange={(e) => setLeadForm((p) => ({ ...p, email: e.target.value }))} placeholder="Email" data-testid="lead-master-email-input" />
                <Button onClick={createLeadNow} data-testid="lead-master-create-button">+ New Lead</Button>
              </div>

              <div className="grid gap-2 md:grid-cols-3">
                <select value={leadStageFilter} onChange={(e) => setLeadStageFilter(e.target.value)} className="h-9 rounded-md border border-slate-200 px-3 text-sm" data-testid="lead-master-stage-filter">
                  <option value="">All stages</option>
                  {PIPELINE_STAGES.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
                </select>
                <select value={leadBranchFilter} onChange={(e) => setLeadBranchFilter(e.target.value)} className="h-9 rounded-md border border-slate-200 px-3 text-sm" data-testid="lead-master-branch-filter">
                  <option value="">All branches</option>
                  {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.branch_name}</option>)}
                </select>
                <Button variant="outline" onClick={loadEverything} data-testid="lead-master-refresh-button">Refresh</Button>
              </div>

              <div className="overflow-auto rounded-lg border border-slate-200" data-testid="lead-master-table-wrap">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-slate-600">
                    <tr>
                      <th className="px-3 py-2">Lead</th>
                      <th className="px-3 py-2">Source</th>
                      <th className="px-3 py-2">Stage</th>
                      <th className="px-3 py-2">Branch</th>
                      <th className="px-3 py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map((lead) => (
                      <tr key={lead.id} className="border-t border-slate-100" data-testid={`lead-master-row-${lead.id}`}>
                        <td className="px-3 py-2" data-testid={`lead-master-name-${lead.id}`}>{lead.name} · {lead.phone}</td>
                        <td className="px-3 py-2" data-testid={`lead-master-source-${lead.id}`}>{lead.source_tab || lead.source_type}</td>
                        <td className="px-3 py-2" data-testid={`lead-master-stage-${lead.id}`}>{lead.stage}</td>
                        <td className="px-3 py-2" data-testid={`lead-master-branch-${lead.id}`}>{branches.find((b) => b.id === lead.branch_id)?.branch_name || "Unassigned"}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {(showSuperAdminBoard || showPreSalesBoard) && (
                              <Button size="sm" onClick={() => qualifyNow(lead.id)} className="bg-amber-500 text-white hover:bg-amber-600" data-testid={`lead-action-qualify-${lead.id}`}>Qualify</Button>
                            )}

                            {(showSuperAdminBoard || showPreSalesBoard) && (
                              <>
                                <select value={assignBranchSelection[lead.id] || ""} onChange={(e) => setAssignBranchSelection((p) => ({ ...p, [lead.id]: e.target.value }))} className="h-8 rounded border border-slate-200 px-1 text-xs" data-testid={`lead-action-branch-select-${lead.id}`}>
                                  <option value="">Branch</option>
                                  {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.branch_name}</option>)}
                                </select>
                                <Button size="sm" onClick={() => assignBranchNow(lead.id)} className="bg-violet-500 text-white hover:bg-violet-600" data-testid={`lead-action-assign-${lead.id}`}>Assign</Button>
                              </>
                            )}

                            {(showSuperAdminBoard || showBranchBoard) && (
                              <Button size="sm" onClick={() => confirmNow(lead.id)} className="bg-teal-500 text-white hover:bg-teal-600" data-testid={`lead-action-confirm-${lead.id}`}>Confirm</Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {showBranchBoard && (
          <BranchAdminBoard branchId={auth?.user?.branch_id} />
        )}

        {showHeadPhysioBoard && (
          <HeadPhysioBoard />
        )}

        {showPhysioBoard && (
          <PhysioBoard />
        )}

        {showSuperAdminBoard && superAdminView === "master" && (
          <div data-testid="doctor-appointments-section">
            <Card className="border-slate-200 bg-white" data-testid="doctor-setup-card">
                <CardHeader>
                  <CardTitle className="text-base">Fitsiomax Experts</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500" data-testid="fitsiomax-expert-add-heading">Add Fitsiomax Expert</p>
                  <form className="grid gap-2 md:grid-cols-2" onSubmit={createDoctorNow} data-testid="doctor-setup-form">
                    <Input value={doctorForm.full_name} onChange={(e) => setDoctorForm((p) => ({ ...p, full_name: e.target.value }))} placeholder="Fitsiomax Expert name" data-testid="doctor-setup-name-input" />
                    <select value={doctorForm.profile_type} onChange={(e) => setDoctorForm((p) => ({ ...p, profile_type: e.target.value }))} className="h-9 rounded-md border border-slate-200 px-3 text-sm" data-testid="doctor-setup-profile-select">
                      <option value="head_physio">Head Physio</option>
                      <option value="physio">Physio</option>
                    </select>
                    <select value={doctorForm.branch_id} onChange={(e) => setDoctorForm((p) => ({ ...p, branch_id: e.target.value }))} className="h-9 rounded-md border border-slate-200 px-3 text-sm" data-testid="doctor-setup-branch-select">
                      <option value="">Branch</option>
                      {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.branch_name}</option>)}
                    </select>
                    <Input value={doctorForm.specialization} onChange={(e) => setDoctorForm((p) => ({ ...p, specialization: e.target.value }))} placeholder="Specialization" data-testid="doctor-setup-specialization-input" />
                    <div className="md:col-span-2">
                      <Button type="submit" data-testid="doctor-setup-submit-button">Create Fitsiomax Expert</Button>
                    </div>
                  </form>

                  <form className="mt-3 grid gap-2 md:grid-cols-3" onSubmit={addSlotNow} data-testid="doctor-slot-form">
                    <select value={slotDoctorId} onChange={(e) => setSlotDoctorId(e.target.value)} className="h-9 rounded-md border border-slate-200 px-3 text-sm" data-testid="doctor-slot-doctor-select">
                      <option value="">Assign Fitsiomax Expert</option>
                      {doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.full_name}</option>)}
                    </select>
                    <Input type="datetime-local" value={slotTime} onChange={(e) => setSlotTime(e.target.value)} data-testid="doctor-slot-time-input" />
                    <Button type="submit" variant="outline" data-testid="doctor-slot-submit-button">Add Slot</Button>
                  </form>
                </CardContent>
              </Card>
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
