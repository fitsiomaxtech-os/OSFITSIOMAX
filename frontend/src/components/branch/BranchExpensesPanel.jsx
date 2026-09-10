import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Coins, HandCoins, Plus, Send, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import {
  getFinanceExpenses, createFinanceExpense,
  getBranchCash, createCashHandover, listCashHandovers, cancelCashHandover,
} from "@/lib/api";
import { BRANCH_EXPENSE_CATEGORIES } from "@/lib/expenseCategories";

const fmt = (n) => `Rs.${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

// For reading back old rows only — a branch expense logged before this screen was
// cash-only may carry any of these. The form no longer offers the choice.
const MODE_LABELS = {
  cash: "Cash", upi: "UPI", card: "Card", account_transfer: "Bank Transfer", cheque: "Cheque",
};

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * What a branch has asked to spend, and what has been signed off.
 *
 * The branch raises; the accountant decides. A Branch Admin cannot approve their own
 * spending — approval is somebody other than the person who spent it saying the money
 * went where the form says. So this screen has no approve button on it at all.
 *
 * A branch spends cash and only cash: it comes out of the same drawer the day's
 * collections go into, and the Cash in hand figure above the tabs is what is left in it.
 */
const StatusChip = ({ row }) => {
  if (row.rejected) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700">
        <XCircle className="h-3 w-3" /> Rejected
      </span>
    );
  }
  if (row.approved) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
        <CheckCircle2 className="h-3 w-3" /> Approved
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
      <Clock className="h-3 w-3" /> Waiting on the accountant
    </span>
  );
};

const AddExpenseDialog = ({ onClose, onSaved, cashInHand }) => {
  const [form, setForm] = useState({
    category: BRANCH_EXPENSE_CATEGORIES[0], amount: "", expense_date: todayIso(),
    paid_to: "", reference: "", note: "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const amountNum = Number(form.amount);
  const overDrawer = cashInHand != null && amountNum > 0 && amountNum > cashInHand;

  const submit = async () => {
    if (!(amountNum > 0)) { toast.error("Enter how much was spent"); return; }
    if (!form.paid_to.trim()) { toast.error("Say who it was paid to"); return; }
    // Every branch expense is cash out of the drawer, and cash leaves no invoice behind
    // it — this sentence is the whole of what the accountant approves it on.
    if (!form.note.trim()) { toast.error("Say what the cash was spent on — the accountant approves it on that"); return; }
    setSaving(true);
    try {
      await createFinanceExpense({ ...form, amount: amountNum, payment_mode: "cash" });
      toast.success("Sent to the accountant — and taken out of the drawer");
      onSaved();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not send that");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="branch-expense-dialog"
    >
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-slate-50/60 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-slate-800">Add Expense</h3>
            <p className="text-[11px] text-slate-500">Cash out of the branch drawer. Goes to the accountant to approve before it counts.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Category *</label>
              <select
                value={form.category}
                onChange={(e) => set("category", e.target.value)}
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none"
                data-testid="branch-expense-category"
              >
                {BRANCH_EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <p className="mt-1 text-[10px] text-slate-400">Rent, salary and EB are paid centrally — not from a branch.</p>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Amount *</label>
              <Input
                type="number"
                min="0"
                value={form.amount}
                onChange={(e) => set("amount", e.target.value)}
                placeholder="0"
                data-testid="branch-expense-amount"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Paid to *</label>
              <Input
                value={form.paid_to}
                onChange={(e) => set("paid_to", e.target.value)}
                placeholder="Who received it"
                data-testid="branch-expense-paid-to"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Spent on</label>
              <Input
                type="date"
                value={form.expense_date}
                onChange={(e) => set("expense_date", e.target.value)}
                data-testid="branch-expense-date"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Bill / reference no.</label>
              <Input
                value={form.reference}
                onChange={(e) => set("reference", e.target.value)}
                placeholder="Optional"
                data-testid="branch-expense-reference"
              />
            </div>
          </div>

          <div
            className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px] ${
              overDrawer ? "border-amber-200 bg-amber-50 text-amber-800" : "border-sky-200 bg-sky-50 text-sky-800"
            }`}
            data-testid="branch-expense-drawer-hint"
          >
            <Coins className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              <b>Cash.</b> This comes out of the branch drawer.
              {cashInHand != null && (
                <>
                  {" "}It holds {fmt(cashInHand)} — {fmt(cashInHand - (amountNum > 0 ? amountNum : 0))} after this.
                  {overDrawer && " That is more than is in it; record it anyway if the money was spent."}
                </>
              )}
            </span>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              What the cash was spent on *
            </label>
            <textarea
              rows={3}
              value={form.note}
              onChange={(e) => set("note", e.target.value)}
              placeholder="Auto to the courier office, receipt kept in the drawer"
              className={`w-full rounded-md border px-3 py-2 text-sm focus:outline-none ${
                form.note.trim() ? "border-slate-200 focus:border-sky-400" : "border-amber-300 focus:border-amber-400"
              }`}
              data-testid="branch-expense-note"
            />
            {!form.note.trim() && (
              <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-amber-700" data-testid="branch-expense-reason-missing">
                <AlertTriangle className="h-3 w-3" />
                Required — it is the only thing the accountant can approve it on
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button className="bg-sky-600 text-white hover:bg-sky-700" disabled={saving} onClick={submit} data-testid="branch-expense-submit">
            {saving ? "Sending…" : "Send for approval"}
          </Button>
        </div>
      </div>
    </div>
  );
};

