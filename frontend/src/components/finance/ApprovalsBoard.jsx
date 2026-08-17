import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { getBranchFinance, getBranches, approveTransaction, unapproveTransaction } from "@/lib/api";

const fmt = (n) => `Rs.${(Number(n) || 0).toLocaleString("en-IN")}`;

/**
 * Accountant > Approvals — "new income collected" waiting on sign-off before it's
 * treated as reviewed, same transactions the Summary tab already shows (consultation +
 * package collections), filtered here to whichever side of the approve/not-approve line
 * is picked. Approving doesn't touch what counts as revenue anywhere else in the OS —
 * see approve_transaction's docstring — it only records that someone other than whoever
 * collected it looked the payment over.
 */
export const ApprovalsBoard = () => {
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState("");
  const [mode, setMode] = useState("all"); // "all" | "online" | "offline"
  const [view, setView] = useState("pending"); // "pending" | "approved"
  const [data, setData] = useState({ summary: {}, transactions: [] });
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => { getBranches().then(setBranches).catch(() => {}); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { approved: view === "approved" };
      if (branchId) params.branch_id = branchId;
      if (mode !== "all") params.mode = mode;
      const result = await getBranchFinance(params);
      setData(result);
    } catch { /* silent */ }
    setLoading(false);
  }, [branchId, mode, view]);

  useEffect(() => { load(); }, [load]);

  const approve = async (tx) => {
    setBusyId(tx.id);
    try {
      await approveTransaction(tx.id);
      toast.success(`${tx.patient_name}'s payment approved`);
      await load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Approve failed"); }
    setBusyId(null);
  };

  const undo = async (tx) => {
    setBusyId(tx.id);
    try {
      await unapproveTransaction(tx.id);
      toast.success("Approval removed");
      await load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
    setBusyId(null);
  };

  const s = data.summary || {};

  return (
    <div className="space-y-4" data-testid="finance-approvals-root">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4" data-testid="finance-approvals-pending-card">
          <p className="text-[11px] font-medium uppercase tracking-wide text-amber-700">Pending Approval</p>
          <p className="text-2xl font-bold text-amber-700">{fmt(s.pending_approval_total)}</p>
          <p className="text-[10px] text-amber-600">{s.pending_approval_count || 0} payments</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4" data-testid="finance-approvals-approved-card">
          <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-700">Approved</p>
          <p className="text-2xl font-bold text-emerald-700">{fmt(s.approved_total)}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5">
          {[["pending", "Pending"], ["approved", "Approved"]].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${view === key ? "bg-sky-500 text-white shadow-sm" : "text-slate-500 hover:bg-slate-50"}`}
              data-testid={`finance-approvals-view-${key}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {[["all", "All"], ["offline", "Offline"], ["online", "Online"]].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setMode(key)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                mode === key ? "border-sky-600 bg-sky-600 text-white shadow-sm" : "border-slate-200 bg-white text-slate-600 hover:border-sky-300 hover:text-sky-600"
              }`}
              data-testid={`finance-approvals-mode-${key}`}
            >
              {label}
            </button>
          ))}
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="h-8 rounded-md border border-slate-200 px-2 text-xs"
            data-testid="finance-approvals-branch"
          >
            <option value="">All Branches</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.branch_name}</option>)}
          </select>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden" data-testid="finance-approvals-summary">
        <div className="border-b border-slate-100 bg-slate-50/80 px-4 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Payment Summary</p>
        </div>
        <div className="divide-y divide-slate-50">
          {loading ? (
            <p className="px-4 py-8 text-center text-sm text-slate-400">Loading...</p>
          ) : data.transactions.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-400">
              {view === "pending" ? "Nothing waiting on approval." : "Nothing approved yet."}
            </p>
          ) : data.transactions.map((tx) => (
            <div key={tx.id} className="flex items-center justify-between gap-3 px-4 py-3" data-testid={`finance-approval-row-${tx.id}`}>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800">{tx.patient_name}</p>
                <p className="truncate text-xs text-slate-500">
                  {tx.branch_name || "—"} · <span className="capitalize">{tx.fee_type}</span> · {(tx.collected_at || "").slice(0, 10)}
                  {view === "approved" && tx.approved_by && <> · approved by {tx.approved_by}</>}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-sm font-bold text-emerald-600">{fmt(tx.amount)}</span>
                {view === "pending" ? (
                  <Button
                    size="sm"
                    onClick={() => approve(tx)}
                    disabled={busyId === tx.id}
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
    </div>
  );
};
