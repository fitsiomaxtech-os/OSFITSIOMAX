import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Users, ShieldCheck, BarChart3, Plus, Pencil, Trash2, Eye, EyeOff, KeyRound, X, UserPlus, MoreVertical, Check, CheckCircle2, XCircle, AlertOctagon, CalendarOff, ChevronDown, ChevronUp, GripVertical, Search, Camera, ImageOff, Download, Network } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import {
  hrDashboard, hrEmployees, hrCreateEmployee, hrUpdateEmployee, hrDeleteEmployee, uploadEmployeePhoto,
  hrUsers, hrCreateUser, hrUpdateUser, hrResetPassword, hrDeactivateUser, hrActivateUser, hrDeleteUserPermanent, hrUpdateUserRole, hrMeta, hrAddCustomRole,
  hrDepartments, hrCreateDepartment, hrRenameDepartment, hrDeleteDepartment, hrAddDesignation, hrRenameDesignation, hrDeleteDesignation, hrReorderDesignations,
  getBranches, getVerticals,
} from "@/lib/api";
import { MilkDateInput } from "@/components/ui/milk-calendar";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import { EmployeeAvatar } from "@/components/ui/employee-avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { downloadCsv } from "@/lib/printable";

// Matches ALL_BRANCHES in backend/routers/v3_hr.py, which resolves it to a name on the way
// out. Held in branch_id where a real branch id would go, so everything that already reads
// an employee's branch keeps working without being told about it.
const ALL_BRANCHES = "__all__";

const TABS = [
  { key: "dashboard", label: "Dashboard", icon: BarChart3 },
  { key: "employees", label: "Employees", icon: Users },
  { key: "roles", label: "Roles & Credentials", icon: ShieldCheck },
  // One screen over one set of records. The tab that used to carry this name was a second
  // view of the same departments, which left a standing question about which of the two was
  // authoritative; this one reads the list and creates, renames and deletes in it.
  //
  // The key stays "structure": it is internal state, and renaming it would only invalidate
  // the tab somebody happens to have open.
  { key: "structure", label: "Department & Designation", short: "Depts", icon: Network },
];

// Every default vertical is named "online_.../offline_..." — same helper as
// Branches & Verticals' own mode tag, read off that prefix.
const isOnlineVertical = (v) => String(v || "").startsWith("online_");

// Both consultant roles can cover more than one branch — every other role keeps the
// original single Branch select.
// Physios belong to branches and may cover several, so they get the checkbox list.
// Head Physios cover the whole organisation by definition — offering them a branch choice
// would suggest they could be limited to one, which they can't be.
// Kept in step with MULTI_BRANCH_ROLES in backend/routers/v3_hr.py. A role missing here
// is offered a single branch on hire while the backend expects a list, so an Online
// Physio covering three branches would get one expert record and two empty calendars.
// A CONSULTANT picks branches like a Physio does. They used to be org-wide with the
// selection replaced by a notice saying so, which left no way to say a CONSULTANT works
// two branches out of four — the board already scopes to branch_ids, so the fact was
// storable all along and only the form refused to collect it.
//
// Empty still means every branch, which is what an existing CONSULTANT carries today.
// Requiring one would have made every one of them unsaveable until a branch was ticked.
// Up here with the other role vocabulary rather than two-thirds down the file: it is
// read from reloadMeta at the top and from the designation options in the middle, and a
// const is not hoisted, so where it was written was where it started existing.
// ---------- Roles & Credentials ----------

const ROLE_META = {
  super_admin: { label: "SUPER ADMIN", classes: "border-purple-300 bg-purple-50 text-purple-700" },
  business_dev: { label: "BUSINESS DEV", classes: "border-indigo-300 bg-indigo-50 text-indigo-700" },
  pre_sales: { label: "PRE SALES", classes: "border-sky-300 bg-sky-50 text-sky-700" },
  // Sales Head shares Pre-Sales' own sky — it's the same desk's manager, not a role of
  // its own, so it wears the same hue rather than claiming a fresh one.
  sales_head: { label: "SALES HEAD", classes: "border-sky-300 bg-sky-50 text-sky-700" },
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
  // Called what the clinic calls them. "Physio" is the slug's own shorthand and was
  // reaching the screen unchanged, so the role filter said PHYSIO while every list of
  // designations beside it said Physiotherapist.
  physio: { label: "PHYSIOTHERAPIST", classes: "border-cyan-300 bg-cyan-50 text-cyan-700" },
  // Blue against Physio's cyan is the same shift the family above makes from emerald to
  // teal: the base hue says which kind of role this is, and the neighbouring one says it
  // is the online arm of it.
  online_physio: { label: "ONLINE PHYSIO", classes: "border-blue-300 bg-blue-50 text-blue-700" },
  marketing_head: { label: "MARKETING HEAD", classes: "border-pink-300 bg-pink-50 text-pink-700" },
  accountant: { label: "ACCOUNTANT", classes: "border-orange-300 bg-orange-50 text-orange-700" },
};
// The hues custom roles already carry in the database. Nothing picks one any more — the
// Create Role form stopped offering a colour, and the backend stores "slate" for a role
// added without one — so this is here to render the roles that were given a colour back
// when it was offered. Written as literal class strings because Tailwind reads the source
// for class names; a template built from the colour key would compile to nothing.
const ROLE_SWATCHES = {
  purple: { classes: "border-purple-300 bg-purple-50 text-purple-700" },
  indigo: { classes: "border-indigo-300 bg-indigo-50 text-indigo-700" },
  sky: { classes: "border-sky-300 bg-sky-50 text-sky-700" },
  emerald: { classes: "border-emerald-300 bg-emerald-50 text-emerald-700" },
  amber: { classes: "border-amber-300 bg-amber-50 text-amber-700" },
  cyan: { classes: "border-cyan-300 bg-cyan-50 text-cyan-700" },
  pink: { classes: "border-pink-300 bg-pink-50 text-pink-700" },
  orange: { classes: "border-orange-300 bg-orange-50 text-orange-700" },
  rose: { classes: "border-rose-300 bg-rose-50 text-rose-700" },
  teal: { classes: "border-teal-300 bg-teal-50 text-teal-700" },
  slate: { classes: "border-slate-300 bg-slate-100 text-slate-700" },
};

// Colours for roles added at runtime. Module-level because roleClasses is called from
// half a dozen places that have no reason to thread meta through, and there is exactly one
// role list per install. Refilled whenever meta loads.
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
 *   All branches   a CONSULTANT given none of them covers all of them. Their empty branch
 *                  list means "all", and printing "—" for it would read as the opposite
 *                  of the truth. Given specific branches, they read like anyone else —
 *                  org_wide is the empty case, not the role.
 *   several        a CONSULTANT, Physio or Nutrition Coach can serve more than one. The first is
 *                  named and the rest counted, with all of them in the tooltip — a column
 *                  this narrow cannot list four branch names without pushing Actions off.
 *   one, or none   the name, or a dash for an account genuinely not attached to a branch.
 */

const MULTI_BRANCH_ROLE_LABELS = { head_physio: "CONSULTANT", physio: "Physio", online_physio: "Online Physio" };
// A Nutritionist picks branches the same way, and for the same reason: they hold a
// calendar at each branch they work and may work more than one. The backend has accepted
// a list from them all along — only this form refused to collect it, leaving one Branch
// dropdown that could say nothing about a coach who covers two.
//
// Read off the shape of the slug rather than one literal, because a diet role is typed by
// hand in Roles & Credentials: this install's is "diet_manage", not "nutrition_coach", so
// a map keyed by the literal never matched it. Matched on whole underscore-separated
// tokens so an unrelated role can't slip through on a substring — "audit_manage" shares
// no token with the set. Super Admin reaches the Diet board but is not a coach, and is
// excluded here as it is on the backend. Kept in step with is_multi_branch_role in
// backend/routers/v3_hr.py.
const DIET_ROLE_TOKENS = ["diet", "nutrition", "nutritionist", "dietician", "dietitian"];
const multiBranchLabel = (role) => {
  const r = String(role || "").trim().toLowerCase();
  if (MULTI_BRANCH_ROLE_LABELS[r]) return MULTI_BRANCH_ROLE_LABELS[r];
  if (r === "super_admin") return null;
  if (r.includes("nutrition_coach") || r.split("_").some((t) => DIET_ROLE_TOKENS.includes(t))) return "Nutritionist";
  return null;
};
// Roles allowed to cover everything by leaving the selection empty.
const BRANCHLESS_OK_ROLES = new Set(["head_physio"]);

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
      {tab === "structure" && <StructureTab meta={meta} reloadMeta={reloadMeta} />}
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
        onClick ? "cursor-pointer hover:border-sky-300 hover:shadow-sm" : ""
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
                  className="rounded-xl border-2 border-slate-200 bg-white px-4 py-3.5 text-left transition hover:border-sky-300 hover:shadow-sm"
                  data-testid={`hr-dept-${d.name}`}
                >
                  <span className="block truncate text-[11px] font-bold uppercase tracking-wider text-slate-500">{d.name}</span>
                  <span className="mt-1 block text-3xl font-extrabold text-sky-600">{d.count}</span>
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

// ---------- shared: search, filter, directory ----------

/**
 * Collapses to a bare icon until clicked, so an empty search box doesn't sit open and
 * take up a quarter of the toolbar on every visit. Opens straight into a focused field;
 * closes itself back to the icon on blur, but only if it's empty — a live query never
 * disappears out from under someone.
 */
const SearchIconInput = ({ value, onChange, placeholder = "Search...", testid }) => {
  const [open, setOpen] = useState(Boolean(value));
  const ref = useRef(null);

  useEffect(() => { if (open) ref.current?.focus(); }, [open]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition hover:border-sky-300 hover:text-sky-600"
        title="Search"
        aria-label="Search"
        data-testid={testid}
      >
        <Search className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div className="relative w-full sm:w-64">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <Input
        ref={ref}
        autoFocus
        value={value}
        onChange={onChange}
        onBlur={() => { if (!value) setOpen(false); }}
        placeholder={placeholder}
        className="pl-9"
        data-testid={testid}
      />
    </div>
  );
};

/** A pill tab for switching between departments (and "All Department"). Not built from
 *  SegmentedTabs — that component splits its track evenly across a fixed tab count, which
 *  doesn't fit a list that grows every time someone adds a department. */
/**
 * A department or designation as it should read.
 *
 * These are entered by hand over months by different people, so the same job arrives as
 * "CONSULTANT" from one and "Consultant" from another. Shouting one pill among a row of
 * ordinary ones reads as emphasis nobody meant.
 *
 * Only a name that is entirely upper case is touched. Anything with a lower-case letter in
 * it was written deliberately and is left alone — which is what keeps "HR Admin" from
 * becoming "Hr Admin", and is the whole reason this is not a blanket title-casing.
 *
 * Punctuation is untouched either way, so "BRANCH ADMIN (PHYSIO & FITNESS)" keeps its
 * brackets and its ampersand.
 */
const titleCase = (name) => {
  const text = String(name || "");
  if (text !== text.toUpperCase()) return text;
  return text.replace(/[A-Za-zÀ-ɏ]+/g, (w) => w.charAt(0) + w.slice(1).toLowerCase());
};

/** The key two spellings of one name share. */
const nameKey = (name) => String(name || "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * One entry per name, whichever case each was typed in.
 *
 * Without this the same job is offered twice and each pill filters to half the people who
 * hold it, which reads as a list that has lost some of them.
 */
const dedupeNames = (names) => {
  const seen = new Set();
  const out = [];
  names.filter(Boolean).forEach((n) => {
    const key = nameKey(n);
    if (key && !seen.has(key)) { seen.add(key); out.push(n); }
  });
  return out.sort((a, b) => titleCase(a).localeCompare(titleCase(b)));
};

/**
 * The designations configured under a department — or under all of them.
 *
 * The configured list, not the one read back off whoever happens to hold a job today. Those
 * two answer different questions: Department & Designation says what the org has, and the
 * records say what is currently filled. A filter built from the records cannot offer a designation
 * nobody holds yet, which is exactly the one somebody is about to hire into.
 *
 * With no department chosen it is every department's list, so the row on Roles &
 * Credentials with All Departments selected is the whole structure rather than a sample
 * of it.
 *
 * Returns nothing when the structure has not been set up, which lets the caller fall back
 * to deriving from its own records rather than showing an empty row.
 */
const configuredDesignations = (meta, department) => {
  const groups = meta?.department_designations || {};
  if (department && department !== "Unassigned") return dedupeNames(groups[department] || []);
  return dedupeNames(Object.values(groups).flat());
};

const TabPill = ({ active, onClick, children, testid }) => (
  <button
    type="button"
    onClick={onClick}
    className={`shrink-0 border px-3.5 py-1.5 text-sm font-medium transition ${
      active ? "border-sky-600 bg-sky-600 text-white shadow-sm" : "border-slate-200 bg-white text-slate-600 hover:border-sky-300 hover:text-sky-600"
    }`}
    data-testid={testid}
  >
    {children}
  </button>
);

const DesignationFilterSelect = ({ value, onChange, options, testid }) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value)}
    className={`h-10 rounded-md border px-3 text-sm font-medium ${value ? "border-sky-300 bg-sky-50 text-sky-700" : "border-slate-200 bg-white text-slate-600"}`}
    title="Filter by designation"
    data-testid={testid}
  >
    <option value="">All Designations</option>
    {options.map((d) => <option key={d} value={d}>{d}</option>)}
  </select>
);

