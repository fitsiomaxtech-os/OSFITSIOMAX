import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, CheckCircle2, Minus, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { FinanceDateFilter } from "@/components/finance/FinanceDateFilter";
import { rangeFor, rangeIncomplete } from "@/lib/dateRange";
import { getFinanceApprovals, getBranches, approveTransaction, unapproveTransaction, bulkApproveTransactions } from "@/lib/api";
import { ExpenseApprovalsPanel } from "@/components/finance/ExpenseApprovalsPanel";

// The two things this desk signs off. Money coming in was all it ever held, because money
// going out had no approval to give — a branch could not raise an expense, so the only
// expenses on file were the ones the accountant had entered themselves.
const LEDGERS = [
  { key: "income", label: "Income Approval" },
  { key: "expenses", label: "Expenses Approval" },
];

const fmt = (n) => `Rs.${(Number(n) || 0).toLocaleString("en-IN")}`;

/**
 * The red count in a tab's top-right corner that says something is waiting on this desk.
 * Same badge PhysioBoard and DietBoard put on their tabs, so a number in that corner
 * means the same thing wherever it turns up. Nothing at all at zero -- a "0" in red is an
 * alarm about nothing.
 */
export const PendingBadge = ({ count, testId }) => (count > 0 ? (
  <span
    className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold leading-none text-white ring-2 ring-white"
    data-testid={testId}
  >
    {count > 99 ? "99+" : count}
  </span>
) : null);

// Every category the backend can return, which is not what this list held: Rehab and
// Zumba were both missing, so a rehab course fee or a class fee could be seen only
// under "All" and vanished the moment any pill was picked. Zumba could not be seen at
// all until finance_approvals started reading the registrations it lives on.
const CATEGORIES = [
  ["all", "All"],
  ["consultation", "Consultations"],
  ["session", "Treatments"],
  ["diet", "Diet"],
  ["rehab", "Rehab"],
  ["zumba", "Zumba"],
  ["store", "Fitsio Store"],
  ["other", "Others"],
];

const MODE_LABELS = { upi: "UPI", account_transfer: "Bank Transfer", cheque: "Cheque", cash: "Cash", card: "Card", partial: "Partial" };
const modeLabel = (m) => MODE_LABELS[m] || (m && m !== "unknown" ? m.charAt(0).toUpperCase() + m.slice(1) : "—");

// Same set a Branch Admin picks from when collecting a fee (V3MarkInstallmentPaidInput
// and its siblings across v3_packages.py) — not a separate list invented for this filter.
const PAYMENT_MODES = [
  ["all", "All Modes"],
  ["cash", "Cash"],
  ["upi", "UPI"],
  ["card", "Card"],
  ["account_transfer", "Bank Transfer"],
  ["cheque", "Cheque"],
];

const VERTICALS = [["all", "All"], ["offline", "Offline"], ["online", "Online"]];

// Yesterday and Last Month are left off, though rangeFor knows both: this desk signs off a
// batch rather than reading a closed period back, and the row shares its line with the
// vertical filter beside it. Custom Range stays last, where a preset row ends everywhere
// else in the OS.
const DATE_PRESETS = ["all", "today", "this_week", "this_month", "custom"];

/**
 * One filter pill. The three rows of these used to be written out three times with three
 * different sizes -- the vertical row at text-xs/px-3, the other two at text-sm/px-3.5 --
 * so a filter block that asks three questions of equal weight answered them in two
 * typefaces. One size now, and the accent is the only thing that varies: sky for what was
 * bought, indigo for how it was paid, which is the distinction the rows are grouped on.
 */
