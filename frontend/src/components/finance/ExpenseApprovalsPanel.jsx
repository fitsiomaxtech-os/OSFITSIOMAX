import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Coins, Eye, Receipt, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { getFinanceExpenses, approveFinanceExpense, rejectFinanceExpense } from "@/lib/api";
import { notesLabel } from "@/lib/denominations";

const fmt = (n) => `Rs.${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const MODE_LABELS = {
  cash: "Cash", upi: "UPI", card: "Card", account_transfer: "Bank Transfer", cheque: "Cheque",
};

/**
 * Whether the sentence the branch typed is the only thing there is to approve this
 * against.
 *
 * Cash with no reference on it: no invoice, no transfer to look up, nobody else's record
 * of the payment. This used to be read off `petty_cash`, which is the tin's own test and
 * stops at Rs.1,000 — so a Rs.5,000 cash payment out of a branch drawer, which has no
 * more paperwork behind it than a Rs.200 one, had its reason run in with the date and the
 * branch on a line that clips. The bigger the cash payment, the more that sentence is
 * worth reading before initialling it.
 */
const reasonIsTheOnlyEvidence = (exp) =>
  (exp.payment_mode || "").trim().toLowerCase() === "cash" && !(exp.reference || "").trim();

/**
 * What the branches have asked to spend, for the person who signs it off.
 *
 * The same two questions the income side of this tab asks — what is waiting, and what has
 * been settled — about money going the other way. Kept as its own panel rather than folded
 * into the transactions list beside it: an expense is not a collection with a minus on it.
 * It carries who it was paid to and what for, it is approved against a bill rather than
 * against a patient, and the filters that matter on the income side (which fee, which
 * patient) mean nothing here.
 *
 * Every filter comes from the block above the ledger switch, which asks them once for both
 * sides of this tab: a day's collections and a day's spending are the same day, and the
 * two would not stay together if each side kept its own window. This panel used to keep a
 * branch select of its own, which meant the tab could be looking at one branch's income
 * beside another branch's expenses — two answers to a question the reader asked once.
 */
const Detail = ({ label, children }) => (
  <div className="min-w-0">
    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
    <div className="break-words text-sm text-slate-800">{children || "—"}</div>
  </div>
);

/** Everything the expense was raised with, read before it is signed off. */
const ExpenseDetailModal = ({ exp, deciding, onDecide, onClose }) => {
  const notes = notesLabel(exp.cash_denominations);
  const status = exp.rejected ? "Rejected" : exp.approved ? "Approved" : "Pending approval";
  const tone = exp.rejected ? "bg-rose-50 text-rose-700" : exp.approved ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700";
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="finance-expense-detail"
    >
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-slate-50/60 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-800">Expense Details</h3>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-2xl font-bold text-slate-800" data-testid="finance-expense-detail-amount">{fmt(exp.amount)}</p>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>{status}</span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Detail label="Name">{exp.paid_to}</Detail>
            <Detail label="Vendor / Category">{exp.vendor_name || exp.category}</Detail>
            <Detail label="Branch">{exp.branch_name}</Detail>
            <Detail label="Spent on">{exp.expense_date}</Detail>
            <Detail label="Payment mode">{MODE_LABELS[exp.payment_mode] || exp.payment_mode}</Detail>
            <Detail label="Bill / reference no.">{exp.reference}</Detail>
            {notes ? (
              <div className="col-span-2">
                <Detail label="Denominations">
                  {notes}{Number(exp.cash_coins) > 0 ? ` + Rs.${exp.cash_coins} coins` : ""}
                </Detail>
              </div>
            ) : null}
            <div className="col-span-2">
              <Detail label="What it was spent on">{exp.note}</Detail>
            </div>
            <Detail label="Raised by">{exp.created_by}</Detail>
            <Detail label="Raised at">{(exp.created_at || "").slice(0, 16).replace("T", " ")}</Detail>
            {exp.approved && exp.approved_by ? <Detail label="Approved by">{exp.approved_by}</Detail> : null}
            {exp.rejected && exp.rejection_reason ? (
              <div className="col-span-2"><Detail label="Rejected because">{exp.rejection_reason}</Detail></div>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
          <Button variant="outline" onClick={onClose}>Close</Button>
          {!exp.approved && (
            <>
              <Button
                variant="outline"
                className="border-rose-200 text-rose-700 hover:bg-rose-50"
                disabled={deciding}
                onClick={() => onDecide(exp, false)}
                data-testid="finance-expense-detail-reject"
              >
                Reject
              </Button>
              <Button
                className="bg-emerald-600 text-white hover:bg-emerald-700"
                disabled={deciding}
                onClick={() => onDecide(exp, true)}
                data-testid="finance-expense-detail-approve"
              >
                <Check className="mr-1 h-4 w-4" /> Approve
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export const ExpenseApprovalsPanel = ({
  onChanged = () => {},
  branchId = "",
  mode = "all",
  startDate = "",
  endDate = "",
}) => {
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState({ approved_total: 0, approved_count: 0, pending_total: 0, pending_count: 0 });
  const [view, setView] = useState("pending"); // "pending" | "approved"
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState(null);
  const [viewing, setViewing] = useState(null); // the expense open in Expense Details

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (branchId) params.branch_id = branchId;
      if (mode && mode !== "all") params.mode = mode;
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;
      const data = await getFinanceExpenses(params);
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
  }, [branchId, mode, startDate, endDate]);

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
      setViewing(null);
      load();
      onChanged();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save that");
    } finally {
      setDeciding(null);
    }
  };

  return (
    <div className="space-y-4" data-testid="finance-expense-approvals">
      {/* The same two cards the income side wears, so the tab reads the same whichever
          way the money is going — and, as there, they are the switch: the toggle that
          used to sit under them only repeated their two headings in a smaller font. */}
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => setView("pending")}
          aria-pressed={view === "pending"}
          className={`rounded-xl border p-4 text-left transition ${view === "pending" ? "border-amber-300 bg-amber-50 ring-2 ring-amber-400" : "border-slate-200 bg-white hover:border-amber-200"}`}
          data-testid="finance-expense-approvals-pending-card"
        >
          <p className={`text-[11px] font-medium uppercase tracking-wide ${view === "pending" ? "text-amber-700" : "text-slate-500"}`}>Pending Approval</p>
          <p className={`text-2xl font-bold ${view === "pending" ? "text-amber-700" : "text-slate-700"}`}>{fmt(totals.pending_total)}</p>
          <p className={`text-[10px] ${view === "pending" ? "text-amber-600" : "text-slate-400"}`}>{totals.pending_count} {totals.pending_count === 1 ? "request" : "requests"}</p>
        </button>
        <button
          type="button"
          onClick={() => setView("approved")}
          aria-pressed={view === "approved"}
          className={`rounded-xl border p-4 text-left transition ${view === "approved" ? "border-emerald-300 bg-emerald-50 ring-2 ring-emerald-400" : "border-slate-200 bg-white hover:border-emerald-200"}`}
          data-testid="finance-expense-approvals-approved-card"
        >
          <p className={`text-[11px] font-medium uppercase tracking-wide ${view === "approved" ? "text-emerald-700" : "text-slate-500"}`}>Approved</p>
          <p className={`text-2xl font-bold ${view === "approved" ? "text-emerald-700" : "text-slate-700"}`}>{fmt(totals.approved_total)}</p>
          <p className={`text-[10px] ${view === "approved" ? "text-emerald-600" : "text-slate-400"}`}>{totals.approved_count} {totals.approved_count === 1 ? "expense" : "expenses"}</p>
        </button>
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
                  {/* Which of these came out of a tin, which is a smaller question than
                      what there is to approve it against -- see reasonIsTheOnlyEvidence,
                      which is what moves the branch's sentence onto a line of its own. */}
                  {exp.petty_cash ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700" data-testid={`finance-expense-approvals-petty-${exp.id}`}>
                      <Coins className="h-2.5 w-2.5" /> Petty cash
                    </span>
                  ) : null}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {[exp.branch_name, exp.expense_date, MODE_LABELS[exp.payment_mode] || exp.payment_mode,
                    exp.reference, ...(reasonIsTheOnlyEvidence(exp) ? [] : [exp.note])].filter(Boolean).join(" · ")}
                </p>
                {reasonIsTheOnlyEvidence(exp) && exp.note ? (
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
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 border-sky-200 px-3 text-xs text-sky-700 hover:bg-sky-50"
                  onClick={() => setViewing(exp)}
                  data-testid={`finance-expense-approvals-view-${exp.id}`}
                >
                  <Eye className="mr-1 h-3.5 w-3.5" /> View
                </Button>
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

      {viewing && (
        <ExpenseDetailModal
          exp={viewing}
          deciding={deciding === viewing.id}
          onDecide={decide}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
};

export default ExpenseApprovalsPanel;
