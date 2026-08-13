import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, Wallet, Stethoscope, Activity, ShoppingBag, Salad } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { getBranches, getRevenueOverview } from "@/lib/api";
import { ClientHistoryModal } from "@/components/branch/ClientHistoryModal";
import { OutstandingAmountBoard } from "@/components/branch/OutstandingAmountBoard";
import { PaymentSchedulesBoard } from "@/components/branch/PaymentSchedulesBoard";
import { ConsultationCollectionsBoard } from "@/components/branch/ConsultationCollectionsBoard";
import { SessionCollectionsBoard } from "@/components/branch/SessionCollectionsBoard";
import { PaymentPaidBoard } from "@/components/branch/PaymentPaidBoard";
import { PaymentUnpaidBoard } from "@/components/branch/PaymentUnpaidBoard";
import { StorePaymentBoard } from "@/components/branch/StorePaymentBoard";

// `tone` is carried only by the settled/unsettled pair and by Store Payment — green for
// money fully in, rose for none of it in, violet for the Fitsiomax Store, the same colours
// the OS uses for those things elsewhere. Every other tab keeps the shared sky styling.
//
// Store Payment sits last rather than between Payment Paid and Payment Unpaid: those two
// are a pair and read as one, and an unrelated tab dropped between them breaks that.
const SUB_TABS = [
  { key: "total_revenue", label: "Total Revenue" },
  { key: "consultation", label: "Consultation Collections" },
  { key: "session", label: "Session Collections" },
  { key: "diet", label: "Diet Collections" },
  { key: "outstanding", label: "Outstanding Amount" },
  { key: "schedules", label: "Payment Schedules" },
  { key: "paid", label: "Payment Paid", tone: "paid" },
  { key: "unpaid", label: "Payment Unpaid", tone: "unpaid" },
  { key: "store", label: "Store Payment", tone: "store" },
  // Last, so the settled/unsettled/store trio above stays intact — and amber, because
  // this is the one tab reporting money given away rather than money taken.
  { key: "discount", label: "Discount Applied", tone: "discount" },
];

const subTabClasses = (tab, active) => {
  if (tab.tone === "paid") {
    return active ? "bg-emerald-600 text-white shadow-sm" : "text-emerald-700 hover:bg-emerald-50";
  }
  if (tab.tone === "unpaid") {
    return active ? "bg-rose-600 text-white shadow-sm" : "text-rose-700 hover:bg-rose-50";
  }
  if (tab.tone === "store") {
    return active ? "bg-violet-600 text-white shadow-sm" : "text-violet-700 hover:bg-violet-50";
  }
  if (tab.tone === "discount") {
    return active ? "bg-amber-600 text-white shadow-sm" : "text-amber-700 hover:bg-amber-50";
  }
  return active ? "bg-sky-50 text-sky-700" : "text-slate-600 hover:bg-slate-50";
};

// The card, the table it filters to, and the label above that table are one thing, so they
// are one list rather than three that have to be kept in step.
const REVENUE_VIEWS = [
  { key: "collected", label: "Total Collected", color: "#059669", icon: Wallet },
  { key: "consultation", label: "Consultation Revenue", color: "#0284c7", icon: Stethoscope },
  { key: "session", label: "Session Revenue", color: "#7c3aed", icon: Activity },
  { key: "store", label: "Store Revenue", color: "#d97706", icon: ShoppingBag },
  { key: "diet", label: "Diet Revenue", color: "#ea580c", icon: Salad },
];

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
 * Accountant Manage, and the same view reused read-only-by-nature (it's all
 * reporting, nothing editable) as Branch Admin's own "Accountant Manage" tab.
 * Ten sub-tabs: Total Revenue, Consultation Collections, Session Collections, Diet
 * Collections, Outstanding Amount, Payment Schedules, Payment Paid, Payment Unpaid,
 * Store Payment and Discount Applied — all sourced from the same
 * finance/revenue-overview payload.
 */
