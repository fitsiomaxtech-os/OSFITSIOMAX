import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Bell, Building2, CheckCircle2, Clock, Inbox, MessageCircle, RefreshCw, Send, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatTile } from "@/components/ui/stat-tile";
import { toast } from "@/components/ui/sonner";
import { listBranchFeedback, moveBranchFeedback, replyBranchFeedback } from "@/lib/api";

// The three columns, left to right in the order they are worked through. A piece of
// feedback arrives New, somebody picks it up, somebody finishes with it — which is what a
// branch acts on. Kept in step with STATUSES in backend/routers/v3_feedback.py.
const COLUMNS = [
  { key: "new", label: "New", icon: Inbox, color: "#d97706", sub: "waiting to be picked up", empty: "Nothing waiting." },
  { key: "in_progress", label: "In Progress", icon: Clock, color: "#0284c7", sub: "being dealt with", empty: "Nothing being dealt with." },
  { key: "awaiting_patient", label: "Asked", icon: MessageCircle, color: "#7c3aed", sub: "waiting on the patient", empty: "Nobody has been asked." },
  { key: "resolved", label: "Resolved", icon: CheckCircle2, color: "#059669", sub: "finished with", empty: "Nothing finished yet." },
];

// The chip a card wears, so a row read on its own says where it stands rather than relying
// on which column it was sitting in — which is the whole of what the three columns used to
// say, and is gone now the list is one list.
const STATUS_CHIP = {
  new: { label: "New", classes: "border-amber-200 bg-amber-50 text-amber-700" },
  in_progress: { label: "In Progress", classes: "border-sky-200 bg-sky-50 text-sky-700" },
  awaiting_patient: { label: "Asked", classes: "border-violet-200 bg-violet-50 text-violet-700" },
  resolved: { label: "Resolved", classes: "border-emerald-200 bg-emerald-50 text-emerald-700" },
};

