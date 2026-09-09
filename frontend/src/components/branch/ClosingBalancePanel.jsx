import { useCallback, useEffect, useMemo, useState } from "react";
import { Banknote, CreditCard, Smartphone, RefreshCw, Save, TrendingDown, TrendingUp, Check, AlertTriangle, Wallet } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getClosingBalance, saveClosingBalance, getRevenueOverview, getFinanceExpenses } from "@/lib/api";
import { DENOMINATIONS, noteTotal, countedNotes, noteBreakdown } from "@/lib/denominations";
import { totalsByMode } from "@/lib/payments";

const fmt = (n) => `Rs.${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const todayIso = () => new Date().toISOString().slice(0, 10);

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

/** A figure with its name, for the three-across strip at the top. */
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
 * Closing Balance — what the desk holds when it shuts, against what the day says it took.
 *
 * One day, one branch. The date is its own control rather than the tab's range, because a
 * closing balance is a single evening's count: a range covering a week would set one
 * drawer against seven days of takings and call the difference a shortfall.
 *
 * `expected` is worked out here rather than stored on the record — see the note above
 * save_closing_balance in v3_finance.py. Cash is the only mode that carries over, because
 * it is the only one that physically stays in the building: the drawer opens on what last
 * night's count left in it, takes the day's cash, and pays out whatever was spent in cash.
 * UPI and a card batch settle to a bank and start each day at nothing, so yesterday's
 * figure is history for them rather than an opening balance.
 *
 * @param branchId  The branch whose drawer this is. Required — "All Branches" has no
 *                  drawer to count, and the panel says so rather than adding four
 *                  branches' cash into one meaningless total.
 */
export const ClosingBalancePanel = ({ branchId }) => {
  const [day, setDay] = useState(todayIso());
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
  }, [branchId, day, fillFrom]);

  useEffect(() => { load(); }, [load]);

  const cashNotesTotal = useMemo(() => noteTotal(notes), [notes]);
  const cashCounted = round2(cashNotesTotal + (parseFloat(coins) || 0));
  const upiCounted = round2(parseFloat(upiAmount) || 0);
  const cardCounted = round2(parseFloat(cardAmount) || 0);
  const totalCounted = round2(cashCounted + upiCounted + cardCounted);

  // What each mode should come to. Cash alone opens on last night's count; see the
  // component note above for why the other two start at nothing every morning.
  const expected = useMemo(() => ({
    cash: round2((yesterday?.cash_total || 0) + (income.cash || 0) - (expense.cash || 0)),
    upi: round2((income.upi || 0) - (expense.upi || 0)),
    card: round2((income.card || 0) - (expense.card || 0)),
  }), [yesterday, income, expense]);
  const totalExpected = round2(expected.cash + expected.upi + expected.card);

  const counted = { cash: cashCounted, upi: upiCounted, card: cardCounted };

  const dayIncome = useMemo(
    () => round2(Object.values(income).reduce((a, b) => a + (Number(b) || 0), 0)),
    [income],
  );
  const dayExpense = useMemo(
    () => round2(Object.values(expense).reduce((a, b) => a + (Number(b) || 0), 0)),
    [expense],
  );

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
      {/* The day being closed. Its own control, and defaulted to today — a branch counting
          up after midnight is closing yesterday and needs to be able to say so. */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-slate-600">Closing day:</label>
          <Input
            type="date"
            value={day}
            max={todayIso()}
            onChange={(e) => setDay(e.target.value || todayIso())}
            className="h-9 w-40"
            data-testid="closing-balance-date"
          />
        </div>
        {saved && (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 py-1.5 text-[11px] font-medium text-emerald-700" data-testid="closing-balance-saved-chip">
            <Check className="h-3.5 w-3.5" />
            Counted by {saved.counted_by || "—"}
            {saved.updated_by && saved.updated_by !== saved.counted_by ? ` · last corrected by ${saved.updated_by}` : ""}
          </span>
        )}
        <Button
          onClick={load}
          disabled={loading}
          title="Refresh"
          aria-label="Refresh"
          className="ml-auto h-9 w-9 shrink-0 bg-slate-500 p-0 text-white hover:bg-slate-600"
          data-testid="closing-balance-refresh"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

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
