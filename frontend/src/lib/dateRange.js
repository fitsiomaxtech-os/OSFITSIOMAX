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

// Every window any of these boards offers. A board shows the subset it wants by listing
// keys — they are not all worth a pill on every screen — but it takes the words from here,
// so "This Week" means one thing across the book.
export const DATE_PRESET_LABELS = {
  all: "All",
  today: "Today",
  yesterday: "Yesterday",
  this_week: "This Week",
  this_month: "This Month",
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
  if (preset === "custom") return [from, to];
  return ["", ""];
};
