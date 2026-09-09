import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Clock, Coins, Plus, Receipt, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { getFinanceExpenses, createFinanceExpense, getPettyCash, topUpPettyCash } from "@/lib/api";
import { PETTY_CASH_LIMIT, PETTY_CASH_REASON_REQUIRED, isPettyCash } from "@/lib/pettyCash";

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

const AddExpenseDialog = ({ onClose, onSaved, pettyBalance }) => {
  const [form, setForm] = useState({
    category: CATEGORIES[0], amount: "", expense_date: todayIso(),
    paid_to: "", payment_mode: "cash", reference: "", note: "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const petty = isPettyCash(form.amount, form.payment_mode);

  const submit = async () => {
    const amount = Number(form.amount);
    if (!(amount > 0)) { toast.error("Enter how much was spent"); return; }
    if (!form.paid_to.trim()) { toast.error("Say who it was paid to"); return; }
    // Refused here as well as on the server, so the branch is told at the field rather
    // than by a request coming back. Petty cash is the one kind of spending with no paper
    // behind it -- no invoice, no reference, just notes out of a tin -- so the reason is
    // the whole of what the accountant has to approve it on, and an empty one sends them
    // a figure to initial.
    if (petty && !form.note.trim()) {
      toast.error(PETTY_CASH_REASON_REQUIRED);
      return;
    }
    setSaving(true);
    try {
      await createFinanceExpense({ ...form, amount });
      toast.success(petty
        ? "Sent to the accountant — and taken out of the tin"
        : "Sent to the accountant for approval");
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

          {/* Said while it is being typed, not after it is sent. An expense at or under the
              limit paid in cash comes out of the tin, and the branch is the one who has to
              have the notes -- so it is told what the tin holds and what will be left,
              before it presses Send rather than by a balance that has quietly moved. */}
          {petty && (
            <div
              className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px] ${
                pettyBalance != null && Number(form.amount) > pettyBalance
                  ? "border-amber-200 bg-amber-50 text-amber-800"
                  : "border-sky-200 bg-sky-50 text-sky-800"
              }`}
              data-testid="branch-expense-petty-hint"
            >
              <Coins className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                <b>Petty cash.</b> Rs.{PETTY_CASH_LIMIT.toLocaleString("en-IN")} or less paid in cash comes out of the tin.
                {pettyBalance != null && (
                  <>
                    {" "}It holds {fmt(pettyBalance)} — {fmt(pettyBalance - Number(form.amount))} after this.
                    {Number(form.amount) > pettyBalance && " That is more than is in it; record it anyway if the money was spent, then top the tin up."}
                  </>
                )}
              </span>
            </div>
          )}

          {/* Asked of every expense and required of the petty cash ones. A Rs.40,000 rent
              payment carries a payee, a bill number and a transfer behind it; Rs.120 out of
              a tin carries this sentence and nothing else, and a month of them reading
              "Travel" is a month no accountant can check. */}
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {petty ? "Reason — what the petty cash was spent on *" : "What it was for"}
            </label>
            <textarea
              rows={3}
              value={form.note}
              onChange={(e) => set("note", e.target.value)}
              placeholder={petty ? "Auto to the courier office, receipt kept in the tin" : "The accountant reads this before approving it"}
              className={`w-full rounded-md border px-3 py-2 text-sm focus:outline-none ${
                petty && !form.note.trim()
                  ? "border-amber-300 focus:border-amber-400"
                  : "border-slate-200 focus:border-sky-400"
              }`}
              data-testid="branch-expense-note"
            />
            {petty && !form.note.trim() && (
              <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-amber-700" data-testid="branch-expense-reason-missing">
                <AlertTriangle className="h-3 w-3" />
                Required for petty cash — it is the only thing the accountant can approve it on
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

/**
 * @param branchId  Whose tin to show. Petty cash belongs to a desk, so with no branch in
 *                  view there is nothing to show a balance for and the block is left out
 *                  rather than adding four branches' tins into one figure that is not in
 *                  any of them. Only the petty cash block is scoped by it -- the expense
 *                  list below keeps whatever scope it always had.
 */
export const BranchExpensesPanel = ({ onChanged, branchId }) => {
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState({ approved_total: 0, approved_count: 0, pending_total: 0, pending_count: 0 });
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("request"); // "request" | "approved"
  const [adding, setAdding] = useState(false);
  const [petty, setPetty] = useState(null);
  const [toppingUp, setToppingUp] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState("");
  const [topUpNote, setTopUpNote] = useState("");
  // The tin's book, folded away by default. What is in the tin is the figure a desk needs
  // at a glance; what went through it is the thing somebody opens when the figure looks
  // wrong, and eight lines of history above the expense table would push the table off the
  // screen for everyone else.
  const [showMovements, setShowMovements] = useState(false);

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

  // The tin, reloaded whenever the expenses are -- a small cash expense draws it down as
  // it is raised, so a balance fetched once at mount would be wrong by the second one.
  const loadPetty = useCallback(async () => {
    if (!branchId) { setPetty(null); return; }
    try {
      setPetty(await getPettyCash({ branch_id: branchId }));
    } catch {
      setPetty(null);
    }
  }, [branchId]);

  useEffect(() => { loadPetty(); }, [loadPetty]);

  const submitTopUp = async () => {
    const amount = Number(topUpAmount);
    if (!(amount > 0)) { toast.error("Enter how much is going into the tin"); return; }
    setToppingUp(true);
    try {
      // The note rides along so the tin's book reads as sentences rather than as a column
      // of bare amounts -- the same reason a petty cash expense has to carry its reason.
      await topUpPettyCash({ branch_id: branchId, amount, note: topUpNote.trim() });
      toast.success("Petty cash topped up");
      setTopUpAmount("");
      setTopUpNote("");
      loadPetty();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not top up petty cash");
    } finally {
      setToppingUp(false);
    }
  };

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
      {/* The two figures that matter: what is waiting on somebody, and what has been
          settled. Two pills rather than two half-page cards — these are a pair of running
          totals, not the revenue board, and stretched across the full width with a 24px
          figure inside they read as the subject of the screen while the list they
          summarise gets pushed under the fold. At pill size they sit on one short line
          and the table starts where the eye already is.

          Sized to their contents and wrapping, so a branch whose expenses run into seven
          figures widens its own pill instead of truncating. */}
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

      {/* The tin. Sits above the two tabs because it is not one of them: what a branch
          holds in small notes is a fact about right now, not a queue of anything, and it
          governs whether the next Rs.200 expense can actually be paid. */}
      {petty && (
        <div
          className={`flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border p-3.5 ${
            petty.balance < 0 ? "border-rose-200 bg-rose-50" : "border-slate-200 bg-white"
          }`}
          data-testid="branch-petty-cash"
        >
          <div className="flex items-center gap-2.5">
            <span className={`rounded-lg p-2 ${petty.balance < 0 ? "bg-rose-100" : "bg-amber-50"}`}>
              <Coins className={`h-4 w-4 ${petty.balance < 0 ? "text-rose-600" : "text-amber-600"}`} />
            </span>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Petty cash in hand</p>
              <p
                className={`text-xl font-bold tabular-nums ${petty.balance < 0 ? "text-rose-700" : "text-slate-800"}`}
                data-testid="branch-petty-cash-balance"
              >
                {fmt(petty.balance)}
              </p>
            </div>
          </div>

          {/* Overdrawn is a real state and is shown as one rather than refused at the
              door: the notes were handed over whatever the tin said, and an expense the
              branch cannot record is an expense nobody can account for later. */}
          {petty.balance < 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-rose-100 px-2.5 py-1.5 text-[11px] font-semibold text-rose-700" data-testid="branch-petty-cash-overdrawn">
              <AlertTriangle className="h-3.5 w-3.5" />
              More has been spent than was put in — top the tin up
            </span>
          )}

          <p className="text-[11px] text-slate-400">
            Rs.{PETTY_CASH_LIMIT.toLocaleString("en-IN")} or less, paid in cash, comes out of here automatically.
          </p>

          {/* Notes moving from the drawer into the tin. Not an expense: nothing has been
              spent, and the branch holds the same cash after it as before. */}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Input
              type="number"
              min="0"
              value={topUpAmount}
              onChange={(e) => setTopUpAmount(e.target.value)}
              placeholder="Top up"
              className="h-9 w-28 text-sm tabular-nums"
              data-testid="branch-petty-cash-topup-amount"
            />
            <Input
              value={topUpNote}
              onChange={(e) => setTopUpNote(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitTopUp(); }}
              placeholder="What it is for"
              className="h-9 w-44 text-sm"
              data-testid="branch-petty-cash-topup-note"
            />
            <Button
              onClick={submitTopUp}
              disabled={toppingUp}
              className="h-9 bg-amber-600 text-xs text-white hover:bg-amber-700"
              data-testid="branch-petty-cash-topup"
            >
              {toppingUp ? "Adding…" : "Add to tin"}
            </Button>
          </div>

          {/* The book behind the balance. Every line says what it was for, because that is
              the only evidence a tin produces -- there is no invoice to go back to. */}
          <div className="w-full border-t border-slate-100 pt-2">
            <button
              type="button"
              onClick={() => setShowMovements((v) => !v)}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-700"
              data-testid="branch-petty-cash-movements-toggle"
            >
              {showMovements ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              Movements ({(petty.movements || []).length})
              <span className="ml-1 font-normal text-slate-400">
                In {fmt(petty.topped_up)} · Out {fmt(petty.spent)}
              </span>
            </button>
            {showMovements && (
              <div className="mt-2 space-y-1" data-testid="branch-petty-cash-movements">
                {(petty.movements || []).length === 0 ? (
                  <p className="py-3 text-center text-[11px] text-slate-400">Nothing has moved through the tin yet.</p>
                ) : (petty.movements || []).slice(0, 12).map((m) => (
                  <div key={m.id} className="flex items-baseline gap-2 rounded-md bg-slate-50/70 px-2.5 py-1.5 text-[11px]" data-testid={`branch-petty-cash-movement-${m.id}`}>
                    <span className="w-20 shrink-0 tabular-nums text-slate-400">{m.on || "—"}</span>
                    <span className="min-w-0 flex-1 break-words text-slate-600">
                      {m.note || (m.kind === "topup" ? "Topped up" : "Spent")}
                      {m.created_by ? <span className="text-slate-400"> · {m.created_by}</span> : null}
                    </span>
                    <span className={`shrink-0 font-semibold tabular-nums ${m.delta > 0 ? "text-emerald-700" : "text-rose-600"}`}>
                      {m.delta > 0 ? "+" : "−"}{fmt(m.amount)}
                    </span>
                  </div>
                ))}
                {(petty.movements || []).length > 12 && (
                  <p className="pt-1 text-[10px] text-slate-400">
                    Showing the last 12 of {(petty.movements || []).length}.
                  </p>
                )}
              </div>
            )}
          </div>
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
        {/* table-fixed with a colgroup, not auto widths. Left to itself the browser hands
            the leftover width of a 1900px screen to whichever column holds the longest
            string, so Date sat marooned at the far left, Category and Paid to drifted
            apart, and the row read as scattered rather than as a line. Pinned proportions
            put every column where the reader expects it whatever is in the cells, and the
            same eight land in the same places on every row.

            Percentages rather than pixels so the table still fills a wide screen; the
            min-width underneath is what stops them collapsing on a narrow one, where the
            wrapper scrolls sideways instead. */}
        <table className="w-full min-w-[920px] table-fixed text-xs">
          <colgroup>
            <col className="w-[5%]" />
            <col className="w-[10%]" />
            <col className="w-[16%]" />
            <col className="w-[15%]" />
            <col className="w-[9%]" />
            <col className="w-[13%]" />
            <col className="w-[12%]" />
            <col className="w-[20%]" />
          </colgroup>
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              {/* Position in the list on screen, so two people can say "the second one"
                  about the same row. It renumbers when the tab changes, because it counts
                  what is in front of the reader rather than identifying the expense. */}
              <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">S:No</th>
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
              <tr><td colSpan={8} className="px-3 py-10 text-center text-slate-400">Loading…</td></tr>
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-slate-400" data-testid="branch-expense-empty">
                  {view === "approved" ? "Nothing approved yet." : "No requests open. Add Expense sends one to the accountant."}
                </td>
              </tr>
            ) : visible.map((r, i) => (
              /* align-top, because a category carrying a note is two lines deep and every
                 other cell is one. Centred against it, Paid to and Mode floated half a
                 line below the category they belong to; topped, every cell on the row
                 starts on the same line. */
              <tr key={r.id} className="border-t border-slate-100 align-top" data-testid={`branch-expense-row-${r.id}`}>
                <td className="px-3 py-2.5 tabular-nums text-slate-400" data-testid={`branch-expense-sno-${r.id}`}>{i + 1}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-slate-500">{r.expense_date || "—"}</td>
                <td className="px-3 py-2.5 font-medium text-slate-700">
                  {r.category}
                  {r.note ? <span className="block text-[11px] font-normal text-slate-400">{r.note}</span> : null}
                </td>
                {/* break-words, not truncation: a long payee or reference is what somebody
                    checks the row against, and a fixed-width column would otherwise cut it
                    off mid-name with no way to see the rest. */}
                <td className="break-words px-3 py-2.5 text-slate-600">{r.paid_to || "—"}</td>
                <td className="px-3 py-2.5 text-slate-600">
                  {(MODES.find(([k]) => k === r.payment_mode) || [null, r.payment_mode || "—"])[1]}
                  {/* Marked on the row rather than left to be worked out from the amount
                      and the mode: this is the one the tin paid for, so it is the one whose
                      reason above is the only record of what the money bought. */}
                  {r.petty_cash ? (
                    <span className="mt-0.5 inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700" data-testid={`branch-expense-petty-${r.id}`}>
                      <Coins className="h-2.5 w-2.5" /> Tin
                    </span>
                  ) : null}
                </td>
                <td className="break-words px-3 py-2.5 text-slate-500">{r.reference || "—"}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-slate-800">{fmt(r.amount)}</td>
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
          onSaved={() => { setAdding(false); load(); loadPetty(); }}
          pettyBalance={petty ? petty.balance : null}
        />
      )}
    </div>
  );
};

export default BranchExpensesPanel;
