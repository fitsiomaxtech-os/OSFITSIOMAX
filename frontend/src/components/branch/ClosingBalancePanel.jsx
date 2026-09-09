import { useCallback, useEffect, useMemo, useState } from "react";
import { Banknote, CalendarDays, CreditCard, Smartphone, RefreshCw, Save, TrendingDown, TrendingUp, Check, AlertTriangle, Wallet, X, CalendarClock } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { maskDayMonthYear, manualToIso, isoToManual } from "@/components/DateFilterPopover";
import { getClosingBalance, getClosingBalanceHistory, saveClosingBalance, getRevenueOverview, getFinanceExpenses } from "@/lib/api";
import { DENOMINATIONS, noteTotal, countedNotes, noteBreakdown } from "@/lib/denominations";
import { totalsByMode } from "@/lib/payments";

const fmt = (n) => `Rs.${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Built off the local clock rather than toISOString(), which converts to UTC first: east
// of Greenwich that hands back yesterday's date for the whole of the early evening, and a
// branch closing at 8pm would be shown counting the wrong day.
const toIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayIso = () => toIso(new Date());
const fromIso = (iso) => new Date(`${iso}T00:00:00`);
const shiftDays = (iso, n) => { const d = fromIso(iso); d.setDate(d.getDate() + n); return toIso(d); };

// Sunday-start, the same week Accountant Manage's own This Week preset counts — two
// screens on one page disagreeing about where a week begins is a difference nobody can
// see and everybody has to explain.
const startOfWeek = (iso) => { const d = fromIso(iso); d.setDate(d.getDate() - d.getDay()); return toIso(d); };
const endOfWeek = (iso) => shiftDays(startOfWeek(iso), 6);
const startOfMonth = (iso) => { const d = fromIso(iso); return toIso(new Date(d.getFullYear(), d.getMonth(), 1)); };
const endOfMonth = (iso) => { const d = fromIso(iso); return toIso(new Date(d.getFullYear(), d.getMonth() + 1, 0)); };

/** Every date from `start` to `end`, oldest first. Both ends are inclusive: a range that
 *  quietly dropped its last day would report a month as counted while the 31st sat
 *  uncounted and invisible. */
const daysBetween = (start, end) => {
  const out = [];
  for (let d = start; d <= end && out.length < 400; d = shiftDays(d, 1)) out.push(d);
  return out;
};

const dayLabel = (iso) => {
  const d = fromIso(iso);
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" });
};

/**
 * How far back the tab is reading, and the shape of the answer it gets.
 *
 * Daily is one evening's count — the form. The other three are the same evenings read
 * back: a closing balance is a per-day fact whatever window is asked for, so Weekly and
 * Monthly list the days rather than adding them into one figure. A week's drawer is not
 * seven drawers' worth of money; it is the same drawer, seven times.
 */
const PERIODS = [
  { key: "day", label: "Daily" },
  { key: "week", label: "Weekly" },
  { key: "month", label: "Monthly" },
  { key: "custom", label: "Custom" },
];

/**
 * The three ways a branch settles, and the one thing each is checked by.
 *
 * They are not interchangeable fields with a mode label on top. Cash is evidenced by the
 * notes themselves, UPI by the id the money arrived on, and a card batch by the number the
 * terminal printed — each is what a dispute over that money is actually traced by, and
 * asking for the wrong one gets an invented answer typed in to get past the form.
 */
const MODES = [
  { key: "cash", label: "Cash", icon: Banknote, color: "#059669" },
  { key: "upi", label: "UPI", icon: Smartphone, color: "#7c3aed" },
  { key: "card", label: "Card", icon: CreditCard, color: "#0284c7" },
];

/** A figure with its name, for the strips at the top of both views. */
const Figure = ({ label, value, sub, icon: Icon, color, testid }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-testid={testid}>
    <div className="flex items-center gap-2">
      {Icon && <Icon className="h-3.5 w-3.5" style={{ color }} />}
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
    </div>
    <p className="mt-1.5 text-2xl font-bold tabular-nums" style={{ color }}>{value}</p>
    {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
  </div>
);

/**
 * Counted against expected, said in one line.
 *
 * Zero is its own state rather than a small difference: "balanced" is the answer a desk is
 * looking for, and a green Rs.0 beside two red figures is harder to read than the word.
 */
const Variance = ({ counted, expected, testid }) => {
  const diff = round2(counted - expected);
  if (Math.abs(diff) < 0.01) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700" data-testid={testid}>
        <Check className="h-3 w-3" /> Balanced
      </span>
    );
  }
  const over = diff > 0;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold ${over ? "bg-sky-50 text-sky-700" : "bg-rose-50 text-rose-700"}`}
      data-testid={testid}
    >
      {over ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {over ? "Over by " : "Short by "}{fmt(Math.abs(diff))}
    </span>
  );
};

