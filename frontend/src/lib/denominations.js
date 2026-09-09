/**
 * The notes a branch holds, and what a counted pile of them comes to.
 *
 * Kept in step with DENOMINATIONS in backend/routers/v3_packages.py, which drops anything
 * it does not list when a payment settles or a drawer is counted — so a count in a note
 * this desk does not hold cannot quietly join a total.
 *
 * Lifted out of ConsultationsBoard.jsx, where it was written for counting a fee out at the
 * desk, because the day-end Closing Balance counts the same notes under the same rules. A
 * second copy of the ladder is a second thing to forget to change, and a drawer counted
 * under one and filled under another could never be made to agree.
 *
 * Goes down to the ten because money is not always round: a discount can land a fee on
 * Rs.1230, and a ladder that stopped at fifty could not count it out. Below the ten there
 * are only coins, which have no box here — a count that needs them says so in its own
 * field rather than pretending a note exists.
 */
export const DENOMINATIONS = [500, 200, 100, 50, 20, 10];

/** The last rung of the ladder. */
export const SMALLEST_NOTE = DENOMINATIONS[DENOMINATIONS.length - 1];

/**
 * What a counted pile of notes comes to.
 *
 * Blanks and anything that is not a positive whole number of notes count as none —
 * "3.5 x 500" is a typo, and reading it as 1750 would put a figure in the drawer nobody
 * counted.
 */
export const noteTotal = (notes) => DENOMINATIONS.reduce((sum, d) => {
  const n = Number(notes?.[d]);
  return sum + (Number.isInteger(n) && n > 0 ? d * n : 0);
}, 0);

/**
 * The count as it is sent and stored: only the notes actually seen, keyed by the note's
 * value as a string, because that is what survives a JSON round trip.
 *
 * Undefined when nothing was counted — an empty map would read as "counted nothing"
 * rather than "did not count", and the two are different answers.
 */
export const countedNotes = (notes) => {
  const clean = {};
  for (const d of DENOMINATIONS) {
    const n = Number(notes?.[d]);
    if (Number.isInteger(n) && n > 0) clean[String(d)] = n;
  }
  return Object.keys(clean).length ? clean : undefined;
};

/** A stored count written out for a receipt or a history line: "2xRs.500 + 1xRs.200".
 *  Empty string when nothing was counted, so callers can drop the row entirely. */
export const notesLabel = (counted) => DENOMINATIONS
  .filter((d) => Number(counted?.[d]) > 0)
  .map((d) => `${counted[d]}xRs.${d}`)
  .join(" + ");

/**
 * The fewest notes that make an amount, for the button that fills a grid in.
 *
 * A remainder below the smallest note is left over rather than rounded away — the count
 * then reads short, which is the truth, instead of claiming notes nobody held.
 */
export const noteBreakdown = (amount) => {
  let left = Math.round(Number(amount) || 0);
  const out = {};
  for (const d of DENOMINATIONS) {
    const n = Math.floor(left / d);
    if (n > 0) { out[d] = n; left -= n * d; }
  }
  return out;
};
