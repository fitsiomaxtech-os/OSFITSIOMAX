import { PhoneCall, Building2 } from "lucide-react";

/**
 * Lead Control — who works this branch's leads first, Pre-Sales or the Branch Admin.
 *
 * The setting lives on the branch, so the same switch appears wherever a branch is in
 * reach: Branch Management > Branch Details, and each Marketing Source card (a source
 * is tagged to a branch, and that is where leads actually arrive). Both write the same
 * field, which is why they are one component rather than two lookalikes.
 *
 * Not stamped on leads: flipping it rehomes the leads already in the pipeline as well
 * as the next import. See backend/lead_control.py for why.
 */

export const PRE_SALES = "pre_sales";
export const BRANCH_ADMIN = "branch_admin";

const OPTIONS = [
  { value: PRE_SALES, label: "Pre Sales", icon: PhoneCall },
  { value: BRANCH_ADMIN, label: "Branch Admin", icon: Building2 },
];

// An unset branch reads as Pre-Sales — the behaviour every branch had before this
// existed. Mirrors normalize() in backend/lead_control.py.
export const normalizeLeadControl = (v) => (v === BRANCH_ADMIN ? BRANCH_ADMIN : PRE_SALES);

export const leadControlLabel = (v) => (normalizeLeadControl(v) === BRANCH_ADMIN ? "Branch Admin" : "Pre Sales");

export const LeadControlSwitch = ({
  value,
  onChange,
  disabled = false,
  busy = false,
  size = "md",
  testid = "lead-control",
}) => {
  const current = normalizeLeadControl(value);
  const sm = size === "sm";
  return (
    <div
      role="radiogroup"
      aria-label="Lead Control"
      className={`inline-flex w-full rounded-lg bg-slate-100 p-1 ${sm ? "gap-0.5" : "gap-1"} ${disabled || busy ? "opacity-50" : ""}`}
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
            onClick={() => { if (!active && !disabled && !busy) onChange(o.value); }}
            className={`inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md font-semibold transition ${
              sm ? "px-2 py-1 text-[10px]" : "px-3 py-1.5 text-xs"
            } ${
              active
                ? "bg-sky-600 text-white shadow-sm"
                : "text-slate-600 hover:bg-white hover:text-slate-800"
            } ${disabled || busy ? "cursor-not-allowed" : ""}`}
            data-testid={`${testid}-${o.value}`}
          >
            <Icon className={`shrink-0 ${sm ? "h-3 w-3" : "h-3.5 w-3.5"}`} />
            <span className="truncate">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
};

export default LeadControlSwitch;
