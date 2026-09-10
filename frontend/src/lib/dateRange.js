// The one-tap windows the finance boards narrow by, and the [start, end] each of them
// asks the endpoints for.
//
// This logic was written twice before it was written here — once in ExpenseBoard and once
// in AccountantManageTab, in the same words, down to the comment explaining why the week
// starts on Sunday. Approvals needed it too, and a third copy is how two pages of one book
// come to disagree about where a week begins: a difference nobody can see and everybody
// has to explain. Those two still carry their own; this is where the next one comes from,
// and where they can move when whoever is in them next has reason to touch them.

// Built off the local clock rather than toISOString(), which converts to UTC first: east
// of Greenwich that hands back yesterday's date for the whole of the early evening — so
// Today would have filtered to yesterday every evening.
export const toIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const todayIso = () => toIso(new Date());
export const fromIso = (iso) => new Date(`${iso}T00:00:00`);
export const shiftDays = (iso, n) => { const d = fromIso(iso); d.setDate(d.getDate() + n); return toIso(d); };

// Sunday-start, the same week Accountant Manage and Expense already count.
export const startOfWeek = (iso) => { const d = fromIso(iso); d.setDate(d.getDate() - d.getDay()); return toIso(d); };
export const startOfMonth = (iso) => { const d = fromIso(iso); return toIso(new Date(d.getFullYear(), d.getMonth(), 1)); };
export const startOfPrevMonth = (iso) => { const d = fromIso(iso); return toIso(new Date(d.getFullYear(), d.getMonth() - 1, 1)); };
// Day 0 of this month is the last day of the one before it, which is also how February and
// every year boundary are got right without saying how long a month is.
export const endOfPrevMonth = (iso) => { const d = fromIso(iso); return toIso(new Date(d.getFullYear(), d.getMonth(), 0)); };

// Every window any of these boards offers. A board shows the subset it wants by listing
// keys — they are not all worth a pill on every screen — but it takes the words from here,
// so "This Week" means one thing across the book.
//
// "Custom Range" rather than "Custom": the button opens a dialog asking for two dates, and
// naming the thing it collects reads better on a row where every other button names a
// window. It is one word longer and the row it sits on has the width for it.
export const DATE_PRESET_LABELS = {
  all: "All",
  today: "Today",
  yesterday: "Yesterday",
  this_week: "This Week",
  last_month: "Last Month",
  this_month: "This Month",
  custom: "Custom Range",
};

// The phone labels. Seven full ones cannot share a phone's width, and the alternatives are
// all worse: truncating gives "Last Mo…", wrapping costs a row, hiding the last two off the
// edge hides the two people reach for least often but still reach for. Nothing downstream
// ever sees these — the state carries the key, and the chip and captions read DATE_PRESET_LABELS.
export const DATE_PRESET_SHORT = {
  all: "All",
  today: "Today",
  yesterday: "Yest",
  this_week: "Week",
  last_month: "Last Mo",
  this_month: "This Mo",
  custom: "Custom",
};

/**
 * The window a preset asks for, as the [start, end] the endpoints take. Both ends
 * inclusive, and both empty for "All" — which is the endpoint's own "no date filter"
 * rather than a very wide range, so a board can tell the two apart.
 *
 * A half-typed custom range comes back half-empty on purpose. The caller is the one that
 * knows whether to wait for the second date or send what it has; deciding here would make
 * every board live with the same answer.
 */
export const rangeFor = (preset, from = "", to = "") => {
  const today = todayIso();
  if (preset === "today") return [today, today];
  if (preset === "yesterday") { const d = shiftDays(today, -1); return [d, d]; }
  if (preset === "this_week") return [startOfWeek(today), today];
  if (preset === "this_month") return [startOfMonth(today), today];
  // The one closed period here, so it runs the whole month, first to last. This Week and
  // This Month run only to today — a month so far, not a window into the future — which is
  // why Last Month is the only one of the three with an end date that is not today.
  if (preset === "last_month") return [startOfPrevMonth(today), endOfPrevMonth(today)];
  if (preset === "custom") return [from, to];
  return ["", ""];
};

/** True while Custom is lit but only half answered. That is the moment a board must not
 *  ask the endpoint for everything from one date to nothing, which reads on screen as a
 *  filter that stopped working — every board here waits for the second date. */
export const rangeIncomplete = (preset, from, to) => preset === "custom" && (!from || !to);
