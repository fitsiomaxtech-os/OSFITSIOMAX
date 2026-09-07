import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Clock, Plus, Receipt, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { getFinanceExpenses, createFinanceExpense } from "@/lib/api";

const fmt = (n) => `Rs.${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

// What a branch actually spends on. A fixed list rather than a free-text box: an
// accountant reading a month of these wants them to add up by category, and typed
// categories drift into "Maintenance", "maintenence" and "AC repair" for one thing.
const CATEGORIES = [
  "Rent", "Salary", "Electricity", "Water", "Internet & Phone", "Maintenance",
  "Equipment", "Consumables", "Housekeeping", "Marketing", "Travel", "Other",
];

// The same set a Branch Admin picks from when collecting a fee, so money going out is
// described the way money coming in already is.
const MODES = [
  ["cash", "Cash"], ["upi", "UPI"], ["card", "Card"],
  ["account_transfer", "Bank Transfer"], ["cheque", "Cheque"],
];

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * What a branch has asked to spend, and what has been signed off.
 *
 * The branch raises; the accountant decides. A Branch Admin cannot approve their own
 * spending here for the same reason they cannot approve their own collections — approval
 * is somebody other than the person who spent it saying the money went where the form
 * says it went. So this screen has no approve button on it at all: raising is the whole
 * of what a branch does, and the two tabs are the two answers it can get back.
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

const AddExpenseDialog = ({ onClose, onSaved }) => {
  const [form, setForm] = useState({
    category: CATEGORIES[0], amount: "", expense_date: todayIso(),
    paid_to: "", payment_mode: "cash", reference: "", note: "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    const amount = Number(form.amount);
    if (!(amount > 0)) { toast.error("Enter how much was spent"); return; }
    if (!form.paid_to.trim()) { toast.error("Say who it was paid to"); return; }
    setSaving(true);
    try {
      await createFinanceExpense({ ...form, amount });
      toast.success("Sent to the accountant for approval");
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
            <p className="text-[11px] text-slate-500">Goes to the accountant to approve before it counts.</p>
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
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
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
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Paid by</label>
              <select
                value={form.payment_mode}
                onChange={(e) => set("payment_mode", e.target.value)}
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none"
                data-testid="branch-expense-mode"
              >
                {MODES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Bill / reference no.</label>
              <Input
                value={form.reference}
                onChange={(e) => set("reference", e.target.value)}
                placeholder="Optional"
                data-testid="branch-expense-reference"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">What it was for</label>
            <textarea
              rows={3}
              value={form.note}
              onChange={(e) => set("note", e.target.value)}
              placeholder="The accountant reads this before approving it"
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none"
              data-testid="branch-expense-note"
            />
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

export const BranchExpensesPanel = ({ onChanged }) => {
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState({ approved_total: 0, approved_count: 0, pending_total: 0, pending_count: 0 });
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("request"); // "request" | "approved"
  const [adding, setAdding] = useState(false);

  // Held in a ref rather than named as a dependency of `load`: the caller passes an inline
  // arrow, which is a new function every render, and as a dependency it would rebuild
  // `load`, which the effect below re-runs on — a fetch loop for as long as the tab is open.
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
      // The card above this panel carries the same two figures and fetches them itself,
      // because it has to have them before anybody opens this. Told here so raising one
      // does not leave the header behind until the tab is reloaded.
      onChangedRef.current?.();
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Requests holds anything still open and anything turned down: both are the branch's to
  // deal with, and a rejected row filed under Approved would be a lie in a column of
  // figures. Approved holds only what counts against the branch's books.
  const visible = useMemo(
    () => rows.filter((r) => (view === "approved" ? r.approved : !r.approved)),
    [rows, view],
  );

  const TABS = [
    { key: "request", label: "Expense Requests", count: rows.filter((r) => !r.approved).length },
    { key: "approved", label: "Expenses Approved", count: totals.approved_count },
  ];

  return (
    <div className="space-y-4" data-testid="branch-expenses-panel">
      {/* The two figures that matter, in the shape the revenue cards above use: what is
          waiting on somebody, and what has been settled. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4" data-testid="branch-expense-card-pending">
          <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700">Pending Approval</p>
          <p className="mt-1 text-2xl font-bold text-amber-700">{fmt(totals.pending_total)}</p>
          <p className="text-[11px] text-amber-600/80">{totals.pending_count} {totals.pending_count === 1 ? "request" : "requests"}</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4" data-testid="branch-expense-card-approved">
          <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Approved</p>
          <p className="mt-1 text-2xl font-bold text-emerald-700">{fmt(totals.approved_total)}</p>
          <p className="text-[11px] text-emerald-600/80">{totals.approved_count} {totals.approved_count === 1 ? "expense" : "expenses"}</p>
        </div>
      </div>

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
        {/* Only on Requests. Adding one is raising a request, and an Add button on the
            Approved tab would offer to write straight into the settled column. */}
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
        <table className="w-full min-w-[860px] text-xs">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Date</th>
              <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Category</th>
              <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Paid to</th>
              <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Mode</th>
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
            ) : visible.map((r) => (
              <tr key={r.id} className="border-t border-slate-100" data-testid={`branch-expense-row-${r.id}`}>
                <td className="whitespace-nowrap px-3 py-2.5 text-slate-500">{r.expense_date || "—"}</td>
                <td className="px-3 py-2.5 font-medium text-slate-700">
                  {r.category}
                  {r.note ? <span className="block text-[11px] font-normal text-slate-400">{r.note}</span> : null}
                </td>
                <td className="px-3 py-2.5 text-slate-600">{r.paid_to || "—"}</td>
                <td className="px-3 py-2.5 text-slate-600">
                  {(MODES.find(([k]) => k === r.payment_mode) || [null, r.payment_mode || "—"])[1]}
                </td>
                <td className="px-3 py-2.5 text-slate-500">{r.reference || "—"}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold text-slate-800">{fmt(r.amount)}</td>
                <td className="px-3 py-2.5">
                  <StatusChip row={r} />
                  {/* Said, not just marked. A branch left with a rejected row and no
                      reason has nothing to correct and sends the same one again. */}
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
          onSaved={() => { setAdding(false); load(); }}
        />
      )}
    </div>
  );
};

export default BranchExpensesPanel;
