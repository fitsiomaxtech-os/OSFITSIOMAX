import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { getBranches, getRevenueOverview } from "@/lib/api";
import { ClientHistoryModal } from "@/components/branch/ClientHistoryModal";
import { OutstandingAmountBoard } from "@/components/branch/OutstandingAmountBoard";
import { PaymentSchedulesBoard } from "@/components/branch/PaymentSchedulesBoard";
import { ConsultationCollectionsBoard } from "@/components/branch/ConsultationCollectionsBoard";
import { SessionCollectionsBoard } from "@/components/branch/SessionCollectionsBoard";
import { PaymentPaidBoard } from "@/components/branch/PaymentPaidBoard";
import { PaymentUnpaidBoard } from "@/components/branch/PaymentUnpaidBoard";

// `tone` is carried only by the two settled/unsettled tabs — green for money fully in,
// rose for none of it in, the same colours the OS uses for those states everywhere else,
// so the pair reads as a pair. Every other tab keeps the shared sky styling.
const SUB_TABS = [
  { key: "total_revenue", label: "Total Revenue" },
  { key: "consultation", label: "Consultation Collections" },
  { key: "session", label: "Session Collections" },
  { key: "outstanding", label: "Outstanding Amount" },
  { key: "schedules", label: "Payment Schedules" },
  { key: "paid", label: "Payment Paid", tone: "paid" },
  { key: "unpaid", label: "Payment Unpaid", tone: "unpaid" },
];

const subTabClasses = (tab, active) => {
  if (tab.tone === "paid") {
    return active ? "bg-emerald-600 text-white shadow-sm" : "text-emerald-700 hover:bg-emerald-50";
  }
  if (tab.tone === "unpaid") {
    return active ? "bg-rose-600 text-white shadow-sm" : "text-rose-700 hover:bg-rose-50";
  }
  return active ? "bg-sky-50 text-sky-700" : "text-slate-600 hover:bg-slate-50";
};

const REVENUE_VIEWS = [
  { key: "collected", label: "Total Collected", color: "#059669" },
  { key: "consultation", label: "Consultation Revenue", color: "#0284c7" },
  { key: "session", label: "Session Revenue", color: "#7c3aed" },
];

const fmt = (n) => `Rs.${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

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
 * Seven sub-tabs: Total Revenue, Consultation Collections, Session Collections,
 * Outstanding Amount, Payment Schedules, Payment Paid and Payment Unpaid — all
 * sourced from the same finance/revenue-overview payload.
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
  const transactions = data?.transactions || [];
  const outstanding = data?.outstanding_clients || [];
  const schedule = data?.payment_schedule || [];

  // Payment Paid — clients with nothing left owing, rolled up from their own
  // transactions. Anyone still carrying a balance belongs to Outstanding Amount, so they
  // are excluded outright; what remains is every client whose money is fully in,
  // including those who paid the whole package up front and so never had a schedule.
  const paidClients = useMemo(() => {
    const owing = new Set(outstanding.map((o) => o.lead_id));
    const map = {};
    transactions.forEach((t) => {
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
      if (t.source === "consultation") r.consultation_paid += amount;
      else r.session_paid += amount;
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

      <div className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-1" data-testid="accountant-manage-subtabs">
        {SUB_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setSubTab(t.key)}
            className={`rounded-md px-3 py-2 text-sm font-medium transition ${subTabClasses(t, subTab === t.key)}`}
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
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <KpiCard
              label="Total Collected" value={fmt(k.total_collected)} color="#059669"
              active={revenueView === "collected"} onClick={() => setRevenueView("collected")}
            />
            <KpiCard
              label="Consultation Revenue" value={fmt(b.consultation_revenue)} color="#0284c7"
              active={revenueView === "consultation"} onClick={() => setRevenueView("consultation")}
            />
            <KpiCard
              label="Session Revenue" value={fmt(b.session_revenue)} color="#7c3aed"
              active={revenueView === "session"} onClick={() => setRevenueView("session")}
            />
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
      ) : subTab === "outstanding" ? (
        <OutstandingAmountBoard rows={outstanding} onView={setViewingLeadId} onChanged={load} />
      ) : subTab === "paid" ? (
        <PaymentPaidBoard rows={paidClients} onView={setViewingLeadId} />
      ) : subTab === "unpaid" ? (
        <PaymentUnpaidBoard rows={unpaidClients} onView={setViewingLeadId} />
      ) : (
        <PaymentSchedulesBoard rows={schedule} onView={setViewingLeadId} onChanged={load} />
      )}

      {viewingLeadId && <ClientHistoryModal leadId={viewingLeadId} onClose={() => setViewingLeadId(null)} onChanged={load} />}
    </div>
  );
};

const KpiCard = ({ label, value, color, active, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`rounded-xl border bg-white p-4 text-left shadow-sm transition ${active ? "ring-2 ring-offset-1" : "hover:shadow-md"}`}
    style={{ borderLeftColor: color, borderLeftWidth: 4, ...(active ? { boxShadow: `0 0 0 2px ${color}33` } : {}) }}
    data-testid={`revenue-kpi-${label.toLowerCase().replace(/\s+/g, "-")}`}
  >
    <p className="text-xs text-slate-500">{label}</p>
    <p className="mt-1 text-2xl font-bold" style={{ color }}>{value}</p>
  </button>
);

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
              <th className="w-[5%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">S.No</th>
              <th className="w-[16%] px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">Client</th>
              <th className="w-[13%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Consultation/Session</th>
              <th className="w-[13%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Phone</th>
              <th className="w-[12%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Paid Amount</th>
              <th className="w-[11%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Payment Mode</th>
              <th className="w-[10%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Date</th>
              <th className="w-[11%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Branch</th>
              <th className="w-[9%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">View</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-sm text-slate-400">No transactions yet.</td></tr>
            ) : rows.map((tx, i) => (
              <tr key={tx.id} data-testid={`revenue-detail-row-${tx.id}`}>
                <td className="rounded-l-[5px] border-y border-l border-slate-200 bg-white px-3 py-2 text-center text-slate-400">{i + 1}</td>
                <td className="border-y border-slate-200 bg-white px-3 py-2 font-medium text-slate-800">{tx.client_name || "Unknown"}</td>
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
