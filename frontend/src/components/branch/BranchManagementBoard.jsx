import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Pencil, Trash2, X, Users, MapPin, Phone, Mail, TrendingUp, RefreshCw, Layers, LayoutDashboard, ChevronDown, BadgeIndianRupee, Building2, Stethoscope } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import {
  bmList, bmCreateWithExistingAdmin, bmReassignAdmin,
  updateBranch, deleteBranch, hrBranchAdminCandidates,
  getVerticals, createVertical, deleteVertical, getDoctors,
} from "@/lib/api";
import { StatTile } from "@/components/ui/stat-tile";
import { BranchDetailPage } from "@/components/branch/BranchDetailPage";
import { BranchFormDialogV2 } from "@/components/branch/BranchFormDialogV2";
import { BranchAdminBoard } from "@/components/BranchAdminBoard";
import { HeadPhysioBoard } from "@/components/HeadPhysioBoard";
import { PhysioBoard } from "@/components/PhysioBoard";
import { AccountantManagementBoard } from "@/components/branch/AccountantManagementBoard";

// No Service Type tab. It is a setting, not a board — it was a tab holding one text field,
// and it now opens from MANAGER, the only tab that ever needs it.
const TABS = [
  { key: "creation", label: "MANAGER", icon: Users },
  { key: "branch_control", label: "Branch Control", icon: LayoutDashboard },
  { key: "ac_overview", label: "Accountant Management", icon: BadgeIndianRupee },
];

export const BranchManagementBoard = ({ actingUser } = {}) => {
  const [tab, setTab] = useState("creation");
  const [drilledBranchId, setDrilledBranchId] = useState(null);
  // A callback ref, not useRef: the portal has to re-render once the node exists, and a
  // ref object mutating in place never triggers that.
  const [actionSlot, setActionSlot] = useState(null);

  if (drilledBranchId) {
    return <BranchDetailPage branchId={drilledBranchId} onBack={() => setDrilledBranchId(null)} />;
  }

  return (
    <div className="space-y-5" data-testid="branch-mgmt-board">
      {/* No heading. The nav tab above already reads Branch Management. */}
      {/* The tab row carries the active tab's actions on its right. They used to sit on
          the KPI row below, where a page action read as part of the figures. A portal
          rather than lifted state: Refresh and Add Branch act on CreationTab's own data,
          and hoisting that here to reach the bar would put a tab's state in the router. */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-1" data-testid="bm-subtabs">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)} data-testid={`bm-subtab-${t.key}`} className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition ${active ? "bg-sky-50 text-sky-700" : "text-slate-600 hover:bg-slate-50"}`}>
              <Icon className="h-4 w-4" />{t.label}
            </button>
          );
        })}
        <div ref={setActionSlot} className="ml-auto flex shrink-0 items-center gap-2 pr-1" data-testid="bm-subtab-actions" />
      </div>
      {tab === "creation" && <CreationTab onDrillIn={setDrilledBranchId} actionSlot={actionSlot} />}
      {tab === "branch_control" && <BranchControlTab actingUser={actingUser} />}
      {tab === "ac_overview" && <AccountantManagementBoard />}
    </div>
  );
};

// ---------- Branch Control (Super Admin driving a Branch Admin's own board) ----------

// A fixed color per branch would need a stable id->color map that survives
// the branch list changing; cycling a palette by list position is simpler and
// still gives each branch its own distinct color in the open dropdown.
const BRANCH_COLOR_PALETTE = [
  "border-purple-300 bg-purple-50 text-purple-700",
  "border-indigo-300 bg-indigo-50 text-indigo-700",
  "border-emerald-300 bg-emerald-50 text-emerald-700",
  "border-amber-300 bg-amber-50 text-amber-700",
  "border-cyan-300 bg-cyan-50 text-cyan-700",
  "border-pink-300 bg-pink-50 text-pink-700",
  "border-orange-300 bg-orange-50 text-orange-700",
  "border-sky-300 bg-sky-50 text-sky-700",
];

