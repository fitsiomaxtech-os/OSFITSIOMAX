import { useCallback, useEffect, useState } from "react";
import { TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { MilkDateInput } from "@/components/ui/milk-calendar";
import { getFinanceProfit } from "@/lib/api";

const fmt = (n) => `Rs.${(Number(n) || 0).toLocaleString("en-IN")}`;

/**
 * Super Admin > Finance > Overview — the three figures the other three tabs each own a
 * page of, put on one screen: what came in, what went out, and what is left.
 *
 * Read from /finance/profit, the same endpoint the Profit tab reads, so the Income here
 * and the Income there are one number rather than two answers to the same question. The
 * branch and the vertical are already picked by the pill row above this board; the only
 * thing chosen here is the window.
 *
 * Expense means expense that has been signed off — a branch raising a request is somebody
 * asking to spend, not money gone. That rule lives in the endpoint, and holds the same way
 * on all four tabs because all four ultimately read it from there.
 */
export const FinanceOverviewBoard = ({ branchId, mode }) => {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [data, setData] = useState({ revenue: 0, expense: 0, profit: 0 });
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (branchId) params.branch_id = branchId;
      if (mode && mode !== "all") params.mode = mode;
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;
      setData(await getFinanceProfit(params));
    } catch { /* silent */ }
    setLoading(false);
  }, [branchId, mode, startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  const income = Number(data.revenue) || 0;
  const expense = Number(data.expense) || 0;
  const profit = Number(data.profit) || 0;
  const positive = profit >= 0;

  const CARDS = [
    { key: "income", label: "Income", value: income, icon: TrendingUp, tone: "border-emerald-200 bg-emerald-50", text: "text-emerald-700", iconTone: "text-emerald-600", sub: "everything collected in this window" },
    { key: "expense", label: "Expense", value: expense, icon: TrendingDown, tone: "border-rose-200 bg-rose-50", text: "text-rose-700", iconTone: "text-rose-600", sub: "approved spending in this window" },
    {
      key: "profit",
      label: positive ? "Profit" : "Loss",
      value: profit,
      icon: Wallet,
      tone: positive ? "border-sky-200 bg-sky-50" : "border-amber-200 bg-amber-50",
      text: positive ? "text-sky-700" : "text-amber-700",
      iconTone: positive ? "text-sky-600" : "text-amber-600",
      sub: "income less expense",
    },
  ];

  return (
    <div className="space-y-4" data-testid="finance-overview-root">
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
        <MilkDateInput value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-9 rounded-md border border-slate-200 px-2 text-xs" data-testid="finance-overview-start" />
        <span>to</span>
        <MilkDateInput value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-9 rounded-md border border-slate-200 px-2 text-xs" data-testid="finance-overview-end" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {CARDS.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.key} className={`rounded-xl border p-4 ${c.tone}`} data-testid={`finance-overview-${c.key}-card`}>
              <div className="mb-1 flex items-center justify-between">
                <p className={`text-[11px] font-medium uppercase tracking-wide ${c.text}`}>{c.label}</p>
                <Icon className={`h-4 w-4 ${c.iconTone}`} />
              </div>
              <p className={`text-2xl font-bold ${c.text}`}>{fmt(c.value)}</p>
              <p className="mt-0.5 text-[10px] text-slate-500">{c.sub}</p>
            </div>
          );
        })}
      </div>

      {/* The subtraction spelled out. The three cards above are the three numbers; this is
          the sentence they make, so nobody has to take on trust that the third is the
          first two subtracted. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm" data-testid="finance-overview-equation">
        <span className="font-semibold text-emerald-700">{fmt(income)}</span>
        <span className="text-slate-400">income</span>
        <span className="text-slate-300">&minus;</span>
        <span className="font-semibold text-rose-700">{fmt(expense)}</span>
        <span className="text-slate-400">expense</span>
        <span className="text-slate-300">=</span>
        <span className={`font-bold ${positive ? "text-sky-700" : "text-amber-700"}`}>{fmt(profit)}</span>
        <span className="text-slate-400">{positive ? "profit" : "loss"}</span>
      </div>

      {loading && <p className="text-center text-xs text-slate-400">Loading...</p>}
    </div>
  );
};
