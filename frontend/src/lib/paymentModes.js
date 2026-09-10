// The tender set every collection flow already writes into its "... via X" wording
// (see _parse_payment_mode in v3_finance.py), plus "unknown" for the rows that carry
// none — package_sold, and any Expense logged before payment_mode existed.
//
// Shared by every board that splits money by tender — Expense (ExpenseBoard), Accountant
// Manage's own payment-mode row, and FinanceBoard/FinanceOverviewBoard, which no board
// renders any more — rather than copied into each: the four tiles the branch reads as
// "Cash, Cheque, Bank, UPI" have to say the same thing in the same order wherever they
// appear, and a label changed in one place and not the others is how a bank transfer
// starts reading as "Account_transfer" on one tab and "Bank" on the next.
export const PAYMENT_MODE_ORDER = ["cash", "cheque", "account_transfer", "upi", "card", "unknown"];

export const PAYMENT_MODE_LABELS = {
  cash: "Cash",
  cheque: "Cheque",
  account_transfer: "Bank",
  upi: "UPI",
  card: "Card",
  unknown: "Other",
};

export const PAYMENT_MODE_COLORS = {
  cash: { text: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200" },
  cheque: { text: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200" },
  account_transfer: { text: "text-sky-700", bg: "bg-sky-50", border: "border-sky-200" },
  upi: { text: "text-violet-700", bg: "bg-violet-50", border: "border-violet-200" },
  card: { text: "text-pink-700", bg: "bg-pink-50", border: "border-pink-200" },
  unknown: { text: "text-slate-600", bg: "bg-slate-50", border: "border-slate-200" },
};

// The modes a branch can actually pick when logging an expense — "unknown" is only ever
// something Income's own unlabelled rows fall back to, never a choice on a form.
export const EXPENSE_PAYMENT_MODE_OPTIONS = ["cash", "cheque", "account_transfer", "upi", "card"];

// `modes` is the raw {mode: amount} map either board's summary returns. Always renders
// Cash, Cheque, Bank and UPI — the four the branch asked for, in that fixed order, so the
// row doesn't reshuffle depending on what happened to be collected that day — then Card
// and Other only when they actually carry money, so an empty tile isn't shown for a tender
// this branch never takes.
export const orderedPaymentModeEntries = (modes) => {
  const map = modes || {};
  const primary = ["cash", "cheque", "account_transfer", "upi"];
  const rest = PAYMENT_MODE_ORDER.filter((m) => !primary.includes(m) && (map[m] || 0) > 0);
  return [...primary, ...rest].map((mode) => [mode, map[mode] || 0]);
};
