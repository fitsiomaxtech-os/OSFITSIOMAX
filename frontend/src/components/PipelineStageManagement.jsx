import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, Trash2, ArrowLeft, Flag, GripVertical, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { stagesList, stagesCreate, stagesUpdate, stagesDelete, stagesReorder, resetAllLeads } from "@/lib/api";

const PALETTE = ["#6366f1", "#3b82f6", "#0ea5e9", "#06b6d4", "#14b8a6", "#22c55e", "#84cc16", "#eab308", "#f59e0b", "#f97316", "#ef4444", "#ec4899", "#a855f7", "#64748b"];

// Every pipeline Super Admin can shape, in one table. The tab strip, the KPI row, the card
// title and the load-all-counts call are all derived from it, so a sixth pipeline is one
// entry rather than four separate edits that can drift apart.
//
// Recruitment is the odd one out: its records are candidates in their own collection, not
// leads, and they reference a stage by id — so renaming one here rewrites nothing and
// cannot orphan anybody.
const TYPES = [
  { key: "pre_sales", label: "Pre-Sales", kpi: "Pre-Sales Stages", title: "Pre-Sales", tone: "indigo", records: "Leads" },
  { key: "sales", label: "Branch Lead Stages", kpi: "Branch Lead Stages", title: "Branch Lead", tone: "green", records: "Leads" },
  { key: "consultation", label: "Branch Consultation", kpi: "Branch Consultation Stages", title: "Branch Consultation", tone: "orange", records: "Leads" },
  { key: "head_consultation", label: "Head Consultation", kpi: "Head Consultation Stages", title: "Head Consultation", tone: "sky", records: "Leads" },
  { key: "recruitment", label: "Recruitment", kpi: "Recruitment Stages", title: "Recruitment", tone: "violet", records: "Candidates" },
];

// Tailwind only ships classes it can actually see written out, so the tones are spelled in
// full rather than built as `border-${tone}-500`.
const TONE_CLASSES = {
  indigo: { border: "border-indigo-500", text: "text-indigo-600" },
  green: { border: "border-green-500", text: "text-green-600" },
  orange: { border: "border-orange-500", text: "text-orange-600" },
  sky: { border: "border-sky-500", text: "text-sky-600" },
  violet: { border: "border-violet-500", text: "text-violet-600" },
};

