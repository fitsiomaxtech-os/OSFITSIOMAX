import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { getBranches, getRevenueOverview } from "@/lib/api";
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
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">Date</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">Branch</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">Source</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-400">Gross</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-400">Discount</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-400">Tax</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-400">Net</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">Loading...</td></tr>
                ) : transactions.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">No transactions yet.</td></tr>
                ) : transactions.map((tx) => (
                  <tr key={tx.id} className="border-b border-slate-50" data-testid={`ac-transactions-row-${tx.id}`}>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{(tx.date || "").slice(0, 16).replace("T", " ")}</td>
                    <td className="px-4 py-2.5 text-slate-700">{tx.branch_name || "—"}</td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-[5px] px-2 py-0.5 text-[10px] font-semibold capitalize ${tx.source === "session" ? "bg-violet-100 text-violet-700" : "bg-sky-100 text-sky-700"}`}>
                        {tx.source}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-slate-800">{fmt(tx.gross)}</td>
                    <td className="px-4 py-2.5 text-right text-slate-400">{fmt(tx.discount)}</td>
                    <td className="px-4 py-2.5 text-right text-slate-400">{fmt(tx.tax)}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-emerald-700">{fmt(tx.net)}</td>
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

export default AccountantManagementBoard;
