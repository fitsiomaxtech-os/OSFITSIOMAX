import { useCallback, useEffect, useRef, useState } from "react";
import { Zap, X, RefreshCw, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { gsAutoSyncSources, gsAutoSyncToggle } from "@/lib/api";

const INTERVAL_OPTIONS = [
  { value: 5, label: "Every 5 min" },
  { value: 15, label: "Every 15 min" },
  { value: 30, label: "Every 30 min" },
  { value: 60, label: "Every 1 hour" },
  { value: 180, label: "Every 3 hours" },
  { value: 360, label: "Every 6 hours" },
];

const fmtTime = (iso) => {
  if (!iso) return "Never";
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
};

export const AutoSyncPopover = () => {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ connected: false, sources: [] });
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await gsAutoSyncSources()); }
    catch (e) { console.warn("[auto-sync load]", e?.message || e); }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  // Click-outside to close
  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const toggle = async (s, nextEnabled) => {
    try {
      await gsAutoSyncToggle(s.id, { auto_sync_enabled: nextEnabled, auto_sync_interval_minutes: s.auto_sync_interval_minutes || 30 });
      toast.success(nextEnabled ? `Auto-sync ON for ${s.name}` : `Auto-sync OFF for ${s.name}`);
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed to update"); }
  };

  const setInterval = async (s, minutes) => {
    try {
      await gsAutoSyncToggle(s.id, { auto_sync_interval_minutes: minutes });
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed to update"); }
  };

  const anyEnabled = data.sources.some((s) => s.auto_sync_enabled);

  return (
    <div className="relative" ref={wrapRef}>
      <Button
        variant="outline"
        onClick={() => setOpen((v) => !v)}
        data-testid="presales-autosync-btn"
        className={anyEnabled ? "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : ""}
      >
        <Zap className={`mr-1 h-4 w-4 ${anyEnabled ? "fill-emerald-500 text-emerald-600" : ""}`} />
        Auto-sync
        {anyEnabled && <CheckCircle2 className="ml-1 h-3.5 w-3.5 text-emerald-600" />}
      </Button>

      {open && (
        <div
          className="absolute right-0 z-40 mt-2 w-[420px] rounded-xl border border-slate-200 bg-white p-4 shadow-2xl"
          data-testid="presales-autosync-panel"
        >
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-900">Google Sheets Auto-sync</p>
              <p className="text-[11px] text-slate-500">Pulls new leads automatically on a schedule.</p>
            </div>
            <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-700" data-testid="presales-autosync-close">
              <X className="h-4 w-4" />
            </button>
          </div>

          {!data.connected && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800" data-testid="presales-autosync-not-connected">
              Google Sheets is not connected. Go to <span className="font-semibold">Marketing Board → Lead Sources</span> and click <span className="font-semibold">Continue with Google</span> first.
            </div>
          )}

          {data.connected && data.sources.length === 0 && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600" data-testid="presales-autosync-no-sources">
              No Google Sheet sources yet. Add a source in <span className="font-semibold">Marketing Board → Lead Sources</span>.
            </div>
          )}

          {data.connected && data.sources.length > 0 && (
            <div className="max-h-[340px] space-y-2 overflow-y-auto">
              {data.sources.map((s) => {
                const enabled = !!s.auto_sync_enabled;
                const interval = s.auto_sync_interval_minutes || 30;
                return (
                  <div key={s.id} className={`rounded-lg border p-3 transition-colors ${enabled ? "border-emerald-300 bg-emerald-50/40" : "border-slate-200 bg-white"}`} data-testid={`presales-autosync-source-${s.id}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-800">{s.name}</p>
                        <p className="text-[11px] text-slate-500">Last sync: {fmtTime(s.last_synced)}</p>
                      </div>
                      <button
                        onClick={() => toggle(s, !enabled)}
                        type="button"
                        className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${enabled ? "bg-emerald-500" : "bg-slate-300"}`}
                        data-testid={`presales-autosync-toggle-${s.id}`}
                        aria-label="Toggle auto-sync"
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-6" : "translate-x-1"}`} />
                      </button>
                    </div>
                    {enabled && (
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-[11px] text-slate-500">Interval:</span>
                        <select
                          value={interval}
                          onChange={(e) => setInterval(s, parseInt(e.target.value, 10))}
                          className="h-7 rounded-md border border-slate-200 bg-white px-2 text-xs"
                          data-testid={`presales-autosync-interval-${s.id}`}
                        >
                          {INTERVAL_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2">
            <button onClick={load} className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800" data-testid="presales-autosync-refresh">
              <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
            <p className="text-[10px] text-slate-400">Min interval: 5 min</p>
          </div>
        </div>
      )}
    </div>
  );
};
