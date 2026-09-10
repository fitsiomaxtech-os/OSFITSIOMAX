import { useCallback, useEffect, useState } from "react";
import { BadgeIndianRupee, Building2, CheckSquare, Layers, Receipt, Wallet } from "lucide-react";
import { AccountantManageTab } from "@/components/branch/AccountantManageTab";
import { ApprovalsBoard, PendingBadge } from "@/components/finance/ApprovalsBoard";
import { ExpenseBoard } from "@/components/finance/ExpenseBoard";
import { ProfitBoard } from "@/components/finance/ProfitBoard";
import { getFinanceApprovals, getFinanceExpenses } from "@/lib/api";

// How often the Approvals badge asks again. A branch sends a day up while this board sits
// open on some other tab, and a minute is soon enough to hear about it without asking the
// finance endpoints every few seconds for a number that rarely moves.
const PENDING_REFRESH_MS = 60000;

const ALL_KEY = "all";

// Every default vertical is named "online_.../offline_..." — same helper as Branch Wise's
// own sort.
const isOnlineVertical = (v) => String(v || "").startsWith("online_");

// Same Online/Offline split every other mode filter in the OS uses, layered on top of
// Accountant Manage's own board (Branches & Verticals > Analytics > Accountant Manage)
// rather than a copy of it — Summary is that exact page, branch select and all.
const SummaryTab = ({ branchId, scoped }) => {
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
      <AccountantManageTab
        branchId={branchId}
        scoped={scoped}
        mode={mode === "all" ? undefined : mode}
        canSend={false}
        approvedOnly
      />
    </div>
  );
};

/**
 * The finance book, one page at a time, in the order the desk works them: the ledger
 * itself, what is waiting on a signature, what went out, and what is left of it.
 *
 * One list, not one per board. Both desks that keep this book — the Accountant's own login
 * board and Super Admin > Finance — show these four, so neither what a page shows nor
 * which pages there are can drift between the two screens: there is nowhere for them to
 * drift apart to.
 *
 * Super Admin used to carry an Overview and an Income page besides these. Both are gone.
 * Overview asked /finance/profit for income, expense and the subtraction between them,
 * which is Profit's own page; Income was the narrower ledger of the two on this board,
 * reading only consultation and package fees where Summary reads every category of
 * collection there is.
 *
 * Every page reads a /finance endpoint that already treats super_admin and accountant
 * identically (only branch_admin is narrowed, to its own branch), so the two boards are
 * the same figures out of the same source: a sign-off, an expense or a closed book
 * entered on either shows on the other the next time it loads.
 */
const TABS = [
  {
    key: "summary",
    label: "Summary",
    icon: BadgeIndianRupee,
    render: ({ branchId, scoped }) => <SummaryTab branchId={branchId} scoped={scoped} />,
  },
  {
    key: "approvals",
    label: "Approvals",
    icon: CheckSquare,
    render: ({ branchId, scoped, pending, onChanged }) => (
      <ApprovalsBoard branchId={branchId} scoped={scoped} pending={pending} onChanged={onChanged} />
    ),
  },
  {
    key: "expense",
    label: "Expense",
    icon: Receipt,
    render: ({ branchId, scoped }) => <ExpenseBoard branchId={branchId} scoped={scoped} />,
  },
  {
    key: "profit",
    label: "Profit",
    icon: Wallet,
    render: ({ branchId, scoped }) => <ProfitBoard branchId={branchId} scoped={scoped} />,
  },
];

/**
 * The finance book itself, with no role attached to it. Both desks that keep it render
 * this and open on the same page of it; the only thing either one says about itself is
 * whether the branch is picked above the tabs.
 *
 * @param branches  Present only where it is — Super Admin's pill row. Given it, every page
 *              is scoped by that row and drops its own branch control; left off, as on the
 *              Accountant's own board, each page picks its own branch as it always did.
 */
export const FinanceWorkspace = ({ branches, testId = "finance-workspace" }) => {
  const scoped = !!branches;
  const [tab, setTab] = useState(TABS[0].key);
  const [selectedId, setSelectedId] = useState(ALL_KEY);
  const branchId = scoped && selectedId !== ALL_KEY ? selectedId : undefined;

  const sortedBranches = [...(branches || [])].sort((a, b) => {
    const onlineDiff = Number(isOnlineVertical(a.vertical)) - Number(isOnlineVertical(b.vertical));
    if (onlineDiff !== 0) return onlineDiff;
    return (a.branch_name || "").localeCompare(b.branch_name || "");
  });

  // What is waiting on this desk, per ledger, across every branch. Held here rather than
  // read off the Approvals page's own figures: those follow its filters, so a badge fed by
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

  const active = TABS.find((t) => t.key === tab) || TABS[0];

  return (
    <div className="space-y-4" data-testid={`${testId}-root`}>
      {/* Whose book. A dropdown on a phone, the pill row from sm up — same split Branch
          Wise uses. Only where the caller handed down a branch list: the Accountant's own
          board has no such row, and each page there keeps its own branch control. */}
      {scoped && (
        <>
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
        </>
      )}

      {/* Which page of it. No heading over this row: "Finance" above a row that already
          names its pages costs a band of screen to say where you are. */}
      <div className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-1" data-testid={`${testId}-tabs`}>
        {TABS.map((t) => {
          const Icon = t.icon;
          const count = t.key === "approvals" ? pending.income + pending.expenses : 0;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`relative inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${tab === t.key ? "bg-sky-50 text-sky-700" : "text-slate-600 hover:bg-slate-50"}`}
              data-testid={`${testId}-tab-${t.key}`}
            >
              <Icon className="h-4 w-4" />{t.label}
              <PendingBadge count={count} testId={`${testId}-tab-badge-${t.key}`} />
            </button>
          );
        })}
      </div>

      {/* Keyed on the branch selection so switching remounts the page below — a page's own
          filters (fee type, search, date range) belong to one branch's book and must not
          survive the switch to another. The key sits on a wrapper rather than on the page:
          the pages are built by a plain function call here, and a `key` handed to one of
          those is an ordinary prop React never reads. Not keyed on the tab too: these are
          different components, already unmounted and remounted by React swapping which
          one renders. */}
      <div key={selectedId}>
        {active.render({ branchId, scoped, pending, onChanged: refreshPending })}
      </div>
    </div>
  );
};

export default FinanceWorkspace;
