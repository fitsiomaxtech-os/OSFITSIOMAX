import { useCallback, useEffect, useMemo, useState } from "react";
import { Send, Clock, CheckCircle2, X, Search, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { branchReviews, branchSendReview } from "@/lib/api";

// Three views onto one pipeline: waiting to be sent, sent and still outstanding, done.
// Each row already names the Head Physio it went to, so the branch can see who has what
// without a separate view for it.
const SUB_TABS = [
  { key: "send", label: "Send to Review", icon: Send, tone: "amber" },
  { key: "pending", label: "Pending Review", icon: Clock, tone: "sky" },
  { key: "complete", label: "Review Complete", icon: CheckCircle2, tone: "emerald" },
];

const TONE = {
  amber: { on: "bg-amber-600 text-white shadow-sm", off: "text-amber-700 hover:bg-amber-50", pill: "bg-amber-100 text-amber-700" },
  violet: { on: "bg-violet-600 text-white shadow-sm", off: "text-violet-700 hover:bg-violet-50", pill: "bg-violet-100 text-violet-700" },
  sky: { on: "bg-sky-600 text-white shadow-sm", off: "text-sky-700 hover:bg-sky-50", pill: "bg-sky-100 text-sky-700" },
  emerald: { on: "bg-emerald-600 text-white shadow-sm", off: "text-emerald-700 hover:bg-emerald-50", pill: "bg-emerald-100 text-emerald-700" },
};

const dmy = (d) => {
  if (!d) return "—";
  const [y, m, day] = String(d).slice(0, 10).split("-");
  return y && m && day ? `${day} - ${m} - ${y}` : d;
};

const Empty = ({ children }) => (
  <p className="rounded-lg border border-dashed border-slate-200 px-3 py-12 text-center text-sm text-slate-400">{children}</p>
);

/**
 * Branch Admin > Review — the middle link in the post-treatment review chain. A Physio
 * raises a review once a patient has been through a week of treatment; this is where the
 * Branch Admin puts it in front of a named Head Physio for a date, and watches it through
 * to done.
 */
export const BranchReviewPanel = ({ branchId }) => {
  const [sub, setSub] = useState("send");
  const [data, setData] = useState({ reviews: [], counts: {}, head_physios: [], today: "" });
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [sendDraft, setSendDraft] = useState(null); // { review, head_physio_id, review_date }
  const [sending, setSending] = useState(false);
  const [viewing, setViewing] = useState(null);

  const load = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    try { setData(await branchReviews(branchId)); }
    catch { setData({ reviews: [], counts: {}, head_physios: [], today: "" }); }
    setLoading(false);
  }, [branchId]);

  useEffect(() => { load(); }, [load]);

  const counts = data.counts || {};
  const countFor = (key) => (
    key === "send" ? counts.send_to_review
      : key === "pending" ? counts.sent
      : counts.completed
  ) || 0;

  const rows = useMemo(() => {
    const all = data.reviews || [];
    const byTab = sub === "send" ? all.filter((r) => r.status === "send_to_review")
      : sub === "pending" ? all.filter((r) => r.status === "sent")
      : all.filter((r) => r.status === "completed");
    if (!search) return byTab;
    const q = search.toLowerCase();
    return byTab.filter((r) =>
      (r.lead_name || "").toLowerCase().includes(q)
      || (r.patient_number || "").toLowerCase().includes(q)
      || (r.phone || "").includes(q)
      || (r.head_physio_name || "").toLowerCase().includes(q));
  }, [data.reviews, sub, search]);

  const openSend = (review) => setSendDraft({
    review,
    head_physio_id: review.head_physio_id || (data.head_physios[0] || {}).id || "",
    review_date: review.review_date || data.today || new Date().toISOString().slice(0, 10),
  });

  const submitSend = async () => {
    if (!sendDraft.head_physio_id) { toast.error("Pick a Head Physio"); return; }
    if (!sendDraft.review_date) { toast.error("Pick a review date"); return; }
    setSending(true);
    try {
      await branchSendReview(sendDraft.review.id, {
        head_physio_id: sendDraft.head_physio_id,
        review_date: sendDraft.review_date,
      });
      toast.success("Review sent to the Head Physio");
      setSendDraft(null);
      await load();
      setSub("pending");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to send the review");
    }
    setSending(false);
  };

  const ReviewRow = ({ r }) => {
    const overdue = r.status === "sent" && r.review_date && r.review_date < (data.today || "");
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-slate-200 bg-white p-4" data-testid={`branch-review-row-${r.id}`}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-bold text-slate-800">{r.lead_name}</p>
            {r.patient_number && <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-500">{r.patient_number}</span>}
            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{r.treatment_days} treatment days</span>
            {overdue && <span className="rounded-md bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700">OVERDUE</span>}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Raised by {r.physio_name || "—"}
            {r.session_package_name ? ` · ${r.session_package_name}` : ""}
            {r.reason ? ` · ${r.reason}` : ""}
          </p>
          {r.status !== "send_to_review" && (
            <p className="mt-0.5 text-xs font-semibold text-violet-700">
              {r.head_physio_name || "—"} · review {dmy(r.review_date)}
              {r.status === "completed" && <span className="ml-1 text-emerald-600">· completed</span>}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="outline" className="text-xs" onClick={() => setViewing(r)} data-testid={`branch-review-view-${r.id}`}>
            View
          </Button>
          {r.status === "send_to_review" && (
            <Button size="sm" className="bg-amber-600 text-xs text-white hover:bg-amber-700" onClick={() => openSend(r)} data-testid={`branch-review-send-${r.id}`}>
              <Send className="mr-1.5 h-3.5 w-3.5" /> Send to Head Physio
            </Button>
          )}
          {r.status === "sent" && (
            <Button size="sm" variant="outline" className="text-xs" onClick={() => openSend(r)} data-testid={`branch-review-reassign-${r.id}`}>
              Reassign
            </Button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4" data-testid="branch-review-panel">
      <div className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-1" data-testid="branch-review-subtabs">
        {SUB_TABS.map((t) => {
          const Icon = t.icon;
          const active = sub === t.key;
          const tone = TONE[t.tone];
          const n = countFor(t.key);
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setSub(t.key)}
              className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${active ? tone.on : tone.off}`}
              data-testid={`branch-review-subtab-${t.key}`}
            >
              <Icon className="h-4 w-4" />{t.label}
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${active ? "bg-white/25 text-white" : tone.pill}`}>{n}</span>
            </button>
          );
        })}
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search patient, number, phone or Head Physio..." className="pl-9" data-testid="branch-review-search" />
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} data-testid="branch-review-refresh">
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </CardContent>
      </Card>

      {loading && rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-400">Loading reviews...</p>
      ) : rows.length === 0 ? (
        <Empty>
          {sub === "send" ? "No reviews waiting to be sent. A Physio raises one once a patient has completed 7 days of treatment."
            : sub === "pending" ? "Nothing pending — every review sent out has been written."
            : "No completed reviews yet."}
        </Empty>
      ) : (
        <div className="space-y-2">{rows.map((r) => <ReviewRow key={r.id} r={r} />)}</div>
      )}

      {/* Send to Head Physio */}
      {sendDraft && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-3" data-testid="branch-review-send-modal">
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-slate-500 px-6 py-4 text-white">
              <div>
                <p className="text-lg font-bold">Send to Head Physio</p>
                <p className="text-xs text-white/80">{sendDraft.review.lead_name} · {sendDraft.review.treatment_days} treatment days</p>
              </div>
              <button onClick={() => setSendDraft(null)} className="rounded-lg border-2 border-orange-200 bg-orange-100 p-2 text-orange-600 hover:bg-orange-200" data-testid="branch-review-send-close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 p-5">
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">Head Physio *</label>
                {data.head_physios.length === 0 ? (
                  <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    No Head Physio on this branch — add one in HR → Roles &amp; Credentials.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {data.head_physios.map((hp) => (
                      <button
                        key={hp.id}
                        type="button"
                        onClick={() => setSendDraft({ ...sendDraft, head_physio_id: hp.id })}
                        className={`flex w-full items-center gap-3 rounded-lg border-2 p-3 text-left transition ${
                          sendDraft.head_physio_id === hp.id ? "border-violet-500 bg-violet-50" : "border-slate-200 hover:border-violet-300"
                        }`}
                        data-testid={`branch-review-hp-${hp.id}`}
                      >
                        <span className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ${sendDraft.head_physio_id === hp.id ? "bg-violet-600 text-white" : "bg-violet-100 text-violet-700"}`}>
                          {hp.full_name?.charAt(0) || "H"}
                        </span>
                        <span className="text-sm font-semibold text-slate-800">{hp.full_name}</span>
                        {sendDraft.head_physio_id === hp.id && <CheckCircle2 className="ml-auto h-4 w-4 text-violet-600" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">Review Date *</label>
                <Input
                  type="date"
                  value={sendDraft.review_date}
                  onChange={(e) => setSendDraft({ ...sendDraft, review_date: e.target.value })}
                  data-testid="branch-review-date"
                />
                <p className="mt-1 text-[11px] text-slate-400">Today's date puts it straight into that Head Physio's Today Review list.</p>
              </div>
              {sendDraft.review.physio_notes && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Physio's Notes</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{sendDraft.review.physio_notes}</p>
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-3.5">
              <Button variant="outline" onClick={() => setSendDraft(null)} data-testid="branch-review-send-cancel">Cancel</Button>
              <Button className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={submitSend} disabled={sending || !sendDraft.head_physio_id} data-testid="branch-review-send-submit">
                {sending ? "Sending..." : "Send Review"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Read-only detail */}
      {viewing && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-3" data-testid="branch-review-view-modal">
          <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-slate-500 px-6 py-4 text-white">
              <div>
                <p className="text-lg font-bold">{viewing.lead_name}</p>
                <p className="text-xs text-white/80">{viewing.patient_number || "—"} · {viewing.phone || "—"}</p>
              </div>
              <button onClick={() => setViewing(null)} className="rounded-lg border-2 border-orange-200 bg-orange-100 p-2 text-orange-600 hover:bg-orange-200" data-testid="branch-review-view-close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-5 text-sm">
              {[
                ["Status", viewing.status === "send_to_review" ? "Waiting to be sent" : viewing.status === "sent" ? "With the Head Physio" : "Completed"],
                ["Treatment Days", `${viewing.treatment_days}`],
                ["Package", viewing.session_package_name || "—"],
                ["Raised By", `${viewing.physio_name || "—"} · ${dmy(viewing.raised_at)}`],
                ["Head Physio", viewing.head_physio_name || "Not sent yet"],
                ["Review Date", dmy(viewing.review_date)],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between border-b border-slate-100 pb-2">
                  <span className="text-slate-500">{k}</span>
                  <span className="text-right font-semibold text-slate-700">{v}</span>
                </div>
              ))}
              {viewing.reason && <Block label="Reason" text={viewing.reason} />}
              {viewing.physio_notes && <Block label="Physio's Notes" text={viewing.physio_notes} />}
              {viewing.head_physio_notes && <Block label="Head Physio's Review" text={viewing.head_physio_notes} tone="emerald" />}
              {viewing.head_physio_suggestions && <Block label="Suggestions" text={viewing.head_physio_suggestions} tone="emerald" />}
            </div>
            <div className="flex justify-end border-t border-slate-200 bg-slate-50 px-6 py-3.5">
              <Button variant="outline" onClick={() => setViewing(null)} data-testid="branch-review-view-done">Close</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const Block = ({ label, text, tone }) => (
  <div className={`rounded-lg border p-3 ${tone === "emerald" ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}>
    <p className={`text-[11px] font-bold uppercase tracking-wider ${tone === "emerald" ? "text-emerald-600" : "text-slate-400"}`}>{label}</p>
    <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{text}</p>
  </div>
);

export default BranchReviewPanel;
