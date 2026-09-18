/**
 * HR Admin > EOD Report — Super Admin's read of every Physio's, Consultant's and branch's day.
 *
 * A period at a time — All, Today (the default), Yesterday, This Week, or a day or range
 * picked from the calendar icon — narrowed by branch and by a search. The five figures are
 * also the way into their lists: All lists every report filed, Consultant Report, Physio
 * Report and Branch Report narrow that to one desk, and Not Submitted lists each day
 * somebody clocked in without filing one. The server only answers Super Admin. See
 * backend/routers/v3_eod_reports.py.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertOctagon, ArrowRight, Building2, Check, ChevronDown, ClipboardList, HeartPulse, RefreshCw, Search, Stethoscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/components/ui/sonner";
import { DateFilterPopover } from "@/components/DateFilterPopover";
// The same figure tile HR's own Dashboard counts with.
import { KPI } from "@/components/ui/kpi-card";
import { roleLabel } from "@/lib/roles";
import { eodReports, getBranches } from "@/lib/api";

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/** The preset chips, each resolved to an ISO from/to — both empty for All. */
const PRESETS = [
  { key: "all", label: "All" },
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "week", label: "This Week" },
];
const presetRange = (key, today) => {
  if (key === "today") return { from: iso(today), to: iso(today) };
  if (key === "yesterday") { const y = addDays(today, -1); return { from: iso(y), to: iso(y) }; }
  if (key === "week") {
    // Monday to today.
    const back = (today.getDay() + 6) % 7;
    return { from: iso(addDays(today, -back)), to: iso(today) };
  }
  return { from: "", to: "" };
};

// The five figures, in the order they sit, and what clicking each one lists. Each counts
// reports (or missing ones), not the clients inside them -- the per-report count is on
// the report's own row.
const VIEWS = [
  { key: "reports", label: "All", icon: ClipboardList, title: "All reports" },
  { key: "consultant", label: "Consultant Report", icon: Stethoscope, title: "Consultant reports" },
  { key: "physio", label: "Physio Report", icon: HeartPulse, title: "Physio reports" },
  { key: "branch", label: "Branch Report", icon: Building2, title: "Branch reports" },
  { key: "pending", label: "Not Submitted", icon: AlertOctagon, title: "Clocked in, no report" },
];
// The three that are a kind of report rather than a view over all of them.
const KINDS = VIEWS.filter((v) => v.key !== "reports" && v.key !== "pending").map((v) => v.key);

