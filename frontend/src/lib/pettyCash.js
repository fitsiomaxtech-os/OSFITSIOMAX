/**
 * What comes out of the tin, as the forms need to know it before they send anything.
 *
 * The server decides this — _is_petty_cash_expense in backend/routers/v3_finance.py is
 * what actually draws the tin down and what refuses an expense with no reason on it. This
 * is the same rule stated on the client so a form can say what will happen while it is
 * being filled in, rather than after a request comes back rejected.
 *
 * Shared rather than written into each form. Two screens can log a branch's spending — the
 * branch's own Expenses panel and the Accountant's Expense Board — and a copy of the rule
 * in each is a copy to forget: the moment one says Rs.1,000 and the other Rs.2,000, an
 * accountant is told an expense is petty cash on one screen and not on the other, for the
 * same money on the same day.
 */

/** At or under this, paid in cash, at a branch: petty cash. In step with PETTY_CASH_LIMIT
 *  in backend/routers/v3_finance.py, which is where the figure is actually enforced. */
export const PETTY_CASH_LIMIT = 1000;

/**
 * Whether one expense, as typed, comes out of the tin.
 *
 * The three tests the server applies, in the same order. The mode one is the one worth
 * remembering: the tin holds notes, so a Rs.400 subscription paid by card is a small
 * expense and not petty cash, however small it is.
 *
 * `branchId` is optional here because both callers are already scoped to a branch by the
 * time they ask — pass it where an org-wide expense is possible, which has no tin to come
 * out of.
 */
export const isPettyCash = (amount, mode, branchId = true) =>
  !!branchId && Number(amount) > 0 && Number(amount) <= PETTY_CASH_LIMIT && mode === "cash";

/** The one sentence a petty cash expense is approved on. Required, because notes out of a
 *  tin leave no invoice, no reference and no transfer behind them — see create_expense. */
export const PETTY_CASH_REASON_REQUIRED = "Say what the petty cash was spent on — the accountant approves it on that";
