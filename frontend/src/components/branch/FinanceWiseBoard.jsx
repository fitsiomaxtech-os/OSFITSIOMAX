import { useState } from "react";
import { Building2, Layers, TrendingUp, Receipt, BadgeIndianRupee, Wallet } from "lucide-react";
import { FinanceBoard } from "@/components/FinanceBoard";
import { ExpenseBoard } from "@/components/finance/ExpenseBoard";
import { FinanceOverviewBoard } from "@/components/finance/FinanceOverviewBoard";
import { ProfitBoard } from "@/components/finance/ProfitBoard";

// Every default vertical is named "online_.../offline_..." — same helper as
// Branch Wise's own sort.
const isOnlineVertical = (v) => String(v || "").startsWith("online_");

const ALL_KEY = "all";

// Overview first, because it is the only one that answers all three questions at once —
// Income, Expense and Profit are each that same page opened up one line at a time, and
// landing on the summary is landing on the answer rather than on one of its terms.
//
// Income is FinanceBoard exactly as it already stood; Expense and Profit are the
// Accountant's own ExpenseBoard/ProfitBoard, reused rather than rebuilt — both already
// carry approvals, payment-mode capture and a Revenue-less-Expense read, and now take
// branchId/mode from this screen's own pill row instead of asking a second time. Overview
// reads the same /finance/profit that Profit does, so the two cannot disagree.
const LEDGER_TABS = [
  { key: "overview", label: "Overview", icon: BadgeIndianRupee },
  { key: "income", label: "Income", icon: TrendingUp },
  { key: "expense", label: "Expense", icon: Receipt },
  { key: "profit", label: "Profit", icon: Wallet },
];

/**
 * Finance, browsed per branch — same pill-picker shape as Branch Wise, with one
 * addition: an "All Branches" pill first, Finance's own aggregate view (every branch
 * summed, with its own Revenue-by-Branch breakdown) rather than any one branch's book.
 * FinanceBoard already carries its own date-range and fee-type filters, so this wrapper
 * is only the branch switch around it.
 *
 * A second, Overview/Income/Expense/Profit row sits under the branch switch — the branch
 * pill picks WHOSE book, this picks WHICH page of it, and both apply together whichever
 * branch (or All Branches) is selected above.
 */
export const FinanceWiseBoard = ({ branches }) => {
  const sortedBranches = [...(branches || [])].sort((a, b) => {
    const onlineDiff = Number(isOnlineVertical(a.vertical)) - Number(isOnlineVertical(b.vertical));
    if (onlineDiff !== 0) return onlineDiff;
    return (a.branch_name || "").localeCompare(b.branch_name || "");
  });
  const [selectedId, setSelectedId] = useState(ALL_KEY);
  const [ledger, setLedger] = useState("overview");
  const branchId = selectedId === ALL_KEY ? undefined : selectedId;

  return (
    <div className="space-y-4" data-testid="finance-wise-board-root">
      {/* A dropdown on a phone, the pill row from sm up — same split Branch Wise uses. */}
      <select
        value={selectedId}
        onChange={(e) => setSelectedId(e.target.value)}
        className="h-10 w-full rounded-md border border-slate-200 bg-white px-2 text-sm font-semibold text-slate-700 sm:hidden"
        data-testid="finance-wise-subtab-select"
      >
        <option value={ALL_KEY}>All Branches</option>
        {sortedBranches.map((b) => <option key={b.id} value={b.id}>{b.branch_name}</option>)}
      </select>

      <div className="hidden flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-2 sm:flex" data-testid="finance-wise-subtabs">
        <button
          type="button"
          onClick={() => setSelectedId(ALL_KEY)}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
            selectedId === ALL_KEY ? "bg-sky-600 text-white shadow-sm" : "bg-slate-50 text-slate-600 hover:bg-slate-100"
          }`}
          data-testid="finance-wise-subtab-all"
        >
          <Layers className="h-3.5 w-3.5" /> All Branches
        </button>
        {sortedBranches.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => setSelectedId(b.id)}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
              selectedId === b.id ? "bg-sky-600 text-white shadow-sm" : "bg-slate-50 text-slate-600 hover:bg-slate-100"
            }`}
            data-testid={`finance-wise-subtab-${b.id}`}
          >
            <Building2 className="h-3.5 w-3.5" /> {b.branch_name}
          </button>
        ))}
      </div>

      {/* Overview / Income / Expense / Profit — the branch pill above already picked
          whose book, this picks which page of it. */}
      <div className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-1" data-testid="finance-wise-ledger-tabs">
        {LEDGER_TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setLedger(t.key)}
              className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${
                ledger === t.key ? "bg-sky-50 text-sky-700" : "text-slate-600 hover:bg-slate-50"
              }`}
              data-testid={`finance-wise-ledger-tab-${t.key}`}
            >
              <Icon className="h-4 w-4" />{t.label}
            </button>
          );
        })}
      </div>

      {/* Keyed on the branch selection so switching remounts the board — its own filters
          (fee type, search, date range) belong to one branch's book and must not survive
          the switch to another. Not keyed on `ledger` too: these are four different
          components, already unmounted/remounted by React swapping which one renders
          below. */}
      {ledger === "overview" && <FinanceOverviewBoard key={selectedId} branchId={branchId} />}
      {ledger === "income" && <FinanceBoard key={selectedId} branchId={branchId} />}
      {ledger === "expense" && <ExpenseBoard key={selectedId} branchId={branchId} scoped />}
      {ledger === "profit" && <ProfitBoard key={selectedId} branchId={branchId} scoped />}
    </div>
  );
};
