import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { getDoctors, createDoctor, deleteDoctor, addDoctorSlots } from "@/lib/api";

const Field = ({ label, children, className = "" }) => (
  <div className={`space-y-1 ${className}`}>
    <label className="text-xs font-medium text-slate-600">{label}</label>
    {children}
  </div>
);

// Same tab as Super Admin's HR > Fitsiomax Experts, minus the Branch picker
// (the backend already scopes GET/POST/DELETE /doctors to this Branch Admin's
// own branch_id) and the "link to an existing employee" field (that endpoint
// is super_admin/marketing_head only, so it 403s for a branch_admin).
const blankExpertForm = { full_name: "", profile_type: "physio", specialization: "", joining_date: "", slot: "" };

export const BranchExpertsTab = () => {
  const [doctors, setDoctors] = useState([]);
  const [form, setForm] = useState(blankExpertForm);
  const [saving, setSaving] = useState(false);
  const [slotDoctorId, setSlotDoctorId] = useState("");
  const [slotTime, setSlotTime] = useState("");

  const reloadList = async () => {
    try {
      setDoctors(await getDoctors());
    } catch {
      toast.error("Failed to load experts");
    }
  };

  useEffect(() => { reloadList(); }, []);

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const resetForm = () => setForm(blankExpertForm);

  const finishWithSlot = async (doctorId) => {
    if (!form.slot) return;
    try { await addDoctorSlots(doctorId, { slots: [form.slot] }); }
    catch { toast.error("Expert created, but the initial slot failed to save — add it below instead"); }
  };

  const submitCreate = async (event) => {
    event.preventDefault();
    if (!form.full_name.trim()) { toast.error("Enter a name"); return; }
    try {
      setSaving(true);
      const created = await createDoctor({
        full_name: form.full_name,
        profile_type: form.profile_type,
        specialization: form.specialization,
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
    <Card className="border-slate-200 bg-white" data-testid="branch-experts-card">
      <CardHeader>
        <CardTitle className="text-base">Fitsiomax Experts</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500" data-testid="branch-experts-add-heading">Create Physio / Head Physio / Doctor</p>
          <form className="grid gap-2 md:grid-cols-3" onSubmit={submitCreate} data-testid="branch-experts-create-form">
            <Field label="Name *">
              <Input value={form.full_name} onChange={(e) => set("full_name", e.target.value)} placeholder="Expert name" data-testid="branch-experts-name-input" />
            </Field>
            <Field label="Type *">
              <select value={form.profile_type} onChange={(e) => set("profile_type", e.target.value)} className="h-9 w-full rounded-md border border-slate-200 px-3 text-sm" data-testid="branch-experts-profile-select">
                <option value="physio">Physio</option>
                <option value="head_physio">Head Physio</option>
                <option value="doctor">Doctor</option>
              </select>
            </Field>
            <Field label="Joining Date">
              <Input type="date" value={form.joining_date} onChange={(e) => set("joining_date", e.target.value)} data-testid="branch-experts-joining-input" />
            </Field>
            <Field label="Specialization" className="md:col-span-2">
              <Input value={form.specialization} onChange={(e) => set("specialization", e.target.value)} placeholder="e.g. Sports Physiotherapy" data-testid="branch-experts-specialization-input" />
            </Field>
            <Field label="Initial Slot (optional)">
              <Input type="datetime-local" value={form.slot} onChange={(e) => set("slot", e.target.value)} data-testid="branch-experts-initial-slot-input" />
            </Field>
            <div className="md:col-span-3">
              <Button type="submit" disabled={saving} data-testid="branch-experts-create-submit">
                Create Fitsiomax Expert
              </Button>
            </div>
          </form>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500" data-testid="branch-experts-list-heading">Existing Experts</p>
          <div className="overflow-auto rounded-md border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Specialization</th><th className="px-3 py-2">Actions</th></tr>
              </thead>
              <tbody>
                {doctors.map((d) => (
                  <tr key={d.id} className="border-t border-slate-100" data-testid={`branch-experts-row-${d.id}`}>
                    <td className="px-3 py-2 font-medium text-slate-800">{d.full_name}</td>
                    <td className="px-3 py-2 text-slate-600">{d.profile_type}</td>
                    <td className="px-3 py-2 text-slate-600">{d.specialization || "—"}</td>
                    <td className="px-3 py-2">
                      <button onClick={() => removeDoctor(d)} className="text-red-500 hover:text-red-700" title="Delete expert profile" data-testid={`branch-experts-delete-${d.id}`}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {doctors.length === 0 && <tr><td colSpan="4" className="px-3 py-6 text-center text-slate-400">No experts yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Add Availability Slot to an Existing Expert</p>
          <form className="flex flex-col gap-2 sm:flex-row" onSubmit={addSlotNow} data-testid="branch-experts-slot-form">
            <select
              value={slotDoctorId}
              onChange={(e) => setSlotDoctorId(e.target.value)}
              className="h-9 rounded-md border border-slate-200 px-3 text-sm"
              data-testid="branch-experts-slot-doctor-select"
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
              data-testid="branch-experts-slot-time-input"
            />
            <Button type="submit" variant="outline" disabled={saving} data-testid="branch-experts-slot-submit">Add Slot</Button>
          </form>
        </div>
      </CardContent>
    </Card>
  );
};

export default BranchExpertsTab;
