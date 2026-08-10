import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { getRevenueOverview, getBranches } from "@/lib/api";
import {
  ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar, Legend,
} from "recharts";
import { NetCashflowSunburst } from "@/components/branch/NetCashflowSunburst";
import { MilkDateInput } from "@/components/ui/milk-calendar";

const DATE_PRESETS = [
  { key: "today", label: "Today" },
  { key: "this_week", label: "This Week" },
  { key: "this_month", label: "This Month" },
  { key: "custom", label: "Custom" },
];

const SUB_TABS = [
  { key: "revenue", label: "Total Revenue" },
  { key: "consultation", label: "Consultation Payments" },
  { key: "session", label: "Session Payment" },
  { key: "refunds", label: "Refunds & Adjustments" },
];

const CATEGORY_COLORS = { consultation: "#0ea5e9", session: "#8b5cf6" };
const MODE_COLORS = ["#0ea5e9", "#22c55e", "#f59e0b", "#8b5cf6", "#ef4444", "#64748b"];

const startOfDay = (d) => { const n = new Date(d); n.setHours(0, 0, 0, 0); return n; };
const startOfWeek = (d) => { const x = startOfDay(d); x.setDate(x.getDate() - x.getDay()); return x; };
const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const toIso = (d) => d.toISOString().slice(0, 10);

/**
 * AC Overview — Super Admin's cross-branch revenue reporting, under Branch
 * Management. Only "Total Revenue" is implemented; the other three sub-tabs
 * need real business fields (invoice numbers, refunds, installment schedules)
 * that don't exist in the data model yet, so they're placeholders for now.
 */
