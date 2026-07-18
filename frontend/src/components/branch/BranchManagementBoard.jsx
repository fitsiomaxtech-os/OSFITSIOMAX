import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, Trash2, X, Users, MapPin, Phone, Mail, TrendingUp, BarChart3, RefreshCw, Layers, LayoutDashboard, ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import {
  bmList, bmCreateWithExistingAdmin, bmReassignAdmin, bmPerformance, bmPerformanceSummary,
  updateBranch, deleteBranch, hrBranchAdminCandidates,
  getVerticals, createVertical,
} from "@/lib/api";
import { BranchDetailPage } from "@/components/branch/BranchDetailPage";
import { BranchFormDialogV2 } from "@/components/branch/BranchFormDialogV2";
import { BranchAdminBoard } from "@/components/BranchAdminBoard";

const TABS = [
  { key: "creation", label: "Creation & Manager", icon: Users },
  { key: "service_type", label: "Service Type", icon: Layers },
  { key: "performance", label: "Performance", icon: TrendingUp },
  { key: "branch_control", label: "Branch Control", icon: LayoutDashboard },
];

export const BranchManagementBoard = () => {
  const [tab, setTab] = useState("creation");
  const [drilledBranchId, setDrilledBranchId] = useState(null);

  if (drilledBranchId) {
    return <BranchDetailPage branchId={drilledBranchId} onBack={() => setDrilledBranchId(null)} />;
  }

  return (
    <div className="space-y-5" data-testid="branch-mgmt-board">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Branch Management</h2>
        <p className="text-sm text-slate-500">Create branches, assign managers, and track performance.</p>
      </div>
      <div className="flex gap-2 rounded-lg border border-slate-200 bg-white p-1" data-testid="bm-subtabs">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)} data-testid={`bm-subtab-${t.key}`} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${active ? "bg-sky-50 text-sky-700" : "text-slate-600 hover:bg-slate-50"}`}>
              <Icon className="h-4 w-4" />{t.label}
            </button>
          );
        })}
      </div>
      {tab === "creation" && <CreationTab onDrillIn={setDrilledBranchId} />}
      {tab === "service_type" && <ServiceTypeTab />}
      {tab === "performance" && <PerformanceTab onDrillIn={setDrilledBranchId} />}
      {tab === "branch_control" && <BranchControlTab />}
    </div>
  );
};

// ---------- Branch Control (Super Admin driving a Branch Admin's own board) ----------

const BranchControlTab = () => {
  const [branches, setBranches] = useState([]);
  const [selectedId, setSelectedId] = useState("");

  useEffect(() => { bmList().then(setBranches).catch(() => {}); }, []);

  const selected = branches.find((b) => b.id === selectedId);

  return (
    <div className="space-y-4" data-testid="bm-branch-control-tab">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-3">
        <label className="text-xs font-medium text-slate-600">Viewing branch:</label>
        <div className="relative">
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="h-9 min-w-[240px] appearance-none rounded-md border border-slate-200 bg-white px-3 pr-8 text-sm"
            data-testid="bm-branch-control-select"
          >
            <option value="">— Select a branch —</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.branch_name}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        </div>
        {selected && <span className="text-xs text-slate-400">{selected.admin_name ? `Managed by ${selected.admin_name}` : "No admin assigned"}</span>}
      </div>

      {selectedId ? (
        <BranchAdminBoard key={selectedId} branchId={selectedId} />
      ) : (
        <div className="rounded-lg border border-dashed border-slate-200 p-10 text-center text-sm text-slate-400" data-testid="bm-branch-control-empty">
          Pick a branch above to open its full Branch Admin dashboard — Branch Leads, Consultations, Treatment Sessions, Rehab, Finance and Fitsiomax Store — with full control, same as the Branch Admin sees it.
        </div>
      )}
    </div>
  );
};

// ---------- Creation & Manager ----------

const CreationTab = ({ onDrillIn }) => {
  const [branches, setBranches] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [reassigning, setReassigning] = useState(null);

  const load = useCallback(async () => {
    const [bs, cs] = await Promise.all([bmList(), hrBranchAdminCandidates().catch(() => [])]);
    setBranches(bs);
    setCandidates(cs);
  }, []);

  useEffect(() => { load(); }, [load]);

  const remove = async (b) => {
    if (!window.confirm(`Delete branch "${b.branch_name}"? This also removes its admin user.`)) return;
    try { await deleteBranch(b.id); toast.success("Branch deleted"); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Delete failed"); }
  };

  return (
    <div className="space-y-4" data-testid="bm-creation-tab">
      <div className="flex flex-wrap items-center gap-2">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 flex-1">
          <KpiCard label="Total Branches" value={branches.length} color="#0ea5e9" testid="bm-kpi-total" />
          <KpiCard label="Available Managers" value={candidates.filter((c) => !c.assigned_branch).length} color="#22c55e" testid="bm-kpi-available" />
          <KpiCard label="Active Leads" value={branches.reduce((a, b) => a + (b.leads_open || 0), 0)} color="#f59e0b" testid="bm-kpi-leads" />
          <KpiCard label="Total Doctors" value={branches.reduce((a, b) => a + (b.doctors_count || 0), 0)} color="#a855f7" testid="bm-kpi-doctors" />
        </div>
        <Button variant="outline" onClick={load} data-testid="bm-refresh"><RefreshCw className="h-4 w-4" /></Button>
        <Button onClick={() => { setEditing(null); setShowAdd(true); }} className="bg-sky-600 hover:bg-sky-700" data-testid="bm-add-branch-btn"><Plus className="h-4 w-4 mr-1" />Add Branch</Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {branches.length === 0 && <Card><CardContent className="p-6 text-center text-sm text-slate-400">No branches yet. Click <span className="font-semibold">Add Branch</span> to start.</CardContent></Card>}
        {branches.map((b) => (
          <Card key={b.id} className="border-slate-200 cursor-pointer hover:shadow-md transition" data-testid={`bm-branch-card-${b.id}`} onClick={() => onDrillIn && onDrillIn(b.id)}>
            <CardHeader className="flex flex-row items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base text-slate-900 hover:text-sky-700">{b.branch_name}</CardTitle>
                <p className="mt-0.5 inline-flex items-center text-xs text-slate-500"><MapPin className="h-3 w-3 mr-1" />{b.address}</p>
              </div>
              <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                <button onClick={(e) => { e.stopPropagation(); setEditing(b); setShowAdd(true); }} className="text-blue-500 hover:text-blue-700" data-testid={`bm-branch-edit-${b.id}`}><Pencil className="h-4 w-4" /></button>
                <button onClick={(e) => { e.stopPropagation(); remove(b); }} className="text-red-500 hover:text-red-700" data-testid={`bm-branch-delete-${b.id}`}><Trash2 className="h-4 w-4" /></button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Branch Admin</p>
                <p className="mt-1 text-sm font-medium text-slate-800">{b.admin_name || "—"}</p>
                <p className="text-xs text-slate-500"><Mail className="inline h-3 w-3 mr-1" />{b.admin_email || "—"}</p>
                {b.admin_phone && <p className="text-xs text-slate-500"><Phone className="inline h-3 w-3 mr-1" />{b.admin_phone}</p>}
                <button onClick={(e) => { e.stopPropagation(); setReassigning(b); }} className="mt-2 text-xs font-medium text-sky-600 hover:underline" data-testid={`bm-branch-reassign-${b.id}`}>Reassign Manager →</button>
              </div>
              <div className="grid grid-cols-4 gap-2 text-center text-xs">
                <Stat label="Leads" value={b.leads_total || 0} color="#0ea5e9" />
                <Stat label="Open" value={b.leads_open || 0} color="#f59e0b" />
                <Stat label="Completed" value={b.leads_completed || 0} color="#22c55e" />
                <Stat label="Doctors" value={b.doctors_count || 0} color="#a855f7" />
              </div>
              <button className="w-full text-center text-xs font-semibold text-sky-600 hover:underline" data-testid={`bm-branch-open-${b.id}`}>Open Branch Details →</button>
            </CardContent>
          </Card>
        ))}
      </div>

      {showAdd && <BranchFormDialogV2 branch={editing} onClose={() => { setShowAdd(false); setEditing(null); }} onSaved={() => { setShowAdd(false); setEditing(null); load(); }} />}

      {reassigning && <ReassignAdminDialog branch={reassigning} candidates={candidates.filter((c) => !c.assigned_branch || c.id === reassigning.admin_user_id)} onClose={() => setReassigning(null)} onSaved={() => { setReassigning(null); load(); }} />}
    </div>
  );
};

const BranchFormDialog = ({ branch, candidates, onClose, onSaved }) => {
  const isEdit = !!branch;
  const [form, setForm] = useState({
    branch_name: branch?.branch_name || "",
    address: branch?.address || "",
    admin_user_id: branch?.admin_user_id || "",
    admin_phone: branch?.admin_phone || "",
    vertical: branch?.vertical || "offline_physiotherapy",
  });
  const available = candidates.filter((c) => !c.assigned_branch || c.id === branch?.admin_user_id);

  const submit = async () => {
    if (!form.branch_name.trim() || !form.address.trim()) { toast.error("Branch name and address required"); return; }
    if (!isEdit && !form.admin_user_id) { toast.error("Select a branch admin"); return; }
    try {
      if (isEdit) {
        await updateBranch(branch.id, { branch_name: form.branch_name, address: form.address, admin_phone: form.admin_phone, vertical: form.vertical });
        toast.success("Branch updated");
      } else {
        await bmCreateWithExistingAdmin({ branch_name: form.branch_name, address: form.address, admin_user_id: form.admin_user_id, admin_phone: form.admin_phone, vertical: form.vertical });
        toast.success("Branch created");
      }
      onSaved();
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" data-testid="bm-branch-form-dialog">
      <div className="w-full max-w-lg rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h3 className="text-base font-semibold">{isEdit ? "Edit Branch" : "Add Branch"}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" data-testid="bm-branch-form-close"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3 p-5">
          <Field label="Branch Name *"><Input value={form.branch_name} onChange={(e) => setForm({ ...form, branch_name: e.target.value })} placeholder="e.g. Anna Nagar" data-testid="bm-form-name" /></Field>
          <Field label="Address *"><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Street, City" data-testid="bm-form-address" /></Field>
          {!isEdit && (
            <Field label="Branch Admin (Manager) *">
              <select className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" value={form.admin_user_id} onChange={(e) => setForm({ ...form, admin_user_id: e.target.value })} data-testid="bm-form-admin">
                <option value="">— Select existing branch_admin user —</option>
                {available.length === 0 && <option disabled>No available branch_admin users — create one in HR</option>}
                {available.map((c) => <option key={c.id} value={c.id}>{c.full_name} · {c.email}</option>)}
              </select>
              <p className="mt-1 text-[11px] text-slate-400">Only users with role=branch_admin (not yet assigned to a branch) appear here. Create more in HR → Roles & Credentials.</p>
            </Field>
          )}
          <Field label="Admin Phone"><Input value={form.admin_phone} onChange={(e) => setForm({ ...form, admin_phone: e.target.value })} placeholder="+91 …" data-testid="bm-form-phone" /></Field>
          <Field label="Vertical">
            <select className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" value={form.vertical} onChange={(e) => setForm({ ...form, vertical: e.target.value })} data-testid="bm-form-vertical">
              <option value="offline_physiotherapy">Offline Physiotherapy</option>
              <option value="online_physiotherapy">Online Physiotherapy</option>
              <option value="fitness">Fitness</option>
            </select>
          </Field>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <Button variant="outline" onClick={onClose} data-testid="bm-form-cancel">Cancel</Button>
          <Button onClick={submit} className="bg-sky-600 hover:bg-sky-700" data-testid="bm-form-submit">{isEdit ? "Save" : "Create Branch"}</Button>
        </div>
      </div>
    </div>
  );
};

const ReassignAdminDialog = ({ branch, candidates, onClose, onSaved }) => {
  const [pick, setPick] = useState(branch.admin_user_id || "");
  const save = async () => {
    if (!pick) { toast.error("Select a manager"); return; }
    try { await bmReassignAdmin(branch.id, pick); toast.success("Manager reassigned"); onSaved(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" data-testid="bm-reassign-dialog">
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl space-y-3">
        <h3 className="text-base font-semibold">Reassign Manager — {branch.branch_name}</h3>
        <select className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" value={pick} onChange={(e) => setPick(e.target.value)} data-testid="bm-reassign-select">
          <option value="">— Pick branch admin —</option>
          {candidates.map((c) => <option key={c.id} value={c.id}>{c.full_name} · {c.email}</option>)}
        </select>
        <p className="text-[11px] text-slate-400">Reassigning will unlink the previous manager from this branch.</p>
        <div className="flex gap-2"><Button variant="outline" onClick={onClose} className="flex-1" data-testid="bm-reassign-cancel">Cancel</Button><Button onClick={save} className="flex-1 bg-sky-600 hover:bg-sky-700" data-testid="bm-reassign-submit">Save</Button></div>
      </div>
    </div>
  );
};

const KpiCard = ({ label, value, color, testid }) => (
  <div className="rounded-xl border bg-white p-4 shadow-sm" style={{ borderLeftColor: color, borderLeftWidth: 4 }} data-testid={testid}>
    <p className="text-xs text-slate-500">{label}</p>
    <p className="mt-1 text-3xl font-bold" style={{ color }}>{value}</p>
  </div>
);

const Stat = ({ label, value, color }) => (
  <div className="rounded border border-slate-100 p-2">
    <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
    <p className="text-base font-bold" style={{ color }}>{value}</p>
  </div>
);

const Field = ({ label, children, className = "" }) => (
  <div className={`space-y-1 ${className}`}>
    <label className="text-xs font-medium text-slate-700">{label}</label>
    {children}
  </div>
);

// ---------- Performance ----------

const PerformanceTab = ({ onDrillIn }) => {
  const [summary, setSummary] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);

  const load = useCallback(() => bmPerformanceSummary().then(setSummary).catch((e) => console.warn("[load failed]", e?.message || e)), []);
  useEffect(() => { load(); }, [load]);

  const openDetail = async (b) => {
    setSelected(b);
    try { const d = await bmPerformance(b.branch_id); setDetail(d); }
    catch (e) { toast.error("Failed to load detail"); }
  };

  const totals = summary.reduce((acc, s) => ({
    leads: acc.leads + s.leads_total,
    completed: acc.completed + s.leads_completed,
    revenue: acc.revenue + (s.total_revenue || 0),
  }), { leads: 0, completed: 0, revenue: 0 });
  const overallConv = totals.leads ? (totals.completed / totals.leads * 100.0) : 0;

  return (
    <div className="space-y-4" data-testid="bm-performance-tab">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Branches" value={summary.length} color="#0ea5e9" testid="bm-perf-kpi-branches" />
        <KpiCard label="Total Leads" value={totals.leads} color="#f59e0b" testid="bm-perf-kpi-leads" />
        <KpiCard label="Avg Conversion %" value={`${overallConv.toFixed(1)}%`} color="#22c55e" testid="bm-perf-kpi-conv" />
        <KpiCard label="Total Revenue (₹)" value={Number(totals.revenue || 0).toLocaleString("en-IN")} color="#a855f7" testid="bm-perf-kpi-revenue" />
      </div>

      <Card data-testid="bm-perf-table-card">
        <CardHeader><CardTitle className="text-base">Branch Performance</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr><th className="px-3 py-2">Branch</th><th className="px-3 py-2">Manager</th><th className="px-3 py-2">Leads</th><th className="px-3 py-2">Completed</th><th className="px-3 py-2">Conversion</th><th className="px-3 py-2">Revenue</th><th className="px-3 py-2"></th></tr>
              </thead>
              <tbody>
                {summary.map((s) => (
                  <tr key={s.branch_id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`bm-perf-row-${s.branch_id}`}>
                    <td className="px-3 py-2 font-medium">{s.branch_name}</td>
                    <td className="px-3 py-2 text-slate-600">{s.admin_name || "—"}</td>
                    <td className="px-3 py-2">{s.leads_total}</td>
                    <td className="px-3 py-2 text-emerald-600">{s.leads_completed}</td>
                    <td className="px-3 py-2">
                      <span className="inline-flex h-5 items-center rounded bg-sky-50 px-2 text-xs font-semibold text-sky-700">{s.conversion_rate}%</span>
                    </td>
                    <td className="px-3 py-2 font-semibold text-emerald-600">₹{Number(s.total_revenue || 0).toLocaleString("en-IN")}</td>
                    <td className="px-3 py-2"><button onClick={() => onDrillIn(s.branch_id)} className="text-xs font-medium text-sky-600 hover:underline" data-testid={`bm-perf-view-${s.branch_id}`}>Open →</button></td>
                  </tr>
                ))}
                {summary.length === 0 && <tr><td colSpan="7" className="px-3 py-6 text-center text-slate-400">No branches yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {selected && detail && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" data-testid="bm-perf-detail-dialog">
          <div className="w-full max-w-2xl rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <div><h3 className="text-base font-semibold">{detail.branch.branch_name} — Detailed Performance</h3><p className="text-xs text-slate-500">{detail.branch.address}</p></div>
              <button onClick={() => { setSelected(null); setDetail(null); }} className="text-slate-400 hover:text-slate-600" data-testid="bm-perf-detail-close"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-4 p-5 max-h-[70vh] overflow-y-auto">
              <div className="grid gap-2 sm:grid-cols-3">
                <DetailStat label="Total Leads" value={detail.kpis.leads_total} color="#0ea5e9" />
                <DetailStat label="Completed" value={detail.kpis.leads_completed} color="#22c55e" />
                <DetailStat label="Conversion" value={`${detail.kpis.conversion_rate}%`} color="#a855f7" />
                <DetailStat label="Appointments" value={`${detail.kpis.appointments_completed}/${detail.kpis.appointments_total}`} color="#f59e0b" />
                <DetailStat label="Consultation Fees" value={`₹${Number(detail.kpis.consultation_fees || 0).toLocaleString("en-IN")}`} color="#0ea5e9" />
                <DetailStat label="Package Revenue" value={`₹${Number(detail.kpis.package_revenue || 0).toLocaleString("en-IN")}`} color="#22c55e" />
                <DetailStat label="Total Revenue" value={`₹${Number(detail.kpis.total_revenue || 0).toLocaleString("en-IN")}`} color="#a855f7" />
                <DetailStat label="Doctors" value={detail.kpis.doctors} color="#64748b" />
                <DetailStat label="Head Physios" value={detail.kpis.head_physios} color="#64748b" />
                <DetailStat label="Physios" value={detail.kpis.physios} color="#64748b" />
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Stage Breakdown</p>
                {detail.stage_breakdown.length === 0 ? <p className="text-xs text-slate-400">No leads.</p> : (
                  <div className="space-y-1">
                    {detail.stage_breakdown.map((s) => (
                      <div key={s.stage} className="flex items-center gap-2 text-xs">
                        <span className="w-44 text-slate-600">{s.stage}</span>
                        <div className="h-2 flex-1 overflow-hidden rounded bg-slate-100"><div className="h-full bg-sky-500" style={{ width: `${(s.count / detail.kpis.leads_total * 100) || 0}%` }} /></div>
                        <span className="w-8 text-right font-semibold">{s.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const DetailStat = ({ label, value, color }) => (
  <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
    <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-1 text-lg font-bold" style={{ color }}>{value}</p>
  </div>
);

// ---------- Service Type (moved from Super Admin Master View "Business Verticals") ----------
const ServiceTypeTab = () => {
  const [items, setItems] = useState([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  const fetchItems = useCallback(async () => {
    try {
      const rows = await getVerticals();
      const defaults = ["offline_physiotherapy", "online_physiotherapy", "online_fitness", "offline_fitness_gym"];
      setItems(rows && rows.length ? rows : defaults.map((n) => ({ id: n, name: n })));
    } catch (err) {
      toast.error("Failed to load service types");
    }
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const addItem = async (event) => {
    event.preventDefault();
    if (!name.trim()) {
      toast.error("Enter a service type name");
      return;
    }
    try {
      setLoading(true);
      await createVertical({ name: name.trim(), active: true });
      setName("");
      await fetchItems();
      toast.success("Service type added");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to add service type");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="border-slate-200 bg-white" data-testid="service-type-card">
      <CardHeader>
        <CardTitle className="text-base">Service Type</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <form className="flex gap-2" onSubmit={addItem} data-testid="service-type-form">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="new_service_type"
            data-testid="service-type-input"
          />
          <Button type="submit" disabled={loading} data-testid="service-type-submit">Add</Button>
        </form>
        <div className="space-y-1">
          {items.map((item) => (
            <div
              key={item.id}
              className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
              data-testid={`service-type-row-${item.id}`}
            >
              {item.name}
            </div>
          ))}
          {items.length === 0 && (
            <p className="rounded border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-500">
              No service types yet. Add one above.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default BranchManagementBoard;
