import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Receipt, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { MilkDateInput } from "@/components/ui/milk-calendar";
import { getBranches, getFinanceExpenses, createFinanceExpense, deleteFinanceExpense } from "@/lib/api";

const fmt = (n) => `Rs.${(Number(n) || 0).toLocaleString("en-IN")}`;
const todayIso = () => new Date().toISOString().slice(0, 10);

const blankExpense = { category: "", amount: "", branch_id: "", note: "", expense_date: todayIso() };

/** Accountant > Expense — what went out, logged by hand (rent, salaries, supplies —
 *  whatever category is typed). Feeds the Profit tab, which is Revenue less this same
 *  list for the same window. */
export const ExpenseBoard = () => {
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState("");
  const [mode, setMode] = useState("all"); // "all" | "online" | "offline"
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [data, setData] = useState({ expenses: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(blankExpense);
  const [saving, setSaving] = useState(false);

  useEffect(() => { getBranches().then(setBranches).catch(() => {}); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (branchId) params.branch_id = branchId;
      if (mode !== "all") params.mode = mode;
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;
      setData(await getFinanceExpenses(params));
    } catch { /* silent */ }
    setLoading(false);
  }, [branchId, mode, startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!form.category.trim()) { toast.error("Category is required"); return; }
    if (!(Number(form.amount) > 0)) { toast.error("Enter an amount"); return; }
    setSaving(true);
    try {
      await createFinanceExpense({ ...form, amount: Number(form.amount), branch_id: form.branch_id || null });
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

      <div className="flex flex-wrap items-center gap-3">
        {[["all", "All"], ["offline", "Offline"], ["online", "Online"]].map(([key, label]) => (
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
        <select
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          className="h-9 rounded-md border border-slate-200 px-2 text-sm"
          data-testid="finance-expense-branch"
        >
          <option value="">All Branches</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.branch_name}</option>)}
        </select>
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
            <div key={exp.id} className="flex items-center justify-between gap-3 px-4 py-3" data-testid={`finance-expense-row-${exp.id}`}>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800">{exp.category}</p>
                <p className="truncate text-xs text-slate-500">{exp.branch_name} · {exp.expense_date}{exp.note ? ` · ${exp.note}` : ""}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-sm font-bold text-rose-600">{fmt(exp.amount)}</span>
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
              <Input placeholder="Category (e.g. Rent, Salaries)" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} data-testid="finance-expense-category" />
              <Input type="number" min="0" placeholder="Amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} data-testid="finance-expense-amount" />
              <select
                value={form.branch_id}
                onChange={(e) => setForm({ ...form, branch_id: e.target.value })}
                className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm"
                data-testid="finance-expense-form-branch"
              >
                <option value="">All Branches (org-wide)</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.branch_name}</option>)}
              </select>
              <MilkDateInput value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} data-testid="finance-expense-date" />
              <Input placeholder="Note (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} data-testid="finance-expense-note" />
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
