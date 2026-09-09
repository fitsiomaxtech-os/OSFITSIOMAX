import { useCallback, useEffect, useMemo, useState } from "react";
import { Banknote, BookCheck, CalendarDays, ChevronDown, ChevronRight, CreditCard, RefreshCw, Smartphone, Unlock, Wallet } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { getClosingBalanceHistory } from "@/lib/api";

const fmt = (n) => `Rs.${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Local clock, not toISOString(): east of Greenwich that converts to UTC first and hands
// back last month for the whole of the first evening of a new one.
const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

/** The first and last day of a "YYYY-MM". Day 0 of the next month is the last of this one,
 *  which is the only way to get 28, 29, 30 and 31 right without a table of them. */
const monthRange = (month) => {
  const [y, m] = (month || thisMonth()).split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}` };
};

const monthLabel = (month) => {
  const { start } = monthRange(month);
  return new Date(`${start}T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
};

const stampedAt = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

// The three a branch settles in, in the order the panel above this one counts them.
const MODES = [
  { key: "cash", label: "Cash", icon: Banknote, color: "#059669" },
  { key: "upi", label: "UPI", icon: Smartphone, color: "#7c3aed" },
  { key: "card", label: "Card", icon: CreditCard, color: "#0284c7" },
];

/** Matched, differed, or opened again — the verdict on one book, in a word. */
const Verdict = ({ book, testid }) => {
  if (!book.closed) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700" data-testid={testid}>
        <Unlock className="h-3 w-3" /> Reopened
      </span>
    );
  }
  if (book.matched) {
    return (
      <span className="text-[13px] font-semibold text-emerald-600" data-testid={testid}>Matched</span>
    );
  }
  return (
    <span className="text-[13px] font-semibold text-rose-600" data-testid={testid}>
      {book.difference > 0 ? "Over by " : "Short by "}{fmt(Math.abs(book.difference))}
    </span>
  );
};

/**
 * One closed day, and what it looked like mode by mode when it was signed.
 *
 * Folded shut by default. The row answers the question somebody scrolling a month is
 * actually asking -- did this day match, and who said so -- and the breakdown underneath
 * is what they open when the answer is no. Eight days of three-line tables would bury the
 * one day worth looking at.
 */
const BookRow = ({ book, open, onToggle }) => {
  const counted = book.counted || {};
  const expected = book.expected || {};
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <div
      className={`overflow-hidden rounded-lg border ${
        book.closed && !book.matched ? "border-rose-200" : "border-slate-200"
      }`}
      data-testid={`close-book-row-${book.on}`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 bg-slate-50/70 px-3 py-3 text-left transition-colors hover:bg-slate-100/70"
        data-testid={`close-book-toggle-${book.on}`}
      >
        <Chevron className="h-4 w-4 shrink-0 text-slate-400" />
        <span className="text-[15px] font-semibold tabular-nums text-slate-900">{book.on}</span>
        <span className="text-xs text-slate-500">
          Closed by {book.closed_by || "—"}
          {book.counted_by && book.counted_by !== book.closed_by ? ` · counted by ${book.counted_by}` : ""}
        </span>
        <span className="ml-auto flex items-center gap-4">
          {/* "Actual" is what was in the building, which is the figure a branch recognises.
              What it is set against is named "computed" rather than "expected" only in the
              breakdown, where there is room to say both. */}
          <span className="text-xs text-slate-500">
            Actual: <span className="font-semibold tabular-nums text-slate-800">{fmt(counted.total)}</span>
          </span>
          <Verdict book={book} testid={`close-book-verdict-${book.on}`} />
        </span>
      </button>

      {open && (
        <div className="border-t border-slate-100 bg-white px-3 py-3" data-testid={`close-book-detail-${book.on}`}>
          <table className="w-full text-xs">
            <thead className="text-slate-400">
              <tr>
                <th className="pb-1.5 text-left font-semibold uppercase tracking-wider">Mode</th>
                <th className="pb-1.5 text-right font-semibold uppercase tracking-wider">Actual</th>
                <th className="pb-1.5 text-right font-semibold uppercase tracking-wider">Computed</th>
                <th className="pb-1.5 text-right font-semibold uppercase tracking-wider">Difference</th>
              </tr>
            </thead>
            <tbody>
              {MODES.map((m) => {
                const actual = round2(counted[m.key]);
                const computed = round2(expected[m.key]);
                const diff = round2(actual - computed);
                const Icon = m.icon;
                return (
                  <tr key={m.key} className="border-t border-slate-50" data-testid={`close-book-mode-${book.on}-${m.key}`}>
                    <td className="py-1.5">
                      <span className="inline-flex items-center gap-1.5 font-medium text-slate-600">
                        <Icon className="h-3.5 w-3.5" style={{ color: m.color }} />
                        {m.label}
                      </span>
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-slate-700">{fmt(actual)}</td>
                    <td className="py-1.5 text-right tabular-nums text-slate-500">{fmt(computed)}</td>
                    <td className={`py-1.5 text-right font-semibold tabular-nums ${
                      Math.abs(diff) < 0.01 ? "text-slate-300" : diff > 0 ? "text-sky-600" : "text-rose-600"
                    }`}>
                      {Math.abs(diff) < 0.01 ? "—" : `${diff > 0 ? "+" : "−"}${fmt(Math.abs(diff))}`}
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t border-slate-200 font-semibold">
                <td className="py-1.5 text-slate-700">Total</td>
                <td className="py-1.5 text-right tabular-nums text-slate-800">{fmt(counted.total)}</td>
                <td className="py-1.5 text-right tabular-nums text-slate-600">{fmt(expected.total)}</td>
                <td className={`py-1.5 text-right tabular-nums ${book.matched ? "text-slate-300" : "text-rose-600"}`}>
                  {book.matched ? "—" : `${book.difference > 0 ? "+" : "−"}${fmt(Math.abs(book.difference))}`}
                </td>
              </tr>
            </tbody>
          </table>

          <div className="mt-2 space-y-0.5 border-t border-slate-100 pt-2 text-[11px] text-slate-500">
            <p data-testid={`close-book-signature-${book.on}`}>
              Signed off by {book.closed_by || "—"}{book.closed_at ? ` · ${stampedAt(book.closed_at)}` : ""}
            </p>
            {book.note ? <p className="italic">“{book.note}”</p> : null}
            {/* A day that was signed and then opened again is the one row in a month
                somebody will ask about, so the reason travels with it rather than living
                in a log nobody reads. */}
            {!book.closed && (
              <p className="text-amber-700" data-testid={`close-book-reopened-${book.on}`}>
                Reopened by {book.reopened_by || "—"}{book.reopened_at ? ` · ${stampedAt(book.reopened_at)}` : ""}
                {book.reopen_reason ? ` — “${book.reopen_reason}”` : ""}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Close Books — History: every day this branch signed its books off.
 *
 * A month at a time rather than the tab's own range, and a month picker rather than two
 * dates: books are closed one evening at a time and read back one month at a time, which
 * is how a branch is asked about them ("send me September"). The panel beside this one
 * owns the day and the range; this one owns the month.
 *
 * Nothing here is recomputed. Every figure comes off the book as it was signed -- see the
 * note above CloseBookInput in v3_finance.py -- which is the whole reason a book stores its
 * own totals: a history that recalculated them would quietly rewrite what people put their
 * names to as the underlying days changed.
 */
export const CloseBookHistoryPanel = ({ branchId }) => {
  const [month, setMonth] = useState(thisMonth());
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [openDay, setOpenDay] = useState(null);

  const { start, end } = useMemo(() => monthRange(month), [month]);

  const load = useCallback(async () => {
    if (!branchId || !month) return;
    setLoading(true);
    try {
      const data = await getClosingBalanceHistory({ branch_id: branchId, start_date: start, end_date: end });
      // Newest first: a month is read from the day it ended, not from the day it began.
      setBooks([...(data?.books || [])].sort((a, b) => (a.on < b.on ? 1 : -1)));
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not load the closed books");
      setBooks([]);
    }
    setLoading(false);
  }, [branchId, month, start, end]);

  useEffect(() => { load(); }, [load]);

  const summary = useMemo(() => {
    const closed = books.filter((b) => b.closed);
    return {
      closed: closed.length,
      matched: closed.filter((b) => b.matched).length,
      differed: closed.filter((b) => !b.matched).length,
      reopened: books.length - closed.length,
    };
  }, [books]);

  if (!branchId) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 py-12 text-center" data-testid="close-book-no-branch">
        <Wallet className="mx-auto h-8 w-8 text-slate-300" />
        <p className="mt-3 text-sm font-medium text-slate-600">Pick a branch to read its closed books</p>
        <p className="mt-1 text-xs text-slate-400">
          A book is signed off one desk at a time. Every branch keeps its own, so there is nothing to read across all of them.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="close-book-history-panel">
      {/* The page says what it is before it says what the numbers are — the same shape the
          board above this one uses for its own head. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="inline-flex items-center gap-2 font-heading text-xl font-semibold tracking-tight text-slate-900">
            <CalendarDays className="h-5 w-5 text-amber-500" aria-hidden="true" />
            Close Books — History
          </h3>
          <p className="mt-0.5 text-sm text-slate-600">
            Every day the books were closed, with actual vs computed balance per payment mode.
          </p>
        </div>
        <Button
          onClick={load}
          disabled={loading}
          title="Refresh"
          aria-label="Refresh"
          className="h-9 w-9 shrink-0 bg-slate-500 p-0 text-white hover:bg-slate-600"
          data-testid="close-book-refresh"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          {/* A month input rather than two dates: the window is always a whole month here,
              and a range picker would invite one that isn't, then have to say why it can't
              have it. */}
          <label htmlFor="close-book-month" className="sr-only">Month</label>
          <input
            id="close-book-month"
            type="month"
            value={month}
            max={thisMonth()}
            onChange={(e) => { setMonth(e.target.value || thisMonth()); setOpenDay(null); }}
            className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-[15px] text-slate-700 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400"
            data-testid="close-book-month"
          />
          {books.length > 0 && (
            <span className="text-xs text-slate-500" data-testid="close-book-summary">
              <span className="font-semibold text-slate-700">{summary.closed}</span> closed
              {summary.differed > 0 ? ` · ${summary.differed} with a difference` : summary.closed > 0 ? " · all matched" : ""}
              {summary.reopened > 0 ? ` · ${summary.reopened} reopened` : ""}
            </span>
          )}
        </div>

        <div className="mt-3 space-y-2">
          {loading ? (
            <p className="py-10 text-center text-sm text-slate-400" data-testid="close-book-loading">Loading…</p>
          ) : books.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 py-10 text-center" data-testid="close-book-empty">
              <BookCheck className="mx-auto h-7 w-7 text-slate-200" />
              <p className="mt-2 text-sm text-slate-500">No books were closed in {monthLabel(month)}.</p>
              <p className="mt-0.5 text-xs text-slate-400">
                A day appears here once it has been counted and signed off on the Closing Balance tab.
              </p>
            </div>
          ) : books.map((b) => (
            <BookRow
              key={b.on}
              book={b}
              open={openDay === b.on}
              onToggle={() => setOpenDay((d) => (d === b.on ? null : b.on))}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default CloseBookHistoryPanel;
