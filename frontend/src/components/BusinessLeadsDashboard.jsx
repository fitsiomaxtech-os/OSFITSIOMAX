import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Building2,
  CalendarCheck,
  Clock,
  Database,
  Download,
  Edit3,
  FileSpreadsheet,
  Globe,
  Headphones,
  IndianRupee,
  Megaphone,
  Percent,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  TrendingDown,
  TrendingUp,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import {
  assignLeadBranch,
  createBranch,
  createSheetConnection,
  deleteBranch,
  getBdSummary,
  getBranches,
  getLeadSources,
  getLeads,
  getSheetConnections,
  qualifyLead,
  saveSheetMapping,
  syncSheetConnection,
  updateBranch,
} from "@/lib/api";
import { CreateLeadModal } from "@/components/CreateLeadModal";
import { MilkDateInput } from "@/components/ui/milk-calendar";
// The Marketing and Sales master views, mounted as two tabs below. Imported statically,
// the way OperationsBoard already mounts this same board: this file is itself behind a
// lazy() in CRMPage, so webpack lifts what the two chunks share rather than copying
// PreSalesCRM into each.
import { PreSalesCRM } from "@/components/PreSalesCRM";

// Marketing View and Sales View are the same two boards Super Admin reaches as
// "Marketing Master View" and "Sales Master View" — the same PreSalesCRM mount, under the
// shorter names, because here they are two tabs on a strip and not two entries on a
// top-level nav. They sit last: everything to their left is this desk's own work, and
// these two are a read of what the other two desks did with it.
const TABS = [
  { key: "dashboard", label: "Dashboard", icon: BarChart3 },
  { key: "branches", label: "Branches", icon: Building2 },
  { key: "lead_master", label: "Lead Master", icon: Database },
  { key: "sheets", label: "Google Sheet Connection", icon: FileSpreadsheet },
  { key: "lead_source", label: "Lead Source", icon: Globe },
  { key: "marketing_view", label: "Marketing View", icon: Megaphone },
  { key: "sales_view", label: "Sales View", icon: Headphones },
];

const PIPELINE_STAGES = [
  "New Leads",
  "Follow Up",
  "Appointment",
];

const STAGE_COLOR = {
  "New Leads": "bg-blue-50 text-blue-700 border-blue-200",
  "Follow Up": "bg-amber-50 text-amber-700 border-amber-200",
  "Appointment": "bg-emerald-50 text-emerald-700 border-emerald-200",
};

const STAGE_HEX = {
  "New Leads": "#2563eb",
  "Follow Up": "#f59e0b",
  "Appointment": "#059669",
};

const defaultBranchForm = {
  branch_name: "",
  address: "",
  admin_name: "",
  admin_email: "",
  admin_password: "",
  admin_phone: "",
  vertical: "offline_physiotherapy",
};

const defaultSheetForm = {
  connection_name: "",
  spreadsheet_id: "",
  sync_interval_minutes: 30,
};

const defaultMapping = { name: "name", phone: "phone", email: "email", vertical: "vertical" };

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

function formatMoney(v) {
  const n = Number(v || 0);
  return `Rs.${n.toLocaleString("en-IN")}`;
}

