import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, Wallet, Stethoscope, Activity, ShoppingBag, Salad, RefreshCw, CalendarDays, X, Music2, HeartPulse, Dumbbell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { maskDayMonthYear, manualToIso, isoToManual } from "@/components/DateFilterPopover";
import { getBranches, getRevenueOverview } from "@/lib/api";
import { ClientHistoryModal } from "@/components/branch/ClientHistoryModal";
import { OutstandingAmountBoard } from "@/components/branch/OutstandingAmountBoard";

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
];

const mainTabClasses = (tab, active) => {
  if (tab.tone === "discount") {
    return active ? "bg-amber-600 text-white shadow-sm" : "text-amber-700 hover:bg-amber-50";
  }
  return active ? "bg-sky-50 text-sky-700" : "text-slate-600 hover:bg-slate-50";
};

// Collected is every payment in the current filter regardless of sign-off; Approved and
// Pending are the two ways it splits under the Accountant's own Approvals review. Picking
// one narrows the revenue cards and the table below it the same way a revenue card does —
// two independent cuts of the same transaction list, not a second data source.
const APPROVAL_VIEWS = [
  { key: "collected", label: "Collected" },
  { key: "approved", label: "Approved" },
  { key: "pending", label: "Pending" },
];

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
const REVENUE_VIEWS = [
  { key: "collected", label: "Total Revenue", color: "#059669", icon: Wallet },
  { key: "consultation", label: "Consultation Revenue", color: "#0284c7", icon: Stethoscope },
  { key: "session", label: "Session Revenue", color: "#7c3aed", icon: Activity },
  { key: "diet", label: "Diet Revenue", color: "#ea580c", icon: Salad },
  { key: "store", label: "Store Revenue", color: "#d97706", icon: ShoppingBag },
  // Zumba money lives on the registration, not in the leads' fee trail — see the
  // zumba loop in v3_finance.py's revenue-overview. It reaches this row the same way
  // store sales do, as transactions carrying source "zumba".
  { key: "zumba", label: "Zumba Revenue", color: "#db2777", icon: Music2 },
  // Real now that a rehab fee can be collected: rehab_fee_collected is its own revenue
  // category, so these transactions arrive carrying source "rehab".
  { key: "rehab", label: "Rehab Revenue", color: "#0891b2", icon: HeartPulse },
  // Gym memberships, reaching this row the same way Zumba's do: v3_fitness.py keeps the
  // fee on the registration, so it arrives as a transaction carrying source "fitness"
  // rather than through the leads' fee trail. Until it was counted, this was the one desk
  // taking money that never appeared on the page an accountant reads.
  { key: "fitness", label: "Fitness Revenue", color: "#65a30d", icon: Dumbbell },
];

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
 */
