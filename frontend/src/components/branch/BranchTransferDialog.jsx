import { useEffect, useState } from "react";
import { ArrowLeftRight, Search, X, ReceiptText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import {
  getBranchBoard, getBranches, getLeadTransferEligibility, transferLeadBranch,
} from "@/lib/api";

// Rs.1200 rather than Rs.1200.00 when the paise are zero, which they are for almost every
// collection — the history is a column of amounts and two dead digits on each of them is
// two digits of noise between the reader and the number that is actually different.
const money = (n) => {
  const v = Number(n || 0);
  return Number.isInteger(v) ? `Rs.${v}` : `Rs.${v.toFixed(2)}`;
};

// The date alone. A receipt is looked up by the day it was issued, and a time to the second
// only makes the rows harder to scan against a patient's own paperwork.
const onDay = (iso) => (iso ? String(iso).slice(0, 10) : "—");

const MODE_LABELS = {
  cash: "Cash", upi: "UPI", card: "Card", cheque: "Cheque",
  account_transfer: "Bank transfer", unknown: "",
};

/**
 * What this patient has paid, itemised, against the branch that took each payment.
 *
 * Read before a transfer rather than after it. The impact panel above says how much stays
 * behind as one figure, and a single figure is exactly what gets disputed a week later —
 * this is the same money as a list of receipts, so the branch losing it can see which rows
 * are theirs and the branch gaining the patient can see what was already settled.
 *
 * A row attributed to some other branch is not an error: it is a payment taken before an
 * earlier transfer, and it stays with whoever collected it.
 */
const PaymentHistory = ({ rows, currentBranchName }) => {
  const [open, setOpen] = useState(false);
  const list = rows || [];
  const total = list.reduce((sum, r) => sum + Number(r.amount || 0), 0);

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-white" data-testid="branch-transfer-payments">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
        data-testid="branch-transfer-payments-toggle"
      >
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700">
          <ReceiptText className="h-3.5 w-3.5 text-slate-400" />
          Payment history
          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
            {list.length}
          </span>
        </span>
        <span className="text-xs text-slate-500">
          {money(total)} total <span className="text-slate-400">{open ? "▲" : "▼"}</span>
        </span>
      </button>

      {open && (
        list.length === 0 ? (
          <p className="border-t border-slate-100 px-3 py-3 text-xs text-slate-400" data-testid="branch-transfer-payments-empty">
            This patient has not paid anything yet, so the move leaves no money behind.
          </p>
        ) : (
          <div className="max-h-52 overflow-y-auto border-t border-slate-100" data-testid="branch-transfer-payments-list">
            {list.map((p) => {
              // Only flagged when it is genuinely somebody else's, so the common case —
              // every receipt belonging to the branch on screen — stays unmarked.
              const elsewhere = p.branch_name && p.branch_name !== currentBranchName;
              return (
                <div
                  key={p.id || `${p.collected_at}-${p.label}`}
                  className="flex items-start justify-between gap-3 border-b border-slate-50 px-3 py-2 last:border-b-0"
                  data-testid={`branch-transfer-payment-${p.id}`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-slate-800">
                      {p.label}
                      {MODE_LABELS[p.payment_mode] ? (
                        <span className="ml-1.5 font-normal text-slate-400">via {MODE_LABELS[p.payment_mode]}</span>
                      ) : null}
                    </p>
                    <p className="truncate text-[11px] text-slate-500">
                      {onDay(p.collected_at)}
                      {p.collected_by ? ` · ${p.collected_by}` : ""}
                      {p.transaction_id ? ` · ${p.transaction_id}` : ""}
                    </p>
                    {elsewhere && (
                      <p className="text-[10px] font-medium text-amber-600">
                        collected at {p.branch_name} — stays in that branch's book
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 text-xs font-semibold text-slate-800">{money(p.amount)}</span>
                </div>
              );
            })}
          </div>
        )
      )}
    </div>
  );
};

/**
 * Branch Transfer — moving one patient from the branch on screen to another.
 *
 * Two windows and a gap between them, which the backend enforces and this only reports:
 * a lead nobody has booked a consultation for yet, and a patient already in treatment at
 * Physio Assign. Everything between the two is refused, because a booked consultation sits
 * on a named Head Physio's calendar here and a part-collected Treatment Fee would leave its
 * installments split across two branches' books.
 *
 * The dialog is deliberately slow at the last step. A transfer releases booked treatment
 * days and moves a patient off the board their branch admin is working, so the eligible
 * list is only the first half of it — picking someone loads what the move would actually
 * cost, and the button that does it says the cost out loud.
 *
 * Opened from Operations (Super Admin, for any branch) and from a branch's own board (its
 * Branch Admin, for their branch only). Same dialog either way: the backend decides who may
 * move whom, and a second copy of this screen for the branch case is how the two would come
 * to warn about different things. `branches` is a prop where the caller already has the
 * list and fetched here where it does not.
 */
export const BranchTransferDialog = ({ branches: branchesProp, fromBranchId, onClose, onTransferred }) => {
  const [leads, setLeads] = useState(null);
  const [branches, setBranches] = useState(branchesProp || null);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState(null);
  const [eligibility, setEligibility] = useState(null);
  const [toBranchId, setToBranchId] = useState("");
  const [reason, setReason] = useState("");
  const [transferring, setTransferring] = useState(false);
  const [done, setDone] = useState(null);

  const fromBranch = (branches || []).find((b) => b.id === fromBranchId);

  useEffect(() => {
    if (branchesProp) { setBranches(branchesProp); return; }
    let cancelled = false;
    getBranches()
      .then((d) => { if (!cancelled) setBranches(d || []); })
      .catch(() => { if (!cancelled) setBranches([]); });
    return () => { cancelled = true; };
  }, [branchesProp]);

  useEffect(() => {
    let cancelled = false;
    getBranchBoard(fromBranchId)
      .then((d) => { if (!cancelled) setLeads(d?.leads || []); })
      .catch(() => { if (!cancelled) setLeads([]); });
    return () => { cancelled = true; };
  }, [fromBranchId]);

  // The same two windows the backend gates on, so the list offers only what it would
  // accept. Read off consultation_stage alone: null is a lead nobody has booked yet, and
  // Physio Assign is one already in treatment.
  const transferable = (leads || []).filter((l) => {
    const stage = l.consultation_stage;
    return stage == null || stage === "Physio Assign";
  });
  const q = search.trim().toLowerCase();
  const shown = q
    ? transferable.filter((l) => `${l.name || ""} ${l.phone || ""} ${l.patient_number || ""}`.toLowerCase().includes(q))
    : transferable;

  const pick = (lead) => {
    setPicked(lead);
    setEligibility(null);
    setToBranchId("");
    setReason("");
    getLeadTransferEligibility(lead.id).then(setEligibility).catch(() => setEligibility(null));
  };

  const submit = async () => {
    if (!toBranchId) { toast.error("Pick the branch to transfer to"); return; }
    setTransferring(true);
    try {
      const res = await transferLeadBranch(picked.id, { to_branch_id: toBranchId, reason });
      setDone({ ...res, name: picked.name });
      toast.success(res.message);
      // The list this came from is now one patient shorter. Refetched rather than spliced
      // so a second transfer in the same sitting reads the board as it now stands.
      getBranchBoard(fromBranchId).then((d) => setLeads(d?.leads || [])).catch(() => {});
      // The board behind this dialog is showing a patient who has just left it.
      onTransferred && onTransferred();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Transfer failed");
    }
    setTransferring(false);
  };

  const destinations = (branches || []).filter((b) => b.id !== fromBranchId);
  const toBranch = destinations.find((b) => b.id === toBranchId);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" data-testid="ops-branch-transfer-dialog">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h3 className="inline-flex items-center gap-2 text-base font-semibold">
            <ArrowLeftRight className="h-4 w-4 text-indigo-600" />
            Branch Transfer
            {fromBranch && <span className="text-sm font-normal text-slate-500">from {fromBranch.branch_name}</span>}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" data-testid="ops-branch-transfer-close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-5">
          {done ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4" data-testid="ops-branch-transfer-done">
              <p className="text-sm font-semibold text-emerald-800">{done.name} — {done.message}</p>
              <ul className="mt-2 space-y-1 text-xs text-emerald-700">
                {done.sessions_released > 0 && (
                  <li>{done.sessions_released} booked treatment day{done.sessions_released === 1 ? "" : "s"} released — the new branch books the rest.</li>
                )}
                {done.sessions_kept > 0 && (
                  <li>{done.sessions_kept} completed day{done.sessions_kept === 1 ? "" : "s"} stay on the record, with the physio who ran them.</li>
                )}
                <li>Rs.{done.revenue_left_behind} stays in {fromBranch?.branch_name || "this branch"}'s book.</li>
              </ul>
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="outline" onClick={() => { setDone(null); setPicked(null); setEligibility(null); }} data-testid="ops-branch-transfer-again">
                  Transfer another
                </Button>
                <Button size="sm" onClick={onClose} data-testid="ops-branch-transfer-finish">Done</Button>
              </div>
            </div>
          ) : !picked ? (
            <>
              <p className="text-xs leading-relaxed text-slate-500">
                A patient can be transferred before their consultation is booked, or once treatment
                has started at Physio Assign. In between — a consultation booked on this branch's
                Head Physio calendar, or a Treatment Fee part-collected — they stay put.
              </p>
              <div className="relative mt-3">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name, phone or patient number"
                  className="h-9 w-full rounded-md border border-slate-200 pl-8 pr-3 text-sm outline-none focus:border-indigo-400"
                  data-testid="ops-branch-transfer-search"
                />
              </div>
              {leads === null ? (
                <p className="py-8 text-center text-sm text-slate-400">Loading this branch's patients…</p>
              ) : shown.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-400" data-testid="ops-branch-transfer-empty">
                  {transferable.length === 0
                    ? "Nobody at this branch is in a transferable state right now."
                    : "No patient here matches that search."}
                </p>
              ) : (
                <div className="mt-3 space-y-1.5" data-testid="ops-branch-transfer-list">
                  {shown.map((l) => (
                    <button
                      key={l.id}
                      onClick={() => pick(l)}
                      className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-2.5 text-left hover:border-indigo-300 hover:bg-indigo-50/40"
                      data-testid={`ops-branch-transfer-lead-${l.id}`}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-800">{l.name || "—"}</p>
                        <p className="truncate text-[11px] text-slate-500">
                          {l.patient_number || l.phone || "—"}
                          {l.consultation_stage === "Physio Assign" && l.assigned_physio_name ? ` · with ${l.assigned_physio_name}` : ""}
                        </p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        l.consultation_stage === "Physio Assign" ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-600"
                      }`}>
                        {l.consultation_stage === "Physio Assign" ? "In treatment" : "Lead"}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <button
                onClick={() => { setPicked(null); setEligibility(null); }}
                className="text-xs font-medium text-indigo-600 hover:underline"
                data-testid="ops-branch-transfer-back"
              >
                ← Back to the list
              </button>
              <p className="mt-2 text-base font-semibold text-slate-800">{picked.name || "—"}</p>
              <p className="text-xs text-slate-500">{picked.patient_number || picked.phone || "—"}</p>

              {!eligibility ? (
                <p className="py-6 text-center text-sm text-slate-400">Checking what this move would cost…</p>
              ) : !eligibility.can_transfer ? (
                <>
                  <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs leading-relaxed text-rose-700" data-testid="ops-branch-transfer-blocked">
                    {eligibility.blocked_reason}
                  </p>
                  {/* Shown even when the move is refused. "Why can't I move them" and "what
                      have they paid" are the same question asked twice, and the answer is
                      as useful to the branch that has to wait as to the one that may go. */}
                  <PaymentHistory rows={eligibility.payment_history} currentBranchName={fromBranch?.branch_name} />
                </>
              ) : (
                <>
                  {/* What the move costs, before it is made rather than in the toast after. */}
                  <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3" data-testid="ops-branch-transfer-impact">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">What this move does</p>
                    <ul className="mt-1.5 space-y-1 text-xs text-amber-800">
                      {eligibility.sessions_to_release > 0 ? (
                        <li>
                          <b>{eligibility.sessions_to_release}</b> booked treatment day{eligibility.sessions_to_release === 1 ? "" : "s"}
                          {eligibility.current_physio_name ? ` with ${eligibility.current_physio_name}` : ""} will be released. The new branch books them again there.
                        </li>
                      ) : (
                        <li>No treatment days are booked, so nothing is released.</li>
                      )}
                      {eligibility.sessions_completed > 0 && (
                        <li><b>{eligibility.sessions_completed}</b> completed day{eligibility.sessions_completed === 1 ? "" : "s"} stay on the record and still count toward the course.</li>
                      )}
                      <li>
                        <b>Rs.{eligibility.revenue_staying_behind}</b> already collected stays in {fromBranch?.branch_name || "this branch"}'s book.
                        Anything collected from here on belongs to the new branch.
                      </li>
                      <li>The Patient Number stays <b>{eligibility.patient_number || "—"}</b>, so receipts already issued still find them.</li>
                    </ul>
                  </div>

                  {/* The figure above, itemised. Collapsed by default: most transfers are of
                      a lead who has paid nothing, and the count in the header already says
                      so without costing a click. */}
                  <PaymentHistory rows={eligibility.payment_history} currentBranchName={fromBranch?.branch_name} />

                  {eligibility.transfers_so_far > 0 && (
                    <p className="mt-2 text-[11px] text-slate-500" data-testid="ops-branch-transfer-prior">
                      This patient has been transferred {eligibility.transfers_so_far} time{eligibility.transfers_so_far === 1 ? "" : "s"} before.
                    </p>
                  )}

                  <label className="mt-3 block text-xs font-semibold text-slate-600">Transfer to</label>
                  <select
                    value={toBranchId}
                    onChange={(e) => setToBranchId(e.target.value)}
                    className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2 text-sm outline-none focus:border-indigo-400"
                    data-testid="ops-branch-transfer-destination"
                  >
                    <option value="">Choose a branch…</option>
                    {destinations.map((b) => (
                      <option key={b.id} value={b.id}>{b.branch_name}</option>
                    ))}
                  </select>

                  <label className="mt-3 block text-xs font-semibold text-slate-600">Reason <span className="font-normal text-slate-400">(optional, kept on the record)</span></label>
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. patient moved house"
                    className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2 text-sm outline-none focus:border-indigo-400"
                    data-testid="ops-branch-transfer-reason"
                  />

                  <div className="mt-4 flex justify-end gap-2">
                    <Button variant="outline" onClick={onClose} data-testid="ops-branch-transfer-cancel">Cancel</Button>
                    <Button
                      className="bg-indigo-600 text-white hover:bg-indigo-700"
                      disabled={!toBranchId || transferring}
                      onClick={submit}
                      data-testid="ops-branch-transfer-submit"
                    >
                      {transferring
                        ? "Transferring…"
                        : toBranch
                          ? `Transfer to ${toBranch.branch_name}`
                          : "Transfer"}
                    </Button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default BranchTransferDialog;
