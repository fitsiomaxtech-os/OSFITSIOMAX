import { useCallback, useEffect, useState } from "react";
import { Bell, RefreshCw, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { listBranchFeedback, moveBranchFeedback } from "@/lib/api";

// The three columns, left to right in the order they are worked through. A piece of
// feedback arrives New, somebody picks it up, somebody finishes with it — which is what a
// branch acts on. Kept in step with STATUSES in backend/routers/v3_feedback.py.
const COLUMNS = [
  { key: "new", label: "New", tint: "border-amber-200 bg-amber-50", dot: "bg-amber-500", empty: "Nothing waiting." },
  { key: "in_progress", label: "In Progress", tint: "border-sky-200 bg-sky-50", dot: "bg-sky-500", empty: "Nothing being dealt with." },
  { key: "resolved", label: "Resolved", tint: "border-emerald-200 bg-emerald-50", dot: "bg-emerald-500", empty: "Nothing finished yet." },
];

// Where a card can go from where it is. Both directions, because picking something up by
// mistake is ordinary and a board you cannot walk backwards on gets worked around.
const MOVES = {
  new: [{ to: "in_progress", label: "Pick up" }],
  in_progress: [{ to: "resolved", label: "Resolve" }, { to: "new", label: "Put back" }],
  resolved: [{ to: "in_progress", label: "Reopen" }],
};

const shortDateTime = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

/** The rating as stars, or nothing at all.
 *
 *  Absent rather than zero stars when none was left: a patient who wrote a paragraph and
 *  skipped the rating has not given the place one star, and drawing five empty ones says
 *  they did.
 */
const Stars = ({ rating }) => {
  if (!rating) return null;
  return (
    <span className="inline-flex items-center gap-0.5" title={`${rating} out of 5`} aria-label={`${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`h-3 w-3 ${n <= rating ? "fill-amber-400 text-amber-400" : "text-slate-200"}`}
          aria-hidden="true"
        />
      ))}
    </span>
  );
};

const FeedbackCard = ({ row, onMove, moving }) => (
  <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm" data-testid={`feedback-card-${row.id}`}>
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-800" title={row.patient_name}>{row.patient_name || "A patient"}</p>
        {row.patient_phone ? <p className="truncate text-[11px] text-slate-400">{row.patient_phone}</p> : null}
      </div>
      <Stars rating={row.rating} />
    </div>

    {/* Their words, whole. A feedback card that truncates is one somebody has to open to
        read, and there is nothing behind this card to open. */}
    {row.message ? (
      <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-slate-600">{row.message}</p>
    ) : (
      <p className="mt-2 text-xs italic text-slate-400">Rating only — nothing written.</p>
    )}

    <p className="mt-2 text-[10px] text-slate-400">{shortDateTime(row.created_at)}</p>

    {/* Who moved it last, so the column is not the only record of what happened. */}
    {row.handled_by && row.status !== "new" ? (
      <p className="mt-0.5 text-[10px] text-slate-400">{row.handled_by} · {shortDateTime(row.handled_at)}</p>
    ) : null}

    <div className="mt-2 flex flex-wrap gap-1.5">
      {(MOVES[row.status] || []).map((m) => (
        <Button
          key={m.to}
          size="sm"
          variant="outline"
          className="h-7 px-2 text-[11px]"
          disabled={moving}
          onClick={() => onMove(row, m.to)}
          data-testid={`feedback-move-${row.id}-${m.to}`}
        >
          {m.label}
        </Button>
      ))}
    </div>
  </div>
);

/**
 * What patients have said about a branch, as a board.
 *
 * Three columns rather than a table because the question is what has been done about each
 * one, and a status column in a list is a thing to sort by rather than a thing to work
 * through. The cards carry the whole message: there is no record behind them to open, so
 * anything hidden here is hidden entirely.
 *
 * Moved by buttons rather than by dragging. A drag needs a mouse and a steady hand, and a
 * branch reading this on a tablet at the desk has neither.
 */
export const FeedbackBoard = ({ branchId, onClose, onCounts }) => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [moving, setMoving] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listBranchFeedback(branchId);
      setRows(data.feedback || []);
      setError("");
      onCounts?.(data);
    } catch (e) {
      // Said rather than swallowed: an empty board and a board that failed to load look
      // identical, and only one of them means there is nothing to do.
      setError(e?.response?.data?.detail || "Could not load feedback.");
    } finally {
      setLoading(false);
    }
  }, [branchId, onCounts]);

  useEffect(() => { load(); }, [load]);

  const move = async (row, to) => {
    setMoving(row.id);
    try {
      await moveBranchFeedback(row.id, to, "");
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not move that");
    } finally {
      setMoving(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" data-testid="feedback-board">
      <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b bg-slate-50/60 px-5 py-4">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-amber-500" />
            <h3 className="text-base font-semibold text-slate-800">Patient Feedback</h3>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={loading} data-testid="feedback-refresh">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </Button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
              aria-label="Close"
              data-testid="feedback-close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {error ? (
            <div className="space-y-2 py-12 text-center text-sm">
              <p className="font-medium text-rose-600" data-testid="feedback-error">{error}</p>
              <Button size="sm" variant="outline" onClick={load}>Try again</Button>
            </div>
          ) : loading ? (
            <p className="py-12 text-center text-sm text-slate-400">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="py-12 text-center text-sm text-slate-400" data-testid="feedback-empty">
              No feedback yet. It arrives here when a patient leaves some in their portal.
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              {COLUMNS.map((col) => {
                const cards = rows.filter((r) => (r.status || "new") === col.key);
                return (
                  <div key={col.key} className={`rounded-xl border p-3 ${col.tint}`} data-testid={`feedback-column-${col.key}`}>
                    <div className="mb-3 flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${col.dot}`} aria-hidden="true" />
                      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-600">{col.label}</p>
                      <span className="rounded bg-white/70 px-1.5 py-px text-[10px] font-bold text-slate-500">{cards.length}</span>
                    </div>
                    <div className="space-y-2">
                      {cards.length === 0
                        ? <p className="py-6 text-center text-[11px] text-slate-400">{col.empty}</p>
                        : cards.map((r) => <FeedbackCard key={r.id} row={r} onMove={move} moving={moving === r.id} />)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FeedbackBoard;
