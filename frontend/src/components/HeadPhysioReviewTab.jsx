import { useCallback, useEffect, useMemo, useState } from "react";
import { X, RefreshCw, AlertTriangle, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { hpReviews, hpCompleteReview } from "@/lib/api";

const dmy = (d) => {
  if (!d) return "—";
  const [y, m, day] = String(d).slice(0, 10).split("-");
  return y && m && day ? `${day} - ${m} - ${y}` : d;
};

/**
 * Head Physio > Review — the far end of the post-treatment review chain. Only reviews a
 * Branch Admin has actually dispatched to this Head Physio appear here.
 *
 * "Today Review" deliberately also carries anything past its date and still unwritten:
 * an overdue review that fell out of Today would sit in a list nobody opens, which is
 * exactly how a patient's week-one review gets missed.
 */
export const HeadPhysioReviewTab = ({ selectedDate, compact = false, onCountChange, onRowsChange }) => {
  const [data, setData] = useState({ today: [], upcoming: [], overdue: [], completed: [], today_date: "" });
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState(null); // { review, head_physio_notes, head_physio_suggestions }
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await hpReviews()); }
    catch { setData({ today: [], upcoming: [], overdue: [], completed: [], today_date: "" }); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // With a day picked upstream, "due" means that day's reviews rather than everything
  // outstanding — the week strip is the filter, so the list has to answer to it.
  const dueList = useMemo(() => {
    const all = [...(data.overdue || []), ...(data.today || []), ...(data.upcoming || [])];
    return selectedDate ? all.filter((r) => (r.review_date || "") === selectedDate) : all;
  }, [data, selectedDate]);

  const completedList = useMemo(() => {
    const all = data.completed || [];
    return selectedDate ? all.filter((r) => (r.review_date || "") === selectedDate) : all;
  }, [data.completed, selectedDate]);

  // Outstanding first, then what's already written — the day's reviews are one list, not
  // two tabs to check. Each row already reads differently by status, so splitting them
  // only added a control to click before seeing either half.
  const rows = useMemo(() => {
    const list = [...dueList, ...completedList];
    if (!search) return list;
    const q = search.toLowerCase();
    return list.filter((r) => (r.lead_name || "").toLowerCase().includes(q) || (r.patient_number || "").toLowerCase().includes(q));
  }, [dueList, completedList, search]);

  // Outstanding reviews only — a tab labelled "Review 2" means two still to write, not
  // two that exist.
  useEffect(() => {
    if (onCountChange) onCountChange(dueList.length);
  }, [dueList.length, onCountChange]);

  useEffect(() => {
    if (onRowsChange) onRowsChange(rows);
  }, [rows, onRowsChange]);

  const submit = async () => {
    if (!draft.head_physio_notes.trim()) { toast.error("Write the review notes"); return; }
    setSaving(true);
    try {
      await hpCompleteReview(draft.review.id, {
        head_physio_notes: draft.head_physio_notes,
        head_physio_suggestions: draft.head_physio_suggestions,
      });
      toast.success("Review completed");
      setDraft(null);
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to save the review");
    }
    setSaving(false);
  };

  return (
    <div className="space-y-4" data-testid="hp-review-tab">
      {!compact && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-3">
            <div className="relative min-w-0 flex-1 sm:min-w-[220px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search patient or number..." className="pl-9" data-testid="hp-review-search" />
            </div>
            <Button variant="outline" size="sm" onClick={load} disabled={loading} data-testid="hp-review-refresh">
              <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </CardContent>
        </Card>
      )}

      {loading && rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-400">Loading reviews...</p>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 px-3 py-12 text-center text-sm text-slate-400">
          {selectedDate
            ? "No reviews on this day."
            : "No reviews assigned to you. A Branch Admin sends them here once a Physio raises one."}
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const done = r.status === "completed";
            const overdue = !done && r.review_date && r.review_date < (data.today_date || "");
            const isToday = r.review_date === data.today_date;
            return (
              <div key={r.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 bg-white p-4 ${overdue ? "border-rose-300" : isToday ? "border-sky-300" : "border-slate-200"}`} data-testid={`hp-review-row-${r.id}`}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-bold text-slate-800">{r.lead_name}</p>
                    {r.patient_number && <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-500">{r.patient_number}</span>}
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{r.treatment_days} treatment days</span>
                    {overdue && <span className="flex items-center gap-1 rounded-md bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700"><AlertTriangle className="h-3 w-3" /> OVERDUE</span>}
                    {isToday && <span className="rounded-md bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-700">TODAY</span>}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    Review {dmy(r.review_date)} · raised by {r.physio_name || "—"}
                    {r.session_package_name ? ` · ${r.session_package_name}` : ""}
                  </p>
                  {r.physio_notes && <p className="mt-1 line-clamp-2 text-xs text-slate-600">“{r.physio_notes}”</p>}
                  {done && r.head_physio_notes && (
                    <p className="mt-1 line-clamp-2 text-xs font-medium text-emerald-700">{r.head_physio_notes}</p>
                  )}
                </div>
                {!done ? (
                  <Button size="sm" className="shrink-0 bg-sky-600 text-xs text-white hover:bg-sky-700" onClick={() => setDraft({ review: r, head_physio_notes: "", head_physio_suggestions: "" })} data-testid={`hp-review-write-${r.id}`}>
                    Write Review
                  </Button>
                ) : (
                  <span className="shrink-0 rounded-md bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-700">COMPLETED</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {draft && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-3" data-testid="hp-review-modal">
          <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-slate-500 px-6 py-4 text-white">
              <div>
                <p className="text-lg font-bold">{draft.review.lead_name}</p>
                <p className="text-xs text-white/80">
                  {draft.review.treatment_days} treatment days · review {dmy(draft.review.review_date)}
                </p>
              </div>
              <button onClick={() => setDraft(null)} className="rounded-lg border-2 border-orange-200 bg-orange-100 p-2 text-orange-600 hover:bg-orange-200" data-testid="hp-review-close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              {draft.review.reason && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Reason for Review</p>
                  <p className="mt-1 text-sm text-slate-700">{draft.review.reason}</p>
                </div>
              )}
              {/* Always rendered, even when empty. Notes are required when raising a
                  review now, but reviews raised before that rule have none — and silently
                  omitting the block made it look as though the physio's remarks had gone
                  missing rather than never having been written. */}
              <div className={`rounded-lg border p-3 ${draft.review.physio_notes ? "border-sky-200 bg-sky-50" : "border-slate-200 bg-slate-50"}`} data-testid="hp-review-physio-notes">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Physio's Notes
                  {draft.review.physio_name && <span className="ml-1 font-semibold normal-case tracking-normal text-slate-500">· {draft.review.physio_name}</span>}
                </p>
                {draft.review.physio_notes ? (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{draft.review.physio_notes}</p>
                ) : (
                  <p className="mt-1 text-sm italic text-slate-400">The physio raised this review without notes.</p>
                )}
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">Review Notes *</label>
                <textarea
                  rows={5}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-400"
                  placeholder="How is the patient responding after a week of treatment?"
                  value={draft.head_physio_notes}
                  onChange={(e) => setDraft({ ...draft, head_physio_notes: e.target.value })}
                  data-testid="hp-review-notes"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">Suggestions</label>
                <textarea
                  rows={3}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-400"
                  placeholder="Changes to the treatment plan, if any..."
                  value={draft.head_physio_suggestions}
                  onChange={(e) => setDraft({ ...draft, head_physio_suggestions: e.target.value })}
                  data-testid="hp-review-suggestions"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-3.5">
              <Button variant="outline" onClick={() => setDraft(null)} data-testid="hp-review-cancel">Cancel</Button>
              <Button className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={submit} disabled={saving} data-testid="hp-review-submit">
                {saving ? "Saving..." : "Complete Review"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HeadPhysioReviewTab;
