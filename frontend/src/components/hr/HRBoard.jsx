import { useCallback, useEffect, useRef, useState } from "react";
import { Users, ShieldCheck, BarChart3, Plus, Pencil, Trash2, Eye, KeyRound, X, UserPlus, Stethoscope, MoreVertical, CheckCircle2, XCircle, AlertOctagon, ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import {
  hrDashboard, hrEmployees, hrCreateEmployee, hrUpdateEmployee, hrDeleteEmployee,
  hrUsers, hrCreateUser, hrUpdateUser, hrResetPassword, hrDeactivateUser, hrActivateUser, hrDeleteUserPermanent, hrUpdateUserRole, hrMeta, hrAddCustomRole,
  getBranches, getDoctors, createDoctor, deleteDoctor, addDoctorSlots,
} from "@/lib/api";

const TABS = [
  { key: "dashboard", label: "Dashboard", icon: BarChart3 },
  { key: "employees", label: "Employees", icon: Users },
  { key: "experts", label: "Fitsiomax Experts", icon: Stethoscope },
  { key: "roles", label: "Roles & Credentials", icon: ShieldCheck },
];

export const HRBoard = () => {
  const [tab, setTab] = useState("dashboard");
  const [meta, setMeta] = useState({ departments: [], roles: [], custom_roles: [] });
  const reloadMeta = useCallback(() => hrMeta().then(setMeta).catch((e) => console.warn("[load failed]", e?.message || e)), []);
  useEffect(() => { reloadMeta(); }, [reloadMeta]);
  return (
    <div className="space-y-5" data-testid="hr-board">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">HR Admin</h2>
        <p className="text-sm text-slate-500">Manage employees, attendance, leave & payroll.</p>
      </div>
      <div className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-1" data-testid="hr-subtabs">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)} data-testid={`hr-subtab-${t.key}`} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${active ? "bg-orange-50 text-orange-600" : "text-slate-600 hover:bg-slate-50"}`}>
              <Icon className="h-4 w-4" />{t.label}
            </button>
          );
        })}
      </div>
      {tab === "dashboard" && <DashboardTab />}
      {tab === "employees" && <EmployeesTab meta={meta} />}
      {tab === "experts" && <FitsiomaxExpertsTab />}
      {tab === "roles" && <RolesTab meta={meta} reloadMeta={reloadMeta} />}
    </div>
  );
};

// ---------- Dashboard ----------

const KPI = ({ label, value, color, testid }) => (
  <div className="rounded-xl border bg-white p-4 shadow-sm" style={{ borderLeftColor: color, borderLeftWidth: 4 }} data-testid={testid}>
    <p className="text-xs text-slate-500">{label}</p>
    <p className="mt-1 text-3xl font-bold text-slate-900">{value}</p>
  </div>
);

