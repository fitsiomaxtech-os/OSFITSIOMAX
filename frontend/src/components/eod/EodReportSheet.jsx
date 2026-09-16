/**
 * EOD Report — the popup a Physio or Consultant gets when they clock out.
 *
 * Today's clients come pre-filled from their own calendar (treatment and rehab days for a
 * Physio; consultations and reviews for a Consultant). They tick who they actually saw,
 * add a note on each if they want, add anybody the calendar missed, and say something
 * about the day. The count is the clients ticked.
 *
 * Skip closes it without filing anything. It can be reopened from the clock's "Your day"
 * sheet for as long as the day lasts. See backend/routers/v3_eod_reports.py.
 */

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ClipboardList, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { eodSubmit } from "@/lib/api";

const KIND_COPY = {
  physio: { title: "End of day report", noun: "Treatments", lead: "Clients you treated today" },
  consultant: { title: "End of day report", noun: "Consultations", lead: "Consultations you took today" },
};

/** Rows for the form: the report already filed today if there is one, else the calendar. */
const initialRows = (info) => {
  const filed = info?.report?.entries;
  const suggestions = info?.suggestions || [];
  if (filed && filed.length) {
    const byKey = new Map(filed.map((e) => [e.lead_id || e.client_name.toLowerCase(), e]));
    const rows = suggestions.map((s) => {
      const hit = byKey.get(s.lead_id || s.client_name.toLowerCase());
      if (hit) byKey.delete(s.lead_id || s.client_name.toLowerCase());
      return { ...s, checked: !!hit, notes: hit?.notes || "" };
    });
    for (const e of byKey.values()) rows.push({ ...e, manual: true, checked: true });
    return rows;
  }
  return suggestions.map((s) => ({ ...s, checked: !!s.done, notes: "" }));
};

export const EodReportSheet = ({ info, onClose, onSaved }) => {
  const copy = KIND_COPY[info?.kind] || KIND_COPY.physio;
  const [rows, setRows] = useState(() => initialRows(info));
  const [summary, setSummary] = useState(info?.report?.summary || "");
  const [busy, setBusy] = useState(false);

  useEffect(() => { setRows(initialRows(info)); setSummary(info?.report?.summary || ""); }, [info]);

  const count = useMemo(() => rows.filter((r) => r.checked && r.client_name.trim()).length, [rows]);
  const update = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const submit = async () => {
    const entries = rows
      .filter((r) => r.checked && r.client_name.trim())
      .map((r) => ({ client_name: r.client_name.trim(), lead_id: r.lead_id || "", notes: r.notes || "", source: r.source || "manual" }));
    if (!entries.length && !summary.trim()) {
      toast.error("Tick at least one client or write a note about the day");
      return;
    }
    setBusy(true);
    try {
      const saved = await eodSubmit({ entries, summary });
      toast.success("EOD report submitted");
      onSaved?.(saved);
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.detail || e?.message || "Could not submit the report");
    } finally { setBusy(false); }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center" data-testid="eod-sheet">
      <div className="w-full max-w-xl rounded-xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex items-start gap-2">
            <ClipboardList className="mt-0.5 h-5 w-5 text-sky-600" />
            <div>
              <h3 className="text-base font-semibold text-slate-800">{copy.title}</h3>
              <p className="mt-0.5 text-xs text-slate-500">{info?.date} · {info?.report ? "Already submitted — saving replaces it." : "Tell us how today went."}</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100" aria-label="Close" data-testid="eod-sheet-close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[65vh] overflow-y-auto px-5 py-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{copy.lead}</p>
            <span className="rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-bold text-sky-700" data-testid="eod-count">{copy.noun}: {count}</span>
          </div>

          {rows.length === 0 && (
            <p className="mt-2 rounded-lg border border-dashed border-slate-200 py-4 text-center text-xs text-slate-400">
              Nothing on your calendar today. Add clients below if you saw any.
            </p>
          )}

          <ul className="mt-2 space-y-2" data-testid="eod-rows">
            {rows.map((r, i) => (
              <li key={i} className={`rounded-lg border px-3 py-2 ${r.checked ? "border-sky-200 bg-sky-50/40" : "border-slate-200"}`} data-testid={`eod-row-${i}`}>
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={!!r.checked} onChange={(e) => update(i, { checked: e.target.checked })} className="h-4 w-4 accent-sky-600" data-testid={`eod-row-check-${i}`} />
                  {r.manual ? (
                    <input
                      value={r.client_name}
                      onChange={(e) => update(i, { client_name: e.target.value })}
                      maxLength={200}
                      placeholder="Client name"
                      className="h-8 min-w-0 flex-1 rounded-md border border-slate-200 px-2 text-sm outline-none focus:border-sky-400"
                      data-testid={`eod-row-name-${i}`}
                    />
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700">{r.client_name}</span>
                  )}
                  {!r.manual && (
                    <span className="shrink-0 text-[11px] text-slate-400">{[r.label, r.time, r.status].filter(Boolean).join(" · ")}</span>
                  )}
                  {r.manual && (
                    <button type="button" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Remove" data-testid={`eod-row-remove-${i}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {r.checked && (
                  <input
                    value={r.notes || ""}
                    onChange={(e) => update(i, { notes: e.target.value })}
                    maxLength={1000}
                    placeholder={info?.kind === "consultant" ? "About this consultation (optional)" : "Treatment given / progress (optional)"}
                    className="mt-2 h-8 w-full rounded-md border border-slate-200 px-2 text-xs outline-none focus:border-sky-400"
                    data-testid={`eod-row-notes-${i}`}
                  />
                )}
              </li>
            ))}
          </ul>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setRows((rs) => [...rs, { client_name: "", lead_id: "", notes: "", manual: true, checked: true, source: "manual" }])}
            className="mt-2"
            data-testid="eod-add-client"
          >
            <Plus className="h-4 w-4" />Add client
          </Button>

          <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">About the day</p>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            maxLength={3000}
            rows={4}
            placeholder="How did the day go? Anything management should know?"
            className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-300"
            data-testid="eod-summary"
          />
        </div>

        <div className="flex gap-2 border-t border-slate-100 px-5 py-3">
          <Button variant="outline" onClick={onClose} className="flex-1" data-testid="eod-skip">Skip</Button>
          <Button onClick={submit} disabled={busy} className="flex-1 bg-sky-600 text-white hover:bg-sky-700" data-testid="eod-submit">
            {busy ? "Submitting…" : "Submit Report"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
