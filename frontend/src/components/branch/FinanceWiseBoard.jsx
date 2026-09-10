import { FinanceWorkspace } from "@/components/finance/FinanceWorkspace";

// Overview first, because it is the only page that answers all three questions at once —
// Income, Expense and Profit are each that same summary opened up one line at a time, and
// landing on it is landing on the answer rather than on one of its terms.
//
// Summary and Approvals are the Accountant's own two pages, rendered here from the same
// components rather than reimplemented: Summary is Accountant Manage (the eight category
// tiles, the payment-mode split, Payment Schedule, Discount Applied, Closing Balance and
// Close Books), and Approvals is the sign-off queue for both ledgers, income and expense,
// with the same red count on the tab when something is waiting. Expense and Profit were
// already shared. So every figure and every action an accountant has is on this screen,
// against the same endpoints, and neither side can show the other a stale book.
const TABS = ["overview", "summary", "income", "approvals", "expense", "profit"];

/**
 * Super Admin > Finance — the whole finance book, browsed per branch.
 *
 * The branch pill row picks whose book and the tab row picks which page of it, and both
 * apply together whichever branch (or All Branches) is selected. Every page here is the
 * same component the Accountant's own board renders, so a sign-off, an expense or a
 * closed book entered on either screen is on the other the next time it loads.
 */
export const FinanceWiseBoard = ({ branches }) => (
  <FinanceWorkspace tabs={TABS} branches={branches || []} defaultTab="overview" testId="finance-wise-board" />
);

export default FinanceWiseBoard;
