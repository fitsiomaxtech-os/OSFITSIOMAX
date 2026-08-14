import { useState } from "react";
import { Building2 } from "lucide-react";
import { BranchAdminBoard } from "@/components/BranchAdminBoard";

// Lets Super Admin browse every branch's own Branch Admin board (Branch Leads,
// Consultations, Accountant Manage, Calendar, Treatment Sessions, Rehab, Store —
// all of BranchAdminBoard's own tabs come along for free) without switching login.
export const BranchWiseBoard = ({ branches }) => {
  const sortedBranches = [...(branches || [])].sort((a, b) =>
    (a.branch_name || "").localeCompare(b.branch_name || "")
  );
  const [selectedId, setSelectedId] = useState(sortedBranches[0]?.id || "");
  const activeId = sortedBranches.some((b) => b.id === selectedId) ? selectedId : sortedBranches[0]?.id || "";

  if (!sortedBranches.length) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500" data-testid="branch-wise-empty">
        No branches found yet.
      </div>
    );
  }

  /**
   * The phone's branch picker, handed to BranchAdminBoard so it lands in that board's own
   * toolbar beside Search and the rest, rather than sitting in a bar of its own above the
   * stage chips. Hidden from sm up, where the tab row below takes over.
   */
  const picker = (
    <select
      value={activeId}
      onChange={(e) => setSelectedId(e.target.value)}
      className="h-10 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 text-sm font-semibold text-slate-700 sm:hidden"
      data-testid="branch-wise-subtab-select"
    >
      {sortedBranches.map((b) => <option key={b.id} value={b.id}>{b.branch_name}</option>)}
    </select>
  );

  return (
    <div className="space-y-4" data-testid="branch-wise-board-root">
      <div className="hidden flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-2 sm:flex" data-testid="branch-wise-subtabs">
        {sortedBranches.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => setSelectedId(b.id)}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
              activeId === b.id ? "bg-sky-600 text-white shadow-sm" : "bg-slate-50 text-slate-600 hover:bg-slate-100"
            }`}
            data-testid={`branch-wise-subtab-${b.id}`}
          >
            <Building2 className="h-3.5 w-3.5" /> {b.branch_name}
          </button>
        ))}
      </div>

      {/* Keyed on the branch so switching remounts the board — its stage counts, leads and
          filters all belong to one branch and must not survive the change. */}
      {activeId && <BranchAdminBoard key={activeId} branchId={activeId} embedded branchPicker={picker} />}
    </div>
  );
};
