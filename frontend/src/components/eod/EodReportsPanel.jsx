/**
 * HR Admin > EOD Report — Super Admin's read of every Physio's and Consultant's day.
 *
 * One clinic day at a time: the reports filed on it (treatment or consultation count,
 * the clients, a note on each, and what they said about the day), and below them the
 * Physios and Consultants who clocked in that day without filing one. The server only
 * answers Super Admin. See backend/routers/v3_eod_reports.py.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, ClipboardList, Download, RefreshCw, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { MilkDateInput } from "@/components/ui/milk-calendar";
import { downloadCsv } from "@/lib/printable";
import { roleLabel } from "@/lib/roles";
import { eodReports } from "@/lib/api";

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const KIND_FILTERS = [
  { key: "", label: "All" },
  { key: "physio", label: "Physio" },
  { key: "consultant", label: "Consultant" },
];

const countLabel = (kind) => (kind === "consultant" ? "Consultations" : "Treatments");
const prettyTime = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
};

const Figure = ({ label, value, tone = "text-slate-800" }) => (
  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
    <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</span>
    <span className={`mt-0.5 block text-xl font-extrabold ${tone}`}>{value}</span>
  </div>
);

export const EodReportsPanel = () => {
  const [date, setDate] = useState(todayIso);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await eodReports(date)); }
    catch (e) { toast.error(e?.response?.data?.detail || e?.message || "Could not load EOD reports"); }
    finally { setLoading(false); }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const match = useCallback((r) => {
    if (kind && r.kind !== kind) return false;
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return [r.user_name, r.branch_name, ...(r.entries || []).map((e) => e.client_name)]
      .some((v) => String(v || "").toLowerCase().includes(needle));
  }, [kind, q]);

  const reports = useMemo(() => (data?.reports || []).filter(match), [data, match]);
  const pending = useMemo(() => (data?.pending || []).filter(match), [data, match]);
  const totals = useMemo(() => ({
    treatments: reports.filter((r) => r.kind === "physio").reduce((n, r) => n + (r.count || 0), 0),
    consultations: reports.filter((r) => r.kind === "consultant").reduce((n, r) => n + (r.count || 0), 0),
  }), [reports]);

  const exportCsv = () => {
    const rows = [["Date", "Name", "Role", "Branch", "Type", "Count", "Client", "Client note", "About the day", "Submitted"]];
    for (const r of reports) {
      const entries = r.entries?.length ? r.entries : [{ client_name: "", notes: "" }];
      for (const e of entries) {
        rows.push([r.date, r.user_name, roleLabel(r.role), r.branch_name, countLabel(r.kind), r.count, e.client_name, e.notes, r.summary, prettyTime(r.updated_at)]);
      }
    }
    downloadCsv(rows, `eod-reports-${date}.csv`);
  };

  return (
    <Card data-testid="eod-reports-panel">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardList className="h-5 w-5 text-sky-600" />EOD Report
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-40"><MilkDateInput value={date} max={todayIso()} accent="sky" onChange={(e) => e.target.value && setDate(e.target.value)} data-testid="eod-date" /></div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} data-testid="eod-refresh"><RefreshCw className="h-4 w-4" /></Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!reports.length} data-testid="eod-export"><Download className="h-4 w-4" />CSV</Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Figure label="Reports" value={reports.length} />
          <Figure label="Not submitted" value={pending.length} tone="text-rose-600" />
          <Figure label="Treatments" value={totals.treatments} tone="text-emerald-600" />
          <Figure label="Consultations" value={totals.consultations} tone="text-sky-600" />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg bg-slate-100 p-0.5">
            {KIND_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setKind(f.key)}
                className={`rounded-md px-3 py-1 text-xs font-semibold ${kind === f.key ? "bg-white text-slate-800 shadow-sm" : "text-slate-500"}`}
                data-testid={`eod-kind-${f.key || "all"}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search staff, branch or client" className="pl-8" data-testid="eod-search" />
          </div>
        </div>

        {loading && !data ? (
          <p className="py-10 text-center text-sm text-slate-400">Loading…</p>
        ) : reports.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">No EOD reports for this day.</p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200" data-testid="eod-report-list">
            {reports.map((r) => (
              <li key={r.id} data-testid={`eod-report-${r.id}`}>
                <button type="button" onClick={() => setOpen(open === r.id ? null : r.id)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left hover:bg-slate-50">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-800">{r.user_name}</span>
                    <span className="block truncate text-[11px] text-slate-500">{[roleLabel(r.role), r.branch_name, prettyTime(r.updated_at) && `Submitted ${prettyTime(r.updated_at)}`].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-bold ${r.kind === "consultant" ? "bg-sky-50 text-sky-700" : "bg-emerald-50 text-emerald-700"}`}>
                    {countLabel(r.kind)}: {r.count}
                  </span>
                  {open === r.id ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                </button>
                {open === r.id && (
                  <div className="border-t border-slate-100 bg-slate-50/60 px-3 py-3">
                    {r.entries?.length > 0 && (
                      <ol className="space-y-1.5">
                        {r.entries.map((e, i) => (
                          <li key={i} className="text-sm text-slate-700">
                            <span className="font-medium">{i + 1}. {e.client_name}</span>
                            {e.notes && <span className="block pl-4 text-xs text-slate-500">{e.notes}</span>}
                          </li>
                        ))}
                      </ol>
                    )}
                    {r.summary && (
                      <div className="mt-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">About the day</p>
                        <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700">{r.summary}</p>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {pending.length > 0 && (
          <div className="mt-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Clocked in, no report</p>
            <ul className="mt-1 flex flex-wrap gap-2" data-testid="eod-pending-list">
              {pending.map((p) => (
                <li key={p.user_id} className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs text-rose-700">
                  {p.user_name} <span className="text-rose-400">· {[roleLabel(p.role), p.branch_name].filter(Boolean).join(" · ")}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
