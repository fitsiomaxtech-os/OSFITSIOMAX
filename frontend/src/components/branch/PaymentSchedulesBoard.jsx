import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, Printer, ChevronDown, CalendarRange, CheckCircle2, Clock, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { RecordCards } from "@/components/branch/RecordCards";

const fmt = (n) => `Rs.${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const todayIso = () => new Date().toISOString().slice(0, 10);

const STATUS_META = {
  paid: { label: "Paid", classes: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  overdue: { label: "Overdue", classes: "bg-rose-100 text-rose-700 border-rose-200" },
  due_today: { label: "Due Today", classes: "bg-amber-100 text-amber-700 border-amber-200" },
  upcoming: { label: "Upcoming", classes: "bg-sky-100 text-sky-700 border-sky-200" },
};

const StatusBadge = ({ status }) => {
  const meta = STATUS_META[status] || STATUS_META.upcoming;
  return (
    <span className={`inline-flex items-center rounded-[5px] border px-2 py-0.5 text-[10px] font-semibold ${meta.classes}`}>
      {meta.label}
    </span>
  );
};

const ProgressBar = ({ paid, total }) => {
  const pct = total > 0 ? Math.round((paid / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-slate-500">{paid}/{total}</span>
    </div>
  );
};

const SummaryCard = ({ label, ...rest }) => (
  <StatTile label={label} testid={`schedules-summary-${label.toLowerCase().replace(/\s+/g, "-")}`} {...rest} />
);

const DUE_PRESETS = [
  { key: "all", label: "All Due Dates", classes: "border-slate-200 bg-white text-slate-700" },
  { key: "overdue", label: "Overdue", classes: STATUS_META.overdue.classes },
  { key: "today", label: "Due Today", classes: STATUS_META.due_today.classes },
  { key: "week", label: "Next 7 Days", classes: STATUS_META.upcoming.classes },
];

// A fixed color per branch would need a stable name->color map that survives
// the branch list changing; cycling a palette by list position is simpler and
// still gives each branch its own distinct color in the open dropdown.
const BRANCH_COLOR_PALETTE = [
  "border-purple-300 bg-purple-50 text-purple-700",
  "border-indigo-300 bg-indigo-50 text-indigo-700",
  "border-emerald-300 bg-emerald-50 text-emerald-700",
  "border-amber-300 bg-amber-50 text-amber-700",
  "border-cyan-300 bg-cyan-50 text-cyan-700",
  "border-pink-300 bg-pink-50 text-pink-700",
  "border-orange-300 bg-orange-50 text-orange-700",
  "border-sky-300 bg-sky-50 text-sky-700",
];

// Native <select> can't reliably color individual dropdown-list items across
// browsers — only the closed box. This renders each option as its own colored,
// rounded row in a custom open list instead.
const ColorFilterDropdown = ({ value, options, onChange, testId }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const current = options.find((o) => o.value === value) || options[0];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex h-9 items-center justify-between gap-2 rounded-md border px-3 text-sm font-semibold ${current?.classes || "border-slate-200 bg-white text-slate-700"}`}
        data-testid={testId}
      >
        <span className="truncate">{current?.label}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-1 max-h-64 min-w-[170px] space-y-1 overflow-y-auto rounded-md border border-slate-200 bg-white p-1.5 shadow-lg" data-testid={`${testId}-list`}>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => { onChange(o.value); setOpen(false); }}
              className={`block w-full whitespace-nowrap rounded-md border px-3 py-1.5 text-left text-xs font-semibold ${o.classes}`}
              data-testid={`${testId}-option-${o.value}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export const PaymentSchedulesBoard = ({ rows, onView }) => {
  const [search, setSearch] = useState("");
  const [branch, setBranch] = useState("all");
  const [status, setStatus] = useState("all");
  const [dueFilter, setDueFilter] = useState("all");

  const today = todayIso();
  const weekAhead = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  }, []);

  const branches = useMemo(() => [...new Set(rows.map((r) => r.branch_name).filter(Boolean))], [rows]);

  const filtered = useMemo(() => rows.filter((r) => {
    if (search && !(r.client_name || "").toLowerCase().includes(search.toLowerCase())) return false;
    if (branch !== "all" && r.branch_name !== branch) return false;
    if (status !== "all" && r.status !== status) return false;
    if (dueFilter === "overdue" && r.status !== "overdue") return false;
    if (dueFilter === "today" && r.due_date !== today) return false;
    if (dueFilter === "week" && !(r.due_date >= today && r.due_date <= weekAhead)) return false;
    return true;
  }), [rows, search, branch, status, dueFilter, today, weekAhead]);

  // The figure is a count of installments; the line under it is what they come to in
  // money, which is the part an accountant is actually chasing.
  const totals = useMemo(() => {
    const bucket = (pred) => {
      const hits = rows.filter(pred);
      return { count: hits.length, amount: hits.reduce((s, r) => s + (r.amount || 0), 0) };
    };
    return {
      all: bucket(() => true),
      paid: bucket((r) => r.status === "paid"),
      pending: bucket((r) => r.status === "upcoming" || r.status === "due_today"),
      overdue: bucket((r) => r.status === "overdue"),
    };
  }, [rows]);

  return (
    <div className="space-y-4" data-testid="payment-schedules-board">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard label="Total Scheduled" value={totals.all.count} sub={fmt(totals.all.amount)} icon={CalendarRange} color="#7c3aed" />
        <SummaryCard label="Paid Installments" value={totals.paid.count} sub={fmt(totals.paid.amount)} icon={CheckCircle2} color="#059669" />
        <SummaryCard label="Pending Installments" value={totals.pending.count} sub={fmt(totals.pending.amount)} icon={Clock} color="#0284c7" />
        <SummaryCard label="Overdue Installments" value={totals.overdue.count} sub={fmt(totals.overdue.amount)} icon={AlertTriangle} color="#e11d48" />
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search client..."
            className="h-9 min-w-[200px] flex-1 rounded-md border border-slate-200 px-3 text-sm"
            data-testid="schedules-search"
          />
          <ColorFilterDropdown
            value={branch}
            options={[
              { value: "all", label: "All Branches", classes: "border-slate-200 bg-white text-slate-700" },
              ...branches.map((b, i) => ({ value: b, label: b, classes: BRANCH_COLOR_PALETTE[i % BRANCH_COLOR_PALETTE.length] })),
            ]}
            onChange={setBranch}
            testId="schedules-branch-filter"
          />
          <ColorFilterDropdown
            value={status}
            options={[
              { value: "all", label: "All Statuses", classes: "border-slate-200 bg-white text-slate-700" },
              { value: "paid", label: "Paid", classes: STATUS_META.paid.classes },
              { value: "upcoming", label: "Upcoming", classes: STATUS_META.upcoming.classes },
              { value: "due_today", label: "Due Today", classes: STATUS_META.due_today.classes },
              { value: "overdue", label: "Overdue", classes: STATUS_META.overdue.classes },
            ]}
            onChange={setStatus}
            testId="schedules-status-filter"
          />
          <ColorFilterDropdown
            value={dueFilter}
            options={DUE_PRESETS.map((d) => ({ value: d.key, label: d.label, classes: d.classes }))}
            onChange={setDueFilter}
            testId="schedules-due-filter"
          />
          <button
            type="button" onClick={() => window.print()}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
            data-testid="schedules-print"
          >
            <Printer className="h-3.5 w-3.5" /> Print
          </button>
        </CardContent>
      </Card>

      <Card data-testid="accountant-manage-schedules">
        <CardContent className="p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Payment Schedules</p>
          <RecordCards
            rows={filtered}
            empty="No scheduled installments."
            testid="schedules-cards"
            card={(r) => ({
              key: `${r.lead_id}-${r.installment_number}`,
              testid: `accountant-manage-schedule-card-${r.lead_id}-${r.installment_number}`,
              title: r.client_name,
              subtitle: `#${r.installment_number} · due ${r.due_date}`,
              amount: <span className="text-sm font-bold text-slate-800">{fmt(r.amount)}</span>,
              meta: [
                <StatusBadge status={r.status} />,
                <span className="capitalize">{r.category}</span>,
                `${r.installments_paid}/${r.installments_total} paid`,
              ],
              onOpen: onView ? () => onView(r.lead_id) : undefined,
            })}
          />

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[58rem] table-fixed border-separate border-spacing-x-0 border-spacing-y-2 text-sm">
              <thead>
                <tr>
                  <th className="w-[5%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">S.No</th>
                  <th className="w-[15%] px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">Client</th>
                  <th className="w-[11%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Consultation/Session</th>
                  <th className="w-[11%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Branch</th>
                  <th className="w-[8%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Installment</th>
                  <th className="w-[10%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Due Date</th>
                  <th className="w-[9%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Amount</th>
                  <th className="w-[9%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Status</th>
                  <th className="w-[10%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Progress</th>
                  <th className="w-[12%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={10} className="px-3 py-8 text-center text-sm text-slate-400">No scheduled installments.</td></tr>
                ) : filtered.map((r, i) => {
                  const key = `${r.lead_id}-${r.installment_number}`;
                  return (
                    <tr key={key} data-testid={`accountant-manage-schedule-${key}`}>
                      <td className="rounded-l-[5px] border-y border-l border-slate-200 bg-white px-3 py-2 text-center text-slate-400">{i + 1}</td>
                      <td className="border-y border-slate-200 bg-white px-3 py-2 font-medium text-slate-800">{r.client_name}</td>
                      <td className="border-y border-slate-200 bg-white px-3 py-2 text-center capitalize text-slate-600">{r.category}</td>
                      <td className="border-y border-slate-200 bg-white px-3 py-2 text-center text-slate-600">{r.branch_name || "—"}</td>
                      <td className="border-y border-slate-200 bg-white px-3 py-2 text-center text-slate-600">#{r.installment_number}</td>
                      <td className="border-y border-slate-200 bg-white px-3 py-2 text-center text-slate-600">{r.due_date}</td>
                      <td className="border-y border-slate-200 bg-white px-3 py-2 text-center font-semibold text-slate-800">{fmt(r.amount)}</td>
                      <td className="border-y border-slate-200 bg-white px-3 py-2 text-center"><StatusBadge status={r.status} /></td>
                      <td className="border-y border-slate-200 bg-white px-3 py-2 text-center">
                        <ProgressBar paid={r.installments_paid} total={r.installments_total} />
                      </td>
                      <td className="rounded-r-[5px] border-y border-r border-slate-200 bg-white px-3 py-2">
                        <div className="flex items-center justify-center">
                          <button type="button" onClick={() => onView && onView(r.lead_id)} title="View Details" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-sky-600">
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default PaymentSchedulesBoard;
