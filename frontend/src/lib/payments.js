/**
 * What one collection actually arrived as — the rules for reading a payment's mode.
 *
 * Lifted out of branch/AccountantManageTab.jsx so the day-end Closing Balance can read a
 * collection the same way the ledger above it does. The split rule below is the whole
 * reason these are shared rather than rewritten: a screen that reads `payment_mode`
 * directly counts a half-cash, half-UPI fee as neither, and the two screens would then
 * disagree about the same money on the same day.
 */

/**
 * The modes one collection actually arrived in.
 *
 * A fee taken half in cash and half by UPI is recorded as "split" — the right answer to
 * what the payment was, and no answer at all to what came in. A book about what came in
 * reads a split back as the modes it was made of, and never shows "Split": that is the
 * name of an arrangement, not of money, and a row wearing it tells an Accountant looking
 * for their cash nothing.
 *
 * payment_split is [] on everything else, which is nearly every row — see
 * _parse_payment_split in v3_finance.py, which reads the tenders back off the collection.
 */
export const modesOf = (tx) => {
  const split = tx?.payment_split || [];
  if (split.length > 0) return split.map((l) => l.mode).filter(Boolean);
  return tx?.payment_mode ? [tx.payment_mode] : [];
};

/** What of one collection landed under a given mode — the whole of it for an ordinary
 *  payment, and only that tender's share of a split. */
export const amountInMode = (tx, mode) => {
  const split = tx?.payment_split || [];
  if (split.length === 0) return Number(tx?.gross) || 0;
  return split.reduce((n, l) => (l.mode === mode ? n + (Number(l.amount) || 0) : n), 0);
};

/**
 * A day's collections added up under each mode they arrived in.
 *
 * Built off amountInMode above rather than by grouping on `payment_mode`, so a split lands
 * partly under each of its tenders instead of wholly under whichever one the popup opened
 * on. Modes with nothing under them are absent rather than zero, so a caller can tell "no
 * card money today" from "a card total of nothing".
 */
export const totalsByMode = (transactions = []) => {
  const out = {};
  for (const tx of transactions) {
    for (const mode of modesOf(tx)) {
      const share = amountInMode(tx, mode);
      if (share) out[mode] = (out[mode] || 0) + share;
    }
  }
  for (const k of Object.keys(out)) out[k] = Math.round(out[k] * 100) / 100;
  return out;
};
