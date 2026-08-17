import { useCallback, useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Wallet } from "lucide-react";
import { MilkDateInput } from "@/components/ui/milk-calendar";
import { getBranches, getFinanceProfit } from "@/lib/api";

const fmt = (n) => `Rs.${(Number(n) || 0).toLocaleString("en-IN")}`;

/** Accountant > Profit — Revenue (every collection for the window, same figure
 *  Accountant Manage's own Total Revenue tile shows) less Expense for the same window
 *  and branch. Approval status plays no part: it's a review step, not a filter on what
 *  counts as money in. */
export const ProfitBoard = () => {
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState("");
  const [mode, setMode] = useState("all"); // "all" | "online" | "offline"
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [data, setData] = useState({ revenue: 0, expense: 0, profit: 0, expense_by_category: [] });
  const [loading, setLoading] = useState(false);

  useEffect(() => { getBranches().then(setBranches).catch(() => {}); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (branchId) params.branch_id = branchId;
      if (mode !== "all") params.mode = mode;
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;
      setData(await getFinanceProfit(params));
    } catch { /* silent */ }
    setLoading(false);
  }, [branchId, mode, startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  const positive = (data.profit || 0) >= 0;

  return (
    <div className="space-y-4" data-testid="finance-profit-root">
      <div className="flex flex-wrap items-center gap-3">
        {[["all", "All"], ["offline", "Offline"], ["online", "Online"]].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setMode(key)}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
              mode === key ? "border-sky-600 bg-sky-600 text-white shadow-sm" : "border-slate-200 bg-white text-slate-600 hover:border-sky-300 hover:text-sky-600"
            }`}
            data-testid={`finance-profit-mode-${key}`}
          >
            {label}
          </button>
        ))}
        <select
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          className="h-9 rounded-md border border-slate-200 px-2 text-sm"
          data-testid="finance-profit-branch"
        >
          <option value="">All Branches</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.branch_name}</option>)}
        </select>
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <MilkDateInput value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-9 rounded-md border border-slate-200 px-2 text-xs" data-testid="finance-profit-start" />
          <span>to</span>
          <MilkDateInput value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-9 rounded-md border border-slate-200 px-2 text-xs" data-testid="finance-profit-end" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4" data-testid="finance-profit-revenue-card">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-700">Revenue</p>
            <TrendingUp className="h-4 w-4 text-emerald-600" />
          </div>
          <p className="text-2xl font-bold text-emerald-700">{fmt(data.revenue)}</p>
        </div>
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4" data-testid="finance-profit-expense-card">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wide text-rose-700">Expense</p>
            <TrendingDown className="h-4 w-4 text-rose-600" />
          </div>
          <p className="text-2xl font-bold text-rose-700">{fmt(data.expense)}</p>
        </div>
        <div className={`rounded-xl border p-4 ${positive ? "border-sky-200 bg-sky-50" : "border-amber-200 bg-amber-50"}`} data-testid="finance-profit-net-card">
          <div className="mb-1 flex items-center justify-between">
            <p className={`text-[11px] font-medium uppercase tracking-wide ${positive ? "text-sky-700" : "text-amber-700"}`}>Profit</p>
            <Wallet className={`h-4 w-4 ${positive ? "text-sky-600" : "text-amber-600"}`} />
          </div>
          <p className={`text-2xl font-bold ${positive ? "text-sky-700" : "text-amber-700"}`}>{fmt(data.profit)}</p>
        </div>
      </div>

      {data.expense_by_category.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden" data-testid="finance-profit-by-category">
          <div className="border-b border-slate-100 bg-slate-50/80 px-4 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Expense by Category</p>
          </div>
          <div className="divide-y divide-slate-50">
            {data.expense_by_category.map((c) => (
              <div key={c.category} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="text-slate-700">{c.category}</span>
                <span className="font-semibold text-rose-600">{fmt(c.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading && <p className="text-center text-xs text-slate-400">Loading...</p>}
    </div>
  );
};
