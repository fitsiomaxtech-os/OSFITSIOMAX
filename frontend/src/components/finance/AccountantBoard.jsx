import { FinanceWorkspace } from "@/components/finance/FinanceWorkspace";

// Summary (Accountant Manage's own board, filterable by vertical), Approvals (collections
// and expense requests waiting on sign-off), Expense (what went out) and Profit (Revenue
// less Expense for a picked window) — the four pages this desk works in, in the order it
// works them, opening on the ledger rather than on a summary of it.
const TABS = ["summary", "approvals", "expense", "profit"];

/**
 * Accountant's own login board.
 *
 * The pages themselves live in FinanceWorkspace, which Super Admin > Finance renders too:
 * the same components against the same /finance endpoints, which already answer a
 * super_admin and an accountant identically. So an approval given here, an expense logged
 * here or a book closed here is on that screen the next time it loads, and the other way
 * round — there is only one set of books and one set of pages onto it.
 *
 * What differs between the two is only which pages are in the row and what is above it:
 * Super Admin picks a branch from a pill row before picking a page, and has an Overview
 * and an Income page besides these four.
 */
export const AccountantBoard = () => (
  <FinanceWorkspace tabs={TABS} defaultTab="summary" testId="accountant-board" />
);

export default AccountantBoard;