export const AcOverviewBoard = () => {
  const [preset, setPreset] = useState("this_month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState("");
  const [subTab, setSubTab] = useState("revenue");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { getBranches().then(setBranches).catch(() => setBranches([])); }, []);

  const { startDate, endDate } = useMemo(() => {
    const today = new Date();
    if (preset === "today") return { startDate: toIso(today), endDate: toIso(today) };
    if (preset === "this_week") return { startDate: toIso(startOfWeek(today)), endDate: toIso(today) };
    if (preset === "this_month") return { startDate: toIso(startOfMonth(today)), endDate: toIso(today) };
    return { startDate: customFrom, endDate: customTo };
  }, [preset, customFrom, customTo]);

  const load = useCallback(() => {
    if (preset === "custom" && (!customFrom || !customTo)) return;
    setLoading(true);
    getRevenueOverview({ start_date: startDate, end_date: endDate, branch_id: branchId || undefined })
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [startDate, endDate, branchId, preset, customFrom, customTo]);

  useEffect(() => { load(); }, [load]);

  const k = data?.kpis || {};
  const fmt = (n) => `Rs.${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

  return (
    <div className="space-y-4" data-testid="ac-overview-board">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">AC Overview</h2>
        <p className="text-sm text-slate-500">Revenue collected across the business.</p>
      </div>

      {/* Shared header */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-3" data-testid="ac-overview-header">
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
          {DATE_PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPreset(p.key)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${preset === p.key ? "bg-sky-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`}
              data-testid={`ac-overview-preset-${p.key}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <CalendarDays className="h-3.5 w-3.5" />
            <MilkDateInput  value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-8 rounded-md border border-slate-200 px-2 text-xs" data-testid="ac-overview-custom-from" />
            <span>to</span>
            <MilkDateInput  value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="h-8 rounded-md border border-slate-200 px-2 text-xs" data-testid="ac-overview-custom-to" />
          </div>
        )}
        <select
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          className="h-9 rounded-md border border-slate-200 px-2 text-xs"
          data-testid="ac-overview-branch-select"
        >
          <option value="">All Branches</option>
          {branches.map((br) => <option key={br.id} value={br.id}>{br.branch_name}</option>)}
        </select>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="ac-overview-kpis">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Total Collected</p>
          <p className="mt-1 text-2xl font-bold text-emerald-700">{fmt(k.total_collected)}</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Pending Collection</p>
          <p className="mt-1 text-2xl font-bold text-amber-700">{k.pending_count || 0}</p>
          <p className="text-[10px] text-slate-400">patients awaiting fee</p>
        </div>
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Refunds</p>
          <p className="mt-1 text-2xl font-bold text-rose-700">{fmt(k.refunds)}</p>
          <p className="text-[10px] text-slate-400">not tracked yet</p>
        </div>
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Net Revenue</p>
          <p className="mt-1 text-2xl font-bold text-sky-700">{fmt(k.net_revenue)}</p>
        </div>
      </div>

      {/* Sub tabs */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2" data-testid="ac-overview-subtabs">
        {SUB_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setSubTab(t.key)}
            className={`rounded-md px-3 py-2 text-sm font-medium transition ${subTab === t.key ? "bg-sky-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}
            data-testid={`ac-overview-subtab-${t.key}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subTab === "revenue" ? (
        <TotalRevenueTab data={data} loading={loading} fmt={fmt} />
      ) : (
        <Card>
          <CardContent className="p-10 text-center text-sm text-slate-400">
            {SUB_TABS.find((t) => t.key === subTab)?.label} — coming soon
          </CardContent>
        </Card>
      )}
    </div>
  );
};

const TotalRevenueTab = ({ data, loading, fmt }) => {
  if (loading && !data) return <p className="py-10 text-center text-sm text-slate-400">Loading...</p>;
  if (!data) return <p className="py-10 text-center text-sm text-slate-400">No data</p>;

  const b = data.breakdown || {};
  const byBranch = data.by_branch || [];
  const paymentModes = Object.entries(data.payment_modes || {}).sort((a, z) => z[1] - a[1]);
  const modeTotal = paymentModes.reduce((s, [, v]) => s + v, 0) || 1;

  return (
    <div className="space-y-4" data-testid="ac-total-revenue-tab">
      {/* Revenue split — three ways since the Fitsiomax Store's counter sales began
          counting. Two cards would have left their percentages short of 100 with nothing
          on screen saying where the rest went. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Consultation Revenue</p>
          <p className="mt-1 text-xl font-bold text-sky-800">{fmt(b.consultation_revenue)}</p>
          <p className="text-[11px] text-slate-500">{b.consultation_pct || 0}% of total</p>
        </div>
        <div className="rounded-xl border border-violet-200 bg-violet-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">Session Revenue</p>
          <p className="mt-1 text-xl font-bold text-violet-800">{fmt(b.session_revenue)}</p>
          <p className="text-[11px] text-slate-500">{b.session_pct || 0}% of total</p>
        </div>
        <div className="rounded-xl border border-teal-200 bg-teal-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">Store Revenue</p>
          <p className="mt-1 text-xl font-bold text-teal-800">{fmt(b.store_revenue)}</p>
          <p className="text-[11px] text-slate-500">{b.store_pct || 0}% of total</p>
        </div>
      </div>

      {/* Revenue by Category — Net Cashflow sunburst */}
      <NetCashflowSunburst data={data} />

      {/* Branch comparison — only meaningful across more than one branch */}
      {byBranch.length > 1 && (
        <Card>
          <CardContent className="p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Branch-wise Comparison</p>
            <ResponsiveContainer width="100%" height={Math.max(160, byBranch.length * 40)}>
              <BarChart data={byBranch} layout="vertical" margin={{ left: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="branch_name" tick={{ fontSize: 11 }} width={120} />
                <Tooltip formatter={(v) => fmt(v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="consultation_total" stackId="a" fill={CATEGORY_COLORS.consultation} name="Consultation" />
                <Bar dataKey="session_total" stackId="a" fill={CATEGORY_COLORS.session} name="Session" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Payment mode breakdown */}
      <Card>
        <CardContent className="p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Payment Mode Breakdown</p>
          {paymentModes.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-400">No payments in this range.</p>
          ) : (
            <div className="space-y-2">
              {paymentModes.map(([mode, amt], i) => (
                <div key={mode} className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-xs capitalize text-slate-600">{mode}</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full" style={{ width: `${(amt / modeTotal) * 100}%`, background: MODE_COLORS[i % MODE_COLORS.length] }} />
                  </div>
                  <span className="w-24 shrink-0 text-right text-xs font-semibold text-slate-700">{fmt(amt)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Transactions table */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/80">
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">Date</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">Branch</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">Source</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-400">Gross</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-400">Discount</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-400">Tax</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-400">Net</th>
                </tr>
              </thead>
              <tbody>
                {(data.transactions || []).length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">No transactions in this range.</td></tr>
                ) : data.transactions.map((tx) => (
                  <tr key={tx.id} className="border-b border-slate-50" data-testid={`ac-revenue-tx-${tx.id}`}>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{(tx.date || "").slice(0, 16).replace("T", " ")}</td>
                    <td className="px-4 py-2.5 text-slate-700">{tx.branch_name || "—"}</td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-[5px] px-2 py-0.5 text-[10px] font-semibold capitalize ${tx.source === "session" ? "bg-violet-100 text-violet-700" : "bg-sky-100 text-sky-700"}`}>
                        {tx.source}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-slate-800">{fmt(tx.gross)}</td>
                    <td className="px-4 py-2.5 text-right text-slate-400">{fmt(tx.discount)}</td>
                    <td className="px-4 py-2.5 text-right text-slate-400">{fmt(tx.tax)}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-emerald-700">{fmt(tx.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default AcOverviewBoard;
