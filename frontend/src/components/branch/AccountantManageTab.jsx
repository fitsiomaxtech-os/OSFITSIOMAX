import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, Receipt, Wallet, Stethoscope, Activity, ShoppingBag, Salad, RefreshCw, CalendarDays, X, Music2, HeartPulse, Dumbbell, ChevronDown, ChevronRight, Send, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { toast } from "@/components/ui/sonner";
import { BranchExpensesPanel } from "@/components/branch/BranchExpensesPanel";
import { maskDayMonthYear, manualToIso, isoToManual } from "@/components/DateFilterPopover";
import { getBranches, getRevenueOverview, getFinanceExpenses, requestTransactions, unrequestTransactions } from "@/lib/api";
import { ClientHistoryModal } from "@/components/branch/ClientHistoryModal";
import { ReceiptDialog } from "@/components/ReceiptDialog";
import { receiptFromTransaction } from "@/lib/receipt";
import { OutstandingAmountBoard } from "@/components/branch/OutstandingAmountBoard";
import { ClosingBalancePanel } from "@/components/branch/ClosingBalancePanel";
import { CloseBookHistoryPanel } from "@/components/branch/CloseBookHistoryPanel";

// Three tabs, not the ten this page used to carry: Consultation/Session/Diet/Store
// Collections were each a copy of Summary's own card-click-to-filter table scoped to one
// source, which Summary's revenue cards already do; Payment Paid/Unpaid were the same
// transactions again split by settled/unsettled, readable off Payment Schedule's own
// balance column; and the old Payment Schedule tab (Partial Payment installments) is
// superseded here by Outstanding Amount under the same name — the balance a client still
// owes, not the schedule that produced it.
const MAIN_TABS = [
  { key: "summary", label: "Summary" },
  { key: "schedule", label: "Payment Schedule" },
  { key: "discount", label: "Discount Applied", tone: "discount" },
  // The day-end count. Last of the four because it is the one thing here that is not a
  // reading of what the system already knows -- it is the desk telling the system what it
  // actually holds, which is only worth asking once the day it closes has been read.
  { key: "closing", label: "Closing Balance", tone: "closing" },
  // Directly after it, because it is the same thing read back: Closing Balance counts an
  // evening and signs it off, this is the month of evenings already signed. Separated
  // rather than folded into that panel's own Weekly/Monthly view, which answers a
  // different question -- that one lists every evening including the ones nobody counted,
  // and this one lists only the days somebody put their name to.
  { key: "closebooks", label: "Close Books", tone: "closing" },
];

const mainTabClasses = (tab, active) => {
  if (tab.tone === "discount") {
    return active ? "bg-amber-600 text-white shadow-sm" : "text-amber-700 hover:bg-amber-50";
  }
  if (tab.tone === "closing") {
    return active ? "bg-emerald-600 text-white shadow-sm" : "text-emerald-700 hover:bg-emerald-50";
  }
  return active ? "bg-sky-50 text-sky-700" : "text-slate-600 hover:bg-slate-50";
};

// Money in and money out — the first thing this tab is asked, and the two do not belong
// in one list. What replaced: three chips splitting collections by sign-off, which said
// the same thing three times over (every collection is pending until the Accountant's own
// Approvals tab signs it off, so Collected and Pending read identically on any branch
// that has not been through it, as Rs.4,96,594 and Rs.4,96,594 did here).
const LEDGER_VIEWS = [
  { key: "income", label: "Income" },
  { key: "expenses", label: "Expenses" },
];

/**
 * Where a collection stands between the desk that took it and the books.
 *
 * Three, because two could not say the thing that matters: a payment sitting in a drawer
 * that nobody has sent up is not the same as one the accountant has been asked to check,
 * and the queue used to hold both. Collected is the branch's own pile, Request is what it
 * has handed over, Approved is what came back signed.
 *
 * `all` is not one of them on purpose. Every row is in exactly one of these three, so a
 * fourth pill showing all of them at once would be a total that no one is responsible for.
 */
// Tones are the ones the expense pills already wear for the same three states -- amber
// for waiting on somebody, emerald for signed off -- so a branch reading Income after
// Expenses is reading the same colours for the same thing. Collected is the pile nobody
// is waiting on yet, and takes the sky the stage row was already picked out in.
const INCOME_STAGES = [
  { key: "collected", label: "Collected", hint: "Taken at the desk, not sent up yet",
    tone: { dot: "bg-sky-500", border: "border-sky-200", bg: "bg-sky-50/70", text: "text-sky-700", sub: "text-sky-600/80", ring: "#0284c7" } },
  { key: "requested", label: "Income Request", hint: "Sent to the accountant, waiting to be signed off",
    tone: { dot: "bg-amber-500", border: "border-amber-200", bg: "bg-amber-50/70", text: "text-amber-700", sub: "text-amber-600/80", ring: "#d97706" } },
  { key: "approved", label: "Income Approved", hint: "Signed off by the accountant",
    tone: { dot: "bg-emerald-500", border: "border-emerald-200", bg: "bg-emerald-50/70", text: "text-emerald-700", sub: "text-emerald-600/80", ring: "#059669" } },
];

/** Which of the three one collection is in. Approved wins over requested: a row that has
 *  been signed off is approved whatever it looked like on the way there. */
const stageOf = (tx) => (tx?.approved ? "approved" : tx?.income_requested ? "requested" : "collected");

// Same set a Branch Admin picks from when collecting a fee (V3MarkInstallmentPaidInput
// and its siblings across v3_packages.py) — not a separate list invented for this filter,
// same as Finance > Approvals' own payment-mode row.
const PAYMENT_MODES = [
  ["all", "All Modes"],
  ["cash", "Cash"],
  ["upi", "UPI"],
  ["card", "Card"],
  ["account_transfer", "Bank Transfer"],
  ["cheque", "Cheque"],
];

// The card, the table it filters to, and the label above that table are one thing, so they
// are one list rather than three that have to be kept in step.
// `label` names the section the detail table below is showing; `short` is what fits on a
// card standing eight to a row, and is what the branch breakdown's column headings were
// already making for themselves by cutting " Revenue" off the label.
const REVENUE_VIEWS = [
  { key: "collected", label: "Total Revenue", short: "Total", color: "#059669", icon: Wallet },
  { key: "consultation", label: "Consultation Revenue", short: "Consultation", color: "#0284c7", icon: Stethoscope },
  { key: "session", label: "Session Revenue", short: "Session", color: "#7c3aed", icon: Activity },
  { key: "diet", label: "Diet Revenue", short: "Diet", color: "#ea580c", icon: Salad },
  { key: "store", label: "Store Revenue", short: "Store", color: "#d97706", icon: ShoppingBag },
  // Zumba money lives on the registration, not in the leads' fee trail — see the
  // zumba loop in v3_finance.py's revenue-overview. It reaches this row the same way
  // store sales do, as transactions carrying source "zumba".
  { key: "zumba", label: "Zumba Revenue", short: "Zumba", color: "#db2777", icon: Music2 },
  // Real now that a rehab fee can be collected: rehab_fee_collected is its own revenue
  // category, so these transactions arrive carrying source "rehab".
  { key: "rehab", label: "Rehab Revenue", short: "Rehab", color: "#0891b2", icon: HeartPulse },
  // Gym memberships, reaching this row the same way Zumba's do: v3_fitness.py keeps the
  // fee on the registration, so it arrives as a transaction carrying source "fitness"
  // rather than through the leads' fee trail. Until it was counted, this was the one desk
  // taking money that never appeared on the page an accountant reads.
  { key: "fitness", label: "Fitness Revenue", short: "Fitness", color: "#65a30d", icon: Dumbbell },
];

// The seven the total is made of, which is the set the branch breakdown's columns are cut
// from: a column of totals beside seven columns that add up to it would be the same number
// written twice. Split off the one list rather than written out again, so a ninth category
// still only has to be added in one place.
const [, ...CATEGORY_VIEWS] = REVENUE_VIEWS;

// What each source's rows are called under its figure. Store sells, Zumba and Fitness
// register, everything else is paid.
const revenueNoun = (key) => (key === "store" ? "sale" : key === "zumba" || key === "fitness" ? "registration" : "payment");

const titleCase = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");

// What a receipt calls each of the ledger's sources. The table's own column shows the
// bare category, which is the right length for a column and the wrong words for a
// document: a patient handed a sheet reading "Paid For: session" cannot match it against
// anything they were told at the desk.
const RECEIPT_PAID_FOR = {
  consultation: "Consultation Fee",
  session: "Treatment Fee",
  treatment: "Treatment Fee",
  rehab: "Rehab Fee",
  diet: "Diet Fee",
  store: "Store Purchase",
  zumba: "Zumba Registration",
  fitness: "Fitness Membership",
};

