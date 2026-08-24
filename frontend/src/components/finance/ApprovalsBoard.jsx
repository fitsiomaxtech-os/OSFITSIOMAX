import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { getFinanceApprovals, getBranches, approveTransaction, unapproveTransaction } from "@/lib/api";

const fmt = (n) => `Rs.${(Number(n) || 0).toLocaleString("en-IN")}`;

// Every category the backend can return, which is not what this list held: Rehab and
// Zumba were both missing, so a rehab course fee or a class fee could be seen only
// under "All" and vanished the moment any pill was picked. Zumba could not be seen at
// all until finance_approvals started reading the registrations it lives on.
const CATEGORIES = [
  ["all", "All"],
  ["consultation", "Consultations"],
  ["session", "Treatments"],
  ["diet", "Diet"],
  ["rehab", "Rehab"],
  ["zumba", "Zumba"],
  ["store", "Fitsio Store"],
  ["other", "Others"],
];

const MODE_LABELS = { upi: "UPI", account_transfer: "Bank Transfer", cheque: "Cheque", cash: "Cash", card: "Card", partial: "Partial" };
const modeLabel = (m) => MODE_LABELS[m] || (m && m !== "unknown" ? m.charAt(0).toUpperCase() + m.slice(1) : "—");

// Same set a Branch Admin picks from when collecting a fee (V3MarkInstallmentPaidInput
// and its siblings across v3_packages.py) — not a separate list invented for this filter.
const PAYMENT_MODES = [
  ["all", "All Modes"],
  ["cash", "Cash"],
  ["upi", "UPI"],
  ["card", "Card"],
  ["account_transfer", "Bank Transfer"],
  ["cheque", "Cheque"],
];

/**
 * Approve popup — what it asks for depends on the row's own payment mode: Cash gets a
 * re-entered amount (the one figure a cash drawer can't otherwise be checked against);
 * UPI/Bank Transfer/Card get a reference to key against the bank statement; Cheque gets
 * its number. A mode with nothing recognised (package_sold, a store sale rung up with
 * no mode) just confirms the amount, same as Cash.
 */
