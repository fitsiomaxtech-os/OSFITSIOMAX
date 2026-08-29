import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Pencil, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { getPhysioTypes, createPhysioType, updatePhysioType, deletePhysioType } from "@/lib/api";

/**
 * Super Admin > Services and Products > Physiotherapy Treatment.
 *
 * The physiotherapy treatments the clinic sells, by name. Built alongside Treatments and
 * kept apart from it because the two answer different questions: a Treatment is what is
 * wrong with the patient — Frozen Shoulder, Knee Pain — and a Physiotherapy Treatment is
 * what is being sold to them. Folding them into one list would mean picking a diagnosis
 * where a thing to sell is wanted.
 *
 * A name and nothing else, for the same reason Treatments is: the price, the session count
 * and the duration belong to a package in FITSIO STORE, and repeating them here would be a
 * second place to maintain them and a question about which one is right.
 *
 * Something consumes it now: an expert's calendar is published under one of these, chosen
 * on MANAGEMENT → PHYSIO CALENDAR. That is why a rename here writes through to the experts
 * holding the old name, and why deleting one still held is refused rather than silently
 * stranding them — both enforced server-side, see v3_update_physio_type.
 */
export const PhysioTypesBoard = () => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  // The row being renamed, as { id, name } — the name is edited in place on this copy so
  // an abandoned edit leaves the list untouched.
  const [editing, setEditing] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await getPhysioTypes());
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to load physiotherapy treatments");
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter((r) => (r.name || "").toLowerCase().includes(q)) : rows;
  }, [rows, search]);

  const saveEdit = async () => {
    const name = (editing.name || "").trim();
    if (!name) { toast.error("Physiotherapy Treatment name is required"); return; }
    setSavingEdit(true);
    try {
      await updatePhysioType(editing.id, { name });
      toast.success(`Renamed to ${name}`);
      setEditing(null);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Rename failed");
    }
    setSavingEdit(false);
  };

  const remove = async (row) => {
    try {
      await deletePhysioType(row.id);
      toast.success(`Deleted ${row.name}`);
      setConfirmDelete(null);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Delete failed");
    }
  };

  return (
    <div className="space-y-4" data-testid="physio-types-board">
      {/* Same one-row toolbar the Treatments board uses — search, gray refresh, create —
          because the two sit on adjacent tabs and should not each solve this differently. */}
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search physiotherapy treatments..."
            className="h-10 pl-8"
            data-testid="physio-type-search"
          />
        </div>
        <Button
          onClick={load}
          disabled={loading}
          title="Refresh"
          aria-label="Refresh"
          className="h-10 w-10 shrink-0 bg-slate-500 p-0 text-white hover:bg-slate-600"
          data-testid="physio-type-refresh-btn"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
        {/* Icon-only on a phone, full label from sm up — the words would take half the row
            on the narrowest screen for a button used occasionally. */}
        <Button
          onClick={() => setShowCreate(true)}
          className="h-10 w-10 shrink-0 bg-sky-600 p-0 text-white hover:bg-sky-700 sm:w-auto sm:px-4"
          title="Add Physiotherapy Treatment"
          aria-label="Add Physiotherapy Treatment"
          data-testid="physio-type-create-btn"
        >
          <Plus className="h-4 w-4 sm:mr-1" />
          <span className="hidden sm:inline">Add Physiotherapy Treatment</span>
        </Button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Physiotherapy Treatment <span className="text-slate-400">({rows.length})</span>
          </p>
        </div>

        {loading && rows.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-slate-400" data-testid="physio-type-loading">Loading physiotherapy treatments...</p>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center" data-testid="physio-type-empty">
            <Activity className="h-9 w-9 text-slate-300" />
            <p className="text-sm text-slate-500">
              {rows.length === 0 ? "No physiotherapy treatments yet." : `Nothing matches "${search}".`}
            </p>
            {rows.length === 0 && (
              <p className="text-xs text-slate-400">Click <span className="font-semibold">Add Physiotherapy Treatment</span> to add the first one.</p>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100" data-testid="physio-type-list">
            {filtered.map((row) => (
              <li key={row.id} className="flex items-center gap-3 px-4 py-3" data-testid={`physio-type-row-${row.id}`}>
                <Activity className="h-4 w-4 shrink-0 text-slate-300" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{row.name}</span>
                <button
                  onClick={() => setEditing({ id: row.id, name: row.name })}
                  className="shrink-0 rounded p-1.5 text-slate-400 transition hover:bg-sky-50 hover:text-sky-600"
                  title={`Rename ${row.name}`}
                  aria-label={`Rename ${row.name}`}
                  data-testid={`physio-type-edit-${row.id}`}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setConfirmDelete(row)}
                  className="shrink-0 rounded p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                  title={`Delete ${row.name}`}
                  aria-label={`Delete ${row.name}`}
                  data-testid={`physio-type-delete-${row.id}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showCreate && (
        <AddServiceDialog
          existing={rows}
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); load(); }}
        />
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-testid="physio-type-edit-dialog">
          <div className="w-full max-w-sm space-y-4 rounded-xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-base font-semibold text-slate-900">Rename physiotherapy treatment</h3>
              <button onClick={() => setEditing(null)} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Close" data-testid="physio-type-edit-close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <Input
              autoFocus
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); }}
              placeholder="Physiotherapy Treatment name"
              data-testid="physio-type-edit-input"
            />
            {/* Says what a rename reaches, because it reaches further than this list: an
                expert already offered under the old name is moved to the new one. */}
            <p className="text-[11px] text-slate-400">
              Every expert offered under this physiotherapy treatment is renamed with it.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setEditing(null)} data-testid="physio-type-edit-cancel">Cancel</Button>
              <Button onClick={saveEdit} disabled={savingEdit || !editing.name.trim()} className="bg-sky-600 hover:bg-sky-700" data-testid="physio-type-edit-save">
                {savingEdit ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-testid="physio-type-delete-dialog">
          <div className="w-full max-w-sm space-y-4 rounded-xl bg-white p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-rose-100">
                <Trash2 className="h-5 w-5 text-rose-600" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-slate-900">Delete physiotherapy treatment?</h3>
                <p className="mt-1 text-xs text-slate-500">
                  <b className="text-slate-700">{confirmDelete.name}</b> is removed from the Physiotherapy Treatment list. An expert is still offered under it, this is refused rather than leaving them stranded.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setConfirmDelete(null)} data-testid="physio-type-delete-cancel">Cancel</Button>
              <Button onClick={() => remove(confirmDelete)} className="bg-rose-600 hover:bg-rose-700" data-testid="physio-type-delete-confirm">
                Yes, Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Type a physiotherapy treatment and Save.
 *
 * Stays open after saving and clears the field, because filling a list is a batch job —
 * closing after each would mean reopening it a dozen times to type a dozen names. The
 * duplicate check runs here as well as on the server: the server is the authority, but
 * catching it before the round trip lets the field say so instead of a toast.
 */
const AddServiceDialog = ({ existing = [], onClose, onSaved }) => {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [added, setAdded] = useState([]);

  const trimmed = name.trim();
  const duplicate = useMemo(
    () => existing.concat(added.map((n) => ({ name: n }))).some((r) => (r.name || "").toLowerCase() === trimmed.toLowerCase()),
    [existing, added, trimmed],
  );

  const submit = async () => {
    if (!trimmed) { toast.error("Enter a physiotherapy treatment name"); return; }
    if (duplicate) return;
    setSaving(true);
    try {
      await createPhysioType({ name: trimmed });
      setAdded((prev) => [...prev, trimmed]);
      setName("");
      toast.success(`Saved ${trimmed}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    }
    setSaving(false);
  };

  // Closing after saving anything reloads the list behind, so what was added is on screen
  // rather than needing a refresh to appear.
  const close = () => { if (added.length) onSaved(); else onClose(); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-testid="physio-type-create-dialog">
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Add Physiotherapy Treatment</h3>
            <p className="text-xs text-slate-500">Add a physiotherapy treatment. Keep adding — this stays open.</p>
          </div>
          <button onClick={close} className="text-slate-400 hover:text-slate-600" data-testid="physio-type-create-close"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-3 p-5">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Physiotherapy Treatment Name *</label>
            <Input
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !duplicate && !saving) submit(); }}
              placeholder="e.g. Sports Physio"
              data-testid="physio-type-create-name"
            />
            {duplicate && trimmed && (
              <p className="mt-1 text-[11px] font-medium text-rose-600" data-testid="physio-type-create-duplicate">
                "{trimmed}" is already in the list.
              </p>
            )}
          </div>

          {added.length > 0 && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2" data-testid="physio-type-create-added">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Saved this session</p>
              <div className="flex flex-wrap gap-1.5">
                {added.map((n) => (
                  <span key={n} className="rounded-full border border-emerald-200 bg-white px-2 py-0.5 text-[11px] font-medium text-emerald-700">{n}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <Button variant="outline" onClick={close} data-testid="physio-type-create-cancel">
            {added.length ? "Done" : "Cancel"}
          </Button>
          <Button
            onClick={submit}
            disabled={saving || duplicate || !trimmed}
            className="bg-sky-600 hover:bg-sky-700"
            data-testid="physio-type-create-submit"
          >
            <Plus className="mr-1 h-4 w-4" />{saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default PhysioTypesBoard;
