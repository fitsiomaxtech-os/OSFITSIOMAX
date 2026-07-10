import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft, MapPin, Clock, Calendar as CalendarIcon, Mail, Phone, User, RefreshCw, Pencil,
  Users, BarChart3, Stethoscope, Activity, ListChecks, FileText, Wallet, UserCog, X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { bmDetail, updateBranch, bmReassignAdmin, hrBranchAdminCandidates, bmHeadPhysioCandidates, bmAssignHeadPhysio } from "@/lib/api";
import { BranchFormDialogV2 } from "@/components/branch/BranchFormDialogV2";

const TABS = [
  { key: "summary", label: "Summary", icon: BarChart3 },
  { key: "staff", label: "Staff", icon: Users },
  { key: "performance", label: "Performance", icon: Activity },
  { key: "head_physio", label: "Head Physio", icon: Stethoscope },
];

export const BranchDetailPage = ({ branchId, onBack }) => {
  const [tab, setTab] = useState("summary");
  const [data, setData] = useState(null);
  const [showEdit, setShowEdit] = useState(false);

  const load = useCallback(() => bmDetail(branchId).then(setData).catch(() => toast.error("Failed to load")), [branchId]);
  useEffect(() => { load(); }, [load]);

  if (!data) return <p className="text-sm text-slate-500" data-testid="branch-detail-loading">Loading branch details...</p>;
  const b = data.branch;

  return (
    <div className="space-y-5" data-testid="branch-detail-page">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack} data-testid="branch-detail-back"><ArrowLeft className="h-4 w-4 mr-1" />Branches</Button>
          <div>
            <h2 className="text-2xl font-bold text-slate-900">{b.branch_name}</h2>
            <p className="text-sm text-slate-500"><MapPin className="inline h-3 w-3 mr-1" />{b.address}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} data-testid="branch-detail-refresh"><RefreshCw className="h-4 w-4" /></Button>
          <Button variant="outline" onClick={() => setShowEdit(true)} data-testid="branch-detail-edit"><Pencil className="h-4 w-4 mr-1" />Edit</Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2" data-testid="branch-detail-tabs">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${active ? "bg-sky-600 text-white" : "text-slate-600 hover:bg-slate-100"}`} data-testid={`branch-detail-tab-${t.key}`}>
              <Icon className="h-4 w-4" />{t.label}
            </button>
          );
        })}
      </div>

      {tab === "summary" && <SummaryTab data={data} branchId={branchId} onChanged={load} />}
      {tab === "staff" && <StaffTab staff={data.staff} />}
      {tab === "performance" && <PerformanceTab perf={data.performance} />}
      {tab === "head_physio" && <HeadPhysioTab hp={data.head_physio_section} branchId={branchId} onChanged={load} />}

      {showEdit && <BranchFormDialogV2 branch={b} onClose={() => setShowEdit(false)} onSaved={() => { setShowEdit(false); load(); }} />}
    </div>
  );
};

// ---------- Summary tab ----------

