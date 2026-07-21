import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { getBranches, getRevenueOverview } from "@/lib/api";

const SUB_TABS = [
  { key: "total_revenue", label: "Total Revenue" },
  { key: "consultation", label: "Consultation Collections" },
  { key: "session", label: "Session Collections" },
  { key: "outstanding", label: "Outstanding Amount" },
  { key: "schedules", label: "Payment Schedules" },
];

const fmt = (n) => `Rs.${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

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
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

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
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="accountant-manage-total-revenue">
          <KpiCard label="Total Collected" value={fmt(k.total_collected)} color="#059669" />
          <KpiCard label="Consultation Revenue" value={fmt(b.consultation_revenue)} color="#0284c7" />
          <KpiCard label="Session Revenue" value={fmt(b.session_revenue)} color="#7c3aed" />
          <KpiCard label="Pending Collection" value={k.pending_count || 0} color="#d97706" />
        </div>
      ) : subTab === "consultation" ? (
        <CollectionsTable title="Consultation Collections" total={fmt(b.consultation_revenue)} rows={transactions.filter((t) => t.source === "consultation")} testid="accountant-manage-consultation" />
      ) : subTab === "session" ? (
        <CollectionsTable title="Session Collections" total={fmt(b.session_revenue)} rows={transactions.filter((t) => t.source === "session")} testid="accountant-manage-session" />
      ) : subTab === "outstanding" ? (
        <OutstandingTable rows={outstanding} />
      ) : (
        <ScheduleTable rows={schedule} />
      )}
    </div>
  );
};

const KpiCard = ({ label, value, color }) => (
  <div className="rounded-xl border bg-white p-4 shadow-sm" style={{ borderLeftColor: color, borderLeftWidth: 4 }}>
    <p className="text-xs text-slate-500">{label}</p>
    <p className="mt-1 text-2xl font-bold" style={{ color }}>{value}</p>
  </div>
);

const CollectionsTable = ({ title, total, rows, testid }) => (
  <Card data-testid={testid}>
    <CardContent className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
        <p className="text-lg font-bold text-slate-800">{total}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/80">
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">Client</th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">Branch</th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">Date</th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">Payment Mode</th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-400">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-sm text-slate-400">No transactions yet.</td></tr>
            ) : rows.map((tx) => (
              <tr key={tx.id} className="border-b border-slate-50">
                <td className="px-3 py-2 font-medium text-slate-800">{tx.client_name || "Unknown"}</td>
                <td className="px-3 py-2 text-slate-600">{tx.branch_name || "—"}</td>
                <td className="px-3 py-2 text-xs text-slate-500">{(tx.date || "").slice(0, 16).replace("T", " ")}</td>
                <td className="px-3 py-2 text-xs capitalize text-slate-500">{tx.payment_mode}</td>
                <td className="px-3 py-2 text-right font-semibold text-emerald-700">{fmt(tx.gross)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CardContent>
  </Card>
);

const OutstandingTable = ({ rows }) => (
  <Card data-testid="accountant-manage-outstanding">
    <CardContent className="p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Outstanding Amount</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/80">
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">Client</th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">Phone</th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">Branch</th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-400">Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={4} className="px-3 py-8 text-center text-sm text-slate-400">No outstanding balances.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.lead_id} className="border-b border-slate-50" data-testid={`accountant-manage-outstanding-${r.lead_id}`}>
                <td className="px-3 py-2 font-medium text-slate-800">{r.client_name}</td>
                <td className="px-3 py-2 text-slate-600">{r.phone || "—"}</td>
                <td className="px-3 py-2 text-slate-600">{r.branch_name || "—"}</td>
                <td className="px-3 py-2 text-right font-semibold text-amber-600">{fmt(r.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CardContent>
  </Card>
);

const ScheduleTable = ({ rows }) => (
  <Card data-testid="accountant-manage-schedules">
    <CardContent className="p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Payment Schedules</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/80">
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">Client</th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">Branch</th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">Installment</th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">Due Date</th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-400">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-sm text-slate-400">No scheduled installments.</td></tr>
            ) : rows.map((r) => (
              <tr key={`${r.lead_id}-${r.installment_number}`} className="border-b border-slate-50" data-testid={`accountant-manage-schedule-${r.lead_id}-${r.installment_number}`}>
                <td className="px-3 py-2 font-medium text-slate-800">{r.client_name}</td>
                <td className="px-3 py-2 text-slate-600">{r.branch_name || "—"}</td>
                <td className="px-3 py-2 text-slate-600">#{r.installment_number}</td>
                <td className="px-3 py-2 text-slate-600">{r.due_date}</td>
                <td className="px-3 py-2 text-right font-semibold text-sky-700">{fmt(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CardContent>
  </Card>
);

export default AccountantManageTab;