const FilterPill = ({ on, accent = "sky", onClick, children, testId }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={on}
    className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
      on
        ? accent === "indigo"
          ? "border-indigo-600 bg-indigo-600 text-white shadow-sm"
          : "border-sky-600 bg-sky-600 text-white shadow-sm"
        : `border-slate-200 bg-white text-slate-600 ${accent === "indigo" ? "hover:border-indigo-300 hover:text-indigo-600" : "hover:border-sky-300 hover:text-sky-600"}`
    }`}
    data-testid={testId}
  >
    {children}
  </button>
);

/**
 * A line of the filter block, holding two groups of pills pushed to opposite ends of it.
 *
 * The gap between them is what separates the two questions, which is why they are not
 * simply four bands of pills stacked: four bands cost four bands of screen above a list
 * that is the thing anybody came here to read. On a phone there is no room to push
 * anything anywhere, so the groups stack and the gap between them does the same job
 * vertically.
 */
const FilterRow = ({ children }) => (
  <div className="flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
    {children}
  </div>
);

/** One question's worth of pills, wrapping within itself rather than into its neighbour. */
const FilterGroup = ({ children, testId }) => (
  <div className="flex flex-wrap items-center gap-2" data-testid={testId}>{children}</div>
);

/**
 * Approve popup — what it asks for depends on the row's own payment mode: Cash gets a
 * re-entered amount (the one figure a cash drawer can't otherwise be checked against);
 * UPI/Bank Transfer/Card get a reference to key against the bank statement; Cheque gets
 * its number. A mode with nothing recognised (package_sold, a store sale rung up with
 * no mode) just confirms the amount, same as Cash.
 */
const ApproveModal = ({ tx, onClose, onApproved }) => {
  const mode = tx.payment_mode;
  const needsRef = mode === "upi" || mode === "card" || mode === "account_transfer";
  const needsCheque = mode === "cheque";
  const needsAmount = !needsRef && !needsCheque;

  const [amount, setAmount] = useState(String(tx.amount || ""));
  const [ref, setRef] = useState("");
  const [chequeNo, setChequeNo] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (needsAmount && !(Number(amount) > 0)) { toast.error("Enter the amount"); return; }
    if (needsRef && !ref.trim()) { toast.error(`Enter the ${mode === "upi" ? "UPI reference" : "transaction ID"}`); return; }
    if (needsCheque && !chequeNo.trim()) { toast.error("Enter the cheque number"); return; }
    setSaving(true);
    try {
      const payload = {};
      if (needsAmount) payload.confirmed_amount = Number(amount);
      if (needsRef) payload.transaction_ref = ref.trim();
      if (needsCheque) payload.cheque_number = chequeNo.trim();
      await approveTransaction(tx.id, payload);
      toast.success(`${tx.patient_name}'s payment approved`);
      onApproved();
    } catch (e) { toast.error(e?.response?.data?.detail || "Approve failed"); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" data-testid="finance-approve-modal">
      <div className="w-full max-w-sm rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h3 className="text-base font-semibold">Approve Payment</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" data-testid="finance-approve-modal-close"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3 p-5">
          <p className="text-sm text-slate-600">
            <span className="font-semibold text-slate-800">{tx.patient_name}</span> · {fmt(tx.amount)} via {modeLabel(mode)}
          </p>
          {needsAmount && (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Re-enter the amount collected</label>
              <Input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="finance-approve-amount" />
            </div>
          )}
          {needsRef && (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">{mode === "upi" ? "UPI Transaction ID" : "Transaction ID"}</label>
              <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder={mode === "upi" ? "UPI ref / UTR" : "Bank transaction ID"} data-testid="finance-approve-ref" />
            </div>
          )}
          {needsCheque && (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Cheque Number</label>
              <Input value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} data-testid="finance-approve-cheque" />
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <Button variant="outline" onClick={onClose} data-testid="finance-approve-cancel">Cancel</Button>
          <Button onClick={submit} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700" data-testid="finance-approve-confirm">
            {saving ? "Approving…" : "Approve"}
          </Button>
        </div>
      </div>
    </div>
  );
};

/**
 * One box, three states. Radix's Checkbox is the house control and is used everywhere a
 * box is only on or off; this row needs a third — the header box when some of the list is
 * picked and some is not — and that component draws a tick for it, which reads as "all of
 * them" and is the one thing it must not say here.
 */
