import { useEffect, useState } from "react";
import { Settings, X, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import {
  createManualLead, getBranches,
  leadFieldsList, leadFieldsCreate, leadFieldsUpdate, leadFieldsDelete,
} from "@/lib/api";
import { MilkDateInput } from "@/components/ui/milk-calendar";
import { loadSession } from "@/lib/session";

const SOURCE_OPTIONS = ["Meta", "SEO", "Referral", "Walk-In", "Website", "CSV Import", "Google Sheets", "Other"];
const DEPARTMENT_OPTIONS = [
  { value: "offline_physio", label: "Offline Physio" },
  { value: "online_physio", label: "Online Physio" },
  { value: "offline_fitness", label: "Offline Fitness" },
  { value: "online_fitness", label: "Online Fitness" },
];
const GENDER_OPTIONS = ["Male", "Female", "Other"];

/**
 * The ad record a lead arrived on — Meta's own lead export, field for field, in the order
 * Meta writes it. Its own tab rather than more rows under Patient Details, because it
 * answers a different question about the same person: Lead Details is who they are and
 * what hurts, this is which advert we paid for to hear from them.
 *
 * Names match Meta's export exactly, so a row pasted across needs no translating. Two of
 * them collide with the lead's own — this `id` is Meta's lead id, and `created_time` is
 * when Meta captured the form, not when we stored it — which is why the whole block is
 * sent nested under `lead_data` rather than flattened onto the lead. See V3LeadData in
 * backend/schemas/v3.py.
 */
const LEAD_DATA_FIELDS = [
  { key: "id", label: "Lead ID", placeholder: "Meta's own lead id" },
  { key: "created_time", label: "Created Time", placeholder: "2026-08-31T10:30:00+0530" },
  { key: "ad_id", label: "Ad ID", placeholder: "e.g. 23851234567890123" },
  { key: "ad_name", label: "Ad Name", placeholder: "e.g. Back Pain — Video A" },
  { key: "adset_id", label: "Adset ID", placeholder: "e.g. 23851234567890456" },
  { key: "adset_name", label: "Adset Name", placeholder: "e.g. Chennai 25-54" },
  { key: "campaign_id", label: "Campaign ID", placeholder: "e.g. 23851234567890789" },
  { key: "campaign_name", label: "Campaign Name", placeholder: "e.g. Anna Nagar Leads Aug" },
  { key: "form_id", label: "Form ID", placeholder: "e.g. 987654321012345" },
  { key: "form_name", label: "Form Name", placeholder: "e.g. Free Consultation Form" },
  // Three answers rather than a checkbox: blank means nobody has said, and that is the
  // honest state of a lead somebody typed in by hand.
  { key: "is_organic", label: "Is Organic", type: "select", options: [["", "—"], ["true", "Yes"], ["false", "No"]] },
  { key: "platform", label: "Platform", type: "select", options: [["", "—"], ["fb", "Facebook (fb)"], ["ig", "Instagram (ig)"]] },
];

const blankLeadData = Object.fromEntries(LEAD_DATA_FIELDS.map((f) => [f.key, ""]));

const blank = {
  name: "", source_tab: "Other", email: "", phone: "", alternative_phone: "",
  address: "", city: "", state: "", department: "", condition: "",
  months_of_pain: "", age: "", gender: "", occupation: "",
  expected_consultation_date: "", branch_id: "",
};

/**
 * @param lockedDepartment One of DEPARTMENT_OPTIONS' values, fixing the Department instead
 *   of offering it. Passed by a board that finds its own leads by the vertical this field
 *   decides — an online arm's — where leaving it open would let somebody file a lead into
 *   another arm from a board that then could not show it back to them.
 */
export const CreateLeadModal = ({ onClose, onSaved, isSuperAdmin = true, branchId = null, lockedDepartment = null }) => {
  const [form, setForm] = useState({
    ...blank,
    ...(branchId ? { branch_id: branchId } : {}),
    ...(lockedDepartment ? { department: lockedDepartment } : {}),
  });
  const [leadData, setLeadData] = useState(blankLeadData);
  const [tab, setTab] = useState("details");
  const [extraFields, setExtraFields] = useState({});
  const [customFields, setCustomFields] = useState([]);
  const [branches, setBranches] = useState([]);
  const [showManage, setShowManage] = useState(false);

  const loadFields = () => leadFieldsList().then(setCustomFields).catch((e) => console.warn("[load failed]", e?.message || e));

  useEffect(() => {
    loadFields();
    getBranches().then(setBranches).catch((e) => console.warn("[load failed]", e?.message || e));
  }, []);

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const setExtra = (k, v) => setExtraFields((p) => ({ ...p, [k]: v }));
  const setLD = (k, v) => setLeadData((p) => ({ ...p, [k]: v }));

  // Read off the session rather than the isSuperAdmin prop: that prop says which board
  // opened this form — Branch Admin's board passes false even when a Super Admin is the
  // one looking at it through Operations — and this tab is about who is looking. The
  // server withholds the same block from everybody else on the way back out (see
  // reads_lead_data in backend/deps.py), so hiding it here is the courtesy, not the lock.
  const isSuperAdminUser = String(loadSession()?.user?.role || "").trim().toLowerCase() === "super_admin";

  const submit = async () => {
    if (!form.name.trim() || !form.phone.trim()) {
      // Back to the tab the missing field is on, so the complaint points at something the
      // user can actually see. Both required fields live on Lead Details.
      setTab("details");
      toast.error("Name and phone are required");
      return;
    }
    const payload = { ...form };
    payload.extra_fields = extraFields;
    if (isSuperAdminUser) {
      const filled = Object.entries(leadData)
        .map(([k, v]) => [k, typeof v === "string" ? v.trim() : v])
        .filter(([, v]) => v !== "");
      // Left off entirely when the tab was never touched, rather than sent as a dozen
      // empty strings — a lead with no advert behind it should read as having none, not
      // as having been asked and answered blank.
      if (filled.length) {
        payload.lead_data = Object.fromEntries(
          filled.map(([k, v]) => [k, k === "is_organic" ? v === "true" : v]),
        );
      }
    }
    if (payload.months_of_pain === "") payload.months_of_pain = null;
    else payload.months_of_pain = Number(payload.months_of_pain);
    if (payload.age === "") payload.age = null;
    else payload.age = Number(payload.age);
    if (branchId) payload.branch_id = branchId;
    else if (!["offline_physio", "offline_fitness"].includes(payload.department)) payload.branch_id = "";
    payload.source_type = "manual";
    const VERTICAL_MAP = {
      online_physio: "online_physiotherapy",
      offline_fitness: "offline_fitness",
      online_fitness: "online_fitness",
    };
    payload.vertical = VERTICAL_MAP[payload.department] || "offline_physiotherapy";
    try {
      await createManualLead(payload);
      toast.success("Lead created");
      onSaved && onSaved();
      onClose();
    } catch (e) { toast.error(e?.response?.data?.detail || "Create failed"); }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" data-testid="create-lead-modal">
      <div className="w-full max-w-3xl rounded-lg bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h3 className="text-xl font-bold text-slate-900">Add New Lead</h3>
            <p className="mt-0.5 text-xs text-slate-500">Enter lead details. Custom fields appear below.</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600" data-testid="lead-create-close"><X className="h-5 w-5" /></button>
          </div>
        </div>

        {/* Only a Super Admin gets a second tab, so for everyone else the form stays the
            single uninterrupted page it has always been rather than one lone tab with
            nothing beside it. */}
        {isSuperAdminUser && (
          <div className="flex gap-1 border-b border-slate-200 px-6" data-testid="lead-create-tabs">
            {[
              { key: "details", label: "Lead Details" },
              { key: "lead_data", label: "Lead Data" },
            ].map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition ${
                  tab === t.key
                    ? "border-indigo-600 text-indigo-600"
                    : "border-transparent text-slate-500 hover:text-slate-700"
                }`}
                data-testid={`lead-create-tab-${t.key}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {/* Both panels stay mounted and one is hidden: switching tabs must not empty the
            one you left, and a half-filled ad record is exactly the thing somebody would
            tab away from mid-entry. */}
        <div className={`max-h-[70vh] space-y-5 overflow-y-auto px-6 py-5 ${tab === "details" ? "" : "hidden"}`} data-testid="lead-create-panel-details">
          {/* Standard fields */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name *"><Input placeholder="Full name" value={form.name} onChange={(e) => set("name", e.target.value)} data-testid="lead-create-name" /></Field>
            <Field label="Source">
              <Select value={form.source_tab} onChange={(v) => set("source_tab", v)} options={SOURCE_OPTIONS} testid="lead-create-source" />
            </Field>
            <Field label="Email"><Input placeholder="email@example.com" value={form.email} onChange={(e) => set("email", e.target.value)} data-testid="lead-create-email" /></Field>
            <Field label="Phone *"><Input placeholder="+91 9876543210" value={form.phone} onChange={(e) => set("phone", e.target.value)} data-testid="lead-create-phone" /></Field>
            <Field label="Alternative Phone" className="sm:col-span-2"><Input placeholder="Optional secondary number" value={form.alternative_phone} onChange={(e) => set("alternative_phone", e.target.value)} data-testid="lead-create-altphone" /></Field>
            <Field label="Address" className="sm:col-span-2"><Input placeholder="Street address" value={form.address} onChange={(e) => set("address", e.target.value)} data-testid="lead-create-address" /></Field>
            <Field label="City"><Input placeholder="City" value={form.city} onChange={(e) => set("city", e.target.value)} data-testid="lead-create-city" /></Field>
            <Field label="State"><Input placeholder="State" value={form.state} onChange={(e) => set("state", e.target.value)} data-testid="lead-create-state" /></Field>
          </div>

          {/* Physio Patient Details */}
          <div className="rounded-lg border border-slate-200 p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Patient Details</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Department">
                {/* Shown rather than hidden where it is fixed: the department decides which
                    board the lead lands on, and that is worth saying out loud on the form
                    that decides it. Disabled, not removed, so the answer is still read. */}
                <select
                  className={`h-10 w-full rounded-md border border-slate-200 px-3 text-sm ${lockedDepartment ? "bg-slate-100 text-slate-500" : ""}`}
                  value={form.department}
                  disabled={!!lockedDepartment}
                  title={lockedDepartment ? "Set by the board you are creating this lead from" : undefined}
                  onChange={(e) => set("department", e.target.value)}
                  data-testid="lead-create-department"
                >
                  <option value="">Select Department</option>
                  {DEPARTMENT_OPTIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </Field>
              <Field label="Condition / Pain Area"><Input placeholder="e.g. Lower back pain" value={form.condition} onChange={(e) => set("condition", e.target.value)} data-testid="lead-create-condition" /></Field>
              <Field label="Months of Pain"><Input type="number" min="0" placeholder="e.g. 6" value={form.months_of_pain} onChange={(e) => set("months_of_pain", e.target.value)} data-testid="lead-create-months" /></Field>
              <Field label="Age"><Input type="number" min="0" placeholder="e.g. 32" value={form.age} onChange={(e) => set("age", e.target.value)} data-testid="lead-create-age" /></Field>
              <Field label="Gender"><Select value={form.gender} onChange={(v) => set("gender", v)} options={["", ...GENDER_OPTIONS]} testid="lead-create-gender" /></Field>
              <Field label="Occupation"><Input placeholder="e.g. Software Engineer" value={form.occupation} onChange={(e) => set("occupation", e.target.value)} data-testid="lead-create-occupation" /></Field>
              <Field label="Expected Consultation Date" className="sm:col-span-2"><MilkDateInput  value={form.expected_consultation_date} onChange={(e) => set("expected_consultation_date", e.target.value)} data-testid="lead-create-consultdate" /></Field>
            </div>

            {!branchId && ["offline_physio", "offline_fitness"].includes(form.department) && (
              <div className="mt-3 rounded-md border border-sky-200 bg-sky-50 p-3" data-testid="lead-create-branch-section">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-sky-700">Assign to Branch</p>
                <div className="grid gap-2 sm:grid-cols-2 max-h-44 overflow-y-auto">
                  {branches.length === 0 && <p className="text-xs text-slate-500">No branches. Add one from Master View.</p>}
                  {branches.map((b) => (
                    <label key={b.id} className={`flex cursor-pointer items-start gap-2 rounded-md border p-2 text-xs ${form.branch_id === b.id ? "border-sky-500 bg-white shadow" : "border-slate-200 bg-white"}`} data-testid={`lead-create-branch-${b.id}`}>
                      <input type="radio" name="branch" checked={form.branch_id === b.id} onChange={() => set("branch_id", b.id)} className="mt-0.5" />
                      <div><p className="font-semibold">{b.branch_name}</p><p className="text-slate-500">Branch Admin: {b.admin_name}</p></div>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Custom Fields */}
          <div className="rounded-lg border border-slate-200 p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="flex items-center gap-2 text-sm font-semibold text-indigo-600"><Settings className="h-4 w-4" />Custom Fields</p>
              {isSuperAdmin && (
                <button onClick={() => setShowManage(true)} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700" data-testid="lead-manage-fields-btn">
                  <Pencil className="h-3 w-3" />Manage
                </button>
              )}
            </div>
            {customFields.length === 0 ? (
              <p className="text-xs text-slate-400">No custom fields yet.</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {customFields.map((f) => <CustomFieldInput key={f.id} field={f} value={extraFields[f.key]} onChange={(v) => setExtra(f.key, v)} />)}
              </div>
            )}
          </div>
        </div>

        {isSuperAdminUser && (
          <div className={`max-h-[70vh] space-y-5 overflow-y-auto px-6 py-5 ${tab === "lead_data" ? "" : "hidden"}`} data-testid="lead-create-panel-lead-data">
            <div className="rounded-lg border border-slate-200 p-4">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Ad Record</p>
              <p className="mb-3 text-xs text-slate-400">
                The Meta lead export, field for field. Super Admin only. Leave blank for a walk-in, or for any lead with no advert behind it.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                {LEAD_DATA_FIELDS.map((f) => (
                  <Field key={f.key} label={f.label}>
                    {f.type === "select" ? (
                      <select
                        className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm"
                        value={leadData[f.key]}
                        onChange={(e) => setLD(f.key, e.target.value)}
                        data-testid={`lead-data-${f.key}`}
                      >
                        {f.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    ) : (
                      <Input
                        placeholder={f.placeholder}
                        value={leadData[f.key]}
                        onChange={(e) => setLD(f.key, e.target.value)}
                        data-testid={`lead-data-${f.key}`}
                      />
                    )}
                  </Field>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4">
          <Button variant="outline" onClick={onClose} data-testid="lead-create-cancel">Cancel</Button>
          <Button onClick={submit} className="bg-indigo-600 hover:bg-indigo-700" data-testid="lead-create-submit">Create Lead</Button>
        </div>
      </div>

      {showManage && <ManageCustomFieldsDialog onClose={() => { setShowManage(false); loadFields(); }} />}
    </div>
  );
};

const CustomFieldInput = ({ field, value, onChange }) => {
  const testid = `lead-custom-${field.key}`;
  const common = { value: value ?? "", onChange: (e) => onChange(e.target.value), "data-testid": testid, placeholder: field.placeholder || `Enter ${field.label}` };
  return (
    <Field label={field.label + (field.required ? " *" : "")}>
      {field.type === "textarea" && <textarea {...common} className="h-20 w-full rounded-md border border-slate-200 p-2 text-sm" />}
      {field.type === "select" && (
        <select {...common} className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm">
          <option value="">{`Select ${field.label}`}</option>
          {(field.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      )}
      {field.type === "date" && <MilkDateInput  {...common} />}
      {field.type === "number" && <Input type="number" {...common} />}
      {(field.type === "text" || field.type === "email" || field.type === "phone") && <Input type={field.type === "email" ? "email" : "text"} {...common} />}
    </Field>
  );
};

const AddCustomFieldDialog = ({ onClose, onSaved, existing = null }) => {
  const [form, setForm] = useState(existing ? {
    label: existing.label, type: existing.type, options: (existing.options || []).join(","), placeholder: existing.placeholder || "", required: !!existing.required,
  } : { label: "", type: "text", options: "", placeholder: "", required: false });

  const save = async () => {
    if (!form.label.trim()) { toast.error("Label required"); return; }
    const payload = {
      label: form.label, type: form.type, placeholder: form.placeholder, required: form.required,
      options: form.type === "select" ? form.options.split(",").map((o) => o.trim()).filter(Boolean) : [],
    };
    try {
      if (existing) { await leadFieldsUpdate(existing.id, payload); toast.success("Field updated"); }
      else { await leadFieldsCreate(payload); toast.success("Field created"); }
      onSaved();
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" data-testid="add-custom-field-dialog">
      <div className="w-full max-w-md space-y-3 rounded-lg bg-white p-5 shadow-xl">
        <h3 className="text-base font-semibold">{existing ? "Edit Custom Field" : "Add Custom Field"}</h3>
        <Field label="Label *"><Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Insurance Provider" data-testid="add-field-label" /></Field>
        <Field label="Type">
          <select className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} data-testid="add-field-type">
            {["text", "textarea", "number", "date", "email", "phone", "select"].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        {form.type === "select" && (
          <Field label="Options (comma separated)"><Input value={form.options} onChange={(e) => setForm({ ...form, options: e.target.value })} placeholder="Option A, Option B, Option C" data-testid="add-field-options" /></Field>
        )}
        <Field label="Placeholder"><Input value={form.placeholder} onChange={(e) => setForm({ ...form, placeholder: e.target.value })} data-testid="add-field-placeholder" /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.required} onChange={(e) => setForm({ ...form, required: e.target.checked })} data-testid="add-field-required" />Required</label>
        <div className="flex gap-2"><Button variant="outline" onClick={onClose} className="flex-1" data-testid="add-field-cancel">Cancel</Button><Button onClick={save} className="flex-1" data-testid="add-field-submit">{existing ? "Save" : "Add Field"}</Button></div>
      </div>
    </div>
  );
};

const ManageCustomFieldsDialog = ({ onClose }) => {
  const [fields, setFields] = useState([]);
  const [editing, setEditing] = useState(null);
  const load = () => leadFieldsList().then(setFields).catch((e) => console.warn("[load failed]", e?.message || e));
  useEffect(() => { load(); }, []);

  const remove = async (f) => {
    if (!window.confirm(`Delete field "${f.label}"?`)) return;
    try { await leadFieldsDelete(f.id); toast.success("Deleted"); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Delete failed"); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" data-testid="manage-fields-dialog">
      <div className="w-full max-w-lg space-y-3 rounded-lg bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between"><h3 className="text-base font-semibold">Manage Custom Fields</h3><button onClick={onClose} className="text-slate-400 hover:text-slate-600" data-testid="manage-fields-close"><X className="h-4 w-4" /></button></div>
        {fields.length === 0 ? <p className="text-sm text-slate-400">No custom fields yet.</p> : fields.map((f) => (
          <div key={f.id} className="flex items-center justify-between rounded-md border border-slate-200 p-2" data-testid={`manage-field-row-${f.id}`}>
            <div><p className="text-sm font-medium">{f.label}{f.required && <span className="text-red-500"> *</span>}</p><p className="text-xs text-slate-500">{f.type} · key: {f.key}</p></div>
            <div className="flex gap-2"><button onClick={() => setEditing(f)} className="text-blue-500" data-testid={`manage-field-edit-${f.id}`}><Pencil className="h-4 w-4" /></button><button onClick={() => remove(f)} className="text-red-500" data-testid={`manage-field-delete-${f.id}`}><Trash2 className="h-4 w-4" /></button></div>
          </div>
        ))}
      </div>
      {editing && <AddCustomFieldDialog existing={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
};

const Field = ({ label, children, className = "" }) => (
  <div className={`space-y-1 ${className}`}>
    <label className="text-xs font-medium text-slate-700">{label}</label>
    {children}
  </div>
);

const Select = ({ value, onChange, options, testid }) => (
  <select className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" value={value} onChange={(e) => onChange(e.target.value)} data-testid={testid}>
    {options.map((o) => <option key={o} value={o}>{o || "Select"}</option>)}
  </select>
);

export default CreateLeadModal;
