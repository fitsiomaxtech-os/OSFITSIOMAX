/**
 * HR Admin > EOD Report — Super Admin's read of every Physio's and Consultant's day.
 *
 * A period at a time — All, Today (the default), Yesterday, This Week, or a day or range
 * picked from the calendar icon — narrowed by branch and by a search. The four figures are
 * also the way into their lists: All lists every report filed, Consultant Report and
 * Physio Report narrow that to one desk, and Not Submitted lists each day somebody clocked
 * in without filing one. The server only answers Super Admin. See backend/routers/v3_eod_reports.py.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertOctagon, Building2, Check, ChevronDown, ChevronUp, ClipboardList, HeartPulse, RefreshCw, Search, Stethoscope } from "lucide-react";
import { Button } from "@/components/ui/button";
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

// The four figures, in the order they sit, and what clicking each one lists. Each counts
// reports (or missing ones), not the clients inside them -- the per-report count is on
// the report's own row.
const VIEWS = [
  { key: "reports", label: "All", icon: ClipboardList, title: "All reports" },
  { key: "consultant", label: "Consultant Report", icon: Stethoscope, title: "Consultant reports" },
  { key: "physio", label: "Physio Report", icon: HeartPulse, title: "Physio reports" },
  { key: "pending", label: "Not Submitted", icon: AlertOctagon, title: "Clocked in, no report" },
];

const countLabel = (kind) => (kind === "consultant" ? "Consultations" : "Treatments");
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
          <span className="max-w-[130px] truncate">{current?.name || "All Branches"}</span>
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
            <span className="truncate">{b.name}</span>
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
  const [open, setOpen] = useState(null);
  // The moment the presets are measured from, moved on by Refresh -- so a tab left open
  // past midnight asks for the new Today rather than the day it was opened on.
  const [now, setNow] = useState(() => new Date());
  // Which request is the latest. A slower answer to an earlier click must not land on top
  // of the answer to the later one and put the wrong period's figures on screen.
  const latest = useRef(0);

  useEffect(() => {
    getBranches().then((rows) => setBranches((rows || []).filter((b) => b?.id && b?.name))).catch(() => {});
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
    consultant: allReports.filter((r) => r.kind === "consultant").length,
    physio: allReports.filter((r) => r.kind === "physio").length,
    pending: pending.length,
  }), [allReports, pending]);
  const reports = useMemo(
    () => (view === "physio" || view === "consultant" ? allReports.filter((r) => r.kind === view) : allReports),
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

        <div className="ml-auto flex items-center gap-1.5">
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

      <div className={`grid gap-3 transition-opacity sm:grid-cols-2 lg:grid-cols-4 ${loading && data ? "opacity-60" : ""}`}>
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
          <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200" data-testid="eod-report-list">
            {reports.map((r) => (
              <li key={r.id} data-testid={`eod-report-${r.id}`}>
                <button type="button" onClick={() => setOpen(open === r.id ? null : r.id)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left hover:bg-slate-50">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-800">{r.user_name}</span>
                    <span className="block truncate text-[11px] text-slate-500">
                      {[roleLabel(r.role), r.branch_name, !singleDay && prettyDay(r.date), prettyTime(r.updated_at) && `Submitted ${prettyTime(r.updated_at)}`].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-bold ${r.kind === "consultant" ? "bg-sky-50 text-sky-700" : "bg-emerald-50 text-emerald-700"}`}>
                    {countLabel(r.kind)}: {r.count}
                  </span>
                  {open === r.id ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                </button>
                {open === r.id && (
                  <div className="border-t border-slate-100 bg-slate-50/60 px-3 py-3">
                    {r.entries?.length > 0 ? (
                      <ol className="space-y-1.5">
                        {r.entries.map((e, i) => (
                          <li key={i} className="text-sm text-slate-700">
                            <span className="font-medium">{i + 1}. {e.client_name}</span>
                            {e.notes && <span className="block pl-4 text-xs text-slate-500">{e.notes}</span>}
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="text-xs text-slate-400">No clients listed.</p>
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
      </div>
    </div>
  );
};