const TickBox = ({ state, onChange, label }) => (
  <button
    type="button"
    role="checkbox"
    aria-checked={state === "some" ? "mixed" : state === "on"}
    aria-label={label}
    onClick={onChange}
    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
      state === "off"
        ? "border-slate-300 bg-white hover:border-emerald-500"
        : "border-emerald-600 bg-emerald-600 text-white"
    }`}
  >
    {state === "on" && <Check className="h-3 w-3" strokeWidth={3} />}
    {state === "some" && <Minus className="h-3 w-3" strokeWidth={3} />}
  </button>
);

/**
 * The popup for signing off a selection at once.
 *
 * It exists to say the thing the one-at-a-time popup above collects and this one cannot:
 * approving in bulk records who and when against every picked row and nothing to check
 * them against — no re-keyed cash amount, no UTR, no cheque number. That is a real
 * weakening of what an approval means here, so it is said in the popup rather than left
 * for someone to work out from what they were never asked.
 */
const BulkApproveModal = ({ count, total, saving, onClose, onConfirm }) => (
  <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" data-testid="finance-bulk-approve-modal">
    <div className="w-full max-w-sm rounded-lg bg-white shadow-xl">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
        <h3 className="text-base font-semibold">Approve {count} payment{count === 1 ? "" : "s"}</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600" data-testid="finance-bulk-approve-close"><X className="h-4 w-4" /></button>
      </div>
      <div className="space-y-3 p-5">
        <p className="text-sm text-slate-600">
          Signing off <span className="font-semibold text-slate-800">{count} payment{count === 1 ? "" : "s"}</span> worth{" "}
          <span className="font-semibold text-emerald-700">{fmt(total)}</span>.
        </p>
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
          Approved this way, none of them carries a confirmation: no re-entered cash amount,
          no UPI or bank reference, no cheque number. Your name and the time are recorded
          against each. Approve a row on its own if it needs checking against something.
        </p>
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
        <Button variant="outline" onClick={onClose} data-testid="finance-bulk-approve-cancel">Cancel</Button>
        <Button onClick={onConfirm} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700" data-testid="finance-bulk-approve-confirm">
          {saving ? "Approving…" : `Approve ${count}`}
        </Button>
      </div>
    </div>
  </div>
);

/**
 * Accountant > Approvals — "new income collected" waiting on sign-off, every kind of
 * revenue (consultation, treatment/session, diet, Fitsio Store) rather than just
 * consultation/package. Approving doesn't touch what counts as revenue anywhere else in
 * the OS — see approve_transaction's docstring — it only records that someone other
 * than whoever collected it looked the payment over, plus whatever the popup asked them
 * to confirm against the payment mode.
 *
 * `branchId`/`scoped` are the same pair ExpenseBoard and ProfitBoard take: passed by
 * Super Admin > Finance, whose branch-pill row has already picked the scope, and left off
 * on the Accountant's own board, where this keeps its own select.
 */
export const ApprovalsBoard = ({ pending = { income: 0, expenses: 0 }, onChanged = () => {}, branchId: branchIdProp, scoped = false }) => {
  const controlled = scoped;
  const [branches, setBranches] = useState([]);
  const [ownBranchId, setOwnBranchId] = useState("");
  const branchId = controlled ? (branchIdProp || "") : ownBranchId;
  const setBranchId = setOwnBranchId;
  const [mode, setMode] = useState("all"); // "all" | "online" | "offline"
  const [category, setCategory] = useState("all");
  const [paymentMode, setPaymentMode] = useState("all"); // "all" | "cash" | "upi" | "card" | "account_transfer" | "cheque"
  // The window both ledgers are read through. Held here rather than in each of them
  // because it is the one filter that means the same thing on either side -- a day's
  // collections and a day's spending are the same day -- so it is asked once, above the
  // ledger switch, and both /finance/approvals and /finance/expenses take it from here.
  const [preset, setPreset] = useState("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [startDate, endDate] = useMemo(
    () => rangeFor(preset, customFrom, customTo),
    [preset, customFrom, customTo],
  );
  const pickDates = (key, from, to) => { setPreset(key); setCustomFrom(from); setCustomTo(to); };
  const [view, setView] = useState("pending"); // "pending" | "approved"
  const [ledger, setLedger] = useState("income"); // "income" | "expenses"
  const [data, setData] = useState({ transactions: [], summary: {} });
  const [loading, setLoading] = useState(false);
  const [approving, setApproving] = useState(null);
  const [busyId, setBusyId] = useState(null);
  // Ids, not rows: the rows are replaced wholesale on every reload, and a set of objects
  // held across one would be comparing against rows that no longer exist.
  const [selected, setSelected] = useState(() => new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);

  useEffect(() => { if (!controlled) getBranches().then(setBranches).catch(() => {}); }, [controlled]);

  const load = useCallback(async () => {
    // A half-typed custom range would ask for everything from one date to nothing, which
    // reads as an empty ledger rather than as an unfinished question. The list stays on
    // what it was showing until both ends are picked -- same rule Expense's row follows.
    if (rangeIncomplete(preset, customFrom, customTo)) return;
    setLoading(true);
    try {
      const params = { approved: view === "approved" };
      if (branchId) params.branch_id = branchId;
      if (mode !== "all") params.mode = mode;
      if (category !== "all") params.category = category;
      if (paymentMode !== "all") params.payment_mode = paymentMode;
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;
      setData(await getFinanceApprovals(params));
      // Every filter change comes through here, and a selection that outlived one would
      // approve rows the accountant can no longer see. Cleared on the reload after an
      // approve too, where the picked rows have just left the list.
      setSelected(new Set());
    } catch { /* silent */ }
    setLoading(false);
  }, [branchId, mode, category, paymentMode, startDate, endDate, preset, customFrom, customTo, view]);

  useEffect(() => { load(); }, [load]);

  const undo = async (tx) => {
    setBusyId(tx.id);
    try {
      await unapproveTransaction(tx.id);
      toast.success("Approval removed");
      await load();
      onChanged();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
    setBusyId(null);
  };

  // Only the pending list can be picked from: an approved row has an Undo instead, and
  // that is one at a time on purpose — see unapprove_transaction.
  const rows = data.transactions || [];
  const selectable = view === "pending" ? rows : [];
  // Plainly, not memoised: both inputs are rebuilt on every render, so a useMemo here
  // never actually hit its cache -- it only told the linter it was trying to.
  const picked = selectable.filter((t) => selected.has(t.id));
  const pickedTotal = picked.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
  const allOn = selectable.length > 0 && picked.length === selectable.length;

  const toggleOne = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  // Everything currently listed, which is everything the filters above have left:
  // /finance/approvals returns the whole filtered set rather than a page of it, so "all"
  // here means all of what is being looked at, with nothing hidden behind it.
  const toggleAll = () => setSelected(allOn ? new Set() : new Set(selectable.map((t) => t.id)));

  const bulkApprove = async () => {
    setBulkSaving(true);
    try {
      const res = await bulkApproveTransactions(picked.map((t) => t.id));
      toast.success(res?.message || "Approved");
      setBulkOpen(false);
      await load();
      onChanged();
    } catch (e) { toast.error(e?.response?.data?.detail || "Approve failed"); }
    setBulkSaving(false);
  };

  const s = data.summary || {};

  return (
    <div className="space-y-4" data-testid="finance-approvals-root">
      {/* Which of the two is being signed off. Above the cards rather than among them,
          because it changes what those cards are counting — the cards underneath cut one
          ledger into pending and approved, this picks which ledger. */}
      <div className="flex w-full items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5" data-testid="finance-approvals-ledger">
        {LEDGERS.map((l) => (
          <button
            key={l.key}
            type="button"
            onClick={() => setLedger(l.key)}
            className={`relative flex-1 rounded-md px-4 py-2 text-xs font-semibold transition ${ledger === l.key ? "bg-sky-500 text-white shadow-sm" : "text-slate-500 hover:bg-slate-50"}`}
            data-testid={`finance-approvals-ledger-${l.key}`}
          >
            {l.label}
            {/* Which ledger the waiting items are in. Every branch, unfiltered -- see
                AccountantBoard's pending -- so picking a branch below does not make the
                other ledger's count look like it went away. */}
            <PendingBadge count={pending[l.key]} testId={`finance-approvals-ledger-badge-${l.key}`} />
          </button>
        ))}
      </div>

      {/* One filter block for both ledgers, above the switch's two sides rather than
          inside one of them. What is on it follows the ledger: the vertical and the window
          narrow money going either way and stay put, while what it was for and how it was
          paid describe a collection and have nothing to say about an expense —
          /finance/expenses does not take them — so they are not offered against one.

          Four loose bands of pills stood here before, in two sizes, each opening with a
          pill called "All". Two lines now, each holding two groups at opposite ends: same
          four questions, half the screen, and the gap in the middle of a line is what says
          the pills either side of it are answering different things. */}
      <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white" data-testid="finance-approvals-filters">
        {/* Which money, and from when. Two groups pushed to opposite ends of the line
            rather than stacked on two lines of their own: they are asked together and the
            gap between them is what says they are two questions, so the row costs one band
            of screen instead of two and still reads as two things. */}
        <FilterRow>
          <FilterGroup testId="finance-approvals-mode-filter">
            {VERTICALS.map(([key, label]) => (
              <FilterPill
                key={key}
                on={mode === key}
                onClick={() => setMode(key)}
                testId={`finance-approvals-mode-${key}`}
              >
                {label}
              </FilterPill>
            ))}
            {/* Already picked by the branch-pill row above this board when it is embedded
                in Super Admin's Finance screen — asking again underneath it would be a
                second answer to a question that has one. */}
            {!controlled && (
              <select
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                className="h-8 rounded-md border border-slate-200 px-2 text-xs"
                data-testid="finance-approvals-branch"
              >
                <option value="">All Branches</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.branch_name}</option>)}
              </select>
            )}
          </FilterGroup>

          {/* The shared finance row, so this desk and the three pages beside it name their
              windows with the same words and reach them the same way. Custom Range opens
              the dialog rather than dropping two date fields into the block underneath. */}
          <FinanceDateFilter
            preset={preset}
            customFrom={customFrom}
            customTo={customTo}
            onChange={pickDates}
            presets={DATE_PRESETS}
            testid="finance-approvals-window"
          />
        </FilterRow>

        {/* What it was for, and how it was paid. Both describe a collection and neither is
            a question /finance/expenses can answer, so the whole line goes when the ledger
            switches to expenses rather than sitting there greyed. */}
        {ledger === "income" && (
          <FilterRow>
            <FilterGroup testId="finance-approvals-category-filter">
              {CATEGORIES.map(([key, label]) => (
                <FilterPill
                  key={key}
                  on={category === key}
                  onClick={() => setCategory(key)}
                  testId={`finance-approvals-category-${key}`}
                >
                  {label}
                </FilterPill>
              ))}
            </FilterGroup>

            {/* Same set Branch Admin picks from when collecting the fee in the first
                place — not a category (what was paid for) but how, so it keeps the indigo
                it has always had rather than reading as more of the row beside it. */}
            <FilterGroup testId="finance-approvals-payment-mode-filter">
              {PAYMENT_MODES.map(([key, label]) => (
                <FilterPill
                  key={key}
                  accent="indigo"
                  on={paymentMode === key}
                  onClick={() => setPaymentMode(key)}
                  testId={`finance-approvals-payment-mode-${key}`}
                >
                  {label}
                </FilterPill>
              ))}
            </FilterGroup>
          </FilterRow>
        )}
      </div>

      {ledger === "expenses" && (
        <ExpenseApprovalsPanel
          onChanged={onChanged}
          branchId={branchId}
          mode={mode}
          startDate={startDate}
          endDate={endDate}
        />
      )}

      {ledger === "income" && (
      <>
      {/* The cards are the switch. A Pending/Approved toggle underneath them said the
          same two words a second time, in a smaller font, directly below the pair already
          naming each side and totalling it — so the pair does the picking now, the chosen
          one carrying its colour and the other falling back to plain white. */}
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => setView("pending")}
          aria-pressed={view === "pending"}
          className={`rounded-xl border p-4 text-left transition ${view === "pending" ? "border-amber-300 bg-amber-50 ring-2 ring-amber-400" : "border-slate-200 bg-white hover:border-amber-200"}`}
          data-testid="finance-approvals-pending-card"
        >
          <p className={`text-[11px] font-medium uppercase tracking-wide ${view === "pending" ? "text-amber-700" : "text-slate-500"}`}>Pending Approval</p>
          <p className={`text-2xl font-bold ${view === "pending" ? "text-amber-700" : "text-slate-700"}`}>{fmt(s.pending_total)}</p>
          <p className={`text-[10px] ${view === "pending" ? "text-amber-600" : "text-slate-400"}`}>{s.pending_count || 0} payments</p>
        </button>
        <button
          type="button"
          onClick={() => setView("approved")}
          aria-pressed={view === "approved"}
          className={`rounded-xl border p-4 text-left transition ${view === "approved" ? "border-emerald-300 bg-emerald-50 ring-2 ring-emerald-400" : "border-slate-200 bg-white hover:border-emerald-200"}`}
          data-testid="finance-approvals-approved-card"
        >
          <p className={`text-[11px] font-medium uppercase tracking-wide ${view === "approved" ? "text-emerald-700" : "text-slate-500"}`}>Approved</p>
          <p className={`text-2xl font-bold ${view === "approved" ? "text-emerald-700" : "text-slate-700"}`}>{fmt(s.approved_total)}</p>
          <p className={`text-[10px] ${view === "approved" ? "text-emerald-600" : "text-slate-400"}`}>{s.approved_count || 0} payments</p>
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden" data-testid="finance-approvals-summary">
        {/* One bar, two jobs. Idle it names the list and offers the tick that takes all of
            it; with anything picked it becomes the bar that acts on the picking, carrying
            the count and the money so neither has to be totted up by eye. Not a second bar
            appearing above the first, which would push the whole list down a row on the
            first click. */}
        <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/80 px-4 py-2.5">
          {selectable.length > 0 && (
            <TickBox
              state={allOn ? "on" : picked.length > 0 ? "some" : "off"}
              onChange={toggleAll}
              label={allOn ? "Clear the selection" : `Select all ${selectable.length} payments`}
            />
          )}
          {picked.length > 0 ? (
            <>
              <p className="text-xs font-semibold text-slate-700" data-testid="finance-approvals-selection-count">
                {picked.length} selected
                <span className="ml-1.5 font-bold text-emerald-700">{fmt(pickedTotal)}</span>
              </p>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="text-xs font-medium text-slate-400 underline-offset-2 hover:text-slate-600 hover:underline"
                data-testid="finance-approvals-clear-selection"
              >
                Clear
              </button>
              <Button
                size="sm"
                onClick={() => setBulkOpen(true)}
                className="ml-auto h-7 bg-emerald-600 text-xs hover:bg-emerald-700"
                data-testid="finance-approvals-approve-selected"
              >
                <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                Approve {picked.length}
              </Button>
            </>
          ) : (
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Payment Summary
              {selectable.length > 0 && (
                <span className="ml-2 font-medium normal-case tracking-normal text-slate-400">
                  tick to approve several at once
                </span>
              )}
            </p>
          )}
        </div>
        <div className="divide-y divide-slate-50">
          {loading ? (
            <p className="px-4 py-8 text-center text-sm text-slate-400">Loading...</p>
          ) : rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-400">
              {view === "pending" ? "Nothing waiting on approval." : "Nothing approved yet."}
            </p>
          ) : rows.map((tx) => (
            <div
              key={tx.id}
              className={`flex items-center justify-between gap-3 px-4 py-3 transition-colors ${selected.has(tx.id) ? "bg-emerald-50/50" : ""}`}
              data-testid={`finance-approval-row-${tx.id}`}
            >
              {view === "pending" && (
                <TickBox
                  state={selected.has(tx.id) ? "on" : "off"}
                  onChange={() => toggleOne(tx.id)}
                  label={`Select ${tx.patient_name}'s payment`}
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800">{tx.patient_name}</p>
                <p className="truncate text-xs text-slate-500">
                  {tx.branch_name || "—"} · <span className="capitalize">{tx.category}</span> · {modeLabel(tx.payment_mode)} · {(tx.collected_at || "").slice(0, 10)}
                  {view === "approved" && tx.approved_by && <> · approved by {tx.approved_by}</>}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-sm font-bold text-emerald-600">{fmt(tx.amount)}</span>
                {view === "pending" ? (
                  <Button
                    size="sm"
                    onClick={() => setApproving(tx)}
                    className="bg-emerald-600 hover:bg-emerald-700"
                    data-testid={`finance-approve-${tx.id}`}
                  >
                    <CheckCircle2 className="mr-1 h-3.5 w-3.5" />Approve
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => undo(tx)}
                    disabled={busyId === tx.id}
                    data-testid={`finance-unapprove-${tx.id}`}
                  >
                    <RotateCcw className="mr-1 h-3.5 w-3.5" />Undo
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      </>
      )}

      {bulkOpen && (
        <BulkApproveModal
          count={picked.length}
          total={pickedTotal}
          saving={bulkSaving}
          onClose={() => setBulkOpen(false)}
          onConfirm={bulkApprove}
        />
      )}

      {approving && (
        <ApproveModal
          tx={approving}
          onClose={() => setApproving(null)}
          onApproved={() => { setApproving(null); load(); onChanged(); }}
        />
      )}
    </div>
  );
};
