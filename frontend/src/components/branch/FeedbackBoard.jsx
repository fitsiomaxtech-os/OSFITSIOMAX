import { useCallback, useEffect, useState } from "react";
import { Bell, CheckCircle2, Clock, Inbox, RefreshCw, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatTile } from "@/components/ui/stat-tile";
import { toast } from "@/components/ui/sonner";
import { listBranchFeedback, moveBranchFeedback } from "@/lib/api";

// The three columns, left to right in the order they are worked through. A piece of
// feedback arrives New, somebody picks it up, somebody finishes with it — which is what a
// branch acts on. Kept in step with STATUSES in backend/routers/v3_feedback.py.
const COLUMNS = [
  { key: "new", label: "New", icon: Inbox, color: "#d97706", sub: "waiting to be picked up", empty: "Nothing waiting." },
  { key: "in_progress", label: "In Progress", icon: Clock, color: "#0284c7", sub: "being dealt with", empty: "Nothing being dealt with." },
  { key: "resolved", label: "Resolved", icon: CheckCircle2, color: "#059669", sub: "finished with", empty: "Nothing finished yet." },
];

// The chip a card wears, so a row read on its own says where it stands rather than relying
// on which column it was sitting in — which is the whole of what the three columns used to
// say, and is gone now the list is one list.
const STATUS_CHIP = {
  new: { label: "New", classes: "border-amber-200 bg-amber-50 text-amber-700" },
  in_progress: { label: "In Progress", classes: "border-sky-200 bg-sky-50 text-sky-700" },
  resolved: { label: "Resolved", classes: "border-emerald-200 bg-emerald-50 text-emerald-700" },
};

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
      <div className="flex shrink-0 items-center gap-1.5">
        {/* Where it stands, on the card. The three columns used to say this by holding it,
            and a single list has to say it outright. */}
        <span
          className={`whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-bold ${(STATUS_CHIP[row.status] || STATUS_CHIP.new).classes}`}
          data-testid={`feedback-status-${row.id}`}
        >
          {(STATUS_CHIP[row.status] || STATUS_CHIP.new).label}
        </span>
        <Stars rating={row.rating} />
      </div>
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
/**
 * What is being told to the patient, before the card is closed.
 *
 * Its own dialog rather than a field on the card: this is the one thing here a patient
 * reads, and typing it into a row among nine others invites the sentence that gets typed to
 * get past a form. On screen it shows what they said, so the reply is written to the words
 * it answers rather than from memory of them.
 */
const ReplyDialog = ({ row, saving, onCancel, onSend }) => {
  const [reply, setReply] = useState("");
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }} data-testid="feedback-reply-dialog">
      <div className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b p-5">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-slate-800">Close this feedback</h3>
            <p className="mt-0.5 text-[11px] text-slate-500">{row.patient_name || "A patient"} reads what you write here.</p>
          </div>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600" aria-label="Cancel" data-testid="feedback-reply-close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-5">
          {row.message ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">They said</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-slate-600">{row.message}</p>
            </div>
          ) : null}
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">What was done *</label>
            <textarea
              rows={4}
              autoFocus
              maxLength={2000}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="We spoke to the physio and moved your Friday session to the earlier slot."
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-400"
              data-testid="feedback-reply-message"
            />
            <p className="mt-1 text-right text-[10px] text-slate-400">{reply.length}/2000</p>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t p-4">
          <Button variant="outline" size="sm" onClick={onCancel} data-testid="feedback-reply-cancel">Cancel</Button>
          <Button
            size="sm"
            className="bg-emerald-600 text-white hover:bg-emerald-700"
            disabled={saving || !reply.trim()}
            onClick={() => onSend(reply.trim())}
            data-testid="feedback-reply-send"
          >
            {saving ? "Sending…" : "Send & resolve"}
          </Button>
        </div>
      </div>
    </div>
  );
};

export const FeedbackBoard = ({ branchId, onClose, onCounts }) => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [moving, setMoving] = useState(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all"); // "all" | one of COLUMNS
  const [replying, setReplying] = useState(null); // the row being closed, awaiting its words

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

  const visible = filter === "all" ? rows : rows.filter((r) => (r.status || "new") === filter);

  // Resolving is the one move that says something to the patient, so it asks for the words
  // first. The rest move straight away: making somebody type a sentence to say "I have seen
  // this" fills the field with "ok".
  const move = async (row, to, reply = "") => {
    if (to === "resolved" && !reply) { setReplying(row); return; }
    setMoving(row.id);
    try {
      await moveBranchFeedback(row.id, to, reply, "");
      setReplying(null);
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not move that");
    } finally {
      setMoving(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" data-testid="feedback-board">
      {replying && (
        <ReplyDialog
          row={replying}
          saving={moving === replying.id}
          onCancel={() => setReplying(null)}
          onSend={(reply) => move(replying, "resolved", reply)}
        />
      )}
      <div className="flex max-h-[90vh] w-full max-w-[92rem] flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
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
            <div className="space-y-4">
              {/* The three counts as tiles, the way every other board here opens: a figure
                  to read and, pressed, the rows behind it. They were column headings, which
                  meant the only way to see just the resolved ones was to look at a third of
                  the screen and ignore the rest. */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="feedback-summary">
                <StatTile
                  label="All"
                  value={rows.length}
                  sub="every piece of feedback"
                  icon={Bell}
                  color="#7c3aed"
                  active={filter === "all"}
                  onClick={() => setFilter("all")}
                  testid="feedback-card-all"
                />
                {COLUMNS.map((col) => (
                  <StatTile
                    key={col.key}
                    label={col.label}
                    value={rows.filter((r) => (r.status || "new") === col.key).length}
                    sub={col.sub}
                    icon={col.icon}
                    color={col.color}
                    active={filter === col.key}
                    onClick={() => setFilter(filter === col.key ? "all" : col.key)}
                    testid={`feedback-card-${col.key}`}
                  />
                ))}
              </div>

              {/* Underneath, the feedback itself, four across on a wide screen and stepping
                  down with the width rather than at one breakpoint — at 1024px four
                  columns of a paragraph are four columns of two words. */}
              {visible.length === 0 ? (
                <p className="py-12 text-center text-sm text-slate-400" data-testid="feedback-none-here">
                  {(COLUMNS.find((c) => c.key === filter) || {}).empty || "Nothing here."}
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" data-testid="feedback-list">
                  {visible.map((r) => <FeedbackCard key={r.id} row={r} onMove={move} moving={moving === r.id} />)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FeedbackBoard;