/** The mobile card list and desktop table that show a filtered set of employees —
 *  identical markup whether it's reached from the Employees tab or from a department
 *  tab on Departments & Designation, so the two never drift into two different tables. */
// Blank when work_type was never set — not every employee is tagged to a vertical, and an
// empty cell says that plainly instead of a badge reading "Offline" for someone nobody
// actually classified.
const WorkTypeCell = ({ e }) => {
  if (!e.work_type) return <span className="text-slate-300">—</span>;
  const online = e.work_type === "online";
  return (
    <div className="leading-tight">
      <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold ${online ? "bg-violet-50 text-violet-600" : "bg-emerald-50 text-emerald-600"}`}>
        {online ? "Online" : "Offline"}
      </span>
      <p className="mt-0.5 text-[11px] text-slate-500">{e.branch_name || "—"}</p>
    </div>
  );
};

const EmployeeDirectory = ({ employees, onView }) => (
  <>
    <div className="space-y-2 md:hidden" data-testid="hr-emp-cards">
      {employees.map((e) => (
        <div key={e.id} className="rounded-xl border border-slate-200 bg-white p-3" data-testid={`hr-emp-card-${e.id}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <EmployeeAvatar employee={e} size={36} />
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-800">{e.full_name}</p>
                <p className="text-xs text-slate-400">{e.employee_code}</p>
              </div>
            </div>
            <span className={`shrink-0 rounded px-2 py-0.5 text-xs ${e.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>{e.status || "active"}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
            <span>{e.designation || "—"}{e.department ? ` · ${e.department}` : ""}</span>
            <span className="font-semibold text-emerald-600">₹{Number(e.net_salary || 0).toLocaleString("en-IN")}</span>
          </div>
          {e.work_type && (
            <div className="mt-1.5">
              <WorkTypeCell e={e} />
            </div>
          )}
          <div className="mt-1 text-xs text-slate-500">{e.email}{e.phone ? ` · ${e.phone}` : ""}</div>
          <div className="mt-2 flex items-center gap-3 border-t border-slate-100 pt-2">
            <button onClick={() => onView(e)} className="flex items-center gap-1 text-xs font-medium text-sky-600" data-testid={`hr-emp-card-view-${e.id}`}><Eye className="h-3.5 w-3.5" />View</button>
          </div>
        </div>
      ))}
      {employees.length === 0 && <p className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">No employees.</p>}
    </div>

    <Card className="hidden md:block">
      <CardHeader><CardTitle className="text-base">Employee Directory</CardTitle></CardHeader>
      <CardContent className="p-0">
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr><th className="px-3 py-2">S.No</th><th className="px-3 py-2">Employee</th><th className="px-3 py-2">Dept</th><th className="px-3 py-2">Designation</th><th className="px-3 py-2">Work Type</th><th className="px-3 py-2">Contact</th><th className="px-3 py-2">Joining</th><th className="px-3 py-2">Net Salary</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Actions</th></tr>
            </thead>
            <tbody>
              {employees.map((e, i) => (
                <tr key={e.id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`hr-emp-row-${e.id}`}>
                  <td className="px-3 py-2 text-slate-500">{i + 1}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2.5">
                      <EmployeeAvatar employee={e} size={32} />
                      <div className="min-w-0">
                        <p className="font-medium text-slate-800">{e.full_name}</p>
                        <p className="text-xs text-slate-400">{e.employee_code}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{e.department || "—"}</td>
                  <td className="px-3 py-2 text-slate-600">{e.designation || "—"}</td>
                  <td className="px-3 py-2"><WorkTypeCell e={e} /></td>
                  <td className="px-3 py-2 text-xs text-slate-600">{e.email}<br />{e.phone}</td>
                  <td className="px-3 py-2 text-slate-500">{e.joining_date || "—"}</td>
                  <td className="px-3 py-2 font-semibold text-emerald-600">₹{Number(e.net_salary || 0).toLocaleString("en-IN")}</td>
                  <td className="px-3 py-2"><span className={`rounded px-2 py-0.5 text-xs ${e.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>{e.status || "active"}</span></td>
                  <td className="px-3 py-2">
                    <button onClick={() => onView(e)} title="View employee" className="text-slate-500 hover:text-sky-600" data-testid={`hr-emp-view-${e.id}`}><Eye className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))}
              {employees.length === 0 && <tr><td colSpan="10" className="px-3 py-6 text-center text-slate-400">No employees.</td></tr>}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  </>
);

// ---------- Employees ----------

const EmployeesTab = ({ meta, initialFilter }) => {
  const [employees, setEmployees] = useState([]);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState(initialFilter?.status || "active");
  // Arrived at from a Department Strength bar or a Departments & Designation tab.
  const [department, setDepartment] = useState(initialFilter?.department || "");
  const [designation, setDesignation] = useState(initialFilter?.designation || "");
  // Same Online/Offline split as Branches & Verticals — reads each employee's own
  // work_type, set (optionally) from the Add/Edit Employee form.
  const [workType, setWorkType] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);

  const load = useCallback(() => hrEmployees({ status: filterStatus === "all" ? "" : filterStatus }).then(setEmployees).catch((e) => console.warn("[load failed]", e?.message || e)), [filterStatus]);
  useEffect(() => { load(); }, [load]);

  // Designation options narrow to whichever department is picked, so the dropdown never
  // offers a combination ("Accountant" under "Doctors") that would filter to nothing.
  //
  // Sourced from the department's own configured designation list (Departments &
  // Designation → Manage Designations) rather than from who currently holds one — a
  // designation with zero employees today (a newly added admin type, say) still needs to
  // show up as a filter, or there'd be no way to filter for the first person hired into it.
  // Falls back to deriving from employees when no single department is selected (there's no
  // one department's list to scope "All Departments" or "Unassigned" to).
  const designationOptions = useMemo(() => {
    const configured = configuredDesignations(meta, department);
    if (configured.length > 0) return configured;
    const pool = department ? employees.filter((e) => (e.department || "Unassigned") === department) : employees;
    return dedupeNames(pool.map((e) => e.designation));
  }, [employees, department, meta]);

  const filtered = employees.filter((e) => {
    // "Unassigned" is what the Dashboard calls an employee with no department, so it has
    // to match the empty field here or that bar would open an empty list.
    if (department && (e.department || "Unassigned") !== department) return false;
    // Folded, so the one pill standing for a job finds everyone filed under any spelling
    // of it rather than the half that happen to match its capitals.
    if (designation && nameKey(e.designation) !== nameKey(designation)) return false;
    if (workType && e.work_type !== workType) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (e.full_name || "").toLowerCase().includes(q) || (e.email || "").toLowerCase().includes(q) || (e.employee_code || "").toLowerCase().includes(q);
  });

  const remove = async (emp) => {
    if (!window.confirm(`Delete employee ${emp.full_name}?`)) return;
    try { await hrDeleteEmployee(emp.id); toast.success("Deleted"); setViewing(null); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Delete failed"); }
  };

  const active = employees.filter((e) => (e.status || "active") === "active").length;
  const left = employees.filter((e) => (e.status || "active") !== "active").length;
  // Offered only when it would actually match someone — otherwise every install shows an
  // "Unassigned" option that filters to an empty list.
  const hasUnassigned = employees.some((e) => !e.department);

  // flex+gap, not space-y — the desktop table below is hidden by class on mobile.
  return (
    <div className="flex flex-col gap-3" data-testid="hr-employees-tab">
      {/* Status row */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setFilterStatus("active")} className={`rounded-md px-3 py-2 text-sm font-medium ${filterStatus === "active" ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-600"}`} data-testid="hr-emp-tab-active">Active Employees ({active})</button>
        <button onClick={() => setFilterStatus("left")} className={`rounded-md px-3 py-2 text-sm font-medium ${filterStatus === "left" ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-600"}`} data-testid="hr-emp-tab-left">Left ({left})</button>
      </div>

      {/* Department row — same pill tabs as Departments & Designation, so filtering by
          department reads the same way in both places. */}
      <div className="flex flex-wrap items-center gap-2" data-testid="hr-emp-dept-filter">
        <TabPill active={department === ""} onClick={() => { setDepartment(""); setDesignation(""); }} testid="hr-emp-dept-filter-all">
          All Departments
        </TabPill>
        {meta.departments.map((d) => (
          <TabPill key={d} active={department === d} onClick={() => { setDepartment(d); setDesignation(""); }} testid={`hr-emp-dept-filter-${d}`}>
            {titleCase(d)}
          </TabPill>
        ))}
        {hasUnassigned && (
          <TabPill active={department === "Unassigned"} onClick={() => { setDepartment("Unassigned"); setDesignation(""); }} testid="hr-emp-dept-filter-unassigned">
            Unassigned
          </TabPill>
        )}
      </div>

      {/* Designation row — narrows to whichever department is picked above. */}
      <div className="flex flex-wrap items-center gap-2" data-testid="hr-emp-designation-filter">
        <TabPill active={designation === ""} onClick={() => setDesignation("")} testid="hr-emp-designation-filter-all">
          All Designations
        </TabPill>
        {designationOptions.map((d) => (
          <TabPill key={d} active={designation === d} onClick={() => setDesignation(d)} testid={`hr-emp-designation-filter-${d}`}>
            {titleCase(d)}
          </TabPill>
        ))}
      </div>

      {/* Work Type row — same Online/Offline split as Branches & Verticals. */}
      <div className="flex flex-wrap items-center gap-2" data-testid="hr-emp-worktype-filter">
        <TabPill active={workType === ""} onClick={() => setWorkType("")} testid="hr-emp-worktype-filter-all">
          All
        </TabPill>
        <TabPill active={workType === "online"} onClick={() => setWorkType("online")} testid="hr-emp-worktype-filter-online">
          Online
        </TabPill>
        <TabPill active={workType === "offline"} onClick={() => setWorkType("offline")} testid="hr-emp-worktype-filter-offline">
          Offline
        </TabPill>
      </div>

      {/* Actions row */}
      <div className="flex items-center justify-end gap-2">
        <SearchIconInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employee..." testid="hr-emp-search" />
        <Button onClick={() => { setEditing(null); setShowAdd(true); }} className="bg-sky-600 hover:bg-sky-700" data-testid="hr-emp-add-btn"><Plus className="h-4 w-4 mr-1" />Add Employee</Button>
      </div>

      <EmployeeDirectory employees={filtered} onView={setViewing} />

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
        <div className="flex min-w-0 items-center gap-3">
          <EmployeeAvatar employee={e} size={44} />
          <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-semibold text-slate-900" data-testid="hr-emp-view-name">{e.full_name}</h3>
            <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold ${e.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>{e.status || "active"}</span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            {e.employee_code || "No code"}{e.designation ? ` · ${e.designation}` : ""}{e.department ? ` · ${e.department}` : ""}
          </p>
          </div>
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
            <ViewRow label="Work Type" value={e.work_type ? (e.work_type === "online" ? "Online" : "Offline") : ""} />
            <ViewRow label="Branch" value={e.branch_name} />
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
          <Button onClick={onEdit} className="bg-sky-600 hover:bg-sky-700" data-testid="hr-emp-view-edit">
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
          invalid || future ? "border-rose-300 focus:border-rose-400 focus:ring-rose-300" : "border-slate-200 focus:border-sky-400 focus:ring-sky-300"
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
  marital_status: "", father_name: "", mother_name: "", photo_url: "",
  department: "", designation: "", joining_date: "", reporting_to: "", employee_code: "",
  pan: "", aadhar: "",
  address: "", emergency_contact_name: "", emergency_contact_phone: "",
  net_salary: 0, gross_salary: 0, bank_name: "", bank_account: "", ifsc: "",
  status: "active", notes: "", work_type: "", branch_id: "",
};

const AddEmployeeModal = ({ employee, meta, initialDepartment, initialDesignation, onClose, onSaved }) => {
  const [tab, setTab] = useState("personal");
  // initialDepartment/initialDesignation only seed a brand-new form — editing keeps using
  // the record's own values, and `employee` (not these fields) is what submit() checks to
  // decide create vs. update, so this never risks turning a create into an update.
  const [form, setForm] = useState(employee ? { ...blankEmployee, ...employee } : { ...blankEmployee, department: initialDepartment || "", designation: initialDesignation || "" });
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  // The picked photo is held here and only uploaded when the form is submitted — the same
  // order the store's item images use. Abandoning the dialog then costs nothing at all,
  // rather than leaving a file on disk nothing points at.
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null); // object URL for the picked file
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photoInputRef = useRef(null);

  // Revoked on replace and on unmount: an object URL pins the whole file in memory until
  // it is, and this dialog can be opened over and over across a directory.
  useEffect(() => () => { if (photoPreview) URL.revokeObjectURL(photoPreview); }, [photoPreview]);

  const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
  const pickPhoto = (file) => {
    if (!file) return;
    // Checked here as well as on the server so the answer is immediate — the server still
    // refuses these, but after a full upload of something it was never going to keep.
    if (!PHOTO_TYPES.includes(file.type)) { toast.error("Choose a JPG, PNG or WEBP image"); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("Photo must be under 5MB"); return; }
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  // Clears the stored photo too: "" is what update_employee reads as remove, since it
  // drops nulls from a partial update.
  const clearPhoto = () => {
    setPhotoFile(null);
    setPhotoPreview(null);
    set("photo_url", "");
    if (photoInputRef.current) photoInputRef.current.value = "";
  };

  const [branches, setBranches] = useState([]);
  useEffect(() => { getBranches().then(setBranches).catch(() => {}); }, []);
  // Whichever branches match the picked Work Type — same filter Branches & Verticals'
  // own mode pills use.
  const branchOptions = useMemo(
    () => branches.filter((b) => isOnlineVertical(b.vertical) === (form.work_type === "online")),
    [branches, form.work_type],
  );
  // Switching Work Type clears any branch already picked — an Offline branch left set
  // after switching to Online would silently tag the employee to a branch that no longer
  // matches the mode shown next to it.
  const changeWorkType = (v) => setForm((p) => ({ ...p, work_type: v, branch_id: "" }));

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
      // Before the record, so it can point at the file. A failed upload stops here rather
      // than saving an employee whose photo silently didn't take.
      if (photoFile) {
        setUploadingPhoto(true);
        try {
          const uploaded = await uploadEmployeePhoto(photoFile);
          payload.photo_url = uploaded.url;
        } finally { setUploadingPhoto(false); }
      }
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
            <button key={t.key} onClick={() => setTab(t.key)} className={`rounded px-3 py-1 ${tab === t.key ? "bg-sky-50 text-sky-600 font-semibold" : "text-slate-600 hover:bg-slate-50"}`} data-testid={`hr-emp-modal-tab-${t.key}`}>{t.label}</button>
          ))}
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-5">
          {tab === "personal" && (
            <div className="grid gap-3 sm:grid-cols-3">
              {/* Above the fields, and spanning them, because it is the one part of this
                  record you identify a person by rather than read. The hidden input is
                  driven by the buttons: a bare file input cannot be styled and prints the
                  chosen filename beside itself, which here duplicates the preview. */}
              <div className="flex items-center gap-4 rounded-lg border border-slate-200 bg-slate-50/60 p-3 sm:col-span-3">
                <EmployeeAvatar
                  employee={{ full_name: form.full_name, photo_url: photoPreview || form.photo_url }}
                  size={72}
                  className="ring-2 ring-white"
                />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-600">Profile Photo</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">JPG, PNG or WEBP · up to 5MB</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      ref={photoInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(ev) => pickPhoto(ev.target.files?.[0])}
                      data-testid="hr-emp-photo-input"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => photoInputRef.current?.click()}
                      className="h-8 text-xs"
                      data-testid="hr-emp-photo-pick"
                    >
                      <Camera className="mr-1.5 h-3.5 w-3.5" />
                      {photoPreview || form.photo_url ? "Change Photo" : "Upload Photo"}
                    </Button>
                    {(photoPreview || form.photo_url) && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={clearPhoto}
                        className="h-8 border-rose-200 text-xs text-rose-600 hover:bg-rose-50"
                        data-testid="hr-emp-photo-remove"
                      >
                        <ImageOff className="mr-1.5 h-3.5 w-3.5" /> Remove
                      </Button>
                    )}
                    {/* Says the picture is not saved yet, because the dialog's own Save is
                        what sends it — closing here would drop it silently otherwise. */}
                    {photoFile && (
                      <span className="text-[11px] font-medium text-amber-600" data-testid="hr-emp-photo-pending">
                        Saves with the form
                      </span>
                    )}
                  </div>
                </div>
              </div>
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
              {/* Neither is required. Branch only appears once a Work Type is picked —
                  it's meaningless before that — and narrows to the branches that actually
                  match it, same split Branches & Verticals itself uses. */}
              <Field label="Work Type"><Select value={form.work_type} onChange={changeWorkType} options={["", "online", "offline"]} testid="hr-emp-worktype" /></Field>
              {form.work_type && (
                <Field label="Branch">
                  <select
                    value={form.branch_id}
                    onChange={(e) => set("branch_id", e.target.value)}
                    className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm"
                    data-testid="hr-emp-branch"
                  >
                    <option value="">— Not picked —</option>
                    {/* Offered here too, or an employee posted to every branch from New
                        Structure would open this form showing "Not picked" — the stored
                        value matching no option — and be cleared by the next save. */}
                    <option value={ALL_BRANCHES}>All Branches</option>
                    {branchOptions.map((b) => <option key={b.id} value={b.id}>{b.branch_name}</option>)}
                  </select>
                </Field>
              )}
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
          <Button onClick={submit} disabled={uploadingPhoto} className="bg-sky-600 hover:bg-sky-700" data-testid="hr-emp-modal-submit">{uploadingPhoto ? "Uploading photo…" : `✓ ${employee ? "Save" : "Add Employee"}`}</Button>
        </div>
      </div>
    </div>
  );
};

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

