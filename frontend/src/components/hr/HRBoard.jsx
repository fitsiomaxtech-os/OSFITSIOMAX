import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Users, ShieldCheck, BarChart3, Plus, Pencil, Trash2, Eye, EyeOff, KeyRound, X, UserPlus, MoreVertical, CheckCircle2, XCircle, AlertOctagon, CalendarOff, ChevronDown, FolderTree } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import {
  hrDashboard, hrEmployees, hrCreateEmployee, hrUpdateEmployee, hrDeleteEmployee,
  hrUsers, hrCreateUser, hrUpdateUser, hrResetPassword, hrDeactivateUser, hrActivateUser, hrDeleteUserPermanent, hrUpdateUserRole, hrMeta, hrAddCustomRole,
  hrDepartments, hrCreateDepartment, hrDeleteDepartment, hrAddDesignation, hrDeleteDesignation,
  getBranches,
} from "@/lib/api";
import { MilkDateInput } from "@/components/ui/milk-calendar";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";

const TABS = [
  { key: "dashboard", label: "Dashboard", icon: BarChart3 },
  { key: "employees", label: "Employees", icon: Users },
  { key: "roles", label: "Roles & Credentials", icon: ShieldCheck },
  { key: "departments", label: "Departments & Designation", short: "Depts", icon: FolderTree },
];

// Both consultant roles can cover more than one branch — every other role keeps the
// original single Branch select.
// Physios belong to branches and may cover several, so they get the checkbox list.
// Head Physios cover the whole organisation by definition — offering them a branch choice
// would suggest they could be limited to one, which they can't be.
// Kept in step with MULTI_BRANCH_ROLES in backend/routers/v3_hr.py. A role missing here
// is offered a single branch on hire while the backend expects a list, so an Online
// Physio covering three branches would get one expert record and two empty calendars.
const MULTI_BRANCH_ROLE_LABELS = { physio: "Physio", online_physio: "Online Physio" };
const ORG_WIDE_ROLES = new Set(["head_physio"]);

export const HRBoard = () => {
  const [tab, setTab] = useState("dashboard");
  // Set by a Dashboard card or a department bar, consumed once by the Employees tab. Held
  // here rather than inside EmployeesTab because the thing that decides the filter and the
  // thing that applies it are on opposite sides of the tab switch.
  const [empFilter, setEmpFilter] = useState(null);
  const [meta, setMeta] = useState({ departments: [], department_designations: {}, roles: [], custom_roles: [] });
  const reloadMeta = useCallback(() => hrMeta().then((m) => {
    // Before setMeta, so the first render after a reload already has the colours rather
    // than painting every custom role grey and correcting itself a frame later.
    setCustomRoleClasses(m.custom_roles);
    setMeta(m);
  }).catch((e) => console.warn("[load failed]", e?.message || e)), []);
  useEffect(() => { reloadMeta(); }, [reloadMeta]);
  // flex+gap, not space-y — the title/description block below is hidden by class on
  // mobile, not the hidden attribute, so space-y's sibling selector would still hand
  // the tab strip phantom top margin for content a phone never draws.
  return (
    <div className="flex flex-col gap-5" data-testid="hr-board">
      {/* No heading. The nav tab above already reads HR Admin. */}
      <SegmentedTabs tabs={TABS} value={tab} onChange={setTab} testid="hr-subtab" mobileCols={4} />
      {tab === "dashboard" && <DashboardTab onNavigate={(t, f) => { setEmpFilter(f || null); setTab(t); }} />}
      {tab === "employees" && <EmployeesTab meta={meta} initialFilter={empFilter} />}
      {tab === "roles" && <RolesTab meta={meta} reloadMeta={reloadMeta} />}
      {tab === "departments" && <DepartmentsTab meta={meta} reloadMeta={reloadMeta} />}
    </div>
  );
};

// ---------- Dashboard ----------

/**
 * A figure, and — where there is somewhere to go — the control that takes you to the rows
 * behind it. A tile with no `onClick` renders as plain text rather than a button, so a
 * card that leads nowhere never invites a click that does nothing.
 */
const KPI = ({ label, value, icon: Icon, onClick, hint, testid }) => {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      {...(onClick ? { type: "button", onClick } : {})}
      className={`w-full rounded-xl border-2 border-slate-200 bg-white px-4 py-3.5 text-left transition ${
        onClick ? "cursor-pointer hover:border-orange-300 hover:shadow-sm" : ""
      }`}
      data-testid={testid}
    >
      <span className="flex items-center gap-1.5 text-slate-500">
        {Icon && <Icon className="h-4 w-4 shrink-0" />}
        <span className="truncate text-[11px] font-bold uppercase tracking-wider">{label}</span>
      </span>
      <span className="mt-1 block text-3xl font-extrabold text-slate-800">{value}</span>
      {hint && <span className="mt-0.5 block text-[10px] text-slate-400">{hint}</span>}
    </Tag>
  );
};