/** One ledger row as a receipt. Named here rather than inside receiptFromTransaction
 *  because the source vocabulary is this desk's, not the receipt's. */
const receiptForTxn = (tx) => receiptFromTransaction({
  ...tx,
  paidFor: RECEIPT_PAID_FOR[tx.source] || titleCase(tx.source || ""),
});

// What the server calls money it cannot put under a branch -- see _branch_label in
// v3_finance.py. One is a client who was never given a branch, the other a branch id
// nothing answers to any more. Neither can be picked from the dropdown above, which is
// exactly why going through it one branch at a time never adds up to the total.
const UNPLACED = ["Unassigned", "Former branch"];

// "All" first and the default — this page had no date filter before, so opening it
// scoped to Today would silently hide every collection older than that. Today/This
// Week/This Month/Custom are the same presets Branches & Verticals' own Overview and AC
// Overview already use.
const DATE_PRESETS = [
  { key: "all", label: "All" },
  { key: "today", label: "Today" },
  { key: "this_week", label: "This Week" },
  { key: "this_month", label: "This Month" },
  { key: "custom", label: "Custom" },
];

const startOfDay = (d) => { const n = new Date(d); n.setHours(0, 0, 0, 0); return n; };
const startOfWeek = (d) => { const x = startOfDay(d); x.setDate(x.getDate() - x.getDay()); return x; };
const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const toIso = (d) => d.toISOString().slice(0, 10);