const HandoverDialog = ({ onClose, onSaved, cashInHand }) => {
  const [form, setForm] = useState({ amount: "", handed_to: "", on: todayIso(), note: "" });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const amountNum = Number(form.amount);
  const overDrawer = cashInHand != null && amountNum > 0 && amountNum > cashInHand;

  const submit = async () => {
    if (!(amountNum > 0)) { toast.error("Enter how much is being handed over"); return; }
    if (!form.handed_to.trim()) { toast.error("Name who is carrying the cash"); return; }
    setSaving(true);
    try {
      await createCashHandover({ ...form, amount: amountNum });
      toast.success("Cash handed over — waiting for the accountant to receive it");
      onSaved();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not record that handover");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="branch-handover-dialog"
    >
      <div className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/60 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-slate-800">Hand over cash</h3>
            <p className="text-[11px] text-slate-500">Settle the drawer to the person carrying it to the accountant.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 p-5">
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Amount *</label>
            <Input type="number" min="0" value={form.amount} onChange={(e) => set("amount", e.target.value)} placeholder="0" data-testid="branch-handover-amount" />
            {cashInHand != null && (
              <p className={`mt-1 text-[10px] ${overDrawer ? "text-amber-700" : "text-slate-400"}`}>
                Drawer holds {fmt(cashInHand)}{overDrawer ? " — that is more than is in it" : ` — ${fmt(cashInHand - (amountNum > 0 ? amountNum : 0))} left after this`}
              </p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Handed to *</label>
            <Input value={form.handed_to} onChange={(e) => set("handed_to", e.target.value)} placeholder="Who is carrying it" data-testid="branch-handover-to" />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Date</label>
            <Input type="date" value={form.on} onChange={(e) => set("on", e.target.value)} data-testid="branch-handover-date" />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Note</label>
            <Input value={form.note} onChange={(e) => set("note", e.target.value)} placeholder="Optional" data-testid="branch-handover-note" />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button className="bg-amber-600 text-white hover:bg-amber-700" disabled={saving} onClick={submit} data-testid="branch-handover-submit">
            {saving ? "Recording…" : "Hand over"}
          </Button>
        </div>
      </div>
    </div>
  );
};

/**
 * @param branchId  Whose drawer to show. Cash in hand belongs to a branch, so with no
 *                  branch in view the figure and the handover button are left out.
 */
export const BranchExpensesPanel = ({ onChanged, branchId }) => {
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState({ approved_total: 0, approved_count: 0, pending_total: 0, pending_count: 0 });
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("request"); // "request" | "approved"
  const [adding, setAdding] = useState(false);
  const [handingOver, setHandingOver] = useState(false);
  const [cash, setCash] = useState(null);
  const [handovers, setHandovers] = useState([]);

  const onChangedRef = useRef(onChanged);
  useEffect(() => { onChangedRef.current = onChanged; }, [onChanged]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getFinanceExpenses();
      setRows(data.expenses || []);
      setTotals({
        approved_total: data.approved_total || 0,
        approved_count: data.approved_count || 0,
        pending_total: data.pending_total || 0,
        pending_count: data.pending_count || 0,
      });
      onChangedRef.current?.();
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // The drawer and its handovers, reloaded whenever the expenses are — a cash expense
  // draws the drawer down as it is raised.
  const loadCash = useCallback(async () => {
    if (!branchId) { setCash(null); setHandovers([]); return; }
    try {
      const [box, ho] = await Promise.all([
        getBranchCash({ branch_id: branchId }),
        listCashHandovers({ branch_id: branchId }),
      ]);
      setCash(box);
      setHandovers(ho.handovers || []);
    } catch {
      setCash(null);
      setHandovers([]);
    }
  }, [branchId]);

  useEffect(() => { loadCash(); }, [loadCash]);

  const pullBackHandover = async (id) => {
    try {
      await cancelCashHandover(id);
      toast.success("Handover cancelled");
      loadCash();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not cancel that");
    }
  };

  const visible = useMemo(
    () => rows.filter((r) => (view === "approved" ? r.approved : !r.approved)),
    [rows, view],
  );

  const TABS = [
    { key: "request", label: "Expense Requests", count: rows.filter((r) => !r.approved).length },
    { key: "approved", label: "Expenses Approved", count: totals.approved_count },
  ];

  const pendingHandovers = handovers.filter((h) => h.status === "pending");
  const openingSet = cash ? cash.opening_set : true;
  const cashInHand = cash && openingSet ? cash.cash_in_hand : null;

  return (
    <div className="space-y-4" data-testid="branch-expenses-panel">
      <div className="flex flex-wrap items-center gap-2" data-testid="branch-expense-totals">
        <span
          className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50/70 py-1.5 pl-3 pr-4"
          data-testid="branch-expense-card-pending"
        >
          <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700">Pending Approval</span>
          <span className="text-sm font-bold tabular-nums text-amber-700">{fmt(totals.pending_total)}</span>
          <span className="text-[11px] text-amber-600/80">
            · {totals.pending_count} {totals.pending_count === 1 ? "request" : "requests"}
          </span>
        </span>
        <span
          className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50/70 py-1.5 pl-3 pr-4"
          data-testid="branch-expense-card-approved"
        >
          <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Approved</span>
          <span className="text-sm font-bold tabular-nums text-emerald-700">{fmt(totals.approved_total)}</span>
          <span className="text-[11px] text-emerald-600/80">
            · {totals.approved_count} {totals.approved_count === 1 ? "expense" : "expenses"}
          </span>
        </span>
      </div>

      {/* The drawer. What a branch holds in cash right now — the day's collections, less
          what it has spent, less what it has handed over. Governs whether the next expense
          can actually be paid. */}
      {branchId && cash && (
        <div
          className={`rounded-xl border p-3.5 ${
            !openingSet ? "border-slate-200 bg-slate-50" : cash.cash_in_hand < 0 ? "border-rose-200 bg-rose-50" : "border-slate-200 bg-white"
          }`}
          data-testid="branch-cash-box"
        >
          {!openingSet ? (
            <div className="flex items-start gap-2.5">
              <span className="rounded-lg bg-slate-100 p-2"><Coins className="h-4 w-4 text-slate-400" /></span>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Cash in hand</p>
                <p className="text-sm text-slate-500" data-testid="branch-cash-not-set">
                  Waiting for the accountant to count and set this branch&apos;s opening cash.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <div className="flex items-center gap-2.5">
                <span className={`rounded-lg p-2 ${cash.cash_in_hand < 0 ? "bg-rose-100" : "bg-emerald-50"}`}>
                  <Coins className={`h-4 w-4 ${cash.cash_in_hand < 0 ? "text-rose-600" : "text-emerald-600"}`} />
                </span>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Cash in hand</p>
                  <p
                    className={`text-xl font-bold tabular-nums ${cash.cash_in_hand < 0 ? "text-rose-700" : "text-slate-800"}`}
                    data-testid="branch-cash-in-hand"
                  >
                    {fmt(cash.cash_in_hand)}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-slate-500">
                <span>Collected (cash) <b className="text-slate-700 tabular-nums">{fmt(cash.collected_cash)}</b></span>
                <span>Spent <b className="text-slate-700 tabular-nums">{fmt(cash.cash_spent)}</b></span>
                <span>Handed over <b className="text-slate-700 tabular-nums">{fmt(cash.handed_over)}</b></span>
                {cash.in_transit > 0 && <span>In transit <b className="text-amber-700 tabular-nums">{fmt(cash.in_transit)}</b></span>}
              </div>

              <Button
                onClick={() => setHandingOver(true)}
                className="ml-auto h-9 bg-amber-600 text-xs text-white hover:bg-amber-700"
                data-testid="branch-handover-open"
              >
                <HandCoins className="mr-1.5 h-3.5 w-3.5" /> Hand over cash
              </Button>
            </div>
          )}

          {pendingHandovers.length > 0 && (
            <div className="mt-3 space-y-1 border-t border-slate-100 pt-2" data-testid="branch-handovers-pending">
              {pendingHandovers.map((h) => (
                <div key={h.id} className="flex flex-wrap items-center gap-2 text-[11px]" data-testid={`branch-handover-${h.id}`}>
                  <Send className="h-3 w-3 text-amber-500" />
                  <span className="font-semibold tabular-nums text-slate-700">{fmt(h.amount)}</span>
                  <span className="text-slate-500">to {h.handed_to} · {h.on}</span>
                  <span className="rounded-full bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-700">Waiting to be received</span>
                  <button
                    type="button"
                    onClick={() => pullBackHandover(h.id)}
                    className="text-slate-400 underline hover:text-rose-600"
                    data-testid={`branch-handover-cancel-${h.id}`}
                  >
                    Cancel
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex w-fit items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5" data-testid="branch-expense-tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setView(t.key)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${view === t.key ? "bg-sky-500 text-white shadow-sm" : "text-slate-500 hover:bg-slate-50"}`}
              data-testid={`branch-expense-tab-${t.key}`}
            >
              {t.label} <span className={view === t.key ? "text-white/70" : "text-slate-400"}>({t.count})</span>
            </button>
          ))}
        </div>
        {view === "request" && (
          <Button
            className="ml-auto bg-sky-600 text-white hover:bg-sky-700"
            onClick={() => setAdding(true)}
            data-testid="branch-expense-add"
          >
            <Plus className="mr-1 h-4 w-4" /> Add Expense
          </Button>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[860px] table-fixed text-xs">
          <colgroup>
            <col className="w-[5%]" />
            <col className="w-[10%]" />
            <col className="w-[18%]" />
            <col className="w-[16%]" />
            <col className="w-[14%]" />
            <col className="w-[12%]" />
            <col className="w-[25%]" />
          </colgroup>
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">S:No</th>
              <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Date</th>
              <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Category</th>
              <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Paid to</th>
              <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Reference</th>
              <th className="px-3 py-2 text-right font-semibold uppercase tracking-wider">Amount</th>
              <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-10 text-center text-slate-400">Loading…</td></tr>
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-slate-400" data-testid="branch-expense-empty">
                  {view === "approved" ? "Nothing approved yet." : "No requests open. Add Expense sends one to the accountant."}
                </td>
              </tr>
            ) : visible.map((r, i) => (
              <tr key={r.id} className="border-t border-slate-100 align-top" data-testid={`branch-expense-row-${r.id}`}>
                <td className="px-3 py-2.5 tabular-nums text-slate-400" data-testid={`branch-expense-sno-${r.id}`}>{i + 1}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-slate-500">{r.expense_date || "—"}</td>
                <td className="px-3 py-2.5 font-medium text-slate-700">
                  {r.category}
                  {r.note ? <span className="block text-[11px] font-normal text-slate-400">{r.note}</span> : null}
                  {r.payment_mode && r.payment_mode !== "cash" ? (
                    <span className="mt-0.5 inline-block rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                      {MODE_LABELS[r.payment_mode] || r.payment_mode}
                    </span>
                  ) : null}
                </td>
                <td className="break-words px-3 py-2.5 text-slate-600">{r.paid_to || "—"}</td>
                <td className="break-words px-3 py-2.5 text-slate-500">{r.reference || "—"}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-slate-800">{fmt(r.amount)}</td>
                <td className="px-3 py-2.5">
                  <StatusChip row={r} />
                  {r.rejected && r.rejection_reason ? (
                    <span className="mt-0.5 block text-[10px] text-rose-600">{r.rejection_reason}</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {adding && (
        <AddExpenseDialog
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); load(); loadCash(); }}
          cashInHand={cashInHand}
        />
      )}
      {handingOver && (
        <HandoverDialog
          onClose={() => setHandingOver(false)}
          onSaved={() => { setHandingOver(false); loadCash(); }}
          cashInHand={cashInHand}
        />
      )}
    </div>
  );
};

export default BranchExpensesPanel;
