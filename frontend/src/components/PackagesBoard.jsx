import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Package as PackageIcon, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { listPackages, createPackage, updatePackage, deletePackage } from "@/lib/api";

const empty = { name: "", weeks: 4, sessions_per_week: 2, price: 0, description: "", services: "", active: true };

export const PackagesBoard = () => {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(empty);
  const [editId, setEditId] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);

  const refresh = async () => {
    try { setItems(await listPackages()); }
    catch (e) { toast.error(e?.response?.data?.detail || "Failed to load packages"); }
  };
  useEffect(() => {
    (async () => {
      try { setItems(await listPackages()); }
      catch (e) { toast.error(e?.response?.data?.detail || "Failed to load packages"); }
    })();
  }, []);

  const startNew = () => { setDraft(empty); setEditId(null); setOpen(true); };
  const startEdit = (p) => {
    setDraft({ ...p, services: (p.services || []).join(", ") });
    setEditId(p.id); setOpen(true);
  };

  const save = async () => {
    if (!draft.name.trim()) { toast.error("Name required"); return; }
    const payload = {
      name: draft.name.trim(),
      weeks: parseInt(draft.weeks, 10) || 1,
      sessions_per_week: parseInt(draft.sessions_per_week, 10) || 2,
      price: parseFloat(draft.price) || 0,
      description: draft.description || "",
      services: (typeof draft.services === "string" ? draft.services.split(",") : draft.services).map((s) => s.trim()).filter(Boolean),
      active: !!draft.active,
    };
    try {
      if (editId) await updatePackage(editId, payload);
      else await createPackage(payload);
      toast.success(editId ? "Package updated" : "Package created");
      setOpen(false); refresh();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  const remove = async () => {
    try {
      await deletePackage(confirmDel.id);
      toast.success("Package deleted");
      setConfirmDel(null); refresh();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  return (
    <div className="space-y-4" data-testid="packages-board">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base"><PackageIcon className="h-4 w-4 text-violet-500" /> Comprehensive Packages</CardTitle>
          <Button onClick={startNew} className="bg-violet-600 hover:bg-violet-700" data-testid="packages-new"><Plus className="mr-1 h-4 w-4" />New Package</Button>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr><th className="px-4 py-2 text-left">Name</th><th className="px-4 py-2 text-left">Weeks</th><th className="px-4 py-2 text-left">Sessions</th><th className="px-4 py-2 text-left">Price</th><th className="px-4 py-2 text-left">Services</th><th className="px-4 py-2 text-left">Status</th><th className="px-4 py-2"></th></tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} className="border-t border-slate-100" data-testid={`package-row-${p.id}`}>
                  <td className="px-4 py-2 font-semibold text-slate-800">{p.name}</td>
                  <td className="px-4 py-2">{p.weeks}w</td>
                  <td className="px-4 py-2">{p.total_sessions} <span className="text-xs text-slate-400">({p.sessions_per_week}/wk)</span></td>
                  <td className="px-4 py-2">₹{p.price?.toLocaleString?.() || p.price}</td>
                  <td className="px-4 py-2 text-xs text-slate-500">{(p.services || []).join(", ") || "—"}</td>
                  <td className="px-4 py-2"><span className={`rounded px-2 py-0.5 text-xs ${p.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>{p.active ? "Active" : "Inactive"}</span></td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1">
                      <button onClick={() => startEdit(p)} className="rounded p-1 text-slate-500 hover:bg-violet-50 hover:text-violet-600" data-testid={`package-edit-${p.id}`} title="Edit"><Pencil className="h-4 w-4" /></button>
                      <button onClick={() => setConfirmDel(p)} className="rounded p-1 text-slate-500 hover:bg-rose-50 hover:text-rose-600" data-testid={`package-del-${p.id}`} title="Delete"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (<tr><td colSpan="7" className="px-4 py-8 text-center text-slate-400">No packages yet. Create one with the button above.</td></tr>)}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {open && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" data-testid="package-form-modal">
          <div className="w-full max-w-lg space-y-3 rounded-xl bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">{editId ? "Edit Package" : "Create Package"}</h3>
              <button onClick={() => setOpen(false)} className="p-1 text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2"><label className="text-xs text-slate-500">Name *</label><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Knee Pain Recovery (4 weeks)" data-testid="package-name" /></div>
              <div><label className="text-xs text-slate-500">Weeks *</label><Input type="number" min="1" max="104" value={draft.weeks} onChange={(e) => setDraft({ ...draft, weeks: e.target.value })} data-testid="package-weeks" /></div>
              <div><label className="text-xs text-slate-500">Sessions / week</label><Input type="number" min="1" max="14" value={draft.sessions_per_week} onChange={(e) => setDraft({ ...draft, sessions_per_week: e.target.value })} data-testid="package-sessions" /></div>
              <div><label className="text-xs text-slate-500">Price (₹)</label><Input type="number" min="0" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} data-testid="package-price" /></div>
              <div className="flex items-end pb-1.5"><label className="flex items-center gap-2 text-xs text-slate-500"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} data-testid="package-active" /> Active</label></div>
              <div className="col-span-2"><label className="text-xs text-slate-500">Services (comma-separated)</label><Input value={draft.services} onChange={(e) => setDraft({ ...draft, services: e.target.value })} placeholder="Manual Therapy, Electrotherapy, Exercise Plan" data-testid="package-services" /></div>
              <div className="col-span-2"><label className="text-xs text-slate-500">Description</label><Input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Short description shown to branch admins" data-testid="package-description" /></div>
              <p className="col-span-2 text-xs text-violet-700">Total sessions: <b>{(parseInt(draft.weeks, 10) || 0) * (parseInt(draft.sessions_per_week, 10) || 0)}</b></p>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={save} className="bg-violet-600 hover:bg-violet-700" data-testid="package-save">{editId ? "Update" : "Create"}</Button>
            </div>
          </div>
        </div>
      )}

      {confirmDel && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" data-testid="package-del-modal">
          <div className="w-full max-w-sm space-y-3 rounded-xl bg-white p-5 shadow-2xl">
            <h3 className="text-base font-semibold">Delete <b>{confirmDel.name}</b>?</h3>
            <p className="text-xs text-slate-500">This cannot be undone. Leads who already bought this package keep their record.</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmDel(null)}>Cancel</Button>
              <Button onClick={remove} className="bg-rose-600 hover:bg-rose-700" data-testid="package-del-confirm">Yes, Delete</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PackagesBoard;
