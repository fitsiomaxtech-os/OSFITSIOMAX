import { useCallback, useEffect, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Coins, Plus, Wallet, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatTile } from "@/components/ui/stat-tile";
import { toast } from "@/components/ui/sonner";
import { MilkDateInput } from "@/components/ui/milk-calendar";
import { getPettyCash, topUpPettyCash } from "@/lib/api";

const fmt = (n) => `Rs.${(Number(n) || 0).toLocaleString("en-IN")}`;
const toIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayIso = () => toIso(new Date());

/** A top-up put notes in; an expense took them out. Said in a chip rather than left to be
 *  read off the sign of a number, which is one character wide. */
const KindChip = ({ topUp }) => (
  <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${
    topUp ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"
  }`}>
    {topUp ? <ArrowDownLeft className="h-2.5 w-2.5" /> : <ArrowUpRight className="h-2.5 w-2.5" />}
    {topUp ? "Top-up" : "Spent"}
  </span>
);

/**
 * Accountant > Expense > Petty Cash — the tin's own book, beside the expense list it
 * mostly consists of.
 *
 * The two are the same money seen from different ends. A small cash expense at a branch
 * draws the tin down as it is logged (see create_expense), so nearly every line here has
 * an expense on the Expenses tab behind it; what it adds is the other direction — the
 * top-ups, which are not expenses at all — and the balance those two leave behind. That
 * balance is the one figure the expense list cannot show, because it is not a sum of any
 * window: it is what is physically in the tin right now.
 *
 * Scope comes down from the page above rather than being asked for again here: the window
 * and the branch are the same question for both tabs, and a second date row inside this
 * one would be a filter that disagrees with the one above it.
 */
export const PettyCashPanel = ({ branchId = "", mode = "all", startDate = "", endDate = "", canTopUp = true }) => {
  const [data, setData] = useState({ balance: 0, topped_up: 0, spent: 0, movements: [], limit: 0 });
  const [loading, setLoading] = useState(false);
  const [showTopUp, setShowTopUp] = useState(false);
  const [form, setForm] = useState({ amount: "", on: todayIso(), note: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (branchId) params.branch_id = branchId;
      if (mode && mode !== "all") params.mode = mode;
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;
      setData(await getPettyCash(params));
    } catch { /* silent */ }
    setLoading(false);
  }, [branchId, mode, startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  const closeTopUp = () => {
    setShowTopUp(false);
    setForm({ amount: "", on: todayIso(), note: "" });
  };

  const submit = async () => {
    if (!(Number(form.amount) > 0)) { toast.error("Enter an amount"); return; }
    setSaving(true);
    try {
      await topUpPettyCash({ ...form, amount: Number(form.amount), branch_id: branchId || undefined });
      toast.success("Petty cash topped up");
      closeTopUp();
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not top up"); }
    setSaving(false);
  };

  const rows = data.movements || [];
  // A tin belongs to a desk, so there is nothing to put notes into until one is picked.
  // The button stays visible and says why rather than disappearing, which would read as
  // though topping up were something this screen cannot do at all.
  const topUpBlocked = !branchId;

  return (
    <div className="space-y-4" data-testid="finance-petty-cash-root">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          What each branch keeps in its tin, and every note in or out of it. A cash expense
          of {fmt(data.limit)} or less draws it down as it is logged.
        </p>
        {canTopUp && (
          <Button
            onClick={() => (topUpBlocked ? toast.message("Pick a branch above — a tin belongs to one desk") : setShowTopUp(true))}
            className="bg-sky-600 hover:bg-sky-700"
            data-testid="finance-petty-cash-topup-btn"
          >
            <Plus className="mr-1 h-4 w-4" />Top Up
          </Button>
        )}
      </div>

      {/* The balance is every movement ever, not this window's: it is what is in the tin
          right now, and a window cannot change that. The two beside it are the window. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="finance-petty-cash-tiles">
        <StatTile
          label={branchId ? "In the tin now" : "In the tins now"}
          value={fmt(data.balance)}
          sub={branchId ? "Every movement ever, not this window" : "Every branch's tin, added up"}
          icon={Wallet}
          color="#0284c7"
          testid="finance-petty-cash-balance"
        />
        <StatTile
          label="Topped up"
          value={fmt(data.topped_up)}
          sub="Notes put in, this window"
          icon={ArrowDownLeft}
          color="#059669"
          testid="finance-petty-cash-topped-up"
        />
        <StatTile
          label="Spent"
          value={fmt(data.spent)}
          sub="Notes taken out, this window"
          icon={ArrowUpRight}
          color="#e11d48"
          testid="finance-petty-cash-spent"
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white" data-testid="finance-petty-cash-list">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/80 px-4 py-2.5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            {rows.length} {rows.length === 1 ? "movement" : "movements"}
          </p>
          <p className="text-sm font-bold tabular-nums text-slate-700">
            {fmt(data.topped_up - data.spent)} <span className="text-[11px] font-medium text-slate-400">net</span>
          </p>
        </div>

        {loading ? (
          <p className="px-4 py-10 text-center text-sm text-slate-400">Loading...</p>
        ) : rows.length === 0 ? (
          <div className="px-4 py-12 text-center" data-testid="finance-petty-cash-empty">
            <Coins className="mx-auto mb-2 h-8 w-8 text-slate-200" />
            <p className="text-xs text-slate-400">Nothing moved through the tin in this window.</p>
          </div>
        ) : (
          <>
            {/* Same table the Expenses tab uses, in the same columns as far as they line
                up — these are two views of one pile of cash, and reading them differently
                would make them look like two different books. */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[44rem] table-fixed text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="w-[30%] px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">What for</th>
                    <th className="w-[18%] px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">Branch</th>
                    <th className="w-[13%] px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">Date</th>
                    <th className="w-[13%] px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">Kind</th>
                    <th className="w-[14%] px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">By</th>
                    <th className="w-[12%] px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-slate-400">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {rows.map((r) => {
                    const topUp = (r.delta || 0) > 0;
                    return (
                      <tr key={r.id} className="transition hover:bg-slate-50/70" data-testid={`finance-petty-cash-row-${r.id}`}>
                        <td className="px-4 py-3 align-top font-medium text-slate-800">
                          {/* The sentence the branch typed, which for a spend is the whole
                              of what the expense was approved on. */}
                          {r.note || (topUp ? "Topped up" : "Petty cash spend")}
                        </td>
                        <td className="px-3 py-3 align-top text-slate-600">{r.branch_name || "—"}</td>
                        <td className="px-3 py-3 align-top tabular-nums text-slate-600">{r.on || "—"}</td>
                        <td className="px-3 py-3 align-top"><KindChip topUp={topUp} /></td>
                        <td className="px-3 py-3 align-top text-slate-500">{r.created_by || "—"}</td>
                        <td className={`px-4 py-3 text-right align-top font-bold tabular-nums ${topUp ? "text-emerald-600" : "text-rose-600"}`}>
                          {topUp ? "+" : "−"}{fmt(r.amount)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-slate-50 md:hidden">
              {rows.map((r) => {
                const topUp = (r.delta || 0) > 0;
                return (
                  <div key={r.id} className="px-4 py-3" data-testid={`finance-petty-cash-card-${r.id}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-800">
                          {r.note || (topUp ? "Topped up" : "Petty cash spend")}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-slate-500">
                          {[r.branch_name, r.on, r.created_by].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      <span className={`shrink-0 text-sm font-bold tabular-nums ${topUp ? "text-emerald-600" : "text-rose-600"}`}>
                        {topUp ? "+" : "−"}{fmt(r.amount)}
                      </span>
                    </div>
                    <div className="mt-2"><KindChip topUp={topUp} /></div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {showTopUp && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" data-testid="finance-petty-cash-topup-dialog">
          <div className="w-full max-w-sm rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <h3 className="text-base font-semibold">Top Up Petty Cash</h3>
              <button onClick={closeTopUp} className="text-slate-400 hover:text-slate-600" data-testid="finance-petty-cash-topup-close"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3 p-5">
              {/* Not an expense and never counted as one: nothing has been spent, the
                  branch holds the same cash it did a moment ago — it has just moved from
                  the drawer into the tin. */}
              <p className="rounded-md border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-[11px] text-sky-800">
                Moves notes from the drawer into the tin. Not an expense — nothing has been spent.
              </p>
              <Input
                type="number"
                min="0"
                placeholder="Amount"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                data-testid="finance-petty-cash-topup-amount"
              />
              <MilkDateInput
                value={form.on}
                onChange={(e) => setForm({ ...form, on: e.target.value })}
                data-testid="finance-petty-cash-topup-date"
              />
              <Input
                placeholder="Note (optional) — where the notes came from"
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                data-testid="finance-petty-cash-topup-note"
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <Button variant="outline" onClick={closeTopUp} data-testid="finance-petty-cash-topup-cancel">Cancel</Button>
              <Button onClick={submit} disabled={saving} className="bg-sky-600 hover:bg-sky-700" data-testid="finance-petty-cash-topup-submit">
                {saving ? "Saving..." : "Top Up"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PettyCashPanel;