function csvEscape(value) {
  const s = String(value ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCsv(filename, rows) {
  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * @param currentUser  the signed-in Business Development Executive. Only the Marketing
 *                     View and Sales View tabs read it — PreSalesCRM schedules and stamps
 *                     activity against whoever is looking, and without this those two
 *                     tabs would be working leads on behalf of nobody.
 */
export const BusinessLeadsDashboard = ({ currentUser = null }) => {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [loading, setLoading] = useState(false);

  const [summary, setSummary] = useState(null);
  const [branches, setBranches] = useState([]);
  const [leads, setLeads] = useState([]);
  const [sheetConnections, setSheetConnections] = useState([]);
  const [leadSources, setLeadSources] = useState([]);
  const [showCreateLead, setShowCreateLead] = useState(false);

  const [branchForm, setBranchForm] = useState(defaultBranchForm);
  const [showBranchForm, setShowBranchForm] = useState(false);
  const [editingBranch, setEditingBranch] = useState(null);
  const [deletingBranchId, setDeletingBranchId] = useState(null);

  // Shared filter toolbar — drives both the Dashboard KPIs/charts and the Lead Master table.
  const [leadStageFilter, setLeadStageFilter] = useState("");
  const [leadBranchFilter, setLeadBranchFilter] = useState("");
  const [leadSourceFilter, setLeadSourceFilter] = useState("");
  const [leadDateFrom, setLeadDateFrom] = useState("");
  const [leadDateTo, setLeadDateTo] = useState("");
  const [leadSearch, setLeadSearch] = useState("");
  const [assignBranchSelection, setAssignBranchSelection] = useState({});

  const [sheetForm, setSheetForm] = useState(defaultSheetForm);
  const [selectedConnectionId, setSelectedConnectionId] = useState("");
  const [mappingFields, setMappingFields] = useState(defaultMapping);
  const [syncPayload, setSyncPayload] = useState(defaultSyncPayload);

  const filterParams = useMemo(() => {
    const params = {};
    if (leadStageFilter) params.stage = leadStageFilter;
    if (leadBranchFilter) params.branch_id = leadBranchFilter;
    if (leadSourceFilter) params.source_tab = leadSourceFilter;
    if (leadDateFrom) params.start_date = `${leadDateFrom}T00:00:00`;
    if (leadDateTo) params.end_date = `${leadDateTo}T23:59:59`;
    return params;
  }, [leadStageFilter, leadBranchFilter, leadSourceFilter, leadDateFrom, leadDateTo]);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getBdSummary(filterParams);
      setSummary(data);
    } catch (e) { console.warn("[BD load failed]", e?.message || e); }
    setLoading(false);
  }, [filterParams]);

  const loadBranches = useCallback(async () => {
    try {
      const data = await getBranches();
      setBranches(data);
    } catch (e) { console.warn("[BD load failed]", e?.message || e); }
  }, []);

  const loadLeads = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getLeads(filterParams);
      setLeads(data);
    } catch (e) { console.warn("[BD load failed]", e?.message || e); }
    setLoading(false);
  }, [filterParams]);

  const loadSheets = useCallback(async () => {
    try {
      const data = await getSheetConnections();
      setSheetConnections(data);
    } catch (e) { console.warn("[BD load failed]", e?.message || e); }
  }, []);

  const loadSources = useCallback(async () => {
    try {
      const data = await getLeadSources();
      setLeadSources(data);
    } catch (e) { console.warn("[BD load failed]", e?.message || e); }
  }, []);

  useEffect(() => {
    loadDashboard();
    loadBranches();
  }, [loadDashboard, loadBranches]);

  useEffect(() => {
    if (activeTab === "lead_master") loadLeads();
    if (activeTab === "sheets") loadSheets();
    if (activeTab === "lead_source") loadSources();
  }, [activeTab, loadLeads, loadSheets, loadSources]);

  const refreshAll = async () => {
    await Promise.all([loadDashboard(), loadBranches(), loadLeads(), loadSheets(), loadSources()]);
    toast.success("Data refreshed");
  };

  const exportLeadsCsv = async () => {
    try {
      const data = await getLeads(filterParams);
      const rows = [
        ["Name", "Phone", "Email", "Source", "Stage", "Branch", "Created"],
        ...data.map((l) => [
          l.name,
          l.phone,
          l.email,
          l.source_tab || l.source_type,
          l.stage,
          branches.find((b) => b.id === l.branch_id)?.branch_name || "Unassigned",
          l.created_at?.slice(0, 10),
        ]),
      ];
      downloadCsv(`bd-leads-${new Date().toISOString().slice(0, 10)}.csv`, rows);
      toast.success(`Exported ${data.length} leads`);
    } catch (err) {
      toast.error("Export failed");
    }
  };

  const filteredLeads = useMemo(() => {
    if (!leadSearch.trim()) return leads;
    const q = leadSearch.toLowerCase();
    return leads.filter(
      (l) =>
        l.name?.toLowerCase().includes(q) ||
        l.phone?.toLowerCase().includes(q) ||
        l.email?.toLowerCase().includes(q),
    );
  }, [leads, leadSearch]);

  const createBranchNow = async (e) => {
    e.preventDefault();
    if (!branchForm.branch_name.trim() || !branchForm.admin_email.trim()) {
      toast.error("Branch name and admin email required");
      return;
    }
    try {
      await createBranch(branchForm);
      setBranchForm(defaultBranchForm);
      setShowBranchForm(false);
      toast.success("Branch created");
      await loadBranches();
      await loadDashboard();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Branch creation failed");
    }
  };

  const openEditBranch = (branch) => {
    setEditingBranch(branch);
    setBranchForm({
      branch_name: branch.branch_name || "",
      address: branch.address || "",
      admin_name: branch.admin_name || "",
      admin_email: branch.admin_email || "",
      admin_password: "",
      admin_phone: branch.admin_phone || "",
      vertical: branch.vertical || "offline_physiotherapy",
    });
  };

  const updateBranchNow = async (e) => {
    e.preventDefault();
    if (!editingBranch) return;
    try {
      await updateBranch(editingBranch.id, {
        branch_name: branchForm.branch_name,
        address: branchForm.address,
        admin_name: branchForm.admin_name,
        admin_phone: branchForm.admin_phone,
        vertical: branchForm.vertical,
      });
      setEditingBranch(null);
      setBranchForm(defaultBranchForm);
      toast.success("Branch updated");
      await loadBranches();
      await loadDashboard();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Update failed");
    }
  };

  const deleteBranchNow = async (branchId) => {
    try {
      await deleteBranch(branchId);
      setDeletingBranchId(null);
      toast.success("Branch deleted");
      await loadBranches();
      await loadDashboard();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Delete failed");
    }
  };

  const qualifyNow = async (leadId) => {
    try {
      await qualifyLead(leadId);
      toast.success("Lead qualified");
      await loadLeads();
      await loadDashboard();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Qualify failed");
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
      await loadLeads();
      await loadDashboard();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Assign failed");
    }
  };

  const createConnectionNow = async (e) => {
    e.preventDefault();
    if (!sheetForm.connection_name.trim()) {
      toast.error("Connection name required");
      return;
    }
    try {
      await createSheetConnection(sheetForm);
      setSheetForm(defaultSheetForm);
      toast.success("Connection created");
      await loadSheets();
      await loadDashboard();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Connection failed");
    }
  };

  const saveMappingNow = async () => {
    if (!selectedConnectionId) {
      toast.error("Select a connection first");
      return;
    }
    try {
      await saveSheetMapping(selectedConnectionId, { field_map: mappingFields, create_new_fields: true });
      toast.success("Mapping saved");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Save mapping failed");
    }
  };

  const runSyncNow = async () => {
    if (!selectedConnectionId) {
      toast.error("Select a connection first");
      return;
    }
    try {
      const parsed = JSON.parse(syncPayload);
      const result = await syncSheetConnection(selectedConnectionId, parsed);
      toast.success(`Synced: ${result.imported} imported, ${result.skipped} skipped`);
      await loadLeads();
      await loadDashboard();
      await loadSources();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Sync failed — verify JSON");
    }
  };

  return (
    <div className="space-y-5" data-testid="bd-dashboard-root">
      {/* Tab Navigation */}
      <div className="flex items-center gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm" data-testid="bd-tab-bar">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-medium transition-all ${
                isActive
                  ? "bg-gradient-to-r from-sky-600 to-blue-600 text-white shadow-md"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
              }`}
              data-testid={`bd-tab-${tab.key}`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
        <div className="ml-auto flex flex-shrink-0 items-center gap-1.5">
          <Button size="sm" onClick={() => setShowCreateLead(true)} className="bg-sky-600 hover:bg-sky-700" data-testid="bd-quick-add-lead-btn">
            <UserPlus className="mr-1 h-4 w-4" /> Add Lead
          </Button>
          {/* The same Refresh as Branch Admin > Branch Leads: grey, icon-only, square,
              with the word on title/aria-label. It was a ghost button that read as
              nothing at all beside Add Lead; refreshing is the least interesting control
              on the row and is coloured accordingly, but it still has to look like a
              button you can press. */}
          <Button
            onClick={refreshAll}
            disabled={loading}
            title="Refresh"
            aria-label="Refresh"
            className="h-10 w-10 shrink-0 bg-slate-500 p-0 text-white hover:bg-slate-600"
            data-testid="bd-refresh-all-btn"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Dashboard Tab */}
      {activeTab === "dashboard" && (
        <DashboardTab
          summary={summary}
          loading={loading}
          branches={branches}
          leadSources={leadSources}
          leadStageFilter={leadStageFilter}
          setLeadStageFilter={setLeadStageFilter}
          leadBranchFilter={leadBranchFilter}
          setLeadBranchFilter={setLeadBranchFilter}
          leadSourceFilter={leadSourceFilter}
          setLeadSourceFilter={setLeadSourceFilter}
          leadDateFrom={leadDateFrom}
          setLeadDateFrom={setLeadDateFrom}
          leadDateTo={leadDateTo}
          setLeadDateTo={setLeadDateTo}
          onRefresh={refreshAll}
        />
      )}

      {/* Branches Tab */}
      {activeTab === "branches" && (
        <BranchesTab
          branches={branches}
          branchForm={branchForm}
          setBranchForm={setBranchForm}
          showBranchForm={showBranchForm}
          setShowBranchForm={setShowBranchForm}
          createBranchNow={createBranchNow}
          editingBranch={editingBranch}
          openEditBranch={openEditBranch}
          setEditingBranch={setEditingBranch}
          updateBranchNow={updateBranchNow}
          deletingBranchId={deletingBranchId}
          setDeletingBranchId={setDeletingBranchId}
          deleteBranchNow={deleteBranchNow}
        />
      )}

      {/* Lead Master Tab */}
      {activeTab === "lead_master" && (
        <LeadMasterTab
          leads={filteredLeads}
          branches={branches}
          leadStageFilter={leadStageFilter}
          setLeadStageFilter={setLeadStageFilter}
          leadBranchFilter={leadBranchFilter}
          setLeadBranchFilter={setLeadBranchFilter}
          leadDateFrom={leadDateFrom}
          setLeadDateFrom={setLeadDateFrom}
          leadDateTo={leadDateTo}
          setLeadDateTo={setLeadDateTo}
          leadSearch={leadSearch}
          setLeadSearch={setLeadSearch}
          assignBranchSelection={assignBranchSelection}
          setAssignBranchSelection={setAssignBranchSelection}
          qualifyNow={qualifyNow}
          assignBranchNow={assignBranchNow}
          loadLeads={loadLeads}
          onExportCsv={exportLeadsCsv}
          loading={loading}
        />
      )}

      {/* Google Sheet Connection Tab */}
      {activeTab === "sheets" && (
        <SheetsTab
          sheetConnections={sheetConnections}
          sheetForm={sheetForm}
          setSheetForm={setSheetForm}
          createConnectionNow={createConnectionNow}
          selectedConnectionId={selectedConnectionId}
          setSelectedConnectionId={setSelectedConnectionId}
          mappingFields={mappingFields}
          setMappingFields={setMappingFields}
          saveMappingNow={saveMappingNow}
          syncPayload={syncPayload}
          setSyncPayload={setSyncPayload}
          runSyncNow={runSyncNow}
        />
      )}

      {/* Lead Source Tab */}
      {activeTab === "lead_source" && (
        <LeadSourceTab leadSources={leadSources} loading={loading} />
      )}

      {/* Marketing View / Sales View — the same two PreSalesCRM mounts Super Admin gets.
          The role is hardcoded on each, not read from the signed-in user: the prop picks
          which board PreSalesCRM draws, and a Business Development Executive passing
          their own role would land on a rep's own filtered book rather than either
          master view. What they may actually read is settled by the API off their token,
          the same as it is for Super Admin's copy of these tabs.

          `embedded` because this board is the host: PreSalesCRM's own phone padding is
          for a fixed bottom nav, and there is none under this strip. */}
      {activeTab === "marketing_view" && (
        <PreSalesCRM role="marketing_head" currentUser={currentUser} embedded />
      )}

      {activeTab === "sales_view" && (
        <PreSalesCRM role="sales_head" currentUser={currentUser} embedded />
      )}

      {showCreateLead && (
        <CreateLeadModal
          isSuperAdmin
          onClose={() => setShowCreateLead(false)}
          onSaved={() => {
            loadDashboard();
            if (activeTab === "lead_master") loadLeads();
            loadSources();
          }}
        />
      )}

      {loading && (
        <div className="fixed bottom-4 right-4 rounded-full bg-slate-900 px-4 py-2 text-xs font-medium text-white shadow-lg" data-testid="bd-loading-indicator">
          Loading...
        </div>
      )}
    </div>
  );
};

/* ─── Sparkline ─── */
/**
 * The trend line inside a summary card.
 *
 * Drawn in the card's own ink rather than in white: these cards are white now (see
 * KpiCard), and a white line on a white card is a line nobody can see. The colour a
 * caller passes is used for the stroke and, at low opacity, for the fill under it —
 * one hue, so the line reads as one mark and not as a chart with a legend.
 */
function Sparkline({ data, color = "#0284c7" }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = Math.max(max - min, 1);
  const w = 100;
  const h = 26;
  const step = w / (data.length - 1);
  const points = data.map((v, i) => `${i * step},${h - ((v - min) / range) * h}`).join(" ");
  const areaPoints = `0,${h} ${points} ${w},${h}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-6 w-full" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={areaPoints} fill={color} fillOpacity="0.14" stroke="none" />
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ─── KPI Card ─── */
/**
 * A figure on this board, in the shape Super Admin > HR Admin > Dashboard uses: white,
 * a two-pixel slate rule, the label small and capitalised above a large dark number.
 *
 * It was nine cards in nine different gradients — sky, cyan, amber, violet, emerald,
 * teal, indigo, fuchsia, orange — which made the row read as nine unrelated things and
 * put the colour where the number should be. The OS already had one answer for this row
 * and it is HR's, so this is that one rather than a tenth invention.
 *
 * `trend` and `sparkline` are what HR's tiles do not carry, and they are re-inked to
 * suit: the pill is tinted by direction (a rise is green, a fall is red) where before it
 * leaned on the gradient behind it for contrast, and the line is drawn in sky.
 */
function KpiCard({ label, value, icon: Icon, trend, sparkline, testid }) {
  // Green up, red down, slate flat — the direction is the whole point of the pill, and on
  // a white card it has to come from the pill's own colour. On the gradients it came from
  // an arrow on a translucent white chip, which said "changed" without saying which way.
  const trendTone = trend?.direction === "up"
    ? "bg-emerald-50 text-emerald-700"
    : trend?.direction === "down"
      ? "bg-rose-50 text-rose-700"
      : "bg-slate-100 text-slate-500";
  return (
    <div className="rounded-xl border-2 border-slate-200 bg-white px-4 py-3.5" data-testid={testid}>
      <span className="flex items-center gap-1.5 text-slate-500">
        {Icon && <Icon className="h-4 w-4 shrink-0" />}
        <span className="truncate text-[11px] font-bold uppercase tracking-wider">{label}</span>
      </span>
      <span className="mt-1 block text-3xl font-extrabold text-slate-800">{value}</span>
      {trend && (
        <div className={`mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${trendTone}`}>
          {trend.direction === "up" && <TrendingUp className="h-3 w-3" />}
          {trend.direction === "down" && <TrendingDown className="h-3 w-3" />}
          {trend.text}
        </div>
      )}
      {sparkline && (
        <div className="mt-1.5">
          <Sparkline data={sparkline} />
        </div>
      )}
    </div>
  );
}

/* ─── Dashboard Tab ─── */
function DashboardTab({
  summary, loading, branches, leadSources,
  leadStageFilter, setLeadStageFilter,
  leadBranchFilter, setLeadBranchFilter,
  leadSourceFilter, setLeadSourceFilter,
  leadDateFrom, setLeadDateFrom,
  leadDateTo, setLeadDateTo,
  onRefresh,
}) {
  if (!summary && loading) {
    return <p className="py-8 text-center text-sm text-slate-400" data-testid="bd-dash-loading">Loading dashboard...</p>;
  }
  if (!summary) {
    return <p className="py-8 text-center text-sm text-slate-400" data-testid="bd-dash-empty">No data yet</p>;
  }

  const weekTrendCounts = (summary.week_trend || []).map((d) => d.count);
  const todayCount = summary.today_leads || 0;
  const yesterdayCount = weekTrendCounts.length >= 2 ? weekTrendCounts[weekTrendCounts.length - 2] : null;
  const todayTrend = yesterdayCount === null ? null : todayCount === yesterdayCount
    ? { direction: "flat", text: "Same as yesterday" }
    : todayCount > yesterdayCount
      ? { direction: "up", text: `+${todayCount - yesterdayCount} vs yesterday` }
      : { direction: "down", text: `-${yesterdayCount - todayCount} vs yesterday` };

  const weekChangePct = summary.leads_last_week
    ? Math.round(((summary.leads_this_week - summary.leads_last_week) / summary.leads_last_week) * 100)
    : null;
  const weekTrend = weekChangePct === null ? null : {
    direction: weekChangePct >= 0 ? "up" : "down",
    text: `${weekChangePct >= 0 ? "+" : ""}${weekChangePct}% vs last week`,
  };

  const followUp = summary.stage_counts?.["Follow Up"] || 0;

  // No colour per card any more: every one of these is the same kind of thing (a count
  // this desk is answerable for), and nine gradients said they were nine kinds. The
  // first two keep a trend and a line because they are the only two that read against
  // a previous period -- the rest are a standing total, and a sparkline under one of
  // those would be a line drawn from nothing.
  const metrics = [
    { key: "total", label: "Total Leads", value: summary.total_leads, icon: Users, trend: weekTrend, sparkline: weekTrendCounts },
    { key: "today", label: "Today's Leads", value: todayCount, icon: Sparkles, trend: todayTrend, sparkline: weekTrendCounts },
    { key: "followup", label: "Active Follow-ups", value: followUp, icon: Clock },
    { key: "appointments", label: "Appointments", value: summary.total_appointments, icon: CalendarCheck },
    { key: "converted", label: "Converted", value: summary.completed_appointments, icon: TrendingUp },
    { key: "revenue", label: "Revenue Generated", value: formatMoney(summary.revenue_generated), icon: IndianRupee },
    { key: "conversion", label: "Conversion Rate", value: `${summary.conversion_rate}%`, icon: Percent },
    { key: "branches", label: "Branches", value: summary.total_branches, icon: Building2 },
    { key: "sheets", label: "Connected Sheets", value: summary.total_connections, icon: FileSpreadsheet },
  ];

  return (
    <div className="space-y-5" data-testid="bd-dashboard-content">
      {/* Filter Toolbar */}
      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          <MilkDateInput  value={leadDateFrom} onChange={(e) => setLeadDateFrom(e.target.value)} className="h-9 w-auto" data-testid="bd-filter-date-from" />
          <span className="text-xs text-slate-400">to</span>
          <MilkDateInput  value={leadDateTo} onChange={(e) => setLeadDateTo(e.target.value)} className="h-9 w-auto" data-testid="bd-filter-date-to" />
          <select value={leadBranchFilter} onChange={(e) => setLeadBranchFilter(e.target.value)} className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm" data-testid="bd-filter-branch">
            <option value="">All branches</option>
            {branches.map((b) => (<option key={b.id} value={b.id}>{b.branch_name}</option>))}
          </select>
          <select value={leadSourceFilter} onChange={(e) => setLeadSourceFilter(e.target.value)} className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm" data-testid="bd-filter-source">
            <option value="">All sources</option>
            {leadSources.map((s) => (<option key={s.source_tab} value={s.source_tab}>{s.source_tab}</option>))}
          </select>
          <select value={leadStageFilter} onChange={(e) => setLeadStageFilter(e.target.value)} className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm" data-testid="bd-filter-stage">
            <option value="">All stages</option>
            {PIPELINE_STAGES.map((s) => (<option key={s} value={s}>{s}</option>))}
          </select>
          {(leadBranchFilter || leadSourceFilter || leadStageFilter || leadDateFrom || leadDateTo) && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => { setLeadBranchFilter(""); setLeadSourceFilter(""); setLeadStageFilter(""); setLeadDateFrom(""); setLeadDateTo(""); }}
              data-testid="bd-filter-clear"
            >
              Clear filters
            </Button>
          )}
          {/* Branch Admin > Branch Leads' Refresh, the same as the one on the tab strip
              above: grey, square, icon-only, the word on title/aria-label. h-9 rather
              than that row's h-10 -- every other control in this toolbar is h-9, and
              matching the row it sits in beats matching a toolbar on another screen. */}
          <Button
            onClick={onRefresh}
            disabled={loading}
            title="Refresh"
            aria-label="Refresh"
            className="ml-auto h-9 w-9 shrink-0 bg-slate-500 p-0 text-white hover:bg-slate-600"
            data-testid="bd-filter-refresh"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </CardContent>
      </Card>

      {/* KPI Grid. The same grid HR Admin's Dashboard lays its row out on -- two up on a
          phone, five across on a desk -- so nine cards land as 5 + 4 rather than in a
          shape of their own. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" data-testid="bd-metrics-grid">
        {metrics.map((m) => (
          <KpiCard key={m.key} label={m.label} value={m.value} icon={m.icon} trend={m.trend} sparkline={m.sparkline} testid={`bd-metric-${m.key}`} />
        ))}
      </div>
    </div>
  );
}

/* ─── Branches Tab ─── */
function BranchesTab({ branches, branchForm, setBranchForm, showBranchForm, setShowBranchForm, createBranchNow, editingBranch, openEditBranch, setEditingBranch, updateBranchNow, deletingBranchId, setDeletingBranchId, deleteBranchNow }) {
  const closeForm = () => {
    setShowBranchForm(false);
    setEditingBranch(null);
    setBranchForm({ branch_name: "", address: "", admin_name: "", admin_email: "", admin_password: "", admin_phone: "", vertical: "offline_physiotherapy" });
  };

  return (
    <div className="space-y-4" data-testid="bd-branches-content">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-800" data-testid="bd-branches-title">Branches ({branches.length})</h2>
        <Button size="sm" onClick={() => { closeForm(); setShowBranchForm(true); }} className="bg-sky-600 hover:bg-sky-700" data-testid="bd-branches-add-btn">
          <Plus className="mr-1 h-4 w-4" /> Add Branch
        </Button>
      </div>

      {/* Branch Table */}
      <div className="overflow-auto rounded-2xl border border-slate-200 shadow-sm" data-testid="bd-branches-table">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">Branch Name</th>
              <th className="px-3 py-2 font-medium">Address</th>
              <th className="px-3 py-2 font-medium">Admin</th>
              <th className="px-3 py-2 font-medium">Vertical</th>
              <th className="px-3 py-2 font-medium">Created</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {branches.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-400">No branches yet</td>
              </tr>
            ) : (
              branches.map((b) => (
                <tr key={b.id} className="border-t border-slate-100" data-testid={`bd-branch-row-${b.id}`}>
                  <td className="px-3 py-2 font-medium text-slate-800">{b.branch_name}</td>
                  <td className="px-3 py-2 text-slate-600">{b.address}</td>
                  <td className="px-3 py-2 text-slate-600">{b.admin_name} ({b.admin_email})</td>
                  <td className="px-3 py-2">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{b.vertical}</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-400">{b.created_at?.slice(0, 10)}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      <button type="button" onClick={() => openEditBranch(b)} className="rounded-md border border-slate-200 p-1.5 text-sky-600 hover:bg-sky-50" data-testid={`bd-branch-edit-${b.id}`}>
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={() => setDeletingBranchId(b.id)} className="rounded-md border border-slate-200 p-1.5 text-red-500 hover:bg-red-50" data-testid={`bd-branch-delete-${b.id}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add Branch Popup */}
      {showBranchForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => { if (e.target === e.currentTarget) closeForm(); }} data-testid="bd-branch-modal-overlay">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" data-testid="bd-branch-add-modal">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-800">Add New Branch</h3>
              <button type="button" onClick={closeForm} className="rounded-md p-1 hover:bg-slate-100" data-testid="bd-branch-modal-close">
                <X className="h-5 w-5 text-slate-400" />
              </button>
            </div>
            <form onSubmit={createBranchNow} className="space-y-3" data-testid="bd-branch-form">
              <Input value={branchForm.branch_name} onChange={(e) => setBranchForm((p) => ({ ...p, branch_name: e.target.value }))} placeholder="Branch Name *" data-testid="bd-branch-name-input" />
              <Input value={branchForm.address} onChange={(e) => setBranchForm((p) => ({ ...p, address: e.target.value }))} placeholder="Address" data-testid="bd-branch-address-input" />
              <Input value={branchForm.admin_name} onChange={(e) => setBranchForm((p) => ({ ...p, admin_name: e.target.value }))} placeholder="Admin Name" data-testid="bd-branch-admin-name-input" />
              <Input value={branchForm.admin_email} onChange={(e) => setBranchForm((p) => ({ ...p, admin_email: e.target.value }))} placeholder="Admin Email *" data-testid="bd-branch-admin-email-input" />
              <Input value={branchForm.admin_password} onChange={(e) => setBranchForm((p) => ({ ...p, admin_password: e.target.value }))} placeholder="Admin Password *" type="password" data-testid="bd-branch-admin-password-input" />
              <Input value={branchForm.admin_phone} onChange={(e) => setBranchForm((p) => ({ ...p, admin_phone: e.target.value }))} placeholder="Admin Phone" data-testid="bd-branch-admin-phone-input" />
              <select value={branchForm.vertical} onChange={(e) => setBranchForm((p) => ({ ...p, vertical: e.target.value }))} className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm" data-testid="bd-branch-vertical-select">
                <option value="offline_physiotherapy">Offline Physiotherapy</option>
                <option value="online_physiotherapy">Online Physiotherapy</option>
                <option value="online_fitness">Online Fitness</option>
                <option value="offline_fitness_gym">Offline Fitness / Gym</option>
              </select>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={closeForm}>Cancel</Button>
                <Button type="submit" className="bg-sky-600 text-white hover:bg-sky-700" data-testid="bd-branch-submit-btn">Create Branch</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Branch Popup */}
      {editingBranch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => { if (e.target === e.currentTarget) closeForm(); }} data-testid="bd-branch-edit-overlay">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" data-testid="bd-branch-edit-modal">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-800">Edit Branch</h3>
              <button type="button" onClick={closeForm} className="rounded-md p-1 hover:bg-slate-100" data-testid="bd-branch-edit-close">
                <X className="h-5 w-5 text-slate-400" />
              </button>
            </div>
            <form onSubmit={updateBranchNow} className="space-y-3" data-testid="bd-branch-edit-form">
              <Input value={branchForm.branch_name} onChange={(e) => setBranchForm((p) => ({ ...p, branch_name: e.target.value }))} placeholder="Branch Name" data-testid="bd-branch-edit-name-input" />
              <Input value={branchForm.address} onChange={(e) => setBranchForm((p) => ({ ...p, address: e.target.value }))} placeholder="Address" data-testid="bd-branch-edit-address-input" />
              <Input value={branchForm.admin_name} onChange={(e) => setBranchForm((p) => ({ ...p, admin_name: e.target.value }))} placeholder="Admin Name" data-testid="bd-branch-edit-admin-name-input" />
              <Input value={branchForm.admin_phone} onChange={(e) => setBranchForm((p) => ({ ...p, admin_phone: e.target.value }))} placeholder="Admin Phone" data-testid="bd-branch-edit-phone-input" />
              <select value={branchForm.vertical} onChange={(e) => setBranchForm((p) => ({ ...p, vertical: e.target.value }))} className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm" data-testid="bd-branch-edit-vertical-select">
                <option value="offline_physiotherapy">Offline Physiotherapy</option>
                <option value="online_physiotherapy">Online Physiotherapy</option>
                <option value="online_fitness">Online Fitness</option>
                <option value="offline_fitness_gym">Offline Fitness / Gym</option>
              </select>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={closeForm}>Cancel</Button>
                <Button type="submit" className="bg-sky-600 text-white hover:bg-sky-700" data-testid="bd-branch-edit-submit">Update Branch</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Popup */}
      {deletingBranchId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => { if (e.target === e.currentTarget) setDeletingBranchId(null); }} data-testid="bd-branch-delete-overlay">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl" data-testid="bd-branch-delete-modal">
            <h3 className="mb-2 text-lg font-semibold text-slate-800">Delete Branch?</h3>
            <p className="mb-4 text-sm text-slate-500">This will permanently delete the branch and its admin user. This action cannot be undone.</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDeletingBranchId(null)} data-testid="bd-branch-delete-cancel">Cancel</Button>
              <Button onClick={() => deleteBranchNow(deletingBranchId)} className="bg-red-600 text-white hover:bg-red-700" data-testid="bd-branch-delete-confirm">Delete</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Lead Master Tab ─── */
function LeadMasterTab({
  leads,
  branches,
  leadStageFilter,
  setLeadStageFilter,
  leadBranchFilter,
  setLeadBranchFilter,
  leadDateFrom,
  setLeadDateFrom,
  leadDateTo,
  setLeadDateTo,
  leadSearch,
  setLeadSearch,
  assignBranchSelection,
  setAssignBranchSelection,
  qualifyNow,
  assignBranchNow,
  loadLeads,
  onExportCsv,
  loading,
}) {
  return (
    <div className="space-y-4" data-testid="bd-lead-master-content">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-800" data-testid="bd-lead-master-title">Lead Master ({leads.length})</h2>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onExportCsv} data-testid="bd-lead-master-export-btn">
            <Download className="mr-1 h-4 w-4" /> Export
          </Button>
          <Button size="sm" variant="outline" onClick={loadLeads} data-testid="bd-lead-master-refresh-btn">
            <RefreshCw className="mr-1 h-4 w-4" /> Refresh
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="grid gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:grid-cols-2 lg:grid-cols-5" data-testid="bd-lead-filters">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            className="pl-8"
            value={leadSearch}
            onChange={(e) => setLeadSearch(e.target.value)}
            placeholder="Search leads..."
            data-testid="bd-lead-search-input"
          />
        </div>
        <select value={leadStageFilter} onChange={(e) => setLeadStageFilter(e.target.value)} className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm" data-testid="bd-lead-stage-filter">
          <option value="">All stages</option>
          {PIPELINE_STAGES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select value={leadBranchFilter} onChange={(e) => setLeadBranchFilter(e.target.value)} className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm" data-testid="bd-lead-branch-filter">
          <option value="">All branches</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.branch_name}</option>
          ))}
        </select>
        <MilkDateInput  value={leadDateFrom} onChange={(e) => setLeadDateFrom(e.target.value)} data-testid="bd-lead-date-from" />
        <MilkDateInput  value={leadDateTo} onChange={(e) => setLeadDateTo(e.target.value)} data-testid="bd-lead-date-to" />
      </div>

      {/* Lead Table */}
      <div className="overflow-auto rounded-2xl border border-slate-200 shadow-sm" data-testid="bd-lead-table">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Phone</th>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Source</th>
              <th className="px-3 py-2 font-medium">Stage</th>
              <th className="px-3 py-2 font-medium">Branch</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {leads.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                  {loading ? "Loading..." : "No leads found"}
                </td>
              </tr>
            ) : (
              leads.map((lead) => (
                <tr key={lead.id} className="border-t border-slate-100" data-testid={`bd-lead-row-${lead.id}`}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-semibold text-sky-700">
                        {(lead.name || "?").charAt(0).toUpperCase()}
                      </span>
                      <span className="font-medium text-slate-800">{lead.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{lead.phone}</td>
                  <td className="px-3 py-2 text-slate-600">{lead.email}</td>
                  <td className="px-3 py-2 text-slate-600">{lead.source_tab || lead.source_type}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs ${STAGE_COLOR[lead.stage] || "bg-slate-50 text-slate-600 border-slate-200"}`}>
                      {lead.stage}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {branches.find((b) => b.id === lead.branch_id)?.branch_name || "Unassigned"}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1">
                      {lead.stage === "New Leads" && (
                        <Button size="sm" onClick={() => qualifyNow(lead.id)} className="h-7 bg-amber-500 px-2 text-xs text-white hover:bg-amber-600" data-testid={`bd-lead-qualify-${lead.id}`}>
                          Qualify
                        </Button>
                      )}
                      {["New Leads", "Follow Up"].includes(lead.stage) && (
                        <>
                          <select
                            value={assignBranchSelection[lead.id] || ""}
                            onChange={(e) => setAssignBranchSelection((p) => ({ ...p, [lead.id]: e.target.value }))}
                            className="h-7 rounded border border-slate-200 bg-white px-1 text-xs"
                            data-testid={`bd-lead-branch-select-${lead.id}`}
                          >
                            <option value="">Branch</option>
                            {branches.map((b) => (
                              <option key={b.id} value={b.id}>{b.branch_name}</option>
                            ))}
                          </select>
                          <Button size="sm" onClick={() => assignBranchNow(lead.id)} className="h-7 bg-violet-500 px-2 text-xs text-white hover:bg-violet-600" data-testid={`bd-lead-assign-${lead.id}`}>
                            Assign
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─── Sheets Tab ─── */
function SheetsTab({
  sheetConnections,
  sheetForm,
  setSheetForm,
  createConnectionNow,
  selectedConnectionId,
  setSelectedConnectionId,
  mappingFields,
  setMappingFields,
  saveMappingNow,
  syncPayload,
  setSyncPayload,
  runSyncNow,
}) {
  return (
    <div className="space-y-4" data-testid="bd-sheets-content">
      <h2 className="text-lg font-semibold text-slate-800" data-testid="bd-sheets-title">Google Sheet Connections</h2>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Create Connection */}
        <Card className="rounded-2xl border-slate-200 shadow-sm" data-testid="bd-sheet-create-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Add Connection</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={createConnectionNow} className="space-y-3" data-testid="bd-sheet-create-form">
              <Input value={sheetForm.connection_name} onChange={(e) => setSheetForm((p) => ({ ...p, connection_name: e.target.value }))} placeholder="Connection Name" data-testid="bd-sheet-conn-name-input" />
              <Input value={sheetForm.spreadsheet_id} onChange={(e) => setSheetForm((p) => ({ ...p, spreadsheet_id: e.target.value }))} placeholder="Spreadsheet ID" data-testid="bd-sheet-spreadsheet-id-input" />
              <Input type="number" value={sheetForm.sync_interval_minutes} onChange={(e) => setSheetForm((p) => ({ ...p, sync_interval_minutes: Number(e.target.value) }))} placeholder="Sync interval (minutes)" data-testid="bd-sheet-interval-input" />
              <Button type="submit" className="bg-sky-600 hover:bg-sky-700" data-testid="bd-sheet-create-btn">
                <Plus className="mr-1 h-4 w-4" /> Add Connection
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Existing Connections */}
        <Card className="rounded-2xl border-slate-200 shadow-sm" data-testid="bd-sheet-list-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Existing Connections ({sheetConnections.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {sheetConnections.length === 0 ? (
              <p className="text-sm text-slate-400">No connections yet</p>
            ) : (
              sheetConnections.map((conn) => (
                <div
                  key={conn.id}
                  className={`cursor-pointer rounded-xl border p-3 transition-colors ${
                    selectedConnectionId === conn.id
                      ? "border-sky-300 bg-sky-50"
                      : "border-slate-200 bg-white hover:bg-slate-50"
                  }`}
                  onClick={() => setSelectedConnectionId(conn.id)}
                  data-testid={`bd-sheet-conn-${conn.id}`}
                >
                  <p className="text-sm font-medium text-slate-800">{conn.connection_name}</p>
                  <p className="text-xs text-slate-500">Sheet: {conn.spreadsheet_id}</p>
                  <p className="text-xs text-slate-400">Interval: {conn.sync_interval_minutes}min</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Mapping & Sync */}
      {selectedConnectionId && (
        <Card className="rounded-2xl border-slate-200 shadow-sm" data-testid="bd-sheet-mapping-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Field Mapping & Sync</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Input value={mappingFields.name} onChange={(e) => setMappingFields((p) => ({ ...p, name: e.target.value }))} placeholder="Name column" data-testid="bd-map-name-input" />
              <Input value={mappingFields.phone} onChange={(e) => setMappingFields((p) => ({ ...p, phone: e.target.value }))} placeholder="Phone column" data-testid="bd-map-phone-input" />
              <Input value={mappingFields.email} onChange={(e) => setMappingFields((p) => ({ ...p, email: e.target.value }))} placeholder="Email column" data-testid="bd-map-email-input" />
              <Input value={mappingFields.vertical} onChange={(e) => setMappingFields((p) => ({ ...p, vertical: e.target.value }))} placeholder="Vertical column" data-testid="bd-map-vertical-input" />
            </div>
            <Button variant="outline" onClick={saveMappingNow} data-testid="bd-map-save-btn">Save Mapping</Button>

            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-500">Sync Payload (JSON)</p>
              <textarea
                value={syncPayload}
                onChange={(e) => setSyncPayload(e.target.value)}
                className="min-h-[140px] w-full rounded-md border border-slate-200 bg-white p-3 font-mono text-xs"
                data-testid="bd-sync-payload-textarea"
              />
              <Button onClick={runSyncNow} className="bg-sky-600 hover:bg-sky-700" data-testid="bd-sync-run-btn">Run Sync</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ─── Lead Source Tab ─── */
function LeadSourceTab({ leadSources, loading }) {
  return (
    <div className="space-y-4" data-testid="bd-lead-source-content">
      <h2 className="text-lg font-semibold text-slate-800" data-testid="bd-lead-source-title">Lead Sources</h2>

      <div className="overflow-auto rounded-2xl border border-slate-200 shadow-sm" data-testid="bd-lead-source-table">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">Source</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Total Leads</th>
              {PIPELINE_STAGES.map((s) => (
                <th key={s} className="px-3 py-2 font-medium">{s}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {leadSources.length === 0 ? (
              <tr>
                <td colSpan={3 + PIPELINE_STAGES.length} className="px-3 py-6 text-center text-slate-400">
                  {loading ? "Loading..." : "No lead source data"}
                </td>
              </tr>
            ) : (
              leadSources.map((src) => (
                <tr key={`${src.source_tab}-${src.source_type}`} className="border-t border-slate-100" data-testid={`bd-source-row-${src.source_tab}`}>
                  <td className="px-3 py-2 font-medium text-slate-800">{src.source_tab}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${src.source_type === "google_sheet" ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-600"}`}>
                      {src.source_type}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-semibold text-sky-600">{src.total}</td>
                  {PIPELINE_STAGES.map((stage) => (
                    <td key={stage} className="px-3 py-2 text-slate-600">{src.stage_breakdown?.[stage] || 0}</td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
