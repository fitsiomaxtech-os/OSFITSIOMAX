import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw, Search, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
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

const PERIODS = [
  { key: "week", label: "Weekly" },
  { key: "month", label: "Monthly" },
  { key: "quarter", label: "Quarterly" },
];

const toIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** A day inside the period before or after the one holding `iso`. */
const shiftAnchor = (iso, period, step) => {
  const d = new Date(`${iso}T00:00:00`);
  if (period === "week") d.setDate(d.getDate() + 7 * step);
  else {
    d.setDate(1);
    d.setMonth(d.getMonth() + (period === "quarter" ? 3 : 1) * step);
  }
  return toIso(d);
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
  const [anchor, setAnchor] = useState(() => toIso(new Date()));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

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
    const all = data?.rows || [];
    if (!q) return all;
    return all.filter((r) => [r.full_name, r.employee_code, r.role_label, r.designation, r.branch_name]
      .some((v) => String(v || "").toLowerCase().includes(q)));
  }, [data, search]);

  // Nothing past the period holding today: its figures would all be blank.
  const atLatest = data ? data.end >= toIso(new Date()) : true;

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
          <div className="flex overflow-hidden rounded-md border border-slate-200 bg-white" role="group" aria-label="Period">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setPeriod(p.key)}
                aria-pressed={period === p.key}
                className={`px-3 py-2 text-xs font-semibold transition ${period === p.key ? "bg-sky-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}
                data-testid={`hr-perf-period-${p.key}`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="flex h-10 items-center rounded-md border border-slate-200 bg-white">
            <button type="button" onClick={() => setAnchor(shiftAnchor(anchor, period, -1))} className="flex h-full w-8 items-center justify-center text-slate-500 hover:text-sky-600" aria-label="Previous period" data-testid="hr-perf-prev">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[9.5rem] px-1 text-center text-xs font-semibold text-slate-700" data-testid="hr-perf-label">{data?.label || "…"}</span>
            <button type="button" onClick={() => setAnchor(shiftAnchor(anchor, period, 1))} disabled={atLatest} className="flex h-full w-8 items-center justify-center text-slate-500 hover:text-sky-600 disabled:opacity-30" aria-label="Next period" data-testid="hr-perf-next">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <Button
            onClick={load}
            disabled={loading}
            title="Refresh"
            aria-label="Refresh"
            className="h-10 w-10 shrink-0 bg-orange-500 p-0 text-white hover:bg-orange-600"
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