const DashboardTab = ({ onNavigate }) => {
  const [data, setData] = useState(null);
  useEffect(() => { hrDashboard().then(setData).catch(() => toast.error("Failed to load")); }, []);
  if (!data) return <p className="text-sm text-slate-500">Loading...</p>;
  const k = data.kpis;

  // Sorted, so the biggest department is the one the eye lands on. Share is taken against
  // the sum of the departments rather than active_employees: the two count different
  // things (one is every employee record, the other only active ones), and dividing by the
  // wrong one would print percentages that don't reach 100.
  const depts = [...(data.department_strength || [])].sort((a, b) => b.count - a.count);
  const headcount = depts.reduce((n, d) => n + (d.count || 0), 0);

  return (
    <div className="space-y-5" data-testid="hr-dashboard-tab">
      {/* Active Employees and Total Users open the list behind them. The three attendance
          figures do not, because there is nothing behind them to open: present_today,
          late_today and pending_leaves are returned as literal 0 by /hr/dashboard — no
          attendance or leave data is recorded anywhere in the OS. They are rendered as
          plain figures rather than buttons so they cannot promise a drill-in that would
          land on an empty screen. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <KPI icon={Users} label="Active Employees" value={k.active_employees} onClick={() => onNavigate("employees", { status: "active" })} testid="hr-kpi-active" />
        <KPI icon={ShieldCheck} label="Total Users" value={k.total_users} onClick={() => onNavigate("roles")} testid="hr-kpi-users" />
        <KPI icon={CheckCircle2} label="Present Today" value={k.present_today} hint="Attendance not tracked yet" testid="hr-kpi-present" />
        <KPI icon={AlertOctagon} label="Late Today" value={k.late_today} hint="Attendance not tracked yet" testid="hr-kpi-late" />
        <KPI icon={CalendarOff} label="Pending Leaves" value={k.pending_leaves} hint="Leave not tracked yet" testid="hr-kpi-leaves" />
      </div>

      {/* Cards, in the same shape as the KPI row above so the page reads as one set of
          controls rather than two. Ordered biggest first — the original grid was in
          whatever order the aggregation returned, which put the largest department
          wherever it happened to land.

          Each card carries its share of headcount as well as the count. That is the one
          thing the count alone cannot tell you, and it is what the bars were really for:
          11 means little until you know whether it is most of the company or a corner
          of it. */}
      <Card data-testid="hr-dept-strength">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Department Strength</CardTitle>
          <p className="text-xs text-slate-500">Open a department to see its people.</p>
        </CardHeader>
        <CardContent>
          {depts.length === 0 ? <p className="text-sm text-slate-400">No employees yet.</p> : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {depts.map((d) => (
                <button
                  key={d.name}
                  type="button"
                  onClick={() => onNavigate("employees", { department: d.name })}
                  className="rounded-xl border-2 border-slate-200 bg-white px-4 py-3.5 text-left transition hover:border-orange-300 hover:shadow-sm"
                  data-testid={`hr-dept-${d.name}`}
                >
                  <span className="block truncate text-[11px] font-bold uppercase tracking-wider text-slate-500">{d.name}</span>
                  <span className="mt-1 block text-3xl font-extrabold text-orange-500">{d.count}</span>
                  <span className="mt-0.5 block text-[10px] text-slate-400">
                    {headcount ? `${Math.round((d.count / headcount) * 100)}% of staff` : ""}
                  </span>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

// ---------- Employees ----------

const EmployeesTab = ({ meta, initialFilter }) => {
  const [employees, setEmployees] = useState([]);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState(initialFilter?.status || "active");
  // Arrived at from a Department Strength bar or a Departments & Designation card.
  // Cleared by its own chip rather than by going back, so the way out is next to the
  // thing that narrowed the list.
  const [department, setDepartment] = useState(initialFilter?.department || "");
  const [designation, setDesignation] = useState(initialFilter?.designation || "");
  const [sortAZ, setSortAZ] = useState(null); // null = as-loaded | "asc" | "desc"
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);

  const load = useCallback(() => hrEmployees({ status: filterStatus === "all" ? "" : filterStatus }).then(setEmployees).catch((e) => console.warn("[load failed]", e?.message || e)), [filterStatus]);
  useEffect(() => { load(); }, [load]);

  const filtered = employees.filter((e) => {
    // "Unassigned" is what the Dashboard calls an employee with no department, so it has
    // to match the empty field here or that bar would open an empty list.
    if (department && (e.department || "Unassigned") !== department) return false;
    if (designation && e.designation !== designation) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (e.full_name || "").toLowerCase().includes(q) || (e.email || "").toLowerCase().includes(q) || (e.employee_code || "").toLowerCase().includes(q);
  });
  if (sortAZ) {
    filtered.sort((a, b) => (a.full_name || "").localeCompare(b.full_name || "") * (sortAZ === "asc" ? 1 : -1));
  }

  const remove = async (emp) => {
    if (!window.confirm(`Delete employee ${emp.full_name}?`)) return;
    try { await hrDeleteEmployee(emp.id); toast.success("Deleted"); setViewing(null); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Delete failed"); }
  };

  const active = employees.filter((e) => (e.status || "active") === "active").length;
  const left = employees.filter((e) => (e.status || "active") !== "active").length;

  // flex+gap, not space-y — the desktop table below is hidden by class on mobile.
  return (
    <div className="flex flex-col gap-4" data-testid="hr-employees-tab">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setFilterStatus("active")} className={`rounded-md px-3 py-2 text-sm font-medium ${filterStatus === "active" ? "bg-orange-500 text-white" : "bg-slate-100 text-slate-600"}`} data-testid="hr-emp-tab-active">Active Employees ({active})</button>
        <button onClick={() => setFilterStatus("left")} className={`rounded-md px-3 py-2 text-sm font-medium ${filterStatus === "left" ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-600"}`} data-testid="hr-emp-tab-left">Left ({left})</button>
        {department && (
          <button
            onClick={() => setDepartment("")}
            className="inline-flex items-center gap-1.5 rounded-md border border-orange-300 bg-orange-50 px-3 py-2 text-sm font-medium text-orange-700 hover:bg-orange-100"
            title="Clear the department filter"
            data-testid="hr-emp-dept-chip"
          >
            {department} <X className="h-3.5 w-3.5" />
          </button>
        )}
        {designation && (
          <button
            onClick={() => setDesignation("")}
            className="inline-flex items-center gap-1.5 rounded-md border border-orange-300 bg-orange-50 px-3 py-2 text-sm font-medium text-orange-700 hover:bg-orange-100"
            title="Clear the designation filter"
            data-testid="hr-emp-designation-chip"
          >
            {designation} <X className="h-3.5 w-3.5" />
          </button>
        )}
        <div className="flex-1" />
        <button
          onClick={() => setSortAZ((s) => (s === "asc" ? "desc" : "asc"))}
          className={`rounded-md px-3 py-2 text-sm font-medium ${sortAZ ? "bg-orange-500 text-white" : "bg-slate-100 text-slate-600"}`}
          data-testid="hr-emp-sort-az"
        >
          {sortAZ === "desc" ? "Z → A" : "A → Z"}
        </button>
        <Input placeholder="Search employee..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full sm:w-64" data-testid="hr-emp-search" />
        <Button onClick={() => { setEditing(null); setShowAdd(true); }} className="w-full bg-orange-500 hover:bg-orange-600 sm:w-auto" data-testid="hr-emp-add-btn"><Plus className="h-4 w-4 mr-1" />Add Employee</Button>
      </div>

      <div className="space-y-2 md:hidden" data-testid="hr-emp-cards">
        {filtered.map((e) => (
          <div key={e.id} className="rounded-xl border border-slate-200 bg-white p-3" data-testid={`hr-emp-card-${e.id}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-800">{e.full_name}</p>
                <p className="text-xs text-slate-400">{e.employee_code}</p>
              </div>
              <span className={`shrink-0 rounded px-2 py-0.5 text-xs ${e.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>{e.status || "active"}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
              <span>{e.designation || "—"}{e.department ? ` · ${e.department}` : ""}</span>
              <span className="font-semibold text-emerald-600">₹{Number(e.net_salary || 0).toLocaleString("en-IN")}</span>
            </div>
            <div className="mt-1 text-xs text-slate-500">{e.email}{e.phone ? ` · ${e.phone}` : ""}</div>
            <div className="mt-2 flex items-center gap-3 border-t border-slate-100 pt-2">
              <button onClick={() => setViewing(e)} className="flex items-center gap-1 text-xs font-medium text-sky-600" data-testid={`hr-emp-card-view-${e.id}`}><Eye className="h-3.5 w-3.5" />View</button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">No employees.</p>}
      </div>

      <Card className="hidden md:block">
        <CardHeader><CardTitle className="text-base">Employee Directory</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr><th className="px-3 py-2">S.No</th><th className="px-3 py-2">Employee</th><th className="px-3 py-2">Dept</th><th className="px-3 py-2">Designation</th><th className="px-3 py-2">Contact</th><th className="px-3 py-2">Joining</th><th className="px-3 py-2">Net Salary</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Actions</th></tr>
              </thead>
              <tbody>
                {filtered.map((e, i) => (
                  <tr key={e.id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`hr-emp-row-${e.id}`}>
                    <td className="px-3 py-2 text-slate-500">{i + 1}</td>
                    <td className="px-3 py-2">
                      <p className="font-medium text-slate-800">{e.full_name}</p>
                      <p className="text-xs text-slate-400">{e.employee_code}</p>
                    </td>
                    <td className="px-3 py-2 text-slate-600">{e.department || "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{e.designation || "—"}</td>
                    <td className="px-3 py-2 text-xs text-slate-600">{e.email}<br />{e.phone}</td>
                    <td className="px-3 py-2 text-slate-500">{e.joining_date || "—"}</td>
                    <td className="px-3 py-2 font-semibold text-emerald-600">₹{Number(e.net_salary || 0).toLocaleString("en-IN")}</td>
                    <td className="px-3 py-2"><span className={`rounded px-2 py-0.5 text-xs ${e.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>{e.status || "active"}</span></td>
                    <td className="px-3 py-2">
                      {/* One way in. Edit and Delete now live inside the view popup, where
                          you can see who you are about to change before you change them —
                          this eye previously had no handler at all and did nothing. */}
                      <button onClick={() => setViewing(e)} title="View employee" className="text-slate-500 hover:text-sky-600" data-testid={`hr-emp-view-${e.id}`}><Eye className="h-4 w-4" /></button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan="9" className="px-3 py-6 text-center text-slate-400">No employees.</td></tr>}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {viewing && (
        <EmployeeViewModal
          employee={viewing}
          onClose={() => setViewing(null)}
          onEdit={() => { setEditing(viewing); setViewing(null); setShowAdd(true); }}
          onDelete={() => remove(viewing)}
        />
      )}

      {showAdd && <AddEmployeeModal employee={editing} meta={meta} onClose={() => { setShowAdd(false); setEditing(null); }} onSaved={() => { setShowAdd(false); setEditing(null); load(); }} />}
    </div>
  );
};

// ---------- Employee View Modal ----------

const money = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

const ViewRow = ({ label, value }) => (
  <div className="flex items-start justify-between gap-3 border-b border-slate-100 py-1.5 last:border-0">
    <span className="shrink-0 text-xs text-slate-500">{label}</span>
    <span className="text-right text-xs font-medium text-slate-800">{value || "—"}</span>
  </div>
);

const ViewSection = ({ title, children }) => (
  <div className="rounded-xl border border-slate-200 p-3">
    <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">{title}</p>
    {children}
  </div>
);

/**
 * The employee record, read-only, with Edit and Delete on it — the single entry point
 * from the directory's Actions column. Deleting from a row you can only identify by
 * position is how the wrong person gets removed; here the whole record is on screen
 * first.
 */
const EmployeeViewModal = ({ employee: e, onClose, onEdit, onDelete }) => (
  <div
    className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
    onClick={(ev) => { if (ev.target === ev.currentTarget) onClose(); }}
    data-testid="hr-emp-view-modal"
  >
    <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
      <div className="flex shrink-0 items-start justify-between border-b border-slate-200 px-5 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-semibold text-slate-900" data-testid="hr-emp-view-name">{e.full_name}</h3>
            <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold ${e.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>{e.status || "active"}</span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            {e.employee_code || "No code"}{e.designation ? ` · ${e.designation}` : ""}{e.department ? ` · ${e.department}` : ""}
          </p>
        </div>
        <button onClick={onClose} className="shrink-0 text-slate-400 hover:text-slate-600" data-testid="hr-emp-view-close"><X className="h-4 w-4" /></button>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <ViewSection title="Personal">
            <ViewRow label="Email" value={e.email} />
            <ViewRow label="Phone" value={e.phone} />
            <ViewRow label="Date of Birth" value={e.dob} />
            <ViewRow label="Gender" value={e.gender} />
            <ViewRow label="Blood Group" value={e.blood_group} />
            <ViewRow label="Marital Status" value={e.marital_status} />
            <ViewRow label="Father's Name" value={e.father_name} />
            <ViewRow label="Mother's Name" value={e.mother_name} />
          </ViewSection>

          <ViewSection title="Employment">
            <ViewRow label="Employee Code" value={e.employee_code} />
            <ViewRow label="Department" value={e.department} />
            <ViewRow label="Designation" value={e.designation} />
            <ViewRow label="Joining Date" value={e.joining_date} />
            <ViewRow label="Reporting To" value={e.reporting_to} />
            <ViewRow label="Status" value={e.status || "active"} />
          </ViewSection>

          <ViewSection title="ID & Documents">
            <ViewRow label="PAN" value={e.pan} />
            <ViewRow label="Aadhar" value={e.aadhar} />
          </ViewSection>

          <ViewSection title="Address & Emergency">
            <ViewRow label="Address" value={e.address} />
            <ViewRow label="Emergency Contact" value={e.emergency_contact_name} />
            <ViewRow label="Emergency Phone" value={e.emergency_contact_phone} />
          </ViewSection>

          <ViewSection title="Salary & Bank">
            <ViewRow label="Net Salary" value={money(e.net_salary)} />
            <ViewRow label="Gross Salary" value={money(e.gross_salary)} />
            <ViewRow label="Bank Name" value={e.bank_name} />
            <ViewRow label="Account Number" value={e.bank_account} />
            <ViewRow label="IFSC" value={e.ifsc} />
          </ViewSection>

          {e.notes && (
            <ViewSection title="Notes">
              <p className="whitespace-pre-wrap text-xs text-slate-700">{e.notes}</p>
            </ViewSection>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-slate-200 px-5 py-3">
        <button
          onClick={onDelete}
          className="flex items-center gap-1.5 rounded-md border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
          data-testid="hr-emp-view-delete"
        >
          <Trash2 className="h-4 w-4" /> Delete
        </button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} data-testid="hr-emp-view-cancel">Close</Button>
          <Button onClick={onEdit} className="bg-orange-500 hover:bg-orange-600" data-testid="hr-emp-view-edit">
            <Pencil className="mr-1.5 h-4 w-4" /> Edit
          </Button>
        </div>
      </div>
    </div>
  </div>
);

// ---------- Manual date entry ----------

const isoToDmy = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
};

/** "07-03-1994" -> "1994-03-07", but only for a date that actually exists. The
 *  round-trip check is what rejects 31-02: the Date constructor rolls that forward
 *  to 3 March rather than failing, so comparing the parts back is the only way to
 *  catch it. */
const dmyToIso = (text) => {
  const m = /^\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{4})\s*$/.exec(text || "");
  if (!m) return "";
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const d = new Date(`${iso}T00:00:00`);
  if (d.getFullYear() !== year || d.getMonth() + 1 !== month || d.getDate() !== day) return "";
  return iso;
};

/** Digits in, DD-MM-YYYY out — the separators appear as you type so nobody has to
 *  reach for the dash key, and pasting a date with slashes or dots still works. */
const formatDmyTyping = (text) => {
  const d = (text || "").replace(/\D/g, "").slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}-${d.slice(2)}`;
  return `${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4)}`;
};

/**
 * Typed date entry, for a field where picking is the slow way round.
 *
 * A calendar is right for a date near today — an appointment, a due date. A date of
 * birth is decades back, which is twenty-odd clicks through months, so this takes it
 * typed instead. Emits the same `{ target: { value } }` ISO shape the picker does, so
 * the form it feeds doesn't know the difference.
 */
const ManualDateInput = ({ value, onChange, placeholder = "DD-MM-YYYY", testid }) => {
  const [text, setText] = useState(isoToDmy(value));
  const [touched, setTouched] = useState(false);

  // Follow the record when it changes underneath — opening Edit on another employee
  // reuses this component rather than remounting it.
  useEffect(() => { setText(isoToDmy(value)); setTouched(false); }, [value]);

  const handle = (e) => {
    const next = formatDmyTyping(e.target.value);
    setText(next);
    const iso = dmyToIso(next);
    if (iso) onChange({ target: { value: iso } });
    else if (next === "") onChange({ target: { value: "" } });
  };

  const complete = text.replace(/\D/g, "").length === 8;
  const invalid = touched && text !== "" && !dmyToIso(text);
  const future = !invalid && dmyToIso(text) && dmyToIso(text) > new Date().toISOString().slice(0, 10);

  return (
    <div>
      <input
        value={text}
        onChange={handle}
        onBlur={() => setTouched(true)}
        placeholder={placeholder}
        inputMode="numeric"
        maxLength={10}
        className={`h-9 w-full rounded-md border px-3 text-sm outline-none transition placeholder:text-slate-400 focus:ring-1 ${
          invalid || future ? "border-rose-300 focus:border-rose-400 focus:ring-rose-300" : "border-slate-200 focus:border-orange-400 focus:ring-orange-300"
        }`}
        data-testid={testid}
      />
      {(invalid || future) && (
        <p className="mt-1 text-[11px] font-medium text-rose-600" data-testid={`${testid}-error`}>
          {future ? "That date is in the future." : complete ? "That date doesn't exist." : "Use DD-MM-YYYY."}
        </p>
      )}
    </div>
  );
};

// ---------- Add Employee Modal (multi-tab) ----------

const EMP_TABS = [
  { key: "personal", label: "Personal" },
  { key: "employment", label: "Employment" },
  { key: "id_docs", label: "ID & Docs" },
  { key: "address", label: "Address & Emergency" },
  { key: "salary", label: "Salary & Bank" },
];

const blankEmployee = {
  full_name: "", email: "", phone: "", dob: "", gender: "", blood_group: "",
  marital_status: "", father_name: "", mother_name: "",
  department: "", designation: "", joining_date: "", reporting_to: "", employee_code: "",
  pan: "", aadhar: "",
  address: "", emergency_contact_name: "", emergency_contact_phone: "",
  net_salary: 0, gross_salary: 0, bank_name: "", bank_account: "", ifsc: "",
  status: "active", notes: "",
};

const AddEmployeeModal = ({ employee, meta, onClose, onSaved }) => {
  const [tab, setTab] = useState("personal");
  const [form, setForm] = useState(employee ? { ...blankEmployee, ...employee } : blankEmployee);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  // Designation options are scoped to whichever Department is selected (grouped from
  // the Departments & Designation tab). Departments not grouped yet fall back to the
  // full role list, so the form stays usable while that grouping is still in progress.
  // An employee whose designation predates this list keeps it as an option so editing
  // them never silently blanks the field.
  const designationOptions = useMemo(() => {
    const grouped = (meta.department_designations || {})[form.department] || [];
    const fromRoles = (meta.roles || []).map(roleLabel);
    const base = grouped.length > 0 ? grouped : fromRoles;
    const current = (form.designation || "").trim();
    const all = current && !base.includes(current) ? [...base, current] : base;
    return ["", ...all];
  }, [meta.department_designations, meta.roles, form.department, form.designation]);

  const submit = async () => {
    if (!form.full_name.trim()) { toast.error("Full name required"); setTab("personal"); return; }
    if (!form.department) { toast.error("Pick a Department"); setTab("employment"); return; }
    if (!form.designation) { toast.error("Pick a Designation"); setTab("employment"); return; }
    const payload = { ...form };
    payload.net_salary = Number(payload.net_salary) || 0;
    payload.gross_salary = Number(payload.gross_salary) || 0;
    try {
      if (employee) { await hrUpdateEmployee(employee.id, payload); toast.success("Employee updated"); }
      else { await hrCreateEmployee(payload); toast.success("Employee created"); }
      onSaved();
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" data-testid="hr-emp-modal">
      <div className="w-full max-w-3xl rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <h3 className="text-base font-semibold">{employee ? "Edit Employee" : "Add New Employee"}</h3>
            <p className="text-xs text-slate-500">Fill in employee details across all sections below.</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" data-testid="hr-emp-modal-close"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex flex-wrap gap-2 border-b border-slate-200 px-5 py-2 text-xs">
          {EMP_TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} className={`rounded px-3 py-1 ${tab === t.key ? "bg-orange-50 text-orange-600 font-semibold" : "text-slate-600 hover:bg-slate-50"}`} data-testid={`hr-emp-modal-tab-${t.key}`}>{t.label}</button>
          ))}
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-5">
          {tab === "personal" && (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Full Name *"><Input value={form.full_name} onChange={(e) => set("full_name", e.target.value)} data-testid="hr-emp-name" /></Field>
              <Field label="Email"><Input value={form.email} onChange={(e) => set("email", e.target.value)} data-testid="hr-emp-email" /></Field>
              <Field label="Phone"><Input value={form.phone} onChange={(e) => set("phone", e.target.value)} data-testid="hr-emp-phone" /></Field>
              {/* Typed, not picked. A birth date is decades back — reaching it in a
                  calendar is twenty-odd clicks through months, where typing it is eight
                  keystrokes. Joining Date keeps its picker; that one is near today. */}
              <Field label="Date of Birth"><ManualDateInput value={form.dob} onChange={(e) => set("dob", e.target.value)} testid="hr-emp-dob" /></Field>
              <Field label="Gender"><Select value={form.gender} onChange={(v) => set("gender", v)} options={["", "Male", "Female", "Other"]} testid="hr-emp-gender" /></Field>
              <Field label="Blood Group"><Select value={form.blood_group} onChange={(v) => set("blood_group", v)} options={["", "O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"]} testid="hr-emp-bg" /></Field>
              <Field label="Marital Status"><Select value={form.marital_status} onChange={(v) => set("marital_status", v)} options={["", "Single", "Married", "Divorced", "Widowed"]} testid="hr-emp-marital" /></Field>
              <Field label="Father's Name"><Input value={form.father_name} onChange={(e) => set("father_name", e.target.value)} data-testid="hr-emp-father" /></Field>
              <Field label="Mother's Name"><Input value={form.mother_name} onChange={(e) => set("mother_name", e.target.value)} data-testid="hr-emp-mother" /></Field>
              <Field label="Notes" className="sm:col-span-3"><textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} className="h-20 w-full rounded-md border border-slate-200 p-2 text-sm" data-testid="hr-emp-notes" /></Field>
            </div>
          )}
          {tab === "employment" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Employee Code"><Input value={form.employee_code} onChange={(e) => set("employee_code", e.target.value)} placeholder="Auto-generated" data-testid="hr-emp-code" /></Field>
              <Field label="Department *"><Select value={form.department} onChange={(v) => set("department", v)} options={["", ...meta.departments]} testid="hr-emp-dept" uppercase /></Field>
              <Field label="Designation *"><Select value={form.designation} onChange={(v) => set("designation", v)} options={designationOptions} testid="hr-emp-designation" uppercase /></Field>
              <Field label="Joining Date"><MilkDateInput centered title="Joining Date" value={form.joining_date} onChange={(e) => set("joining_date", e.target.value)} data-testid="hr-emp-joining" /></Field>
              <Field label="Reporting To"><Input value={form.reporting_to} onChange={(e) => set("reporting_to", e.target.value)} data-testid="hr-emp-reporting" /></Field>
              <Field label="Status"><Select value={form.status} onChange={(v) => set("status", v)} options={["active", "left", "on_leave"]} testid="hr-emp-status" /></Field>
            </div>
          )}
          {tab === "id_docs" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="PAN"><Input value={form.pan} onChange={(e) => set("pan", e.target.value)} data-testid="hr-emp-pan" /></Field>
              <Field label="Aadhar"><Input value={form.aadhar} onChange={(e) => set("aadhar", e.target.value)} data-testid="hr-emp-aadhar" /></Field>
            </div>
          )}
          {tab === "address" && (
            <div className="grid gap-3">
              <Field label="Address"><textarea value={form.address} onChange={(e) => set("address", e.target.value)} className="h-20 w-full rounded-md border border-slate-200 p-2 text-sm" data-testid="hr-emp-address" /></Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Emergency Contact Name"><Input value={form.emergency_contact_name} onChange={(e) => set("emergency_contact_name", e.target.value)} data-testid="hr-emp-ec-name" /></Field>
                <Field label="Emergency Contact Phone"><Input value={form.emergency_contact_phone} onChange={(e) => set("emergency_contact_phone", e.target.value)} data-testid="hr-emp-ec-phone" /></Field>
              </div>
            </div>
          )}
          {tab === "salary" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Net Salary (₹)"><Input type="number" value={form.net_salary} onChange={(e) => set("net_salary", e.target.value)} data-testid="hr-emp-net" /></Field>
              <Field label="Gross Salary (₹)"><Input type="number" value={form.gross_salary} onChange={(e) => set("gross_salary", e.target.value)} data-testid="hr-emp-gross" /></Field>
              <Field label="Bank Name"><Input value={form.bank_name} onChange={(e) => set("bank_name", e.target.value)} data-testid="hr-emp-bank" /></Field>
              <Field label="Account Number"><Input value={form.bank_account} onChange={(e) => set("bank_account", e.target.value)} data-testid="hr-emp-account" /></Field>
              <Field label="IFSC"><Input value={form.ifsc} onChange={(e) => set("ifsc", e.target.value)} data-testid="hr-emp-ifsc" /></Field>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <Button variant="outline" onClick={onClose} data-testid="hr-emp-modal-cancel">Cancel</Button>
          <Button onClick={submit} className="bg-orange-500 hover:bg-orange-600" data-testid="hr-emp-modal-submit">✓ {employee ? "Save" : "Add Employee"}</Button>
        </div>
      </div>
    </div>
  );
};

// ---------- Roles & Credentials ----------

const ROLE_META = {
  super_admin: { label: "SUPER ADMIN", classes: "border-purple-300 bg-purple-50 text-purple-700" },
  business_dev: { label: "BUSINESS DEV", classes: "border-indigo-300 bg-indigo-50 text-indigo-700" },
  pre_sales: { label: "PRE SALES", classes: "border-sky-300 bg-sky-50 text-sky-700" },
  // The Branch Admin family shares emerald, and the online arm shares teal, on purpose:
  // the hue says which kind of role this is and the label says which practice it runs.
  // Handing each of the six its own colour would spend the whole palette on one job and
  // leave the list looking like six unrelated roles rather than two groups of one.
  branch_admin: { label: "BRANCH ADMIN", classes: "border-emerald-300 bg-emerald-50 text-emerald-700" },
  branch_admin_physio: { label: "BRANCH ADMIN ( PHYSIO )", classes: "border-emerald-300 bg-emerald-50 text-emerald-700" },
  branch_admin_fitness: { label: "BRANCH ADMIN ( FITNESS )", classes: "border-emerald-300 bg-emerald-50 text-emerald-700" },
  branch_admin_physio_fitness: { label: "BRANCH ADMIN ( PHYSIO & FITNESS )", classes: "border-emerald-300 bg-emerald-50 text-emerald-700" },
  online_physio_admin: { label: "ONLINE PHYSIO ADMIN", classes: "border-teal-300 bg-teal-50 text-teal-700" },
  online_fitness_admin: { label: "ONLINE FITNESS ADMIN", classes: "border-teal-300 bg-teal-50 text-teal-700" },
  head_physio: { label: "CONSULTANT", classes: "border-amber-300 bg-amber-50 text-amber-700" },
  physio: { label: "PHYSIO", classes: "border-cyan-300 bg-cyan-50 text-cyan-700" },
  // Blue against Physio's cyan is the same shift the family above makes from emerald to
  // teal: the base hue says which kind of role this is, and the neighbouring one says it
  // is the online arm of it.
  online_physio: { label: "ONLINE PHYSIO", classes: "border-blue-300 bg-blue-50 text-blue-700" },
  marketing_head: { label: "MARKETING HEAD", classes: "border-pink-300 bg-pink-50 text-pink-700" },
  accountant: { label: "ACCOUNTANT", classes: "border-orange-300 bg-orange-50 text-orange-700" },
};
// The same hues the built-ins wear, so a role added at runtime looks native rather than
// like a bolt-on. Written as literal class strings because Tailwind reads the source for
// class names — a template built from the colour key would compile to nothing.
const ROLE_SWATCHES = {
  purple: { classes: "border-purple-300 bg-purple-50 text-purple-700", dot: "bg-purple-500" },
  indigo: { classes: "border-indigo-300 bg-indigo-50 text-indigo-700", dot: "bg-indigo-500" },
  sky: { classes: "border-sky-300 bg-sky-50 text-sky-700", dot: "bg-sky-500" },
  emerald: { classes: "border-emerald-300 bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  amber: { classes: "border-amber-300 bg-amber-50 text-amber-700", dot: "bg-amber-500" },
  cyan: { classes: "border-cyan-300 bg-cyan-50 text-cyan-700", dot: "bg-cyan-500" },
  pink: { classes: "border-pink-300 bg-pink-50 text-pink-700", dot: "bg-pink-500" },
  orange: { classes: "border-orange-300 bg-orange-50 text-orange-700", dot: "bg-orange-500" },
  rose: { classes: "border-rose-300 bg-rose-50 text-rose-700", dot: "bg-rose-500" },
  teal: { classes: "border-teal-300 bg-teal-50 text-teal-700", dot: "bg-teal-500" },
  slate: { classes: "border-slate-300 bg-slate-100 text-slate-700", dot: "bg-slate-500" },
};

// Colours for roles added at runtime. Module-level because roleClasses is called from
// half a dozen places that have no reason to thread meta through, and there is exactly one
// role list per install. Refilled whenever meta loads, so a colour set on one screen shows
// up on the others without a reload.
const CUSTOM_ROLE_CLASSES = new Map();
const setCustomRoleClasses = (customRoles) => {
  CUSTOM_ROLE_CLASSES.clear();
  (customRoles || []).forEach((r) => {
    const swatch = ROLE_SWATCHES[r.color];
    if (r.name && swatch) CUSTOM_ROLE_CLASSES.set(r.name, swatch.classes);
  });
};

const roleLabel = (role) => ROLE_META[role]?.label || role.replace(/_/g, " ").toUpperCase();
const roleClasses = (role) =>
  ROLE_META[role]?.classes || CUSTOM_ROLE_CLASSES.get(role) || "border-slate-200 bg-white text-slate-600";

/**
 * Which branch an account belongs to.
 *
 * Three answers are possible and they are not interchangeable, so none of them is
 * flattened into the same text:
 *
 *   All branches   a Head Physio covers every one and holds no branch of their own. Their
 *                  empty branch list means "all", and printing "—" for it would read as
 *                  the opposite of the truth.
 *   several        a Physio or Nutrition Coach can serve more than one. The first is
 *                  named and the rest counted, with all of them in the tooltip — a column
 *                  this narrow cannot list four branch names without pushing Actions off.
 *   one, or none   the name, or a dash for an account genuinely not attached to a branch.
 */
const UserBranch = ({ user }) => {
  const branches = user.branches || [];

  if (user.org_wide) {
    return <span className="rounded bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700">All branches</span>;
  }
  if (branches.length === 0) return <span className="text-xs text-slate-400">—</span>;

  return (
    <span className="text-xs text-slate-700" title={branches.map((b) => b.name).join(", ")}>
      {branches[0].name}
      {branches.length > 1 && (
        <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
          +{branches.length - 1}
        </span>
      )}
    </span>
  );
};

// Native <select> can't reliably color individual dropdown-list items across
// browsers — only the closed box. This renders each role as its own colored,
// rounded row in a custom open list instead.
const RoleFilterDropdown = ({ value, options, onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const currentClasses = value === "all" ? "border-slate-200 bg-white text-slate-700" : roleClasses(value);
  const currentLabel = value === "all" ? "ALL" : roleLabel(value);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex h-10 items-center gap-2 rounded-md border px-3 text-sm font-semibold ${currentClasses}`}
        data-testid="hr-roles-role-filter"
      >
        {currentLabel}
        <ChevronDown className="h-3.5 w-3.5 opacity-60" />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 min-w-[170px] space-y-1 rounded-md border border-slate-200 bg-white p-1.5 shadow-lg" data-testid="hr-roles-role-filter-list">
          <button
            type="button"
            onClick={() => { onChange("all"); setOpen(false); }}
            className="block w-full rounded-md border border-slate-200 bg-white px-3 py-1.5 text-left text-xs font-semibold text-slate-700"
            data-testid="hr-roles-role-filter-option-all"
          >
            ALL
          </button>
          {options.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => { onChange(r); setOpen(false); }}
              className={`block w-full rounded-md border px-3 py-1.5 text-left text-xs font-semibold ${roleClasses(r)}`}
              data-testid={`hr-roles-role-filter-option-${r}`}
            >
              {roleLabel(r)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * Add a role on its own, without starting a user you may not want.
 *
 * The role list already on screen is shown underneath, because the commonest mistake here
 * is adding a second role that means the same as one that exists — "Nutrition Coach"
 * beside "Diet Manage" — and the only thing that prevents it is being able to see what is
 * already there while typing.
 */
const CreateRoleModal = ({ meta, reloadMeta, onClose }) => {
  const [label, setLabel] = useState("");
  const [color, setColor] = useState("sky");
  const [saving, setSaving] = useState(false);
  // Which hues are already spoken for, across built-ins and custom roles alike. Shown
  // rather than blocked: two roles may reasonably share a colour, but picking one that
  // clashes with an existing role by accident is the thing worth warning about.
  const usedColors = useMemo(() => {
    const used = new Set();
    Object.values(ROLE_META).forEach((m) => {
      const hit = Object.entries(ROLE_SWATCHES).find(([, s]) => s.classes === m.classes);
      if (hit) used.add(hit[0]);
    });
    (meta.custom_roles || []).forEach((r) => { if (r.color) used.add(r.color); });
    return used;
  }, [meta.custom_roles]);
  // meta.roles is a list of slugs ("head_physio"), not objects — the custom_roles list is
  // where the labels and colours live.
  const existing = meta.roles || [];
  // Compared on letters alone, so "Head Physio", "head_physio" and "HEAD PHYSIO" are all
  // recognised as the role that already exists.
  const key = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const duplicate = !!label.trim() && existing.some((r) => key(typeof r === "string" ? r : r.name) === key(label));

  const submit = async () => {
    if (!label.trim()) { toast.error("Enter a role name"); return; }
    if (duplicate) { toast.error("That role already exists"); return; }
    setSaving(true);
    try {
      const created = await hrAddCustomRole(label.trim(), color);
      toast.success(`Role "${created.label || label.trim()}" added`);
      await reloadMeta?.();
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to add role");
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} data-testid="hr-create-role-modal">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Create Role</h3>
            <p className="text-xs text-slate-500">Adds a role that can then be given to a user.</p>
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>

        <Input
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !duplicate) submit(); }}
          placeholder="e.g. Nutritionist"
          data-testid="hr-create-role-input"
        />
        {duplicate && <p className="mt-1.5 text-xs font-semibold text-red-500" data-testid="hr-create-role-duplicate">That role already exists.</p>}

        <div className="mt-4">
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">Colour</p>
          <div className="flex flex-wrap gap-1.5" data-testid="hr-create-role-colors">
            {Object.entries(ROLE_SWATCHES).map(([key, s]) => {
              const picked = color === key;
              const taken = usedColors.has(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setColor(key)}
                  title={taken ? `${key} — already used by another role` : key}
                  className={`relative h-8 w-8 rounded-full border-2 transition ${s.dot} ${
                    picked ? "border-slate-800 ring-2 ring-slate-300" : "border-white hover:border-slate-300"
                  }`}
                  data-testid={`hr-create-role-color-${key}`}
                >
                  {/* A used hue is dimmed, not disabled — two roles sharing a colour is
                      allowed, walking into the clash unaware is what isn't. */}
                  {taken && !picked && <span className="absolute inset-0 rounded-full bg-white/45" />}
                </button>
              );
            })}
          </div>
          {/* The badge as it will actually appear in the table, so the choice is judged on
              the thing being made rather than on a swatch. */}
          <div className="mt-3 flex items-center gap-2">
            <span className="text-[11px] text-slate-400">Preview</span>
            <span className={`rounded border px-2 py-1 text-xs font-semibold ${ROLE_SWATCHES[color].classes}`} data-testid="hr-create-role-preview">
              {(label.trim() || "New Role").toUpperCase()}
            </span>
            {usedColors.has(color) && <span className="text-[11px] text-amber-600">Colour already in use</span>}
          </div>
        </div>

        {existing.length > 0 && (
          <div className="mt-4">
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">Roles that already exist</p>
            {/* In their own colours, so the list doubles as what is already taken — the
                point of showing it is to be compared against, and grey chips would hide
                the very clash the picker above is trying to avoid. */}
            <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
              {existing.map((r) => {
                const name = typeof r === "string" ? r : (r.name || "");
                return (
                  <span key={name} className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold ${roleClasses(name)}`}>
                    {roleLabel(name)}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-5 flex gap-2">
          <Button variant="outline" onClick={onClose} className="flex-1" data-testid="hr-create-role-cancel">Cancel</Button>
          <Button onClick={submit} disabled={saving || !label.trim() || duplicate} className="flex-1 bg-sky-600 hover:bg-sky-700" data-testid="hr-create-role-submit">
            {saving ? "Adding..." : "Add Role"}
          </Button>
        </div>
      </div>
    </div>
  );
};

// ---------- Departments & Designation ----------

const DepartmentsTab = ({ meta, reloadMeta }) => {
  const [depts, setDepts] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(false);
  const [newDeptName, setNewDeptName] = useState("");
  const [addingDept, setAddingDept] = useState(false);
  const [managing, setManaging] = useState(null); // department being edited in the modal
  const [viewingDesignation, setViewingDesignation] = useState(null); // designation label, or null

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, e] = await Promise.all([hrDepartments(), hrEmployees({})]);
      setDepts(d);
      setEmployees(e);
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed to load departments"); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Every designation an employee could be given: the role list (same source the Add
  // Employee form falls back to) plus any designation only found on an employee record
  // (e.g. typed before this list existed), so the picker never hides one still in use.
  const allDesignations = useMemo(() => {
    const fromRoles = (meta?.roles || []).map(roleLabel);
    const fromEmployees = employees.map((e) => e.designation).filter(Boolean);
    return [...new Set([...fromRoles, ...fromEmployees])].sort((a, b) => a.localeCompare(b));
  }, [meta?.roles, employees]);

  const designationCounts = useMemo(() => {
    const counts = {};
    employees.forEach((e) => { if (e.designation) counts[e.designation] = (counts[e.designation] || 0) + 1; });
    return counts;
  }, [employees]);

  const addDepartment = async () => {
    const name = newDeptName.trim();
    if (!name) return;
    setAddingDept(true);
    try {
      await hrCreateDepartment(name);
      setNewDeptName("");
      toast.success(`${name} added`);
      load();
      reloadMeta();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed to add department"); }
    setAddingDept(false);
  };

  const removeDepartment = async (d) => {
    if (!window.confirm(`Delete "${d.name}"? Employees already in this department keep it as text.`)) return;
    try { await hrDeleteDepartment(d.id); load(); reloadMeta(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Failed to delete department"); }
  };

  // Opens on top of the designations checklist rather than navigating away — the
  // checklist's in-progress picks would otherwise be lost.
  const viewEmployees = (label) => setViewingDesignation(label);

  return (
    <div className="space-y-4" data-testid="hr-departments-tab">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="New department name..."
          value={newDeptName}
          onChange={(e) => setNewDeptName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") addDepartment(); }}
          className="w-full sm:w-64"
          data-testid="hr-dept-add-input"
        />
        <Button onClick={addDepartment} disabled={addingDept || !newDeptName.trim()} className="w-full bg-orange-500 hover:bg-orange-600 sm:w-auto" data-testid="hr-dept-add-btn">
          <Plus className="mr-1 h-4 w-4" />Add Department
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="hr-dept-cards">
        {depts.map((d) => (
          <Card key={d.id} className="min-w-0" data-testid={`hr-dept-card-${d.id}`}>
            <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
              <div className="min-w-0">
                <CardTitle className="truncate text-base">{d.name}</CardTitle>
                <p className="text-xs text-slate-500">{d.employee_count} employee{d.employee_count === 1 ? "" : "s"}</p>
              </div>
              <button onClick={() => removeDepartment(d)} className="shrink-0 text-slate-400 hover:text-red-500" data-testid={`hr-dept-delete-${d.id}`} title="Delete department">
                <Trash2 className="h-4 w-4" />
              </button>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {(d.designations || []).length === 0 && <p className="text-xs text-slate-400">No designations yet.</p>}
                {(d.designations || []).map((desig) => (
                  <span key={desig} className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2.5 py-1 text-xs font-medium text-orange-700" data-testid={`hr-dept-designation-${d.id}-${desig}`}>
                    {desig}
                    {designationCounts[desig] > 0 && <span className="text-orange-400">· {designationCounts[desig]}</span>}
                  </span>
                ))}
              </div>
              <Button size="sm" variant="outline" onClick={() => setManaging(d)} className="w-full" data-testid={`hr-dept-manage-${d.id}`}>
                Manage Designations
              </Button>
            </CardContent>
          </Card>
        ))}
        {!loading && depts.length === 0 && <p className="col-span-full text-sm text-slate-400">No departments yet. Add one above.</p>}
      </div>

      {managing && (
        <DepartmentDesignationsModal
          department={managing}
          allDepartments={depts}
          allDesignations={allDesignations}
          designationCounts={designationCounts}
          onClose={() => setManaging(null)}
          onViewEmployees={viewEmployees}
          onSaved={() => { setManaging(null); load(); reloadMeta(); }}
        />
      )}

      {viewingDesignation && (
        <DesignationEmployeesModal
          designation={viewingDesignation}
          employees={employees.filter((e) => e.designation === viewingDesignation)}
          departmentNames={depts.map((d) => d.name)}
          onClose={() => setViewingDesignation(null)}
          onChanged={() => { load(); reloadMeta(); }}
        />
      )}
    </div>
  );
};

// A designation belongs to exactly one department — this modal is the one place that's
// enforced. Options already grouped under a different department are disabled here as a
// UI-level guard; the backend re-checks it too on save, since that's the boundary that
// actually matters.
const DepartmentDesignationsModal = ({ department, allDepartments, allDesignations, designationCounts, onClose, onViewEmployees, onSaved }) => {
  const [selected, setSelected] = useState(() => new Set(department.designations || []));
  const [saving, setSaving] = useState(false);

  const claimedElsewhere = useMemo(() => {
    const set = new Set();
    allDepartments.forEach((d) => {
      if (d.id === department.id) return;
      (d.designations || []).forEach((desig) => set.add(desig));
    });
    return set;
  }, [allDepartments, department.id]);

  const toggle = (label) => {
    if (claimedElsewhere.has(label)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label); else next.add(label);
      return next;
    });
  };

  const save = async () => {
    const before = new Set(department.designations || []);
    const toAdd = [...selected].filter((l) => !before.has(l));
    const toRemove = [...before].filter((l) => !selected.has(l));
    setSaving(true);
    try {
      for (const label of toAdd) await hrAddDesignation(department.id, label);
      for (const label of toRemove) await hrDeleteDesignation(department.id, label);
      toast.success(`${department.name} updated`);
      onSaved();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed to save"); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" data-testid="hr-dept-manage-modal">
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <h3 className="text-base font-semibold">{department.name} — Designations</h3>
            <p className="text-xs text-slate-500">Pick which designations belong to this department.</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" data-testid="hr-dept-manage-close"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto p-3">
          {allDesignations.map((label) => {
            const disabled = claimedElsewhere.has(label);
            const checked = selected.has(label);
            const count = designationCounts[label] || 0;
            return (
              <div
                key={label}
                className={`flex items-center gap-3 rounded-md px-2 py-2 ${disabled ? "opacity-50" : "hover:bg-slate-50"}`}
                data-testid={`hr-dept-designation-row-${label}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => toggle(label)}
                  className="h-4 w-4 shrink-0"
                  data-testid={`hr-dept-designation-checkbox-${label}`}
                />
                <span className="min-w-0 flex-1 truncate text-sm text-slate-800">{label}</span>
                {disabled && <span className="shrink-0 text-[10px] text-slate-400">In another department</span>}
                <span className="shrink-0 text-xs text-slate-500">{count} employee{count === 1 ? "" : "s"}</span>
                {count > 0 && (
                  <button
                    type="button"
                    onClick={() => onViewEmployees(label)}
                    className="shrink-0 text-xs font-medium text-sky-600 hover:text-sky-700"
                    data-testid={`hr-dept-designation-view-${label}`}
                  >
                    View
                  </button>
                )}
              </div>
            );
          })}
          {allDesignations.length === 0 && <p className="px-2 py-6 text-center text-sm text-slate-400">No designations exist yet.</p>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <Button variant="outline" onClick={onClose} data-testid="hr-dept-manage-cancel">Cancel</Button>
          <Button onClick={save} disabled={saving} className="bg-orange-500 hover:bg-orange-600" data-testid="hr-dept-manage-save">
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
};

// Row-based list of every employee holding one designation, opened from the
// designations checklist. Department is editable right here — reassigning someone out
// of a department they're incorrectly parked in is the main reason to open this list.
const DesignationEmployeesModal = ({ designation, employees, departmentNames, onClose, onChanged }) => {
  const [savingId, setSavingId] = useState(null);

  const changeDepartment = async (emp, department) => {
    if (department === (emp.department || "")) return;
    setSavingId(emp.id);
    try {
      await hrUpdateEmployee(emp.id, { department });
      toast.success(`${emp.full_name} moved to ${department}`);
      onChanged();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed to update"); }
    setSavingId(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-testid="hr-designation-employees-modal">
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <h3 className="text-base font-semibold">{designation}</h3>
            <p className="text-xs text-slate-500">{employees.length} employee{employees.length === 1 ? "" : "s"}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" data-testid="hr-designation-employees-close"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          {employees.map((e) => (
            <div key={e.id} className="flex flex-wrap items-center gap-3 rounded-md border border-slate-100 px-3 py-2" data-testid={`hr-designation-employee-row-${e.id}`}>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orange-100 text-xs font-bold text-orange-700">
                {(e.full_name || "?").charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800">{e.full_name}</p>
                <p className="truncate text-xs text-slate-500">{e.employee_code}{e.email ? ` · ${e.email}` : ""}{e.phone ? ` · ${e.phone}` : ""}</p>
              </div>
              <select
                value={e.department || ""}
                disabled={savingId === e.id}
                onChange={(ev) => changeDepartment(e, ev.target.value)}
                className="h-8 shrink-0 rounded-md border border-slate-200 px-2 text-xs"
                data-testid={`hr-designation-employee-dept-${e.id}`}
              >
                <option value="">— Unassigned —</option>
                {departmentNames.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          ))}
          {employees.length === 0 && <p className="px-2 py-6 text-center text-sm text-slate-400">No employees hold this designation.</p>}
        </div>
        <div className="flex items-center justify-end border-t border-slate-200 px-5 py-3">
          <Button variant="outline" onClick={onClose} data-testid="hr-designation-employees-done">Done</Button>
        </div>
      </div>
    </div>
  );
};

const RolesTab = ({ meta, reloadMeta }) => {
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [sortAZ, setSortAZ] = useState(null); // null = as-loaded | "asc" | "desc"
  const [showCreate, setShowCreate] = useState(false);
  const [showCreateRole, setShowCreateRole] = useState(false);
  const [actionTarget, setActionTarget] = useState(null);

  const load = useCallback(() => hrUsers({ search, role: roleFilter !== "all" ? roleFilter : undefined }).then(setUsers).catch((e) => console.warn("[load failed]", e?.message || e)), [search, roleFilter]);
  useEffect(() => { load(); }, [load]);

  const sortedUsers = sortAZ
    ? [...users].sort((a, b) => (a.full_name || "").localeCompare(b.full_name || "") * (sortAZ === "asc" ? 1 : -1))
    : users;

  const changeRole = async (u, role) => {
    try { await hrUpdateUserRole(u.id, role); toast.success("Role updated"); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  // flex+gap, not space-y — the mobile-only toolbar/cards and the desktop table are
  // each hidden by class depending on breakpoint, not the hidden attribute.
  return (
    <div className="flex flex-col gap-4" data-testid="hr-roles-tab">
      <div className="flex flex-wrap items-center gap-2 md:hidden">
        <button
          onClick={() => setSortAZ((s) => (s === "asc" ? "desc" : "asc"))}
          className={`rounded-md px-3 py-2 text-sm font-medium ${sortAZ ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-600"}`}
          data-testid="hr-roles-sort-az-mobile"
        >
          {sortAZ === "desc" ? "Z → A" : "A → Z"}
        </button>
        <RoleFilterDropdown value={roleFilter} options={meta.roles} onChange={setRoleFilter} />
        <Input placeholder="Search name or email..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full" data-testid="hr-roles-search-mobile" />
        <Button variant="outline" onClick={() => setShowCreateRole(true)} className="flex-1" data-testid="hr-roles-create-role-btn-mobile"><ShieldCheck className="mr-1 h-4 w-4" />Create Role</Button>
        <Button onClick={() => setShowCreate(true)} className="flex-1 bg-sky-600 hover:bg-sky-700" data-testid="hr-roles-create-btn-mobile"><UserPlus className="h-4 w-4 mr-1" />Create User</Button>
      </div>

      <div className="space-y-2 md:hidden" data-testid="hr-user-cards">
        {sortedUsers.map((u) => (
          <div key={u.id} className="rounded-xl border border-slate-200 bg-white p-3" data-testid={`hr-user-card-${u.id}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-800">{u.full_name}</p>
                <p className="truncate text-xs text-slate-500">{u.email}</p>
              </div>
              <button
                onClick={() => setActionTarget(u)}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600"
                aria-label={`Actions for ${u.full_name}`}
                data-testid={`hr-user-card-actions-${u.id}`}
              >
                <MoreVertical className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select
                value={u.role}
                onChange={(e) => changeRole(u, e.target.value)}
                className={`h-7 rounded border px-2 text-xs font-semibold ${roleClasses(u.role)}`}
                data-testid={`hr-user-card-role-${u.id}`}
              >
                {meta.roles.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
              </select>
              <span className={`rounded px-2 py-0.5 text-xs ${u.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>{u.is_active ? "Active" : "Inactive"}</span>
            </div>
            {u.linked_employee && (
              <p className="mt-1.5 text-xs text-emerald-600">{u.linked_employee.employee_code} - {u.linked_employee.designation || u.linked_employee.full_name}</p>
            )}
          </div>
        ))}
        {sortedUsers.length === 0 && <p className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">No users.</p>}
      </div>

      <Card className="hidden md:block">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">User Roles & Credentials</CardTitle>
          <div className="flex gap-2">
            <button
              onClick={() => setSortAZ((s) => (s === "asc" ? "desc" : "asc"))}
              className={`rounded-md px-3 py-2 text-sm font-medium ${sortAZ ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-600"}`}
              data-testid="hr-roles-sort-az"
            >
              {sortAZ === "desc" ? "Z → A" : "A → Z"}
            </button>
            <Input placeholder="Search name or email..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" data-testid="hr-roles-search" />
            <RoleFilterDropdown value={roleFilter} options={meta.roles} onChange={setRoleFilter} />
            {/* Roles could only be added from inside the Create User form, so adding one
                meant starting a user you might not want. Outlined rather than filled:
                creating a user is the everyday action on this screen, adding a role is
                occasional, and two solid buttons side by side would say otherwise. */}
            <Button variant="outline" onClick={() => setShowCreateRole(true)} data-testid="hr-roles-create-role-btn"><ShieldCheck className="mr-1 h-4 w-4" />Create Role</Button>
            <Button onClick={() => setShowCreate(true)} className="bg-sky-600 hover:bg-sky-700" data-testid="hr-roles-create-btn"><UserPlus className="h-4 w-4 mr-1" />Create User</Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">S.No</th><th className="px-3 py-2">User</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">Role</th><th className="px-3 py-2">Linked Employee</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Branch</th><th className="px-3 py-2">Actions</th></tr></thead>
              <tbody>
                {sortedUsers.map((u, i) => (
                  <tr key={u.id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`hr-user-row-${u.id}`}>
                    <td className="px-3 py-2 text-slate-500">{i + 1}</td>
                    <td className="px-3 py-2 font-medium text-slate-800">{u.full_name}</td>
                    <td className="px-3 py-2 text-slate-600">{u.email}</td>
                    <td className="px-3 py-2">
                      <select
                        value={u.role}
                        onChange={(e) => changeRole(u, e.target.value)}
                        className={`h-7 rounded border px-2 text-xs font-semibold ${roleClasses(u.role)}`}
                        data-testid={`hr-user-role-${u.id}`}
                      >
                        {meta.roles.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-xs text-emerald-600">{u.linked_employee ? `${u.linked_employee.employee_code} - ${u.linked_employee.designation || u.linked_employee.full_name}` : "—"}</td>
                    <td className="px-3 py-2"><span className={`rounded px-2 py-0.5 text-xs ${u.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>{u.is_active ? "Active" : "Inactive"}</span></td>
                    <td className="px-3 py-2"><UserBranch user={u} /></td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => setActionTarget(u)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                        aria-label={`Actions for ${u.full_name}`}
                        data-testid={`hr-user-actions-${u.id}`}
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {sortedUsers.length === 0 && <tr><td colSpan="8" className="px-3 py-6 text-center text-slate-400">No users.</td></tr>}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {showCreate && <CreateUserModal meta={meta} reloadMeta={reloadMeta} onClose={() => setShowCreate(false)} onSaved={() => { setShowCreate(false); load(); }} />}
      {showCreateRole && <CreateRoleModal meta={meta} reloadMeta={reloadMeta} onClose={() => setShowCreateRole(false)} />}

      {actionTarget && (
        <UserActionsModal
          user={actionTarget}
          onClose={() => setActionTarget(null)}
          onDone={() => { setActionTarget(null); load(); }}
        />
      )}
    </div>
  );
};

const UserActionsModal = ({ user, onClose, onDone }) => {
  const [mode, setMode] = useState(null); // null | "edit" | "password" | "delete"
  const [pwd, setPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [busy, setBusy] = useState(false);
  const [branches, setBranches] = useState([]);
  const [employees, setEmployees] = useState([]);
  const roleLabelForMulti = MULTI_BRANCH_ROLE_LABELS[user.role];
  const isMultiBranchRole = Boolean(roleLabelForMulti);
  const isOrgWideRole = ORG_WIDE_ROLES.has(user.role);
  const [editForm, setEditForm] = useState({
    full_name: user.full_name || "",
    email: user.email || "",
    branch_id: user.branch_id || "",
    branch_ids: user.branch_ids && user.branch_ids.length ? user.branch_ids : (user.branch_id ? [user.branch_id] : []),
    employee_id: user.employee_id || "",
    mobile_number: user.mobile_number || "",
    aadhar_number: user.aadhar_number || "",
  });

  useEffect(() => {
    if (mode !== "edit") return;
    getBranches().then(setBranches).catch(() => {});
    hrEmployees({ status: "active" }).then(setEmployees).catch(() => {});
  }, [mode]);

  const submitEdit = async () => {
    if (!editForm.full_name.trim() || !editForm.email.trim()) { toast.error("Name and email are required"); return; }
    if (isMultiBranchRole && editForm.branch_ids.length === 0) { toast.error("Select at least one branch"); return; }
    // Head Physios are org-wide; sending a branch would pin them to one.
    try {
      setBusy(true);
      // branch_ids only applies (and is only sent) for Head Physio/Physio — every other
      // role keeps its single `branch_id` select untouched by the multi-branch field.
      const { branch_ids, branch_id, ...rest } = editForm;
      const payload = isOrgWideRole ? { ...rest, branch_ids: [] } : isMultiBranchRole ? { ...rest, branch_ids } : { ...rest, branch_id };
      await hrUpdateUser(user.id, payload);
      toast.success(`${editForm.full_name} updated`);
      onDone();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed to update user"); }
    finally { setBusy(false); }
  };

  const submitPwd = async () => {
    if (pwd.length < 6) { toast.error("Password must be at least 6 characters"); return; }
    if (pwd !== confirmPwd) { toast.error("Passwords do not match"); return; }
    try {
      setBusy(true);
      await hrResetPassword(user.id, pwd);
      toast.success(`Password updated for ${user.full_name}`);
      onDone();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed to update password"); }
    finally { setBusy(false); }
  };

  const doActivate = async () => {
    try { setBusy(true); await hrActivateUser(user.id); toast.success(`${user.full_name} activated`); onDone(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
    finally { setBusy(false); }
  };

  const doDeactivate = async () => {
    try { setBusy(true); await hrDeactivateUser(user.id); toast.success(`${user.full_name} deactivated`); onDone(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
    finally { setBusy(false); }
  };

  const doDelete = async () => {
    try {
      setBusy(true);
      await hrDeleteUserPermanent(user.id);
      toast.success(`${user.full_name} permanently deleted`);
      onDone();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed to delete"); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" data-testid="hr-user-actions-modal">
      <div className="w-full max-w-md space-y-4 rounded-xl bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-800" data-testid="hr-actions-title">Actions — {user.full_name}</h3>
            <p className="text-xs text-slate-500">{user.email} · <span className={user.is_active ? "text-emerald-600" : "text-slate-500"}>{user.is_active ? "Active" : "Inactive"}</span></p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100" data-testid="hr-actions-close"><X className="h-4 w-4" /></button>
        </div>

        {!mode && (
          <div className="grid gap-2">
            <button
              onClick={() => setMode("edit")}
              className="flex items-center gap-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-left hover:bg-sky-100"
              data-testid="hr-actions-edit"
            >
              <Pencil className="h-4 w-4 text-sky-600" />
              <div>
                <p className="text-sm font-semibold text-sky-700">Edit</p>
                <p className="text-[11px] text-sky-600">Update this user's details.</p>
              </div>
            </button>

            <button
              onClick={() => setMode("password")}
              className="flex items-center gap-3 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2.5 text-left hover:bg-orange-100"
              data-testid="hr-actions-change-password"
            >
              <KeyRound className="h-4 w-4 text-orange-600" />
              <div>
                <p className="text-sm font-semibold text-orange-700">Change Password</p>
                <p className="text-[11px] text-orange-600">Set a new password for this user.</p>
              </div>
            </button>

            {user.is_active ? (
              <button
                onClick={doDeactivate}
                disabled={busy}
                className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-left hover:bg-slate-100 disabled:opacity-60"
                data-testid="hr-actions-deactivate"
              >
                <XCircle className="h-4 w-4 text-slate-600" />
                <div>
                  <p className="text-sm font-semibold text-slate-700">Deactivate</p>
                  <p className="text-[11px] text-slate-500">User keeps their data but can no longer log in.</p>
                </div>
              </button>
            ) : (
              <button
                onClick={doActivate}
                disabled={busy}
                className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-left hover:bg-emerald-100 disabled:opacity-60"
                data-testid="hr-actions-activate"
              >
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <div>
                  <p className="text-sm font-semibold text-emerald-700">Activate</p>
                  <p className="text-[11px] text-emerald-600">Restore login access for this user.</p>
                </div>
              </button>
            )}

            <button
              onClick={() => setMode("delete")}
              className="flex items-center gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-left hover:bg-rose-100"
              data-testid="hr-actions-delete"
            >
              <AlertOctagon className="h-4 w-4 text-rose-600" />
              <div>
                <p className="text-sm font-semibold text-rose-700">Permanently Delete</p>
                <p className="text-[11px] text-rose-600">Cannot be undone — user record is removed completely.</p>
              </div>
            </button>
          </div>
        )}

        {mode === "edit" && (
          <div className="space-y-3" data-testid="hr-actions-edit-form">
            <Field label="Name"><Input placeholder="Full name" value={editForm.full_name} onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })} data-testid="hr-actions-edit-name" /></Field>
            <Field label="Email"><Input placeholder="user@company.com" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} data-testid="hr-actions-edit-email" /></Field>
            {isOrgWideRole ? (
              <Field label="Branches">
                <p className="rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-medium text-teal-700" data-testid="hr-org-wide-branch-note">
                  CONSULTANTS cover every branch — no branch selection needed.
                </p>
              </Field>
            ) : isMultiBranchRole ? (
              <Field label={`Branches (${roleLabelForMulti} can cover more than one)`}>
                <div className="space-y-1.5 rounded-md border border-slate-200 p-2" data-testid="hr-actions-edit-branch-ids">
                  {branches.map((b) => {
                    const checked = editForm.branch_ids.includes(b.id);
                    return (
                      <label key={b.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-slate-50">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => setEditForm({
                            ...editForm,
                            branch_ids: e.target.checked
                              ? [...editForm.branch_ids, b.id]
                              : editForm.branch_ids.filter((id) => id !== b.id),
                          })}
                          data-testid={`hr-actions-edit-branch-ids-${b.id}`}
                        />
                        {b.branch_name}
                      </label>
                    );
                  })}
                  {branches.length === 0 && <p className="px-1.5 py-1 text-xs text-slate-400">No branches yet</p>}
                </div>
              </Field>
            ) : (
              <Field label="Branch">
                <select className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" value={editForm.branch_id} onChange={(e) => setEditForm({ ...editForm, branch_id: e.target.value })} data-testid="hr-actions-edit-branch">
                  <option value="">No branch</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.branch_name}</option>)}
                </select>
              </Field>
            )}
            <Field label="Linked Employee">
              <select className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" value={editForm.employee_id} onChange={(e) => setEditForm({ ...editForm, employee_id: e.target.value })} data-testid="hr-actions-edit-employee">
                <option value="">Not linked</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.employee_code} — {e.full_name} ({e.designation || "—"})</option>)}
              </select>
            </Field>
            <Field label="Mobile Number"><Input placeholder="Mobile number" value={editForm.mobile_number} onChange={(e) => setEditForm({ ...editForm, mobile_number: e.target.value })} data-testid="hr-actions-edit-mobile" /></Field>
            <Field label="Aadhar Number"><Input placeholder="Aadhar number" value={editForm.aadhar_number} onChange={(e) => setEditForm({ ...editForm, aadhar_number: e.target.value })} data-testid="hr-actions-edit-aadhar" /></Field>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setMode(null)} className="flex-1" data-testid="hr-actions-edit-back">Back</Button>
              <Button onClick={submitEdit} disabled={busy} className="flex-1 bg-sky-600 hover:bg-sky-700" data-testid="hr-actions-edit-save">Save Changes</Button>
            </div>
          </div>
        )}

        {mode === "password" && (
          <div className="space-y-3" data-testid="hr-actions-password-form">
            <PasswordInput placeholder="New password (min 6)" value={pwd} onChange={(e) => setPwd(e.target.value)} testid="hr-actions-password-new" />
            <PasswordInput placeholder="Confirm new password" value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} testid="hr-actions-password-confirm" />
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { setMode(null); setPwd(""); setConfirmPwd(""); }} className="flex-1" data-testid="hr-actions-password-back">Back</Button>
              <Button onClick={submitPwd} disabled={busy} className="flex-1 bg-orange-500 hover:bg-orange-600" data-testid="hr-actions-password-save">Update Password</Button>
            </div>
          </div>
        )}

        {mode === "delete" && (
          <div className="space-y-3" data-testid="hr-actions-delete-confirm">
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
              <p className="font-semibold">Confirm permanent deletion</p>
              <p className="mt-1">This will delete <b>{user.full_name}</b> ({user.email}) permanently. This action cannot be undone.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setMode(null)} className="flex-1" data-testid="hr-actions-delete-cancel">Cancel</Button>
              <Button onClick={doDelete} disabled={busy} className="flex-1 bg-rose-600 hover:bg-rose-700" data-testid="hr-actions-delete-confirm-btn">Yes, Delete Permanently</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Same idea as RoleFilterDropdown — a native <select>'s open list can't be
// reliably colored per-item, so this renders each role as its own colored,
// rounded row, plus a distinct trailing "+ Add New Role..." row.
const RoleSelectDropdown = ({ value, options, onChange, onAddNew }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const currentClasses = value ? roleClasses(value) : "border-slate-200 bg-white text-slate-700";
  const currentLabel = value ? roleLabel(value) : "Select role";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex h-10 w-full items-center justify-between gap-2 rounded-md border px-3 text-sm font-semibold ${currentClasses}`}
        data-testid="hr-create-user-role"
      >
        {currentLabel}
        <ChevronDown className="h-3.5 w-3.5 opacity-60" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-20 mt-1 max-h-64 space-y-1 overflow-y-auto rounded-md border border-slate-200 bg-white p-1.5 shadow-lg" data-testid="hr-create-user-role-list">
          {options.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => { onChange(r); setOpen(false); }}
              className={`block w-full rounded-md border px-3 py-1.5 text-left text-xs font-semibold ${roleClasses(r)}`}
              data-testid={`hr-create-user-role-option-${r}`}
            >
              {roleLabel(r)}
            </button>
          ))}
          <button
            type="button"
            onClick={() => { onAddNew(); setOpen(false); }}
            className="block w-full rounded-md border border-dashed border-sky-300 bg-sky-50 px-3 py-1.5 text-left text-xs font-semibold text-sky-700"
            data-testid="hr-create-user-role-option-add-new"
          >
            + Add New Role...
          </button>
        </div>
      )}
    </div>
  );
};

// Designation text (e.g. "HEAD PHYSIO") reuses the same role coloring as
// roleClasses/roleLabel by converting it back to a role slug ("head_physio").
const designationSlug = (designation) => (designation || "").trim().toLowerCase().replace(/\s+/g, "_");

const EmployeeSelectDropdown = ({ value, employees, onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const selected = employees.find((e) => e.id === value);
  const currentClasses = selected ? roleClasses(designationSlug(selected.designation)) : "border-slate-200 bg-white text-slate-700";
  const currentLabel = selected ? `${selected.employee_code} — ${selected.full_name} (${selected.designation || "—"})` : "Select employee...";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex h-10 w-full items-center justify-between gap-2 rounded-md border px-3 text-left text-sm font-semibold ${currentClasses}`}
        data-testid="hr-create-user-emp"
      >
        <span className="truncate">{currentLabel}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-20 mt-1 max-h-64 space-y-1 overflow-y-auto rounded-md border border-slate-200 bg-white p-1.5 shadow-lg" data-testid="hr-create-user-emp-list">
          <button
            type="button"
            onClick={() => { onChange(""); setOpen(false); }}
            className="block w-full rounded-md border border-slate-200 bg-white px-3 py-1.5 text-left text-xs font-semibold text-slate-700"
            data-testid="hr-create-user-emp-option-none"
          >
            Select employee...
          </button>
          {employees.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => { onChange(e.id); setOpen(false); }}
              className={`block w-full rounded-md border px-3 py-1.5 text-left text-xs font-semibold ${roleClasses(designationSlug(e.designation))}`}
              data-testid={`hr-create-user-emp-option-${e.id}`}
            >
              {e.employee_code} — {e.full_name} ({e.designation || "—"})
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

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
  const currentLabel = idx >= 0 ? branches[idx].branch_name : "No branch";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex h-10 w-full items-center justify-between gap-2 rounded-md border px-3 text-left text-sm font-semibold ${currentClasses}`}
        data-testid="hr-create-user-branch"
      >
        <span className="truncate">{currentLabel}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-20 mt-1 max-h-64 space-y-1 overflow-y-auto rounded-md border border-slate-200 bg-white p-1.5 shadow-lg" data-testid="hr-create-user-branch-list">
          <button
            type="button"
            onClick={() => { onChange(""); setOpen(false); }}
            className="block w-full rounded-md border border-slate-200 bg-white px-3 py-1.5 text-left text-xs font-semibold text-slate-700"
            data-testid="hr-create-user-branch-option-none"
          >
            No branch
          </button>
          {branches.map((b, i) => (
            <button
              key={b.id}
              type="button"
              onClick={() => { onChange(b.id); setOpen(false); }}
              className={`block w-full rounded-md border px-3 py-1.5 text-left text-xs font-semibold ${BRANCH_COLOR_PALETTE[i % BRANCH_COLOR_PALETTE.length]}`}
              data-testid={`hr-create-user-branch-option-${b.id}`}
            >
              {b.branch_name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const CreateUserModal = ({ meta, reloadMeta, onClose, onSaved }) => {
  const [employees, setEmployees] = useState([]);
  const [branches, setBranches] = useState([]);
  const [form, setForm] = useState({ employee_id: "", full_name: "", email: "", role: "", branch_id: "", branch_ids: [], password: "", confirm: "" });
  const roleLabelForMulti = MULTI_BRANCH_ROLE_LABELS[form.role];
  const isMultiBranchRole = Boolean(roleLabelForMulti);
  const isOrgWideRole = ORG_WIDE_ROLES.has(form.role);
  const [addingRole, setAddingRole] = useState(false);
  const [newRoleLabel, setNewRoleLabel] = useState("");
  const [savingRole, setSavingRole] = useState(false);
  useEffect(() => { hrEmployees({ status: "active" }).then(setEmployees).catch((e) => console.warn("[load failed]", e?.message || e)); }, []);
  useEffect(() => { getBranches().then(setBranches).catch((e) => console.warn("[load failed]", e?.message || e)); }, []);

  const pickEmployee = (id) => {
    const emp = employees.find((e) => e.id === id);
    setForm((p) => ({ ...p, employee_id: id, full_name: emp?.full_name || p.full_name, email: emp?.email || p.email }));
  };

  const createRole = async () => {
    if (!newRoleLabel.trim()) { toast.error("Enter a role name"); return; }
    setSavingRole(true);
    try {
      const created = await hrAddCustomRole(newRoleLabel.trim());
      toast.success(`Role "${created.label}" added`);
      await reloadMeta?.();
      setForm((p) => ({ ...p, role: created.name }));
      setAddingRole(false);
      setNewRoleLabel("");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to add role");
    } finally {
      setSavingRole(false);
    }
  };

  const submit = async () => {
    if (!form.email || !form.password || !form.role) { toast.error("Email, role, password required"); return; }
    if (form.password.length < 6) { toast.error("Min 6 characters"); return; }
    if (form.password !== form.confirm) { toast.error("Passwords do not match"); return; }
    if (isMultiBranchRole && form.branch_ids.length === 0) { toast.error("Select at least one branch"); return; }
    try {
      await hrCreateUser({
        full_name: form.full_name || form.email.split("@")[0],
        email: form.email,
        password: form.password,
        role: form.role,
        employee_id: form.employee_id || null,
        ...(isOrgWideRole ? { branch_ids: [], branch_id: null }
          : isMultiBranchRole ? { branch_ids: form.branch_ids }
          : { branch_id: form.branch_id || null }),
      });
      toast.success("User created");
      onSaved();
    } catch (e) { toast.error(e?.response?.data?.detail || "Create failed"); }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" data-testid="hr-create-user-modal">
      {/* Scaled to 80% so the whole form — heading through Create User — is on screen at
          once. This panel had no height limit at all, which is why it ran off the top
          and bottom and cut its own header and buttons off.
          The max-height reads oddly on purpose: `zoom` scales the computed box, so a vh
          limit set here is multiplied by 0.8 before it lands. 110vh is what leaves the
          panel occupying ~88% of the screen, and the overflow is the safety net for a
          window short enough that even 80% doesn't fit. */}
      <div className="max-h-[110vh] w-full max-w-md space-y-3 overflow-y-auto rounded-lg bg-white p-5 shadow-xl" style={{ zoom: 0.8 }}>
        <div className="flex items-center justify-between">
          <div><h3 className="text-base font-semibold">Create User Account</h3><p className="text-xs text-slate-500">Create login credentials for an employee.</p></div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" data-testid="hr-create-user-close"><X className="h-4 w-4" /></button>
        </div>
        <Field label="Link to Employee (optional)">
          <EmployeeSelectDropdown value={form.employee_id} employees={employees} onChange={pickEmployee} />
        </Field>
        <Field label="Name"><Input placeholder="Full name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} data-testid="hr-create-user-name" /></Field>
        <Field label="Username (Email) *"><Input placeholder="user@company.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="hr-create-user-email" /></Field>
        <Field label="Role *">
          <RoleSelectDropdown
            value={form.role}
            options={meta.roles.filter((r) => r !== "super_admin")}
            onChange={(r) => setForm({ ...form, role: r })}
            onAddNew={() => setAddingRole(true)}
          />
          {addingRole && (
            <div className="mt-2 flex items-center gap-2 rounded-md border border-sky-200 bg-sky-50 p-2" data-testid="hr-create-user-new-role">
              <Input
                autoFocus
                placeholder="e.g. Tech Manager"
                value={newRoleLabel}
                onChange={(e) => setNewRoleLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); createRole(); } }}
                className="h-8 flex-1 bg-white text-sm"
                data-testid="hr-create-user-new-role-input"
              />
              <Button size="sm" onClick={createRole} disabled={savingRole} className="h-8 bg-sky-600 hover:bg-sky-700" data-testid="hr-create-user-new-role-add">
                {savingRole ? "Adding..." : "Add"}
              </Button>
              <button type="button" onClick={() => { setAddingRole(false); setNewRoleLabel(""); }} className="p-1 text-slate-400 hover:text-slate-600" data-testid="hr-create-user-new-role-cancel">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          {!addingRole && (
            <p className="mt-1 text-[10px] text-slate-400">A new role only adds a selectable name — page access still needs to be built for it separately.</p>
          )}
        </Field>
        {isOrgWideRole ? (
          <Field label="Branches">
            <p className="rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-medium text-teal-700" data-testid="hr-create-org-wide-branch-note">
              CONSULTANTS cover every branch — no branch selection needed.
            </p>
          </Field>
        ) : isMultiBranchRole ? (
          <Field label={`Branches (${roleLabelForMulti} can cover more than one)`}>
            <div className="space-y-1.5 rounded-md border border-slate-200 p-2" data-testid="hr-create-user-branch-ids">
              {branches.map((b) => {
                const checked = form.branch_ids.includes(b.id);
                return (
                  <label key={b.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => setForm({
                        ...form,
                        branch_ids: e.target.checked
                          ? [...form.branch_ids, b.id]
                          : form.branch_ids.filter((id) => id !== b.id),
                      })}
                      data-testid={`hr-create-user-branch-ids-${b.id}`}
                    />
                    {b.branch_name}
                  </label>
                );
              })}
              {branches.length === 0 && <p className="px-1.5 py-1 text-xs text-slate-400">No branches yet</p>}
            </div>
          </Field>
        ) : (
          <Field label="Branch (optional)">
            <BranchSelectDropdown value={form.branch_id} branches={branches} onChange={(id) => setForm({ ...form, branch_id: id })} />
          </Field>
        )}
        <Field label="Password *"><PasswordInput placeholder="Min 6 characters" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} testid="hr-create-user-pwd" /></Field>
        <Field label="Confirm Password *"><PasswordInput placeholder="Confirm password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} testid="hr-create-user-confirm" /></Field>
        <div className="flex gap-2 pt-2"><Button variant="outline" onClick={onClose} className="flex-1" data-testid="hr-create-user-cancel">Cancel</Button><Button onClick={submit} className="flex-1 bg-sky-600 hover:bg-sky-700" data-testid="hr-create-user-submit">Create User</Button></div>
      </div>
    </div>
  );
};

// ---------- shared ----------

const Field = ({ label, children, className = "" }) => (
  <div className={`space-y-1 ${className}`}>
    <label className="text-xs font-medium text-slate-600">{label}</label>
    {children}
  </div>
);

// A password box that can be read back. Whoever sets a password here has to pass it on
// to the person it belongs to, so being unable to check what was typed is how an account
// gets handed over with a credential nobody can log in with.
const PasswordInput = ({ value, onChange, placeholder, testid }) => {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        type={show ? "text" : "password"}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        className="pr-10"
        data-testid={testid}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-400 transition hover:text-slate-700"
        title={show ? "Hide password" : "Show password"}
        aria-label={show ? "Hide password" : "Show password"}
        data-testid={`${testid}-toggle`}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
};

// `uppercase` styles the displayed text only — the stored value is untouched, so
// existing records and the backend's department list keep matching.
const Select = ({ value, onChange, options = [], testid, uppercase = false }) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value)}
    className={`h-10 w-full rounded-md border border-slate-200 px-3 text-sm${uppercase ? " uppercase" : ""}`}
    data-testid={testid}
  >
    {options.map((o) => <option key={o} value={o}>{o || "Select"}</option>)}
  </select>
);


export default HRBoard;