/**
 * A day's collections and spending, split by the mode each arrived or left in.
 *
 * The two are read differently because they are stored differently: a collection carries
 * its date on a timestamp and can be a split across two tenders, an expense carries a
 * plain date and one mode. totalsByMode owns the first rule so the day form and the
 * history can never disagree about what a half-cash fee did to the drawer.
 */
const incomeByDayFrom = (transactions) => {
  const grouped = {};
  for (const tx of transactions) {
    const day = (tx?.date || "").slice(0, 10);
    if (!day) continue;
    (grouped[day] = grouped[day] || []).push(tx);
  }
  const out = {};
  for (const [day, rows] of Object.entries(grouped)) out[day] = totalsByMode(rows);
  return out;
};

const expenseByDayFrom = (expenses) => {
  const out = {};
  for (const row of expenses) {
    const day = row?.expense_date || "";
    if (!day) continue;
    const mode = row?.payment_mode || "unknown";
    out[day] = out[day] || {};
    out[day][mode] = round2((out[day][mode] || 0) + (Number(row.amount) || 0));
  }
  return out;
};

/**
 * What each mode should come to on one day.
 *
 * Cash is the only one that carries over, because it is the only one that physically stays
 * in the building: the drawer opens on what last night's count left in it, takes the day's
 * cash, and pays out whatever was spent in cash. UPI and a card batch settle to a bank and
 * start each morning at nothing, so yesterday's figure is history for them rather than an
 * opening balance.
 *
 * @param carriedCash  Last night's counted cash. Zero when the evening before was never
 *                     counted — the same answer the day form gives, so a day read here
 *                     and the same day read there show the same expected figure.
 */
const expectedFor = (carriedCash, income = {}, expense = {}) => ({
  cash: round2((carriedCash || 0) + (income.cash || 0) - (expense.cash || 0)),
  upi: round2((income.upi || 0) - (expense.upi || 0)),
  card: round2((income.card || 0) - (expense.card || 0)),
});

const sumModes = (m) => round2((m.cash || 0) + (m.upi || 0) + (m.card || 0));
const sumAll = (m = {}) => round2(Object.values(m).reduce((a, b) => a + (Number(b) || 0), 0));

/**
 * One evening counted — the form, and the three figures the count is judged against.
 *
 * Its own component rather than the whole panel because the tab now reads back as well as
 * records: everything here is about a single named day, and the week and month views below
 * share nothing with it but the branch.
 */
