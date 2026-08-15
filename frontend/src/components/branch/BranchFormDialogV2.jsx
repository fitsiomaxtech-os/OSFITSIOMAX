import { useEffect, useMemo, useState } from "react";
import { X, MapPin, Clock, BarChart3, Stethoscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { bmCreateWithExistingAdmin, updateBranch, hrBranchAdminCandidates, bmPerformance, bmHeadPhysioCandidates, bmAssignHeadPhysio, getVerticals } from "@/lib/api";
import { MilkDateInput, MilkTimeInput } from "@/components/ui/milk-calendar";
import { LeadControlSwitch, normalizeLeadControl, BRANCH_ADMIN } from "@/components/branch/LeadControlSwitch";

// "offline_physiotherapy" -> "Offline Physiotherapy". The stored name stays snake_case,
// because it is matched against elsewhere; only the label is prettied.
const prettyVertical = (v) => String(v || "")
  .split("_")
  .filter(Boolean)
  .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
  .join(" ");

const TABS = [
  { key: "details", label: "Branch Details", icon: MapPin },
  { key: "hours", label: "Opening Hours", icon: Clock },
  { key: "finance", label: "Finance Summary", icon: BarChart3 },
  { key: "head_physio", label: "CONSULTANT", icon: Stethoscope },
];

const DAYS = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
];

const defaultDay = { is_open: true, open: "09:00", close: "20:00" };
const emptyWeekly = () => Object.fromEntries(DAYS.map((d) => [d.key, { ...defaultDay }]));

