import { useMemo, useState } from "react";
import { Building2, ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * BranchFilterPopover
 *
 * The branch picker Operations used to spell out as a full row of pills, folded into a
 * single trigger + dialog so the row it lived on is free for the actions that belong
 * beside it (Branch Transfer, Branch Manager).
 *
 * Wears the same clothes as DateFilterPopover's `centered` variant — milk-white panel
 * (#FDFCF8 on #EFEAE0), amber for the active state — because to the person using it this
 * is the same kind of control as the date filter sitting elsewhere on the OS, and two
 * filters that behave alike should not look like they came from different products.
 *
 * Props:
 *  - branches: [{ id, branch_name, vertical }]
 *  - selectedId / onSelect: controlled selection
 *  - testid: string (optional)
 */

// Same helper OperationsBoard.jsx, BranchManagementBoard.jsx and PreSalesCRM.jsx each
// already carry their own copy of.
const isOnlineVertical = (v) => String(v || "").startsWith("online_");

export const BranchFilterPopover = ({ branches = [], selectedId, onSelect, testid = "branch-filter" }) => {
  const [open, setOpen] = useState(false);

  // Offline branches first (alphabetical), online ones trail — the order the pill row
  // used and the order Branch Wise already sorts in, so a branch sits where it always has.
  const sorted = useMemo(() => {
    return [...(branches || [])].sort((a, b) => {
      const onlineDiff = Number(isOnlineVertical(a.vertical)) - Number(isOnlineVertical(b.vertical));
      if (onlineDiff !== 0) return onlineDiff;
      return (a.branch_name || "").localeCompare(b.branch_name || "");
    });
  }, [branches]);

  const offline = sorted.filter((b) => !isOnlineVertical(b.vertical));
  const online = sorted.filter((b) => isOnlineVertical(b.vertical));

  const selected = sorted.find((b) => b.id === selectedId);
  const activeLabel = selected?.branch_name || "Branch Filter";

  // Picking is the whole job here — there is nothing else in the dialog to fill in, so a
  // separate Apply would only be a second click on a decision already made.
  const pick = (id) => {
    if (id) onSelect(id);
    setOpen(false);
  };

  return (
    <div className="inline-flex items-center">
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        title={activeLabel}
        aria-label={`Branch filter: ${activeLabel}`}
        className={`h-9 gap-2 px-3 ${selected ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100" : ""}`}
        data-testid={`${testid}-btn`}
      >
        <Building2 className="h-4 w-4" />
        <span className="max-w-[180px] truncate">{activeLabel}</span>
        <ChevronDown className="h-4 w-4 opacity-70" />
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-3 backdrop-blur-sm sm:p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
          data-testid={`${testid}-modal`}
        >
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-[#EFEAE0] bg-[#FDFCF8] shadow-2xl" data-testid={`${testid}-panel`}>
            <div className="flex items-center justify-between border-b border-[#EFEAE0] px-4 py-3">
              <p className="text-sm font-bold text-slate-800">Filter by Branch</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full p-1.5 text-slate-400 hover:bg-[#F3EFE6] hover:text-slate-600"
                title="Close"
                aria-label="Close"
                data-testid={`${testid}-exit`}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 p-4">
              <label className="block text-xs font-medium text-slate-500" htmlFor={`${testid}-select`}>Branch</label>
              {/* Grouped rather than one flat list: an online vertical is not a place you
                  can walk into, and reading the two apart matters more the longer the
                  list gets. */}
              <div className="relative">
                <select
                  id={`${testid}-select`}
                  value={selectedId || ""}
                  onChange={(e) => pick(e.target.value)}
                  className="h-10 w-full appearance-none rounded-md border border-[#EFEAE0] bg-white px-3 pr-9 text-sm text-slate-700 outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
                  data-testid={`${testid}-select`}
                >
                  <option value="">— Select a branch —</option>
                  {offline.length > 0 && (
                    <optgroup label="Branches">
                      {offline.map((b) => <option key={b.id} value={b.id}>{b.branch_name}</option>)}
                    </optgroup>
                  )}
                  {online.length > 0 && (
                    <optgroup label="Online">
                      {online.map((b) => <option key={b.id} value={b.id}>{b.branch_name}</option>)}
                    </optgroup>
                  )}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              </div>
              <p className="text-[11px] text-slate-400" data-testid={`${testid}-hint`}>
                {sorted.length === 0 ? "No branches yet." : "The board below follows whichever branch is picked here."}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BranchFilterPopover;
