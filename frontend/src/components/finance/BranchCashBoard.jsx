import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Coins, HandCoins, Layers, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { getBranches, getBranchCash, setBranchCashAdjustment, receiveCashHandover } from "@/lib/api";
import { notesLabel } from "@/lib/denominations";

const fmt = (n) => `Rs.${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const ALL = "all";

const TONE_TEXT = { slate: "text-slate-800", amber: "text-amber-700", emerald: "text-emerald-700" };

const Figure = ({ label, value, tone = "slate", testId }) => (
  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5" data-testid={testId}>
    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
    <p className={`text-lg font-bold tabular-nums ${TONE_TEXT[tone] || TONE_TEXT.slate}`}>{value}</p>
  </div>
);

const OpeningCashForm = ({ branchId, branchName, isCorrection, onDone }) => {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const counted = Number(amount);
    if (!(counted >= 0)) { toast.error("Enter the counted cash"); return; }
    setSaving(true);
    try {
      await setBranchCashAdjustment({
        branch_id: branchId,
        reason: isCorrection ? "correction" : "opening",
        counted_amount: counted,
        note: note.trim(),
      });
      toast.success(isCorrection ? "Cash balance corrected" : "Opening cash set");
      onDone();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save that");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-4" data-testid="branch-cash-opening-form">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
        <ShieldCheck className="h-4 w-4 text-sky-600" />
        {isCorrection ? `Correct ${branchName || "this branch"}'s cash` : `Set ${branchName || "this branch"}'s opening cash`}
      </p>
      <p className="mt-0.5 text-[11px] text-slate-500">
        {isCorrection
          ? "Count the drawer and enter what is actually in it. The difference is written as a correction."
          : "Count the branch drawer now and enter the total. From here the box tracks every collection, expense and handover on its own."}
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Counted cash</label>
          <Input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" className="w-40 tabular-nums" data-testid="branch-cash-opening-amount" />
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Note</label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" data-testid="branch-cash-opening-note" />
        </div>
        <Button onClick={submit} disabled={saving} className="bg-sky-600 text-white hover:bg-sky-700" data-testid="branch-cash-opening-submit">
          {saving ? "Saving…" : isCorrection ? "Correct" : "Set opening cash"}
        </Button>
      </div>
    </div>
  );
};

const ReceiveHandoverRow = ({ handover, onReceived }) => {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(handover.amount));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const receive = async () => {
    setSaving(true);
    try {
      const received = Number(amount);
      await receiveCashHandover(handover.id, { received_amount: received, note: note.trim() });
      const variance = received - handover.amount;
      toast.success(Math.abs(variance) < 0.01 ? "Handover received" : `Received with a ${fmt(Math.abs(variance))} ${variance < 0 ? "shortfall" : "excess"}`);
      onReceived();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not receive that");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3" data-testid={`branch-cash-handover-${handover.id}`}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <HandCoins className="h-3.5 w-3.5 text-amber-600" />
        <span className="font-bold tabular-nums text-slate-800">{fmt(handover.amount)}</span>
        <span className="text-slate-500">from {handover.branch_name || "branch"} · carried by {handover.handed_to} · {handover.on}</span>
        {notesLabel(handover.cash_denominations) ? (
          <span className="text-slate-400">({notesLabel(handover.cash_denominations)}{Number(handover.cash_coins) > 0 ? ` + Rs.${handover.cash_coins} coins` : ""})</span>
        ) : null}
        {handover.note ? <span className="text-slate-400">— {handover.note}</span> : null}
        {!open && (
          <Button size="sm" className="ml-auto h-7 bg-amber-600 text-[11px] text-white hover:bg-amber-700" onClick={() => setOpen(true)} data-testid={`branch-cash-handover-open-${handover.id}`}>
            Receive
          </Button>
        )}
      </div>
      {open && (
        <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-amber-200 pt-2">
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Counted</label>
            <Input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-32 tabular-nums" data-testid={`branch-cash-handover-amount-${handover.id}`} />
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Note</label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
          </div>
          <Button size="sm" onClick={receive} disabled={saving} className="h-9 bg-emerald-600 text-xs text-white hover:bg-emerald-700" data-testid={`branch-cash-handover-confirm-${handover.id}`}>
            {saving ? "Saving…" : "Confirm receipt"}
          </Button>
          <Button size="sm" variant="outline" className="h-9 text-xs" onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      )}
    </div>
  );
};

/**
 * Accountant / Super Admin — Finance > Branch Cash.
 *
 * One running box per branch: what it collected in cash, what it spent, what it has
 * handed over, and what should be in the drawer right now. The accountant sets each
 * branch's opening figure once (a physical count), receives the cash the branches send
 * up, and corrects a box after a count where it has drifted.
 *
 * @param branchId  Set by Super Admin > Finance's branch-pill row. Left unset (the
 *                  Accountant's own board) this component shows its own branch select.
 */
export const BranchCashBoard = ({ branchId: scopedBranchId, scoped = false }) => {
  const [branches, setBranches] = useState([]);
  const [ownSel, setOwnSel] = useState(ALL);
  const branchId = scoped ? (scopedBranchId || "") : (ownSel === ALL ? "" : ownSel);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (scoped) return;
    getBranches().then((b) => setBranches(b || [])).catch(() => setBranches([]));
  }, [scoped]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getBranchCash(branchId ? { branch_id: branchId } : {}));
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => { load(); }, [load]);

  const branchName = useMemo(() => {
    if (data?.branch_name) return data.branch_name;
    return branches.find((b) => b.id === branchId)?.branch_name || "";
  }, [data, branches, branchId]);

  const pendingHandovers = (data?.handovers || []).filter((h) => h.status === "pending");

  return (
    <div className="space-y-4" data-testid="branch-cash-board">
      {!scoped && (
        <div className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-2" data-testid="branch-cash-branch-row">
          <button
            type="button"
            onClick={() => setOwnSel(ALL)}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${ownSel === ALL ? "bg-sky-600 text-white shadow-sm" : "bg-slate-50 text-slate-600 hover:bg-slate-100"}`}
          >
            <Layers className="h-3.5 w-3.5" /> All Branches
          </button>
          {branches.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setOwnSel(b.id)}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${ownSel === b.id ? "bg-sky-600 text-white shadow-sm" : "bg-slate-50 text-slate-600 hover:bg-slate-100"}`}
            >
              <Building2 className="h-3.5 w-3.5" /> {b.branch_name}
            </button>
          ))}
        </div>
      )}

      {loading && <p className="py-10 text-center text-sm text-slate-400">Loading…</p>}

      {!loading && data && !branchId && (
        <div className="space-y-3" data-testid="branch-cash-rollup">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
            <Figure label="Collected" value={fmt(data.total?.collected_total)} testId="branch-cash-total-collected" />
            <Figure label="Collected (cash)" value={fmt(data.total?.collected_cash)} testId="branch-cash-total-cash" />
            <Figure label="Cash spent" value={fmt(data.total?.cash_spent)} testId="branch-cash-total-spent" />
            <Figure label="Handed over" value={fmt(data.total?.handed_over)} testId="branch-cash-total-handed" />
            <Figure label="In transit" value={fmt(data.total?.in_transit)} tone="amber" testId="branch-cash-total-transit" />
            <Figure label="Cash in hand" value={fmt(data.total?.cash_in_hand)} tone="emerald" testId="branch-cash-total-hand" />
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[720px] text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Branch</th>
                  <th className="px-3 py-2 text-right font-semibold uppercase tracking-wider">Collected (cash)</th>
                  <th className="px-3 py-2 text-right font-semibold uppercase tracking-wider">Spent</th>
                  <th className="px-3 py-2 text-right font-semibold uppercase tracking-wider">Handed over</th>
                  <th className="px-3 py-2 text-right font-semibold uppercase tracking-wider">In transit</th>
                  <th className="px-3 py-2 text-right font-semibold uppercase tracking-wider">Cash in hand</th>
                </tr>
              </thead>
              <tbody>
                {(data.by_branch || []).map((r) => (
                  <tr key={r.branch_id} className="border-t border-slate-100" data-testid={`branch-cash-rollup-${r.branch_id}`}>
                    <td className="px-3 py-2.5 font-medium text-slate-700">
                      {r.branch_name}
                      {!r.opening_set && <span className="ml-1.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">opening not set</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{fmt(r.collected_cash)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{fmt(r.cash_spent)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{fmt(r.handed_over)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-amber-700">{fmt(r.in_transit)}</td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-800">{fmt(r.cash_in_hand)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && data && branchId && (
        <div className="space-y-4" data-testid="branch-cash-detail">
          {!data.opening_set && (
            <OpeningCashForm branchId={branchId} branchName={branchName} isCorrection={false} onDone={load} />
          )}

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
            <Figure label="Collected" value={fmt(data.collected_total)} testId="branch-cash-collected" />
            <Figure label="Collected (cash)" value={fmt(data.collected_cash)} testId="branch-cash-cash" />
            <Figure label="Cash spent" value={fmt(data.cash_spent)} testId="branch-cash-spent" />
            <Figure label="Handed over" value={fmt(data.handed_over)} testId="branch-cash-handed" />
            <Figure label="In transit" value={fmt(data.in_transit)} tone="amber" testId="branch-cash-transit" />
            <Figure label="Cash in hand" value={data.opening_set ? fmt(data.cash_in_hand) : "—"} tone="emerald" testId="branch-cash-hand" />
          </div>

          {pendingHandovers.length > 0 && (
            <div className="space-y-2" data-testid="branch-cash-handovers">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Handovers to receive</p>
              {pendingHandovers.map((h) => (
                <ReceiveHandoverRow key={h.id} handover={h} onReceived={load} />
              ))}
            </div>
          )}

          {data.opening_set && (
            <details className="rounded-lg border border-slate-200 bg-white p-3 text-xs" data-testid="branch-cash-correction">
              <summary className="cursor-pointer font-medium text-slate-600">Correct this branch's cash after a count</summary>
              <div className="mt-3">
                <OpeningCashForm branchId={branchId} branchName={branchName} isCorrection onDone={load} />
              </div>
            </details>
          )}

          {(data.adjustments_log || []).length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white p-3" data-testid="branch-cash-adjustments">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Adjustments</p>
              <div className="space-y-1 text-[11px]">
                {(data.adjustments_log || []).map((a) => (
                  <div key={a.id} className="flex flex-wrap items-baseline gap-2">
                    <span className="w-20 shrink-0 tabular-nums text-slate-400">{a.on}</span>
                    <span className={`font-semibold tabular-nums ${a.amount < 0 ? "text-rose-600" : "text-emerald-700"}`}>
                      {a.amount > 0 ? "+" : ""}{fmt(a.amount)}
                    </span>
                    <span className="rounded-full bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-500">{a.reason}</span>
                    <span className="min-w-0 flex-1 text-slate-500">{a.note || "—"}<span className="text-slate-400"> · {a.created_by}</span></span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.handed_over === 0 && data.in_transit === 0 && pendingHandovers.length === 0 && (
            <p className="flex items-center gap-1.5 py-4 text-xs text-slate-400">
              <Coins className="h-3.5 w-3.5" /> No handovers from this branch yet.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default BranchCashBoard;
