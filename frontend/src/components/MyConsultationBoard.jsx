import { useCallback, useEffect, useState } from "react";
import { ArrowLeftRight, Building2, ChevronDown, Check, AlertTriangle, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HeadPhysioBoard } from "@/components/HeadPhysioBoard";
import { ConsultationReassignModal } from "@/components/ConsultationReassignModal";
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
 * This page used to be about somebody else. A Super Admin is hired as a Super Admin, so
 * HR never minted them a consultant record, and with nothing to match on the board fell
 * back to whichever record existed and listed the whole branch's consultations under a
 * title that says "My". Three different owners on one page: a banner naming a consultant
 * picked at random, a table showing every consultant's patients, and a Review queue that
 * could only ever be empty.
 *
 * Both halves are fixed at the source rather than papered over here. The record is created
 * on mount (ensure_super_admin_consultant), so the reader always has one; and the board is
 * asked for `mine`, so what it lists is the consultations booked to them. The page is now
 * true to its name, and empty until they take one — which is the honest answer, not a bug.
 *
 * The banner stays for the one case still possible: a CONSULTANT hired without a record.
 * A Super Admin can no longer reach it.
 */
export const MyConsultationBoard = ({ user, search = "", onSearchChange, branches = [] }) => {
  const [branchId, setBranchId] = useState(ALL);
  const [resolved, setResolved] = useState(null);
  const [assigning, setAssigning] = useState(false);
  // Bumped after patients are moved so the board underneath reads the new owners. The board
  // fetches on mount, and a remount is the one refresh it already answers to from outside.
  const [boardKey, setBoardKey] = useState(0);

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

        {/* The way patients get onto this page: pick them at a branch and take them, or
            hand them to a consultant of your choosing. Beside the branch picker because it
            answers the same first question — which branch. */}
        {resolved?.is_super_admin && (
          <Button
            className="h-10 gap-2 bg-sky-600 text-white hover:bg-sky-700"
            onClick={() => setAssigning(true)}
            data-testid="my-consultation-assign-btn"
          >
            <ArrowLeftRight className="h-4 w-4" /> Assign Consultations
          </Button>
        )}

        {/* Whose book this is, said once at the top. The page is named after the reader
            and lists only their patients now, so the name is confirmation rather than a
            warning — and the tag beside it is the same one their rows wear downstream,
            so the reader recognises their own work on a Branch Admin's screen too. */}
        {resolved?.is_mine && resolved.consultant_name && (
          <div
            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"
            data-testid="my-consultation-whoami"
          >
            <UserRound className="h-4 w-4 shrink-0 text-slate-400" />
            <span className="text-xs font-semibold text-slate-700">{resolved.consultant_name}</span>
            {resolved.is_super_admin && (
              <span className="rounded-[4px] border border-slate-300 bg-slate-100 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-slate-600">
                Super Admin
              </span>
            )}
          </div>
        )}
      </div>

      {notMine && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2" data-testid="my-consultation-not-mine">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-xs text-amber-800">
            No consultant record is linked to this login, so there is nothing to show. Ask HR Admin to link a CONSULTANT record to it.
          </p>
        </div>
      )}

      {/* branchId, never branchIds: the board collapses a list to its first entry, so
          handing it several would show one and imply all of them. */}
      <HeadPhysioBoard
        key={boardKey}
        branchId={branchId}
        user={user}
        // The whole difference between this page and Operations > Consultant. Without it
        // the board is branch-scoped, which is a supervisor's question, not this one's.
        mine
        search={search}
        onSearchChange={onSearchChange}
      />

      {assigning && (
        <ConsultationReassignModal
          branches={branches}
          defaultBranchId={branchId}
          onClose={() => setAssigning(false)}
          onDone={() => setBoardKey((k) => k + 1)}
        />
      )}
    </div>
  );
};

export default MyConsultationBoard;