const KIND_COPY = {
  consultant: { label: "Consultant", count: "Consultations", clients: "Consultations", badge: "bg-sky-50 text-sky-700" },
  physio: { label: "Physio", count: "Treatments", clients: "Clients treated", badge: "bg-emerald-50 text-emerald-700" },
  branch: { label: "Branch", count: "Clients", clients: "Clients the branch saw", badge: "bg-violet-50 text-violet-700" },
};
// A report written before its kind existed, or by a role since retired, still has to draw
// a row -- so every lookup falls back to Physio's wording rather than rendering undefined.
const copyFor = (kind) => KIND_COPY[kind] || KIND_COPY.physio;
const countLabel = (kind) => copyFor(kind).count;
const kindLabel = (kind) => copyFor(kind).label;
const TABLE_HEADERS = ["Name", "Short Report", "Staff Type", "Branch", "Date", "Submitted Time", "Action"];
// One line for the table: what they wrote about the day, else who they saw.
const shortReport = (r) => {
  const summary = String(r.summary || "").trim();
  if (summary) return summary;
  const names = (r.entries || []).map((e) => e.client_name).filter(Boolean);
  return names.length ? names.join(", ") : "—";
};
const prettyTime = (stamp) => {
  if (!stamp) return "";
  const d = new Date(stamp);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
};
const prettyDay = (day) => (day ? new Date(`${day}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "");

/**
 * The branch popover, drawn class for class like the branch button on the Business Leads
 * Dashboard's toolbar (ModeBranchScope in DashboardBoard.jsx) without its Online/Offline
 * half, which this list has no use for. Kept here rather than importing that one so this
 * tab does not pull the whole Dashboard board in with it.
 */
const BranchScope = ({ branches, value, onChange }) => {
  const [open, setOpen] = useState(false);
  const current = branches.find((b) => b.id === value);
  const pick = (id) => { onChange(id); setOpen(false); };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Filter by branch"
          className={`flex h-10 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold transition ${
            value ? "border-sky-300 bg-sky-50 text-sky-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
          }`}
          data-testid="eod-branch-button"
        >
          <Building2 className="h-3.5 w-3.5 shrink-0" />
          <span className="max-w-[130px] truncate">{current?.branch_name || "All Branches"}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-80 w-64 overflow-y-auto p-1" data-testid="eod-branch-menu">
        <button
          type="button"
          onClick={() => pick("")}
          className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm transition hover:bg-slate-50 ${!value ? "font-semibold text-sky-700" : "text-slate-700"}`}
          data-testid="eod-branch-all"
        >
          <Check className={`h-3.5 w-3.5 shrink-0 ${value ? "opacity-0" : ""}`} />
          <span className="truncate">All Branches</span>
        </button>
        {branches.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => pick(value === b.id ? "" : b.id)}
            className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm transition hover:bg-slate-50 ${value === b.id ? "font-semibold text-sky-700" : "text-slate-700"}`}
            data-testid={`eod-branch-${b.id}`}
          >
            <Check className={`h-3.5 w-3.5 shrink-0 ${value === b.id ? "" : "opacity-0"}`} />
            <span className="truncate">{b.branch_name}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
};

export const EodReportsPanel = () => {
  // Today, every time the tab is opened -- nothing remembers the last range picked.
  const [preset, setPreset] = useState("today");
  // Set by the calendar icon; overrides the chips while it is set.
  const [custom, setCustom] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("reports");
  const [q, setQ] = useState("");
  // A branch id, or "" for every branch. Narrowed here rather than on the server: the
  // period's rows are already on screen, and the four figures follow the same filter.
  const [branchId, setBranchId] = useState("");
  const [branches, setBranches] = useState([]);
  // The report shown in the popup.
  const [open, setOpen] = useState(null);
  // The moment the presets are measured from, moved on by Refresh -- so a tab left open
  // past midnight asks for the new Today rather than the day it was opened on.
  const [now, setNow] = useState(() => new Date());
  // Which request is the latest. A slower answer to an earlier click must not land on top
  // of the answer to the later one and put the wrong period's figures on screen.
  const latest = useRef(0);

  useEffect(() => {
    // Branches carry their name as `branch_name` (V3BranchOut), not `name`.
    getBranches()
      .then((rows) => setBranches((rows || []).filter((b) => b?.id && b?.branch_name).sort((a, b) => a.branch_name.localeCompare(b.branch_name))))
      .catch(() => toast.error("Could not load branches"));
  }, []);

  const range = useMemo(
    () => (custom ? { from: iso(custom.from), to: iso(custom.to || custom.from) } : presetRange(preset, now)),
    [custom, preset, now],
  );
  const singleDay = range.from && range.from === range.to;

  useEffect(() => {
    const id = latest.current + 1;
    latest.current = id;
    setLoading(true);
    eodReports(range)
      .then((next) => { if (latest.current === id) setData(next); })
      .catch((e) => { if (latest.current === id) toast.error(e?.response?.data?.detail || e?.message || "Could not load EOD reports"); })
      .finally(() => { if (latest.current === id) setLoading(false); });
  }, [range]);

  const refresh = () => setNow(new Date());

  const matches = useCallback((r) => {
    // Every branch the person covers, not only the one stamped on the row -- see
    // list_eod_reports. The stamp is the fallback for a server that has not sent the list.
    if (branchId && !(r.branch_ids || [r.branch_id]).includes(branchId)) return false;
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return [r.user_name, r.branch_name, ...(r.entries || []).map((e) => e.client_name)]
      .some((v) => String(v || "").toLowerCase().includes(needle));
  }, [q, branchId]);

  const allReports = useMemo(() => (data?.reports || []).filter(matches), [data, matches]);
  const pending = useMemo(() => (data?.pending || []).filter(matches), [data, matches]);
  const totals = useMemo(() => ({
    reports: allReports.length,
    ...Object.fromEntries(KINDS.map((k) => [k, allReports.filter((r) => r.kind === k).length])),
    pending: pending.length,
  }), [allReports, pending]);
  const reports = useMemo(
    () => (KINDS.includes(view) ? allReports.filter((r) => r.kind === view) : allReports),
    [allReports, view],
  );

  const pickPreset = (key) => { setCustom(null); setPreset(key); };
  const pickCard = (key) => setView((v) => (v === key && key !== "reports" ? "reports" : key));

  const listTitle = VIEWS.find((v) => v.key === view)?.title || "All reports";

  return (
    <div className="space-y-3" data-testid="eod-reports-panel">
      {/* The toolbar, in the same bordered bar and the same controls as the Business
          Leads Dashboard's: search, the one-tap ranges, then the calendar and Refresh
          pushed to the right. */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-1" data-testid="eod-toolbar">
        <div className="relative w-full min-w-0 sm:w-auto sm:min-w-[160px] sm:max-w-[240px] sm:flex-1">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
          <Input
            className="h-10 pl-9"
            placeholder="Search staff, branch or client..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            data-testid="eod-search"
          />
        </div>

        <div className="flex w-full shrink-0 items-center gap-1 sm:w-auto" data-testid="eod-presets">
          {PRESETS.map((p) => {
            const active = !custom && preset === p.key;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => pickPreset(p.key)}
                aria-pressed={active}
                className={`h-10 min-w-0 flex-1 truncate rounded-md px-2 text-xs font-medium transition sm:flex-none sm:px-3 sm:text-sm ${
                  active ? "bg-sky-600 text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
                data-testid={`eod-preset-${p.key}`}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        <BranchScope branches={branches} value={branchId} onChange={setBranchId} />

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {/* Lit with the picked day or range while one is set, with its own clear. */}
          <DateFilterPopover value={custom} onChange={setCustom} testid="eod-date-filter" centered iconOnly />
          <Button
            type="button"
            onClick={refresh}
            disabled={loading}
            title="Refresh"
            aria-label="Refresh"
            className="h-10 w-10 shrink-0 bg-slate-500 p-0 text-white hover:bg-slate-600"
            data-testid="eod-refresh"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <div className={`grid gap-3 transition-opacity sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 ${loading && data ? "opacity-60" : ""}`}>
        {VIEWS.map((v) => (
          <KPI
            key={v.key}
            icon={v.icon}
            label={v.label}
            value={totals[v.key]}
            active={view === v.key}
            onClick={() => pickCard(v.key)}
            testid={`eod-card-${v.key}`}
          />
        ))}
      </div>

      <div className={`rounded-lg border border-slate-200 bg-white p-3 transition-opacity ${loading && data ? "opacity-60" : ""}`}>
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500" data-testid="eod-list-title">
          <ClipboardList className="h-4 w-4 text-sky-600" />
          {listTitle} <span className="text-slate-400">· {view === "pending" ? pending.length : reports.length}</span>
        </p>

        {loading && !data ? (
          <p className="py-10 text-center text-sm text-slate-400">Loading…</p>
        ) : view === "pending" ? (
          pending.length === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">Everybody who clocked in filed a report.</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200" data-testid="eod-pending-list">
              {pending.map((p) => (
                <li key={`${p.user_id}-${p.date}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-800">{p.user_name}</span>
                    <span className="block truncate text-[11px] text-slate-500">{[roleLabel(p.role), p.branch_name].filter(Boolean).join(" · ")}</span>
                  </span>
                  {!singleDay && <span className="shrink-0 text-xs text-slate-500">{prettyDay(p.date)}</span>}
                  <span className="shrink-0 rounded bg-rose-50 px-2 py-0.5 text-xs font-bold text-rose-600">Not submitted</span>
                </li>
              ))}
            </ul>
          )
        ) : reports.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">No EOD reports for this period.</p>
        ) : (
          <>
            {/* Phones and tablets: one card per report. The table is min-w-[860px], so at
                640px it was a seven-column row read through a sideways swipe. */}
            <div className="mt-3 space-y-2 lg:hidden" data-testid="eod-report-list-mobile">
              {reports.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setOpen(r)}
                  className="block w-full rounded-lg border border-slate-200 bg-white p-3 text-left text-sm hover:bg-slate-50"
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="min-w-0 truncate font-semibold text-slate-800">{r.user_name}</span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" />
                  </span>
                  <span className="mt-1 block truncate text-xs text-slate-600">{shortReport(r)}</span>
                  <span className="mt-1 block text-[11px] text-slate-500">
                    {[kindLabel(r.kind), r.branch_name, prettyDay(r.date), prettyTime(r.updated_at)].filter(Boolean).join(" · ")}
                  </span>
                </button>
              ))}
            </div>

            <div className="mt-3 hidden overflow-hidden rounded-lg border border-slate-200 bg-white lg:block" data-testid="eod-report-list">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-sm">
                  <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wider text-slate-400">
                    <tr>
                      {TABLE_HEADERS.map((h) => (
                        <th key={h} className={`px-4 py-2.5 font-semibold ${h === "Action" ? "text-right" : ""}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {reports.map((r) => (
                      <tr key={r.id} onClick={() => setOpen(r)} className="cursor-pointer hover:bg-slate-50" data-testid={`eod-report-${r.id}`}>
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-800">{r.user_name || "—"}</p>
                          {r.role && <p className="truncate text-[11px] text-slate-400">{roleLabel(r.role)}</p>}
                        </td>
                        <td className="max-w-[280px] px-4 py-3 text-slate-600">
                          <p className="truncate">{shortReport(r)}</p>
                          <p className="text-[11px] text-slate-400">{countLabel(r.kind)}: {r.count}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`rounded px-2 py-0.5 text-xs font-bold ${copyFor(r.kind).badge}`}>
                            {kindLabel(r.kind)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{r.branch_name || "—"}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-600">{prettyDay(r.date) || "—"}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-600">{prettyTime(r.updated_at) || "—"}</td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setOpen(r); }}
                            title="View report"
                            aria-label="View report"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700"
                            data-testid={`eod-report-view-${r.id}`}
                          >
                            <ArrowRight className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>

      <Dialog open={!!open} onOpenChange={(v) => { if (!v) setOpen(null); }}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto" data-testid="eod-report-detail">
          {open && (
            <>
              <DialogHeader>
                <DialogTitle>{open.user_name}</DialogTitle>
                <DialogDescription>{[roleLabel(open.role), open.branch_name].filter(Boolean).join(" · ")}</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                {[
                  ["Staff Type", kindLabel(open.kind)],
                  ["Date", prettyDay(open.date)],
                  ["Submitted", prettyTime(open.updated_at)],
                  [countLabel(open.kind), String(open.count ?? 0)],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{k}</p>
                    <p className="font-medium text-slate-800">{v || "—"}</p>
                  </div>
                ))}
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{copyFor(open.kind).clients}</p>
                {open.entries?.length > 0 ? (
                  <ol className="mt-1.5 space-y-1.5">
                    {open.entries.map((e, i) => (
                      <li key={i} className="rounded-md border border-slate-100 px-2.5 py-1.5 text-sm text-slate-700">
                        <span className="font-medium">{i + 1}. {e.client_name}</span>
                        {e.notes && <span className="mt-0.5 block whitespace-pre-wrap pl-4 text-xs text-slate-500">{e.notes}</span>}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-1 text-xs text-slate-400">No clients listed.</p>
                )}
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">About the day</p>
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700">{open.summary || "—"}</p>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
