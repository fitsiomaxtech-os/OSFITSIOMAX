import { useState } from "react";
import { Headset, Hospital } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Lead Control — who works this branch's leads first, Pre-Sales or the Branch Admin.
 *
 * The setting lives on the branch, so the same switch appears wherever a branch is in
 * reach: the Branch Detail header, the Edit Branch dialog, and each Marketing Source
 * card (a source is tagged to a branch, and that is where leads actually arrive). All
 * three write the same field, which is why they are one component rather than three
 * lookalikes that drift apart.
 *
 * Not stamped on leads: flipping it rehomes the leads already in the pipeline as well
 * as the next import. See backend/lead_control.py for why.
 *
 * @param confirm  ask before switching. On for the two places that save on click —
 *                 moving a branch's whole book between two desks is not something to
 *                 do by brushing a control. Off inside the Edit dialog, where nothing
 *                 happens until Save Changes and a confirm would be asking about a
 *                 change that has not been made yet.
 */

export const PRE_SALES = "pre_sales";
export const BRANCH_ADMIN = "branch_admin";

const OPTIONS = [
  { value: PRE_SALES, label: "Pre Sales", icon: Headset },
  { value: BRANCH_ADMIN, label: "Branch Admin", icon: Hospital },
];

// An unset branch reads as Pre-Sales — the behaviour every branch had before this
// existed. Mirrors normalize() in backend/lead_control.py.
export const normalizeLeadControl = (v) => (v === BRANCH_ADMIN ? BRANCH_ADMIN : PRE_SALES);

export const LeadControlSwitch = ({
  value,
  onChange,
  disabled = false,
  busy = false,
  size = "md",
  testid = "lead-control",
  confirm = false,
  branchName = "",
}) => {
  const current = normalizeLeadControl(value);
  const [pending, setPending] = useState(null);
  const sm = size === "sm";

  const choose = (next) => {
    if (next === current || disabled || busy) return;
    if (confirm) { setPending(next); return; }
    onChange(next);
  };

  return (
    <>
      <div
        role="radiogroup"
        aria-label="Lead Control"
        title="Lead Control — who works this branch's leads first"
        className={`inline-flex rounded-lg bg-slate-100 p-1 ${sm ? "gap-0.5" : "gap-1"} ${disabled || busy ? "opacity-50" : ""}`}
        data-testid={testid}
      >
        {OPTIONS.map((o) => {
          const Icon = o.icon;
          const active = current === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled || busy}
              onClick={() => choose(o.value)}
              // Content-sized rather than flex-1: the control now sits in a header, a
              // dialog field and a card, and a basis-0 child inside a shrink-to-fit
              // parent is the kind of width that resolves differently in each.
              className={`inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-semibold transition ${
                sm ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-xs"
              } ${
                active
                  ? "bg-sky-600 text-white shadow-sm"
                  : "text-slate-600 hover:bg-white hover:text-slate-800"
              } ${disabled || busy ? "cursor-not-allowed" : ""}`}
              data-testid={`${testid}-${o.value}`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span>{o.label}</span>
            </button>
          );
        })}
      </div>

      {pending && (
        <LeadControlConfirm
          next={pending}
          branchName={branchName}
          onCancel={() => setPending(null)}
          onConfirm={() => { const chosen = pending; setPending(null); onChange(chosen); }}
        />
      )}
    </>
  );
};

/**
 * The confirm step. Spells out the consequence rather than asking "are you sure" — the
 * part people get wrong is that this moves the leads already in the pipeline, not just
 * the next import, and a dialog that does not say so is not worth showing.
 */
const LeadControlConfirm = ({ next, branchName, onCancel, onConfirm }) => {
  const toBranch = next === BRANCH_ADMIN;
  const who = branchName ? `${branchName}'s` : "This branch's";
  const Icon = toBranch ? Hospital : Headset;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-testid="lead-control-confirm">
      <div className="w-full max-w-md space-y-4 rounded-xl bg-white p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${toBranch ? "bg-sky-100" : "bg-emerald-100"}`}>
            <Icon className={`h-5 w-5 ${toBranch ? "text-sky-600" : "text-emerald-600"}`} />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-slate-900" data-testid="lead-control-confirm-title">
              {toBranch ? "Hand these leads to the Branch Admin?" : "Return these leads to Pre-Sales?"}
            </h3>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
              {toBranch ? (
                <>
                  {who} leads leave the Pre-Sales pipeline — <b className="text-slate-800">the ones already in it as well as new arrivals</b> — and are worked on the branch's own Pre Sales tab instead. No Pre-Sales rep is assigned to them.
                </>
              ) : (
                <>
                  {who} leads go back into the Pre-Sales pipeline, <b className="text-slate-800">including the ones the branch is working right now</b>. The branch's Pre Sales tab disappears and new leads are shared across the Pre-Sales team again.
                </>
              )}
            </p>
            <p className="mt-2 text-[11px] text-slate-400">
              Leads with no branch yet always stay with Pre-Sales. You can switch back at any time.
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onCancel} data-testid="lead-control-confirm-cancel">Cancel</Button>
          <Button
            onClick={onConfirm}
            className={toBranch ? "bg-sky-600 hover:bg-sky-700" : "bg-emerald-600 hover:bg-emerald-700"}
            data-testid="lead-control-confirm-ok"
          >
            {toBranch ? "Yes, hand over" : "Yes, return to Pre-Sales"}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default LeadControlSwitch;
