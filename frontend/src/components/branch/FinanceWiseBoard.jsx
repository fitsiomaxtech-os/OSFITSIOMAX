import { useState } from "react";
import { Building2, Layers } from "lucide-react";
import { FinanceBoard } from "@/components/FinanceBoard";

// Every default vertical is named "online_.../offline_..." — same helper as
// Branch Wise's own sort.
const isOnlineVertical = (v) => String(v || "").startsWith("online_");

const ALL_KEY = "all";

/**
 * Finance, browsed per branch — same pill-picker shape as Branch Wise, with one
 * addition: an "All Branches" pill first, Finance's own aggregate view (every branch
 * summed, with its own Revenue-by-Branch breakdown) rather than any one branch's book.
 * FinanceBoard already carries its own date-range and fee-type filters, so this wrapper
 * is only the branch switch around it.
 */
export const FinanceWiseBoard = ({ branches }) => {
  const sortedBranches = [...(branches || [])].sort((a, b) => {
    const onlineDiff = Number(isOnlineVertical(a.vertical)) - Number(isOnlineVertical(b.vertical));
    if (onlineDiff !== 0) return onlineDiff;
    return (a.branch_name || "").localeCompare(b.branch_name || "");
  });
  const [selectedId, setSelectedId] = useState(ALL_KEY);

  return (
    <div className="space-y-4" data-testid="finance-wise-board-root">
      {/* A dropdown on a phone, the pill row from sm up — same split Branch Wise uses. */}
      <select
        value={selectedId}
        onChange={(e) => setSelectedId(e.target.value)}
        className="h-10 w-full rounded-md border border-slate-200 bg-white px-2 text-sm font-semibold text-slate-700 sm:hidden"
        data-testid="finance-wise-subtab-select"
      >
        <option value={ALL_KEY}>All Branches</option>
        {sortedBranches.map((b) => <option key={b.id} value={b.id}>{b.branch_name}</option>)}
      </select>

      <div className="hidden flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-2 sm:flex" data-testid="finance-wise-subtabs">
        <button
          type="button"
          onClick={() => setSelectedId(ALL_KEY)}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
            selectedId === ALL_KEY ? "bg-sky-600 text-white shadow-sm" : "bg-slate-50 text-slate-600 hover:bg-slate-100"
          }`}
          data-testid="finance-wise-subtab-all"
        >
          <Layers className="h-3.5 w-3.5" /> All Branches
        </button>
        {sortedBranches.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => setSelectedId(b.id)}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
              selectedId === b.id ? "bg-sky-600 text-white shadow-sm" : "bg-slate-50 text-slate-600 hover:bg-slate-100"
            }`}
            data-testid={`finance-wise-subtab-${b.id}`}
          >
            <Building2 className="h-3.5 w-3.5" /> {b.branch_name}
          </button>
        ))}
      </div>

      {/* Keyed on the selection so switching remounts the board — its own filters
          (fee type, search, date range) belong to one branch's book and must not
          survive the switch to another. */}
      <FinanceBoard key={selectedId} branchId={selectedId === ALL_KEY ? undefined : selectedId} />
    </div>
  );
};
