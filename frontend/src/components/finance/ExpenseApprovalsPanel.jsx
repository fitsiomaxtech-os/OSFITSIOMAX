import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Coins, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { getBranches, getFinanceExpenses, approveFinanceExpense, rejectFinanceExpense } from "@/lib/api";

const fmt = (n) => `Rs.${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const MODE_LABELS = {
  cash: "Cash", upi: "UPI", card: "Card", account_transfer: "Bank Transfer", cheque: "Cheque",
};

/**
 * What the branches have asked to spend, for the person who signs it off.
 *
 * The same two questions the income side of this tab asks — what is waiting, and what has
 * been settled — about money going the other way. Kept as its own panel rather than folded
 * into the transactions list beside it: an expense is not a collection with a minus on it.
 * It carries who it was paid to and what for, it is approved against a bill rather than
 * against a patient, and the filters that matter on the income side (which fee, which
 * patient) mean nothing here.
 */
export const ExpenseApprovalsPanel = () => {
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState({ approved_total: 0, approved_count: 0, pending_total: 0, pending_count: 0 });
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState("");
  const [view, setView] = useState("pending"); // "pending" | "approved"
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState(null);

  useEffect(() => { getBranches().then(setBranches).catch(() => {}); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getFinanceExpenses(branchId ? { branch_id: branchId } : {});
      setRows(data.expenses || []);
      setTotals({
        approved_total: data.approved_total || 0,
        approved_count: data.approved_count || 0,
        pending_total: data.pending_total || 0,
        pending_count: data.pending_count || 0,
      });
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => { load(); }, [load]);

  // Rejected rows sit with the pending ones: both are still the branch's to deal with, and
  // a turned-down expense filed under Approved would be a lie in a column of figures.
  const visible = useMemo(
    () => rows.filter((r) => (view === "approved" ? r.approved : !r.approved)),
    [rows, view],
  );

  const decide = async (exp, approve) => {
    let reason = "";
    if (!approve) {
      reason = window.prompt(`Why is this ${exp.category} expense of ${fmt(exp.amount)} being turned down?`) || "";
      if (!reason.trim()) return;
    }
    setDeciding(exp.id);
    try {
      if (approve) await approveFinanceExpense(exp.id);
      else await rejectFinanceExpense(exp.id, reason.trim());
      toast.success(approve ? "Approved" : "Rejected");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save that");
    } finally {
      setDeciding(null);
    }
  };

  return (
    <div className="space-y-4" data-testid="finance-expense-approvals">
      {/* The same two cards the income side wears, so the tab reads the same whichever
          way the money is going. */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4" data-testid="finance-expense-approvals-pending-card">
          <p className="text-[11px] font-medium uppercase tracking-wide text-amber-700">Pending Approval</p>
          <p className="text-2xl font-bold text-amber-700">{fmt(totals.pending_total)}</p>
          <p className="text-[10px] text-amber-600">{totals.pending_count} {totals.pending_count === 1 ? "request" : "requests"}</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4" data-testid="finance-expense-approvals-approved-card">
          <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-700">Approved</p>
          <p className="text-2xl font-bold text-emerald-700">{fmt(totals.approved_total)}</p>
          <p className="text-[10px] text-emerald-600">{totals.approved_count} {totals.approved_count === 1 ? "expense" : "expenses"}</p>
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
              data-testid={`finance-expense-approvals-view-${key}`}
            >
              {label}
            </button>
          ))}
        </div>

        <select
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-600"
          data-testid="finance-expense-approvals-branch"
        >
          <option value="">All Branches</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.branch_name}</option>)}
        </select>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="divide-y divide-slate-50">
          {loading ? (
            <p className="px-4 py-10 text-center text-sm text-slate-400">Loading…</p>
          ) : visible.length === 0 ? (
            <div className="px-4 py-10 text-center" data-testid="finance-expense-approvals-empty">
              <Receipt className="mx-auto mb-2 h-8 w-8 text-slate-200" />
              <p className="text-xs text-slate-400">
                {view === "pending" ? "Nothing waiting on approval." : "Nothing approved yet."}
              </p>
            </div>
          ) : visible.map((exp) => (
            <div
              key={exp.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              data-testid={`finance-expense-approvals-row-${exp.id}`}
            >
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate text-sm font-medium text-slate-800">
                  <span className="truncate">
                    {exp.category}
                    {exp.paid_to ? <span className="font-normal text-slate-500"> · to {exp.paid_to}</span> : null}
                  </span>
                  {/* Which of these came out of a tin. Marked because it changes what there
                      is to approve against: rent arrives with an invoice and a transfer to
                      check, petty cash arrives with a sentence the branch typed and nothing
                      else -- so that sentence gets a line of its own below rather than
                      being run in with the date and the reference. */}
                  {exp.petty_cash ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700" data-testid={`finance-expense-approvals-petty-${exp.id}`}>
                      <Coins className="h-2.5 w-2.5" /> Petty cash
                    </span>
                  ) : null}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {[exp.branch_name, exp.expense_date, MODE_LABELS[exp.payment_mode] || exp.payment_mode,
                    exp.reference, ...(exp.petty_cash ? [] : [exp.note])].filter(Boolean).join(" · ")}
                </p>
                {exp.petty_cash && exp.note ? (
                  <p className="break-words text-xs font-medium text-slate-700" data-testid={`finance-expense-approvals-reason-${exp.id}`}>
                    “{exp.note}”
                  </p>
                ) : null}
                {/* Whose spending this is. Approving a figure without knowing who raised
                    it is initialling a number. */}
                {exp.created_by ? (
                  <p className="truncate text-[11px] text-slate-400">
                    Raised by {exp.created_by}
                    {exp.approved && exp.approved_by ? ` · approved by ${exp.approved_by}` : ""}
                  </p>
                ) : null}
                {exp.rejected && exp.rejection_reason ? (
                  <p className="truncate text-[11px] text-rose-600">Rejected — {exp.rejection_reason}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-sm font-bold text-rose-600">{fmt(exp.amount)}</span>
                {!exp.approved && (
                  <>
                    <Button
                      size="sm"
                      className="h-8 bg-emerald-600 px-3 text-xs text-white hover:bg-emerald-700"
                      disabled={deciding === exp.id}
                      onClick={() => decide(exp, true)}
                      data-testid={`finance-expense-approvals-approve-${exp.id}`}
                    >
                      <Check className="mr-1 h-3.5 w-3.5" /> Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 border-rose-200 px-3 text-xs text-rose-700 hover:bg-rose-50"
                      disabled={deciding === exp.id}
                      onClick={() => decide(exp, false)}
                      data-testid={`finance-expense-approvals-reject-${exp.id}`}
                    >
                      Reject
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ExpenseApprovalsPanel;
