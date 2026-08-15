import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardList, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { getTreatmentTypes, createTreatmentType, deleteTreatmentType } from "@/lib/api";

/**
 * Super Admin > Treatment — the catalogue of treatments the clinic offers.
 *
 * A name and nothing else. Price, session count and duration live on the packages in
 * FITSIO STORE, and repeating them here would be a second place to maintain them and a
 * question about which one is right. This list is the vocabulary; the store is the price
 * list.
 *
 * Nothing consumes it yet. It is a catalogue to fill now and pick from later, which is
 * also why deleting is unguarded — see v3_delete_treatment_type for the check it will
 * need the moment something does reference one.
 */
export const TreatmentTypesBoard = () => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await getTreatmentTypes());
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to load treatments");
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter((r) => (r.name || "").toLowerCase().includes(q)) : rows;
  }, [rows, search]);

  const remove = async (row) => {
    try {
      await deleteTreatmentType(row.id);
      toast.success(`Deleted ${row.name}`);
      setConfirmDelete(null);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Delete failed");
    }
  };

  return (
    <div className="space-y-4" data-testid="treatment-types-board">
      {/* One row on a phone as well as the desk: a search, a gray refresh and the create
          button fit across, which is the arrangement the other boards settled on. */}
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search treatments..."
            className="h-10 pl-8"
            data-testid="treatment-search"
          />
        </div>
        <Button
          onClick={load}
          disabled={loading}
          title="Refresh"
          aria-label="Refresh"
          className="h-10 w-10 shrink-0 bg-slate-500 p-0 text-white hover:bg-slate-600"
          data-testid="treatment-refresh-btn"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
        {/* Icon-only on a phone, full label from sm up — the words would take half the row
            on the narrowest screen for a button used occasionally. */}
        <Button
          onClick={() => setShowCreate(true)}
          className="h-10 w-10 shrink-0 bg-sky-600 p-0 text-white hover:bg-sky-700 sm:w-auto sm:px-4"
          title="Create Treatment"
          aria-label="Create Treatment"
          data-testid="treatment-create-btn"
        >
          <Plus className="h-4 w-4 sm:mr-1" />
          <span className="hidden sm:inline">Create Treatment</span>
        </Button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Treatments <span className="text-slate-400">({rows.length})</span>
          </p>
        </div>

        {loading && rows.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-slate-400" data-testid="treatment-loading">Loading treatments...</p>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center" data-testid="treatment-empty">
            <ClipboardList className="h-9 w-9 text-slate-300" />
            <p className="text-sm text-slate-500">
              {rows.length === 0 ? "No treatments yet." : `Nothing matches "${search}".`}
            </p>
            {rows.length === 0 && (
              <p className="text-xs text-slate-400">Click <span className="font-semibold">Create Treatment</span> to add the first one.</p>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100" data-testid="treatment-list">
            {filtered.map((row) => (
              <li key={row.id} className="flex items-center gap-3 px-4 py-3" data-testid={`treatment-row-${row.id}`}>
                <ClipboardList className="h-4 w-4 shrink-0 text-slate-300" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{row.name}</span>
                <button
                  onClick={() => setConfirmDelete(row)}
                  className="shrink-0 rounded p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                  title={`Delete ${row.name}`}
                  aria-label={`Delete ${row.name}`}
                  data-testid={`treatment-delete-${row.id}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showCreate && (
        <CreateTreatmentDialog
          existing={rows}
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); load(); }}
        />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-testid="treatment-delete-dialog">
          <div className="w-full max-w-sm space-y-4 rounded-xl bg-white p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-rose-100">
                <Trash2 className="h-5 w-5 text-rose-600" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-slate-900">Delete treatment?</h3>
                <p className="mt-1 text-xs text-slate-500">
                  <b className="text-slate-700">{confirmDelete.name}</b> is removed from the catalogue. Nothing else in the OS refers to it, so nothing else changes.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setConfirmDelete(null)} data-testid="treatment-delete-cancel">Cancel</Button>
              <Button onClick={() => remove(confirmDelete)} className="bg-rose-600 hover:bg-rose-700" data-testid="treatment-delete-confirm">
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
 * Add one treatment, or several in a row.
 *
 * Stays open after saving and clears the field, because filling a catalogue is a batch
 * job — closing after each would mean reopening it a dozen times to type a dozen names.
 * The duplicate check runs here as well as on the server: the server is the authority,
 * but catching it before the round trip lets the button say so instead of a toast.
 */
const CreateTreatmentDialog = ({ existing = [], onClose, onSaved }) => {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [added, setAdded] = useState([]);

  const trimmed = name.trim();
  const duplicate = useMemo(
    () => existing.concat(added.map((n) => ({ name: n }))).some((r) => (r.name || "").toLowerCase() === trimmed.toLowerCase()),
    [existing, added, trimmed],
  );

  const submit = async () => {
    if (!trimmed) { toast.error("Enter a treatment name"); return; }
    if (duplicate) return;
    setSaving(true);
    try {
      await createTreatmentType({ name: trimmed });
      setAdded((prev) => [...prev, trimmed]);
      setName("");
      toast.success(`Added ${trimmed}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Create failed");
    }
    setSaving(false);
  };

  const close = () => { if (added.length) onSaved(); else onClose(); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-testid="treatment-create-dialog">
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Create Treatment</h3>
            <p className="text-xs text-slate-500">Add a treatment to the catalogue. Keep adding — this stays open.</p>
          </div>
          <button onClick={close} className="text-slate-400 hover:text-slate-600" data-testid="treatment-create-close"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-3 p-5">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Treatment Name *</label>
            {/* Two lines, and they earn their space: the first says where the name will
                actually be seen, which is the thing that makes people write it carefully;
                the second says how to write it, with a good and a bad example side by
                side rather than an abstract rule about brevity. */}
            <p className="mb-1.5 text-[11px] leading-relaxed text-slate-500">
              Appears as a tick box on every patient's Treatment Summary, for the CONSULTANT to select during a consultation.
              <br />
              Keep it short and specific — <span className="font-medium text-slate-600">"Dry Needling"</span>, not <span className="italic">"needling therapy for lower back pain"</span>.
            </p>
            <Input
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !duplicate && !saving) submit(); }}
              placeholder="e.g. Dry Needling"
              data-testid="treatment-create-name"
            />
            {duplicate && trimmed && (
              <p className="mt-1 text-[11px] font-medium text-rose-600" data-testid="treatment-create-duplicate">
                "{trimmed}" is already in the catalogue.
              </p>
            )}
          </div>

          {added.length > 0 && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2" data-testid="treatment-create-added">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Added this session</p>
              <div className="flex flex-wrap gap-1.5">
                {added.map((n) => (
                  <span key={n} className="rounded-full border border-emerald-200 bg-white px-2 py-0.5 text-[11px] font-medium text-emerald-700">{n}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <Button variant="outline" onClick={close} data-testid="treatment-create-cancel">
            {added.length ? "Done" : "Cancel"}
          </Button>
          <Button
            onClick={submit}
            disabled={saving || duplicate || !trimmed}
            className="bg-sky-600 hover:bg-sky-700"
            data-testid="treatment-create-submit"
          >
            <Plus className="mr-1 h-4 w-4" />{saving ? "Adding..." : "Add Treatment"}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default TreatmentTypesBoard;
