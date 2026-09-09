import { useCallback, useEffect, useState } from "react";
import { Check, Coins, Plus, Trash2, Receipt, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { MilkDateInput } from "@/components/ui/milk-calendar";
import {
  getBranches, getFinanceExpenses, createFinanceExpense, deleteFinanceExpense,
  approveFinanceExpense, rejectFinanceExpense,
} from "@/lib/api";
import { EXPENSE_PAYMENT_MODE_OPTIONS, PAYMENT_MODE_LABELS, PAYMENT_MODE_COLORS, orderedPaymentModeEntries } from "@/lib/paymentModes";
import { PETTY_CASH_LIMIT, PETTY_CASH_REASON_REQUIRED, isPettyCash } from "@/lib/pettyCash";

const fmt = (n) => `Rs.${(Number(n) || 0).toLocaleString("en-IN")}`;
const todayIso = () => new Date().toISOString().slice(0, 10);

const blankExpense = { category: "", amount: "", branch_id: "", note: "", expense_date: todayIso(), payment_mode: "cash" };

// The Accountant can log a branch's spending from here too, and a small cash one comes out
// of that branch's tin exactly as the branch's own would. So the same reason is asked for
// in the same words -- without it this form would send an expense the server refuses, and
// the accountant would be told about a rule this dialog never mentioned.

/**
 * Accountant > Expense — what went out, logged by hand (rent, salaries, supplies —
 * whatever category is typed). Feeds the Profit tab, which is Revenue less this same
 * list for the same window.
 *
 * `branchId`/`mode`/`scoped` are optional: passed by Super Admin's Finance screen, whose
 * own branch-pill row already picked a scope — this board then reads that scope instead
 * of asking a second time with its own dropdown. `scoped` is the explicit flag for that
 * (rather than inferring it from `branchId` being set, which is exactly as legitimately
 * undefined for "All Branches" as it is for "no caller passed anything"). Left off, this
 * keeps its original shape: the Accountant's own login board, picking its own branch and
 * vertical.
 */
export const ExpenseBoard = ({ branchId: branchIdProp, mode: modeProp, scoped = false } = {}) => {
  const controlled = scoped;
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState("");
  const [mode, setMode] = useState("all"); // "all" | "online" | "offline"
  const effectiveBranchId = controlled ? (branchIdProp || "") : branchId;
  const effectiveMode = controlled ? (modeProp || "all") : mode;
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [data, setData] = useState({ expenses: [], total: 0, payment_modes: {} });
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(blankExpense);
  const [saving, setSaving] = useState(false);
  const [deciding, setDeciding] = useState(null);

  useEffect(() => { if (!controlled) getBranches().then(setBranches).catch(() => {}); }, [controlled]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (effectiveBranchId) params.branch_id = effectiveBranchId;
      if (effectiveMode !== "all") params.mode = effectiveMode;
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;
      setData(await getFinanceExpenses(params));
    } catch { /* silent */ }
    setLoading(false);
  }, [effectiveBranchId, effectiveMode, startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  const expenseBranchId = (controlled ? effectiveBranchId : form.branch_id) || null;
  const petty = isPettyCash(form.amount, form.payment_mode, expenseBranchId);

  const submit = async () => {
    if (!form.category.trim()) { toast.error("Expense name is required"); return; }
    if (!(Number(form.amount) > 0)) { toast.error("Enter an amount"); return; }
    if (petty && !form.note.trim()) { toast.error(PETTY_CASH_REASON_REQUIRED); return; }
    setSaving(true);
    try {
      await createFinanceExpense({
        ...form,
        amount: Number(form.amount),
        branch_id: expenseBranchId,
      });
      toast.success("Expense logged");
      setForm(blankExpense);
      setShowAdd(false);
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed to log expense"); }
    setSaving(false);
  };

  const remove = async (exp) => {
    if (!window.confirm(`Delete this ${exp.category} expense of ${fmt(exp.amount)}?`)) return;
    try { await deleteFinanceExpense(exp.id); toast.success("Deleted"); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Delete failed"); }
  };

  // Signing off what a branch has asked to spend, or turning it down. A rejection asks for
  // the reason rather than assuming one: the branch is owed an answer they can act on, and
  // a row that comes back refused with nothing attached gets sent again unchanged.
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
    <div className="space-y-4" data-testid="finance-expense-root">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4" data-testid="finance-expense-total-card">
          <p className="text-[11px] font-medium uppercase tracking-wide text-rose-700">Total Expense</p>
          <p className="text-2xl font-bold text-rose-700">{fmt(data.total)}</p>
        </div>
        <Button onClick={() => setShowAdd(true)} className="bg-sky-600 hover:bg-sky-700" data-testid="finance-expense-add-btn">
          <Plus className="mr-1 h-4 w-4" />Add Expense
        </Button>
      </div>

      {/* Cash/Cheque/Bank/UPI split — same tiles and same order as the Income tab, so an
          expense figure and the money it came out against read as one system. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="finance-expense-payment-modes">
        {orderedPaymentModeEntries(data.payment_modes).map(([pm, amt]) => {
          const c = PAYMENT_MODE_COLORS[pm] || PAYMENT_MODE_COLORS.unknown;
          return (
            <div key={pm} className={`rounded-xl border ${c.border} ${c.bg} p-4`} data-testid={`finance-expense-payment-mode-${pm}`}>
              <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">{PAYMENT_MODE_LABELS[pm]}</p>
              <p className={`mt-1 text-xl font-bold ${c.text}`}>{fmt(amt)}</p>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {/* Branch and vertical are already picked by the branch-pill row above this
            board when embedded there — asking again here would be a second control for
            the same scope. The Accountant's own dashboard has no such row, so it keeps
            both. */}
        {!controlled && [["all", "All"], ["offline", "Offline"], ["online", "Online"]].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setMode(key)}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
              mode === key ? "border-sky-600 bg-sky-600 text-white shadow-sm" : "border-slate-200 bg-white text-slate-600 hover:border-sky-300 hover:text-sky-600"
            }`}
            data-testid={`finance-expense-mode-${key}`}
          >
            {label}
          </button>
        ))}
        {!controlled && (
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="h-9 rounded-md border border-slate-200 px-2 text-sm"
            data-testid="finance-expense-branch"
          >
            <option value="">All Branches</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.branch_name}</option>)}
          </select>
        )}
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <MilkDateInput value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-9 rounded-md border border-slate-200 px-2 text-xs" data-testid="finance-expense-start" />
          <span>to</span>
          <MilkDateInput value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-9 rounded-md border border-slate-200 px-2 text-xs" data-testid="finance-expense-end" />
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden" data-testid="finance-expense-list">
        <div className="divide-y divide-slate-50">
          {loading ? (
            <p className="px-4 py-8 text-center text-sm text-slate-400">Loading...</p>
          ) : data.expenses.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <Receipt className="mx-auto mb-2 h-8 w-8 text-slate-200" />
              <p className="text-xs text-slate-400">No expenses logged yet.</p>
            </div>
          ) : data.expenses.map((exp) => (
            <div
              key={exp.id}
              className={`flex items-center justify-between gap-3 px-4 py-3 ${exp.approved === false && !exp.rejected ? "bg-amber-50/50" : ""}`}
              data-testid={`finance-expense-row-${exp.id}`}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800">{exp.category}</p>
                <p className="truncate text-xs text-slate-500">
                  {[exp.branch_name, exp.expense_date, PAYMENT_MODE_LABELS[exp.payment_mode], exp.paid_to && `to ${exp.paid_to}`, exp.reference, exp.note]
                    .filter(Boolean).join(" · ")}
                </p>
                {/* Who asked, on a row somebody is being asked to sign off. Approving a
                    figure without knowing whose spending it is, is initialling a number. */}
                {exp.approved === false && !exp.rejected && exp.created_by ? (
                  <p className="truncate text-[11px] text-amber-700">Raised by {exp.created_by}</p>
                ) : null}
                {exp.rejected && exp.rejection_reason ? (
                  <p className="truncate text-[11px] text-rose-600">Rejected — {exp.rejection_reason}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-sm font-bold text-rose-600">{fmt(exp.amount)}</span>
                {/* Only on what is actually waiting. An expense the accountant entered is
                    already signed off by the act of entering it, and one already decided
                    is not a decision to make twice. */}
                {exp.approved === false && !exp.rejected ? (
                  <>
                    <Button
                      size="sm"
                      className="h-7 bg-emerald-600 px-2 text-[11px] text-white hover:bg-emerald-700"
                      disabled={deciding === exp.id}
                      onClick={() => decide(exp, true)}
                      data-testid={`finance-expense-approve-${exp.id}`}
                    >
                      <Check className="mr-1 h-3 w-3" /> Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 border-rose-200 px-2 text-[11px] text-rose-700 hover:bg-rose-50"
                      disabled={deciding === exp.id}
                      onClick={() => decide(exp, false)}
                      data-testid={`finance-expense-reject-${exp.id}`}
                    >
                      Reject
                    </Button>
                  </>
                ) : null}
                <button onClick={() => remove(exp)} className="text-slate-400 hover:text-rose-600" data-testid={`finance-expense-delete-${exp.id}`}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" data-testid="finance-expense-add-dialog">
          <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <h3 className="text-base font-semibold">Add Expense</h3>
              <button onClick={() => setShowAdd(false)} className="text-slate-400 hover:text-slate-600" data-testid="finance-expense-add-close"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3 p-5">
              <Input placeholder="Expense Name (e.g. Rent, Salaries)" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} data-testid="finance-expense-category" />
              <Input type="number" min="0" placeholder="Amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} data-testid="finance-expense-amount" />
              <MilkDateInput value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} data-testid="finance-expense-date" />
              {/* Already fixed by the branch-pill row above this board when embedded there;
                  the Accountant's own dashboard has no such row and still picks one here. */}
              {controlled ? (
                <p className="text-xs text-slate-500" data-testid="finance-expense-form-branch-fixed">
                  Recorded {effectiveBranchId ? "against this branch." : "as an org-wide expense (All Branches)."}
                </p>
              ) : (
                <select
                  value={form.branch_id}
                  onChange={(e) => setForm({ ...form, branch_id: e.target.value })}
                  className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm"
                  data-testid="finance-expense-form-branch"
                >
                  <option value="">All Branches (org-wide)</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.branch_name}</option>)}
                </select>
              )}
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Payment Mode</label>
                <div className="flex flex-wrap gap-1.5" data-testid="finance-expense-form-mode">
                  {EXPENSE_PAYMENT_MODE_OPTIONS.map((m) => {
                    const selected = m === form.payment_mode;
                    const c = PAYMENT_MODE_COLORS[m];
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setForm({ ...form, payment_mode: m })}
                        className={`h-9 min-w-[64px] flex-1 rounded-md border text-center text-xs font-semibold transition ${
                          selected ? `${c.bg} ${c.border} ${c.text} shadow-sm` : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                        }`}
                        data-testid={`finance-expense-form-mode-${m}`}
                      >
                        {PAYMENT_MODE_LABELS[m]}
                      </button>
                    );
                  })}
                </div>
              </div>
              <Input
                placeholder={petty ? "Reason — what the petty cash was spent on" : "Remarks (optional)"}
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                className={petty && !form.note.trim() ? "border-amber-300" : ""}
                data-testid="finance-expense-note"
              />
              {petty && (
                <p className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800" data-testid="finance-expense-petty-hint">
                  <Coins className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>
                    <b>Petty cash.</b> Rs.{PETTY_CASH_LIMIT.toLocaleString("en-IN")} or less in cash comes out of this branch&apos;s tin,
                    and the reason above is the only record of what it bought.
                  </span>
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <Button variant="outline" onClick={() => setShowAdd(false)} data-testid="finance-expense-cancel">Cancel</Button>
              <Button onClick={submit} disabled={saving} className="bg-sky-600 hover:bg-sky-700" data-testid="finance-expense-submit">
                {saving ? "Saving..." : "Add Expense"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