export const AccountantManageTab = ({ branchId: fixedBranchId }) => {
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState(fixedBranchId || "");
  const [subTab, setSubTab] = useState("total_revenue");
  const [revenueView, setRevenueView] = useState("collected");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [viewingLeadId, setViewingLeadId] = useState(null);

  useEffect(() => {
    if (fixedBranchId) return;
    getBranches().then(setBranches).catch(() => setBranches([]));
  }, [fixedBranchId]);

  const load = useCallback(() => {
    setLoading(true);
    getRevenueOverview({ branch_id: branchId || undefined })
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [branchId]);

  useEffect(() => { load(); }, [load]);

  const k = data?.kpis || {};
  const b = data?.breakdown || {};
  // `data?.x || []` builds a fresh array on every render, so every memo keyed on one was
  // re-running each time and memoising nothing. Held steady here instead, which is what
  // the exhaustive-deps warnings on this file were pointing at.
  const transactions = useMemo(() => data?.transactions || [], [data]);
  const outstanding = useMemo(() => data?.outstanding_clients || [], [data]);
  const schedule = data?.payment_schedule || [];

  // How many transactions sit behind each figure — the line under it, and the count of
  // rows clicking it will leave in the table below.
  const txnCounts = useMemo(() => {
    const acc = { collected: transactions.length, consultation: 0, session: 0, diet: 0, store: 0 };
    transactions.forEach((t) => { if (acc[t.source] !== undefined) acc[t.source] += 1; });
    return acc;
  }, [transactions]);

  // Payment Paid — clients with nothing left owing, rolled up from their own
  // transactions. Anyone still carrying a balance belongs to Outstanding Amount, so they
  // are excluded outright; what remains is every client whose money is fully in,
  // including those who paid the whole package up front and so never had a schedule.
  const paidClients = useMemo(() => {
    const owing = new Set(outstanding.map((o) => o.lead_id));
    const map = {};
    transactions.forEach((t) => {
      // Store sales are excluded outright, not merely by carrying no lead: this rolls a
      // transaction into consultation_paid or session_paid with nothing in between, so a
      // counter sale that ever gained a lead would silently land in session_paid.
      if (t.source === "store") return;
      if (!t.lead_id || owing.has(t.lead_id)) return;
      const r = map[t.lead_id] || (map[t.lead_id] = {
        lead_id: t.lead_id,
        client_name: t.client_name || "Unknown",
        phone: t.phone || "",
        branch_name: t.branch_name || "",
        consultation_paid: 0, session_paid: 0, total_paid: 0,
        last_date: "", modes: [], txns: [],
      });
      const amount = Number(t.gross) || 0;
      r.total_paid += amount;
      // Written as an explicit three-way, not "consultation else session". This board has
      // two columns and a total that must equal them; an else-branch put every Diet
      // Consultation Fee under Session, which is the one place it certainly does not
      // belong. Diet joins Consultation here — it is a consultation of another kind — so
      // the two columns still add up to Total Paid.
      if (t.source === "session") r.session_paid += amount;
      else r.consultation_paid += amount;
      const day = (t.date || "").slice(0, 10);
      if (day > r.last_date) r.last_date = day;
      if (t.payment_mode && !r.modes.includes(t.payment_mode)) r.modes.push(t.payment_mode);
      r.txns.push(t);
    });
    return Object.values(map).sort((a, b) => b.total_paid - a.total_paid);
  }, [transactions, outstanding]);

  // Payment Unpaid — the other end of the same ledger: billed clients with nothing
  // collected at all. They already come through in outstanding_clients carrying their
  // bill, balance and due date; the only cut needed is paid_amount still at zero, which
  // is what separates this from Outstanding Amount's part-payers.
  const unpaidClients = useMemo(
    () => outstanding.filter((o) => (Number(o.paid_amount) || 0) <= 0 && (Number(o.balance) || 0) > 0),
    [outstanding],
  );

  // Every collection taken below its listed price, biggest concession first. A negative
  // discount means more than the listed fee was collected, which is the opposite of this
  // tab, so only positives qualify.
  const discountedTxns = useMemo(
    () => transactions
      .filter((t) => (Number(t.discount) || 0) > 0)
      .sort((a, b) => (Number(b.discount) || 0) - (Number(a.discount) || 0)),
    [transactions],
  );


  return (
    <div className="space-y-4" data-testid="accountant-manage-tab">
      {!fixedBranchId && (
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-3">
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

      {/* Three across on a phone, which lands the nine as three even rows in declaration
          order and keeps Payment Paid, Payment Unpaid and Store Payment together on the
          last. Wrapping put them wherever the labels happened to run out of room, four
          ragged rows deep. Labels wrap inside their cell rather than truncating — these
          names differ at the end ("Consultation Collections" against "Session
          Collections"), so an ellipsis would cut off the half that tells them apart.
          Unchanged from sm up. */}
      <div className="grid auto-rows-fr grid-cols-3 gap-1 rounded-lg border border-slate-200 bg-white p-1 sm:flex sm:flex-wrap sm:gap-2" data-testid="accountant-manage-subtabs">
        {SUB_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setSubTab(t.key)}
            className={`min-w-0 rounded-md px-1 py-2 text-center text-[10px] font-semibold leading-tight transition sm:px-3 sm:text-sm sm:font-medium ${subTabClasses(t, subTab === t.key)}`}
            data-testid={`accountant-manage-subtab-${t.key}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && !data ? (
        <p className="py-10 text-center text-sm text-slate-400">Loading...</p>
      ) : subTab === "total_revenue" ? (
        <div className="space-y-4" data-testid="accountant-manage-total-revenue">
          {/* Five across from lg, so the whole split reads on one line. Two-up on a phone
              leaves the odd one centred rather than stranded in a column of its own. */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {REVENUE_VIEWS.map((v) => (
              <StatTile
                key={v.key}
                label={v.label}
                value={fmt(v.key === "collected" ? k.total_collected : b[`${v.key}_revenue`])}
                sub={countLabel(txnCounts[v.key], v.key === "store" ? "sale" : "payment")}
                icon={v.icon}
                color={v.color}
                active={revenueView === v.key}
                onClick={() => setRevenueView(v.key)}
                testid={`revenue-kpi-${v.label.toLowerCase().replace(/\s+/g, "-")}`}
              />
            ))}
          </div>

          <RevenueDetailTable
            title={REVENUE_VIEWS.find((v) => v.key === revenueView)?.label}
            rows={revenueView === "collected" ? transactions : transactions.filter((t) => t.source === revenueView)}
            onView={setViewingLeadId}
          />
        </div>
      ) : subTab === "consultation" ? (
        <ConsultationCollectionsBoard rows={transactions.filter((t) => t.source === "consultation")} onView={setViewingLeadId} />
      ) : subTab === "session" ? (
        <SessionCollectionsBoard rows={transactions.filter((t) => t.source === "session")} onView={setViewingLeadId} />
      ) : subTab === "diet" ? (
        // The consultation board over the diet slice: every card, filter and column means
        // the same thing for a Diet Consultation Fee as for a Consultation Fee.
        <ConsultationCollectionsBoard
          rows={transactions.filter((t) => t.source === "diet")}
          onView={setViewingLeadId}
          title="Diet Collections"
          testid="diet-collections-board"
        />
      ) : subTab === "outstanding" ? (
        <OutstandingAmountBoard rows={outstanding} onView={setViewingLeadId} onChanged={load} />
      ) : subTab === "paid" ? (
        <PaymentPaidBoard rows={paidClients} onView={setViewingLeadId} />
      ) : subTab === "unpaid" ? (
        <PaymentUnpaidBoard rows={unpaidClients} onView={setViewingLeadId} />
      ) : subTab === "store" ? (
        <StorePaymentBoard rows={transactions.filter((t) => t.source === "store")} />
      ) : subTab === "discount" ? (
        <DiscountAppliedBoard rows={discountedTxns} onView={setViewingLeadId} />
      ) : (
        <PaymentSchedulesBoard rows={schedule} onView={setViewingLeadId} onChanged={load} />
      )}

      {viewingLeadId && <ClientHistoryModal leadId={viewingLeadId} onClose={() => setViewingLeadId(null)} onChanged={load} />}
    </div>
  );
};

// One card per fee type, mirroring Total Revenue's row. The first four figures this tab
// carried — total, listed value, average % and count — could not filter anything between
// them: all four described the same set of rows, so three of the cards would have been the
// same filter as the first. Splitting by source is the cut that actually partitions the
// list, and every one of those figures survives on the cards below.
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
 * settled in full the moment it is confirmed, so none of it appears under Outstanding
 * Amount. Which means this is the only place the concessions a branch has granted are
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
