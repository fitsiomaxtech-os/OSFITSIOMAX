import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, Trash2, ArrowLeft, Flag, GripVertical } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { stagesList, stagesCreate, stagesUpdate, stagesDelete, stagesReorder } from "@/lib/api";

const PALETTE = ["#6366f1", "#3b82f6", "#0ea5e9", "#06b6d4", "#14b8a6", "#22c55e", "#84cc16", "#eab308", "#f59e0b", "#f97316", "#ef4444", "#ec4899", "#a855f7", "#64748b"];

export const PipelineStageManagement = ({ onBack }) => {
  const [type, setType] = useState("pre_sales");
  const [stages, setStages] = useState([]);
  const [counts, setCounts] = useState({ pre_sales: 0, sales: 0 });
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", color: "#6366f1", is_final: false });

  const load = useCallback(async () => {
    const [pre, sale] = await Promise.all([stagesList("pre_sales"), stagesList("sales")]);
    setCounts({ pre_sales: pre.length, sales: sale.length });
    setStages(type === "pre_sales" ? pre : sale);
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

  return (
    <div className="space-y-5" data-testid="pipeline-stages-page">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack} data-testid="stages-back-btn"><ArrowLeft className="h-4 w-4 mr-1" />Settings</Button>
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Pipeline Stage Management</h2>
            <p className="text-sm text-slate-500">Add, edit, reorder, and delete stages for Pre-Sales & Branch pipelines.</p>
          </div>
        </div>
        <Button onClick={() => { setEditing(null); setForm({ name: "", color: PALETTE[Math.floor(Math.random() * PALETTE.length)], is_final: false }); setShowAdd(true); }} className="bg-orange-500 hover:bg-orange-600" data-testid="stages-add-btn"><Plus className="h-4 w-4 mr-1" />Add Stage</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border-l-4 border-indigo-500 bg-white p-4 shadow-sm" data-testid="stages-kpi-presales"><p className="text-xs text-slate-500">Pre-Sales Stages</p><p className="text-3xl font-bold text-indigo-600">{counts.pre_sales}</p></div>
        <div className="rounded-xl border-l-4 border-green-500 bg-white p-4 shadow-sm" data-testid="stages-kpi-sales"><p className="text-xs text-slate-500">Branch Stages</p><p className="text-3xl font-bold text-green-600">{counts.sales}</p></div>
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1">
        <button onClick={() => setType("pre_sales")} className={`rounded-md py-2 text-sm font-semibold ${type === "pre_sales" ? "bg-white text-indigo-600 shadow" : "text-slate-500"}`} data-testid="stages-tab-presales">Pre-Sales ({counts.pre_sales})</button>
        <button onClick={() => setType("sales")} className={`rounded-md py-2 text-sm font-semibold ${type === "sales" ? "bg-white text-green-600 shadow" : "text-slate-500"}`} data-testid="stages-tab-sales">Branch Stages ({counts.sales})</button>
      </div>

      <Card data-testid="stages-list-card">
        <CardHeader><CardTitle className="text-base">{type === "pre_sales" ? "Pre-Sales" : "Branch"} Pipeline Stages</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500"><tr><th className="py-2">Order</th><th>Color</th><th>Stage Name</th><th>Leads</th><th>Final</th><th>Actions</th></tr></thead>
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
