import { useState } from "react";
import { BadgeIndianRupee, CheckSquare, Receipt, TrendingUp } from "lucide-react";
import { FinanceBoard } from "@/components/FinanceBoard";
import { ApprovalsBoard } from "@/components/finance/ApprovalsBoard";
import { ExpenseBoard } from "@/components/finance/ExpenseBoard";
import { ProfitBoard } from "@/components/finance/ProfitBoard";

const TABS = [
  { key: "summary", label: "Summary", icon: BadgeIndianRupee },
  { key: "approvals", label: "Approvals", icon: CheckSquare },
  { key: "expense", label: "Expense", icon: Receipt },
  { key: "profit", label: "Profit", icon: TrendingUp },
];

// Same Online/Offline split every other mode filter in the OS uses, layered on top of
// the existing Finance board rather than a copy of it.
const SummaryTab = () => {
  const [mode, setMode] = useState("all"); // "all" | "online" | "offline"
  return (
    <div className="space-y-4" data-testid="finance-summary-root">
      <div className="flex flex-wrap items-center gap-2" data-testid="finance-summary-mode-filter">
        {[["all", "All"], ["offline", "Offline"], ["online", "Online"]].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setMode(key)}
            className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
              mode === key ? "border-sky-600 bg-sky-600 text-white shadow-sm" : "border-slate-200 bg-white text-slate-600 hover:border-sky-300 hover:text-sky-600"
            }`}
            data-testid={`finance-summary-mode-${key}`}
          >
            {label}
          </button>
        ))}
      </div>
      {/* Keyed on mode so switching remounts the board — its own fee-type/search/date
          filters belong to whichever slice is showing and must not survive the switch. */}
      <FinanceBoard key={mode} mode={mode === "all" ? undefined : mode} />
    </div>
  );
};

/**
 * Accountant's own login board. Four tabs: Summary (the existing Finance revenue view,
 * now filterable by vertical), Approvals (newly collected payments waiting on sign-off),
 * Expense (what went out, logged by hand) and Profit (Revenue less Expense for a picked
 * window). Approvals/Expense/Profit are new — Summary is the pre-existing FinanceBoard,
 * unchanged apart from the mode filter wrapped around it here.
 */
export const AccountantBoard = () => {
  const [tab, setTab] = useState("summary");

  return (
    <div className="space-y-4" data-testid="accountant-board-root">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Finance</h2>
        <p className="text-sm text-slate-500">Fees collected across every branch.</p>
      </div>

      <div className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-1" data-testid="accountant-board-tabs">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${tab === t.key ? "bg-sky-50 text-sky-700" : "text-slate-600 hover:bg-slate-50"}`}
              data-testid={`accountant-board-tab-${t.key}`}
            >
              <Icon className="h-4 w-4" />{t.label}
            </button>
          );
        })}
      </div>

      {tab === "summary" && <SummaryTab />}
      {tab === "approvals" && <ApprovalsBoard />}
      {tab === "expense" && <ExpenseBoard />}
      {tab === "profit" && <ProfitBoard />}
    </div>
  );
};