const SummaryTab = ({ data, branchId, onChanged }) => {
  const b = data.branch;
  const adm = data.admin_user;
  const [showEditAdmin, setShowEditAdmin] = useState(false);
  const [showReassign, setShowReassign] = useState(false);
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2" data-testid="branch-summary-card">
        <CardHeader><CardTitle className="text-base">Branch Summary</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Row icon={<User className="h-4 w-4 text-slate-400" />} label="Name" value={b.branch_name} />
          <Row icon={<MapPin className="h-4 w-4 text-slate-400" />} label="Address" value={b.address} />
          <Row icon={<CalendarIcon className="h-4 w-4 text-slate-400" />} label="Opened Date" value={b.opened_date || "—"} />
          <Row icon={<Clock className="h-4 w-4 text-slate-400" />} label="Opening Hours" value={b.opening_hours || "—"} />
          <Row icon={<FileText className="h-4 w-4 text-slate-400" />} label="Vertical" value={b.vertical} />
          <Row icon={<CalendarIcon className="h-4 w-4 text-slate-400" />} label="Created" value={(b.created_at || "").slice(0, 10) || "—"} />
        </CardContent>
      </Card>

      <Card data-testid="branch-admin-card">
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <CardTitle className="text-base">Branch Admin</CardTitle>
          <div className="flex gap-1">
            <button onClick={() => setShowEditAdmin(true)} className="text-blue-500 hover:text-blue-700 p-1" title="Edit admin contact" data-testid="branch-admin-edit-btn"><Pencil className="h-4 w-4" /></button>
            <button onClick={() => setShowReassign(true)} className="text-sky-600 hover:text-sky-700 p-1" title="Reassign admin" data-testid="branch-admin-reassign-btn"><UserCog className="h-4 w-4" /></button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-sky-100 text-sm font-bold text-sky-700">
              {(b.admin_name || "?").split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?"}
            </div>
            <div>
              <p className="font-semibold text-slate-900">{b.admin_name || "Unassigned"}</p>
              <p className="text-xs text-slate-500">{adm?.role || "branch_admin"}</p>
            </div>
          </div>
          <div className="space-y-1 pt-2 text-sm">
            {b.admin_email && <p className="flex items-center gap-2 text-slate-600"><Mail className="h-3.5 w-3.5" />{b.admin_email}</p>}
            {b.admin_phone && <p className="flex items-center gap-2 text-slate-600"><Phone className="h-3.5 w-3.5" />{b.admin_phone}</p>}
            {adm?.created_at && <p className="text-xs text-slate-400">Joined {(adm.created_at).slice(0, 10)}</p>}
          </div>
        </CardContent>
      </Card>

      {showEditAdmin && <EditAdminContactDialog branch={b} onClose={() => setShowEditAdmin(false)} onSaved={() => { setShowEditAdmin(false); onChanged && onChanged(); }} />}
      {showReassign && <ReassignAdminDialog branchId={branchId} currentAdminId={b.admin_user_id} onClose={() => setShowReassign(false)} onSaved={() => { setShowReassign(false); onChanged && onChanged(); }} />}
    </div>
  );
};

const Row = ({ icon, label, value }) => (
  <div className="flex items-start gap-3">
    {icon}
    <div className="flex-1">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-sm font-medium text-slate-800">{value}</p>
    </div>
  </div>
);

// ---------- Staff tab ----------

