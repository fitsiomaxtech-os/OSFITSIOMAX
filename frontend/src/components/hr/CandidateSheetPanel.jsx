import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Link2,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import {
  recruitmentSheetStatus,
  recruitmentSources,
  recruitmentCreateSource,
  recruitmentDeleteSource,
  recruitmentPullSource,
} from "@/lib/api";

// HR's own Google Sheet sources, kept apart from Marketing's. Both read through the one
// company-wide Google connection Super Admin authorises, but a recruitment sheet must never
// be pullable into leads and a marketing sheet must never land in candidates — they are
// separate collections so that stays a structural guarantee, not a filter to remember.

const prettyWhen = (iso) => {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "never";
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

const emptySource = { name: "", sheet_url: "", sheet_name: "Sheet1", default_position: "" };

export const CandidateSheetPanel = ({ onImported }) => {
  const [status, setStatus] = useState({ connected: false, fields: [] });
  const [sources, setSources] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(emptySource);
  const [busyId, setBusyId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  const load = useCallback(async () => {
    try {
      const [st, rows] = await Promise.all([recruitmentSheetStatus(), recruitmentSources()]);
      setStatus(st);
      setSources(rows);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load sheet sources");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!form.name.trim() || !form.sheet_url.trim()) {
      toast.error("Give the sheet a name and paste its link");
      return;
    }
    setSaving(true);
    try {
      await recruitmentCreateSource(form);
      toast.success("Sheet connected");
      setForm(emptySource);
      setShowAdd(false);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not connect that sheet");
    }
    setSaving(false);
  };

  const pull = async (s) => {
    setBusyId(s.id);
    setLastResult(null);
    try {
      const res = await recruitmentPullSource(s.id);
      setLastResult({ name: s.name, ...res });
      toast.success(`${res.imported} candidate(s) imported from ${s.name}`);
      load();
      if (onImported) onImported();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Pull failed");
    }
    setBusyId(null);
  };

  const remove = async (s) => {
    if (!window.confirm(`Disconnect "${s.name}"? Candidates already imported are kept.`)) return;
    try {
      await recruitmentDeleteSource(s.id);
      toast.success("Sheet disconnected");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not disconnect");
    }
  };

  return (
    <div className="space-y-4" data-testid="hr-sheet-panel">
      {/* HR cannot authorise Google themselves — that is Super Admin's one-time step — so
          say which of the two we are waiting on rather than failing a pull with an error. */}
      <div
        className={`flex items-start gap-3 rounded-xl border p-4 ${
          status.connected ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"
        }`}
        data-testid="hr-sheet-status"
      >
        {status.connected
          ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />}
        <div className="min-w-0">
          <p className={`text-sm font-bold ${status.connected ? "text-emerald-800" : "text-amber-800"}`}>
            {status.connected ? "Google Sheets is connected" : "Google Sheets is not connected"}
          </p>
          <p className={`text-xs ${status.connected ? "text-emerald-700" : "text-amber-700"}`}>
            {status.connected
              ? "Add a candidate sheet below and pull whenever you want."
              : "Ask Super Admin to connect Google Sheets under Marketing Source. You can still add sheets here now — they will pull once it is connected."}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-bold text-slate-900">Candidate Lead Sheets</h3>
          <p className="text-xs text-slate-500">Separate from Marketing's sheets. Rows land in the recruitment pipeline, never in patient leads.</p>
        </div>
        <Button onClick={() => setShowAdd(true)} className="shrink-0 bg-indigo-600 text-white hover:bg-indigo-700" data-testid="hr-sheet-add-button">
          <Plus className="mr-1.5 h-4 w-4" /> Connect Sheet
        </Button>
      </div>

      {sources.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 px-3 py-12 text-center text-sm text-slate-400" data-testid="hr-sheet-empty">
          No candidate sheets connected yet.
        </p>
      ) : (
        <div className="space-y-2" data-testid="hr-sheet-list">
          {sources.map((s) => (
            <div key={s.id} className="rounded-xl border border-slate-200 bg-white p-4" data-testid={`hr-sheet-row-${s.id}`}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-bold text-slate-800">
                    <FileSpreadsheet className="h-4 w-4 shrink-0 text-emerald-600" />
                    <span className="truncate">{s.name}</span>
                  </p>
                  <p className="mt-1 truncate text-xs text-slate-500">
                    Tab: <span className="font-mono">{s.sheet_name}</span>
                    {s.default_position ? ` · default position: ${s.default_position}` : ""}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Last pulled {prettyWhen(s.last_synced)} · {s.row_count || 0} imported all-time
                    {s.last_synced ? ` · last run: ${s.last_sync_imported || 0} new, ${s.last_sync_skipped_duplicate || 0} already here` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {s.sheet_url && (
                    <a
                      href={s.sheet_url}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-md border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"
                      aria-label="Open sheet"
                      data-testid={`hr-sheet-open-${s.id}`}
                    >
                      <Link2 className="h-4 w-4" />
                    </a>
                  )}
                  <Button
                    onClick={() => pull(s)}
                    disabled={busyId === s.id}
                    variant="outline"
                    className="border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                    data-testid={`hr-sheet-pull-${s.id}`}
                  >
                    {busyId === s.id
                      ? <><RefreshCw className="mr-1.5 h-4 w-4 animate-spin" /> Pulling</>
                      : <><Download className="mr-1.5 h-4 w-4" /> Pull Now</>}
                  </Button>
                  <button
                    type="button"
                    onClick={() => remove(s)}
                    className="rounded-md border border-slate-200 p-2 text-red-500 hover:bg-red-50"
                    aria-label="Disconnect sheet"
                    data-testid={`hr-sheet-delete-${s.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Which sheet column fed which field — the one thing that explains a pull
                  that "worked" but filled the wrong boxes. */}
              {s.column_mapping && Object.keys(s.column_mapping).length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3" data-testid={`hr-sheet-mapping-${s.id}`}>
                  {Object.entries(s.column_mapping).map(([field, col]) => (
                    <span key={field} className="rounded-[5px] border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                      {field} ← {col}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {lastResult && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm" data-testid="hr-sheet-result">
          <p className="font-bold text-slate-800">Last pull — {lastResult.name}</p>
          <p className="mt-1 text-slate-600">
            {lastResult.rows_received} row(s) read · <span className="font-bold text-emerald-600">{lastResult.imported} imported</span>
            {lastResult.skipped_duplicate ? ` · ${lastResult.skipped_duplicate} already in the pipeline` : ""}
            {lastResult.skipped_no_phone ? ` · ${lastResult.skipped_no_phone} had no usable phone` : ""}
          </p>
          {(lastResult.sample_errors || []).length > 0 && (
            <ul className="mt-2 list-inside list-disc text-xs text-amber-700">
              {lastResult.sample_errors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          )}
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-3 backdrop-blur-sm sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) setShowAdd(false); }} data-testid="hr-sheet-add-modal">
          <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-4 text-white">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5" />
                <p className="text-base font-semibold">Connect a Candidate Sheet</p>
              </div>
              <button onClick={() => setShowAdd(false)} className="rounded-full p-1.5 text-white/80 hover:bg-white/20" data-testid="hr-sheet-add-close">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 p-5">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Sheet Name *</label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Physiotherapist Openings — Aug" data-testid="hr-sheet-form-name" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Google Sheet Link *</label>
                <Input value={form.sheet_url} onChange={(e) => setForm({ ...form, sheet_url: e.target.value })} placeholder="https://docs.google.com/spreadsheets/d/..." data-testid="hr-sheet-form-url" />
                <p className="mt-1 text-[11px] text-slate-400">Paste the whole URL — the spreadsheet ID is read out of it.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Tab Name</label>
                  <Input value={form.sheet_name} onChange={(e) => setForm({ ...form, sheet_name: e.target.value })} placeholder="Sheet1" data-testid="hr-sheet-form-tab" />
                  <p className="mt-1 text-[11px] text-slate-400">Wrong tab name is fine — the first tab is found automatically.</p>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Default Position</label>
                  <Input value={form.default_position} onChange={(e) => setForm({ ...form, default_position: e.target.value })} placeholder="e.g. Physiotherapist" data-testid="hr-sheet-form-position" />
                  <p className="mt-1 text-[11px] text-slate-400">Used when the sheet has no position column.</p>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Columns matched automatically</p>
                <p className="mt-1 text-[11px] text-slate-500">
                  Headers are matched by name, so a column called Mobile, Contact or WhatsApp all fill Phone.
                  A <span className="font-semibold">phone column is required</span>; anything unmatched is kept in the candidate's notes.
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {(status.fields || []).map((f) => (
                    <span key={f} className="rounded-[5px] border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600">{f}</span>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3">
              <Button variant="outline" onClick={() => setShowAdd(false)} data-testid="hr-sheet-form-cancel">Cancel</Button>
              <Button onClick={create} disabled={saving} className="bg-indigo-600 text-white hover:bg-indigo-700" data-testid="hr-sheet-form-save">
                {saving ? "Connecting..." : "Connect Sheet"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CandidateSheetPanel;
