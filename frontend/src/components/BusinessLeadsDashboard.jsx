import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Building2,
  Database,
  Edit3,
  FileSpreadsheet,
  Globe,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  TrendingUp,
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
  createManualLead,
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

const TABS = [
  { key: "dashboard", label: "Dashboard", icon: BarChart3 },
  { key: "branches", label: "Branches", icon: Building2 },
  { key: "lead_master", label: "Lead Master", icon: Database },
  { key: "sheets", label: "Google Sheet Connection", icon: FileSpreadsheet },
  { key: "lead_source", label: "Lead Source", icon: Globe },
];

const PIPELINE_STAGES = [
  "New Leads",
  "RNR",
  "Follow Up",
  "Appointment",
];

const STAGE_COLOR = {
  "New Leads": "bg-blue-50 text-blue-700 border-blue-200",
  "RNR": "bg-rose-50 text-rose-700 border-rose-200",
  "Follow Up": "bg-amber-50 text-amber-700 border-amber-200",
  "Appointment": "bg-emerald-50 text-emerald-700 border-emerald-200",
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

export const BusinessLeadsDashboard = () => {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [loading, setLoading] = useState(false);

  const [summary, setSummary] = useState(null);
  const [branches, setBranches] = useState([]);
  const [leads, setLeads] = useState([]);
  const [sheetConnections, setSheetConnections] = useState([]);
  const [leadSources, setLeadSources] = useState([]);

  const [branchForm, setBranchForm] = useState(defaultBranchForm);
  const [showBranchForm, setShowBranchForm] = useState(false);
  const [editingBranch, setEditingBranch] = useState(null);
  const [deletingBranchId, setDeletingBranchId] = useState(null);

  const [leadStageFilter, setLeadStageFilter] = useState("");
  const [leadBranchFilter, setLeadBranchFilter] = useState("");
  const [leadDateFrom, setLeadDateFrom] = useState("");
  const [leadDateTo, setLeadDateTo] = useState("");
  const [leadSearch, setLeadSearch] = useState("");
  const [assignBranchSelection, setAssignBranchSelection] = useState({});

  const [sheetForm, setSheetForm] = useState(defaultSheetForm);
  const [selectedConnectionId, setSelectedConnectionId] = useState("");
  const [mappingFields, setMappingFields] = useState(defaultMapping);
  const [syncPayload, setSyncPayload] = useState(defaultSyncPayload);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getBdSummary();
      setSummary(data);
    } catch (e) { console.warn("[BD load failed]", e?.message || e); }
    setLoading(false);
  }, []);

  const loadBranches = useCallback(async () => {
    try {
      const data = await getBranches();
      setBranches(data);
    } catch (e) { console.warn("[BD load failed]", e?.message || e); }
  }, []);

  const loadLeads = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (leadStageFilter) params.stage = leadStageFilter;
      if (leadBranchFilter) params.branch_id = leadBranchFilter;
      if (leadDateFrom) params.start_date = `${leadDateFrom}T00:00:00`;
      if (leadDateTo) params.end_date = `${leadDateTo}T23:59:59`;
      const data = await getLeads(params);
      setLeads(data);
    } catch (e) { console.warn("[BD load failed]", e?.message || e); }
    setLoading(false);
  }, [leadStageFilter, leadBranchFilter, leadDateFrom, leadDateTo]);

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
      <div className="flex items-center gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-1" data-testid="bd-tab-bar">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 whitespace-nowrap rounded-md px-4 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-white text-sky-700 shadow-sm"
                  : "text-slate-500 hover:bg-white/60 hover:text-slate-700"
              }`}
              data-testid={`bd-tab-${tab.key}`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
        <div className="ml-auto flex-shrink-0">
          <Button size="sm" variant="ghost" onClick={refreshAll} data-testid="bd-refresh-all-btn">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Dashboard Tab */}
      {activeTab === "dashboard" && (
        <DashboardTab summary={summary} loading={loading} />
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

      {loading && (
        <div className="fixed bottom-4 right-4 rounded-md bg-slate-900 px-3 py-2 text-sm text-white" data-testid="bd-loading-indicator">
          Loading...
        </div>
      )}
    </div>
  );
};

/* ─── Dashboard Tab ─── */
function DashboardTab({ summary, loading }) {
  if (!summary && loading) {
    return <p className="py-8 text-center text-sm text-slate-400" data-testid="bd-dash-loading">Loading dashboard...</p>;
  }
  if (!summary) {
    return <p className="py-8 text-center text-sm text-slate-400" data-testid="bd-dash-empty">No data yet</p>;
  }

  const metrics = [
    { label: "Total Leads", value: summary.total_leads, color: "text-sky-600", bg: "bg-sky-50 border-sky-200" },
    { label: "Branches", value: summary.total_branches, color: "text-violet-600", bg: "bg-violet-50 border-violet-200" },
    { label: "Appointments", value: summary.total_appointments, color: "text-green-600", bg: "bg-green-50 border-green-200" },
    { label: "Completed", value: summary.completed_appointments, color: "text-emerald-600", bg: "bg-emerald-50 border-emerald-200" },
    { label: "Sheet Connections", value: summary.total_connections, color: "text-orange-600", bg: "bg-orange-50 border-orange-200" },
  ];

  return (
    <div className="space-y-5" data-testid="bd-dashboard-content">
      {/* Top Metrics */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="bd-metrics-grid">
        {metrics.map((m) => (
          <div key={m.label} className={`rounded-lg border p-4 ${m.bg}`} data-testid={`bd-metric-${m.label.toLowerCase().replace(/\s/g, "-")}`}>
            <p className="text-xs font-medium text-slate-500">{m.label}</p>
            <p className={`text-2xl font-semibold ${m.color}`}>{m.value}</p>
          </div>
        ))}
      </div>

      {/* Stage Pipeline */}
      <Card className="border-slate-200" data-testid="bd-stage-pipeline-card">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4 text-sky-600" />
            Lead Pipeline
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6" data-testid="bd-stage-pipeline-grid">
            {PIPELINE_STAGES.map((stage) => (
              <div key={stage} className={`rounded-lg border p-3 ${STAGE_COLOR[stage] || "bg-slate-50 border-slate-200"}`} data-testid={`bd-pipeline-stage-${stage}`}>
                <p className="text-xs font-medium opacity-80">{stage}</p>
                <p className="text-xl font-bold">{summary.stage_counts?.[stage] || 0}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Source + Branch breakdown */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* By Source */}
        <Card className="border-slate-200" data-testid="bd-source-breakdown-card">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Globe className="h-4 w-4 text-sky-600" />
              Leads by Source
            </CardTitle>
          </CardHeader>
          <CardContent>
            {Object.keys(summary.source_counts || {}).length === 0 ? (
              <p className="text-sm text-slate-400">No source data</p>
            ) : (
              <div className="space-y-2" data-testid="bd-source-list">
                {Object.entries(summary.source_counts).map(([src, count]) => (
                  <div key={src} className="flex items-center justify-between rounded-md border border-slate-100 bg-slate-50 px-3 py-2" data-testid={`bd-source-row-${src}`}>
                    <span className="text-sm text-slate-700">{src}</span>
                    <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-semibold text-sky-700">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* By Branch */}
        <Card className="border-slate-200" data-testid="bd-branch-breakdown-card">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-4 w-4 text-violet-600" />
              Leads by Branch
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(summary.branch_counts || []).length === 0 ? (
              <p className="text-sm text-slate-400">No branch data</p>
            ) : (
              <div className="space-y-2" data-testid="bd-branch-list">
                {summary.branch_counts.map((b) => (
                  <div key={b.branch_id} className="flex items-center justify-between rounded-md border border-slate-100 bg-slate-50 px-3 py-2" data-testid={`bd-branch-row-${b.branch_id}`}>
                    <span className="text-sm text-slate-700">{b.branch_name}</span>
                    <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-semibold text-violet-700">{b.count}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Leads */}
      <Card className="border-slate-200" data-testid="bd-recent-leads-card">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4 text-sky-600" />
            Recent Leads
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(summary.recent_leads || []).length === 0 ? (
            <p className="text-sm text-slate-400">No leads yet</p>
          ) : (
            <div className="overflow-auto rounded-lg border border-slate-200" data-testid="bd-recent-leads-table">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Phone</th>
                    <th className="px-3 py-2 font-medium">Source</th>
                    <th className="px-3 py-2 font-medium">Stage</th>
                    <th className="px-3 py-2 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.recent_leads.map((lead) => (
                    <tr key={lead.id} className="border-t border-slate-100" data-testid={`bd-recent-lead-${lead.id}`}>
                      <td className="px-3 py-2 text-slate-800">{lead.name}</td>
                      <td className="px-3 py-2 text-slate-600">{lead.phone}</td>
                      <td className="px-3 py-2 text-slate-600">{lead.source_tab || lead.source_type}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-block rounded-full border px-2 py-0.5 text-xs ${STAGE_COLOR[lead.stage] || "bg-slate-50 text-slate-600 border-slate-200"}`}>
                          {lead.stage}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-400">{lead.created_at?.slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
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
        <Button size="sm" onClick={() => { closeForm(); setShowBranchForm(true); }} data-testid="bd-branches-add-btn">
          <Plus className="mr-1 h-4 w-4" /> Add Branch
        </Button>
      </div>

      {/* Branch Table */}
      <div className="overflow-auto rounded-lg border border-slate-200" data-testid="bd-branches-table">
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
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl" data-testid="bd-branch-add-modal">
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
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl" data-testid="bd-branch-edit-modal">
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
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl" data-testid="bd-branch-delete-modal">
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
  loading,
}) {
  return (
    <div className="space-y-4" data-testid="bd-lead-master-content">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-800" data-testid="bd-lead-master-title">Lead Master ({leads.length})</h2>
        <Button size="sm" variant="outline" onClick={loadLeads} data-testid="bd-lead-master-refresh-btn">
          <RefreshCw className="mr-1 h-4 w-4" /> Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5" data-testid="bd-lead-filters">
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
        <Input type="date" value={leadDateFrom} onChange={(e) => setLeadDateFrom(e.target.value)} data-testid="bd-lead-date-from" />
        <Input type="date" value={leadDateTo} onChange={(e) => setLeadDateTo(e.target.value)} data-testid="bd-lead-date-to" />
      </div>

      {/* Lead Table */}
      <div className="overflow-auto rounded-lg border border-slate-200" data-testid="bd-lead-table">
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
                  <td className="px-3 py-2 font-medium text-slate-800">{lead.name}</td>
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
                      {["New Leads", "RNR", "Follow Up"].includes(lead.stage) && (
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
        <Card className="border-slate-200" data-testid="bd-sheet-create-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Add Connection</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={createConnectionNow} className="space-y-3" data-testid="bd-sheet-create-form">
              <Input value={sheetForm.connection_name} onChange={(e) => setSheetForm((p) => ({ ...p, connection_name: e.target.value }))} placeholder="Connection Name" data-testid="bd-sheet-conn-name-input" />
              <Input value={sheetForm.spreadsheet_id} onChange={(e) => setSheetForm((p) => ({ ...p, spreadsheet_id: e.target.value }))} placeholder="Spreadsheet ID" data-testid="bd-sheet-spreadsheet-id-input" />
              <Input type="number" value={sheetForm.sync_interval_minutes} onChange={(e) => setSheetForm((p) => ({ ...p, sync_interval_minutes: Number(e.target.value) }))} placeholder="Sync interval (minutes)" data-testid="bd-sheet-interval-input" />
              <Button type="submit" data-testid="bd-sheet-create-btn">
                <Plus className="mr-1 h-4 w-4" /> Add Connection
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Existing Connections */}
        <Card className="border-slate-200" data-testid="bd-sheet-list-card">
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
                  className={`cursor-pointer rounded-md border p-3 transition-colors ${
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
        <Card className="border-slate-200" data-testid="bd-sheet-mapping-card">
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
              <Button onClick={runSyncNow} data-testid="bd-sync-run-btn">Run Sync</Button>
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

      <div className="overflow-auto rounded-lg border border-slate-200" data-testid="bd-lead-source-table">
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