const StaffTab = ({ staff }) => {
  const [section, setSection] = useState("branch_admins");
  const groups = [
    { key: "branch_admins", label: "Branch Admins", items: staff.branch_admins, color: "#0ea5e9" },
    { key: "head_physios", label: "Head Physios", items: staff.head_physios, color: "#a855f7" },
    { key: "physios", label: "Physios", items: staff.physios, color: "#22c55e" },
    { key: "doctors", label: "Doctors (Calendar)", items: staff.doctors, color: "#f59e0b" },
  ];
  const current = groups.find((g) => g.key === section);
  return (
    <div className="space-y-4" data-testid="branch-staff-tab">
      <div className="grid gap-2 sm:grid-cols-4">
        {groups.map((g) => (
          <button key={g.key} onClick={() => setSection(g.key)} className={`rounded-xl border p-4 text-left transition ${section === g.key ? "border-slate-900 shadow" : "border-slate-200 hover:border-slate-300"}`} data-testid={`branch-staff-${g.key}-card`}>
            <p className="text-xs text-slate-500">{g.label}</p>
            <p className="mt-1 text-2xl font-bold" style={{ color: g.color }}>{g.items.length}</p>
          </button>
        ))}
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">{current.label}</CardTitle></CardHeader>
        <CardContent>
          {current.items.length === 0 ? <p className="text-sm text-slate-400">No {current.label.toLowerCase()} yet.</p> : (
            <div className="grid gap-2 md:grid-cols-2">
              {current.items.map((u) => (
                <div key={u.id} className="rounded-md border border-slate-200 p-3" data-testid={`branch-staff-row-${u.id}`}>
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">
                      {(u.full_name || "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-slate-800">{u.full_name}</p>
                      <p className="text-xs text-slate-500">{u.email || u.specialization || ""}</p>
                    </div>
                    {u.profile_type && <span className="rounded bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-600">{u.profile_type}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

// ---------- Performance tab ----------

const PerformanceTab = ({ perf }) => {
  const [sub, setSub] = useState("appointments");
  const groups = [
    { key: "appointments", label: "Appointments", icon: CalendarIcon, badge: perf.appointments.total },
    { key: "consultations", label: "Consultations", icon: Stethoscope, badge: perf.consultations.total_count },
    { key: "packages", label: "Packages", icon: Wallet, badge: perf.packages.total_count },
    { key: "followups", label: "Follow-ups", icon: ListChecks, badge: perf.follow_ups.total },
  ];
  return (
    <div className="space-y-4" data-testid="branch-performance-tab">
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiBig label="Total Leads" value={perf.kpis.leads_total} color="#0ea5e9" />
        <KpiBig label="Open" value={perf.kpis.leads_open} color="#f59e0b" />
        <KpiBig label="Completed" value={perf.kpis.leads_completed} color="#22c55e" />
      </div>
      <div className="flex flex-wrap gap-2 rounded-lg bg-slate-100 p-1">
        {groups.map((g) => {
          const Icon = g.icon;
          return (
            <button key={g.key} onClick={() => setSub(g.key)} className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${sub === g.key ? "bg-white text-slate-900 shadow" : "text-slate-600"}`} data-testid={`branch-perf-sub-${g.key}`}>
              <Icon className="h-4 w-4" />{g.label}<span className="ml-1 rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">{g.badge}</span>
            </button>
          );
        })}
      </div>

      {sub === "appointments" && (
        <Card data-testid="branch-perf-appointments">
          <CardHeader><CardTitle className="text-base">Appointments</CardTitle></CardHeader>
          <CardContent>
            <div className="mb-3 grid gap-2 sm:grid-cols-4">
              <Mini label="Total" value={perf.appointments.total} color="#0ea5e9" />
              <Mini label="Scheduled" value={perf.appointments.scheduled} color="#f59e0b" />
              <Mini label="Completed" value={perf.appointments.completed} color="#22c55e" />
              <Mini label="Cancelled" value={perf.appointments.cancelled} color="#ef4444" />
            </div>
            <ListTable rows={perf.appointments.list} columns={[
              { key: "patient_name", label: "Patient" },
              { key: "appointment_time", label: "Date/Time", fmt: (v) => (v || "").replace("T", " ").slice(0, 16) },
              { key: "doctor_name", label: "Doctor" },
              { key: "status", label: "Status" },
            ]} empty="No appointments." testid="branch-perf-appt-table" />
          </CardContent>
        </Card>
      )}

      {sub === "consultations" && (
        <Card data-testid="branch-perf-consultations">
          <CardHeader><CardTitle className="text-base">Consultations</CardTitle></CardHeader>
          <CardContent>
            <div className="mb-3 grid gap-2 sm:grid-cols-2">
              <Mini label="Consultations" value={perf.consultations.total_count} color="#0ea5e9" />
              <Mini label="Revenue ₹" value={Number(perf.consultations.total_amount || 0).toLocaleString("en-IN")} color="#22c55e" />
            </div>
            <ListTable rows={perf.consultations.list} columns={[
              { key: "name", label: "Patient" },
              { key: "phone", label: "Phone" },
              { key: "consultation_fee", label: "Fee ₹", fmt: (v) => `₹${Number(v || 0).toLocaleString("en-IN")}` },
              { key: "stage", label: "Stage" },
            ]} empty="No consultations." testid="branch-perf-cons-table" />
          </CardContent>
        </Card>
      )}

      {sub === "packages" && (
        <Card data-testid="branch-perf-packages">
          <CardHeader><CardTitle className="text-base">Package Selling</CardTitle></CardHeader>
          <CardContent>
            <div className="mb-3 grid gap-2 sm:grid-cols-2">
              <Mini label="Packages Sold" value={perf.packages.total_count} color="#a855f7" />
              <Mini label="Revenue ₹" value={Number(perf.packages.total_amount || 0).toLocaleString("en-IN")} color="#22c55e" />
            </div>
            <ListTable rows={perf.packages.list} columns={[
              { key: "name", label: "Patient" },
              { key: "package_weeks", label: "Weeks" },
              { key: "package_amount", label: "Amount", fmt: (v) => `₹${Number(v || 0).toLocaleString("en-IN")}` },
              { key: "stage", label: "Stage" },
            ]} empty="No packages sold." testid="branch-perf-pkg-table" />
          </CardContent>
        </Card>
      )}

      {sub === "followups" && (
        <Card data-testid="branch-perf-followups">
          <CardHeader><CardTitle className="text-base">Follow-ups</CardTitle></CardHeader>
          <CardContent>
            <div className="mb-3 grid gap-2 sm:grid-cols-3">
              <Mini label="Total" value={perf.follow_ups.total} color="#0ea5e9" />
              <Mini label="Open" value={perf.follow_ups.open} color="#f59e0b" />
              <Mini label="Done" value={perf.follow_ups.done} color="#22c55e" />
            </div>
            <ListTable rows={perf.follow_ups.list} columns={[
              { key: "lead_name", label: "Patient" },
              { key: "follow_up_date", label: "Date", fmt: (v) => (v || "").slice(0, 10) },
              { key: "note", label: "Note" },
              { key: "completed", label: "Status", fmt: (v) => (v ? "Done" : "Open") },
            ]} empty="No follow-ups." testid="branch-perf-fu-table" />
          </CardContent>
        </Card>
      )}
    </div>
  );
};

// ---------- Head Physio tab ----------

const HeadPhysioTab = ({ hp, branchId, onChanged }) => {
  const [showAssign, setShowAssign] = useState(false);
  return (
  <div className="space-y-4" data-testid="branch-head-physio-tab">
    <div className="grid gap-3 sm:grid-cols-2">
      <Card data-testid="branch-hp-calendars">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">Head Physio Calendars</CardTitle>
          <button onClick={() => setShowAssign(true)} className="text-sky-600 hover:text-sky-700 p-1" title="Assign a Head Physio" data-testid="branch-hp-assign-btn"><UserCog className="h-4 w-4" /></button>
        </CardHeader>
        <CardContent>
          {hp.calendars.length === 0 ? <p className="text-sm text-slate-400">No Head Physio assigned yet. Click the assign icon above to link an unassigned Head Physio from HR → Roles &amp; Credentials.</p> : (
            <div className="space-y-2">
              {hp.calendars.map((d) => (
                <div key={d.id} className="flex items-center justify-between rounded-md border border-slate-200 p-3" data-testid={`branch-hp-cal-${d.id}`}>
                  <div>
                    <p className="text-sm font-semibold">{d.full_name}</p>
                    <p className="text-xs text-slate-500">{d.specialization || "Head Physio"}</p>
                    <p className="text-[11px] text-slate-400">{(d.slots || []).length} time slots configured</p>
                  </div>
                  <span className="rounded bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-600">{d.profile_type}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <Card data-testid="branch-hp-physio-cal">
        <CardHeader><CardTitle className="text-base">Physio Calendars</CardTitle></CardHeader>
        <CardContent>
          {hp.physio_calendars.length === 0 ? <p className="text-sm text-slate-400">No Physio calendars yet.</p> : (
            <div className="space-y-2">
              {hp.physio_calendars.map((d) => (
                <div key={d.id} className="flex items-center justify-between rounded-md border border-slate-200 p-3" data-testid={`branch-hp-pcal-${d.id}`}>
                  <div>
                    <p className="text-sm font-semibold">{d.full_name}</p>
                    <p className="text-xs text-slate-500">{d.specialization || "Physio"}</p>
                    <p className="text-[11px] text-slate-400">{(d.slots || []).length} time slots configured</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>

    <Card data-testid="branch-hp-post-treatment">
      <CardHeader><CardTitle className="text-base">Post-Treatment Reviews (Weekly Assessments)</CardTitle></CardHeader>
      <CardContent>
        {hp.post_treatment_reviews.length === 0 ? <p className="text-sm text-slate-400">No post-treatment reviews yet.</p> : (
          <div className="space-y-2">
            {hp.post_treatment_reviews.slice(0, 25).map((r, i) => (
              <div key={`${r.lead_id}-${r.week ?? i}`} className="rounded-md border border-slate-200 p-3" data-testid={`branch-hp-review-${r.lead_id}-${r.week ?? i}`}>
                <div className="mb-1 flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-800">{r.lead_name}</p>
                  <span className="rounded bg-purple-50 px-2 py-0.5 text-[10px] font-semibold text-purple-600">Week {r.week ?? "?"}</span>
                </div>
                {r.notes && <p className="text-xs text-slate-600">{r.notes}</p>}
                {r.recommendation && <p className="mt-1 text-xs italic text-slate-500">Rec: {r.recommendation}</p>}
                {r.created_at && <p className="mt-1 text-[10px] text-slate-400">{(r.created_at).slice(0, 16).replace("T", " ")}</p>}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>

    {showAssign && <AssignHeadPhysioDialog branchId={branchId} onClose={() => setShowAssign(false)} onSaved={() => { setShowAssign(false); onChanged && onChanged(); }} />}
  </div>
  );
};

const AssignHeadPhysioDialog = ({ branchId, onClose, onSaved }) => {
  const [candidates, setCandidates] = useState([]);
  const [pick, setPick] = useState("");
  useEffect(() => { bmHeadPhysioCandidates().then(setCandidates).catch((e) => console.warn("[load hp candidates]", e?.message || e)); }, []);

  const save = async () => {
    if (!pick) { toast.error("Pick a Head Physio"); return; }
    try { await bmAssignHeadPhysio(branchId, pick); toast.success("Head Physio assigned"); onSaved(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Assign failed"); }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" data-testid="branch-hp-assign-dialog">
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">Assign Head Physio</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" data-testid="branch-hp-assign-close"><X className="h-4 w-4" /></button>
        </div>
        <p className="text-xs text-slate-500">Only Head Physios not yet assigned to any branch are listed. Create more in HR → Roles &amp; Credentials.</p>
        <select className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" value={pick} onChange={(e) => setPick(e.target.value)} data-testid="branch-hp-assign-select">
          <option value="">— Select Head Physio —</option>
          {candidates.length === 0 && <option disabled>No unassigned Head Physios</option>}
          {candidates.map((c) => <option key={c.id} value={c.id}>{c.full_name}{c.specialization ? ` · ${c.specialization}` : ""}</option>)}
        </select>
        <div className="flex gap-2 pt-2"><Button variant="outline" onClick={onClose} className="flex-1" data-testid="branch-hp-assign-cancel">Cancel</Button><Button onClick={save} className="flex-1 bg-sky-600 hover:bg-sky-700" data-testid="branch-hp-assign-submit">Assign</Button></div>
      </div>
    </div>
  );
};

// ---------- shared ----------

const KpiBig = ({ label, value, color }) => (
  <div className="rounded-xl border bg-white p-4 shadow-sm" style={{ borderLeftColor: color, borderLeftWidth: 4 }}>
    <p className="text-xs text-slate-500">{label}</p>
    <p className="mt-1 text-3xl font-bold" style={{ color }}>{value}</p>
  </div>
);

const Mini = ({ label, value, color }) => (
  <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-center">
    <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-1 text-lg font-bold" style={{ color }}>{value}</p>
  </div>
);

const ListTable = ({ rows, columns, empty, testid }) => (
  <div className="overflow-auto rounded-md border border-slate-200" data-testid={testid}>
    <table className="min-w-full text-xs">
      <thead className="bg-slate-50 text-left text-slate-500">
        <tr>{columns.map((c) => <th key={c.key} className="px-3 py-2 font-semibold uppercase tracking-wide">{c.label}</th>)}</tr>
      </thead>
      <tbody>
        {rows.length === 0 ? <tr><td colSpan={columns.length} className="px-3 py-4 text-center text-slate-400">{empty}</td></tr> :
          rows.map((r, i) => (
            <tr key={r.id || i} className="border-t border-slate-100">
              {columns.map((c) => <td key={c.key} className="px-3 py-2 text-slate-700">{c.fmt ? c.fmt(r[c.key]) : (r[c.key] ?? "—")}</td>)}
            </tr>
          ))}
      </tbody>
    </table>
  </div>
);

const EditMetaDialog = ({ branch, onClose, onSaved }) => {
  const [form, setForm] = useState({
    branch_name: branch.branch_name || "",
    address: branch.address || "",
    admin_phone: branch.admin_phone || "",
    opened_date: branch.opened_date || "",
    opening_hours: branch.opening_hours || "",
    vertical: branch.vertical || "offline_physiotherapy",
  });
  const save = async () => {
    if (!form.branch_name.trim()) { toast.error("Branch name required"); return; }
    try {
      await updateBranch(branch.id, form);
      toast.success("Branch updated");
      onSaved();
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
  };
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" data-testid="branch-edit-meta-dialog">
      <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl space-y-3">
        <h3 className="text-base font-semibold">Edit Branch — {branch.branch_name}</h3>
        <Input value={form.branch_name} onChange={(e) => setForm({ ...form, branch_name: e.target.value })} placeholder="Name" data-testid="branch-edit-name" />
        <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Address" data-testid="branch-edit-address" />
        <Input type="date" value={form.opened_date} onChange={(e) => setForm({ ...form, opened_date: e.target.value })} placeholder="Opened Date" data-testid="branch-edit-opened" />
        <Input value={form.opening_hours} onChange={(e) => setForm({ ...form, opening_hours: e.target.value })} placeholder="Opening Hours (e.g. Mon-Sat 7am-9pm)" data-testid="branch-edit-hours" />
        <Input value={form.admin_phone} onChange={(e) => setForm({ ...form, admin_phone: e.target.value })} placeholder="Admin Phone" data-testid="branch-edit-phone" />
        <select className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" value={form.vertical} onChange={(e) => setForm({ ...form, vertical: e.target.value })} data-testid="branch-edit-vertical">
          <option value="offline_physiotherapy">Offline Physiotherapy</option>
          <option value="online_physiotherapy">Online Physiotherapy</option>
          <option value="fitness">Fitness</option>
        </select>
        <div className="flex gap-2"><Button variant="outline" onClick={onClose} className="flex-1" data-testid="branch-edit-cancel">Cancel</Button><Button onClick={save} className="flex-1 bg-sky-600 hover:bg-sky-700" data-testid="branch-edit-submit">Save</Button></div>
      </div>
    </div>
  );
};

const EditAdminContactDialog = ({ branch, onClose, onSaved }) => {
  const [form, setForm] = useState({
    admin_name: branch.admin_name || "",
    admin_email: branch.admin_email || "",
    admin_phone: branch.admin_phone || "",
  });
  const save = async () => {
    if (!form.admin_name.trim()) { toast.error("Admin name required"); return; }
    try {
      await updateBranch(branch.id, form);
      toast.success("Admin contact updated");
      onSaved();
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
  };
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" data-testid="branch-admin-edit-dialog">
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">Edit Branch Admin Contact</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" data-testid="branch-admin-edit-close"><X className="h-4 w-4" /></button>
        </div>
        <p className="text-xs text-slate-500">Updates the contact info shown on this branch (does not change the user's login credentials — manage those in HR → Roles & Credentials).</p>
        <Field label="Display Name"><Input value={form.admin_name} onChange={(e) => setForm({ ...form, admin_name: e.target.value })} data-testid="branch-admin-edit-name" /></Field>
        <Field label="Email"><Input value={form.admin_email} onChange={(e) => setForm({ ...form, admin_email: e.target.value })} placeholder="admin@example.com" data-testid="branch-admin-edit-email" /></Field>
        <Field label="Phone"><Input value={form.admin_phone} onChange={(e) => setForm({ ...form, admin_phone: e.target.value })} placeholder="+91 …" data-testid="branch-admin-edit-phone" /></Field>
        <div className="flex gap-2 pt-2"><Button variant="outline" onClick={onClose} className="flex-1" data-testid="branch-admin-edit-cancel">Cancel</Button><Button onClick={save} className="flex-1 bg-blue-600 hover:bg-blue-700" data-testid="branch-admin-edit-submit">Save</Button></div>
      </div>
    </div>
  );
};

const ReassignAdminDialog = ({ branchId, currentAdminId, onClose, onSaved }) => {
  const [candidates, setCandidates] = useState([]);
  const [pick, setPick] = useState(currentAdminId || "");
  useEffect(() => { hrBranchAdminCandidates().then(setCandidates).catch((e) => console.warn("[load candidates]", e?.message || e)); }, []);
  const available = candidates.filter((c) => !c.assigned_branch || c.id === currentAdminId);

  const save = async () => {
    if (!pick) { toast.error("Pick a manager"); return; }
    if (pick === currentAdminId) { toast.error("Already assigned to this branch"); return; }
    try { await bmReassignAdmin(branchId, pick); toast.success("Manager reassigned"); onSaved(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Reassign failed"); }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" data-testid="branch-admin-reassign-dialog">
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">Reassign Branch Admin</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" data-testid="branch-admin-reassign-close"><X className="h-4 w-4" /></button>
        </div>
        <p className="text-xs text-slate-500">Only users with role <span className="font-semibold">branch_admin</span> who aren't already running another branch can be picked. Create more in HR → Roles & Credentials.</p>
        <select className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" value={pick} onChange={(e) => setPick(e.target.value)} data-testid="branch-admin-reassign-select">
          <option value="">— Select branch admin —</option>
          {available.length === 0 && <option disabled>No available branch_admin users</option>}
          {available.map((c) => <option key={c.id} value={c.id}>{c.full_name} · {c.email}{c.id === currentAdminId ? " (current)" : ""}</option>)}
        </select>
        <div className="flex gap-2 pt-2"><Button variant="outline" onClick={onClose} className="flex-1" data-testid="branch-admin-reassign-cancel">Cancel</Button><Button onClick={save} className="flex-1 bg-sky-600 hover:bg-sky-700" data-testid="branch-admin-reassign-submit">Reassign</Button></div>
      </div>
    </div>
  );
};

export default BranchDetailPage;