const DayCount = ({ branchId, day, refreshKey, onBusy }) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [yesterday, setYesterday] = useState(null);
  const [saved, setSaved] = useState(null);
  const [income, setIncome] = useState({});
  const [expense, setExpense] = useState({});
  // The form: the notes counted, the coins under them, and each cashless mode's amount
  // with the reference it is traced by.
  const [notes, setNotes] = useState({});
  const [coins, setCoins] = useState("");
  const [upiAmount, setUpiAmount] = useState("");
  const [upiId, setUpiId] = useState("");
  const [cardAmount, setCardAmount] = useState("");
  const [cardRef, setCardRef] = useState("");
  const [note, setNote] = useState("");

  /** Put the form back to what is stored for this day, or to blank when nothing is. */
  const fillFrom = useCallback((record) => {
    setNotes(record?.cash_denominations || {});
    setCoins(record?.cash_coins ? String(record.cash_coins) : "");
    setUpiAmount(record?.upi_amount ? String(record.upi_amount) : "");
    setUpiId(record?.upi_id || "");
    setCardAmount(record?.card_amount ? String(record.card_amount) : "");
    setCardRef(record?.card_transaction_id || "");
    setNote(record?.note || "");
  }, []);

  const load = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    onBusy?.(true);
    try {
      // The stored count, and the day's own takings and spending. Asked for together
      // because the screen is the three set against each other — showing the count before
      // the figures it is judged by would flash a shortfall that is only a slow request.
      const [cb, rev, exp] = await Promise.all([
        getClosingBalance({ branch_id: branchId, on: day }),
        getRevenueOverview({ branch_id: branchId, start_date: day, end_date: day }),
        getFinanceExpenses({ branch_id: branchId, start_date: day, end_date: day }),
      ]);
      setYesterday(cb?.yesterday || null);
      setSaved(cb?.today || null);
      fillFrom(cb?.today);
      setIncome(totalsByMode(rev?.transactions || []));
      setExpense(exp?.payment_modes || {});
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not load the closing balance");
    }
    setLoading(false);
    onBusy?.(false);
    // refreshKey is a dependency on purpose: it is how the toolbar's Refresh reaches in
    // here without this component owning a button of its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, day, fillFrom, refreshKey]);

  useEffect(() => { load(); }, [load]);

  // Hands the toolbar's spinner back if this view is swapped out mid-fetch. Without it,
  // changing period during a load leaves Refresh spinning on a request nobody is waiting
  // for and the button disabled for the rest of the session.
  useEffect(() => () => onBusy?.(false), []); // eslint-disable-line react-hooks/exhaustive-deps

  const cashNotesTotal = useMemo(() => noteTotal(notes), [notes]);
  const cashCounted = round2(cashNotesTotal + (parseFloat(coins) || 0));
  const upiCounted = round2(parseFloat(upiAmount) || 0);
  const cardCounted = round2(parseFloat(cardAmount) || 0);
  const totalCounted = round2(cashCounted + upiCounted + cardCounted);

  const expected = useMemo(
    () => expectedFor(yesterday?.cash_total || 0, income, expense),
    [yesterday, income, expense],
  );
  const totalExpected = sumModes(expected);

  const counted = { cash: cashCounted, upi: upiCounted, card: cardCounted };

  const dayIncome = useMemo(() => sumAll(income), [income]);
  const dayExpense = useMemo(() => sumAll(expense), [expense]);

  const setNote_ = (d, v) => setNotes((n) => ({ ...n, [d]: v }));

  // Refused here as well as on the server, so the desk is told before the request goes out
  // rather than after it comes back — the same rule the fee popups follow.
  const missingUpiId = upiCounted > 0 && !upiId.trim();
  const missingCardRef = cardCounted > 0 && !cardRef.trim();

  const submit = async () => {
    if (missingUpiId) { toast.error("UPI ID is required for the UPI amount counted"); return; }
    if (missingCardRef) { toast.error("Card Transaction ID is required for the card amount counted"); return; }
    setSaving(true);
    let res;
    try {
      res = await saveClosingBalance({
        on: day,
        branch_id: branchId,
        cash_denominations: countedNotes(notes) || {},
        cash_coins: parseFloat(coins) || 0,
        upi_amount: upiCounted,
        upi_id: upiId.trim(),
        card_amount: cardCounted,
        card_transaction_id: cardRef.trim(),
        note: note.trim(),
      });
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not save the closing balance");
      setSaving(false);
      return;
    }
    setSaving(false);
    toast.success(res?.message || "Closing balance saved");
    setSaved(res?.closing_balance || null);
  };

  return (
    <div className="space-y-4" data-testid="closing-balance-day">
      {saved && (
        <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 py-1.5 text-[11px] font-medium text-emerald-700" data-testid="closing-balance-saved-chip">
          <Check className="h-3.5 w-3.5" />
          Counted by {saved.counted_by || "—"}
          {saved.updated_by && saved.updated_by !== saved.counted_by ? ` · last corrected by ${saved.updated_by}` : ""}
        </span>
      )}

      {/* The three figures the count is judged against, in the order the day runs:
          what was left last night, what came in, what went out. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Figure
          label="Yesterday's close"
          value={fmt(yesterday?.total || 0)}
          sub={yesterday ? `Cash ${fmt(yesterday.cash_total)} · counted by ${yesterday.counted_by || "—"}` : "No count recorded for the day before"}
          icon={Wallet}
          color="#475569"
          testid="closing-balance-yesterday"
        />
        <Figure
          label="Today's income"
          value={fmt(dayIncome)}
          sub={`Cash ${fmt(income.cash || 0)} · UPI ${fmt(income.upi || 0)} · Card ${fmt(income.card || 0)}`}
          icon={TrendingUp}
          color="#059669"
          testid="closing-balance-income"
        />
        <Figure
          label="Today's expense"
          value={fmt(dayExpense)}
          sub={`Cash ${fmt(expense.cash || 0)} · UPI ${fmt(expense.upi || 0)} · Card ${fmt(expense.card || 0)}`}
          icon={TrendingDown}
          color="#e11d48"
          testid="closing-balance-expense"
        />
      </div>

      {/* One block per mode. Each asks for its own amount and the one reference that
          makes it checkable. */}
      <div className="grid gap-3 lg:grid-cols-3">
        {MODES.map((m) => {
          const Icon = m.icon;
          return (
            <div key={m.key} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-testid={`closing-balance-block-${m.key}`}>
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <Icon className="h-4 w-4" style={{ color: m.color }} />
                  {m.label}
                </span>
                <Variance counted={counted[m.key]} expected={expected[m.key]} testid={`closing-balance-variance-${m.key}`} />
              </div>
              <p className="mt-1 text-[11px] text-slate-400">
                Expected {fmt(expected[m.key])}
                {m.key === "cash" ? " — yesterday's cash, plus today's, less what was paid out in cash" : " — today's takings, less what was refunded or paid by it"}
              </p>

              {m.key === "cash" ? (
                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Denominations</p>
                    {/* Fills the grid with the fewest notes that make the expected figure.
                        A starting point for a desk that has already counted and agrees,
                        never a substitute for counting: it is only ever what *should* be
                        there, which is the number being checked. */}
                    <button
                      type="button"
                      onClick={() => setNotes(noteBreakdown(Math.max(0, expected.cash)))}
                      className="text-[11px] font-medium text-sky-600 hover:text-sky-700"
                      data-testid="closing-balance-fill-notes"
                    >
                      Fill to expected
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {DENOMINATIONS.map((d) => (
                      <label key={d} className="block">
                        <span className="mb-0.5 block text-[10px] font-medium text-slate-400">Rs.{d}</span>
                        <Input
                          type="number"
                          min="0"
                          value={notes[d] ?? ""}
                          onChange={(e) => setNote_(d, e.target.value)}
                          className="h-9 text-sm tabular-nums"
                          data-testid={`closing-balance-note-${d}`}
                        />
                      </label>
                    ))}
                  </div>
                  <label className="block">
                    {/* Its own box because the note ladder stops at ten and a drawer does
                        not — without it a till holding Rs.7 of change could never balance. */}
                    <span className="mb-0.5 block text-[10px] font-medium text-slate-400">Coins and change (Rs.)</span>
                    <Input
                      type="number"
                      min="0"
                      value={coins}
                      onChange={(e) => setCoins(e.target.value)}
                      className="h-9 text-sm tabular-nums"
                      data-testid="closing-balance-coins"
                    />
                  </label>
                  <div className="flex items-center justify-between border-t border-slate-100 pt-2">
                    <span className="text-[11px] text-slate-500">Notes {fmt(cashNotesTotal)}</span>
                    <span className="text-sm font-bold tabular-nums text-slate-800">{fmt(cashCounted)}</span>
                  </div>
                </div>
              ) : (
                <div className="mt-3 space-y-2">
                  <label className="block">
                    <span className="mb-0.5 block text-[10px] font-medium text-slate-400">Amount counted (Rs.)</span>
                    <Input
                      type="number"
                      min="0"
                      value={m.key === "upi" ? upiAmount : cardAmount}
                      onChange={(e) => (m.key === "upi" ? setUpiAmount : setCardAmount)(e.target.value)}
                      className="h-9 text-sm tabular-nums"
                      data-testid={`closing-balance-amount-${m.key}`}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-0.5 block text-[10px] font-medium text-slate-400">
                      {m.key === "upi" ? "UPI ID" : "Card Transaction ID"}
                    </span>
                    <Input
                      value={m.key === "upi" ? upiId : cardRef}
                      onChange={(e) => (m.key === "upi" ? setUpiId : setCardRef)(e.target.value)}
                      placeholder={m.key === "upi" ? "name@bank" : "Terminal batch / txn no."}
                      className="h-9 text-sm"
                      data-testid={`closing-balance-ref-${m.key}`}
                    />
                    {((m.key === "upi" && missingUpiId) || (m.key === "card" && missingCardRef)) && (
                      <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-rose-600" data-testid={`closing-balance-ref-missing-${m.key}`}>
                        <AlertTriangle className="h-3 w-3" />
                        Required once there is money to trace
                      </span>
                    )}
                  </label>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* The whole day in one line, and the way to commit it. */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Total counted</p>
            <p className="mt-1 text-3xl font-bold tabular-nums text-slate-800" data-testid="closing-balance-total-counted">{fmt(totalCounted)}</p>
            <p className="mt-0.5 text-[11px] text-slate-400">Expected {fmt(totalExpected)}</p>
          </div>
          <div className="pb-1.5">
            <Variance counted={totalCounted} expected={totalExpected} testid="closing-balance-variance-total" />
          </div>
          <label className="min-w-[12rem] flex-1">
            <span className="mb-0.5 block text-[10px] font-medium text-slate-400">Note (what explains a difference)</span>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Banked Rs.10,000 at 6pm"
              className="h-9 text-sm"
              data-testid="closing-balance-note"
            />
          </label>
          <Button
            onClick={submit}
            disabled={saving || loading}
            className="h-9 shrink-0 bg-emerald-600 text-xs hover:bg-emerald-700"
            data-testid="closing-balance-save"
          >
            <Save className="mr-1.5 h-4 w-4" />
            {saving ? "Saving..." : saved ? "Update count" : "Record closing balance"}
          </Button>
        </div>
        {/* Said plainly rather than left for a branch to find out by trying: this is a
            record that can be corrected, not a door that locks behind them. */}
        <p className="mt-3 border-t border-slate-100 pt-2 text-[11px] text-slate-400">
          A count can be corrected by counting again — saving this day a second time replaces it and keeps who first counted it.
        </p>
      </div>
    </div>
  );
};

/**
 * The evenings in a window, counted or not, each against what its own day says it took.
 *
 * A day at a time, never added into one total. Cash carries from one night to the next, so
 * a month's "total counted" would be the same drawer counted thirty times over — a figure
 * ten times the money that was ever in the building. What a range *can* be totalled on is
 * income, expense, and the daily differences, because each of those belongs to its own day
 * and to no other.
 *
 * The uncounted evenings are listed as loudly as the counted ones. A history that showed
 * only what was recorded would read as a clean month on a branch that counted twice.
 */
const ClosingBalanceHistory = ({ branchId, start, end, refreshKey, onBusy, onOpenDay }) => {
  const [history, setHistory] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!branchId || !start || !end) return;
    setLoading(true);
    onBusy?.(true);
    try {
      // The counts, and the live figures they are judged against — asked for over the
      // whole window in one request each rather than a day at a time, which on a month
      // would be ninety requests to fill one table.
      const [hist, rev, exp] = await Promise.all([
        getClosingBalanceHistory({ branch_id: branchId, start_date: start, end_date: end }),
        getRevenueOverview({ branch_id: branchId, start_date: start, end_date: end }),
        getFinanceExpenses({ branch_id: branchId, start_date: start, end_date: end }),
      ]);
      setHistory(hist);
      setTransactions(rev?.transactions || []);
      setExpenses(exp?.expenses || []);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not load the closing balances");
      setHistory(null);
      setTransactions([]);
      setExpenses([]);
    }
    setLoading(false);
    onBusy?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, start, end, refreshKey]);

  useEffect(() => { load(); }, [load]);

  // Hands the toolbar's spinner back if this view is swapped out mid-fetch. Without it,
  // changing period during a load leaves Refresh spinning on a request nobody is waiting
  // for and the button disabled for the rest of the session.
  useEffect(() => () => onBusy?.(false), []); // eslint-disable-line react-hooks/exhaustive-deps

  const incomeByDay = useMemo(() => incomeByDayFrom(transactions), [transactions]);
  const expenseByDay = useMemo(() => expenseByDayFrom(expenses), [expenses]);

  // The counts, keyed by their evening. `opening` joins them under its own date so the
  // first day of the window carries in from the night before it exactly as every other day
  // does — a window opening on the 1st should not report the branch as starting empty.
  const countByDay = useMemo(() => {
    const out = {};
    if (history?.opening) out[history.opening.on] = history.opening;
    for (const r of history?.records || []) out[r.on] = r;
    return out;
  }, [history]);

  const rows = useMemo(() => {
    // Never past today. A month range runs to the 30th from the 9th, and twenty-one
    // evenings that have not happened yet listed as "not counted" is a backlog invented
    // by a date picker.
    const last = end > todayIso() ? todayIso() : end;
    return daysBetween(start, last).map((on) => {
      const record = countByDay[on] || null;
      const income = incomeByDay[on] || {};
      const expense = expenseByDay[on] || {};
      const expected = expectedFor(countByDay[shiftDays(on, -1)]?.cash_total || 0, income, expense);
      return {
        on,
        record,
        income,
        expense,
        expected,
        totalExpected: sumModes(expected),
        counted: record?.total || 0,
        dayIncome: sumAll(income),
        dayExpense: sumAll(expense),
      };
    }).reverse(); // newest first: the evening somebody is chasing is the most recent one
  }, [start, end, countByDay, incomeByDay, expenseByDay]);

  const summary = useMemo(() => {
    const done = rows.filter((r) => r.record);
    return {
      days: rows.length,
      counted: done.length,
      income: round2(rows.reduce((n, r) => n + r.dayIncome, 0)),
      expense: round2(rows.reduce((n, r) => n + r.dayExpense, 0)),
      // Summed only over the evenings actually counted. A night nobody counted has no
      // difference — it has no count — and folding its expected figure in as a shortfall
      // would blame a branch for a missing form rather than for missing money.
      variance: round2(done.reduce((n, r) => n + (r.counted - r.totalExpected), 0)),
      latest: done.length ? done[0] : null,
    };
  }, [rows]);

  if (loading && !history) {
    return <p className="py-12 text-center text-sm text-slate-400" data-testid="closing-balance-history-loading">Loading…</p>;
  }

  return (
    <div className="space-y-4" data-testid="closing-balance-history">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Figure
          label="Evenings counted"
          value={`${summary.counted} of ${summary.days}`}
          sub={summary.counted === summary.days
            ? "Every evening in this range was counted"
            : `${summary.days - summary.counted} not counted — listed below`}
          icon={CalendarClock}
          color={summary.counted === summary.days ? "#059669" : "#d97706"}
          testid="closing-balance-history-counted-days"
        />
        <Figure
          label="Income in range"
          value={fmt(summary.income)}
          sub="Every collection taken in these days"
          icon={TrendingUp}
          color="#059669"
          testid="closing-balance-history-income"
        />
        <Figure
          label="Expense in range"
          value={fmt(summary.expense)}
          sub="Everything paid out in these days"
          icon={TrendingDown}
          color="#e11d48"
          testid="closing-balance-history-expense"
        />
        <Figure
          label="Net difference"
          value={fmt(summary.variance)}
          sub={summary.counted
            ? `Across the ${summary.counted} evening${summary.counted === 1 ? "" : "s"} counted`
            : "Nothing counted in this range yet"}
          icon={Wallet}
          color={Math.abs(summary.variance) < 0.01 ? "#475569" : summary.variance > 0 ? "#0284c7" : "#e11d48"}
          testid="closing-balance-history-variance"
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        {/* Fixed proportions rather than auto widths, the same reason the expenses table
            pins its own: left to itself the browser hands a wide screen's slack to
            whichever row holds the longest note, and the dates stop lining up. */}
        <table className="w-full min-w-[980px] table-fixed text-xs">
          <colgroup>
            <col className="w-[13%]" />
            <col className="w-[10%]" />
            <col className="w-[10%]" />
            <col className="w-[10%]" />
            <col className="w-[11%]" />
            <col className="w-[11%]" />
            <col className="w-[14%]" />
            <col className="w-[21%]" />
          </colgroup>
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Evening</th>
              <th className="px-3 py-2 text-right font-semibold uppercase tracking-wider">Cash</th>
              <th className="px-3 py-2 text-right font-semibold uppercase tracking-wider">UPI</th>
              <th className="px-3 py-2 text-right font-semibold uppercase tracking-wider">Card</th>
              <th className="px-3 py-2 text-right font-semibold uppercase tracking-wider">Counted</th>
              <th className="px-3 py-2 text-right font-semibold uppercase tracking-wider">Expected</th>
              <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Difference</th>
              <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Counted by</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-slate-400" data-testid="closing-balance-history-empty">
                  No days in this range yet.
                </td>
              </tr>
            ) : rows.map((r) => (
              <tr
                key={r.on}
                className={`border-t border-slate-100 align-top ${r.record ? "" : "bg-slate-50/60"}`}
                data-testid={`closing-balance-history-row-${r.on}`}
              >
                <td className="px-3 py-2.5">
                  {/* The date opens that evening's own count sheet. A month view whose
                      rows could not be opened would leave a branch reading a gap it has no
                      way to fill from where it is standing. */}
                  <button
                    type="button"
                    onClick={() => onOpenDay(r.on)}
                    className="font-medium text-slate-700 hover:text-sky-600 hover:underline"
                    data-testid={`closing-balance-history-open-${r.on}`}
                  >
                    {dayLabel(r.on)}
                  </button>
                  {r.record?.note ? (
                    <span className="mt-0.5 block text-[10px] font-normal text-slate-400">{r.record.note}</span>
                  ) : null}
                </td>
                {r.record ? (
                  <>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{fmt(r.record.cash_total)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{fmt(r.record.upi_amount)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{fmt(r.record.card_amount)}</td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-800">{fmt(r.counted)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{fmt(r.totalExpected)}</td>
                    <td className="px-3 py-2.5">
                      <Variance counted={r.counted} expected={r.totalExpected} testid={`closing-balance-history-variance-${r.on}`} />
                    </td>
                    <td className="break-words px-3 py-2.5 text-slate-500">
                      {r.record.counted_by || "—"}
                      {r.record.updated_by && r.record.updated_by !== r.record.counted_by ? (
                        <span className="block text-[10px] text-slate-400">corrected by {r.record.updated_by}</span>
                      ) : null}
                    </td>
                  </>
                ) : (
                  <>
                    {/* An evening nobody counted has no figures of its own, so the row says
                        so once rather than printing five zeroes that read as a day the
                        branch took nothing. What the day *should* have held is still shown,
                        because that is the number whoever counts it late will be working
                        to. */}
                    <td className="px-3 py-2.5 text-slate-400" colSpan={4}>
                      Not counted
                      {/* A day nothing moved on is a different silence from a busy day
                          nobody counted, and reading a month a branch is chasing, that is
                          the difference between a gap and a problem. */}
                      {r.dayIncome === 0 && r.dayExpense === 0 ? (
                        <span className="text-slate-300"> · nothing taken or paid out</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{fmt(r.totalExpected)}</td>
                    <td className="px-3 py-2.5" colSpan={2}>
                      <button
                        type="button"
                        onClick={() => onOpenDay(r.on)}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:border-emerald-300 hover:text-emerald-700"
                        data-testid={`closing-balance-history-count-${r.on}`}
                      >
                        <Save className="h-3 w-3" /> Count this evening
                      </button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-slate-400">
        A range lists its evenings rather than adding them up: cash carries from one night into the next, so a month
        of counts summed together would be the same drawer counted thirty times.
      </p>
    </div>
  );
};

/**
 * Closing Balance — what the desk holds when it shuts, against what the day says it took.
 *
 * One branch, and either one evening or a run of them. The period is this panel's own
 * control rather than the tab's range above it, because the two ask different questions of
 * the same figures: the tab narrows a ledger, this narrows a set of counts, and a single
 * count still belongs to a single named evening whatever window is on screen. Daily is the
 * form; Weekly, Monthly and Custom read the evenings back.
 *
 * `expected` is worked out here rather than stored on the record — see the note above
 * save_closing_balance in v3_finance.py.
 *
 * @param branchId  The branch whose drawer this is. Required — "All Branches" has no
 *                  drawer to count, and the panel says so rather than adding four
 *                  branches' cash into one meaningless total.
 */
export const ClosingBalancePanel = ({ branchId }) => {
  const [period, setPeriod] = useState("day");
  // The day being counted, and the day the week and month are read around. One control
  // rather than three: picking the 9th and switching to Monthly asks about September,
  // which is the same question a second date picker would have had to be told twice.
  const [day, setDay] = useState(todayIso());
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  // Typed in a dialog rather than picked inline, the same way Accountant Manage's own
  // custom range is: two calendar fields in a toolbar each open a month grid over the
  // figures behind them, and a range is quicker typed than navigated to twice.
  const [showCustom, setShowCustom] = useState(false);
  const [fromText, setFromText] = useState("");
  const [toText, setToText] = useState("");
  // Where to fall back to if the dialog is dismissed with nothing set — leaving the panel
  // on Custom with no range would show a filter that filters nothing.
  const [periodBeforeCustom, setPeriodBeforeCustom] = useState("day");
  const [refreshKey, setRefreshKey] = useState(0);
  const [busy, setBusy] = useState(false);

  const { start, end } = useMemo(() => {
    if (period === "week") return { start: startOfWeek(day), end: endOfWeek(day) };
    if (period === "month") return { start: startOfMonth(day), end: endOfMonth(day) };
    if (period === "custom") return { start: customFrom, end: customTo };
    return { start: day, end: day };
  }, [period, day, customFrom, customTo]);

  const openCustom = () => {
    if (period !== "custom") setPeriodBeforeCustom(period);
    setFromText(isoToManual(customFrom));
    setToText(isoToManual(customTo));
    setShowCustom(true);
  };

  const customFromIso = manualToIso(fromText);
  const customToIso = manualToIso(toText);
  // Both must parse and be the right way round — a reversed range comes back empty and
  // reads as a month nobody counted rather than as a mistake in the dialog.
  const rangeValid = !!customFromIso && !!customToIso && customFromIso <= customToIso;

  const applyCustom = () => {
    if (!rangeValid) return;
    setCustomFrom(customFromIso);
    setCustomTo(customToIso);
    setPeriod("custom");
    setShowCustom(false);
  };

  const dismissCustom = () => {
    setShowCustom(false);
    if (!customFrom || !customTo) setPeriod(periodBeforeCustom);
  };

  /** A row in the history opening its own evening: the window becomes that one day, which
   *  is the only window a count can be recorded in. */
  const openDay = (on) => { setDay(on); setPeriod("day"); };

  if (!branchId) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 py-12 text-center" data-testid="closing-balance-no-branch">
        <Wallet className="mx-auto h-8 w-8 text-slate-300" />
        <p className="mt-3 text-sm font-medium text-slate-600">Pick a branch to close its day</p>
        <p className="mt-1 text-xs text-slate-400">
          A closing balance is one drawer counted at one desk. Every branch has its own, so there is nothing to count across all of them.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="closing-balance-panel">
      {/* One row, read left to right: how far back, which day it is anchored on, and what
          that comes to as a range. The date keeps its own control in every period because
          it is what the window is built from — defaulted to today, since a branch counting
          up after midnight is closing yesterday and needs to be able to say so. */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm">
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5" data-testid="closing-balance-periods">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => (p.key === "custom" ? openCustom() : setPeriod(p.key))}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                period === p.key ? "bg-emerald-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"
              }`}
              data-testid={`closing-balance-period-${p.key}`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {period !== "custom" && (
          <div className="flex items-center gap-2 pl-1">
            <label htmlFor="closing-balance-date" className="text-xs font-medium text-slate-600">
              {period === "day" ? "Closing day:" : period === "week" ? "Week of:" : "Month of:"}
            </label>
            <Input
              id="closing-balance-date"
              type="date"
              value={day}
              max={todayIso()}
              onChange={(e) => setDay(e.target.value || todayIso())}
              className="h-9 w-40"
              data-testid="closing-balance-date"
            />
          </div>
        )}

        {/* The window actually in force. On Daily it would only repeat the date box beside
            it, so it is shown for the three periods that resolve to something the picker
            does not already say. */}
        {period !== "day" && start && end && (
          <button
            type="button"
            onClick={period === "custom" ? openCustom : undefined}
            className={`flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 ${
              period === "custom" ? "hover:border-emerald-300 hover:text-emerald-700" : "cursor-default"
            }`}
            data-testid="closing-balance-range-chip"
          >
            <CalendarDays className="h-3.5 w-3.5" />
            {isoToManual(start)} to {isoToManual(end)}
          </button>
        )}

        <Button
          onClick={() => setRefreshKey((n) => n + 1)}
          disabled={busy}
          title="Refresh"
          aria-label="Refresh"
          className="ml-auto h-9 w-9 shrink-0 bg-slate-500 p-0 text-white hover:bg-slate-600"
          data-testid="closing-balance-refresh"
        >
          <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {period === "day" ? (
        <DayCount branchId={branchId} day={day} refreshKey={refreshKey} onBusy={setBusy} />
      ) : period === "custom" && !(customFrom && customTo) ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 py-12 text-center" data-testid="closing-balance-custom-unset">
          <CalendarDays className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm font-medium text-slate-600">Pick the two dates to read between</p>
          <button type="button" onClick={openCustom} className="mt-1 text-xs font-medium text-emerald-700 hover:underline">
            Set a custom range
          </button>
        </div>
      ) : (
        <ClosingBalanceHistory
          branchId={branchId}
          start={start}
          end={end}
          refreshKey={refreshKey}
          onBusy={setBusy}
          onOpenDay={openDay}
        />
      )}

      {showCustom && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) dismissCustom(); }}
          data-testid="closing-balance-custom-modal"
        >
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <p className="text-base font-semibold text-slate-900">Custom Range</p>
              <button
                type="button"
                onClick={dismissCustom}
                className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100"
                aria-label="Close"
                data-testid="closing-balance-custom-close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              {[
                { label: "From", text: fromText, set: setFromText, iso: customFromIso, tid: "from" },
                { label: "To", text: toText, set: setToText, iso: customToIso, tid: "to" },
              ].map((f) => (
                <div key={f.tid}>
                  <label className="text-xs font-medium text-slate-500">{f.label}</label>
                  <input
                    value={f.text}
                    onChange={(e) => f.set(maskDayMonthYear(e.target.value, f.text))}
                    onKeyDown={(e) => { if (e.key === "Enter") applyCustom(); }}
                    inputMode="numeric"
                    maxLength={10}
                    placeholder="DD-MM-YYYY"
                    className={`h-9 w-full rounded-md border bg-white px-3 text-sm outline-none focus:ring-1 ${
                      f.text && !f.iso
                        ? "border-red-300 focus:border-red-400 focus:ring-red-400"
                        : "border-slate-200 focus:border-emerald-400 focus:ring-emerald-400"
                    }`}
                    data-testid={`closing-balance-custom-${f.tid}`}
                  />
                </div>
              ))}
              <p className="text-[11px] text-slate-400" data-testid="closing-balance-custom-hint">
                {customFromIso && customToIso && customFromIso > customToIso
                  ? "The From date is after the To date."
                  : "Type both dates as DD-MM-YYYY, e.g. 04-08-2026."}
              </p>
            </div>

            <div className="mt-5 flex gap-2">
              <Button variant="outline" onClick={dismissCustom} className="flex-1" data-testid="closing-balance-custom-cancel">Cancel</Button>
              <Button
                onClick={applyCustom}
                disabled={!rangeValid}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                data-testid="closing-balance-custom-apply"
              >
                Apply
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