const ApproveModal = ({ tx, onClose, onApproved }) => {
  const mode = tx.payment_mode;
  const needsRef = mode === "upi" || mode === "card" || mode === "account_transfer";
  const needsCheque = mode === "cheque";
  const needsAmount = !needsRef && !needsCheque;

  const [amount, setAmount] = useState(String(tx.amount || ""));
  const [ref, setRef] = useState("");
  const [chequeNo, setChequeNo] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (needsAmount && !(Number(amount) > 0)) { toast.error("Enter the amount"); return; }
    if (needsRef && !ref.trim()) { toast.error(`Enter the ${mode === "upi" ? "UPI reference" : "transaction ID"}`); return; }
    if (needsCheque && !chequeNo.trim()) { toast.error("Enter the cheque number"); return; }
    setSaving(true);
    try {
      const payload = {};
      if (needsAmount) payload.confirmed_amount = Number(amount);
      if (needsRef) payload.transaction_ref = ref.trim();
      if (needsCheque) payload.cheque_number = chequeNo.trim();
      await approveTransaction(tx.id, payload);
      toast.success(`${tx.patient_name}'s payment approved`);
      onApproved();
    } catch (e) { toast.error(e?.response?.data?.detail || "Approve failed"); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" data-testid="finance-approve-modal">
      <div className="w-full max-w-sm rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h3 className="text-base font-semibold">Approve Payment</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" data-testid="finance-approve-modal-close"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3 p-5">
          <p className="text-sm text-slate-600">
            <span className="font-semibold text-slate-800">{tx.patient_name}</span> · {fmt(tx.amount)} via {modeLabel(mode)}
          </p>
          {needsAmount && (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Re-enter the amount collected</label>
              <Input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="finance-approve-amount" />
            </div>
          )}
          {needsRef && (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">{mode === "upi" ? "UPI Transaction ID" : "Transaction ID"}</label>
              <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder={mode === "upi" ? "UPI ref / UTR" : "Bank transaction ID"} data-testid="finance-approve-ref" />
            </div>
          )}
          {needsCheque && (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Cheque Number</label>
              <Input value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} data-testid="finance-approve-cheque" />
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <Button variant="outline" onClick={onClose} data-testid="finance-approve-cancel">Cancel</Button>
          <Button onClick={submit} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700" data-testid="finance-approve-confirm">
            {saving ? "Approving…" : "Approve"}
          </Button>
        </div>
      </div>
    </div>
  );
};

/**
 * Accountant > Approvals — "new income collected" waiting on sign-off, every kind of
 * revenue (consultation, treatment/session, diet, Fitsio Store) rather than just
 * consultation/package. Approving doesn't touch what counts as revenue anywhere else in
 * the OS — see approve_transaction's docstring — it only records that someone other
 * than whoever collected it looked the payment over, plus whatever the popup asked them
 * to confirm against the payment mode.
 */
export const ApprovalsBoard = () => {
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState("");
  const [mode, setMode] = useState("all"); // "all" | "online" | "offline"
  const [category, setCategory] = useState("all");
  const [paymentMode, setPaymentMode] = useState("all"); // "all" | "cash" | "upi" | "card" | "account_transfer" | "cheque"
  const [view, setView] = useState("pending"); // "pending" | "approved"
  const [data, setData] = useState({ transactions: [], summary: {} });
  const [loading, setLoading] = useState(false);
  const [approving, setApproving] = useState(null);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => { getBranches().then(setBranches).catch(() => {}); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { approved: view === "approved" };
      if (branchId) params.branch_id = branchId;
      if (mode !== "all") params.mode = mode;
      if (category !== "all") params.category = category;
      if (paymentMode !== "all") params.payment_mode = paymentMode;
      setData(await getFinanceApprovals(params));
    } catch { /* silent */ }
    setLoading(false);
  }, [branchId, mode, category, paymentMode, view]);

  useEffect(() => { load(); }, [load]);

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
          <p className="text-2xl font-bold text-amber-700">{fmt(s.pending_total)}</p>
          <p className="text-[10px] text-amber-600">{s.pending_count || 0} payments</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4" data-testid="finance-approvals-approved-card">
          <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-700">Approved</p>
          <p className="text-2xl font-bold text-emerald-700">{fmt(s.approved_total)}</p>
          <p className="text-[10px] text-emerald-600">{s.approved_count || 0} payments</p>
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

      <div className="flex flex-wrap items-center gap-2" data-testid="finance-approvals-category-filter">
        {CATEGORIES.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setCategory(key)}
            className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
              category === key ? "border-sky-600 bg-sky-600 text-white shadow-sm" : "border-slate-200 bg-white text-slate-600 hover:border-sky-300 hover:text-sky-600"
            }`}
            data-testid={`finance-approvals-category-${key}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Same set Branch Admin picks from when collecting the fee in the first place —
          not a category (what was paid for) but how, so it gets its own row rather than
          folding into the one above. */}
      <div className="flex flex-wrap items-center gap-2" data-testid="finance-approvals-payment-mode-filter">
        {PAYMENT_MODES.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setPaymentMode(key)}
            className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
              paymentMode === key ? "border-indigo-600 bg-indigo-600 text-white shadow-sm" : "border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-600"
            }`}
            data-testid={`finance-approvals-payment-mode-${key}`}
          >
            {label}
          </button>
        ))}
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
                  {tx.branch_name || "—"} · <span className="capitalize">{tx.category}</span> · {modeLabel(tx.payment_mode)} · {(tx.collected_at || "").slice(0, 10)}
                  {view === "approved" && tx.approved_by && <> · approved by {tx.approved_by}</>}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-sm font-bold text-emerald-600">{fmt(tx.amount)}</span>
                {view === "pending" ? (
                  <Button
                    size="sm"
                    onClick={() => setApproving(tx)}
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

      {approving && (
        <ApproveModal
          tx={approving}
          onClose={() => setApproving(null)}
          onApproved={() => { setApproving(null); load(); }}
        />
      )}
    </div>
  );
};