export const AccountantManageTab = ({ branchId: fixedBranchId, mode }) => {
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState(fixedBranchId || "");
  const [tab, setTab] = useState("summary");
  const [approvalView, setApprovalView] = useState("collected");
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

  // Collected/Approved/Pending narrows which transactions the revenue cards and table
  // below are built from — "Collected" is every one of them, the other two split on the
  // same `approved` flag the Approvals tab signs off on.
  const approvalFilteredTxns = useMemo(() => {
    if (approvalView === "approved") return transactions.filter((t) => t.approved);
    if (approvalView === "pending") return transactions.filter((t) => !t.approved);
    return transactions;
  }, [transactions, approvalView]);

  // A second, independent cut on top of the first — how it was paid, not whether it's
  // been signed off. Same combinable-filters shape as Finance > Approvals.
  const filteredTxns = useMemo(() => {
    if (paymentModeFilter === "all") return approvalFilteredTxns;
    return approvalFilteredTxns.filter((t) => t.payment_mode === paymentModeFilter);
  }, [approvalFilteredTxns, paymentModeFilter]);

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

  return (
    <div className="space-y-4" data-testid="accountant-manage-tab">
      {/* One row, read left to right: which branch, then which view of it, then the range
          it is narrowed to. Branch and range each used to hold a band of their own — three
          rows of controls above the figures, with the tabs stranded between the two things
          that scope them. The branch select keeps its condition: the boards that pass a
          fixed branch have nothing to choose, and the row starts at the tabs for them. */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-1.5" data-testid="accountant-manage-maintabs">
        {!fixedBranchId && (
          // The divider is desktop-only: once this wraps on a phone it is a line across
          // the middle of a row rather than between two of them.
          <div className="flex items-center gap-2 pl-1.5 sm:border-r sm:border-slate-200 sm:pr-3">
            <label className="text-xs font-medium text-slate-600">Branch:</label>
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="h-9 rounded-md border border-slate-200 px-2 text-sm"
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
              className={`min-w-0 rounded-md px-3.5 py-2 text-center text-sm font-medium transition ${mainTabClasses(t, tab === t.key)}`}
              data-testid={`accountant-manage-maintab-${t.key}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {/* ml-auto so the range sits at the far end on a desk and simply wraps to the next
            line on a phone, where there is no far end to sit at. */}
        <div className="ml-auto flex flex-wrap items-center gap-3" data-testid="accountant-manage-date-filter">
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            {DATE_PRESETS.map((p) => (
              <button
                key={p.key}
                onClick={() => (p.key === "custom" ? openCustom() : setPreset(p.key))}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${preset === p.key ? "bg-sky-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`}
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
      </div>

      {loading && !data ? (
        <p className="py-10 text-center text-sm text-slate-400">Loading...</p>
      ) : tab === "summary" ? (
        <div className="space-y-4" data-testid="accountant-manage-summary">
          {/* The two cuts side by side: whether it is signed off on the left, how it was
              paid on the right. They are independent filters and combine, so they read
              better as two ends of one line than as two rows stacked. */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex w-fit items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5" data-testid="accountant-manage-approval-filter">
              {APPROVAL_VIEWS.map((v) => (
                <button
                  key={v.key}
                  onClick={() => setApprovalView(v.key)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${approvalView === v.key ? "bg-sky-500 text-white shadow-sm" : "text-slate-500 hover:bg-slate-50"}`}
                  data-testid={`accountant-manage-approval-${v.key}`}
                >
                  {v.label} · {fmt(v.key === "collected" ? k.total_collected : v.key === "approved" ? k.total_approved : k.total_pending_approval)}
                </button>
              ))}
            </div>

            {/* Same set Branch Admin picks from when collecting the fee in the first
                place — not approval status but how it was paid. */}
            <div className="ml-auto flex flex-wrap items-center gap-2" data-testid="accountant-manage-payment-mode-filter">
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
          </div>

          {/* Seven across from lg with Rehab among them. Two-up on a phone, which leaves
              the odd one centred rather than stranded in a column of its own. */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-7">
            {REVENUE_VIEWS.map((v) => (
              <StatTile
                key={v.key}
                label={v.label}
                value={fmt(sums.totals[v.key])}
                sub={countLabel(sums.counts[v.key], v.key === "store" ? "sale" : (v.key === "zumba" || v.key === "fitness") ? "registration" : "payment")}
                icon={v.icon}
                color={v.color}
                active={revenueView === v.key}
                onClick={() => setRevenueView(v.key)}
                testid={`revenue-kpi-${v.label.toLowerCase().replace(/\s+/g, "-")}`}
              />
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
                      {REVENUE_VIEWS.filter((v) => v.key !== "collected").map((v) => (
                        <th key={v.key} className="whitespace-nowrap px-3 py-2 text-right font-semibold">
                          {v.label.replace(" Revenue", "")}
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
                        {REVENUE_VIEWS.filter((v) => v.key !== "collected").map((v) => (
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
                      {REVENUE_VIEWS.filter((v) => v.key !== "collected").map((v) => (
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
          />
        </div>
      ) : tab === "schedule" ? (
        <OutstandingAmountBoard rows={outstanding} onView={setViewingLeadId} onChanged={load} />
      ) : (
        <DiscountAppliedBoard rows={discountedTxns} onView={setViewingLeadId} />
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
const DiscountAppliedBoard = ({ rows, onView }) => {
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
                      <button
                        type="button"
                        onClick={() => onView && onView(tx.lead_id)}
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-sky-600"
                        data-testid={`discount-detail-view-${tx.id}`}
                      >
                        <Eye className="h-4 w-4" />
                      </button>
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

const RevenueDetailTable = ({ title, rows, onView }) => (
  <Card data-testid="accountant-manage-revenue-detail">
    <CardContent className="p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      {/* Cards on a phone. Nine columns behind a 52rem scroll means every one of them is
          off-screen except the first two, and a transaction is only useful read whole —
          who paid, how much, by what, when. */}
      <div className="space-y-2 md:hidden" data-testid="revenue-detail-mobile">
        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 px-3 py-8 text-center text-sm text-slate-400">No transactions yet.</p>
        ) : rows.map((tx, i) => (
          <div
            key={tx.id}
            role={onView ? "button" : undefined}
            tabIndex={onView ? 0 : undefined}
            onClick={() => onView && onView(tx.lead_id)}
            onKeyDown={(e) => {
              if (onView && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onView(tx.lead_id); }
            }}
            className={`rounded-xl border border-slate-200 bg-white p-3 ${onView ? "cursor-pointer active:bg-slate-50" : ""}`}
            data-testid={`revenue-detail-card-${tx.id}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-800">
                  <span className="mr-1.5 font-normal text-slate-400">{i + 1}.</span>
                  {tx.client_name || "Unknown"}
                </p>
                <p className="truncate text-xs text-slate-500">{tx.phone || "—"}</p>
              </div>
              <span className="shrink-0 text-sm font-bold text-emerald-600">{fmt(tx.gross)}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-slate-100 pt-2 text-[11px] text-slate-500">
              <span className="capitalize">{tx.source}</span>
              <PaymentModeBadge mode={tx.payment_mode} />
              <span>{(tx.date || "").slice(0, 10)}</span>
              {tx.branch_name && <span className="truncate">· {tx.branch_name}</span>}
              {onView && <Eye className="ml-auto h-3.5 w-3.5 shrink-0 text-slate-300" />}
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
              <th className="w-[14%] px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">Client</th>
              <th className="w-[14%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Transaction ID</th>
              <th className="w-[11%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Consultation/Session</th>
              <th className="w-[11%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Phone</th>
              <th className="w-[10%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Paid Amount</th>
              <th className="w-[10%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Payment Mode</th>
              <th className="w-[9%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Date</th>
              <th className="w-[10%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Branch</th>
              <th className="w-[7%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">View</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-sm text-slate-400">No transactions yet.</td></tr>
            ) : rows.map((tx, i) => (
              <tr key={tx.id} data-testid={`revenue-detail-row-${tx.id}`}>
                <td className="rounded-l-[5px] border-y border-l border-slate-200 bg-white px-3 py-2 text-center text-slate-400">{i + 1}</td>
                <td className="border-y border-slate-200 bg-white px-3 py-2 font-medium text-slate-800">{tx.client_name || "Unknown"}</td>
                {/* Blank for collections taken before transaction ids existed — those
                    rows are real money and must still list, so this shows a dash rather
                    than being filtered out. */}
                <td className="border-y border-slate-200 bg-white px-3 py-2 text-center">
                  {tx.transaction_id
                    ? <span className="font-mono text-[11px] text-slate-700" title={tx.transaction_id}>{tx.transaction_id}</span>
                    : <span className="text-slate-300">—</span>}
                </td>
                <td className="border-y border-slate-200 bg-white px-3 py-2 text-center capitalize text-slate-600">{tx.source}</td>
                <td className="border-y border-slate-200 bg-white px-3 py-2 text-center text-slate-600">{tx.phone || "—"}</td>
                <td className="border-y border-slate-200 bg-white px-3 py-2 text-center font-semibold text-emerald-600">{fmt(tx.gross)}</td>
                <td className="border-y border-slate-200 bg-white px-3 py-2 text-center"><PaymentModeBadge mode={tx.payment_mode} /></td>
                <td className="border-y border-slate-200 bg-white px-3 py-2 text-center text-slate-600">{(tx.date || "").slice(0, 10)}</td>
                <td className="border-y border-slate-200 bg-white px-3 py-2 text-center text-slate-600">{tx.branch_name || "—"}</td>
                <td className="rounded-r-[5px] border-y border-r border-slate-200 bg-white px-3 py-2 text-center">
                  <button
                    type="button"
                    onClick={() => onView && onView(tx.lead_id)}
                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-sky-600"
                    data-testid={`revenue-detail-view-${tx.id}`}
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CardContent>
  </Card>
);

export default AccountantManageTab;