export const PipelineStageManagement = ({ onBack }) => {
  const [type, setType] = useState("pre_sales");
  const [stages, setStages] = useState([]);
  const [counts, setCounts] = useState(Object.fromEntries(TYPES.map((t) => [t.key, 0])));
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", color: "#6366f1", is_final: false });
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async () => {
    const lists = await Promise.all(TYPES.map((t) => stagesList(t.key)));
    setCounts(Object.fromEntries(TYPES.map((t, i) => [t.key, lists[i].length])));
    setStages(lists[TYPES.findIndex((t) => t.key === type)] || []);
  }, [type]);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!form.name.trim()) { toast.error("Stage name required"); return; }
    try {
      if (editing) {
        await stagesUpdate(editing.id, form);
        toast.success("Stage updated");
      } else {
        await stagesCreate({ ...form, type });
        toast.success("Stage created");
      }
      setShowAdd(false); setEditing(null); setForm({ name: "", color: "#6366f1", is_final: false });
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
  };

  const startEdit = (s) => { setEditing(s); setForm({ name: s.name, color: s.color, is_final: !!s.is_final }); setShowAdd(true); };

  const remove = async (s) => {
    if (!window.confirm(`Delete stage "${s.name}"?`)) return;
    try { await stagesDelete(s.id); toast.success("Stage deleted"); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Delete failed"); }
  };

  const move = async (s, dir) => {
    const idx = stages.findIndex((x) => x.id === s.id);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= stages.length) return;
    const items = stages.map((x, i) => ({ id: x.id, order: i }));
    [items[idx], items[swapIdx]] = [items[swapIdx], items[idx]];
    items.forEach((x, i) => { x.order = i; });
    await stagesReorder(items);
    load();
  };

  const handleResetAllLeads = async () => {
    const step1 = window.confirm(
      "Reset EVERY lead in the whole OS back to a fresh, unassigned New Leads state?\n\n" +
      "This keeps each lead's name/phone/contact info, but clears their stage, branch, " +
      "consultation, physio assignment, packages, fees, and follow-ups — and permanently " +
      "deletes all sessions, weekly assessments, package recommendations, appointments, " +
      "patient view links, and activity history.\n\nThis cannot be undone."
    );
    if (!step1) return;
    const step2 = window.confirm("Are you absolutely sure? Type OK to confirm this final, irreversible reset.");
    if (!step2) return;
    setResetting(true);
    try {
      const res = await resetAllLeads();
      toast.success(
        `Reset ${res.leads_reset} leads. Deleted ${res.sessions_deleted} sessions, ` +
        `${res.weekly_assessments_deleted} assessments, ${res.appointments_deleted} appointments, ` +
        `${res.lead_activity_deleted} activity entries.`
      );
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Reset failed");
    }
    setResetting(false);
  };

  return (
    <div className="space-y-5" data-testid="pipeline-stages-page">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack} data-testid="stages-back-btn"><ArrowLeft className="h-4 w-4 mr-1" />Settings</Button>
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Pipeline Stage Management</h2>
            <p className="text-sm text-slate-500">Add, edit, reorder, and delete stages for the Pre-Sales, Branch Lead, Branch Consultation, Head Consultation, and Recruitment pipelines.</p>
          </div>
        </div>
        <Button onClick={() => { setEditing(null); setForm({ name: "", color: PALETTE[Math.floor(Math.random() * PALETTE.length)], is_final: false }); setShowAdd(true); }} className="bg-orange-500 hover:bg-orange-600" data-testid="stages-add-btn"><Plus className="h-4 w-4 mr-1" />Add Stage</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {TYPES.map((t) => (
          <div key={t.key} className={`rounded-xl border-l-4 bg-white p-4 shadow-sm ${TONE_CLASSES[t.tone].border}`} data-testid={`stages-kpi-${t.key}`}>
            <p className="text-xs text-slate-500">{t.kpi}</p>
            <p className={`text-3xl font-bold ${TONE_CLASSES[t.tone].text}`}>{counts[t.key]}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1 sm:grid-cols-5">
        {TYPES.map((t) => (
          <button
            key={t.key}
            onClick={() => setType(t.key)}
            className={`rounded-md py-2 text-sm font-semibold ${type === t.key ? `bg-white shadow ${TONE_CLASSES[t.tone].text}` : "text-slate-500"}`}
            data-testid={`stages-tab-${t.key}`}
          >
            {t.label} ({counts[t.key]})
          </button>
        ))}
      </div>

      <Card data-testid="stages-list-card">
        <CardHeader><CardTitle className="text-base">{(TYPES.find((t) => t.key === type) || {}).title} Pipeline Stages</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500"><tr><th className="py-2">Order</th><th>Color</th><th>Stage Name</th><th>{(TYPES.find((t) => t.key === type) || {}).records}</th><th>Final</th><th>Actions</th></tr></thead>
            <tbody>
              {stages.map((s, i) => (
                <tr key={s.id} className="border-t border-slate-100" data-testid={`stages-row-${s.id}`}>
                  <td className="py-3">
                    <div className="flex items-center gap-2">
                      <GripVertical className="h-4 w-4 text-slate-300" />
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold">{i + 1}</span>
                      <button onClick={() => move(s, -1)} disabled={i === 0} className="text-xs text-slate-400 disabled:opacity-30" data-testid={`stages-up-${s.id}`}>▲</button>
                      <button onClick={() => move(s, 1)} disabled={i === stages.length - 1} className="text-xs text-slate-400 disabled:opacity-30" data-testid={`stages-down-${s.id}`}>▼</button>
                    </div>
                  </td>
                  <td><span className="inline-block h-3 w-3 rounded-full" style={{ background: s.color }} /></td>
                  <td className="font-medium" style={{ color: s.color }}>{s.name}</td>
                  <td><span className="inline-flex h-7 min-w-[2rem] items-center justify-center rounded border border-slate-200 px-2 text-xs">{s.lead_count || 0}</span></td>
                  <td>{s.is_final ? <Flag className="h-4 w-4 text-green-500" /> : null}</td>
                  <td className="space-x-2">
                    <button onClick={() => startEdit(s)} className="text-blue-500 hover:text-blue-700" data-testid={`stages-edit-${s.id}`}><Pencil className="h-4 w-4" /></button>
                    <button onClick={() => remove(s)} className="text-red-500 hover:text-red-700" data-testid={`stages-delete-${s.id}`}><Trash2 className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))}
              {stages.length === 0 && <tr><td colSpan="6" className="py-6 text-center text-slate-400">No stages yet.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card className="border-red-200" data-testid="danger-zone-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-red-700">
            <AlertTriangle className="h-4 w-4" /> Danger Zone
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-semibold text-red-800">Reset all leads to a fresh state</p>
            <p className="mt-1 text-xs text-red-700">
              For testing only. Keeps every lead's name, phone and contact info, but resets stage,
              branch, consultation, physio assignment, packages and fees back to New Leads —
              and permanently deletes all sessions, weekly assessments, package recommendations,
              appointments, patient view links, and activity history. Cannot be undone.
            </p>
            <Button
              variant="outline"
              className="mt-3 border-red-300 text-red-700 hover:bg-red-100"
              onClick={handleResetAllLeads}
              disabled={resetting}
              data-testid="reset-all-leads-btn"
            >
              <Trash2 className="mr-1 h-4 w-4" /> {resetting ? "Resetting..." : "Reset All Leads"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {showAdd && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" data-testid="stages-dialog">
          <div className="w-full max-w-md space-y-3 rounded-lg bg-white p-5 shadow-xl">
            <h3 className="text-base font-semibold">{editing ? "Edit Stage" : "Add Stage"}</h3>
            <Input placeholder="Stage name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="stages-form-name" />
            <div>
              <p className="mb-1 text-xs text-slate-500">Color</p>
              <div className="flex flex-wrap gap-2">
                {PALETTE.map((c) => (
                  <button key={c} onClick={() => setForm({ ...form, color: c })} className={`h-7 w-7 rounded-full border-2 ${form.color === c ? "border-slate-900 ring-2 ring-offset-1" : "border-transparent"}`} style={{ background: c }} data-testid={`stages-form-color-${c}`} />
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!form.is_final} onChange={(e) => setForm({ ...form, is_final: e.target.checked })} data-testid="stages-form-final" />Mark as Final stage</label>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { setShowAdd(false); setEditing(null); }} className="flex-1" data-testid="stages-form-cancel">Cancel</Button>
              <Button onClick={submit} className="flex-1" data-testid="stages-form-submit">{editing ? "Save" : "Create"}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PipelineStageManagement;
