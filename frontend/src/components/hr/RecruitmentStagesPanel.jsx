import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Flag, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import {
  recruitmentStages,
  recruitmentCreateStage,
  recruitmentUpdateStage,
  recruitmentDeleteStage,
  recruitmentReorderStages,
} from "@/lib/api";

// The recruitment pipeline, editable from HR's own board rather than only from Super
// Admin's Pipeline Stage Management. Same stages, same records — a second door onto them,
// not a copy.
//
// Renaming here is safe in a way it isn't for the patient pipelines: candidates reference a
// stage by id, so a rename touches nothing else and can't orphan anybody.

const PALETTE = ["#6366f1", "#3b82f6", "#0ea5e9", "#06b6d4", "#14b8a6", "#22c55e", "#84cc16", "#eab308", "#f59e0b", "#f97316", "#ef4444", "#ec4899", "#a855f7", "#64748b"];

const blankForm = { name: "", color: PALETTE[0], is_final: false };

export const RecruitmentStagesPanel = ({ onChanged }) => {
  const [stages, setStages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(blankForm);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setStages(await recruitmentStages());
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load stages");
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const done = async (msg) => {
    toast.success(msg);
    await load();
    if (onChanged) onChanged();
  };

  const submit = async () => {
    if (!form.name.trim()) { toast.error("Stage name is required"); return; }
    setBusy(true);
    try {
      if (editing) await recruitmentUpdateStage(editing.id, form);
      else await recruitmentCreateStage(form);
      setShowForm(false);
      setEditing(null);
      setForm(blankForm);
      await done(editing ? "Stage updated" : "Stage added");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    }
    setBusy(false);
  };

  const remove = async (s) => {
    if (!window.confirm(`Delete the "${s.name}" stage?`)) return;
    setBusy(true);
    try {
      await recruitmentDeleteStage(s.id);
      await done("Stage deleted");
    } catch (e) {
      // The useful case: the API refuses while candidates are standing on it.
      toast.error(e?.response?.data?.detail || "Delete failed");
    }
    setBusy(false);
  };

  const move = async (index, dir) => {
    const target = index + dir;
    if (target < 0 || target >= stages.length) return;
    const ids = stages.map((s) => s.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    // Optimistic: the row should move under the cursor, not a network round-trip later.
    const next = [...stages];
    [next[index], next[target]] = [next[target], next[index]];
    setStages(next);
    try {
      await recruitmentReorderStages(ids);
      if (onChanged) onChanged();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Reorder failed");
      load();
    }
  };

  const startEdit = (s) => {
    setEditing(s);
    setForm({ name: s.name, color: s.color, is_final: !!s.is_final });
    setShowForm(true);
  };

  const startAdd = () => {
    setEditing(null);
    setForm({ ...blankForm, color: PALETTE[Math.floor(Math.random() * PALETTE.length)] });
    setShowForm(true);
  };

  return (
    <div className="space-y-4" data-testid="hr-stages-panel">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-bold text-slate-900">Recruitment Pipeline Stages</h3>
          <p className="text-xs text-slate-500">Rename, recolour, reorder or add a round. Candidates follow automatically.</p>
        </div>
        {!showForm && (
          <Button onClick={startAdd} className="shrink-0 bg-indigo-600 text-white hover:bg-indigo-700" data-testid="hr-stages-add">
            <Plus className="mr-1.5 h-4 w-4" /> Add Stage
          </Button>
        )}
      </div>

      {loading ? (
        <p className="py-10 text-center text-sm text-slate-400">Loading stages...</p>
      ) : (
        <div className="space-y-2" data-testid="hr-stages-list">
          {stages.map((s, i) => (
            <div key={s.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3" data-testid={`hr-stage-manage-${s.id}`}>
              <div className="flex shrink-0 flex-col">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className="rounded p-0.5 text-slate-400 hover:bg-slate-100 disabled:opacity-25"
                  aria-label="Move up"
                  data-testid={`hr-stage-up-${s.id}`}
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === stages.length - 1}
                  className="rounded p-0.5 text-slate-400 hover:bg-slate-100 disabled:opacity-25"
                  aria-label="Move down"
                  data-testid={`hr-stage-down-${s.id}`}
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
              </div>

              <span className="h-8 w-8 shrink-0 rounded-lg" style={{ backgroundColor: s.color }} />

              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-sm font-bold text-slate-800">
                  {s.name}
                  {s.is_final && <Flag className="h-3 w-3 shrink-0 text-slate-400" />}
                </p>
                <p className="text-[11px] text-slate-400">
                  Position {i + 1} · {s.count ?? 0} candidate{(s.count ?? 0) === 1 ? "" : "s"}
                  {i === 0 ? " · new candidates land here" : ""}
                </p>
              </div>

              <button
                type="button"
                onClick={() => startEdit(s)}
                className="shrink-0 rounded-md border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"
                aria-label={`Edit ${s.name}`}
                data-testid={`hr-stage-edit-${s.id}`}
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => remove(s)}
                disabled={busy}
                className="shrink-0 rounded-md border border-slate-200 p-2 text-red-500 hover:bg-red-50 disabled:opacity-40"
                aria-label={`Delete ${s.name}`}
                data-testid={`hr-stage-delete-${s.id}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4" data-testid="hr-stages-form">
          <p className="mb-3 text-xs font-bold uppercase tracking-wider text-indigo-500">
            {editing ? `Edit "${editing.name}"` : "New Stage"}
          </p>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Stage Name</label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Document Verification" data-testid="hr-stages-form-name" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Colour</label>
              <div className="flex flex-wrap gap-1.5">
                {PALETTE.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setForm({ ...form, color: c })}
                    className={`h-7 w-7 rounded-md transition ${form.color === c ? "ring-2 ring-slate-800 ring-offset-2" : ""}`}
                    style={{ backgroundColor: c }}
                    aria-label={`Colour ${c}`}
                    data-testid={`hr-stages-form-color-${c.replace("#", "")}`}
                  />
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={!!form.is_final}
                onChange={(e) => setForm({ ...form, is_final: e.target.checked })}
                data-testid="hr-stages-form-final"
              />
              Closing stage — a candidate here has left the pipeline (Joined or Rejected)
            </label>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setShowForm(false); setEditing(null); }} data-testid="hr-stages-form-cancel">Cancel</Button>
            <Button onClick={submit} disabled={busy} className="bg-indigo-600 text-white hover:bg-indigo-700" data-testid="hr-stages-form-save">
              {busy ? "Saving..." : editing ? "Save Changes" : "Add Stage"}
            </Button>
          </div>
        </div>
      )}

      <p className="text-[11px] text-slate-400">A stage with candidates on it can't be deleted until they're moved.</p>
    </div>
  );
};

export default RecruitmentStagesPanel;