/**
 * Filters the user list by role, in the same popover the date filter uses.
 *
 * The rows used to be painted one colour per role, which read as a palette to memorise
 * rather than a list to choose from — and a filter is a list. Neutral now: the chosen row
 * is the only thing marked, by weight and a tick, exactly as the pickers elsewhere do it.
 *
 * Searchable because this install has fourteen roles and counting, and a filter you have to
 * scroll is slower than the table it was meant to narrow.
 */
const RoleFilterDropdown = ({ value, options, onChange }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Cleared on close rather than on pick, which is the one moment a stale query would
  // otherwise be sitting there the next time this opens.
  useEffect(() => { if (!open) setQuery(""); }, [open]);

  const q = query.trim().toLowerCase();
  const rows = [{ value: "all", label: "ALL" }, ...options.map((r) => ({ value: r, label: roleLabel(r) }))];
  const shown = q ? rows.filter((r) => r.label.toLowerCase().includes(q)) : rows;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={`h-10 ${value === "all" ? "" : "border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100"}`}
          data-testid="hr-roles-role-filter"
        >
          {value === "all" ? "ALL" : roleLabel(value)}
          <ChevronDown className="ml-2 h-3.5 w-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="relative w-56 p-0" align="end" data-testid="hr-roles-role-filter-list">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="absolute right-2 top-2 z-10 rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          aria-label="Close"
          data-testid="hr-roles-role-filter-close"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <div className="border-b border-slate-100 p-2 pr-9">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search role..."
            className="h-8 text-xs"
            data-testid="hr-roles-role-filter-search"
          />
        </div>
        <div className="max-h-64 overflow-y-auto py-1">
          {shown.length === 0 && <p className="px-3 py-6 text-center text-xs text-slate-400">Nothing matches that.</p>}
          {shown.map((r) => {
            const on = r.value === value;
            return (
              <button
                key={r.value}
                type="button"
                onClick={() => { onChange(r.value); setOpen(false); }}
                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition hover:bg-slate-100 ${
                  on ? "font-bold text-slate-900" : "text-slate-600"
                }`}
                data-testid={`hr-roles-role-filter-option-${r.value}`}
              >
                <span className="truncate">{r.label}</span>
                {on && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-slate-500" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
};

/**
 * The ROLE cell's picker: one neutral style for the closed box and every row, with the
 * row matching the current value as the only thing highlighted, so which one is picked
 * reads from the highlight rather than from a palette. Same treatment RoleSelectDropdown
 * gives the designation picker.
 *
 * Still built rather than a native <select>, which cannot style its option list at all —
 * the browser draws that, so the rounded rows and the highlight would both be lost.
 *
 * The list is portalled to <body> and pinned to the button's own rect. This picker sits
 * inside the table's overflow-auto scroller, and a list positioned the ordinary way is
 * clipped at that container's edge for every row far enough down it — which is most of
 * them once an install has a screenful of users. It opens upward instead when the row is
 * near the bottom of the window, and closes on any scroll, since a list fixed to the
 * viewport would otherwise sit on while the button it belongs to slides away.
 */
/**
 * A picker, opened as a dialog. Used for a branch and for a role.
 *
 * A dialog rather than a panel hanging off the control: these sit deep inside a card, in a
 * row, inside a list that scrolls — any one of which can clip a panel or stack over it. A
 * dialog answers to none of them, and it has room to say whose branch or role is being
 * changed, which a strip of options beside a button never did.
 *
 * It is also the only shape that can be scrolled. A panel pinned to the viewport has to
 * close when the page moves under it, and a scroll listener that notices the page moving
 * cannot tell that apart from the list being scrolled — so the list shut the moment it was
 * used. A dialog has nothing to keep up with and simply scrolls.
 *
 * Portalled to the body for the same reason, so no ancestor's overflow or stacking context
 * can crop it.
 *
 * No colour anywhere, which was the point of replacing the native select in the first
 * place: white card, slate text, a grey wash on hover, and the current choice marked by
 * weight and a tick rather than by hue.
 */
const PickerModal = ({ title, value, options, onPick, onClose, searchable = false, searchPlaceholder = "Search...", checkbox = false }) => {
  // Opt-in, because most of these lists are five or six rows and a search box over six
  // rows is furniture. The employee list is seventy-odd and unusable without one.
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((o) => String(o.search || o.label).toLowerCase().includes(q)) : options;

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="hr-branch-picker-modal"
    >
      <div className="flex max-h-[80vh] w-full max-w-sm flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3">
          <h3 className="min-w-0 truncate text-sm font-semibold text-slate-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
            data-testid="hr-branch-picker-close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {searchable && (
          <div className="shrink-0 border-b border-slate-100 p-2">
            <Input
              value={query}
              autoFocus
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-8 text-xs"
              data-testid="hr-picker-search"
            />
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {shown.length === 0 && (
            <p className="px-4 py-6 text-center text-xs text-slate-400">Nothing matches that.</p>
          )}
          {shown.map((o) => {
            const on = o.value === value;
            return (
              <button
                key={o.value || "none"}
                type="button"
                onClick={() => onPick(o.value)}
                className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm transition hover:bg-slate-100 ${
                  on ? "font-bold text-slate-900" : "text-slate-600"
                }`}
                data-testid={`hr-branch-picker-option-${o.value || "none"}`}
              >
                {/* A box, but one answer at a time — a list where two could be ticked would
                    be promising something the field behind it cannot hold. */}
                {checkbox && (
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? "border-slate-700 bg-slate-700" : "border-slate-300 bg-white"}`}>
                    {on && <Check className="h-3 w-3 text-white" />}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{o.label}</span>
                  {o.hint && <span className="block truncate text-[11px] font-normal text-slate-400">{o.hint}</span>}
                </span>
                {!checkbox && on && <CheckCircle2 className="h-4 w-4 shrink-0 text-slate-500" />}
              </button>
            );
          })}
        </div>

        <div className="shrink-0 border-t border-slate-200 px-4 py-2.5 text-right">
          <Button variant="outline" size="sm" onClick={onClose} data-testid="hr-branch-picker-cancel">Cancel</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

/**
 * The ROLE cell's picker.
 *
 * A dialog, like the branch picker it shares — and for a reason this one learned the hard
 * way. It used to be a panel pinned to the button's own rect, which had to close whenever
 * the page moved beneath it; the listener that noticed the page moving could not tell that
 * apart from the list itself being scrolled, so a list too long to fit shut the instant
 * anyone tried to reach the bottom of it. There are more roles than fit on a screen, so
 * that was every use of it.
 *
 * The dialog has nothing to keep up with. It scrolls, it cannot be clipped by the table it
 * sits in, and it has room to name the role being changed.
 */
const RoleCellDropdown = ({ value, options, onChange, testid, subject }) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-7 w-full items-center justify-between gap-2 rounded border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        data-testid={testid}
      >
        <span className="truncate">{roleLabel(value)}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
      </button>
      {open && (
        <PickerModal
          title={subject ? `Role for ${subject}` : "Role"}
          value={value}
          options={options.map((r) => ({ value: r, label: roleLabel(r) }))}
          onPick={(v) => { setOpen(false); if (v !== value) onChange(v); }}
          onClose={() => setOpen(false)}
          searchable
          searchPlaceholder="Search role..."
        />
      )}
    </>
  );
};

// ---------- Department & Designation ----------



const StructureTab = ({ meta, reloadMeta }) => {
  const [depts, setDepts] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState("");
  // The row whose branch is being written, so its control can be held shut while the
  // request is in flight rather than accepting a second change onto the first.
  const [movingEmployee, setMovingEmployee] = useState("");
  // The employee whose branch is being picked. One dialog for the tab rather than one per
  // row: only ever one is open, and a hundred mounted copies would be a hundred Escape
  // listeners waiting on a key nobody has pressed.
  const [branchPickerFor, setBranchPickerFor] = useState(null);
  // null | "department" | "designation" — which of the two is being named, and the name so
  // far. One dialog serves both: the two differ by a title and where the name is sent.
  // { kind: "department" | "designation", target } — target null means create, a name or a
  // department means rename that one. One piece of state for all four jobs: four separate
  // flags could contradict each other, and only ever one dialog is open.
  const [naming, setNaming] = useState(null);
  // The name a rename collided with, held while the merge is confirmed. Cleared either
  // way, so a second rename never inherits the first one's answer.
  const [mergeInto, setMergeInto] = useState("");
  const [newName, setNewName] = useState("");
  const [savingName, setSavingName] = useState(false);
  // What is about to be deleted, and whether the request is in flight.
  const [deleting, setDeleting] = useState(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  // Which designation is open. One at a time, so the department's shape stays readable
  // while a designation's people are being looked at.
  const [openDesignation, setOpenDesignation] = useState("");
  const [showAddEmployee, setShowAddEmployee] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [pendingDesignation, setPendingDesignation] = useState("");

  const load = useCallback(async (keepOpen = false) => {
    try {
      const [d, e, b] = await Promise.all([hrDepartments(), hrEmployees({}), getBranches()]);
      setDepts(d || []);
      setEmployees(e || []);
      setBranches(b || []);
      // Opens on the first department rather than on nothing. There is no "all" here —
      // the question this screen answers is about one department at a time.
      setSelected((prev) => prev || d?.[0]?.name || "");
      if (!keepOpen) setOpenDesignation("");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to load the structure");
    }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const current = depts.find((d) => d.name === selected) || null;
  const designations = current?.designations || [];

  // Who holds a designation, within the department that owns it. Both halves matter: the
  // same designation name can sit under two departments, and the people under it are not
  // the same people.
  // "All Branches" sits at the top with "No branch": both are answers about the whole set
  // rather than a choice from within it, so they read as a pair before the list proper.
  const branchOptions = useMemo(() => ([
    { value: "", label: "— No branch —" },
    { value: ALL_BRANCHES, label: "All Branches" },
    ...branches.map((b) => ({ value: b.id, label: b.branch_name })),
  ]), [branches]);

  const holdersOf = (designation) => employees.filter(
    (e) => e.department === current?.name && e.designation === designation,
  );

  /** Post somebody to a branch, or take them off one.
   *
   * A PATCH carrying nothing but the branch: the endpoint applies only what it is sent, so
   * the rest of the record is not restated and cannot be flattened by an out-of-date copy
   * held on this screen.
   *
   * The row is updated in place rather than by reloading everything, so the designation
   * stays open and the list does not jump under the hand that just used it.
   */
  const moveToBranch = async (emp, branchId) => {
    if (branchId === (emp.branch_id || "")) return;
    setMovingEmployee(emp.id);
    try {
      await hrUpdateEmployee(emp.id, { branch_id: branchId });
      const name = branchId === ALL_BRANCHES
        ? "All Branches"
        : (branches.find((b) => b.id === branchId)?.branch_name || "");
      setEmployees((prev) => prev.map(
        (e) => (e.id === emp.id ? { ...e, branch_id: branchId, branch_name: name } : e),
      ));
      toast.success(name ? `${emp.full_name} → ${name}` : `${emp.full_name} taken off their branch`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not change the branch");
    } finally {
      setMovingEmployee("");
    }
  };

  const openNaming = (kind, target = null) => { setNewName(target || ""); setMergeInto(""); setNaming({ kind, target }); };

  /** Make sure a job title is also a role somebody can be given.
   *
   * A designation and a role are the same thing to this clinic — the title somebody holds
   * IS what their login is — but they lived in two places that only met when a user was
   * created: Create User resolved a designation to a role and minted one where there was
   * none. So a designation added here stayed unknown to Roles & Credentials until somebody
   * happened to hire into it, which is how the two lists drifted apart in the first place.
   *
   * A role that already exists is the end state being asked for, so its 409 is success.
   * Anything else is worth saying out loud but never worth failing over: the designation is
   * what was being created, and it is already saved by the time this runs.
   */
  const ensureRoleFor = async (label) => {
    try {
      await hrAddCustomRole(label);
    } catch (e) {
      if (e?.response?.status === 409) return;
      toast.error(`${label} was added, but making it a role failed — add it under Roles & Credentials.`);
    }
  };

  const submitName = async () => {
    const name = newName.trim();
    if (!name || !naming) return;
    const { kind, target } = naming;
    setSavingName(true);
    try {
      if (kind === "department" && !target) {
        await hrCreateDepartment(name);
        await load();
        // Opened on what was just made: somebody creating a department is about to fill
        // it, and leaving them on the one they were reading would hide the thing they
        // asked for behind a tab they now have to find.
        setSelected(name);
      } else if (kind === "department") {
        await hrRenameDepartment(current.id, name);
        await load();
        // Followed to the new name, or the tab somebody was standing on would stop
        // matching anything and the card beneath would empty itself.
        setSelected(name);
      } else if (!target) {
        await hrAddDesignation(current.id, name);
        // In the same breath, or the two lists start drifting again from the next title on.
        await ensureRoleFor(name);
        // Selection and open row both kept: the new designation appears in the list
        // already being looked at rather than closing it to say so.
        await load(true);
      } else {
        await hrRenameDesignation(current.id, target, name, mergeInto === name);
        await load(true);
        // The open row is keyed by name, so a rename has to move the key with it or the
        // row somebody had open would silently close.
        setOpenDesignation((prev) => (prev === target ? name : prev));
      }
      toast.success(
        mergeInto === name ? `Merged into ${name}` : target ? `Renamed to ${name}` : `${name} added`
      );
      setNaming(null);
      setNewName("");
      setMergeInto("");
      // Employees and Roles read the same lists off meta, so they have to be told.
      reloadMeta();
    } catch (e) {
      const detail = e?.response?.data?.detail || "Could not save it";
      // The server refuses a rename onto a name this department already has, and says
      // what merging would do. Offered rather than just reported: two spellings of one
      // job — "Consultants" beside "CONSULTANT" — is exactly what a rename here is for,
      // and the answer is to fold one into the other.
      if (e?.response?.status === 409 && detail.includes("already a designation here")) {
        setMergeInto(name);
      } else {
        toast.error(detail);
      }
    } finally {
      setSavingName(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeletingBusy(true);
    try {
      if (deleting.kind === "department") {
        await hrDeleteDepartment(deleting.dept.id);
        await load();
        // Whatever is left, or nothing. Standing on a tab that no longer exists shows an
        // empty card and no way back to a real one.
        setSelected((prev) => (prev === deleting.dept.name ? "" : prev));
      } else {
        await hrDeleteDesignation(current.id, deleting.name);
        await load(true);
        setOpenDesignation((prev) => (prev === deleting.name ? "" : prev));
      }
      toast.success(`${deleting.kind === "department" ? deleting.dept.name : deleting.name} deleted`);
      setDeleting(null);
      reloadMeta();
    } catch (e) {
      // The server refuses one that is still in use and says by how many. That message is
      // the whole answer, so it is shown rather than replaced with a generic failure.
      toast.error(e?.response?.data?.detail || "Could not delete it");
    } finally {
      setDeletingBusy(false);
    }
  };

  if (loading) return <p className="py-12 text-center text-sm text-slate-400">Loading…</p>;
  if (depts.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400" data-testid="hr-structure-empty">
        No departments yet. Add one with the Department button above.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="hr-structure-tab">
      {/* The strip scrolls; the two create buttons do not. They sit outside the scrolling
          box, pinned right, or they would slide off with the departments and be unreachable
          exactly when there are enough of them to want another. */}
      <div className="flex items-center gap-2">
      {/* One row, scrolling sideways rather than wrapping: a department's place in the row
          is how it is found again, and a row that reflows every time one is added moves
          them all. min-w-0 so the strip scrolls inside the page instead of widening it. */}
      <div className="min-w-0 flex-1 overflow-x-auto">
        <div className="flex w-max items-center gap-1.5 rounded-lg border border-slate-200 bg-white p-1" data-testid="hr-structure-depts">
          {depts.map((d) => {
            const on = d.name === selected;
            const count = (d.designations || []).length;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => setSelected(d.name)}
                className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-2 text-xs font-semibold transition ${
                  on ? "bg-sky-600 text-white" : "text-slate-600 hover:bg-slate-50"
                }`}
                data-testid={`hr-structure-dept-${d.id}`}
              >
                {d.name}
                <span className={`rounded px-1.5 py-px text-[10px] font-bold ${on ? "bg-white/25" : "bg-slate-100 text-slate-500"}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

        <Button
          size="sm"
          variant="outline"
          className="h-9 shrink-0 border-slate-200 text-xs text-slate-600 hover:bg-slate-50"
          onClick={() => openNaming("department")}
          data-testid="hr-structure-add-department"
        >
          <Plus className="mr-1 h-3.5 w-3.5" /> Department
        </Button>
        {/* Disabled rather than hidden while nothing is selected: the button is what says
            a designation belongs to a department, and hiding it would only raise the
            question of where designations are made. */}
        <Button
          size="sm"
          className="h-9 shrink-0 bg-sky-600 text-xs text-white hover:bg-sky-700"
          disabled={!current}
          onClick={() => openNaming("designation")}
          title={current ? `Add a designation to ${current.name}` : "Pick a department first"}
          data-testid="hr-structure-add-designation"
        >
          <Plus className="mr-1 h-3.5 w-3.5" /> Designation
        </Button>
      </div>

      <Card data-testid="hr-structure-designations">
        <CardHeader className="flex flex-row items-center justify-between gap-2 py-3">
          <CardTitle className="min-w-0 truncate text-sm font-semibold text-slate-800">{current?.name || "—"}</CardTitle>
          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
              {designations.length} {designations.length === 1 ? "designation" : "designations"}
            </span>
            {/* On the header rather than on the tab: the tab is how a department is chosen
                and an edit control there would be hit while reaching for the next one. */}
            {current && (
              <>
                <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => openNaming("department", current.name)} title={`Rename ${current.name}`} aria-label={`Rename ${current.name}`} data-testid="hr-structure-dept-edit">
                  <Pencil className="h-3 w-3" />
                </Button>
                <Button size="sm" variant="outline" className="h-7 w-7 border-rose-200 p-0 text-rose-700 hover:bg-rose-50" onClick={() => setDeleting({ kind: "department", dept: current })} title={`Delete ${current.name}`} aria-label={`Delete ${current.name}`} data-testid="hr-structure-dept-delete">
                  <Trash2 className="h-3 w-3" />
                </Button>
              </>
            )}
          </div>
        </CardHeader>
        <CardContent className="pb-4">
          {designations.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">
              Nothing under {current?.name} yet.
            </p>
          ) : (
            // Numbered, because the order is the department's own and says something —
            // it is the order Departments &amp; Designation was arranged in.
            <ol className="space-y-1.5">
              {designations.map((name, i) => {
                const holders = holdersOf(name);
                const open = openDesignation === name;
                return (
                  <li key={name} className="overflow-hidden rounded-lg border border-slate-100" data-testid={`hr-structure-designation-${name}`}>
                    {/* A row of siblings, not one button wrapping the others. A button
                        inside a button is invalid markup that browsers unnest, and the
                        inner one stops receiving its clicks — so Edit and Delete sit
                        beside the opener rather than inside it. */}
                    <div className={`flex items-center gap-1 px-3 py-2 transition ${open ? "bg-sky-50" : "bg-slate-50/60 hover:bg-slate-100"}`}>
                      {/* Most of the row still opens it: that is what somebody is aiming at
                          when they want to know who holds this. */}
                      <button
                        type="button"
                        onClick={() => setOpenDesignation(open ? "" : name)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        aria-expanded={open}
                        data-testid={`hr-structure-designation-open-${name}`}
                      >
                        <span className="w-5 shrink-0 text-right text-[11px] font-bold text-slate-400">{i + 1}</span>
                        <span className={`min-w-0 flex-1 truncate text-sm font-medium ${open ? "text-sky-800" : "text-slate-700"}`} title={name}>{name}</span>
                        {/* Counted whether it is open or not, so the row says how many
                            people are behind it before anybody clicks. Nought reads as
                            nought rather than as a missing badge. */}
                        <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-bold ${holders.length > 0 ? "bg-slate-200 text-slate-600" : "bg-slate-100 text-slate-400"}`}>
                          {holders.length}
                        </span>
                        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
                      </button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 w-7 shrink-0 p-0"
                        onClick={() => openNaming("designation", name)}
                        title={`Rename ${name}`}
                        aria-label={`Rename ${name}`}
                        data-testid={`hr-structure-designation-edit-${name}`}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 w-7 shrink-0 border-rose-200 p-0 text-rose-700 hover:bg-rose-50"
                        onClick={() => setDeleting({ kind: "designation", name })}
                        title={`Delete ${name}`}
                        aria-label={`Delete ${name}`}
                        data-testid={`hr-structure-designation-delete-${name}`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>

                    {open && (
                      <div className="space-y-1.5 border-t border-slate-100 bg-white px-3 py-2" data-testid={`hr-structure-holders-${name}`}>
                        {holders.map((emp) => (
                          <div key={emp.id} className="flex flex-wrap items-center gap-2 rounded-md border border-slate-100 px-2.5 py-1.5">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-slate-800">{emp.full_name}</p>
                              <p className="truncate text-[11px] text-slate-500">{emp.employee_code || "—"}</p>
                            </div>
                            {/* Said as a word before it is offered as a control: the branch
                                is the fact being read, and a bare dropdown makes somebody
                                open it to find out what it already says. Amber when there
                                is none, because an unposted employee is a gap rather than a
                                neutral state. */}
                            <span
                              className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-semibold ${
                                emp.branch_name ? "bg-sky-50 text-sky-700" : "bg-amber-50 text-amber-700"
                              }`}
                              data-testid={`hr-structure-branch-${emp.id}`}
                            >
                              {emp.branch_name || "No branch"}
                            </span>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 shrink-0 text-[11px] font-medium text-slate-600"
                              disabled={movingEmployee === emp.id}
                              onClick={() => setBranchPickerFor(emp)}
                              aria-label={`Change branch for ${emp.full_name}`}
                              data-testid={`hr-structure-branch-change-${emp.id}`}
                            >
                              Change
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 shrink-0 text-[11px]"
                              onClick={() => { setEditingEmployee(emp); setPendingDesignation(name); setShowAddEmployee(true); }}
                              data-testid={`hr-structure-edit-${emp.id}`}
                            >
                              <Pencil className="mr-1 h-3 w-3" /> Edit
                            </Button>
                          </div>
                        ))}
                        {holders.length === 0 && (
                          <p className="py-2 text-center text-xs text-slate-400">Nobody holds this designation yet.</p>
                        )}
                        {/* Seeded with this department and this designation, so the form
                            opens where the click was rather than asking again for what was
                            just pointed at. */}
                        <Button
                          size="sm"
                          className="h-8 w-full bg-sky-600 text-white hover:bg-sky-700"
                          onClick={() => { setEditingEmployee(null); setPendingDesignation(name); setShowAddEmployee(true); }}
                          data-testid={`hr-structure-add-${name}`}
                        >
                          <Plus className="mr-1 h-3.5 w-3.5" /> Add {name}
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>

      {naming && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setNaming(null); }}
          data-testid="hr-structure-name-modal"
        >
          <div className="w-full max-w-sm space-y-3 rounded-lg bg-white p-5 shadow-xl">
            <h3 className="text-sm font-semibold text-slate-900">
              {naming.target
                ? `Rename ${naming.target}`
                : (naming.kind === "department" ? "New Department" : `New Designation in ${current?.name}`)}
            </h3>
            <Input
              value={newName}
              autoFocus
              onChange={(e) => setNewName(e.target.value)}
              // Enter to save, Escape to leave: this is one field, and reaching for the
              // mouse to commit a single word is the slower half of the job.
              onKeyDown={(e) => {
                if (e.key === "Enter") submitName();
                if (e.key === "Escape") setNaming(null);
              }}
              placeholder={naming.kind === "department" ? "Department name" : "Designation name"}
              data-testid="hr-structure-name-input"
            />
            {/* The rename came back saying that name is already here. Says plainly what
                pressing Merge does, because it drops a designation and moves everybody
                under it — neither of which should be a surprise. */}
            {mergeInto === newName.trim() && (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800" data-testid="hr-structure-merge-notice">
                <b>{mergeInto}</b> is already a designation here. Merging moves everyone under{" "}
                <b>{naming.target}</b> into it and removes <b>{naming.target}</b>.
              </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => setNaming(null)} data-testid="hr-structure-name-cancel">Cancel</Button>
              <Button
                size="sm"
                className={mergeInto === newName.trim() ? "bg-amber-600 hover:bg-amber-700" : "bg-sky-600 hover:bg-sky-700"}
                // Unchanged is not a save: renaming something to what it is already called
                // would spend a request to tell the user nothing happened.
                disabled={savingName || !newName.trim() || newName.trim() === naming.target}
                onClick={submitName}
                data-testid="hr-structure-name-save"
              >
                {savingName ? "Saving…" : mergeInto === newName.trim() ? `Merge into ${mergeInto}` : naming.target ? "Rename" : "Add"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {deleting && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setDeleting(null); }}
          data-testid="hr-structure-delete-modal"
        >
          <div className="w-full max-w-sm space-y-4 rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-100">
                <Trash2 className="h-5 w-5 text-rose-600" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-slate-900">
                  Delete {deleting.kind === "department" ? "this department?" : "this designation?"}
                </h3>
                {/* Named, not "this one". Two rows apart look identical in a confirmation
                    that does not say which was clicked. */}
                <p className="mt-1 text-xs text-slate-500">
                  <b className="text-slate-700">{deleting.kind === "department" ? deleting.dept.name : deleting.name}</b>
                  {deleting.kind === "department"
                    ? " and every designation under it come off the structure."
                    : ` comes off ${current?.name}.`}
                  {" "}Anybody still filed under it will be refused, and the message says how many.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => setDeleting(null)} data-testid="hr-structure-delete-cancel">Cancel</Button>
              <Button
                size="sm"
                className="bg-rose-600 hover:bg-rose-700"
                disabled={deletingBusy}
                onClick={confirmDelete}
                data-testid="hr-structure-delete-confirm"
              >
                {deletingBusy ? "Deleting…" : "Yes, Delete"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {branchPickerFor && (
        <PickerModal
          title={`Branch for ${branchPickerFor.full_name}`}
          value={branchPickerFor.branch_id || ""}
          options={branchOptions}
          onPick={(v) => { const emp = branchPickerFor; setBranchPickerFor(null); moveToBranch(emp, v); }}
          onClose={() => setBranchPickerFor(null)}
        />
      )}

      {showAddEmployee && (
        <AddEmployeeModal
          employee={editingEmployee}
          initialDepartment={current?.name || ""}
          initialDesignation={pendingDesignation}
          meta={meta}
          onClose={() => { setShowAddEmployee(false); setEditingEmployee(null); }}
          onSaved={() => {
            setShowAddEmployee(false);
            setEditingEmployee(null);
            // Reloaded with the designation left open, so the row somebody was working in
            // is still open behind the closing dialog and the new name is simply there.
            load(true);
            reloadMeta();
          }}
        />
      )}
    </div>
  );
};

// ---------- Departments & Designation ----------

const DEPT_DESIGNATION_SUB_TABS = [
  { key: "departments", label: "Departments" },
  { key: "designations", label: "Designation" },
];

// Browsing a department's people and managing the designation list itself used to share
// one screen (a "Manage Designations" button opened the latter as a popup over the
// former). Split into two plain tabs instead: Designation is now a page of its own rather
// than a dialog, which is what it needed to be able to show every department's list at
// once with a search bar over the top of it.
const DepartmentsDesignationTab = ({ meta, reloadMeta }) => {
  const [subTab, setSubTab] = useState("departments");
  return (
    <div className="space-y-4" data-testid="hr-dept-designation-tab">
      <div className="flex flex-wrap gap-2" data-testid="hr-dept-designation-subtabs">
        {DEPT_DESIGNATION_SUB_TABS.map((t) => (
          <TabPill key={t.key} active={subTab === t.key} onClick={() => setSubTab(t.key)} testid={`hr-dept-designation-subtab-${t.key}`}>
            {t.label}
          </TabPill>
        ))}
      </div>
      {subTab === "departments" && <DepartmentsTab meta={meta} reloadMeta={reloadMeta} />}
      {subTab === "designations" && <DesignationsTab meta={meta} reloadMeta={reloadMeta} />}
    </div>
  );
};

const DepartmentsTab = ({ meta, reloadMeta }) => {
  const [depts, setDepts] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(false);
  // "" selects the All Department tab; otherwise a department name.
  const [selectedDept, setSelectedDept] = useState("");
  const [designationFilter, setDesignationFilter] = useState("");
  const [search, setSearch] = useState("");
  const [newDeptName, setNewDeptName] = useState("");
  const [addingDept, setAddingDept] = useState(false); // the trailing "+" tab, opened
  const [editingDeptId, setEditingDeptId] = useState(null);
  const [editDeptName, setEditDeptName] = useState("");
  const [renamingDept, setRenamingDept] = useState(false);
  const [showAddEmployee, setShowAddEmployee] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [viewingEmployee, setViewingEmployee] = useState(null);

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

  const selectedDeptObj = useMemo(() => depts.find((d) => d.name === selectedDept) || null, [depts, selectedDept]);

  const selectTab = (name) => { setSelectedDept(name); setDesignationFilter(""); };

  // Every department and every designation under it, as a sheet.
  //
  // One row per pairing rather than two separate lists, because a designation only means
  // anything under the department that owns it — "Senior Physio" is a fact about Experts,
  // not a name floating on its own. Sorting and filtering the sheet gives either list back.
  //
  // A department with nothing under it still gets a row. Which departments exist is half
  // the question being asked, and dropping the empty ones answers only the other half.
  const exportDepartments = () => {
    const rows = [["Department", "Designation"]];
    depts.forEach((d) => {
      const designations = d.designations || [];
      if (designations.length === 0) rows.push([d.name, ""]);
      else designations.forEach((name) => rows.push([d.name, name]));
    });
    downloadCsv(rows, `departments-and-designations-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success(`${rows.length - 1} rows exported`);
  };

  const addDepartment = async () => {
    const name = newDeptName.trim();
    if (!name) return;
    setAddingDept(false);
    try {
      await hrCreateDepartment(name);
      setNewDeptName("");
      toast.success(`${name} added`);
      load();
      reloadMeta();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed to add department"); }
  };

  const removeDepartment = async (d) => {
    if (!window.confirm(`Delete "${d.name}"? Employees already in this department keep it as text.`)) return;
    try {
      await hrDeleteDepartment(d.id);
      if (selectedDept === d.name) setSelectedDept("");
      load();
      reloadMeta();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed to delete department"); }
  };

  const startEditDept = (d) => { setEditingDeptId(d.id); setEditDeptName(d.name); };
  const cancelEditDept = () => { setEditingDeptId(null); setEditDeptName(""); };

  const saveEditDept = async (d) => {
    const name = editDeptName.trim();
    if (!name || name === d.name) { cancelEditDept(); return; }
    setRenamingDept(true);
    try {
      await hrRenameDepartment(d.id, name);
      toast.success(`Renamed to ${name}`);
      if (selectedDept === d.name) setSelectedDept(name);
      cancelEditDept();
      load();
      reloadMeta();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed to rename department"); }
    setRenamingDept(false);
  };

  const removeEmployee = async (emp) => {
    if (!window.confirm(`Delete employee ${emp.full_name}?`)) return;
    try { await hrDeleteEmployee(emp.id); toast.success("Deleted"); setViewingEmployee(null); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Delete failed"); }
  };

  // Scoped to the selected tab, same as the Employees tab's own designation dropdown —
  // "All Department" sees every designation in use, a specific tab only its own.
  const deptScopedEmployees = selectedDept ? employees.filter((e) => (e.department || "Unassigned") === selectedDept) : employees;
  const designationFilterOptions = useMemo(
    () => [...new Set(deptScopedEmployees.map((e) => e.designation).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [deptScopedEmployees]
  );

  const filteredEmployees = deptScopedEmployees.filter((e) => {
    if (designationFilter && e.designation !== designationFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (e.full_name || "").toLowerCase().includes(q) || (e.email || "").toLowerCase().includes(q) || (e.employee_code || "").toLowerCase().includes(q);
  });

  return (
    <div className="flex flex-col gap-3" data-testid="hr-departments-tab">
      {/* Department tabs: All Department, then one per department, then + to add one. */}
      <div className="flex flex-wrap items-center gap-2" data-testid="hr-dept-tabs">
        <TabPill active={selectedDept === ""} onClick={() => selectTab("")} testid="hr-dept-tab-all">
          All Department
        </TabPill>
        {depts.map((d) => (
          <TabPill key={d.id} active={selectedDept === d.name} onClick={() => selectTab(d.name)} testid={`hr-dept-tab-${d.id}`}>
            {d.name}
          </TabPill>
        ))}
        {addingDept ? (
          <span className="inline-flex items-center gap-1">
            <Input
              autoFocus
              placeholder="Department name..."
              value={newDeptName}
              onChange={(e) => setNewDeptName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addDepartment(); if (e.key === "Escape") { setAddingDept(false); setNewDeptName(""); } }}
              className="h-9 w-40 text-sm"
              data-testid="hr-dept-add-input"
            />
            <button onClick={addDepartment} disabled={!newDeptName.trim()} className="shrink-0 text-emerald-600 hover:text-emerald-700" title="Add department" data-testid="hr-dept-add-confirm">
              <CheckCircle2 className="h-4 w-4" />
            </button>
            <button onClick={() => { setAddingDept(false); setNewDeptName(""); }} className="shrink-0 text-slate-400 hover:text-slate-600" title="Cancel" data-testid="hr-dept-add-cancel">
              <X className="h-4 w-4" />
            </button>
          </span>
        ) : (
          <button
            onClick={() => setAddingDept(true)}
            title="Add department"
            aria-label="Add department"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-dashed border-sky-300 text-sky-600 transition hover:bg-sky-50"
            data-testid="hr-dept-tab-add"
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
        {/* Pushed to the end of the row, past the add control, because it is about the
            whole list rather than about any one department — the same reason it stays
            put when a department tab is selected. */}
        <Button
          size="sm"
          variant="outline"
          onClick={exportDepartments}
          disabled={depts.length === 0}
          className="ml-auto h-9 shrink-0 border-slate-200 text-slate-600 hover:bg-slate-50"
          title="Download every department and designation as a spreadsheet"
          data-testid="hr-dept-export"
        >
          <Download className="mr-1 h-3.5 w-3.5" /> Export
        </Button>
      </div>

      {/* Selected department's own actions — nothing to rename/delete/manage on "All". */}
      {selectedDeptObj && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-100 bg-sky-50/60 px-3 py-2" data-testid="hr-dept-actionbar">
          {editingDeptId === selectedDeptObj.id ? (
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <Input
                autoFocus
                value={editDeptName}
                onChange={(e) => setEditDeptName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") saveEditDept(selectedDeptObj); if (e.key === "Escape") cancelEditDept(); }}
                className="h-8 max-w-xs text-sm"
                data-testid={`hr-dept-edit-input-${selectedDeptObj.id}`}
              />
              <button onClick={() => saveEditDept(selectedDeptObj)} disabled={renamingDept} className="shrink-0 text-emerald-600 hover:text-emerald-700" data-testid={`hr-dept-edit-save-${selectedDeptObj.id}`} title="Save">
                <CheckCircle2 className="h-4 w-4" />
              </button>
              <button onClick={cancelEditDept} className="shrink-0 text-slate-400 hover:text-slate-600" data-testid={`hr-dept-edit-cancel-${selectedDeptObj.id}`} title="Cancel">
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-800">{selectedDeptObj.name}</p>
              <p className="text-xs text-slate-500">
                {selectedDeptObj.employee_count} employee{selectedDeptObj.employee_count === 1 ? "" : "s"} · {(selectedDeptObj.designations || []).length} designation{(selectedDeptObj.designations || []).length === 1 ? "" : "s"}
              </p>
            </div>
          )}
          {editingDeptId !== selectedDeptObj.id && (
            <div className="flex shrink-0 items-center gap-1">
              <button onClick={() => startEditDept(selectedDeptObj)} className="rounded-md p-2 text-slate-400 hover:bg-white hover:text-sky-600" title="Rename department" data-testid={`hr-dept-edit-${selectedDeptObj.id}`}>
                <Pencil className="h-4 w-4" />
              </button>
              <button onClick={() => removeDepartment(selectedDeptObj)} className="rounded-md p-2 text-slate-400 hover:bg-white hover:text-red-500" title="Delete department" data-testid={`hr-dept-delete-${selectedDeptObj.id}`}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      )}

      {!loading && depts.length === 0 && <p className="text-sm text-slate-400">No departments yet — use the + tab above to add one.</p>}

      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-2">
        <DesignationFilterSelect value={designationFilter} onChange={setDesignationFilter} options={designationFilterOptions} testid="hr-dept-designation-filter" />
      </div>

      {/* Actions row */}
      <div className="flex items-center justify-end gap-2">
        <SearchIconInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employee..." testid="hr-dept-emp-search" />
        <Button onClick={() => { setEditingEmployee(null); setShowAddEmployee(true); }} className="bg-sky-600 hover:bg-sky-700" data-testid="hr-dept-emp-add-btn">
          <Plus className="h-4 w-4 mr-1" />Add Employee
        </Button>
      </div>

      <EmployeeDirectory employees={filteredEmployees} onView={setViewingEmployee} />

      {viewingEmployee && (
        <EmployeeViewModal
          employee={viewingEmployee}
          onClose={() => setViewingEmployee(null)}
          onEdit={() => { setEditingEmployee(viewingEmployee); setViewingEmployee(null); setShowAddEmployee(true); }}
          onDelete={() => removeEmployee(viewingEmployee)}
        />
      )}

      {showAddEmployee && (
        <AddEmployeeModal
          employee={editingEmployee}
          initialDepartment={selectedDept}
          meta={meta}
          onClose={() => { setShowAddEmployee(false); setEditingEmployee(null); }}
          onSaved={() => { setShowAddEmployee(false); setEditingEmployee(null); load(); reloadMeta(); }}
        />
      )}
    </div>
  );
};

// A page now rather than a popup opened from one department — this needs to show every
// department's designations at once (with a search bar over the top) which a
// single-department-scoped dialog couldn't.
//
// An already-claimed designation can only be renamed here, never removed — unchecking
// used to call the same delete the department picker used elsewhere, which silently
// orphaned every employee holding it rather than warning anyone. Renaming instead (cascaded
// to those employees, same as a department rename) is the one edit that can't lose track of
// who holds a title. A brand new designation still needs picking which department it
// belongs to, since a designation belongs to exactly one — the backend re-checks that too.
const DesignationsTab = ({ meta, reloadMeta }) => {
  const [depts, setDepts] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [viewingDesignation, setViewingDesignation] = useState(null);
  const [showAddEmployee, setShowAddEmployee] = useState(false);
  const [pendingDepartment, setPendingDepartment] = useState("");
  const [pendingDesignation, setPendingDesignation] = useState("");

  const [editingKey, setEditingKey] = useState(null); // `${deptId}:${label}`
  const [editValue, setEditValue] = useState("");
  const [renaming, setRenaming] = useState(false);

  const [newDeptId, setNewDeptId] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [creating, setCreating] = useState(false);

  // Which row a drag started on — only meaningful within the same department's list, since
  // "first row" only means something inside one department's own order.
  const [dragDeptId, setDragDeptId] = useState(null);
  const [dragIndex, setDragIndex] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, e] = await Promise.all([hrDepartments(), hrEmployees({})]);
      setDepts(d);
      setEmployees(e);
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed to load designations"); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const designationCounts = useMemo(() => {
    const counts = {};
    employees.forEach((e) => { if (e.designation) counts[e.designation] = (counts[e.designation] || 0) + 1; });
    return counts;
  }, [employees]);

  const claimedLabels = useMemo(() => {
    const set = new Set();
    depts.forEach((d) => (d.designations || []).forEach((l) => set.add(l)));
    return set;
  }, [depts]);

  // Exists as a role or on an employee record, but no department has claimed it yet — the
  // department picker elsewhere falls back to the full role list for exactly this reason.
  const unclaimed = useMemo(() => {
    const fromRoles = (meta?.roles || []).map(roleLabel);
    const fromEmployees = employees.map((e) => e.designation).filter(Boolean);
    return [...new Set([...fromRoles, ...fromEmployees])].filter((l) => !claimedLabels.has(l)).sort((a, b) => a.localeCompare(b));
  }, [meta?.roles, employees, claimedLabels]);

  const q = search.trim().toLowerCase();
  const matches = (label) => !q || label.toLowerCase().includes(q);

  const startRename = (deptId, label) => { setEditingKey(`${deptId}:${label}`); setEditValue(label); };
  const cancelRename = () => { setEditingKey(null); setEditValue(""); };

  const saveRename = async (deptId, oldLabel) => {
    const next = editValue.trim();
    if (!next || next === oldLabel) { cancelRename(); return; }
    setRenaming(true);
    try {
      await hrRenameDesignation(deptId, oldLabel, next);
      toast.success(`Renamed to ${next}`);
      cancelRename();
      load();
      reloadMeta();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed to rename"); }
    setRenaming(false);
  };

  // Compared on letters alone, matching the duplicate check used when a role is created —
  // "Diet Manage" and "diet manage" are the same designation as far as this is concerned.
  const key = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const newLabelExists = !!newLabel.trim() && [...claimedLabels, ...unclaimed].some((d) => key(d) === key(newLabel));

  // A brand new designation is different from renaming one: there's no one to view yet, so
  // the useful next step is entering them, not sitting on an empty list.
  const createNew = async () => {
    const label = newLabel.trim();
    if (!label || !newDeptId || newLabelExists) return;
    setCreating(true);
    try {
      await hrAddDesignation(newDeptId, label);
      const dept = depts.find((d) => d.id === newDeptId);
      setNewLabel("");
      toast.success(`${label} added to ${dept?.name || "department"}`);
      await load();
      reloadMeta();
      setPendingDepartment(dept?.name || "");
      setPendingDesignation(label);
      setShowAddEmployee(true);
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed to add designation"); }
    setCreating(false);
  };

  // Applied optimistically — the drag (or arrow click) already showed the new order, so it
  // shouldn't visibly snap back while the request is in flight — then reconciled with the
  // server, or rolled back with a fresh load if the save itself failed.
  const reorder = async (deptId, fromIndex, toIndex) => {
    if (fromIndex === toIndex || toIndex < 0) return;
    const dept = depts.find((d) => d.id === deptId);
    if (!dept || toIndex >= (dept.designations || []).length) return;
    const list = [...dept.designations];
    const [moved] = list.splice(fromIndex, 1);
    list.splice(toIndex, 0, moved);
    setDepts((prev) => prev.map((d) => (d.id === deptId ? { ...d, designations: list } : d)));
    try {
      await hrReorderDesignations(deptId, list);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to reorder");
      load();
    }
  };

  const visibleDepts = depts.filter((d) => (d.designations || []).some(matches));

  if (loading && depts.length === 0) return <p className="text-sm text-slate-500">Loading...</p>;

  return (
    <div className="space-y-4" data-testid="hr-designations-tab">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">Every designation, grouped by department. Rename one, or add a brand new one.</p>
        <SearchIconInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search designations..." testid="hr-designation-search" />
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Add a new designation</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <select
              value={newDeptId}
              onChange={(e) => setNewDeptId(e.target.value)}
              className="h-9 min-w-[10rem] rounded-md border border-slate-200 px-3 text-sm"
              data-testid="hr-designation-new-dept"
            >
              <option value="">Department...</option>
              {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <Input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && newDeptId && !newLabelExists) createNew(); }}
              placeholder="e.g. Nutritionist"
              className="h-9 min-w-[10rem] flex-1"
              data-testid="hr-designation-new-input"
            />
            <Button onClick={createNew} disabled={creating || !newDeptId || !newLabel.trim() || newLabelExists} className="bg-sky-600 hover:bg-sky-700" data-testid="hr-designation-new-submit">
              {creating ? "Adding..." : "Add"}
            </Button>
          </div>
          {newLabelExists && <p className="mt-1.5 text-[11px] font-semibold text-red-500" data-testid="hr-designation-new-duplicate">That designation already exists.</p>}
        </CardContent>
      </Card>

      <div className="space-y-3">
        {visibleDepts.map((d) => (
          <Card key={d.id} data-testid={`hr-designation-dept-${d.id}`}>
            <CardHeader className="pb-2"><CardTitle className="text-sm">{d.name}</CardTitle></CardHeader>
            <CardContent className="space-y-1">
              {/* Dragging (and the up/down fallback for touch) only make sense against the
                  department's real order, which a search filter would scramble the
                  indices of — so reordering is only offered with the search box empty. */}
              {(d.designations || []).filter(matches).map((label, index) => {
                const count = designationCounts[label] || 0;
                const isEditing = editingKey === `${d.id}:${label}`;
                const reorderable = !q && !isEditing;
                const total = d.designations.length;
                return (
                  <div
                    key={label}
                    draggable={reorderable}
                    onDragStart={(e) => {
                      // Firefox won't continue a drag past dragstart unless dataTransfer
                      // actually carries something — the label itself is as good as any.
                      e.dataTransfer.setData("text/plain", label);
                      e.dataTransfer.effectAllowed = "move";
                      setDragDeptId(d.id); setDragIndex(index);
                    }}
                    onDragOver={(e) => { if (reorderable && dragDeptId === d.id) e.preventDefault(); }}
                    onDrop={(e) => {
                      if (!(reorderable && dragDeptId === d.id) || dragIndex === null) return;
                      e.preventDefault();
                      reorder(d.id, dragIndex, index);
                      setDragDeptId(null); setDragIndex(null);
                    }}
                    onDragEnd={() => { setDragDeptId(null); setDragIndex(null); }}
                    className={`flex items-center gap-2 rounded-md px-2 py-2 hover:bg-slate-50 ${reorderable ? "cursor-grab active:cursor-grabbing" : ""}`}
                    data-testid={`hr-designation-row-${d.id}-${label}`}
                  >
                    {isEditing ? (
                      <>
                        <Input
                          autoFocus
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") saveRename(d.id, label); if (e.key === "Escape") cancelRename(); }}
                          className="h-8 flex-1 text-sm"
                          data-testid={`hr-designation-rename-input-${d.id}-${label}`}
                        />
                        <button onClick={() => saveRename(d.id, label)} disabled={renaming} className="shrink-0 text-emerald-600 hover:text-emerald-700" title="Save" data-testid={`hr-designation-rename-save-${d.id}-${label}`}>
                          <CheckCircle2 className="h-4 w-4" />
                        </button>
                        <button onClick={cancelRename} className="shrink-0 text-slate-400 hover:text-slate-600" title="Cancel" data-testid={`hr-designation-rename-cancel-${d.id}-${label}`}>
                          <X className="h-4 w-4" />
                        </button>
                      </>
                    ) : (
                      <>
                        {reorderable ? (
                          <GripVertical className="h-4 w-4 shrink-0 text-slate-300" />
                        ) : (
                          <span className="w-4 shrink-0" />
                        )}
                        <span className="min-w-0 flex-1 truncate text-sm text-slate-800">{label}</span>
                        {reorderable && (
                          <div className="flex shrink-0 flex-col">
                            <button onClick={() => reorder(d.id, index, index - 1)} disabled={index === 0} className="text-slate-300 hover:text-sky-600 disabled:pointer-events-none disabled:opacity-30" title="Move up" data-testid={`hr-designation-up-${d.id}-${label}`}>
                              <ChevronUp className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => reorder(d.id, index, index + 1)} disabled={index === total - 1} className="text-slate-300 hover:text-sky-600 disabled:pointer-events-none disabled:opacity-30" title="Move down" data-testid={`hr-designation-down-${d.id}-${label}`}>
                              <ChevronDown className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                        <button onClick={() => startRename(d.id, label)} className="shrink-0 text-slate-400 hover:text-sky-600" title="Rename designation" data-testid={`hr-designation-edit-${d.id}-${label}`}>
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <span className="shrink-0 text-xs text-slate-500">{count} employee{count === 1 ? "" : "s"}</span>
                        {count > 0 && (
                          <button type="button" onClick={() => setViewingDesignation(label)} className="shrink-0 text-xs font-medium text-sky-600 hover:text-sky-700" data-testid={`hr-designation-view-${d.id}-${label}`}>
                            View
                          </button>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))}
        {visibleDepts.length === 0 && depts.length > 0 && <p className="text-sm text-slate-400">No designations match "{search}".</p>}
        {depts.length === 0 && <p className="text-sm text-slate-400">No departments yet — add one on the Departments tab first.</p>}
      </div>

      {viewingDesignation && (
        <DesignationEmployeesModal
          designation={viewingDesignation}
          employees={employees.filter((e) => e.designation === viewingDesignation)}
          departmentNames={depts.map((d) => d.name)}
          onClose={() => setViewingDesignation(null)}
          onChanged={() => { load(); reloadMeta(); }}
        />
      )}

      {showAddEmployee && (
        <AddEmployeeModal
          employee={null}
          initialDepartment={pendingDepartment}
          initialDesignation={pendingDesignation}
          meta={meta}
          onClose={() => { setShowAddEmployee(false); setPendingDepartment(""); setPendingDesignation(""); }}
          onSaved={() => { setShowAddEmployee(false); setPendingDepartment(""); setPendingDesignation(""); load(); reloadMeta(); }}
        />
      )}
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
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-bold text-sky-700">
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
  // Same pill filters as the Employees tab, reading off each user's linked employee
  // record — a user with no linked employee (most Branch Admin/Pre-Sales accounts
  // still without one) simply won't match either filter.
  const [deptFilter, setDeptFilter] = useState("");
  const [designationFilter, setDesignationFilter] = useState("");
  const [sortAZ, setSortAZ] = useState(null); // null = as-loaded | "asc" | "desc"
  const [showCreate, setShowCreate] = useState(false);
  const [actionTarget, setActionTarget] = useState(null);
  const [view, setView] = useState("list"); // "list" | "branch"

  const load = useCallback(() => hrUsers({ search, role: roleFilter !== "all" ? roleFilter : undefined }).then(setUsers).catch((e) => console.warn("[load failed]", e?.message || e)), [search, roleFilter]);
  useEffect(() => { load(); }, [load]);

  const selectDept = (d) => { setDeptFilter(d); setDesignationFilter(""); };

  // Designations narrow to whichever department is picked, same as the Employees tab —
  // scoped to users actually linked to an employee, so a pill never offers a combination
  // that would filter the list to nothing.
  const designationOptions = useMemo(() => {
    const configured = configuredDesignations(meta, deptFilter);
    if (configured.length > 0) return configured;
    // Only where nothing is configured at all: an install that has not set the structure
    // up still gets a working filter off whoever is on the books.
    const pool = deptFilter ? users.filter((u) => u.linked_employee?.department === deptFilter) : users;
    return dedupeNames(pool.map((u) => u.linked_employee?.designation));
  }, [users, deptFilter, meta]);

  // Matched on the shared key rather than the exact string. One pill now stands for every
  // spelling of a job, so picking Consultant finds the people filed under CONSULTANT too
  // — which is what a reader expects of a list that shows the job once.
  const filteredUsers = users.filter((u) => {
    if (deptFilter && nameKey(u.linked_employee?.department) !== nameKey(deptFilter)) return false;
    if (designationFilter && nameKey(u.linked_employee?.designation) !== nameKey(designationFilter)) return false;
    return true;
  });

  const sortedUsers = sortAZ
    ? [...filteredUsers].sort((a, b) => (a.full_name || "").localeCompare(b.full_name || "") * (sortAZ === "asc" ? 1 : -1))
    : filteredUsers;

  // Who works where, and as what.
  //
  // Grouped by branch and then by role, because the question this answers is about a
  // branch rather than about a person: which desks are staffed at Anna Nagar, and who is
  // on them. The flat list above answers the other question and is still there for it.
  //
  // Somebody covering three branches is listed under all three. They are genuinely on
  // that branch's roster, and leaving them off the other two would make a branch read as
  // unstaffed for a role that is in fact covered.
  //
  // Super Admin is left out throughout: the account that owns the OS is not a member of
  // any branch's staff, and listing it under every branch would say otherwise.
  const branchGroups = useMemo(() => {
    const byBranch = new Map();
    const place = (branchName, user) => {
      if (!byBranch.has(branchName)) byBranch.set(branchName, new Map());
      const byRole = byBranch.get(branchName);
      const role = roleLabel(user.role);
      if (!byRole.has(role)) byRole.set(role, []);
      byRole.get(role).push(user);
    };

    sortedUsers
      .filter((u) => u.role !== "super_admin")
      .forEach((u) => {
        const named = (u.branches || []).map((b) => b.name).filter(Boolean);
        // A role that covers every branch is said once, under its own heading, rather
        // than repeated into every branch as though it were posted to each.
        if (u.org_wide) place("All branches", u);
        else if (named.length) named.forEach((n) => place(n, u));
        // Kept rather than dropped: an account belonging to no branch is nearly always
        // an oversight, and it can only be noticed if it is shown somewhere.
        else place("No branch assigned", u);
      });

    // Real branches first, alphabetically; the two catch-alls last, where they read as
    // notes about the list rather than as branches in it.
    const rank = (name) => (name === "All branches" ? 1 : name === "No branch assigned" ? 2 : 0);
    return [...byBranch.entries()]
      .map(([branch, byRole]) => ({
        branch,
        people: [...byRole.values()].reduce((n, list) => n + list.length, 0),
        roles: [...byRole.entries()]
          .map(([role, list]) => ({ role, list }))
          .sort((a, b) => a.role.localeCompare(b.role)),
      }))
      .sort((a, b) => rank(a.branch) - rank(b.branch) || a.branch.localeCompare(b.branch));
  }, [sortedUsers]);

  const changeRole = async (u, role) => {
    try { await hrUpdateUserRole(u.id, role); toast.success("Role updated"); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  // flex+gap, not space-y — the mobile-only toolbar/cards and the desktop table are
  // each hidden by class depending on breakpoint, not the hidden attribute.
  return (
    <div className="flex flex-col gap-4" data-testid="hr-roles-tab">
      {/* Same department/designation pills as the Employees tab, reading off each row's
          linked employee — one block rather than one per breakpoint, since TabPill
          already wraps on a narrow screen and the state behind it is shared either way. */}
      <div className="flex flex-wrap items-center gap-2" data-testid="hr-roles-dept-filter">
        <TabPill active={deptFilter === ""} onClick={() => selectDept("")} testid="hr-roles-dept-filter-all">
          All Departments
        </TabPill>
        {meta.departments.map((d) => (
          <TabPill key={d} active={deptFilter === d} onClick={() => selectDept(d)} testid={`hr-roles-dept-filter-${d}`}>
            {titleCase(d)}
          </TabPill>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2" data-testid="hr-roles-designation-filter">
        <TabPill active={designationFilter === ""} onClick={() => setDesignationFilter("")} testid="hr-roles-designation-filter-all">
          All Designations
        </TabPill>
        {designationOptions.map((d) => (
          <TabPill key={d} active={designationFilter === d} onClick={() => setDesignationFilter(d)} testid={`hr-roles-designation-filter-${d}`}>
            {titleCase(d)}
          </TabPill>
        ))}
      </div>

      {/* Two questions, two shapes. The list answers "who is this person and what can
          they do"; Branch Wise answers "which desks are staffed here, and by whom". */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-white p-1" data-testid="hr-roles-view">
        {[{ key: "list", label: "All Users" }, { key: "branch", label: "Branch Wise" }].map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => setView(v.key)}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${view === v.key ? "bg-sky-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
            data-testid={`hr-roles-view-${v.key}`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view === "branch" && (
        <div className="space-y-3" data-testid="hr-branch-wise">
          {branchGroups.map((g) => (
            <Card key={g.branch} data-testid={`hr-branch-group-${g.branch}`}>
              <CardHeader className="flex flex-row items-center justify-between gap-2 py-3">
                <CardTitle className="text-sm font-semibold text-slate-800">{g.branch}</CardTitle>
                <span className="shrink-0 rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                  {g.roles.length} {g.roles.length === 1 ? "role" : "roles"} · {g.people} {g.people === 1 ? "person" : "people"}
                </span>
              </CardHeader>
              <CardContent className="space-y-1.5 p-0 pb-3">
                {g.roles.map(({ role, list }) => (
                  <div key={role} className="flex flex-wrap items-start gap-2 px-4 py-1.5" data-testid={`hr-branch-role-${role}`}>
                    <span className={`w-44 shrink-0 rounded px-2 py-0.5 text-[11px] font-bold ${roleClasses(list[0].role)}`}>{role}</span>
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      {list.map((u) => (
                        <span key={u.id} className="inline-flex items-center gap-1.5 text-xs text-slate-700" title={u.email}>
                          {u.full_name}
                          {/* An account switched off is still on the roster and still
                              holds the desk, so it is shown and marked rather than hidden
                              — a branch reading as staffed by somebody who cannot log in
                              is the thing worth seeing. */}
                          {u.is_active === false && (
                            <span className="rounded bg-slate-200 px-1 py-px text-[9px] font-bold text-slate-500">INACTIVE</span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
          {branchGroups.length === 0 && (
            <p className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">No users.</p>
          )}
        </div>
      )}

      <div className={`flex flex-wrap items-center gap-2 md:hidden ${view === "branch" ? "hidden" : ""}`}>
        <button
          onClick={() => setSortAZ((s) => (s === "asc" ? "desc" : "asc"))}
          className={`rounded-md px-3 py-2 text-sm font-medium ${sortAZ ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-600"}`}
          data-testid="hr-roles-sort-az-mobile"
        >
          {sortAZ === "desc" ? "Z → A" : "A → Z"}
        </button>
        <RoleFilterDropdown value={roleFilter} options={meta.roles} onChange={setRoleFilter} />
        <Input placeholder="Search name or email..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full" data-testid="hr-roles-search-mobile" />
        <Button onClick={() => setShowCreate(true)} className="flex-1 bg-sky-600 hover:bg-sky-700" data-testid="hr-roles-create-btn-mobile"><UserPlus className="h-4 w-4 mr-1" />Create User</Button>
      </div>

      <div className={`space-y-2 md:hidden ${view === "branch" ? "hidden" : ""}`} data-testid="hr-user-cards">
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
              <div className="w-40">
                <RoleCellDropdown
                  value={u.role}
                  options={meta.roles}
                  onChange={(r) => changeRole(u, r)}
                  subject={u.full_name}
                  testid={`hr-user-card-role-${u.id}`}
                />
              </div>
              <span className={`rounded px-2 py-0.5 text-xs ${u.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>{u.is_active ? "Active" : "Inactive"}</span>
            </div>
            {u.linked_employee && (
              <p className="mt-1.5 text-xs text-emerald-600">{u.linked_employee.employee_code} - {u.linked_employee.designation || u.linked_employee.full_name}</p>
            )}
          </div>
        ))}
        {sortedUsers.length === 0 && <p className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">No users.</p>}
      </div>

      <Card className={`hidden ${view === "branch" ? "" : "md:block"}`}>
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
                      <div className="w-44">
                        <RoleCellDropdown
                          value={u.role}
                          options={meta.roles}
                          onChange={(r) => changeRole(u, r)}
                          subject={u.full_name}
                          testid={`hr-user-role-${u.id}`}
                        />
                      </div>
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
  const roleLabelForMulti = multiBranchLabel(user.role);
  const isMultiBranchRole = Boolean(roleLabelForMulti);
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
    if (isMultiBranchRole && !BRANCHLESS_OK_ROLES.has(user.role) && editForm.branch_ids.length === 0) {
      toast.error("Select at least one branch"); return;
    }
    try {
      setBusy(true);
      // branch_ids only applies (and is only sent) for Head Physio/Physio — every other
      // role keeps its single `branch_id` select untouched by the multi-branch field.
      const { branch_ids, branch_id, ...rest } = editForm;
      const payload = isMultiBranchRole ? { ...rest, branch_ids } : { ...rest, branch_id };
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

            {/* Violet, not blue — Edit sits right above this in the same blue the rest of
                the app now uses, and two actions in one colour here would read as one. */}
            <button
              onClick={() => setMode("password")}
              className="flex items-center gap-3 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2.5 text-left hover:bg-violet-100"
              data-testid="hr-actions-change-password"
            >
              <KeyRound className="h-4 w-4 text-violet-600" />
              <div>
                <p className="text-sm font-semibold text-violet-700">Change Password</p>
                <p className="text-[11px] text-violet-600">Set a new password for this user.</p>
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
            {isMultiBranchRole ? (
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
            {/* Mobile and Aadhar are gone from here. They belong to the employee record
                in HR, not to the login account this popup edits, and were the two fields
                nobody filled in. Still sent unchanged in the payload below, so a value
                already stored against an account is not wiped by saving this form. */}
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
              <Button onClick={submitPwd} disabled={busy} className="flex-1 bg-violet-600 hover:bg-violet-700" data-testid="hr-actions-password-save">Update Password</Button>
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

/**
 * Picks a designation (from Departments & Designation), not a raw role slug — the caller
 * resolves that pick to an actual access role.
 *
 * A dialog rather than a panel: this sits inside a modal that already scrolls, and a list
 * hanging off a field within it was cropped by the dialog's own overflow. The list is also
 * long enough to want the whole screen rather than the gap under one field.
 */
const RoleSelectDropdown = ({ value, options, onChange }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 text-left text-sm text-slate-700"
        data-testid="hr-create-user-role"
      >
        <span className={`truncate ${value ? "" : "text-slate-400"}`}>{value || "Select role"}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
      </button>
      {open && (
        <PickerModal
          title="Select role"
          value={value || ""}
          options={options.map((o) => ({ value: o, label: o }))}
          onPick={(v) => { setOpen(false); onChange(v); }}
          onClose={() => setOpen(false)}
          searchable
          searchPlaceholder="Search role..."
        />
      )}
    </>
  );
};

// Designation text (e.g. "HEAD PHYSIO") reuses the same role coloring as
// roleClasses/roleLabel by converting it back to a role slug ("head_physio").
const designationSlug = (designation) => (designation || "").trim().toLowerCase().replace(/\s+/g, "_");

/**
 * Picks the employee a login belongs to. Searchable, because this list runs to the whole
 * payroll and scrolling seventy rows to find one name is the slow way to do it.
 *
 * The code, the name and the designation are all searched, since any of the three is what
 * somebody happens to know when they come looking.
 */
const EmployeeSelectDropdown = ({ value, employees, onChange }) => {
  const [open, setOpen] = useState(false);
  const selected = employees.find((e) => e.id === value);
  const label = (e) => `${e.employee_code} — ${e.full_name} (${e.designation || "—"})`;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 text-left text-sm text-slate-700"
        data-testid="hr-create-user-emp"
      >
        <span className={`truncate ${selected ? "" : "text-slate-400"}`}>
          {selected ? label(selected) : "Select employee..."}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
      </button>
      {open && (
        <PickerModal
          title="Link to Employee"
          value={value || ""}
          options={[
            { value: "", label: "Select employee..." },
            ...employees.map((e) => ({
              value: e.id,
              label: label(e),
              search: `${e.employee_code || ""} ${e.full_name || ""} ${e.designation || ""}`,
            })),
          ]}
          onPick={(v) => { setOpen(false); onChange(v); }}
          onClose={() => setOpen(false)}
          searchable
          searchPlaceholder="Search employee..."
        />
      )}
    </>
  );
};

/** Picks the branch a login is scoped to, in the same dialog the other two use. */
const BranchSelectDropdown = ({ value, branches, onChange }) => {
  const [open, setOpen] = useState(false);
  const selected = branches.find((b) => b.id === value);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 text-left text-sm text-slate-700"
        data-testid="hr-create-user-branch"
      >
        <span className={`truncate ${selected ? "" : "text-slate-400"}`}>{selected ? selected.branch_name : "No branch"}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
      </button>
      {open && (
        <PickerModal
          title="Select branch"
          value={value || ""}
          options={[
            { value: "", label: "No branch", hint: "Not tied to a branch" },
            ...branches.map((b) => ({ value: b.id, label: b.branch_name })),
          ]}
          onPick={(v) => { setOpen(false); onChange(v); }}
          onClose={() => setOpen(false)}
          checkbox
        />
      )}
    </>
  );
};

const CreateUserModal = ({ meta, reloadMeta, onClose, onSaved }) => {
  const [employees, setEmployees] = useState([]);
  const [branches, setBranches] = useState([]);
  const [form, setForm] = useState({ employee_id: "", full_name: "", email: "", role: "", branch_id: "", branch_ids: [], password: "", confirm: "" });
  const roleLabelForMulti = multiBranchLabel(form.role);
  const isMultiBranchRole = Boolean(roleLabelForMulti);
  // What was actually clicked in the dropdown — kept separate from form.role (which always
  // ends up holding a real access-role slug) purely so the dropdown can show and highlight
  // the designation text the account was set up from.
  const [selectedDesignation, setSelectedDesignation] = useState("");
  const [resolvingRole, setResolvingRole] = useState(false);
  useEffect(() => { hrEmployees({ status: "active" }).then(setEmployees).catch((e) => console.warn("[load failed]", e?.message || e)); }, []);
  useEffect(() => { getBranches().then(setBranches).catch((e) => console.warn("[load failed]", e?.message || e)); }, []);

  const pickEmployee = (id) => {
    const emp = employees.find((e) => e.id === id);
    setForm((p) => ({ ...p, employee_id: id, full_name: emp?.full_name || p.full_name, email: emp?.email || p.email }));
  };

  // Letters only, so "Branch Admin ( Physio )" and "branch_admin_physio"'s own label both
  // normalize the same way — matching a Departments & Designation title back to whichever
  // real access role (built-in or already-created custom) it stands for.
  const key = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

  const roleLabelToSlug = useMemo(() => {
    const map = {};
    Object.entries(ROLE_META).forEach(([slug, m]) => { map[key(m.label)] = slug; });
    (meta.custom_roles || []).forEach((r) => { if (r.name && r.label) map[key(r.label)] = r.name; });
    return map;
  }, [meta.custom_roles]);

  // Every designation across every department, plus every role added under Create Role.
  //
  // The roles were the half that was missing. A role is created in order to be given to
  // somebody, and listing designations alone meant the only way to reach a freshly created
  // one was to type its title a second time as a designation — the picker offering no
  // trace of the role that had just been made.
  //
  // Deduped on the same letters-only key the resolver matches by, so a designation and a
  // role of the same name ("Zumba Master" and ZUMBA MASTER) are one row, not two that pick
  // the same account role. Super Admin never shows: that account can only be created via
  // the OTP-approved Super Admin creation page.
  const designationOptions = useMemo(() => {
    const seen = new Set();
    const labels = [];
    const add = (label) => {
      const k = key(label);
      if (!k || seen.has(k) || roleLabelToSlug[k] === "super_admin") return;
      seen.add(k);
      labels.push(label);
    };
    Object.values(meta.department_designations || {}).forEach((list) => (list || []).forEach(add));
    (meta.custom_roles || []).forEach((r) => add(r.label || r.name));
    return labels.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [meta.department_designations, meta.custom_roles, roleLabelToSlug]);

  // A designation that already matches a real access role (built-in or previously created)
  // is used as-is. One that doesn't is created as a new role from that exact title — the
  // same thing "+ Add New Role" used to do by typing, just always sourced from a job title
  // that already exists in HR. Either way the field a moment later holds a real role slug.
  const pickDesignation = async (label) => {
    setSelectedDesignation(label);
    const existingSlug = roleLabelToSlug[key(label)];
    if (existingSlug) { setForm((p) => ({ ...p, role: existingSlug })); return; }
    setResolvingRole(true);
    try {
      const created = await hrAddCustomRole(label);
      await reloadMeta?.();
      setForm((p) => ({ ...p, role: created.name }));
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to set role");
      setSelectedDesignation("");
    }
    setResolvingRole(false);
  };

  const submit = async () => {
    if (resolvingRole) { toast.error("Still setting up that role — one moment"); return; }
    if (!form.email || !form.password || !form.role) { toast.error("Email, role, password required"); return; }
    if (form.password.length < 6) { toast.error("Min 6 characters"); return; }
    if (form.password !== form.confirm) { toast.error("Passwords do not match"); return; }
    if (isMultiBranchRole && !BRANCHLESS_OK_ROLES.has(form.role) && form.branch_ids.length === 0) {
      toast.error("Select at least one branch"); return;
    }
    try {
      await hrCreateUser({
        full_name: form.full_name || form.email.split("@")[0],
        email: form.email,
        password: form.password,
        role: form.role,
        employee_id: form.employee_id || null,
        ...(isMultiBranchRole ? { branch_ids: form.branch_ids }
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
            value={selectedDesignation}
            options={designationOptions}
            onChange={pickDesignation}
          />
          {/* Only the in-progress line is left. The paragraph that stood here explained
              where roles come from and what happens to a new one — background a reader of
              this form does not need at the moment they are filling it in. */}
          {resolvingRole && <p className="mt-1 text-[10px] text-slate-400">Setting up that role...</p>}
        </Field>
        {isMultiBranchRole ? (
          <Field label={`Branches (${roleLabelForMulti} can cover more than one)`}>
            <div className="space-y-1.5 rounded-md border border-slate-200 p-2" data-testid="hr-create-user-branch-ids">
              {/* All Branches, said out loud.
                  Covering everything has always been how this OS stores it — an org-wide
                  role holding no branches — but the only way to reach it was to leave every
                  box unticked and know that meant "all" rather than "none unset yet". The
                  table two clicks away has been printing "All branches" for exactly that
                  state all along, so the two now use one word for one thing.
                  Ticking it clears the individual picks, because "all" and "these three"
                  cannot both be true and leaving stale ticks underneath would suggest they
                  were. */}
              {BRANCHLESS_OK_ROLES.has(form.role) && (
                <label className="flex items-center gap-2 rounded px-1.5 py-1 text-sm font-semibold text-sky-700 hover:bg-sky-50" data-testid="hr-create-user-branch-all-label">
                  <input
                    type="checkbox"
                    checked={form.branch_ids.length === 0}
                    onChange={(e) => { if (e.target.checked) setForm({ ...form, branch_ids: [] }); }}
                    data-testid="hr-create-user-branch-all"
                  />
                  All Branches
                </label>
              )}
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
