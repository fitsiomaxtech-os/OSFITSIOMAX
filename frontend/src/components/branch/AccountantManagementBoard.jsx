import { useEffect, useState } from "react";
import { Eye, X, Phone, Mail, MapPin } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { getBranches, getRevenueOverview, getClientTransactionHistory } from "@/lib/api";
import { AcOverviewBoard } from "@/components/branch/AcOverviewBoard";
import { AccountantManageTab } from "@/components/branch/AccountantManageTab";

const SUB_TABS = [
  { key: "overview", label: "AC Overview" },
  { key: "manage", label: "Accountant Manage" },
  { key: "schedule", label: "Payment Schedule" },
  { key: "transactions", label: "Transactions History" },
];

/**
 * Accountant Management — Super Admin's Branch Management > Accountant Management.
 * Wraps the existing cross-branch revenue reporting (AC Overview) alongside
 * per-branch payment mode config (Accountant Manage), a placeholder for the
 * still-unbuilt Monthly Payment Schedules, and an all-transactions ledger.
 */
export const AccountantManagementBoard = () => {
  const [tab, setTab] = useState("overview");

  return (
    <div className="space-y-4" data-testid="accountant-management-board">
      <div className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-1" data-testid="accountant-mgmt-subtabs">
        {SUB_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-md px-3 py-2 text-sm font-medium transition ${tab === t.key ? "bg-sky-50 text-sky-700" : "text-slate-600 hover:bg-slate-50"}`}
            data-testid={`accountant-mgmt-subtab-${t.key}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && <AcOverviewBoard />}
      {tab === "manage" && <AccountantManageTab />}
      {tab === "schedule" && (
        <Card>
          <CardContent className="p-10 text-center text-sm text-slate-400" data-testid="ac-payment-schedule-placeholder">
            Monthly Payment Schedules — wait for the Development Updates.
          </CardContent>
        </Card>
      )}
      {tab === "transactions" && <TransactionsHistoryTab />}
    </div>
  );
};

const fmt = (n) => `Rs.${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

const TransactionsHistoryTab = () => {
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [viewingLeadId, setViewingLeadId] = useState(null);

  useEffect(() => { getBranches().then(setBranches).catch(() => setBranches([])); }, []);

  useEffect(() => {
    setLoading(true);
    getRevenueOverview({ branch_id: branchId || undefined })
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [branchId]);

  const transactions = data?.transactions || [];

  return (
    <div className="space-y-4" data-testid="ac-transactions-history-tab">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Transactions History</h2>
        <p className="text-sm text-slate-500">Every transaction collected, most recent first.</p>
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-3">
        <label className="text-xs font-medium text-slate-600">Branch:</label>
        <select
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          className="h-9 rounded-md border border-slate-200 px-2 text-xs"
          data-testid="ac-transactions-branch-select"
        >
          <option value="">All Branches</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.branch_name}</option>)}
        </select>
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/80">
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">S.No</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">Client Name</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">Date &amp; Time</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">Payment Mode</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-400">Amount</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-400">Balance of the Client</th>
                  <th className="px-4 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">View</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">Loading...</td></tr>
                ) : transactions.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">No transactions yet.</td></tr>
                ) : transactions.map((tx, i) => (
                  <tr key={tx.id} className="border-b border-slate-50" data-testid={`ac-transactions-row-${tx.id}`}>
                    <td className="px-4 py-2.5 text-xs text-slate-400">{i + 1}</td>
                    <td className="px-4 py-2.5 font-medium text-slate-800">{tx.client_name || "Unknown"}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{(tx.date || "").slice(0, 16).replace("T", " ")}</td>
                    <td className="px-4 py-2.5">
                      <span className="rounded-[5px] bg-slate-100 px-2 py-0.5 text-[10px] font-semibold capitalize text-slate-600">
                        {tx.payment_mode || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-slate-800">{fmt(tx.gross)}</td>
                    <td className={`px-4 py-2.5 text-right font-semibold ${tx.client_balance > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                      {fmt(tx.client_balance)}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <button
                        type="button"
                        onClick={() => setViewingLeadId(tx.lead_id)}
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-sky-600"
                        data-testid={`ac-transactions-view-${tx.id}`}
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

      {viewingLeadId && <ClientHistoryModal leadId={viewingLeadId} onClose={() => setViewingLeadId(null)} />}
    </div>
  );
};

const ClientHistoryModal = ({ leadId, onClose }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getClientTransactionHistory(leadId)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [leadId]);

  const client = data?.client;
  const transactions = data?.transactions || [];
  const timeline = data?.timeline || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-testid="client-history-modal">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 p-5">
          <div>
            <h3 className="text-base font-semibold text-slate-900" data-testid="client-history-name">{client?.name || "Loading..."}</h3>
            {client && (
              <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                {client.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{client.phone}</span>}
                {client.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{client.email}</span>}
                {client.branch_name && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{client.branch_name}</span>}
              </div>
            )}
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100" data-testid="client-history-close"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading ? (
            <p className="py-10 text-center text-sm text-slate-400">Loading...</p>
          ) : !data ? (
            <p className="py-10 text-center text-sm text-slate-400">Failed to load client details.</p>
          ) : (
            <>
              <div className={`rounded-xl border p-4 ${data.balance > 0 ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Outstanding Balance</p>
                <p className={`mt-1 text-2xl font-bold ${data.balance > 0 ? "text-amber-700" : "text-emerald-700"}`}>{fmt(data.balance)}</p>
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Transactions</p>
                <div className="space-y-2">
                  {transactions.length === 0 ? (
                    <p className="py-4 text-center text-xs text-slate-400">No transactions yet.</p>
                  ) : transactions.map((tx) => (
                    <div key={tx.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-xs" data-testid={`client-history-tx-${tx.id}`}>
                      <div>
                        <p className="font-medium text-slate-700 capitalize">{tx.source} · <span className="capitalize text-slate-500">{tx.payment_mode}</span></p>
                        <p className="text-[10px] text-slate-400">{(tx.date || "").slice(0, 16).replace("T", " ")}</p>
                      </div>
                      <p className="font-semibold text-emerald-700">{fmt(tx.amount)}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Full Timeline</p>
                <div className="space-y-2">
                  {timeline.length === 0 ? (
                    <p className="py-4 text-center text-xs text-slate-400">No activity yet.</p>
                  ) : timeline.map((ev) => (
                    <div key={ev.id} className="rounded-lg bg-slate-50 px-3 py-2 text-xs" data-testid={`client-history-event-${ev.id}`}>
                      <p className="text-slate-700">{ev.details}</p>
                      <p className="mt-0.5 text-[10px] text-slate-400">{(ev.created_at || "").slice(0, 16).replace("T", " ")} · {ev.created_by}</p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default AccountantManagementBoard;