const fmt = (n) => `Rs.${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const countLabel = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/**
 * The revenue row's own card. StatTile is the house figure card and stays the house
 * figure card everywhere else; this row is the one place eight of them stand side by
 * side, and eight cards each carrying a coloured disc behind a coloured number is eight
 * things competing to be read first.
 *
 * So the colour moves off the number and onto one chip holding the icon: the category is
 * told apart at a glance, and every figure on the row is told in one weight and one
 * colour, whichever card is picked. A number that changes colour when its card is
 * pressed reads as a different number.
 *
 * Which card is picked is then said three quiet ways rather than one loud one: the chip
 * fills in solid, a hairline accent sits on the card's bottom edge, and the card lifts on
 * a neutral ring. A coloured ring drawn all the way round turns the card into a box with
 * a border, and eight cards with one of them boxed is a form control, not a dashboard.
 *
 * All eight are the same card at the same size, the total included. It was drawn larger
 * for a while, on the reasoning that a sum is not a category; what that actually did was
 * break the row into a headline and seven footnotes, when what a branch reads here is one
 * line of figures across. Rank is carried by the total standing first, which is enough.
 *
 * `muted` greys a figure of nothing -- Rs.0 still says the desk was open and took
 * nothing, which is worth showing and not worth reading first.
 *
 * Colours are inline styles off one hex per card for the same reason StatTile's are:
 * Tailwind reads class names out of the source, so a class name assembled at runtime
 * compiles to nothing.
 */
const RevenueTile = ({ label, value, sub, icon: Icon, color, active, muted, onClick, testid }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    data-testid={testid}
    className={`group relative flex h-full w-full flex-col overflow-hidden rounded-xl border bg-white p-3 text-left transition-all duration-150 sm:p-3.5 ${
      active
        ? "border-slate-300 shadow-[0_4px_14px_-4px_rgba(16,24,40,0.16)]"
        : "border-slate-200 shadow-[0_1px_2px_rgba(16,24,40,0.04)] hover:border-slate-300 hover:bg-slate-50/60"
    }`}
  >
    {/* On the bottom edge rather than the top: it sits under the figure it belongs to,
        and it is the one part of the card allowed to carry the category's colour at full
        strength, so the row can be read along without reading a label. */}
    <span
      aria-hidden
      className={`absolute inset-x-0 bottom-0 h-0.5 transition-opacity duration-150 ${active ? "opacity-100" : "opacity-0"}`}
      style={{ background: color }}
    />
    {/* Name and figure start at the top edge, with the chip parked in the corner beside
        them: read down the card it is label then figure then count, and the icon is a
        mark to find the card by rather than a step on the way into it. */}
    <div className="flex w-full items-start gap-2">
      <div className="min-w-0 flex-1">
        {/* Sentence case at a normal weight rather than bold small caps: eight headings
            shouting is what made the old row hard to read past. The picked one darkens
            instead of changing colour. */}
        <p className={`truncate text-[11px] transition-colors sm:text-xs ${active ? "font-semibold text-slate-900" : "font-medium text-slate-500"}`}>{label}</p>
        {/* tabular-nums so eight figures standing side by side line up on their digits
            instead of jittering with whatever numerals each one happens to hold. */}
        <p className={`mt-1 text-base font-semibold tabular-nums tracking-tight sm:text-[18px] sm:leading-6 ${
          muted && !active ? "text-slate-400" : "text-slate-900"
        }`}>{value}</p>
        <p className="mt-0.5 truncate text-[10px] leading-tight text-slate-400 sm:text-[11px]">{sub}</p>
      </div>
      {/* Tinted while it waits, solid once picked. The chip is the only thing on the card
          that changes colour, which is what keeps the change quiet enough to sit in a row
          of eight. */}
      <span
        aria-hidden
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors duration-150"
        style={active ? { background: color, color: "#fff" } : { background: `${color}14`, color }}
      >
        {Icon && <Icon className="h-3.5 w-3.5" />}
      </span>
    </div>
  </button>
);

const PAYMENT_MODE_STYLES = {
  cash: "bg-emerald-50 text-emerald-700 border-emerald-200",
  upi: "bg-sky-50 text-sky-700 border-sky-200",
  card: "bg-violet-50 text-violet-700 border-violet-200",
  account_transfer: "bg-cyan-50 text-cyan-700 border-cyan-200",
  cheque: "bg-amber-50 text-amber-700 border-amber-200",
  partial: "bg-orange-50 text-orange-700 border-orange-200",
};

// Modes whose display name isn't just their key capitalised — without these,
// "account_transfer" would render as "Account_transfer".
const MODE_LABELS = { upi: "UPI", account_transfer: "Account Transfer" };
const formatMode = (mode) => (mode ? (MODE_LABELS[mode] || mode.charAt(0).toUpperCase() + mode.slice(1)) : "—");

const PaymentModeBadge = ({ mode }) => (
  <span className={`inline-flex items-center rounded-[5px] border px-2 py-0.5 text-[10px] font-semibold ${PAYMENT_MODE_STYLES[mode] || "bg-slate-50 text-slate-600 border-slate-200"}`}>
    {formatMode(mode)}
  </span>
);

/**
 * The modes one collection actually arrived in.
 *
 * A fee taken half in cash and half by UPI is recorded as "split" — the right answer to
 * what the payment was, and no answer at all to what came in. This book is about what came
 * in, so a split reads back as the modes it was made of and "Split" is never shown: it is
 * the name of an arrangement, not of money, and a row wearing it told an Accountant
 * looking for their cash nothing.
 *
 * payment_split is [] on everything else, which is nearly every row — see
 * _parse_payment_split in v3_finance.py, which reads the tenders back off the collection.
 */
const modesOf = (tx) => {
  const split = tx?.payment_split || [];
  if (split.length > 0) return split.map((l) => l.mode).filter(Boolean);
  return tx?.payment_mode ? [tx.payment_mode] : [];
};

/** What of one collection landed under a given mode — the whole of it for an ordinary
 *  payment, and only that tender's share of a split. */
const amountInMode = (tx, mode) => {
  const split = tx?.payment_split || [];
  if (split.length === 0) return Number(tx?.gross) || 0;
  return split.reduce((n, l) => (l.mode === mode ? n + (Number(l.amount) || 0) : n), 0);
};

/** One badge per mode, and the breakdown on hover for the rows that have one — the
 *  figures live in the table's own Paid Amount column, so the badges stay a list of
 *  ways rather than a second column of money. */
const PaymentModes = ({ tx }) => {
  const modes = modesOf(tx);
  const split = tx?.payment_split || [];
  if (modes.length === 0) return <PaymentModeBadge mode="" />;
  return (
    <span
      className="inline-flex flex-wrap items-center justify-center gap-1"
      title={split.length > 0 ? split.map((l) => `${fmt(l.amount)} ${formatMode(l.mode)}`).join(" + ") : undefined}
    >
      {modes.map((m, i) => <PaymentModeBadge key={`${m}-${i}`} mode={m} />)}
    </span>
  );
};

/**
 * Accountant Manage — Super Admin's Branch Management > Accountant Management >
 * Accountant Manage, the same view reused read-only-by-nature (it's all reporting,
 * nothing editable) as Branch Admin's own "Accountant Manage" tab, and again as the
 * Accountant's own Summary tab. Three tabs — Summary, Payment Schedule, Discount
 * Applied — all sourced from the same finance/revenue-overview payload, scoped by the
 * date range sharing their tab bar (Payment Schedule excepted: a client's outstanding
 * balance is a right-now figure, not one a collection-date range narrows).
 *
 * @param mode  "online" | "offline", an optional vertical filter only the Accountant's
 *              Summary tab passes (and owns the pills for) — left unset everywhere else.
 * @param canSend  Whether the Send-to-accountant and Pull-back buttons are offered.
 *              Handing a day up is the branch desk's move, so the Accountant's own
 *              Summary tab passes false: from that chair the three piles are something
 *              to read, and the only thing to do with them is sign them off on the
 *              Approvals tab. Everywhere else it stays on.
 */
export const AccountantManageTab = ({ branchId: fixedBranchId, mode, canSend = true }) => {
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState(fixedBranchId || "");
  const [tab, setTab] = useState("summary");
  const [ledger, setLedger] = useState("income");
  // Which of the three piles the income side is showing. Opens on Collected because that
  // is the one with something to do in it.
  const [incomeStage, setIncomeStage] = useState("collected");
  const [sending, setSending] = useState(false);
  const [expenseTotals, setExpenseTotals] = useState({ approved_total: 0, approved_count: 0, pending_count: 0 });
  const [paymentModeFilter, setPaymentModeFilter] = useState("all");
  const [revenueView, setRevenueView] = useState("collected");
  const [preset, setPreset] = useState("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  // The range is typed in a dialog rather than picked inline. Two calendar fields sat in
  // the toolbar and each opened a month grid over the figures behind it; a range is two
  // dates, which is quicker typed than navigated to twice.
  const [showCustom, setShowCustom] = useState(false);
  const [fromText, setFromText] = useState("");
  const [toText, setToText] = useState("");
  // What to fall back to if the dialog is dismissed without a range — leaving the screen
  // on "Custom" with nothing set would show a filter that filters nothing.
  const [presetBeforeCustom, setPresetBeforeCustom] = useState("all");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [viewingLeadId, setViewingLeadId] = useState(null);
  // The receipt for one collection on the ledger, reissued from the desk that keeps it.
  // The eye beside it opens the client; this opens the piece of paper.
  const [receipt, setReceipt] = useState(null);

  useEffect(() => {
    if (fixedBranchId) return;
    getBranches().then(setBranches).catch(() => setBranches([]));
  }, [fixedBranchId]);

  const { startDate, endDate } = useMemo(() => {
    const today = new Date();
    if (preset === "today") return { startDate: toIso(today), endDate: toIso(today) };
    if (preset === "this_week") return { startDate: toIso(startOfWeek(today)), endDate: toIso(today) };
    if (preset === "this_month") return { startDate: toIso(startOfMonth(today)), endDate: toIso(today) };
    if (preset === "custom") return { startDate: customFrom, endDate: customTo };
    return { startDate: "", endDate: "" }; // "all" — no range, every collection ever made
  }, [preset, customFrom, customTo]);

  // "online" | "offline", owned by whichever caller wants the filter (Accountant's own
  // Summary tab) — undefined everywhere else, which getRevenueOverview reads as no filter
  // at all, so Branch Admin's own tab and Branch Management's Analytics are unaffected.
  const load = useCallback(() => {
    if (preset === "custom" && (!customFrom || !customTo)) return;
    setLoading(true);
    getRevenueOverview({
      branch_id: branchId || undefined,
      vertical_mode: mode || undefined,
      start_date: startDate || undefined,
      end_date: endDate || undefined,
    })
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [branchId, mode, startDate, endDate, preset, customFrom, customTo]);

  useEffect(() => { load(); }, [load]);

  // Kept beside the revenue call rather than inside it: this one answers about money going
  // out, takes no date range yet, and a branch with no expenses should not stop the eight
  // revenue cards rendering.
  const loadExpenseTotals = useCallback(() => {
    getFinanceExpenses()
      .then((d) => setExpenseTotals({
        approved_total: d.approved_total || 0,
        approved_count: d.approved_count || 0,
        pending_count: d.pending_count || 0,
      }))
      .catch(() => { /* the card falls back to zero; the panel says why when opened */ });
  }, []);

  useEffect(() => { loadExpenseTotals(); }, [loadExpenseTotals]);

  const openCustom = () => {
    if (preset !== "custom") setPresetBeforeCustom(preset);
    setFromText(isoToManual(customFrom));
    setToText(isoToManual(customTo));
    setShowCustom(true);
  };

  // Named for the boxes they come from, not "fromIso/toIso": a local toIso shadowed the
  // module-level date formatter of that name across this whole component, and the range
  // memo above — which runs at the line it is written on, well before these — reached the
  // local's temporal dead zone. Picking Today or This Week crashed the board outright.
  const customFromIso = manualToIso(fromText);
  const customToIso = manualToIso(toText);
  // Both must parse, and they must be the right way round — a reversed range returns
  // nothing and reads as an empty month rather than as a mistake in the dialog.
  const rangeValid = !!customFromIso && !!customToIso && customFromIso <= customToIso;

  const applyCustom = () => {
    if (!rangeValid) return;
    setCustomFrom(customFromIso);
    setCustomTo(customToIso);
    setPreset("custom");
    setShowCustom(false);
  };

  const dismissCustom = () => {
    setShowCustom(false);
    if (!customFrom || !customTo) setPreset(presetBeforeCustom);
  };

  const k = data?.kpis || {};
  // `data?.x || []` builds a fresh array on every render, so every memo keyed on one was
  // re-running each time and memoising nothing. Held steady here instead.
  const transactions = useMemo(() => data?.transactions || [], [data]);
  const outstanding = useMemo(() => data?.outstanding_clients || [], [data]);

  // How it was paid, which is the one cut left on this list. Whether a collection has
  // been signed off is the Accountant's own Approvals tab, and asking it here too gave a
  // branch two screens answering one question in two places.
  // The stage comes first: every figure on the income side -- the eight tiles, the
  // payment-mode row, the table -- describes one of the three piles, so narrowing to the
  // pile before anything else is what keeps the cards and the rows under them the same
  // money. Filtering afterwards would leave the tiles counting a pile the table is not
  // showing.
  const stagedTxns = useMemo(
    () => transactions.filter((t) => stageOf(t) === incomeStage),
    [transactions, incomeStage],
  );

  // What each pile holds and how many rows it holds it in, for the figure on each pill.
  // Off the whole set rather than the staged one, which is the pile currently being looked
  // at -- and deliberately before the payment-mode cut too: a pill saying what is still
  // waiting to be sent up has to say all of it, not the cash half of it, or pressing Cash
  // would make money look like it had already gone.
  const stagePiles = useMemo(() => {
    const out = {
      collected: { count: 0, total: 0 },
      requested: { count: 0, total: 0 },
      approved: { count: 0, total: 0 },
    };
    transactions.forEach((t) => {
      const pile = out[stageOf(t)];
      pile.count += 1;
      pile.total += Number(t.gross) || 0;
    });
    return out;
  }, [transactions]);

  const filteredTxns = useMemo(() => {
    if (paymentModeFilter === "all") return stagedTxns;
    return stagedTxns
      .filter((t) => modesOf(t).includes(paymentModeFilter))
      // A split belongs under both its modes, but only for the part that arrived that
      // way: Cash on a Rs.8,000 cash + Rs.4,000 UPI payment is Rs.8,000, and carrying the
      // whole Rs.12,000 into both pills would make the two figures add to more than was
      // ever collected. The row is rewritten to the tender being asked about, so the cards
      // above and the amount on the row are the same money.
      .map((t) => {
        const split = t.payment_split || [];
        if (split.length === 0) return t;
        const amount = amountInMode(t, paymentModeFilter);
        return {
          ...t,
          gross: amount,
          net: amount,
          payment_split: split.filter((l) => l.mode === paymentModeFilter),
        };
      });
  }, [stagedTxns, paymentModeFilter]);

  /**
   * Send everything currently in view up to the accountant, or pull it back.
   *
   * Everything in view rather than a set of ticked boxes: what a branch actually does at
   * the end of a day is hand the day over, and the filters above already say which day,
   * which branch and which payment mode. A column of forty checkboxes is forty chances to
   * miss one, and the row that gets missed is the one nobody notices is missing.
   */
  const sendStage = async (pull = false) => {
    const ids = filteredTxns.map((t) => t.id).filter(Boolean);
    if (!ids.length) { toast.message("There is nothing in view to send"); return; }
    setSending(true);
    try {
      const res = pull ? await unrequestTransactions(ids) : await requestTransactions(ids);
      toast.success(res?.message || (pull ? "Pulled back" : "Sent to the accountant"));
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || (pull ? "Could not pull those back" : "Could not send those"));
    } finally {
      setSending(false);
    }
  };

  // Every card's figure and the count under it, from one pass over whichever set the
  // filters above left standing.
  const sums = useMemo(() => {
    const totals = { collected: 0, consultation: 0, session: 0, diet: 0, store: 0, zumba: 0, rehab: 0, fitness: 0 };
    const counts = { collected: 0, consultation: 0, session: 0, diet: 0, store: 0, zumba: 0, rehab: 0, fitness: 0 };
    filteredTxns.forEach((t) => {
      const amt = Number(t.gross) || 0;
      totals.collected += amt;
      counts.collected += 1;
      if (totals[t.source] !== undefined) {
        totals[t.source] += amt;
        counts[t.source] += 1;
      }
    });
    return { totals, counts };
  }, [filteredTxns]);

  // The same rows the cards above were summed from, grouped by branch -- deliberately
  // not the payload's own by_branch, which ignores the approval view and the payment
  // mode pills and would part company with the cards the moment either was touched.
  //
  // Here because the cards and the branches did not agree and this page gave no way to
  // see why. Money whose client was deleted, never given a branch, or left pointing at
  // a branch that no longer exists counts in every total and belongs to no branch that
  // can be selected, so switching the dropdown branch by branch could never find it.
  const branchRows = useMemo(() => {
    const acc = new Map();
    filteredTxns.forEach((t) => {
      const name = t.branch_name || UNPLACED[0];
      const row = acc.get(name) || { name, total: 0, consultation: 0, session: 0, diet: 0, store: 0, zumba: 0, rehab: 0, fitness: 0 };
      const amt = Number(t.gross) || 0;
      row.total += amt;
      if (row[t.source] !== undefined) row[t.source] += amt;
      acc.set(name, row);
    });
    return [...acc.values()].sort((a, b) => b.total - a.total);
  }, [filteredTxns]);

  const unplacedTotal = useMemo(
    () => branchRows.filter((r) => UNPLACED.includes(r.name)).reduce((sum, r) => sum + r.total, 0),
    [branchRows],
  );

  // Every collection taken below its listed price, biggest concession first — not run
  // through the Collected/Approved/Pending filter above, since a discount is a fact about
  // the collection itself, independent of whether it's since been signed off.
  const discountedTxns = useMemo(
    () => transactions
      .filter((t) => (Number(t.discount) || 0) > 0)
      .sort((a, b) => (Number(b.discount) || 0) - (Number(a.discount) || 0)),
    [transactions],
  );

  // What the figures below are actually scoped to, said in words. Read off the same state
  // the controls set, so it cannot drift from them the way a hand-written caption would.
  const scopeLabel = [
    fixedBranchId || branchId
      ? (branches.find((b) => b.id === (fixedBranchId || branchId))?.branch_name || "This branch")
      : "All branches",
    tab === "closing"
      ? "day-end count"
      : tab === "closebooks"
      ? "closed books"
      : preset === "custom" && customFrom && customTo
      ? `${isoToManual(customFrom)} to ${isoToManual(customTo)}`
      : (DATE_PRESETS.find((d) => d.key === preset)?.label || "All") + " to date",
  ].join(" \u00b7 ");

  return (
    <div className="space-y-4" data-testid="accountant-manage-tab">
      {/* The page says what it is before it says what the numbers are. */}
      <div className="flex flex-wrap items-end justify-between gap-3" data-testid="accountant-manage-header">
        <div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight text-slate-900">Accountant Manage</h2>
          <p className="mt-0.5 text-sm text-slate-600">
            Every rupee this branch took and spent, what has been signed off, and what it counted at close.
          </p>
        </div>
        {/* The scope as a chip rather than a third row of controls: it is there to be read
            back, not set -- the controls that set it are directly underneath. */}
        <span
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600"
          data-testid="accountant-manage-scope"
        >
          <CalendarDays className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
          {scopeLabel}
        </span>
      </div>

      {/* One row, read left to right: which branch, then which view of it, then the range
          it is narrowed to. Branch and range each used to hold a band of their own — three
          rows of controls above the figures, with the tabs stranded between the two things
          that scope them. The branch select keeps its condition: the boards that pass a
          fixed branch have nothing to choose, and the row starts at the tabs for them. */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm" data-testid="accountant-manage-maintabs">
        {!fixedBranchId && (
          // The divider is desktop-only: once this wraps on a phone it is a line across
          // the middle of a row rather than between two of them.
          <div className="flex items-center gap-2 pl-1.5 sm:border-r sm:border-slate-200 sm:pr-3">
            <label htmlFor="accountant-manage-branch" className="text-xs font-medium text-slate-600">Branch:</label>
            <select
              id="accountant-manage-branch"
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="h-9 rounded-md border border-slate-200 px-2 text-sm text-slate-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1"
              data-testid="accountant-manage-branch-select"
            >
              <option value="">All Branches</option>
              {branches.map((br) => <option key={br.id} value={br.id}>{br.branch_name}</option>)}
            </select>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {MAIN_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`min-w-0 rounded-md px-3.5 py-2 text-center text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${mainTabClasses(t, tab === t.key)}`}
              data-testid={`accountant-manage-maintab-${t.key}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {/* ml-auto so the range sits at the far end on a desk and simply wraps to the next
            line on a phone, where there is no far end to sit at.

            Hidden on Closing Balance, which carries its own Daily/Weekly/Monthly/Custom
            control because it narrows a different thing: this range narrows a ledger, that
            one picks which evenings are being counted or read back. Two date controls over
            one set of figures is a question about which of them is in force, and the answer
            -- that the range governs everything except the panel below it -- is not one a
            toolbar can say. */}
        {tab !== "closing" && tab !== "closebooks" && (
        <div className="ml-auto flex flex-wrap items-center gap-3" data-testid="accountant-manage-date-filter">
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            {DATE_PRESETS.map((p) => (
              <button
                key={p.key}
                onClick={() => (p.key === "custom" ? openCustom() : setPreset(p.key))}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${preset === p.key ? "bg-sky-500 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`}
                data-testid={`accountant-manage-preset-${p.key}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {/* The range that is actually in force, and the way back into the dialog to
              change it — the figures are filtered by it, so it has to be readable without
              opening anything. */}
          {preset === "custom" && customFrom && customTo && (
            <button
              type="button"
              onClick={openCustom}
              className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:border-sky-300 hover:text-sky-600"
              data-testid="accountant-manage-custom-chip"
            >
              <CalendarDays className="h-3.5 w-3.5" />
              {isoToManual(customFrom)} to {isoToManual(customTo)}
            </button>
          )}
          <Button
            onClick={load}
            disabled={loading}
            title="Refresh"
            aria-label="Refresh"
            className="h-9 w-9 shrink-0 bg-slate-500 p-0 text-white hover:bg-slate-600"
            data-testid="accountant-manage-refresh"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
        )}
      </div>

      {loading && !data ? (
        <p className="py-10 text-center text-sm text-slate-400">Loading...</p>
      ) : tab === "summary" ? (
        <div className="space-y-4" data-testid="accountant-manage-summary">
          {/* The one question this tab opens on: money in, or money out. Two cards
              rather than a segmented pill, because the choice carries its own figure —
              a switch that also says what is on each side of it, in the shape the cards
              below it already use.

              Green for money in and rose for money out: the colours the Total Revenue
              tile and the Accountant's own Total Expense card were already wearing, so a
              figure does not change colour depending on which screen it is read on. The
              picked one is ringed rather than filled, or the unpicked side would read as
              switched off rather than as the other half of the same total. */}
          <div className="grid grid-cols-2 gap-3" data-testid="accountant-manage-ledger-filter">
            {LEDGER_VIEWS.map((v) => {
              const on = ledger === v.key;
              const income = v.key === "income";
              const tone = income
                ? { ring: "#059669", border: "border-emerald-200", bg: "bg-emerald-50/60", text: "text-emerald-700", sub: "text-emerald-600/80" }
                : { ring: "#e11d48", border: "border-rose-200", bg: "bg-rose-50/60", text: "text-rose-700", sub: "text-rose-600/80" };
              const value = income ? sums.totals.collected : expenseTotals.approved_total;
              const count = income ? sums.counts.collected : expenseTotals.approved_count;
              const noun = income ? "payment" : "expense";
              return (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => setLedger(v.key)}
                  aria-pressed={on}
                  className={`rounded-xl border ${tone.border} ${tone.bg} p-4 text-left transition ${on ? "" : "opacity-70 hover:opacity-100"}`}
                  style={on ? { boxShadow: `0 0 0 2px ${tone.ring}` } : undefined}
                  data-testid={`accountant-manage-ledger-${v.key}`}
                >
                  <p className={`text-[11px] font-bold uppercase tracking-wider ${tone.text}`}>{v.label}</p>
                  <p className={`mt-1 text-2xl font-bold ${tone.text}`}>{fmt(value)}</p>
                  <p className={`text-[11px] ${tone.sub}`}>
                    {countLabel(count, noun)}
                    {/* Said on the card rather than only inside, so a branch does not have
                        to open Expenses to find out something is waiting on somebody. */}
                    {!income && expenseTotals.pending_count > 0
                      ? ` \u00b7 ${expenseTotals.pending_count} awaiting approval`
                      : ""}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Expenses is its own ledger, not a filter of this one: nothing above it —
              the revenue tiles, the source table, the payment-mode row — describes money
              going out, so the whole of the income side steps aside for it rather than
              being reused with different numbers in it. */}
          {ledger === "expenses" && <BranchExpensesPanel onChanged={loadExpenseTotals} branchId={branchId} />}

          {ledger === "income" && (
          <>
          {/* The three piles, and the one thing to do with the pile being looked at. Above
              the revenue tiles because it scopes them: the eight figures below are this
              pile's, not the day's. */}
          <div className="flex flex-wrap items-center gap-2" data-testid="accountant-manage-income-stages">
            {/* Each pile says what it holds, not just how many rows it holds it in -- the
                same pills the expense side shows, and for the same reason: what is still
                sitting at the desk and what has been signed off are figures, and a branch
                had to press through all three to add them up.

                Still the filter it always was, so the picked one is ringed and the other
                two step back rather than switching off -- the shape the Income/Expenses
                cards above already use for a choice that carries its own number. */}
            <div className="flex flex-wrap items-center gap-2">
              {INCOME_STAGES.map((st) => {
                const active = incomeStage === st.key;
                const pile = stagePiles[st.key];
                return (
                  <button
                    key={st.key}
                    type="button"
                    title={st.hint}
                    onClick={() => setIncomeStage(st.key)}
                    aria-pressed={active}
                    className={`inline-flex items-center gap-2 rounded-full border ${st.tone.border} ${st.tone.bg} py-1.5 pl-3 pr-4 transition ${
                      active ? "" : "opacity-60 hover:opacity-100"
                    }`}
                    style={active ? { boxShadow: `0 0 0 2px ${st.tone.ring}` } : undefined}
                    data-testid={`accountant-manage-income-stage-${st.key}`}
                  >
                    <span className={`h-2 w-2 shrink-0 rounded-full ${st.tone.dot}`} />
                    <span className={`text-[11px] font-bold uppercase tracking-wider ${st.tone.text}`}>{st.label}</span>
                    <span className={`text-sm font-bold tabular-nums ${st.tone.text}`}>{fmt(pile.total)}</span>
                    <span className={`text-[11px] ${st.tone.sub}`}>· {countLabel(pile.count, "payment")}</span>
                  </button>
                );
              })}
            </div>

            {/* Acts on what the filters above have left in view -- see sendStage. Absent
                on Approved, where there is nothing left to do: taking an approval back is
                the accountant's own undo, not the branch's. Absent entirely where canSend
                is off, which is the accountant's own copy of this tab -- nobody sends a
                day up to themselves. */}
            {canSend && incomeStage === "collected" && (
              <Button
                onClick={() => sendStage(false)}
                disabled={sending || filteredTxns.length === 0}
                className="h-9 bg-emerald-600 text-xs text-white hover:bg-emerald-700"
                data-testid="accountant-manage-send-for-approval"
              >
                <Send className="mr-1.5 h-3.5 w-3.5" />
                {sending ? "Sending…" : `Send ${filteredTxns.length} to accountant`}
              </Button>
            )}
            {canSend && incomeStage === "requested" && (
              <Button
                onClick={() => sendStage(true)}
                disabled={sending || filteredTxns.length === 0}
                variant="outline"
                className="h-9 text-xs"
                data-testid="accountant-manage-pull-back"
              >
                <Undo2 className="mr-1.5 h-3.5 w-3.5" />
                {sending ? "Pulling back…" : `Pull ${filteredTxns.length} back`}
              </Button>
            )}
            <p className="text-[11px] text-slate-400">
              {INCOME_STAGES.find((st) => st.key === incomeStage)?.hint}
            </p>
          </div>

          {/* All eight on one line where there is room for eight, stepping down to four
              and then two rather than squeezing: at lg an eighth of the width is narrower
              than the card's own text column.

              Total stands in the line rather than above it. It is the sum of the seven
              beside it and could be argued into a card of its own -- it had one for a
              while -- but a row read across wants one card repeated, and drawing one of
              them bigger turned the other seven into its footnotes. */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3 xl:grid-cols-8">
            {REVENUE_VIEWS.map((v) => (
              <RevenueTile
                key={v.key}
                label={v.short}
                value={fmt(sums.totals[v.key])}
                sub={countLabel(sums.counts[v.key], revenueNoun(v.key))}
                icon={v.icon}
                color={v.color}
                active={revenueView === v.key}
                muted={!sums.totals[v.key]}
                onClick={() => setRevenueView(v.key)}
                testid={`revenue-kpi-${v.label.toLowerCase().replace(/\s+/g, "-")}`}
              />
            ))}
          </div>

          {/* Under the cards, because it cuts them. On the top line it sat beside Income
              and Expenses looking like a second choice of the same kind, when it is a
              filter of what one of them shows — every figure above moves when it is
              pressed. Same set a Branch Admin picks from when collecting the fee in the
              first place: how it was paid, not whether it has been signed off.

              No ledger gate on it any more: it renders inside the income side, so there
              is no longer an Expenses view for it to have to hide from. */}
          <div className="flex flex-wrap items-center gap-2" data-testid="accountant-manage-payment-mode-filter">
            {PAYMENT_MODES.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setPaymentModeFilter(key)}
                className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
                  paymentModeFilter === key ? "border-indigo-600 bg-indigo-600 text-white shadow-sm" : "border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-600"
                }`}
                data-testid={`accountant-manage-payment-mode-${key}`}
              >
                {label}
              </button>
            ))}
          </div>

          {!branchId && branchRows.length > 1 && (
            <div className="rounded-md border border-slate-200 bg-white" data-testid="accountant-manage-by-branch">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5">
                <h3 className="text-sm font-semibold text-slate-700">Revenue by branch</h3>
                {unplacedTotal > 0 && (
                  <p className="text-[11px] text-amber-700" data-testid="accountant-manage-unplaced-note">
                    {fmt(unplacedTotal)} belongs to no branch that can be selected
                  </p>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                      <th className="px-4 py-2 text-left font-semibold">Branch</th>
                      {CATEGORY_VIEWS.map((v) => (
                        <th key={v.key} className="whitespace-nowrap px-3 py-2 text-right font-semibold">
                          {v.short}
                        </th>
                      ))}
                      <th className="px-4 py-2 text-right font-semibold">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {branchRows.map((r) => (
                      <tr
                        key={r.name}
                        className={`border-b border-slate-100 ${UNPLACED.includes(r.name) ? "bg-amber-50" : ""}`}
                        data-testid={`accountant-manage-branch-row-${r.name}`}
                      >
                        <td className="whitespace-nowrap px-4 py-2 font-medium text-slate-700">{r.name}</td>
                        {CATEGORY_VIEWS.map((v) => (
                          <td key={v.key} className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-600">
                            {r[v.key] ? fmt(r[v.key]) : "—"}
                          </td>
                        ))}
                        <td className="whitespace-nowrap px-4 py-2 text-right font-semibold tabular-nums text-slate-800">{fmt(r.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold text-slate-800">
                      <td className="px-4 py-2">All branches</td>
                      {CATEGORY_VIEWS.map((v) => (
                        <td key={v.key} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{fmt(sums.totals[v.key])}</td>
                      ))}
                      <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{fmt(sums.totals.collected)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          <RevenueDetailTable
            title={REVENUE_VIEWS.find((v) => v.key === revenueView)?.label}
            rows={revenueView === "collected" ? filteredTxns : filteredTxns.filter((t) => t.source === revenueView)}
            onView={setViewingLeadId}
            onReceipt={(tx) => setReceipt(receiptForTxn(tx))}
          />
          </>
          )}
        </div>
      ) : tab === "schedule" ? (
        <OutstandingAmountBoard rows={outstanding} onView={setViewingLeadId} onChanged={load} />
      ) : tab === "closebooks" ? (
        // Reads a month of signed-off days and nothing else, so it takes the branch from
        // up here and picks its own month -- see the panel.
        <CloseBookHistoryPanel branchId={branchId} />
      ) : tab === "closing" ? (
        // Counts one evening at a time and reads a week or a month of them back, on its
        // own period control rather than the tab's range -- see the panel. The branch is
        // the only thing it takes from up here.
        <ClosingBalancePanel branchId={branchId} />
      ) : (
        <DiscountAppliedBoard rows={discountedTxns} onView={setViewingLeadId} onReceipt={(tx) => setReceipt(receiptForTxn(tx))} />
      )}

      {showCustom && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) dismissCustom(); }}
          data-testid="accountant-manage-custom-modal"
        >
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <p className="text-base font-semibold text-slate-900">Custom Range</p>
              <button
                type="button"
                onClick={dismissCustom}
                className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100"
                aria-label="Close"
                data-testid="accountant-manage-custom-close"
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
                        : "border-slate-200 focus:border-sky-400 focus:ring-sky-400"
                    }`}
                    data-testid={`accountant-manage-custom-${f.tid}`}
                  />
                </div>
              ))}
              {/* Says which of the two ways it is wrong, rather than only refusing to apply. */}
              <p className="text-[11px] text-slate-400" data-testid="accountant-manage-custom-hint">
                {customFromIso && customToIso && customFromIso > customToIso
                  ? "The From date is after the To date."
                  : "Type both dates as DD-MM-YYYY, e.g. 04-08-2026."}
              </p>
            </div>

            <div className="mt-5 flex gap-2">
              <Button variant="outline" onClick={dismissCustom} className="flex-1" data-testid="accountant-manage-custom-cancel">Cancel</Button>
              <Button
                onClick={applyCustom}
                disabled={!rangeValid}
                className="flex-1 bg-sky-600 hover:bg-sky-700"
                data-testid="accountant-manage-custom-apply"
              >
                Apply
              </Button>
            </div>
          </div>
        </div>
      )}

      {viewingLeadId && <ClientHistoryModal leadId={viewingLeadId} onClose={() => setViewingLeadId(null)} onChanged={load} />}
      <ReceiptDialog receipt={receipt} onClose={() => setReceipt(null)} testid="accountant-receipt" />
    </div>
  );
};

// One card per fee type, mirroring Summary's row. The first four figures this tab carried
// — total, listed value, average % and count — could not filter anything between them: all
// four described the same set of rows, so three of the cards would have been the same
// filter as the first. Splitting by source is the cut that actually partitions the list,
// and every one of those figures survives on the cards below.
//
// No Store card. A counter sale is rung at the shelf price and carries no discount, so it
// could only ever read Rs.0.
const DISCOUNT_VIEWS = [
  { key: "all", label: "Total Discount", icon: Wallet, color: "#d97706" },
  { key: "consultation", label: "Consultation", icon: Stethoscope, color: "#0284c7" },
  { key: "session", label: "Session", icon: Activity, color: "#7c3aed" },
  { key: "diet", label: "Diet", icon: Salad, color: "#059669" },
];

/**
 * Discount Applied — every collection settled below its listed price.
 *
 * The money here was never owed and never will be: the OS treats a negotiated fee as
 * settled in full the moment it is confirmed, so none of it appears under Payment
 * Schedule. Which means this is the only place the concessions a branch has granted are
 * countable at all.
 *
 * Each row is one confirmed collection, not one client, because the discount was a
 * decision taken at that moment — rolling a client's two visits together would average
 * away the one that was actually negotiated.
 */
const DiscountAppliedBoard = ({ rows, onView, onReceipt }) => {
  const [view, setView] = useState("all");

  // Falls back to listed = collected + discount when original_amount is missing, which is
  // every collection taken before v3_packages began recording the listed price.
  const listedOf = (tx) => Number(tx.original_amount) || (Number(tx.gross) || 0) + (Number(tx.discount) || 0);
  const pctOf = (tx) => { const l = listedOf(tx); return l > 0 ? (Number(tx.discount) / l) * 100 : 0; };

  // Every card's figures, and the rows behind whichever is selected, from one pass.
  const slices = useMemo(() => {
    const acc = {};
    DISCOUNT_VIEWS.forEach((v) => {
      const list = v.key === "all" ? rows : rows.filter((t) => t.source === v.key);
      const given = list.reduce((s, t) => s + (Number(t.discount) || 0), 0);
      // Against the listed price, not against what was collected: Rs.200 off a Rs.1000 fee
      // is 20% off, and dividing by the Rs.800 taken would call it 25%.
      const listed = list.reduce((s, t) => s + (Number(t.original_amount) || (Number(t.gross) || 0) + (Number(t.discount) || 0)), 0);
      acc[v.key] = { list, given, listed, pct: listed > 0 ? (given / listed) * 100 : 0 };
    });
    return acc;
  }, [rows]);

  const active = slices[view] || slices.all;
  const visible = active.list;

  return (
    <div className="space-y-4" data-testid="accountant-manage-discount">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {DISCOUNT_VIEWS.map((v) => {
          const s = slices[v.key];
          return (
            <StatTile
              key={v.key}
              label={v.label}
              value={fmt(s.given)}
              // The three figures the single-total card used to spend a tile each on:
              // how many payments, how deep the cut, and what it was cut from.
              sub={`${countLabel(s.list.length, "payment")} · ${s.pct.toFixed(1)}% of ${fmt(s.listed)}`}
              icon={v.icon}
              color={v.color}
              active={view === v.key}
              onClick={() => setView(v.key)}
              testid={`discount-kpi-${v.key}`}
            />
          );
        })}
      </div>

      <Card>
        <CardContent className="p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {view === "all" ? "Discount Applied" : `${DISCOUNT_VIEWS.find((v) => v.key === view)?.label} Discounts`}
          </p>

          <div className="space-y-2 md:hidden" data-testid="discount-detail-mobile">
            {visible.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-200 px-3 py-8 text-center text-sm text-slate-400">No discounted collections yet.</p>
            ) : visible.map((tx, i) => (
              <div
                key={tx.id}
                role={onView ? "button" : undefined}
                tabIndex={onView ? 0 : undefined}
                onClick={() => onView && onView(tx.lead_id)}
                onKeyDown={(e) => { if (onView && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onView(tx.lead_id); } }}
                className={`rounded-xl border border-slate-200 bg-white p-3 ${onView ? "cursor-pointer active:bg-slate-50" : ""}`}
                data-testid={`discount-detail-card-${tx.id}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-800">
                      <span className="mr-1.5 font-normal text-slate-400">{i + 1}.</span>
                      {tx.client_name || "Unknown"}
                    </p>
                    <p className="truncate text-xs text-slate-500">{tx.phone || "—"}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-bold text-amber-600">−{fmt(tx.discount)}</p>
                    <p className="text-[11px] text-slate-400">{pctOf(tx).toFixed(1)}% off</p>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-slate-100 pt-2 text-[11px] text-slate-500">
                  <span className="line-through">{fmt(listedOf(tx))}</span>
                  <span className="font-semibold text-emerald-600">{fmt(tx.gross)}</span>
                  <span className="capitalize">{tx.source}</span>
                  <span>{(tx.date || "").slice(0, 10)}</span>
                  {onView && <Eye className="ml-auto h-3.5 w-3.5 shrink-0 text-slate-300" />}
                </div>
              </div>
            ))}
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[56rem] table-fixed border-separate border-spacing-x-0 border-spacing-y-2 text-sm">
              <thead>
                <tr>
                  <th className="w-[4%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">S.No</th>
                  <th className="w-[16%] px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">Client</th>
                  <th className="w-[11%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Phone</th>
                  <th className="w-[10%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Paid For</th>
                  <th className="w-[10%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Listed Price</th>
                  <th className="w-[10%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Collected</th>
                  <th className="w-[10%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Discount</th>
                  <th className="w-[8%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">%</th>
                  <th className="w-[9%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Date</th>
                  <th className="w-[12%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Branch</th>
                  <th className="w-[7%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">View</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr><td colSpan={11} className="px-3 py-8 text-center text-sm text-slate-400">No discounted collections yet.</td></tr>
                ) : visible.map((tx, i) => (
                  <tr key={tx.id} data-testid={`discount-detail-row-${tx.id}`}>
                    <td className="rounded-l-[5px] border-y border-l border-slate-200 bg-white px-3 py-2 text-center text-slate-400">{i + 1}</td>
                    <td className="border-y border-slate-200 bg-white px-3 py-2 font-medium text-slate-800">{tx.client_name || "Unknown"}</td>
                    <td className="border-y border-slate-200 bg-white px-3 py-2 text-center text-slate-600">{tx.phone || "—"}</td>
                    <td className="border-y border-slate-200 bg-white px-3 py-2 text-center capitalize text-slate-600">{tx.source}</td>
                    <td className="border-y border-slate-200 bg-white px-3 py-2 text-center text-slate-500 line-through">{fmt(listedOf(tx))}</td>
                    <td className="border-y border-slate-200 bg-white px-3 py-2 text-center font-semibold text-emerald-600">{fmt(tx.gross)}</td>
                    <td className="border-y border-slate-200 bg-white px-3 py-2 text-center font-semibold text-amber-600">−{fmt(tx.discount)}</td>
                    <td className="border-y border-slate-200 bg-white px-3 py-2 text-center">
                      <span className="inline-flex items-center rounded-[5px] border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                        {pctOf(tx).toFixed(1)}%
                      </span>
                    </td>
                    <td className="border-y border-slate-200 bg-white px-3 py-2 text-center text-slate-600">{(tx.date || "").slice(0, 10)}</td>
                    <td className="border-y border-slate-200 bg-white px-3 py-2 text-center text-slate-600">{tx.branch_name || "—"}</td>
                    <td className="rounded-r-[5px] border-y border-r border-slate-200 bg-white px-3 py-2 text-center">
                      {/* Two things a row can be opened for, and they are not the same
                          thing: the eye opens the client behind the money, the receipt
                          opens the money itself. This column carried only the first, so
                          a desk asked for a copy of a bill had to open the client, find
                          the fee and reissue it from there — or, before the fee cards
                          could reissue at all, could not produce one. */}
                      <div className="flex items-center justify-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => onView && onView(tx.lead_id)}
                          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-sky-600"
                          title="Open this client"
                          aria-label="Open this client"
                          data-testid={`discount-detail-view-${tx.id}`}
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        {/* Only where the collection has a transaction id. Rows taken
                            before ids existed are real money and still list, but a
                            receipt with no number on it proves nothing. */}
                        {onReceipt && tx.transaction_id && (
                          <button
                            type="button"
                            onClick={() => onReceipt(tx)}
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-emerald-600"
                            title="Receipt — print, send or download it again"
                            aria-label="Receipt"
                            data-testid={`discount-detail-receipt-${tx.id}`}
                          >
                            <Receipt className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

// One row per client, not one per collection. A lead who paid a consultation fee, then a
// session package, then rehab arrived here as three rows that read as three different
// people on the one page whose job is "who has paid us what". The money is the client's,
// so the row is the client's, with the collections behind it folded underneath and opened
// on demand — nothing is dropped, it is only stacked.
//
// Money with no lead behind it — a counter sale, a Zumba or Fitness registration — carries
// no lead_id at all (see the store/zumba/fitness loops in v3_finance.py's revenue-overview),
// so it keys on its own record and stays the single row it has always been rather than
// collapsing a day of counter sales into one client called "Counter sale".
const groupPaymentsByClient = (rows) => {
  const acc = new Map();
  rows.forEach((tx, i) => {
    const key = tx.lead_id || `txn:${tx.id || i}`;
    let g = acc.get(key);
    if (!g) {
      g = {
        key,
        lead_id: tx.lead_id || "",
        client_name: tx.client_name || "Unknown",
        phone: "",
        total: 0,
        payments: [],
        sources: [],
        modes: [],
        branches: [],
      };
      acc.set(key, g);
    }
    g.total += Number(tx.gross) || 0;
    g.payments.push(tx);
    if (!g.phone && tx.phone) g.phone = tx.phone;
    // Distinct, in the order they were met: one client can pay for three things three
    // ways across two branches, and the collapsed row has to say so without printing
    // "Cash" once per collection.
    if (tx.source && !g.sources.includes(tx.source)) g.sources.push(tx.source);
    // Each way the money actually came in, so a split contributes Cash and UPI to the
    // collapsed row rather than a mode nobody can bank.
    modesOf(tx).forEach((m) => { if (!g.modes.includes(m)) g.modes.push(m); });
    if (tx.branch_name && !g.branches.includes(tx.branch_name)) g.branches.push(tx.branch_name);
  });
  return [...acc.values()]
    .map((g) => {
      const payments = [...g.payments].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
      return { ...g, payments, latest: payments[0]?.date || "", oldest: payments[payments.length - 1]?.date || "" };
    })
    // A client sits where their newest collection puts them — the same newest-first order
    // the ungrouped list arrived in, which is the order a day's takings are read in.
    .sort((a, b) => String(b.latest).localeCompare(String(a.latest)));
};

const dayOf = (d) => (d || "").slice(0, 10);
// Two of anything is what these columns hold; the rest are one click away with a row each,
// so the collapsed cell counts them rather than wrapping to four lines.
const firstTwo = (list) => ({ shown: list.slice(0, 2), extra: Math.max(0, list.length - 2) });

const RevenueDetailTable = ({ title, rows, onView, onReceipt }) => {
  const groups = useMemo(() => groupPaymentsByClient(rows), [rows]);
  // Keyed by group, so narrowing the list above leaves stale keys behind harmlessly
  // rather than opening the wrong client.
  const [open, setOpen] = useState(() => new Set());

  const expandable = useMemo(() => groups.filter((g) => g.payments.length > 1), [groups]);
  const allOpen = expandable.length > 0 && expandable.every((g) => open.has(g.key));

  const toggle = (key) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  const toggleAll = () => setOpen(allOpen ? new Set() : new Set(expandable.map((g) => g.key)));

  return (
    <Card data-testid="accountant-manage-revenue-detail">
      <CardContent className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
          <div className="flex items-center gap-3">
            {/* The row count and the payment count are no longer the same number, so both
                are stated rather than left to be counted off a list that now collapses. */}
            <p className="text-[11px] text-slate-400" data-testid="revenue-detail-counts">
              {countLabel(groups.length, "client")} · {countLabel(rows.length, "payment")}
            </p>
            {expandable.length > 0 && (
              <button
                type="button"
                onClick={toggleAll}
                className="rounded-md border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-600 transition hover:border-sky-300 hover:text-sky-600"
                data-testid="revenue-detail-toggle-all"
              >
                {allOpen ? "Collapse all" : "Expand all"}
              </button>
            )}
          </div>
        </div>

        {/* Cards on a phone. Ten columns behind a 52rem scroll means every one of them is
            off-screen except the first two, and a transaction is only useful read whole —
            who paid, how much, by what, when. The collections are listed inside the card
            rather than behind an expander: a phone row is already a block, and one line
            per payment is cheaper than a tap. */}
        <div className="space-y-2 md:hidden" data-testid="revenue-detail-mobile">
          {groups.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 px-3 py-8 text-center text-sm text-slate-400">No transactions yet.</p>
          ) : groups.map((g, i) => (
            <div
              key={g.key}
              role={onView ? "button" : undefined}
              tabIndex={onView ? 0 : undefined}
              onClick={() => onView && onView(g.lead_id)}
              onKeyDown={(e) => {
                if (onView && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onView(g.lead_id); }
              }}
              className={`rounded-xl border border-slate-200 bg-white p-3 ${onView ? "cursor-pointer active:bg-slate-50" : ""}`}
              data-testid={`revenue-detail-card-${g.key}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-800">
                    <span className="mr-1.5 font-normal text-slate-400">{i + 1}.</span>
                    {g.client_name}
                  </p>
                  <p className="truncate text-xs text-slate-500">{g.phone || "—"}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-bold text-emerald-600">{fmt(g.total)}</p>
                  {g.payments.length > 1 && (
                    <p className="text-[10px] text-slate-400">{countLabel(g.payments.length, "payment")}</p>
                  )}
                </div>
              </div>
              <div className="mt-2 space-y-1 border-t border-slate-100 pt-2">
                {g.payments.map((p) => (
                  <div key={p.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
                    <span className="capitalize">{p.source}</span>
                    <PaymentModes tx={p} />
                    <span>{dayOf(p.date)}</span>
                    {g.payments.length > 1 && <span className="ml-auto font-semibold text-slate-600">{fmt(p.gross)}</span>}
                  </div>
                ))}
                {g.branches.length > 0 && (
                  <p className="truncate pt-0.5 text-[11px] text-slate-400">{g.branches.join(" · ")}</p>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="hidden overflow-x-auto md:block">
          {/* table-fixed at w-full squeezes ten columns into a phone's width rather than
              letting the wrapper scroll — the min-width is what makes it scroll instead. */}
          <table className="w-full min-w-[52rem] table-fixed border-separate border-spacing-x-0 border-spacing-y-2 text-sm">
            <thead>
              <tr>
                <th className="w-[4%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">S.No</th>
                <th className="w-[15%] px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">Client</th>
                <th className="w-[14%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Transaction ID</th>
                <th className="w-[12%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Consultation/Session</th>
                <th className="w-[11%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Phone</th>
                <th className="w-[10%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Paid Amount</th>
                <th className="w-[10%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Payment Mode</th>
                <th className="w-[10%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Date</th>
                <th className="w-[9%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Branch</th>
                <th className="w-[5%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">View</th>
              </tr>
            </thead>
            <tbody>
              {groups.length === 0 ? (
                <tr><td colSpan={10} className="px-3 py-8 text-center text-sm text-slate-400">No transactions yet.</td></tr>
              ) : groups.map((g, i) => {
                const many = g.payments.length > 1;
                const isOpen = open.has(g.key);
                const sources = firstTwo(g.sources);
                const modes = firstTwo(g.modes);
                const spansDays = dayOf(g.latest) !== dayOf(g.oldest);
                return [
                  <tr
                    key={g.key}
                    onClick={many ? () => toggle(g.key) : undefined}
                    className={many ? "cursor-pointer" : undefined}
                    data-testid={`revenue-detail-row-${g.key}`}
                  >
                    <td className="rounded-l-[5px] border-y border-l border-slate-200 bg-white px-3 py-2 text-center text-slate-400">{i + 1}</td>
                    <td className="border-y border-slate-200 bg-white px-3 py-2 font-medium text-slate-800">
                      {g.client_name}
                      {many && (
                        <span className="block text-[10px] font-normal text-slate-400">{countLabel(g.payments.length, "payment")}</span>
                      )}
                    </td>
                    {/* One collection still shows its own id. Several cannot, so the cell
                        becomes the way into them instead and each id gets its own row
                        underneath. Blank for collections taken before transaction ids
                        existed — those rows are real money and must still list, so this
                        shows a dash rather than being filtered out. */}
                    <td className="border-y border-slate-200 bg-white px-3 py-2 text-center">
                      {many ? (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); toggle(g.key); }}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 transition hover:border-sky-300 hover:text-sky-600"
                          data-testid={`revenue-detail-expand-${g.key}`}
                        >
                          {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          {countLabel(g.payments.length, "payment")}
                        </button>
                      ) : g.payments[0]?.transaction_id ? (
                        <span className="font-mono text-[11px] text-slate-700" title={g.payments[0].transaction_id}>{g.payments[0].transaction_id}</span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="border-y border-slate-200 bg-white px-3 py-2 text-center text-slate-600">
                      {sources.shown.map(titleCase).join(" · ") || "—"}
                      {sources.extra > 0 && <span className="text-slate-400"> +{sources.extra}</span>}
                    </td>
                    <td className="border-y border-slate-200 bg-white px-3 py-2 text-center text-slate-600">{g.phone || "—"}</td>
                    <td className="border-y border-slate-200 bg-white px-3 py-2 text-center font-semibold text-emerald-600">{fmt(g.total)}</td>
                    <td className="border-y border-slate-200 bg-white px-3 py-2 text-center">
                      <div className="flex flex-wrap items-center justify-center gap-1">
                        {g.modes.length === 0
                          ? <PaymentModeBadge mode="" />
                          : modes.shown.map((m) => <PaymentModeBadge key={m} mode={m} />)}
                        {modes.extra > 0 && <span className="text-[10px] text-slate-400">+{modes.extra}</span>}
                      </div>
                    </td>
                    {/* The newest collection dates the row; a client whose payments span
                        days says so underneath rather than reading as if they all landed
                        on the one date. */}
                    <td className="border-y border-slate-200 bg-white px-3 py-2 text-center text-slate-600">
                      {dayOf(g.latest) || "—"}
                      {spansDays && <span className="block text-[10px] text-slate-400">since {dayOf(g.oldest)}</span>}
                    </td>
                    <td className="border-y border-slate-200 bg-white px-3 py-2 text-center text-slate-600">
                      {g.branches[0] || "—"}
                      {g.branches.length > 1 && <span className="text-slate-400"> +{g.branches.length - 1}</span>}
                    </td>
                    <td className="rounded-r-[5px] border-y border-r border-slate-200 bg-white px-3 py-2 text-center">
                      <div className="flex items-center justify-center gap-0.5">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); if (onView) onView(g.lead_id); }}
                          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-sky-600"
                          title="Open this client"
                          aria-label="Open this client"
                          data-testid={`revenue-detail-view-${g.key}`}
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        {/* A receipt is one collection's, and this row is a client's. So
                            it appears here only where the client made exactly one payment
                            and the two are the same thing; a client with three gets a
                            receipt button on each of the three rows underneath instead,
                            because "the receipt" for that row would have to pick one of
                            them and there is no right answer. */}
                        {onReceipt && !many && g.payments[0]?.transaction_id && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onReceipt(g.payments[0]); }}
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-emerald-600"
                            title="Receipt — print, send or download it again"
                            aria-label="Receipt"
                            data-testid={`revenue-detail-receipt-${g.key}`}
                          >
                            <Receipt className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>,
                  // Each collection exactly as it listed before, minus the client identity
                  // the row above already carries.
                  ...(many && isOpen ? g.payments.map((p) => (
                    <tr key={`${g.key}-${p.id}`} data-testid={`revenue-detail-payment-${p.id}`}>
                      <td className="rounded-l-[5px] border-y border-l-2 border-y-slate-100 border-l-sky-300 bg-slate-50 px-3 py-1.5" />
                      <td className="border-y border-slate-100 bg-slate-50 px-3 py-1.5" />
                      <td className="border-y border-slate-100 bg-slate-50 px-3 py-1.5 text-center">
                        {p.transaction_id
                          ? <span className="font-mono text-[11px] text-slate-600" title={p.transaction_id}>{p.transaction_id}</span>
                          : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="border-y border-slate-100 bg-slate-50 px-3 py-1.5 text-center capitalize text-slate-600">{p.source}</td>
                      <td className="border-y border-slate-100 bg-slate-50 px-3 py-1.5" />
                      <td className="border-y border-slate-100 bg-slate-50 px-3 py-1.5 text-center font-semibold text-emerald-600">{fmt(p.gross)}</td>
                      <td className="border-y border-slate-100 bg-slate-50 px-3 py-1.5 text-center"><PaymentModes tx={p} /></td>
                      <td className="border-y border-slate-100 bg-slate-50 px-3 py-1.5 text-center text-slate-600">{dayOf(p.date)}</td>
                      <td className="border-y border-slate-100 bg-slate-50 px-3 py-1.5 text-center text-slate-600">{p.branch_name || "—"}</td>
                      {/* The one cell on these sub-rows that is not blank. Each of them
                          is a collection in its own right, so each has its own receipt —
                          which is the whole reason the group row above declines to show
                          one. No client button here: the row above is that client. */}
                      <td className="rounded-r-[5px] border-y border-r border-slate-100 bg-slate-50 px-3 py-1.5 text-center">
                        {onReceipt && p.transaction_id && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onReceipt(p); }}
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-emerald-600"
                            title="Receipt — print, send or download it again"
                            aria-label="Receipt"
                            data-testid={`revenue-detail-receipt-${p.id}`}
                          >
                            <Receipt className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  )) : []),
                ];
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
};

export default AccountantManageTab;