// Where a card can go from where it is. Both directions, because picking something up by
// mistake is ordinary and a board you cannot walk backwards on gets worked around.
// Where a card can go from where it is. Both directions, because picking something up by
// mistake is ordinary and a board you cannot walk backwards on gets worked around.
//
// Resolve is not among them any more. Closing a complaint is not this side's to do: the
// branch says what it did and asks whether that settled it, and the patient's answer is
// what moves it. The button that asks lives on the composer, because asking is a message.
const MOVES = {
  new: [{ to: "in_progress", label: "Pick up" }],
  in_progress: [{ to: "new", label: "Put back" }],
  awaiting_patient: [{ to: "in_progress", label: "Still working on it" }],
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

const FeedbackCard = ({ row, onMove, onSend, moving, sending }) => {
  const [draft, setDraft] = useState("");
  const thread = row.messages || [];
  const chip = STATUS_CHIP[row.status] || STATUS_CHIP.new;

  const send = (askResolved) => {
    const body = draft.trim();
    if (!body) { toast.error("Write something to send"); return; }
    onSend(row, body, askResolved, () => setDraft(""));
  };

  return (
    <div
      className={`flex flex-col rounded-lg border bg-white shadow-sm ${row.awaiting_staff ? "border-amber-300" : "border-slate-200"}`}
      data-testid={`feedback-card-${row.id}`}
    >
      <div className="flex items-start justify-between gap-2 border-b border-slate-100 p-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-800" title={row.patient_name}>{row.patient_name || "A patient"}</p>
          {row.patient_phone ? <p className="truncate text-[11px] text-slate-400">{row.patient_phone}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {/* Says the thread has been written into since anyone here last answered. The
              status cannot say this: it is still In Progress either way, and without it a
              patient's reply arrived in a column somebody had already worked through. */}
          {row.awaiting_staff && (
            <span className="whitespace-nowrap rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700" data-testid={`feedback-awaiting-${row.id}`}>
              Your turn
            </span>
          )}
          <span
            className={`whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-bold ${chip.classes}`}
            data-testid={`feedback-status-${row.id}`}
          >
            {chip.label}
          </span>
          <Stars rating={row.rating} />
        </div>
      </div>

      {/* The exchange, oldest first, each side on its own. A branch answering has to see
          what it is answering, and the one message and one reply this used to hold meant a
          patient whose answer raised another question opened a second piece of feedback
          about the same thing. */}
      <div className="max-h-72 space-y-2 overflow-y-auto p-3" data-testid={`feedback-thread-${row.id}`}>
        {thread.length === 0 ? (
          <p className="text-xs italic text-slate-400">Rating only — nothing written.</p>
        ) : thread.map((m) => {
          const mine = m.author === "staff";
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-lg px-2.5 py-1.5 ${mine ? "bg-sky-50 text-sky-900" : "bg-slate-100 text-slate-700"}`}>
                <p className="whitespace-pre-wrap break-words text-xs leading-5">{m.body}</p>
                <p className={`mt-0.5 text-[10px] ${mine ? "text-sky-500" : "text-slate-400"}`}>
                  {[mine ? (m.author_name || "Branch") : (row.patient_name || "Patient"), shortDateTime(m.created_at)].filter(Boolean).join(" · ")}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {row.status === "resolved" ? (
        <p className="border-t border-slate-100 px-3 py-2 text-[11px] text-emerald-600" data-testid={`feedback-closed-${row.id}`}>
          The patient said this was settled.
        </p>
      ) : (
        <div className="border-t border-slate-100 p-3">
          <textarea
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Write back to the patient…"
            className="w-full resize-none rounded-lg border border-slate-200 px-2.5 py-2 text-xs focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-400"
            data-testid={`feedback-compose-${row.id}`}
          />
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              className="h-7 bg-sky-600 px-2 text-[11px] text-white hover:bg-sky-700"
              disabled={sending}
              onClick={() => send(false)}
              data-testid={`feedback-send-${row.id}`}
            >
              <Send className="mr-1 h-3 w-3" /> Send
            </Button>
            {/* Closing one is asking a question, so it is a way of sending rather than a
                column to drag to. The patient's answer is what moves it. */}
            <Button
              size="sm"
              variant="outline"
              className="h-7 border-emerald-200 px-2 text-[11px] text-emerald-700 hover:bg-emerald-50"
              disabled={sending}
              onClick={() => send(true)}
              data-testid={`feedback-ask-resolved-${row.id}`}
            >
              Send &amp; ask if it is sorted
            </Button>
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
      )}
    </div>
  );
};

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
  const [filter, setFilter] = useState("all"); // "all" | one of COLUMNS
  const [sending, setSending] = useState(null);
  // Head office reads two different post-bags and they are not the same job. Only shown to
  // them: a branch has one, its own, and a tab strip over a single thing is furniture.
  const [audience, setAudience] = useState("all"); // "all" | "super_admin" | "branch_admin"

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

  // Only head office ever sees both kinds, so the strip only exists for them. A branch is
  // already held to its own by the server and would be choosing between one thing and it.
  const isHeadOffice = !branchId && rows.some((r) => (r.audience || "branch_admin") === "super_admin");
  const byAudience = audience === "all" ? rows : rows.filter((r) => (r.audience || "branch_admin") === audience);
  const visible = filter === "all" ? byAudience : byAudience.filter((r) => (r.status || "new") === filter);

  // What head office is looking at, and how many of each. Counted off every row rather
  // than off what is on screen, or the tab you are standing on would always read as all
  // of them.
  const AUDIENCE_TABS = [
    { key: "all", label: "Everything", icon: Bell, count: rows.length },
    { key: "super_admin", label: "Direct to head office", icon: Bell, count: rows.filter((r) => (r.audience || "branch_admin") === "super_admin").length },
    { key: "branch_admin", label: "Branch-wise", icon: Building2, count: rows.filter((r) => (r.audience || "branch_admin") !== "super_admin").length },
  ];

  // Branch by branch, for the tab that is about the branches rather than about head
  // office's own post. Sorted by what is waiting: a branch with unanswered feedback is
  // the one head office is looking for, and alphabetical order buries it.
  const branchGroups = (() => {
    const groups = new Map();
    for (const r of visible) {
      const key = r.branch_id || "";
      const name = r.branch_name || "Unknown branch";
      if (!groups.has(key)) groups.set(key, { key, name, rows: [] });
      groups.get(key).rows.push(r);
    }
    const waiting = (g) => g.rows.filter((r) => r.awaiting_staff || (r.status || "new") === "new").length;
    return [...groups.values()].sort((a, b) => waiting(b) - waiting(a) || a.name.localeCompare(b.name));
  })();

  const move = async (row, to) => {
    setMoving(row.id);
    try {
      await moveBranchFeedback(row.id, to, "", "");
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not move that");
    } finally {
      setMoving(null);
    }
  };

  // Answering is the whole of the work now, so it lives on the card rather than behind a
  // dialog. Asking whether it is settled is the same call with a flag: closing one is a
  // question put to the patient, and their answer is what resolves it.
  const send = async (row, body, askResolved, done) => {
    setSending(row.id);
    try {
      await replyBranchFeedback(row.id, body, askResolved);
      done?.();
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not send that");
    } finally {
      setSending(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-slate-50" data-testid="feedback-board">
      {/* A page of its own rather than a card laid over the board behind it. There can be
          dozens of these, each a paragraph somebody wrote about their care, and working
          through them is the job for as long as it takes — not a glance at a dialog with
          the rest of the branch still showing round the edges.

          Header, tiles and cards all hang off one centred column of the same width, so a
          wide monitor does not leave the title at one end and the refresh at the other. */}
      <header className="shrink-0 border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-[92rem] items-center gap-3 px-4 py-3 sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-2 text-slate-500 transition hover:bg-slate-100"
            aria-label="Back"
            data-testid="feedback-close"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100">
            <Bell className="h-5 w-5 text-amber-600" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold text-slate-800">Patient Feedback</h2>
            <p className="truncate text-xs text-slate-400">What patients have written about their care</p>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="shrink-0" data-testid="feedback-refresh">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[92rem] px-4 py-5 sm:px-6">
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
              {/* Two post-bags, and they are not the same job. What a patient sent past
                  their branch is head office's own to answer — half of it is about the
                  Branch Admin. What the branches received is head office watching over
                  them, which reads branch by branch rather than as one pile. */}
              {isHeadOffice && (
                <div className="flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-1" data-testid="feedback-audience-tabs">
                  {AUDIENCE_TABS.map((t) => {
                    const Icon = t.icon;
                    return (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => { setAudience(t.key); setFilter("all"); }}
                        className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                          audience === t.key ? "bg-sky-100 text-sky-700" : "text-slate-500 hover:bg-slate-50"
                        }`}
                        data-testid={`feedback-audience-${t.key}`}
                      >
                        <Icon className="h-3.5 w-3.5" /> {t.label}
                        <span className="text-[10px] text-slate-400">({t.count})</span>
                      </button>
                    );
                  })}
                </div>
              )}

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
                audience === "branch_admin" ? (
                  /* Under the branch it belongs to, because on this tab the branch is the
                     unit head office is looking at. One flat grid of every branch's post
                     answers "how much is there" and never "which branch is behind". */
                  <div className="space-y-6" data-testid="feedback-by-branch">
                    {branchGroups.map((g) => {
                      const waiting = g.rows.filter((r) => r.awaiting_staff || (r.status || "new") === "new").length;
                      return (
                        <div key={g.key || "unknown"} data-testid={`feedback-branch-${g.key || "unknown"}`}>
                          <div className="mb-2 flex items-center gap-2 border-b border-slate-200 pb-1.5">
                            <Building2 className="h-4 w-4 shrink-0 text-slate-400" />
                            <h3 className="truncate text-sm font-semibold text-slate-700">{g.name}</h3>
                            <span className="text-[11px] text-slate-400">{g.rows.length}</span>
                            {waiting > 0 && (
                              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                                {waiting} waiting
                              </span>
                            )}
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                            {g.rows.map((r) => (
                              <FeedbackCard key={r.id} row={r} onMove={move} onSend={send} moving={moving === r.id} sending={sending === r.id} />
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" data-testid="feedback-list">
                    {visible.map((r) => (
                      <FeedbackCard key={r.id} row={r} onMove={move} onSend={send} moving={moving === r.id} sending={sending === r.id} />
                    ))}
                  </div>
                )
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FeedbackBoard;