// Native <select> can't reliably color individual dropdown-list items across
// browsers — only the closed box. This renders each option as its own colored,
// rounded row in a custom open list instead.
const BranchSelectDropdown = ({ value, branches, onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const idx = branches.findIndex((b) => b.id === value);
  const currentClasses = idx >= 0 ? BRANCH_COLOR_PALETTE[idx % BRANCH_COLOR_PALETTE.length] : "border-slate-200 bg-white text-slate-700";
  const currentLabel = idx >= 0 ? branches[idx].branch_name : "— Select a branch —";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex h-9 min-w-[240px] items-center justify-between gap-2 rounded-md border px-3 text-sm font-semibold ${currentClasses}`}
        data-testid="bm-branch-control-select"
      >
        <span className="truncate">{currentLabel}</span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-1 max-h-64 min-w-[240px] space-y-1 overflow-y-auto rounded-md border border-slate-200 bg-white p-1.5 shadow-lg" data-testid="bm-branch-control-select-list">
          <button
            type="button"
            onClick={() => { onChange(""); setOpen(false); }}
            className="block w-full rounded-md border border-slate-200 bg-white px-3 py-1.5 text-left text-xs font-semibold text-slate-700"
            data-testid="bm-branch-control-select-option-none"
          >
            — Select a branch —
          </button>
          {branches.map((b, i) => (
            <button
              key={b.id}
              type="button"
              onClick={() => { onChange(b.id); setOpen(false); }}
              className={`block w-full rounded-md border px-3 py-1.5 text-left text-xs font-semibold ${BRANCH_COLOR_PALETTE[i % BRANCH_COLOR_PALETTE.length]}`}
              data-testid={`bm-branch-control-select-option-${b.id}`}
            >
              {b.branch_name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const BranchControlTab = ({ actingUser }) => {
  const [branches, setBranches] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [viewAs, setViewAs] = useState("branch_admin"); // "branch_admin" | "head_physio" | "physio"
  const [physios, setPhysios] = useState([]);
  const [selectedPhysioId, setSelectedPhysioId] = useState("");

  useEffect(() => { bmList().then(setBranches).catch(() => {}); }, []);

  useEffect(() => {
    setSelectedPhysioId("");
    if (!selectedId || viewAs !== "physio") { setPhysios([]); return; }
    getDoctors({ branch_id: selectedId })
      .then((rows) => setPhysios((rows || []).filter((d) => d.profile_type === "physio")))
      .catch(() => setPhysios([]));
  }, [selectedId, viewAs]);

  const selected = branches.find((b) => b.id === selectedId);

  return (
    <div className="space-y-4" data-testid="bm-branch-control-tab">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-3">
        <label className="text-xs font-medium text-slate-600">Viewing branch:</label>
        <BranchSelectDropdown value={selectedId} branches={branches} onChange={setSelectedId} />
        {selected && <span className="text-xs text-slate-400">{selected.admin_name ? `Managed by ${selected.admin_name}` : "No admin assigned"}</span>}

        <div className="flex w-full flex-wrap gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 sm:ml-auto sm:w-auto">
          {[{ key: "branch_admin", label: "Branch Admin View" }, { key: "head_physio", label: "Head Physio View" }, { key: "physio", label: "Physio View" }].map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setViewAs(t.key)}
              className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition ${
                viewAs === t.key ? "bg-white text-sky-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
              data-testid={`bm-branch-control-viewas-${t.key}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {viewAs === "physio" && selectedId && (
          <div className="relative">
            <select
              value={selectedPhysioId}
              onChange={(e) => setSelectedPhysioId(e.target.value)}
              className="h-9 min-w-[220px] appearance-none rounded-md border border-slate-200 bg-white px-3 pr-8 text-sm"
              data-testid="bm-branch-control-physio-select"
            >
              <option value="">— Select a physio —</option>
              {physios.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              {physios.length === 0 && <option value="" disabled>No physios in this branch yet</option>}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          </div>
        )}
      </div>

      {!selectedId ? (
        <div className="rounded-lg border border-dashed border-slate-200 p-10 text-center text-sm text-slate-400" data-testid="bm-branch-control-empty">
          Pick a branch above to open its full dashboard — Branch Admin view (Branch Leads, Consultations, Treatment Sessions, Rehab, Finance, Fitsiomax Store), Head Physio view (their own Consultations pipeline, Review, Rehab, Calendar), or Physio view (Consultations, Today, Full Calendar, Patients History for one physio) — with full control, same as they'd see it.
        </div>
      ) : viewAs === "head_physio" ? (
        <HeadPhysioBoard key={`${selectedId}-hp`} branchId={selectedId} user={actingUser} />
      ) : viewAs === "physio" ? (
        selectedPhysioId ? (
          <PhysioBoard key={`${selectedPhysioId}-ph`} physioId={selectedPhysioId} />
        ) : (
          <div className="rounded-lg border border-dashed border-slate-200 p-10 text-center text-sm text-slate-400" data-testid="bm-branch-control-physio-empty">
            Pick a physio above to open their dashboard.
          </div>
        )
      ) : (
        <BranchAdminBoard key={`${selectedId}-ba`} branchId={selectedId} />
      )}
    </div>
  );
};

// ---------- Creation & Manager ----------

const CreationTab = ({ onDrillIn, actionSlot }) => {
  const [branches, setBranches] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [reassigning, setReassigning] = useState(null);
  const [showServiceTypes, setShowServiceTypes] = useState(false);
  const [physioCount, setPhysioCount] = useState(0);
  const [loading, setLoading] = useState(false);

  /** `notify` is set only by the Refresh button. The same loader runs on mount and after
   *  every save, and none of those should announce themselves. */
  const load = useCallback(async ({ notify = false } = {}) => {
    setLoading(true);
    try {
      const [bs, cs, ds] = await Promise.all([
        bmList(),
        hrBranchAdminCandidates().catch(() => []),
        // Unscoped, so as super_admin this is every doctor in the org.
        getDoctors().catch(() => []),
      ]);
      setBranches(bs);
      setCandidates(cs);
      setPhysioCount((ds || []).filter((d) => d.profile_type === "physio").length);
      if (notify) toast.success("Refreshed");
    } catch (e) {
      // bmList had no catch of its own, so a failure rejected this whole function
      // unhandled: nothing updated and nothing was said, which is exactly what a dead
      // button looks like.
      toast.error(e?.response?.data?.detail || "Couldn't load branches");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const remove = async (b) => {
    if (!window.confirm(`Delete branch "${b.branch_name}"? This also removes its admin user.`)) return;
    try { await deleteBranch(b.id); toast.success("Branch deleted"); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Delete failed"); }
  };

  // Rendered into the tab bar above. All three are icon-only there: a labelled button in a
  // row of tabs reads as another tab, and the row has no width to spare for the word anyway.
  // The two that only read or open sit in grey; Add Branch, the one that creates a record,
  // keeps the filled blue to itself.
  const actions = (
    <>
      {/* Spins and locks while in flight, as every other Refresh in the OS does, and says
          so when it lands — a reload that changes nothing on screen is otherwise
          indistinguishable from a button that does nothing. */}
      <Button
        className="h-9 w-9 shrink-0 bg-slate-500 p-0 text-white hover:bg-slate-600"
        onClick={() => load({ notify: true })}
        disabled={loading}
        title="Refresh"
        aria-label="Refresh"
        data-testid="bm-refresh"
      >
        <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
      </Button>
      <Button
        className="h-9 w-9 shrink-0 bg-slate-500 p-0 text-white hover:bg-slate-600"
        onClick={() => setShowServiceTypes(true)}
        title="Service Type"
        aria-label="Service Type"
        data-testid="bm-service-type-btn"
      >
        <Layers className="h-4 w-4" />
      </Button>
      <Button
        className="h-9 w-9 shrink-0 bg-sky-600 p-0 hover:bg-sky-700"
        onClick={() => { setEditing(null); setShowAdd(true); }}
        title="Add Branch"
        aria-label="Add Branch"
        data-testid="bm-add-branch-btn"
      >
        <Plus className="h-4 w-4" />
      </Button>
    </>
  );

  return (
    <div className="space-y-4" data-testid="bm-creation-tab">
      {actionSlot ? createPortal(actions, actionSlot) : <div className="flex items-center justify-end gap-2">{actions}</div>}

      {/* The shared money-board tile: corner icon over a colour disc, the figure in the
          card's own colour. It was a bordered box with a coloured left edge, the last card
          style on the OS still doing it that way. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Total Branches" value={branches.length} icon={Building2} color="#0ea5e9" testid="bm-kpi-total" />
        <StatTile label="Total Physio" value={physioCount} icon={Users} color="#22c55e" testid="bm-kpi-available" />
        <StatTile label="Active Leads" value={branches.reduce((a, b) => a + (b.leads_open || 0), 0)} icon={TrendingUp} color="#f59e0b" testid="bm-kpi-leads" />
        <StatTile label="Total Doctors" value={branches.reduce((a, b) => a + (b.doctors_count || 0), 0)} icon={Stethoscope} color="#a855f7" testid="bm-kpi-doctors" />
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {branches.length === 0 && <Card><CardContent className="p-6 text-center text-sm text-slate-400">No branches yet. Click <span className="font-semibold">Add Branch</span> to start.</CardContent></Card>}
        {branches.map((b) => (
          <Card key={b.id} className="border-slate-200 cursor-pointer hover:shadow-md transition" data-testid={`bm-branch-card-${b.id}`} onClick={() => onDrillIn && onDrillIn(b.id)}>
            <CardHeader className="flex flex-row items-start justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-1.5 text-base text-slate-900 hover:text-sky-700">
                  {b.branch_name}
                  {b.code && <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-600" data-testid={`bm-branch-code-${b.id}`}>{b.code}</span>}
                </CardTitle>
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
              <div className="grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-4">
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

      {/* A branch is created on this tab and has to be given a service type in that form;
          if the one it needs does not exist yet, leaving to make it meant abandoning a
          half-filled form. A dialog rather than a panel: it is opened rarely, and it
          returns you to exactly the tab you were on. */}
      {showServiceTypes && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" data-testid="bm-service-type-dialog">
          {/* Lexend, scoped to this dialog. It is already loaded for the printed sheets, so
              this costs no extra font request. */}
          <div className="w-full max-w-lg rounded-lg bg-white shadow-xl" style={{ fontFamily: "Lexend, sans-serif" }}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <h3 className="inline-flex items-center gap-2 text-base font-semibold"><Layers className="h-4 w-4 text-sky-600" />Service Type</h3>
              <button onClick={() => setShowServiceTypes(false)} className="text-slate-400 hover:text-slate-600" data-testid="bm-service-type-close"><X className="h-4 w-4" /></button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto p-5">
              <ServiceTypeManager onChanged={load} />
            </div>
          </div>
        </div>
      )}

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

// ---------- Service Type (moved from Super Admin Master View "Business Verticals") ----------
const SERVICE_TYPE_COLORS = ["#2563eb", "#059669", "#d97706", "#7c3aed", "#e11d48", "#0891b2"];

// "offline_physiotherapy" -> "offline physiotherapy". Only the underscores go: the casing
// is left to CSS, so what gets read back for a match is still the stored name, and the
// input above keeps writing whatever the user actually typed.
const serviceTypeLabel = (name) => String(name || "").replace(/_/g, " ");
/**
 * Add or remove a service type, and see the ones that exist. Opened from MANAGER's toolbar,
 * where a branch is created and the type it needs may not exist yet.
 *
 * onChanged lets the host refresh whatever it renders off the same list.
 */
const ServiceTypeManager = ({ onChanged }) => {
  const [items, setItems] = useState([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [removingId, setRemovingId] = useState("");

  const fetchItems = useCallback(async () => {
    try {
      const rows = await getVerticals();
      const defaults = ["offline_physiotherapy", "online_physiotherapy", "online_fitness", "offline_fitness_gym"];
      // `stored` separates real records from the placeholder list shown on an empty
      // database. The placeholders have no row behind them, so they have nothing to
      // delete — offering the bin there would only ever produce a 404.
      setItems(rows && rows.length
        ? rows.map((r) => ({ ...r, stored: true }))
        : defaults.map((n) => ({ id: n, name: n, stored: false })));
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
      onChanged && onChanged();
      toast.success("Service type added");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to add service type");
    } finally {
      setLoading(false);
    }
  };

  const removeItem = async (item) => {
    if (!window.confirm(`Delete service type "${serviceTypeLabel(item.name).toUpperCase()}"?`)) return;
    try {
      setRemovingId(item.id);
      await deleteVertical(item.id);
      await fetchItems();
      onChanged && onChanged();
      toast.success("Service type deleted");
    } catch (err) {
      // The 409 names the branches still on this type, so it is worth showing in full
      // rather than collapsing to "Delete failed".
      toast.error(err?.response?.data?.detail || "Failed to delete service type");
    } finally {
      setRemovingId("");
    }
  };

  return (
    <div className="space-y-4">
      <form className="flex gap-2" onSubmit={addItem} data-testid="service-type-form">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="new_service_type"
          className="h-10 flex-1"
          data-testid="service-type-input"
        />
        <Button type="submit" disabled={loading} className="h-10 shrink-0 bg-sky-600 px-5 hover:bg-sky-700" data-testid="service-type-submit">
          <Plus className="mr-1 h-4 w-4" />Add
        </Button>
      </form>
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((item, idx) => {
          const color = SERVICE_TYPE_COLORS[idx % SERVICE_TYPE_COLORS.length];
          return (
            <div
              key={item.id}
              className="flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition hover:shadow-sm"
              style={{ backgroundColor: `${color}0f`, borderColor: `${color}33` }}
              data-testid={`service-type-row-${item.id}`}
            >
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md" style={{ backgroundColor: `${color}24` }}>
                <Layers className="h-3.5 w-3.5" style={{ color }} />
              </span>
              {/* The OS's small-caps label: uppercase, tracked, one step down in size. A
                  service type is a tag on a branch, not prose, and it reads as one here. */}
              <span className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wide text-slate-600" title={item.name}>
                {serviceTypeLabel(item.name)}
              </span>
              {item.stored && (
                <button
                  type="button"
                  onClick={() => removeItem(item)}
                  disabled={removingId === item.id}
                  className="shrink-0 text-slate-400 transition hover:text-rose-600 disabled:opacity-40"
                  title="Delete service type"
                  aria-label={`Delete ${serviceTypeLabel(item.name)}`}
                  data-testid={`service-type-delete-${item.id}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          );
        })}
        {items.length === 0 && (
          <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-500 sm:col-span-2">
            No service types yet. Add one above.
          </p>
        )}
      </div>
    </div>
  );
};

export default BranchManagementBoard;
