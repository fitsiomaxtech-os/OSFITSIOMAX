import { useCallback, useEffect, useState } from "react";
import { BadgeIndianRupee, CheckSquare, Receipt, TrendingUp } from "lucide-react";
import { AccountantManageTab } from "@/components/branch/AccountantManageTab";
import { ApprovalsBoard, PendingBadge } from "@/components/finance/ApprovalsBoard";
import { getFinanceApprovals, getFinanceExpenses } from "@/lib/api";
import { ExpenseBoard } from "@/components/finance/ExpenseBoard";
import { ProfitBoard } from "@/components/finance/ProfitBoard";

const TABS = [
  { key: "summary", label: "Summary", icon: BadgeIndianRupee },
  { key: "approvals", label: "Approvals", icon: CheckSquare },
  { key: "expense", label: "Expense", icon: Receipt },
  { key: "profit", label: "Profit", icon: TrendingUp },
];

// How often the Approvals badge asks again. A branch sends a day up while this board sits
// open on some other tab, and a minute is soon enough to hear about it without asking the
// finance endpoints every few seconds for a number that rarely moves.
const PENDING_REFRESH_MS = 60000;

// Same Online/Offline split every other mode filter in the OS uses, layered on top of
// Accountant Manage's own board (Branches & Verticals > Analytics > Accountant Manage)
// rather than a copy of it — Summary is that exact page, branch select and all.
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
      {/* canSend off: sending a day up for approval is the branch desk's move, and this is
          the desk it gets sent to. What lands here is signed off on the Approvals tab.

          approvedOnly: from this chair income means money that has been signed off. A
          collection still sitting at a branch desk is the branch's figure, not the
          accountant's, and counting it here would have this board disagree with the books
          it is read against. The three piles still show, as figures rather than a filter. */}
      <AccountantManageTab mode={mode === "all" ? undefined : mode} canSend={false} approvedOnly />
    </div>
  );
};

/**
 * Accountant's own login board. Four tabs: Summary (Branches & Verticals > Analytics >
 * Accountant Manage's own board, now filterable by vertical), Approvals (newly collected
 * payments waiting on sign-off), Expense (what went out, logged by hand) and Profit
 * (Revenue less Expense for a picked window). Approvals/Expense/Profit are new.
 */
export const AccountantBoard = () => {
  const [tab, setTab] = useState("summary");

  // What is waiting on this desk, per ledger, across every branch. Held here rather than
  // read off the Approvals tab's own figures: those follow its filters, so a badge fed by
  // them would shrink when a branch was picked, and would not exist at all until the tab
  // had been opened -- which is the one thing the badge is there to prompt. Counted the
  // way the backend counts: a rejected expense is back with the branch, not waiting here.
  const [pending, setPending] = useState({ income: 0, expenses: 0 });
  const refreshPending = useCallback(async () => {
    const [income, expenses] = await Promise.all([
      getFinanceApprovals({ approved: false }).catch(() => null),
      getFinanceExpenses({}).catch(() => null),
    ]);
    // A failed read keeps the last count rather than dropping to zero: a badge that
    // vanishes on a network blip says the queue emptied when nothing was approved.
    setPending((prev) => ({
      income: income ? income.summary?.pending_count || 0 : prev.income,
      expenses: expenses ? expenses.pending_count || 0 : prev.expenses,
    }));
  }, []);

  useEffect(() => {
    refreshPending();
    const id = setInterval(() => { if (!document.hidden) refreshPending(); }, PENDING_REFRESH_MS);
    return () => clearInterval(id);
  }, [refreshPending]);

  return (
    <div className="space-y-4" data-testid="accountant-board-root">
      {/* No page heading. "Finance" over "Fees collected across every branch." restated
          the board an accountant just signed in to, above a tab row that names the four
          things on it — a title costing a band of screen to tell you where you are. */}
      <div className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-1" data-testid="accountant-board-tabs">
        {TABS.map((t) => {
          const Icon = t.icon;
          const count = t.key === "approvals" ? pending.income + pending.expenses : 0;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`relative inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${tab === t.key ? "bg-sky-50 text-sky-700" : "text-slate-600 hover:bg-slate-50"}`}
              data-testid={`accountant-board-tab-${t.key}`}
            >
              <Icon className="h-4 w-4" />{t.label}
              <PendingBadge count={count} testId={`accountant-board-tab-badge-${t.key}`} />
            </button>
          );
        })}
      </div>

      {tab === "summary" && <SummaryTab />}
      {tab === "approvals" && <ApprovalsBoard pending={pending} onChanged={refreshPending} />}
      {tab === "expense" && <ExpenseBoard />}
      {tab === "profit" && <ProfitBoard />}
    </div>
  );
};