export const BranchFormDialogV2 = ({ branch, onClose, onSaved }) => {
  const isEdit = !!branch;
  const [tab, setTab] = useState("details");
  const [candidates, setCandidates] = useState([]);
  const [form, setForm] = useState({
    branch_name: branch?.branch_name || "",
    code: branch?.code || "",
    address: branch?.address || "",
    admin_user_id: branch?.admin_user_id || "",
    admin_phone: branch?.admin_phone || "",
    phone: branch?.phone || "",
    email: branch?.email || "",
    map_location: branch?.map_location || "",
    opened_date: branch?.opened_date || "",
    vertical: branch?.vertical || "offline_physiotherapy",
    lead_control: normalizeLeadControl(branch?.lead_control),
    weekly_hours: branch?.weekly_hours && Object.keys(branch.weekly_hours).length ? { ...emptyWeekly(), ...branch.weekly_hours } : emptyWeekly(),
    holidays: branch?.holidays || [],
  });
  const [holidayInput, setHolidayInput] = useState("");
  const [finance, setFinance] = useState(null);
  const [hpCandidates, setHpCandidates] = useState([]);
  const [hpPick, setHpPick] = useState("");
  const [hpSaving, setHpSaving] = useState(false);
  /**
   * Service types come from the list Service Type manages, not a literal.
   *
   * This select hardcoded three options, so a type added on the Service Type tab — or in
   * the new dropdown on MANAGER — could never be given to a branch, which is the only
   * reason to add one. The three remain as the fallback for a failed or empty fetch.
   */
  const [verticalOptions, setVerticalOptions] = useState([]);

  const loadHpCandidates = () => bmHeadPhysioCandidates().then(setHpCandidates).catch((e) => console.warn("[hp candidates]", e?.message || e));

  useEffect(() => {
    if (!isEdit) hrBranchAdminCandidates().then(setCandidates).catch((e) => console.warn("[candidates]", e?.message || e));
    if (isEdit && branch?.id) bmPerformance(branch.id).then(setFinance).catch((e) => console.warn("[perf]", e?.message || e));
    if (isEdit && branch?.id) loadHpCandidates();
  }, [isEdit, branch?.id]);

  useEffect(() => {
    let alive = true;
    getVerticals()
      .then((rows) => { if (alive) setVerticalOptions((rows || []).map((r) => r.name).filter(Boolean)); })
      .catch(() => { if (alive) setVerticalOptions([]); });
    return () => { alive = false; };
  }, []);

  // Whatever this branch already carries stays in the list even if it has since been
  // removed, so opening an old branch cannot silently reassign its vertical on save.
  const verticals = useMemo(() => {
    const base = verticalOptions.length
      ? verticalOptions
      : ["offline_physiotherapy", "online_physiotherapy", "fitness"];
    return !form.vertical || base.includes(form.vertical) ? base : [form.vertical, ...base];
  }, [verticalOptions, form.vertical]);

  const available = useMemo(() => candidates.filter((c) => !c.assigned_branch || c.id === branch?.admin_user_id), [candidates, branch?.admin_user_id]);
  const assignedHeadPhysios = useMemo(() => hpCandidates.filter((c) => c.branch_id === branch?.id), [hpCandidates, branch?.id]);
  const availableHeadPhysios = useMemo(() => hpCandidates.filter((c) => c.branch_id !== branch?.id), [hpCandidates, branch?.id]);

  const assignHeadPhysio = async () => {
    if (!hpPick) { toast.error("Pick a CONSULTANT"); return; }
    setHpSaving(true);
    try {
      await bmAssignHeadPhysio(branch.id, hpPick);
      toast.success("CONSULTANT assigned");
      setHpPick("");
      await loadHpCandidates();
    } catch (e) { toast.error(e?.response?.data?.detail || "Assign failed"); }
    setHpSaving(false);
  };

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const setDay = (dayKey, patch) => setForm((p) => ({ ...p, weekly_hours: { ...p.weekly_hours, [dayKey]: { ...p.weekly_hours[dayKey], ...patch } } }));
  const addHoliday = () => {
    if (!holidayInput) return;
    setForm((p) => (p.holidays.includes(holidayInput) ? p : { ...p, holidays: [...p.holidays, holidayInput].sort() }));
    setHolidayInput("");
  };
  const removeHoliday = (d) => setForm((p) => ({ ...p, holidays: p.holidays.filter((x) => x !== d) }));

  const submit = async () => {
    if (!form.branch_name.trim() || !form.address.trim()) { setTab("details"); toast.error("Branch name + address required"); return; }
    if (!isEdit && !form.admin_user_id) { setTab("details"); toast.error("Select a Branch Admin"); return; }
    try {
      if (isEdit) {
        await updateBranch(branch.id, {
          branch_name: form.branch_name, code: form.code || undefined, address: form.address, admin_phone: form.admin_phone,
          phone: form.phone, email: form.email, map_location: form.map_location,
          opened_date: form.opened_date, vertical: form.vertical, lead_control: form.lead_control, weekly_hours: form.weekly_hours, holidays: form.holidays,
        });
        toast.success("Branch updated");
      } else {
        await bmCreateWithExistingAdmin({
          branch_name: form.branch_name, code: form.code || undefined, address: form.address, admin_user_id: form.admin_user_id, admin_phone: form.admin_phone,
          phone: form.phone, email: form.email, map_location: form.map_location,
          opened_date: form.opened_date, vertical: form.vertical, lead_control: form.lead_control, weekly_hours: form.weekly_hours, holidays: form.holidays,
        });
        toast.success("Branch created — finance summary will populate once leads are assigned.");
      }
      onSaved();
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" data-testid="branch-form-v2-dialog">
      <div className="w-full max-w-3xl rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">{isEdit ? `Edit Branch — ${branch.branch_name}` : "Create New Branch"}</h3>
            <p className="text-xs text-slate-500">{isEdit ? "Update details, opening hours, or view financials." : "Fill in details + hours. Finance summary becomes available after creation."}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" data-testid="bf2-close"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex flex-wrap gap-1 border-b border-slate-200 px-5 py-2">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            const disabled = (t.key === "finance" || t.key === "head_physio") && !isEdit;
            return (
              <button key={t.key} disabled={disabled} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition ${active ? "bg-sky-600 text-white" : "text-slate-600 hover:bg-slate-100"} ${disabled ? "opacity-40 cursor-not-allowed" : ""}`} data-testid={`bf2-tab-${t.key}`}>
                <Icon className="h-3.5 w-3.5" />{t.label}{disabled && <span className="text-[10px]">(after create)</span>}
              </button>
            );
          })}
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-5">
          {tab === "details" && (
            <div className="grid gap-3 sm:grid-cols-2" data-testid="bf2-details-tab">
              <Field label="Branch Name *"><Input value={form.branch_name} onChange={(e) => set("branch_name", e.target.value)} data-testid="bf2-name" placeholder="e.g. Anna Nagar" /></Field>
              <Field label="Branch Code">
                <Input
                  value={form.code}
                  onChange={(e) => set("code", e.target.value.toUpperCase())}
                  placeholder="Auto-generated if left blank, e.g. ANN"
                  maxLength={10}
                  data-testid="bf2-code"
                />
                <p className="mt-1 text-[11px] text-slate-400">Prefixes every patient's unique Patient Number at this branch (e.g. ANN-260727-0000).</p>
              </Field>
              <Field label="Vertical">
                <select className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" value={form.vertical} onChange={(e) => set("vertical", e.target.value)} data-testid="bf2-vertical">
                  {verticals.map((v) => (
                    <option key={v} value={v}>{prettyVertical(v)}</option>
                  ))}
                </select>
              </Field>
              <Field label={isEdit ? "Branch Admin" : "Branch Admin *"}>
                {isEdit ? (
                  <div className="h-10 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm flex items-center text-slate-600">{branch.admin_name || "Unassigned"} <span className="ml-2 text-[10px] text-slate-400">(reassign via Detail page)</span></div>
                ) : (
                  <select className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" value={form.admin_user_id} onChange={(e) => set("admin_user_id", e.target.value)} data-testid="bf2-admin">
                    <option value="">— Select branch_admin user —</option>
                    {available.length === 0 && <option disabled>No available branch_admin users — create one in HR</option>}
                    {available.map((c) => <option key={c.id} value={c.id}>{c.full_name} · {c.email}</option>)}
                  </select>
                )}
              </Field>
              <Field label="Admin Phone"><Input value={form.admin_phone} onChange={(e) => set("admin_phone", e.target.value)} placeholder="+91 …" data-testid="bf2-admin-phone" /></Field>
              <Field label="Branch Phone"><Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="Front-desk phone" data-testid="bf2-phone" /></Field>
              <Field label="Branch Email"><Input value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="branch@example.com" data-testid="bf2-email" /></Field>
              <Field label="Address *" className="sm:col-span-2"><Input value={form.address} onChange={(e) => set("address", e.target.value)} placeholder="Street, City, PIN" data-testid="bf2-address" /></Field>
              <Field label="Opened Date"><MilkDateInput  value={form.opened_date} onChange={(e) => set("opened_date", e.target.value)} data-testid="bf2-opened-date" /></Field>
              <Field label="Map Location" className="sm:col-span-1">
                <Input value={form.map_location} onChange={(e) => set("map_location", e.target.value)} placeholder="Google Maps URL or lat,lng" data-testid="bf2-map" />
                {form.map_location && <a href={form.map_location.startsWith("http") ? form.map_location : `https://www.google.com/maps?q=${encodeURIComponent(form.map_location)}`} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-[11px] text-sky-600 hover:underline" data-testid="bf2-map-preview">Open in Google Maps →</a>}
              </Field>
              {/* Last in the grid and spanning it: this one changes who works the
                  branch's leads, so it reads as its own decision rather than as one
                  more contact field. */}
              <Field label="Lead Control" className="sm:col-span-2">
                <LeadControlSwitch value={form.lead_control} onChange={(v) => set("lead_control", v)} testid="bf2-lead-control" />
                <p className="mt-1.5 text-[11px] text-slate-500">
                  {form.lead_control === BRANCH_ADMIN
                    ? "This branch's leads skip the Pre-Sales pipeline and go straight to the Branch Admin. No Pre-Sales rep is assigned."
                    : "New leads land in the Pre-Sales pipeline first and are shared out across the Pre-Sales team."}
                </p>
                <p className="mt-1 text-[11px] text-slate-400">
                  Applies to leads already in the pipeline too, not only new ones. Leads with no branch yet always stay with Pre-Sales.
                </p>
              </Field>
            </div>
          )}

          {tab === "hours" && (
            <div className="space-y-2" data-testid="bf2-hours-tab">
              <p className="text-xs text-slate-500">Set weekly opening hours. Toggle a day off to mark it closed. Use 24-hour format (HH:MM).</p>
              {DAYS.map((d) => {
                const v = form.weekly_hours[d.key];
                return (
                  <div key={d.key} className="flex flex-wrap items-center gap-3 rounded-md border border-slate-200 p-3" data-testid={`bf2-day-${d.key}`}>
                    <div className="w-28 font-medium text-slate-700">{d.label}</div>
                    <label className="inline-flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={v.is_open} onChange={(e) => setDay(d.key, { is_open: e.target.checked })} data-testid={`bf2-day-${d.key}-toggle`} />
                      <span className={v.is_open ? "text-emerald-600 font-semibold" : "text-slate-400"}>{v.is_open ? "Open" : "Closed"}</span>
                    </label>
                    <div className={`flex items-center gap-2 ${v.is_open ? "" : "opacity-30 pointer-events-none"}`}>
                      {/* Wider than the 10–22 booking window: a branch opens before and
                          closes after the hours it takes appointments in. */}
                      <MilkTimeInput from="06:00" to="23:30" accent="sky" value={v.open} onChange={(e) => setDay(d.key, { open: e.target.value })} className="w-32" data-testid={`bf2-day-${d.key}-open`} />
                      <span className="text-slate-400">→</span>
                      <MilkTimeInput from="06:00" to="23:30" accent="sky" value={v.close} onChange={(e) => setDay(d.key, { close: e.target.value })} className="w-32" data-testid={`bf2-day-${d.key}-close`} />
                    </div>
                  </div>
                );
              })}
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => DAYS.forEach((d) => setDay(d.key, { is_open: true, open: form.weekly_hours.mon.open, close: form.weekly_hours.mon.close }))} className="text-xs font-medium text-sky-600 hover:underline" data-testid="bf2-copy-mon">Copy Monday to all days</button>
                <span className="text-slate-300">·</span>
                <button type="button" onClick={() => setForm((p) => ({ ...p, weekly_hours: { ...p.weekly_hours, sat: { ...p.weekly_hours.sat, is_open: false }, sun: { ...p.weekly_hours.sun, is_open: false } } }))} className="text-xs font-medium text-sky-600 hover:underline" data-testid="bf2-close-weekend">Mark weekend closed</button>
              </div>

              <div className="mt-3 border-t border-slate-100 pt-3" data-testid="bf2-holidays">
                <p className="text-xs font-semibold text-slate-600">Branch Holidays (closed days)</p>
                <p className="mb-2 text-xs text-slate-500">Add specific dates the branch is closed. These appear as holidays on the Branch Admin calendar.</p>
                <div className="flex gap-2">
                  <MilkDateInput  value={holidayInput} onChange={(e) => setHolidayInput(e.target.value)} className="w-44" data-testid="bf2-holiday-input" />
                  <Button type="button" variant="outline" onClick={addHoliday} data-testid="bf2-holiday-add">Add Holiday</Button>
                </div>
                {form.holidays.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5" data-testid="bf2-holiday-list">
                    {form.holidays.map((d) => (
                      <span key={d} className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-600" data-testid={`bf2-holiday-${d}`}>
                        {d}
                        <button type="button" onClick={() => removeHoliday(d)} className="text-rose-400 hover:text-rose-600" aria-label="Remove holiday"><X className="h-3 w-3" /></button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-slate-400">No holidays added.</p>
                )}
              </div>
            </div>
          )}

          {tab === "finance" && (
            <div className="space-y-3" data-testid="bf2-finance-tab">
              {!isEdit && <p className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">Finance summary becomes available once the branch is created and starts receiving leads.</p>}
              {isEdit && !finance && <p className="text-sm text-slate-400">Loading finance summary...</p>}
              {isEdit && finance && (
                <>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <FinTile label="Total Leads" value={finance.kpis.leads_total} color="#0ea5e9" />
                    <FinTile label="Completed" value={finance.kpis.leads_completed} color="#22c55e" />
                    <FinTile label="Conversion" value={`${finance.kpis.conversion_rate}%`} color="#a855f7" />
                    <FinTile label="Appointments" value={`${finance.kpis.appointments_completed}/${finance.kpis.appointments_total}`} color="#f59e0b" />
                    <FinTile label="Consultation Fees" value={`₹${Number(finance.kpis.consultation_fees || 0).toLocaleString("en-IN")}`} color="#0ea5e9" />
                    <FinTile label="Package Revenue" value={`₹${Number(finance.kpis.package_revenue || 0).toLocaleString("en-IN")}`} color="#22c55e" />
                    <FinTile label="Total Revenue" value={`₹${Number(finance.kpis.total_revenue || 0).toLocaleString("en-IN")}`} color="#a855f7" />
                    <FinTile label="Doctors" value={finance.kpis.doctors} color="#64748b" />
                    <FinTile label="Physios" value={finance.kpis.physios} color="#64748b" />
                  </div>
                  <div className="rounded-md border border-slate-200 p-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Stage Breakdown</p>
                    {finance.stage_breakdown.length === 0 ? <p className="text-xs text-slate-400">No leads yet.</p> : (
                      <div className="space-y-1">
                        {finance.stage_breakdown.map((s) => (
                          <div key={s.stage} className="flex items-center gap-2 text-xs">
                            <span className="w-44 text-slate-600">{s.stage}</span>
                            <div className="h-2 flex-1 overflow-hidden rounded bg-slate-100"><div className="h-full bg-sky-500" style={{ width: `${(s.count / (finance.kpis.leads_total || 1) * 100) || 0}%` }} /></div>
                            <span className="w-8 text-right font-semibold">{s.count}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {tab === "head_physio" && (
            <div className="space-y-4" data-testid="bf2-head-physio-tab">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Assigned to this branch</p>
                {assignedHeadPhysios.length === 0 ? (
                  <p className="text-sm text-slate-400">No CONSULTANT assigned yet.</p>
                ) : (
                  <div className="space-y-2">
                    {assignedHeadPhysios.map((d) => (
                      <div key={d.id} className="flex items-center justify-between rounded-md border border-slate-200 p-3" data-testid={`bf2-hp-assigned-${d.id}`}>
                        <div>
                          <p className="text-sm font-semibold text-slate-800">{d.full_name}</p>
                          <p className="text-xs text-slate-500">{d.specialization || "CONSULTANT"} · {(d.slots || []).length} time slots configured</p>
                        </div>
                        <span className="rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">Current</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t border-slate-200 pt-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Assign a CONSULTANT</p>
                <p className="mb-2 text-xs text-slate-500">Showing all CONSULTANTS from HR → Roles &amp; Credentials. Picking one already assigned elsewhere moves them to this branch.</p>
                <div className="flex gap-2">
                  <select className="h-10 flex-1 rounded-md border border-slate-200 px-3 text-sm" value={hpPick} onChange={(e) => setHpPick(e.target.value)} data-testid="bf2-hp-select">
                    <option value="">— Select CONSULTANT —</option>
                    {availableHeadPhysios.length === 0 && <option disabled>No other CONSULTANTS — create one in HR</option>}
                    {availableHeadPhysios.map((c) => (
                      <option key={c.id} value={c.id}>{c.full_name}{c.assigned_branch ? ` · currently at ${c.assigned_branch}` : " · unassigned"}</option>
                    ))}
                  </select>
                  <Button onClick={assignHeadPhysio} disabled={hpSaving} className="bg-sky-600 hover:bg-sky-700" data-testid="bf2-hp-assign-submit">{hpSaving ? "Assigning..." : "Assign"}</Button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <Button variant="outline" onClick={onClose} data-testid="bf2-cancel">Cancel</Button>
          <Button onClick={submit} className="bg-sky-600 hover:bg-sky-700" data-testid="bf2-submit">{isEdit ? "Save Changes" : "Create Branch"}</Button>
        </div>
      </div>
    </div>
  );
};

const Field = ({ label, children, className = "" }) => (
  <div className={`space-y-1 ${className}`}>
    <label className="text-xs font-medium text-slate-700">{label}</label>
    {children}
  </div>
);

const FinTile = ({ label, value, color }) => (
  <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
    <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-1 text-lg font-bold" style={{ color }}>{value}</p>
  </div>
);

export default BranchFormDialogV2;
