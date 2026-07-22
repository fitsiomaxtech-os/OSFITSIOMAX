import { useCallback, useEffect, useState } from "react";
import { Eye } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { getBranches, getRevenueOverview } from "@/lib/api";
import { ClientHistoryModal } from "@/components/branch/ClientHistoryModal";
import { OutstandingAmountBoard } from "@/components/branch/OutstandingAmountBoard";
import { PaymentSchedulesBoard } from "@/components/branch/PaymentSchedulesBoard";
import { ConsultationCollectionsBoard } from "@/components/branch/ConsultationCollectionsBoard";
import { SessionCollectionsBoard } from "@/components/branch/SessionCollectionsBoard";

const SUB_TABS = [
  { key: "total_revenue", label: "Total Revenue" },
  { key: "consultation", label: "Consultation Collections" },
  { key: "session", label: "Session Collections" },
  { key: "outstanding", label: "Outstanding Amount" },
  { key: "schedules", label: "Payment Schedules" },
];

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
  cheque: "bg-amber-50 text-amber-700 border-amber-200",
  partial: "bg-orange-50 text-orange-700 border-orange-200",
};

const formatMode = (mode) => (mode ? (mode === "upi" ? "UPI" : mode.charAt(0).toUpperCase() + mode.slice(1)) : "—");

const PaymentModeBadge = ({ mode }) => (
  <span className={`inline-flex items-center rounded-[5px] border px-2 py-0.5 text-[10px] font-semibold ${PAYMENT_MODE_STYLES[mode] || "bg-slate-50 text-slate-600 border-slate-200"}`}>
    {formatMode(mode)}
  </span>
);

/**
 * Accountant Manage — Super Admin's Branch Management > Accountant Management >
 * Accountant Manage, and the same view reused read-only-by-nature (it's all
 * reporting, nothing editable) as Branch Admin's own "Accountant Manage" tab.
 * Five sub-tabs: Total Revenue, Consultation Collections, Session Collections,
 * Outstanding Amount, and Payment Schedules — all sourced from the same
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
  const transactions = data?.transactions || [];
  const outstanding = data?.outstanding_clients || [];
  const schedule = data?.payment_schedule || [];

  return (
    <div className="space-y-4" data-testid="accountant-manage-tab">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Accountant Manage</h2>
        <p className="text-sm text-slate-500">
          Revenue, collections, outstanding balances, and payment schedules {fixedBranchId ? "for your branch" : "across every branch"}.
        </p>
      </div>

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
            className={`rounded-md px-3 py-2 text-sm font-medium transition ${subTab === t.key ? "bg-sky-50 text-sky-700" : "text-slate-600 hover:bg-slate-50"}`}
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
      <div className="overflow-x-auto">
        <table className="w-full table-fixed border-separate border-spacing-x-0 border-spacing-y-2 text-sm">
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
