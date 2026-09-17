import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, RefreshCw, Search, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/components/ui/sonner";
import { hrPerformance } from "@/lib/api";

/**
 * HR Admin > Staff > Performance. Super Admin only.
 *
 * One row per person on the books for a week, month or quarter, every figure read off
 * records the OS already keeps -- see backend/routers/v3_hr_performance.py for what each
 * column counts and how the grade is weighted. The list is laid out like the Human
 * Resource Master View's candidate list, so the two HR lists read the same way.
 */

const toIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const thisMonth = () => toIso(new Date()).slice(0, 7);
const lastMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return toIso(d).slice(0, 7); };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const prettyMonth = (ym) => new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

// Weekly and Quarterly are the ones holding today; the two month pills and the month picker
// all land on period "month" with a month beside it.
const PERIOD_PILLS = [
  { key: "week", label: "Weekly" },
  { key: "this_month", label: "This Month" },
  { key: "last_month", label: "Last Month" },
  { key: "quarter", label: "Quarterly" },
];

const ROLE_FILTERS = [
  { key: "", label: "All Roles" },
  { key: "physio", label: "Physio" },
  { key: "consultant", label: "Consultant" },
  { key: "branch_admin", label: "Branch Admin" },
];

/** Picks a month, and only a month: a year header and twelve buttons. Future months are off. */
const MonthPicker = ({ value, label, active, onChange }) => {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(Number((value || thisMonth()).slice(0, 4)));
  const now = thisMonth();
  useEffect(() => { if (open) setYear(Number((value || now).slice(0, 4))); }, [open, value, now]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Pick a month"
          className={`flex h-10 items-center gap-2 rounded-md border px-3 text-xs font-semibold transition ${
            active ? "border-sky-300 bg-sky-50 text-sky-700" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
          }`}
          data-testid="hr-perf-month"
        >
          <CalendarDays className="h-4 w-4 shrink-0" />
          <span className="whitespace-nowrap">{label}</span>
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3" data-testid="hr-perf-month-panel">
        <div className="mb-2 flex items-center justify-between">
          <button type="button" onClick={() => setYear(year - 1)} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Previous year">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-bold text-slate-800">{year}</span>
          <button type="button" onClick={() => setYear(year + 1)} disabled={year >= Number(now.slice(0, 4))} className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30" aria-label="Next year">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {MONTHS.map((m, i) => {
            const ym = `${year}-${String(i + 1).padStart(2, "0")}`;
            const selected = active && ym === value;
            return (
              <button
                key={m}
                type="button"
                disabled={ym > now}
                onClick={() => { onChange(ym); setOpen(false); }}
                className={`rounded-md py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-30 ${
                  selected ? "bg-sky-600 text-white" : "text-slate-600 hover:bg-sky-50 hover:text-sky-700"
                }`}
                data-testid={`hr-perf-month-${ym}`}
              >
                {m}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
};

/** Physio / Consultant / Branch Admin, as the same popover the rest of HR filters with. */
const RoleFilter = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const current = ROLE_FILTERS.find((r) => r.key === value) || ROLE_FILTERS[0];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Filter by role"
          className={`flex h-10 w-40 items-center justify-between gap-2 rounded-md border px-3 text-xs font-semibold transition ${
            value ? "border-sky-300 bg-sky-50 text-sky-700" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
          }`}
          data-testid="hr-perf-role"
        >
          <span className="truncate">{current.label}</span>
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-44 p-1" data-testid="hr-perf-role-panel">
        {ROLE_FILTERS.map((r) => (
          <button
            key={r.key || "all"}
            type="button"
            onClick={() => { onChange(r.key); setOpen(false); }}
            className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-1.5 text-left text-sm transition ${
              r.key === value ? "bg-sky-600 font-semibold text-white" : "text-slate-700 hover:bg-sky-50 hover:text-sky-800"
            }`}
            data-testid={`hr-perf-role-${r.key || "all"}`}
          >
            {r.label}
            {r.key === value && <Check className="h-3.5 w-3.5 shrink-0" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
};

const GRADE_COLORS = { A: "#16a34a", B: "#d97706", C: "#dc2626" };

const GradePill = ({ grade, score }) => {
  if (!grade) return <span className="text-slate-300">—</span>;
  const color = GRADE_COLORS[grade];
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-[5px] border px-2 py-0.5 text-[10px] font-bold"
      style={{ color, borderColor: `${color}55`, backgroundColor: `${color}14` }}
      title={`Score ${score} of 100`}
    >
      {grade} <span className="font-semibold opacity-70">· {score}</span>
    </span>
  );
};

const attendanceColor = (pct) => (pct === null ? "text-slate-300" : pct >= 90 ? "text-emerald-600" : pct >= 75 ? "text-amber-600" : "text-red-500");

const Attendance = ({ r }) => (
  <>
    <span className={`font-semibold ${attendanceColor(r.attendance)}`}>{r.attendance === null ? "—" : `${Math.round(r.attendance)}%`}</span>
    <span className="block text-[11px] text-slate-400">
      {r.late_days ? `${r.late_days} late` : "On time"}{r.absent_days ? ` · ${r.absent_days} absent` : ""}
    </span>
  </>
);

const Work = ({ r }) => (r.work === null ? <span className="text-slate-300">—</span> : (
  <>
    <span className="font-semibold text-slate-700">{r.work}</span>
    <span className="ml-1 text-[11px] text-slate-400">{r.work_label}</span>
    {r.work_sub ? <span className="block text-[11px] text-slate-400">{r.work_sub}</span> : null}
  </>
));

const Rating = ({ r }) => (r.rating === null ? <span className="text-slate-300">—</span> : (
  <>
    <span className="inline-flex items-center gap-1 font-semibold text-slate-700">
      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />{r.rating.toFixed(1)}
    </span>
    <span className="block text-[11px] text-slate-400">{r.rating_count} review{r.rating_count === 1 ? "" : "s"}</span>
  </>
));

export const PerformancePanel = () => {
  const [period, setPeriod] = useState("month");
  const [month, setMonth] = useState(thisMonth);
  const [role, setRole] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  const anchor = period === "month" ? `${month}-01` : toIso(new Date());
  const pill = period !== "month" ? period : month === thisMonth() ? "this_month" : month === lastMonth() ? "last_month" : "";
  const pickPill = (key) => {
    if (key === "this_month" || key === "last_month") {
      setPeriod("month");
      setMonth(key === "this_month" ? thisMonth() : lastMonth());
    } else {
      setPeriod(key);
    }
  };

  const load = useCallback(() => {
    setLoading(true);
    hrPerformance(period, anchor)
      .then(setData)
      .catch((e) => toast.error(e?.response?.data?.detail || "Failed to load performance"))
      .finally(() => setLoading(false));
  }, [period, anchor]);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = (data?.rows || []).filter((r) => !role || r.group === role);
    if (!q) return all;
    return all.filter((r) => [r.full_name, r.employee_code, r.role_label, r.designation, r.branch_name]
      .some((v) => String(v || "").toLowerCase().includes(q)));
  }, [data, search, role]);

  return (
    <div className="flex flex-col gap-4" data-testid="hr-performance-tab">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="flex flex-1 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, code, role or branch..."
            className="min-w-0 flex-1 border-0 p-0 text-sm outline-none placeholder:text-slate-400"
            data-testid="hr-perf-search"
          />
          {search && (
            <button type="button" onClick={() => setSearch("")} className="shrink-0 text-slate-400 hover:text-slate-600" aria-label="Clear search">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2 lg:justify-start">
          <RoleFilter value={role} onChange={setRole} />

          <div className="flex h-10 overflow-hidden rounded-md border border-slate-200 bg-white" role="group" aria-label="Period">
            {PERIOD_PILLS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => pickPill(p.key)}
                aria-pressed={pill === p.key}
                className={`whitespace-nowrap px-3 text-xs font-semibold transition ${pill === p.key ? "bg-sky-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}
                data-testid={`hr-perf-period-${p.key}`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Any month, and only a month. Weekly and Quarterly show their span here instead. */}
          <MonthPicker
            value={month}
            active={period === "month"}
            label={period === "month" ? prettyMonth(month) : (data?.label || "…")}
            onChange={(ym) => { setPeriod("month"); setMonth(ym); }}
          />

          <Button
            onClick={load}
            disabled={loading}
            title="Refresh"
            aria-label="Refresh"
            className="h-10 w-10 shrink-0 border border-slate-200 bg-slate-100 p-0 text-slate-700 shadow-none hover:bg-slate-200"
            data-testid="hr-perf-refresh"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {!rows.length ? (
        <p className="rounded-xl border border-dashed border-slate-200 px-3 py-14 text-center text-sm text-slate-400" data-testid="hr-perf-empty">
          {loading || !data ? "Loading performance..." : "No staff to show."}
        </p>
      ) : (
        <>
          <div className="space-y-2 sm:hidden" data-testid="hr-perf-mobile">
            {rows.map((r) => (
              <div key={r.employee_id} className="rounded-xl border border-slate-200 bg-white p-3" data-testid={`hr-perf-card-${r.employee_id}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-800">{r.full_name}</p>
                    <p className="truncate text-xs text-slate-500">{r.role_label}{r.branch_name ? ` · ${r.branch_name}` : ""}</p>
                  </div>
                  <GradePill grade={r.grade} score={r.score} />
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <div><p className="text-[10px] uppercase tracking-wider text-slate-400">Attendance</p><Attendance r={r} /></div>
                  <div><p className="text-[10px] uppercase tracking-wider text-slate-400">Work</p><Work r={r} /></div>
                  <div><p className="text-[10px] uppercase tracking-wider text-slate-400">Rating</p><Rating r={r} /></div>
                </div>
              </div>
            ))}
          </div>

          <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white sm:block" data-testid="hr-perf-desktop">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Employee</th>
                    <th className="px-4 py-2.5 font-semibold">Role</th>
                    <th className="px-4 py-2.5 font-semibold">Attendance</th>
                    <th className="px-4 py-2.5 font-semibold">Work Done</th>
                    <th className="px-4 py-2.5 font-semibold">Rating</th>
                    <th className="px-4 py-2.5 font-semibold">Leave</th>
                    <th className="px-4 py-2.5 font-semibold">Grade</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => (
                    <tr key={r.employee_id} className="hover:bg-slate-50" data-testid={`hr-perf-row-${r.employee_id}`}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-800">{r.full_name}</p>
                        <p className="text-[11px] text-slate-400">{r.employee_code || "—"}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {r.role_label}
                        {r.branch_name ? <span className="block text-[11px] text-slate-400">{r.branch_name}</span> : null}
                      </td>
                      <td className="px-4 py-3"><Attendance r={r} /></td>
                      <td className="px-4 py-3"><Work r={r} /></td>
                      <td className="px-4 py-3"><Rating r={r} /></td>
                      <td className="px-4 py-3 text-slate-600">{r.leave_days ? `${r.leave_days}d` : "—"}</td>
                      <td className="px-4 py-3"><GradePill grade={r.grade} score={r.score} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-[11px] text-slate-400">
            Grade = 30% attendance · 50% work done (against the best in the same role) · 20% client rating. A = 80+, B = 60+, C below.
          </p>
        </>
      )}
    </div>
  );
};
