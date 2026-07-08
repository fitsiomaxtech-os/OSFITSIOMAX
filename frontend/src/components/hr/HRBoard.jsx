import { useCallback, useEffect, useState } from "react";
import { Users, ShieldCheck, BarChart3, Plus, Pencil, Trash2, Eye, KeyRound, X, UserPlus, Stethoscope, MoreVertical, CheckCircle2, XCircle, AlertOctagon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import {
  hrDashboard, hrEmployees, hrCreateEmployee, hrUpdateEmployee, hrDeleteEmployee,
  hrUsers, hrCreateUser, hrResetPassword, hrDeactivateUser, hrActivateUser, hrDeleteUserPermanent, hrUpdateUserRole, hrMeta,
  getBranches, getDoctors, createDoctor, addDoctorSlots,
} from "@/lib/api";

const TABS = [
  { key: "dashboard", label: "Dashboard", icon: BarChart3 },
  { key: "employees", label: "Employees", icon: Users },
  { key: "experts", label: "Fitsiomax Experts", icon: Stethoscope },
  { key: "roles", label: "Roles & Credentials", icon: ShieldCheck },
];

export const HRBoard = () => {
  const [tab, setTab] = useState("dashboard");
  const [meta, setMeta] = useState({ departments: [], roles: [] });
  useEffect(() => { hrMeta().then(setMeta).catch((e) => console.warn("[load failed]", e?.message || e)); }, []);
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
      {tab === "roles" && <RolesTab meta={meta} />}
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

const RolesTab = ({ meta }) => {
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
            <Select value={roleFilter} onChange={setRoleFilter} options={["all", ...meta.roles]} testid="hr-roles-role-filter" />
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
                      <select value={u.role} onChange={(e) => changeRole(u, e.target.value)} className="h-7 rounded border border-slate-200 px-2 text-xs text-blue-600" data-testid={`hr-user-role-${u.id}`}>
                        {meta.roles.map((r) => <option key={r} value={r}>{r}</option>)}
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

      {showCreate && <CreateUserModal meta={meta} onClose={() => setShowCreate(false)} onSaved={() => { setShowCreate(false); load(); }} />}

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
  const [mode, setMode] = useState(null); // null | "password" | "delete"
  const [pwd, setPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [busy, setBusy] = useState(false);

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

const CreateUserModal = ({ meta, onClose, onSaved }) => {
  const [employees, setEmployees] = useState([]);
  const [form, setForm] = useState({ employee_id: "", full_name: "", email: "", role: "", password: "", confirm: "" });
  useEffect(() => { hrEmployees({ status: "active" }).then(setEmployees).catch((e) => console.warn("[load failed]", e?.message || e)); }, []);

  const pickEmployee = (id) => {
    const emp = employees.find((e) => e.id === id);
    setForm((p) => ({ ...p, employee_id: id, full_name: emp?.full_name || p.full_name, email: emp?.email || p.email }));
  };

  const submit = async () => {
    if (!form.email || !form.password || !form.role) { toast.error("Email, role, password required"); return; }
    if (form.password.length < 6) { toast.error("Min 6 characters"); return; }
    if (form.password !== form.confirm) { toast.error("Passwords do not match"); return; }
    try {
      await hrCreateUser({ full_name: form.full_name || form.email.split("@")[0], email: form.email, password: form.password, role: form.role, employee_id: form.employee_id || null });
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
          <select className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" value={form.employee_id} onChange={(e) => pickEmployee(e.target.value)} data-testid="hr-create-user-emp">
            <option value="">Select employee...</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.employee_code} — {e.full_name} ({e.designation || "—"})</option>)}
          </select>
        </Field>
        <Field label="Name"><Input placeholder="Full name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} data-testid="hr-create-user-name" /></Field>
        <Field label="Username (Email) *"><Input placeholder="user@company.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="hr-create-user-email" /></Field>
        <Field label="Role *">
          <select className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} data-testid="hr-create-user-role">
            <option value="">Select role</option>
            {meta.roles.filter((r) => r !== "super_admin").map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
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
const FitsiomaxExpertsTab = () => {
  const [doctors, setDoctors] = useState([]);
  const [branches, setBranches] = useState([]);
  const [doctorForm, setDoctorForm] = useState({ full_name: "", profile_type: "physio", branch_id: "", specialization: "" });
  const [slotDoctorId, setSlotDoctorId] = useState("");
  const [slotTime, setSlotTime] = useState("");
  const [saving, setSaving] = useState(false);

  const reloadList = async () => {
    try {
      const [docs, brs] = await Promise.all([getDoctors(), getBranches()]);
      setDoctors(docs || []);
      setBranches(brs || []);
    } catch (err) {
      toast.error("Failed to load Fitsiomax Experts");
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const [docs, brs] = await Promise.all([getDoctors(), getBranches()]);
        setDoctors(docs || []);
        setBranches(brs || []);
      } catch (err) {
        toast.error("Failed to load Fitsiomax Experts");
      }
    })();
  }, []);

  const createDoctorNow = async (event) => {
    event.preventDefault();
    if (!doctorForm.full_name.trim()) {
      toast.error("Enter a name");
      return;
    }
    try {
      setSaving(true);
      await createDoctor({ ...doctorForm, branch_id: doctorForm.branch_id || null });
      setDoctorForm({ full_name: "", profile_type: "physio", branch_id: "", specialization: "" });
      await reloadList();
      toast.success("Fitsiomax Expert created");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to create");
    } finally {
      setSaving(false);
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
      <CardContent>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500" data-testid="hr-experts-add-heading">Add Fitsiomax Expert</p>
        <form className="grid gap-2 md:grid-cols-2" onSubmit={createDoctorNow} data-testid="hr-experts-create-form">
          <Input
            value={doctorForm.full_name}
            onChange={(e) => setDoctorForm((p) => ({ ...p, full_name: e.target.value }))}
            placeholder="Fitsiomax Expert name"
            data-testid="hr-experts-name-input"
          />
          <select
            value={doctorForm.profile_type}
            onChange={(e) => setDoctorForm((p) => ({ ...p, profile_type: e.target.value }))}
            className="h-9 rounded-md border border-slate-200 px-3 text-sm"
            data-testid="hr-experts-profile-select"
          >
            <option value="head_physio">Head Physio</option>
            <option value="physio">Physio</option>
          </select>
          <select
            value={doctorForm.branch_id}
            onChange={(e) => setDoctorForm((p) => ({ ...p, branch_id: e.target.value }))}
            className="h-9 rounded-md border border-slate-200 px-3 text-sm"
            data-testid="hr-experts-branch-select"
          >
            <option value="">Branch</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>{branch.branch_name}</option>
            ))}
          </select>
          <Input
            value={doctorForm.specialization}
            onChange={(e) => setDoctorForm((p) => ({ ...p, specialization: e.target.value }))}
            placeholder="Specialization"
            data-testid="hr-experts-specialization-input"
          />
          <div className="md:col-span-2">
            <Button type="submit" disabled={saving} data-testid="hr-experts-create-submit">Create Fitsiomax Expert</Button>
          </div>
        </form>

        <form className="mt-3 grid gap-2 md:grid-cols-3" onSubmit={addSlotNow} data-testid="hr-experts-slot-form">
          <select
            value={slotDoctorId}
            onChange={(e) => setSlotDoctorId(e.target.value)}
            className="h-9 rounded-md border border-slate-200 px-3 text-sm"
            data-testid="hr-experts-slot-doctor-select"
          >
            <option value="">Assign Fitsiomax Expert</option>
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
      </CardContent>
    </Card>
  );
};

export default HRBoard;
