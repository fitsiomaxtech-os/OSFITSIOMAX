import { useCallback, useEffect, useState } from "react";
import { Building2, ChevronDown, Check, AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HeadPhysioBoard } from "@/components/HeadPhysioBoard";
import { hpResolvedConsultant } from "@/lib/api";

const ALL = "all";

/**
 * Which branch's consultations are on screen.
 *
 * Checkbox rows rather than a tick on the right, because that is how every other branch
 * picker in this OS now reads — but one answer at a time, because the board underneath
 * takes a single branch. A list where two could be ticked would promise a merged view the
 * board cannot produce: it collapses whatever it is given to the first entry.
 *
 * "All Branches" is a real answer here rather than the absence of one. A consultant covers
 * the whole organisation, so it is the normal case and sits at the top.
 */
const BranchPicker = ({ value, branches, onPick }) => {
  const [open, setOpen] = useState(false);
  const current = value === ALL ? null : branches.find((b) => b.id === value);
  const label = value === ALL ? "All Branches" : (current?.branch_name || "Select branch");

  const options = [
    { value: ALL, label: "All Branches", hint: "Every branch you consult for" },
    ...branches.map((b) => ({ value: b.id, label: b.branch_name })),
  ];

  return (
    <>
      <Button
        variant="outline"
        className="h-10 justify-between gap-2 sm:w-64"
        onClick={() => setOpen(true)}
        data-testid="my-consultation-branch-trigger"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Building2 className="h-4 w-4 shrink-0 text-slate-400" />
          <span className="truncate">{label}</span>
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
          data-testid="my-consultation-branch-modal"
        >
          <div className="flex max-h-[80vh] w-full max-w-sm flex-col overflow-hidden rounded-lg bg-white shadow-xl">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-900">Consultations for</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Close"
                data-testid="my-consultation-branch-close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto py-1">
              {options.map((o) => {
                const on = o.value === value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => { setOpen(false); onPick(o.value); }}
                    className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm transition hover:bg-slate-100 ${
                      on ? "font-bold text-slate-900" : "text-slate-600"
                    }`}
                    data-testid={`my-consultation-branch-option-${o.value}`}
                  >
                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? "border-slate-700 bg-slate-700" : "border-slate-300 bg-white"}`}>
                      {on && <Check className="h-3 w-3 text-white" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{o.label}</span>
                      {o.hint && <span className="block truncate text-[11px] font-normal text-slate-400">{o.hint}</span>}
                    </span>
                  </button>
                );
              })}
              {branches.length === 0 && (
                <p className="px-4 py-6 text-center text-xs text-slate-400">No branches yet.</p>
              )}
            </div>
            <div className="shrink-0 border-t border-slate-200 px-4 py-2.5 text-right">
              <Button variant="outline" size="sm" onClick={() => setOpen(false)} data-testid="my-consultation-branch-cancel">Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

/**
 * A Super Admin's own consultation board.
 *
 * The same board a CONSULTANT signs in to, opened from the Master View, with a branch
 * picker in front of it — a consultant covers the whole organisation, so which branch's
 * appointments are being read is the first question and there was nowhere to answer it.
 *
 * The banner is the point of the page being separate rather than a link to the CONSULTANT
 * board. A Super Admin without a consultant record of their own falls back, server-side, to
 * whichever consultant record exists — right for driving somebody else's branch, and quite
 * wrong on a page titled My Consultation, where it would show a stranger's appointments
 * under the reader's own name and say nothing about it. So the page asks whose book it is
 * and prints the answer when it is not yours.
 */
export const MyConsultationBoard = ({ user, search = "", onSearchChange, branches = [] }) => {
  const [branchId, setBranchId] = useState(ALL);
  const [resolved, setResolved] = useState(null);

  const load = useCallback(() => {
    hpResolvedConsultant()
      .then(setResolved)
      .catch(() => setResolved(null));
  }, []);
  useEffect(() => { load(); }, [load]);

  const notMine = resolved && !resolved.is_mine;

  return (
    <div className="space-y-4" data-testid="my-consultation-board">
      <div className="flex flex-wrap items-center gap-2">
        <BranchPicker value={branchId} branches={branches} onPick={setBranchId} />
      </div>

      {notMine && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2" data-testid="my-consultation-not-mine">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-xs text-amber-800">
            {resolved.consultant_name
              ? <>These are <b>{resolved.consultant_name}</b>&apos;s consultations, not yours — your account has no consultant record of its own, so the board falls back to the one that exists. Ask HR Admin to link a CONSULTANT record to this login to see your own.</>
              : <>No consultant record exists yet, so there is nothing to show. Ask HR Admin to link a CONSULTANT record to this login.</>}
          </p>
        </div>
      )}

      {/* branchId, never branchIds: the board collapses a list to its first entry, so
          handing it several would show one and imply all of them. */}
      <HeadPhysioBoard
        branchId={branchId}
        user={user}
        search={search}
        onSearchChange={onSearchChange}
      />
    </div>
  );
};

export default MyConsultationBoard;
