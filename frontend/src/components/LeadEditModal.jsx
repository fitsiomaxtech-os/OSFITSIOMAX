import { useEffect, useState } from "react";
import { X, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { updateLead, getBranches, stagesList } from "@/lib/api";
import { MilkDateInput } from "@/components/ui/milk-calendar";

const DEPARTMENTS = [
  { value: "offline_physio", label: "Offline Physio" },
  { value: "online_physio", label: "Online Physio" },
  { value: "fitness", label: "Fitness" },
];

const GENDERS = ["Male", "Female", "Other"];

export const LeadEditModal = ({ lead, onClose, onSaved }) => {
  const [form, setForm] = useState({
    name: lead.name || "",
    email: lead.email || "",
    phone: lead.phone || "",
    location: lead.location || "",
    expected_consultation_date: lead.expected_consultation_date || "",
    months_of_pain: lead.months_of_pain ?? "",
    age: lead.age ?? "",
    gender: lead.gender || "",
    occupation: lead.occupation || "",
    department: lead.department || "",
    branch_id: lead.branch_id || "",
    notes: lead.notes || "",
  });
  const [branches, setBranches] = useState([]);
  const [stages, setStages] = useState([]);

  useEffect(() => {
    getBranches().then(setBranches).catch((e) => console.warn("[load failed]", e?.message || e));
    stagesList("pre_sales").then(setStages).catch((e) => console.warn("[load failed]", e?.message || e));
  }, []);

  const save = async () => {
    if (!form.name.trim() || !form.phone.trim()) {
      toast.error("Name and phone are required");
      return;
    }
    if (!form.department) { toast.error("Department is required"); return; }
    const payload = { ...form };
    if (payload.months_of_pain === "") payload.months_of_pain = null;
    if (payload.age === "") payload.age = null;
    if (payload.department !== "offline_physio") payload.branch_id = null;
    if (payload.months_of_pain != null) payload.months_of_pain = Number(payload.months_of_pain);
    if (payload.age != null) payload.age = Number(payload.age);
    try {
      await updateLead(lead.id, payload);
      toast.success("Lead updated");
      onSaved && onSaved();
      onClose();
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" data-testid="lead-edit-modal">
      <div className="w-full max-w-2xl rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div className="flex items-center gap-2">
            <Pencil className="h-4 w-4 text-sky-600" />
            <h3 className="text-base font-semibold text-slate-900">Edit Lead — {lead.name}</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" data-testid="lead-edit-close"><X className="h-4 w-4" /></button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name *"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="lead-edit-name" /></Field>
            <Field label="Phone *"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="lead-edit-phone" /></Field>
            <Field label="Email"><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="lead-edit-email" /></Field>
            <Field label="Location"><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} data-testid="lead-edit-location" /></Field>
            <Field label="Expected Consultation Date"><MilkDateInput  value={form.expected_consultation_date} onChange={(e) => setForm({ ...form, expected_consultation_date: e.target.value })} data-testid="lead-edit-consultdate" /></Field>
            <Field label="Months of Pain"><Input type="number" min="0" value={form.months_of_pain} onChange={(e) => setForm({ ...form, months_of_pain: e.target.value })} data-testid="lead-edit-months-pain" /></Field>
            <Field label="Age"><Input type="number" min="0" value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })} data-testid="lead-edit-age" /></Field>
            <Field label="Gender">
              <select className="h-9 w-full rounded-md border border-slate-200 px-3 text-sm" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })} data-testid="lead-edit-gender">
                <option value="">Select</option>
                {GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </Field>
            <Field label="Occupation"><Input value={form.occupation} onChange={(e) => setForm({ ...form, occupation: e.target.value })} data-testid="lead-edit-occupation" /></Field>
            <Field label="Department *">
              <select className="h-9 w-full rounded-md border border-slate-200 px-3 text-sm" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value, branch_id: "" })} data-testid="lead-edit-department">
                <option value="">Select department</option>
                {DEPARTMENTS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </Field>
          </div>

          {form.department === "offline_physio" && (
            <div className="mt-4 rounded-lg border border-sky-200 bg-sky-50 p-3" data-testid="lead-edit-branch-section">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-sky-700">Assign to Branch</p>
              <div className="grid gap-2 sm:grid-cols-2 max-h-48 overflow-y-auto">
                {branches.length === 0 && <p className="text-xs text-slate-500">No branches yet. Add one from Super Admin → Master View.</p>}
                {branches.map((b) => (
                  <label key={b.id} className={`flex cursor-pointer items-start gap-2 rounded-md border p-2 text-xs ${form.branch_id === b.id ? "border-sky-500 bg-white shadow" : "border-slate-200 bg-white"}`} data-testid={`lead-edit-branch-${b.id}`}>
                    <input type="radio" name="branch" checked={form.branch_id === b.id} onChange={() => setForm({ ...form, branch_id: b.id })} className="mt-0.5" />
                    <div>
                      <p className="font-semibold text-slate-800">{b.branch_name}</p>
                      <p className="text-slate-500">Branch Admin: <span className="text-slate-700">{b.admin_name}</span></p>
                      <p className="text-slate-400">{b.address}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          <Field label="Notes" className="mt-3">
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="h-20 w-full rounded-md border border-slate-200 p-2 text-sm" data-testid="lead-edit-notes" />
          </Field>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <Button variant="outline" onClick={onClose} data-testid="lead-edit-cancel">Cancel</Button>
          <Button onClick={save} data-testid="lead-edit-submit">Save Lead</Button>
        </div>
      </div>
    </div>
  );
};

const Field = ({ label, children, className = "" }) => (
  <div className={`space-y-1 ${className}`}>
    <label className="text-xs font-medium text-slate-600">{label}</label>
    {children}
  </div>
);

export default LeadEditModal;