const DashboardTab = () => {
  const [data, setData] = useState(null);
  useEffect(() => { hrDashboard().then(setData).catch(() => toast.error("Failed to load")); }, []);
  if (!data) return <p className="text-sm text-slate-500">Loading...</p>;
  const k = data.kpis;
  return (
    <div className="space-y-5" data-testid="hr-dashboard-tab">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <KPI label="Active Employees" value={k.active_employees} color="#f97316" testid="hr-kpi-active" />
        <KPI label="Total Users" value={k.total_users} color="#3b82f6" testid="hr-kpi-users" />
        <KPI label="Present Today" value={k.present_today} color="#22c55e" testid="hr-kpi-present" />
        <KPI label="Late Today" value={k.late_today} color="#ef4444" testid="hr-kpi-late" />
        <KPI label="Pending Leaves" value={k.pending_leaves} color="#a855f7" testid="hr-kpi-leaves" />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card data-testid="hr-monthly-salary"><CardHeader><CardTitle className="text-base">Monthly Salary Budget</CardTitle></CardHeader><CardContent><p className="text-3xl font-bold text-emerald-600">₹{(k.monthly_salary_budget || 0).toLocaleString("en-IN")}</p></CardContent></Card>
        <Card data-testid="hr-dept-count"><CardHeader><CardTitle className="text-base">Departments</CardTitle></CardHeader><CardContent><p className="text-3xl font-bold text-slate-900">{k.departments}</p></CardContent></Card>
      </div>
      <Card data-testid="hr-dept-strength">
        <CardHeader><CardTitle className="text-base">Department Strength</CardTitle></CardHeader>
        <CardContent>
          {data.department_strength.length === 0 ? <p className="text-sm text-slate-400">No employees yet.</p> : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {data.department_strength.map((d) => (
                <div key={d.name} className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-center" data-testid={`hr-dept-${d.name}`}>
                  <p className="text-sm text-slate-600">{d.name}</p>
                  <p className="mt-1 text-2xl font-bold text-orange-500">{d.count}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

// ---------- Employees ----------

const EmployeesTab = ({ meta }) => {
  const [employees, setEmployees] = useState([]);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("active");
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = useCallback(() => hrEmployees({ status: filterStatus === "all" ? "" : filterStatus }).then(setEmployees).catch((e) => console.warn("[load failed]", e?.message || e)), [filterStatus]);
  useEffect(() => { load(); }, [load]);

  const filtered = employees.filter((e) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (e.full_name || "").toLowerCase().includes(q) || (e.email || "").toLowerCase().includes(q) || (e.employee_code || "").toLowerCase().includes(q);
  });

  const remove = async (emp) => {
    if (!window.confirm(`Delete employee ${emp.full_name}?`)) return;
    try { await hrDeleteEmployee(emp.id); toast.success("Deleted"); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Delete failed"); }
  };

  const active = employees.filter((e) => (e.status || "active") === "active").length;
  const left = employees.filter((e) => (e.status || "active") !== "active").length;

  return (
    <div className="space-y-4" data-testid="hr-employees-tab">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setFilterStatus("active")} className={`rounded-md px-3 py-2 text-sm font-medium ${filterStatus === "active" ? "bg-orange-500 text-white" : "bg-slate-100 text-slate-600"}`} data-testid="hr-emp-tab-active">Active Employees ({active})</button>
        <button onClick={() => setFilterStatus("left")} className={`rounded-md px-3 py-2 text-sm font-medium ${filterStatus === "left" ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-600"}`} data-testid="hr-emp-tab-left">Left ({left})</button>
        <div className="flex-1" />
        <Input placeholder="Search employee..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" data-testid="hr-emp-search" />
        <Button onClick={() => { setEditing(null); setShowAdd(true); }} className="bg-orange-500 hover:bg-orange-600" data-testid="hr-emp-add-btn"><Plus className="h-4 w-4 mr-1" />Add Employee</Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Employee Directory</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr><th className="px-3 py-2">Employee</th><th className="px-3 py-2">Dept</th><th className="px-3 py-2">Designation</th><th className="px-3 py-2">Contact</th><th className="px-3 py-2">Joining</th><th className="px-3 py-2">Net Salary</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Actions</th></tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`hr-emp-row-${e.id}`}>
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
                      <div className="flex gap-2">
                        <button className="text-slate-500 hover:text-sky-600" data-testid={`hr-emp-view-${e.id}`}><Eye className="h-4 w-4" /></button>
                        <button onClick={() => { setEditing(e); setShowAdd(true); }} className="text-blue-500 hover:text-blue-700" data-testid={`hr-emp-edit-${e.id}`}><Pencil className="h-4 w-4" /></button>
                        <button onClick={() => remove(e)} className="text-red-500 hover:text-red-700" data-testid={`hr-emp-delete-${e.id}`}><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan="8" className="px-3 py-6 text-center text-slate-400">No employees.</td></tr>}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {showAdd && <AddEmployeeModal employee={editing} meta={meta} onClose={() => { setShowAdd(false); setEditing(null); }} onSaved={() => { setShowAdd(false); setEditing(null); load(); }} />}
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

  const submit = async () => {
    if (!form.full_name.trim()) { toast.error("Full name required"); setTab("personal"); return; }
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
              <Field label="Date of Birth"><Input type="date" value={form.dob} onChange={(e) => set("dob", e.target.value)} data-testid="hr-emp-dob" /></Field>
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
              <Field label="Department"><Select value={form.department} onChange={(v) => set("department", v)} options={["", ...meta.departments]} testid="hr-emp-dept" /></Field>
              <Field label="Designation"><Input value={form.designation} onChange={(e) => set("designation", e.target.value)} data-testid="hr-emp-designation" /></Field>
              <Field label="Joining Date"><Input type="date" value={form.joining_date} onChange={(e) => set("joining_date", e.target.value)} data-testid="hr-emp-joining" /></Field>
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
  branch_admin: { label: "BRANCH ADMIN", classes: "border-emerald-300 bg-emerald-50 text-emerald-700" },
  head_physio: { label: "HEAD PHYSIO", classes: "border-amber-300 bg-amber-50 text-amber-700" },
  physio: { label: "PHYSIO", classes: "border-cyan-300 bg-cyan-50 text-cyan-700" },
  marketing_head: { label: "MARKETING HEAD", classes: "border-pink-300 bg-pink-50 text-pink-700" },
  accountant: { label: "ACCOUNTANT", classes: "border-orange-300 bg-orange-50 text-orange-700" },
};
const roleLabel = (role) => ROLE_META[role]?.label || role.replace(/_/g, " ").toUpperCase();
const roleClasses = (role) => ROLE_META[role]?.classes || "border-slate-200 bg-white text-slate-600";

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

const RolesTab = ({ meta, reloadMeta }) => {
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [actionTarget, setActionTarget] = useState(null);

  const load = useCallback(() => hrUsers({ search, role: roleFilter !== "all" ? roleFilter : undefined }).then(setUsers).catch((e) => console.warn("[load failed]", e?.message || e)), [search, roleFilter]);
  useEffect(() => { load(); }, [load]);

  const changeRole = async (u, role) => {
    try { await hrUpdateUserRole(u.id, role); toast.success("Role updated"); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  return (
    <div className="space-y-4" data-testid="hr-roles-tab">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">User Roles & Credentials</CardTitle>
          <div className="flex gap-2">
            <Input placeholder="Search name or email..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" data-testid="hr-roles-search" />
            <RoleFilterDropdown value={roleFilter} options={meta.roles} onChange={setRoleFilter} />
            <Button onClick={() => setShowCreate(true)} className="bg-sky-600 hover:bg-sky-700" data-testid="hr-roles-create-btn"><UserPlus className="h-4 w-4 mr-1" />Create User</Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">User</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">Role</th><th className="px-3 py-2">Linked Employee</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Actions</th></tr></thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`hr-user-row-${u.id}`}>
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
                {users.length === 0 && <tr><td colSpan="6" className="px-3 py-6 text-center text-slate-400">No users.</td></tr>}
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
  const [editForm, setEditForm] = useState({
    full_name: user.full_name || "",
    email: user.email || "",
    branch_id: user.branch_id || "",
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
    try {
      setBusy(true);
      await hrUpdateUser(user.id, editForm);
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
            <Field label="Branch">
              <select className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" value={editForm.branch_id} onChange={(e) => setEditForm({ ...editForm, branch_id: e.target.value })} data-testid="hr-actions-edit-branch">
                <option value="">No branch</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.branch_name}</option>)}
              </select>
            </Field>
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
            <Input type="password" placeholder="New password (min 6)" value={pwd} onChange={(e) => setPwd(e.target.value)} data-testid="hr-actions-password-new" />
            <Input type="password" placeholder="Confirm new password" value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} data-testid="hr-actions-password-confirm" />
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
  const [form, setForm] = useState({ employee_id: "", full_name: "", email: "", role: "", branch_id: "", password: "", confirm: "" });
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
    try {
      await hrCreateUser({ full_name: form.full_name || form.email.split("@")[0], email: form.email, password: form.password, role: form.role, branch_id: form.branch_id || null, employee_id: form.employee_id || null });
      toast.success("User created");
      onSaved();
    } catch (e) { toast.error(e?.response?.data?.detail || "Create failed"); }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" data-testid="hr-create-user-modal">
      <div className="w-full max-w-md space-y-3 rounded-lg bg-white p-5 shadow-xl">
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
        <Field label="Branch (optional)">
          <BranchSelectDropdown value={form.branch_id} branches={branches} onChange={(id) => setForm({ ...form, branch_id: id })} />
        </Field>
        <Field label="Password *"><Input type="password" placeholder="Min 6 characters" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} data-testid="hr-create-user-pwd" /></Field>
        <Field label="Confirm Password *"><Input type="password" placeholder="Confirm password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} data-testid="hr-create-user-confirm" /></Field>
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

const Select = ({ value, onChange, options = [], testid }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)} className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" data-testid={testid}>
    {options.map((o) => <option key={o} value={o}>{o || "Select"}</option>)}
  </select>
);

// ---------- Fitsiomax Experts (moved from Super Admin Master View) ----------
const blankExpertForm = { full_name: "", profile_type: "physio", branch_id: "", employee_id: "", specialization: "", joining_date: "", slot: "" };

const FitsiomaxExpertsTab = () => {
  const [doctors, setDoctors] = useState([]);
  const [branches, setBranches] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [form, setForm] = useState(blankExpertForm);
  const [saving, setSaving] = useState(false);

  const [slotDoctorId, setSlotDoctorId] = useState("");
  const [slotTime, setSlotTime] = useState("");

  const reloadList = async () => {
    const [docsRes, brsRes, empsRes] = await Promise.allSettled([
      getDoctors(), getBranches(), hrEmployees({ status: "active" }),
    ]);
    if (docsRes.status === "fulfilled") setDoctors(docsRes.value || []);
    else console.error("[Fitsiomax Experts] getDoctors failed:", docsRes.reason);
    if (brsRes.status === "fulfilled") setBranches(brsRes.value || []);
    else console.error("[Fitsiomax Experts] getBranches failed:", brsRes.reason);
    if (empsRes.status === "fulfilled") setEmployees(empsRes.value || []);
    else console.error("[Fitsiomax Experts] hrEmployees failed:", empsRes.reason);

    const failed = [
      docsRes.status === "rejected" && "experts",
      brsRes.status === "rejected" && "branches",
      empsRes.status === "rejected" && "employees",
    ].filter(Boolean);
    if (failed.length) toast.error(`Failed to load: ${failed.join(", ")}`);
  };

  useEffect(() => { reloadList(); }, []);

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const pickEmployee = (id) => {
    const emp = employees.find((e) => e.id === id);
    setForm((p) => ({ ...p, employee_id: id, full_name: p.full_name || emp?.full_name || "" }));
  };

  const resetForm = () => { setForm(blankExpertForm); };

  const finishWithSlot = async (doctorId) => {
    if (!form.slot) return;
    try { await addDoctorSlots(doctorId, { slots: [form.slot] }); }
    catch { toast.error("Expert created, but the initial slot failed to save — add it below instead"); }
  };

  const submitCreate = async (event) => {
    event.preventDefault();
    if (!form.full_name.trim()) { toast.error("Enter a name"); return; }
    if (!form.branch_id) { toast.error("Choose a branch"); return; }

    try {
      setSaving(true);
      const created = await createDoctor({
        full_name: form.full_name,
        profile_type: form.profile_type,
        branch_id: form.branch_id,
        specialization: form.specialization,
        employee_id: form.employee_id || null,
        joining_date: form.joining_date || null,
      });
      await finishWithSlot(created.id);
      resetForm();
      await reloadList();
      toast.success("Fitsiomax Expert created");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to create");
    } finally {
      setSaving(false);
    }
  };

  const removeDoctor = async (doctor) => {
    if (!window.confirm(`Delete expert profile "${doctor.full_name}"?`)) return;
    try {
      await deleteDoctor(doctor.id);
      toast.success("Expert deleted");
      await reloadList();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Delete failed");
    }
  };

  const addSlotNow = async (event) => {
    event.preventDefault();
    if (!slotDoctorId || !slotTime) {
      toast.error("Select expert and slot time");
      return;
    }
    try {
      setSaving(true);
      await addDoctorSlots(slotDoctorId, { slots: [slotTime] });
      setSlotTime("");
      toast.success("Slot added");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to add slot");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-slate-200 bg-white" data-testid="hr-experts-card">
      <CardHeader>
        <CardTitle className="text-base">Fitsiomax Experts</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500" data-testid="hr-experts-add-heading">Create Physio / Head Physio / Doctor</p>
            <form className="grid gap-2 md:grid-cols-3" onSubmit={submitCreate} data-testid="hr-experts-create-form">
              <Field label="Name *">
                <Input value={form.full_name} onChange={(e) => set("full_name", e.target.value)} placeholder="Expert name" data-testid="hr-experts-name-input" />
              </Field>
              <Field label="Type *">
                <select value={form.profile_type} onChange={(e) => set("profile_type", e.target.value)} className="h-9 w-full rounded-md border border-slate-200 px-3 text-sm" data-testid="hr-experts-profile-select">
                  <option value="physio">Physio</option>
                  <option value="head_physio">Head Physio</option>
                  <option value="doctor">Doctor</option>
                </select>
              </Field>
              <Field label="Branch *">
                <select value={form.branch_id} onChange={(e) => set("branch_id", e.target.value)} className="h-9 w-full rounded-md border border-slate-200 px-3 text-sm" data-testid="hr-experts-branch-select">
                  <option value="">Select branch...</option>
                  {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.branch_name}</option>)}
                </select>
              </Field>
              <Field label="Assign Fitsiomax Expert (optional)" className="md:col-span-2">
                <div className="flex gap-2">
                  <select value={form.employee_id} onChange={(e) => pickEmployee(e.target.value)} className="h-9 w-full rounded-md border border-slate-200 px-3 text-sm" data-testid="hr-experts-employee-select">
                    <option value="">Link to an existing employee...</option>
                    {employees.map((e) => <option key={e.id} value={e.id}>{e.employee_code ? `${e.employee_code} — ` : ""}{e.full_name}{e.email ? ` (${e.email})` : ""}</option>)}
                  </select>
                  {form.employee_id && (
                    <Button type="button" variant="outline" onClick={() => set("employee_id", "")} data-testid="hr-experts-employee-unlink">
                      Unlink
                    </Button>
                  )}
                </div>
              </Field>
              <Field label="Joining Date">
                <Input type="date" value={form.joining_date} onChange={(e) => set("joining_date", e.target.value)} data-testid="hr-experts-joining-input" />
              </Field>
              <Field label="Specialization" className="md:col-span-2">
                <Input value={form.specialization} onChange={(e) => set("specialization", e.target.value)} placeholder="e.g. Sports Physiotherapy" data-testid="hr-experts-specialization-input" />
              </Field>
              <Field label="Initial Slot (optional)">
                <Input type="datetime-local" value={form.slot} onChange={(e) => set("slot", e.target.value)} data-testid="hr-experts-initial-slot-input" />
              </Field>
              <div className="md:col-span-3">
                <Button type="submit" disabled={saving} data-testid="hr-experts-create-submit">
                  Create Fitsiomax Expert
                </Button>
              </div>
            </form>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500" data-testid="hr-experts-list-heading">Existing Experts</p>
          <div className="overflow-auto rounded-md border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Branch</th><th className="px-3 py-2">Specialization</th><th className="px-3 py-2">Actions</th></tr>
              </thead>
              <tbody>
                {doctors.map((d) => (
                  <tr key={d.id} className="border-t border-slate-100" data-testid={`hr-experts-row-${d.id}`}>
                    <td className="px-3 py-2 font-medium text-slate-800">{d.full_name}</td>
                    <td className="px-3 py-2 text-slate-600">{d.profile_type}</td>
                    <td className="px-3 py-2 text-slate-600">{branches.find((b) => b.id === d.branch_id)?.branch_name || "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{d.specialization || "—"}</td>
                    <td className="px-3 py-2">
                      <button onClick={() => removeDoctor(d)} className="text-red-500 hover:text-red-700" title="Delete expert profile" data-testid={`hr-experts-delete-${d.id}`}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {doctors.length === 0 && <tr><td colSpan="5" className="px-3 py-6 text-center text-slate-400">No experts yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Add Availability Slot to an Existing Expert</p>
          <form className="flex flex-col gap-2" onSubmit={addSlotNow} data-testid="hr-experts-slot-form">
            <select
              value={slotDoctorId}
              onChange={(e) => setSlotDoctorId(e.target.value)}
              className="h-9 rounded-md border border-slate-200 px-3 text-sm"
              data-testid="hr-experts-slot-doctor-select"
            >
              <option value="">Select expert...</option>
              {doctors.map((doctor) => (
                <option key={doctor.id} value={doctor.id}>{doctor.full_name}</option>
              ))}
            </select>
            <Input
              type="datetime-local"
              value={slotTime}
              onChange={(e) => setSlotTime(e.target.value)}
              data-testid="hr-experts-slot-time-input"
            />
            <Button type="submit" variant="outline" disabled={saving} data-testid="hr-experts-slot-submit">Add Slot</Button>
          </form>
        </div>
      </CardContent>
    </Card>
  );
};

export default HRBoard;
