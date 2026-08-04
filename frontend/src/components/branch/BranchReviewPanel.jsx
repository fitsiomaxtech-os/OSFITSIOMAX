import { useCallback, useEffect, useMemo, useState } from "react";
import { Send, CheckCircle2, X, Search, RefreshCw, ChevronLeft, ChevronRight, Calendar as CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { StageTab } from "@/components/ui/stage-tab";
import { branchReviews, branchSendReview, getAvailableExperts, getAvailableDates } from "@/lib/api";
import { to12h, endTime12h } from "@/lib/time";

// Three views onto one pipeline: waiting to be sent, sent and still outstanding, done.
// Each row already names the Head Physio it went to, so the branch can see who has what
// without a separate view for it.
const SUB_TABS = [
  { key: "send", label: "Send to Review", color: "#f59e0b" },
  { key: "pending", label: "Pending Review", color: "#0ea5e9" },
  { key: "complete", label: "Review Complete", color: "#22c55e" },
];

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
  const [sendDraft, setSendDraft] = useState(null); // { review, head_physio_id, review_date, review_time, duration, notes }
  const [sending, setSending] = useState(false);
  const [viewing, setViewing] = useState(null);
  // Booking flow state, mirroring the Appointment popup: which month the calendar is on,
  // which days that month have a free slot, and who is free on the picked day.
  const [sendMonth, setSendMonth] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [openDates, setOpenDates] = useState({});
  const [hpAvail, setHpAvail] = useState({ experts: [], loading: false });

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

  const openSend = (review) => {
    const startDate = review.review_date || data.today || new Date().toISOString().slice(0, 10);
    const [y, m] = startDate.split("-").map(Number);
    setSendMonth({ y, m: m - 1 });
    setSendDraft({
      review,
      head_physio_id: review.head_physio_id || "",
      review_date: startDate,
      review_time: review.review_time || "",
      duration: review.review_duration || null,
      notes: review.branch_notes || "",
    });
  };

  // Which days of the shown month have a Head Physio slot free, refreshed as the popup
  // pages between months.
  useEffect(() => {
    if (!sendDraft || !branchId) return;
    const month = `${sendMonth.y}-${String(sendMonth.m + 1).padStart(2, "0")}`;
    let cancelled = false;
    getAvailableDates(branchId, month)
      .then((res) => { if (!cancelled) setOpenDates(res?.dates || {}); })
      .catch(() => { if (!cancelled) setOpenDates({}); });
    return () => { cancelled = true; };
  }, [sendDraft ? true : false, sendMonth.y, sendMonth.m, branchId]);

  // Head Physios free on the picked date, each carrying their own open times — so
  // choosing one reveals their slots without a second request.
  useEffect(() => {
    if (!sendDraft?.review_date || !branchId) return;
    let cancelled = false;
    setHpAvail((p) => ({ ...p, loading: true }));
    getAvailableExperts(branchId, sendDraft.review_date)
      .then((res) => { if (!cancelled) setHpAvail({ experts: res?.experts || [], loading: false }); })
      .catch(() => { if (!cancelled) setHpAvail({ experts: [], loading: false }); });
    return () => { cancelled = true; };
  }, [sendDraft?.review_date, branchId]);

  const sendSlots = useMemo(() => {
    if (!sendDraft?.head_physio_id) return [];
    return (hpAvail.experts.find((d) => d.id === sendDraft.head_physio_id)?.free_slots) || [];
  }, [hpAvail.experts, sendDraft?.head_physio_id]);

  const submitSend = async () => {
    if (!sendDraft.head_physio_id) { toast.error("Pick a Head Physio"); return; }
    if (!sendDraft.review_date) { toast.error("Pick a review date"); return; }
    setSending(true);
    try {
      await branchSendReview(sendDraft.review.id, {
        head_physio_id: sendDraft.head_physio_id,
        review_date: sendDraft.review_date,
        review_time: sendDraft.review_time || null,
        review_duration: sendDraft.duration || null,
        notes: sendDraft.notes || null,
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
      <tr className="transition-colors hover:bg-slate-50" data-testid={`branch-review-row-${r.id}`}>
        <td className="px-4 py-3 align-middle">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-800">{r.lead_name}</span>
            {r.patient_number && <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-500">{r.patient_number}</span>}
            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{r.treatment_days} treatment days</span>
            {overdue && <span className="rounded-md bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">OVERDUE</span>}
          </div>
          {r.reason && <p className="mt-0.5 text-[10px] text-slate-400">{r.reason}</p>}
        </td>
        <td className="whitespace-nowrap px-4 py-3 align-middle text-slate-600">{r.phone || "—"}</td>
        <td className="whitespace-nowrap px-4 py-3 align-middle text-slate-600">{r.physio_name || "—"}</td>
        <td className="whitespace-nowrap px-4 py-3 align-middle text-slate-600">{r.session_package_name || "—"}</td>
        {sub !== "send" && (
          <td className="whitespace-nowrap px-4 py-3 align-middle">
            <span className="font-medium text-violet-700">{r.head_physio_name || "—"}</span>
            <p className={`text-[10px] ${overdue ? "text-rose-600" : "text-slate-400"}`}>
              review {dmy(r.review_date)}{r.review_time ? ` · ${to12h(r.review_time)}` : ""}
              {r.status === "completed" && <span className="ml-1 font-semibold text-emerald-600">· completed</span>}
            </p>
          </td>
        )}
        <td className="whitespace-nowrap px-4 py-3 align-middle">
          {r.status === "send_to_review" ? (
            <Button size="sm" className="bg-amber-600 text-xs text-white hover:bg-amber-700" onClick={() => openSend(r)} data-testid={`branch-review-send-${r.id}`}>
              <Send className="mr-1.5 h-3.5 w-3.5" /> Send to Head Physio
            </Button>
          ) : r.status === "sent" ? (
            <Button size="sm" variant="outline" className="text-xs" onClick={() => openSend(r)} data-testid={`branch-review-reassign-${r.id}`}>
              Reassign
            </Button>
          ) : (
            <span className="text-[11px] text-slate-400">—</span>
          )}
        </td>
        <td className="whitespace-nowrap px-4 py-3 align-middle">
          <Button size="sm" variant="outline" className="text-xs" onClick={() => setViewing(r)} data-testid={`branch-review-view-${r.id}`}>
            View
          </Button>
        </td>
      </tr>
    );
  };

  // Same row as a card, for phones. Seven columns can't hold their width there — the
  // table scrolled sideways and left Physio, Weeks, the Send button and View all
  // off-screen, so the one thing this tab exists to do couldn't be reached.
  const ReviewCard = ({ r }) => {
    const overdue = r.status === "sent" && r.review_date && r.review_date < (data.today || "");
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-3" data-testid={`branch-review-card-${r.id}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-semibold text-slate-800">{r.lead_name}</p>
            {r.patient_number && <p className="truncate font-mono text-[10px] text-slate-400">{r.patient_number}</p>}
          </div>
          {overdue && <span className="shrink-0 rounded-md bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">OVERDUE</span>}
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
          <span className="rounded-md bg-slate-100 px-2 py-0.5 font-semibold text-slate-600">{r.treatment_days} treatment days</span>
          {r.session_package_name && <span>{r.session_package_name}</span>}
        </div>

        <dl className="mt-2 space-y-1 border-t border-slate-100 pt-2 text-xs">
          <div className="flex justify-between gap-2">
            <dt className="text-slate-400">Phone</dt>
            <dd className="truncate font-medium text-slate-700">{r.phone || "—"}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-slate-400">Physio</dt>
            <dd className="truncate font-medium text-slate-700">{r.physio_name || "—"}</dd>
          </div>
          {sub !== "send" && (
            <div className="flex justify-between gap-2">
              <dt className="text-slate-400">Head Physio</dt>
              <dd className="min-w-0 text-right">
                <span className="truncate font-medium text-violet-700">{r.head_physio_name || "—"}</span>
                <p className={`text-[10px] ${overdue ? "text-rose-600" : "text-slate-400"}`}>
                  review {dmy(r.review_date)}{r.review_time ? ` · ${to12h(r.review_time)}` : ""}
                  {r.status === "completed" && <span className="ml-1 font-semibold text-emerald-600">· completed</span>}
                </p>
              </dd>
            </div>
          )}
        </dl>

        {r.reason && <p className="mt-1.5 text-[10px] text-slate-400">{r.reason}</p>}

        <div className="mt-2.5 flex gap-2 border-t border-slate-100 pt-2.5">
          {r.status === "send_to_review" ? (
            <Button size="sm" className="flex-1 bg-amber-600 text-xs text-white hover:bg-amber-700" onClick={() => openSend(r)} data-testid={`branch-review-card-send-${r.id}`}>
              <Send className="mr-1.5 h-3.5 w-3.5" /> Send to Head Physio
            </Button>
          ) : r.status === "sent" ? (
            <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => openSend(r)} data-testid={`branch-review-card-reassign-${r.id}`}>
              Reassign
            </Button>
          ) : null}
          <Button size="sm" variant="outline" className={`text-xs ${r.status === "completed" ? "flex-1" : ""}`} onClick={() => setViewing(r)} data-testid={`branch-review-card-view-${r.id}`}>
            View
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4" data-testid="branch-review-panel">
      {/* Same coloured count pills the Branch Leads stage bar uses, so the three
          stages of the review pipeline read the same way as the lead stages above. */}
      <div className="-mx-1 rounded-xl border border-slate-200 bg-white/95 p-1 shadow-sm" data-testid="branch-review-subtabs">
        {/* Three across on a phone rather than a sideways scroll — they fit, and the
            third was otherwise behind a swipe. One flex row from sm up, as before. */}
        <div className="grid grid-cols-3 gap-1 sm:flex sm:flex-nowrap sm:overflow-visible">
          {SUB_TABS.map((t) => (
            <StageTab
              key={t.key}
              label={t.label}
              count={countFor(t.key)}
              active={sub === t.key}
              onClick={() => setSub(t.key)}
              color={t.color}
              testid={`branch-review-subtab-${t.key}`}
              gridded
            />
          ))}
        </div>
      </div>

      {/* No Card around this row any more. A bordered input sitting inside a bordered
          card is two rectangles drawing the same edge twice, which is what made the bar
          look boxed-in. The field is now the surface itself. */}
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="group relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-sky-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search patient, number, phone or Head Physio..."
            className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-10 text-sm text-slate-700 shadow-sm outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
            data-testid="branch-review-search"
          />
          {/* Clearing a search by backspacing a long phrase is needless work. */}
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              data-testid="branch-review-search-clear"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {/* Icon-only on a phone: the word cost a whole second row under the search box. */}
        <button
          type="button"
          onClick={load}
          disabled={loading}
          title="Refresh"
          className="flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-sky-200 bg-sky-50 px-3 text-sm font-semibold text-sky-700 shadow-sm transition hover:border-sky-300 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60 sm:px-4"
          data-testid="branch-review-refresh"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      {loading && rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-400">Loading reviews...</p>
      ) : rows.length === 0 ? (
        <Empty>
          {sub === "send" ? "No reviews waiting to be sent. A Physio raises one once a patient has completed 7 days of treatment."
            : sub === "pending" ? "Nothing pending — every review sent out has been written."
            : "No completed reviews yet."}
        </Empty>
      ) : (
        <>
        <div className="space-y-2 md:hidden" data-testid="branch-review-mobile">
          {rows.map((r) => <ReviewCard key={r.id} r={r} />)}
        </div>

        <div className="hidden overflow-auto rounded-xl border border-slate-200 bg-white md:block">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Patient</th>
                <th className="whitespace-nowrap px-4 py-2.5">Phone</th>
                <th className="whitespace-nowrap px-4 py-2.5">Physio</th>
                <th className="whitespace-nowrap px-4 py-2.5">Weeks</th>
                {sub !== "send" && <th className="whitespace-nowrap px-4 py-2.5">Head Physio</th>}
                <th className="whitespace-nowrap px-4 py-2.5">{sub === "send" ? "Send to Head Physio" : "Action"}</th>
                <th className="whitespace-nowrap px-4 py-2.5">View</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => <ReviewRow key={r.id} r={r} />)}
            </tbody>
          </table>
        </div>
        </>
      )}

      {/* Send to Head Physio — the same three-step booking the Appointment popup uses:
          the date narrows who's free, the chosen Head Physio narrows which times exist.
          A review is an appointment with a Head Physio, so it's booked like one rather
          than typed into a bare date field. */}
      {sendDraft && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-3" data-testid="branch-review-send-modal">
          <div className="flex h-[calc(100vh-1rem)] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-slate-100 px-6 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <CalendarIcon className="h-6 w-6 shrink-0 text-slate-500" />
                <div className="min-w-0">
                  <p className="text-lg font-bold text-slate-800">Send to Head Physio</p>
                  <p className="truncate text-xs text-slate-500">
                    {sendDraft.review.lead_name} · {sendDraft.review.treatment_days} treatment days · pick a date, then the Head Physio, then their time
                  </p>
                </div>
              </div>
              <button onClick={() => setSendDraft(null)} className="shrink-0 rounded-lg border-2 border-orange-200 bg-orange-100 p-2 text-orange-600 transition hover:border-orange-300 hover:bg-orange-200" data-testid="branch-review-send-close">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
              {/* STEP 1 — Date */}
              <div className="w-full flex-shrink-0 border-b border-slate-200 p-6 lg:w-[28rem] lg:border-b-0 lg:border-r lg:overflow-y-auto" data-testid="branch-review-date-panel">
                <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">1 · Date</p>
                {(() => {
                  const todayStr = new Date().toISOString().slice(0, 10);
                  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
                  const firstDow = new Date(sendMonth.y, sendMonth.m, 1).getDay();
                  const daysInMonth = new Date(sendMonth.y, sendMonth.m + 1, 0).getDate();
                  const pad = (n) => String(n).padStart(2, "0");
                  const stepMonth = (delta) => setSendMonth(({ y, m }) => {
                    const d = new Date(y, m + delta, 1);
                    return { y: d.getFullYear(), m: d.getMonth() };
                  });
                  return (
                    <>
                      <div className="mb-3 flex items-center justify-between">
                        <button type="button" onClick={() => stepMonth(-1)} className="rounded p-1 hover:bg-slate-100" data-testid="branch-review-prev-month">
                          <ChevronLeft className="h-5 w-5 text-slate-500" />
                        </button>
                        <h4 className="text-base font-bold text-slate-700">{monthNames[sendMonth.m]} {sendMonth.y}</h4>
                        <button type="button" onClick={() => stepMonth(1)} className="rounded p-1 hover:bg-slate-100" data-testid="branch-review-next-month">
                          <ChevronRight className="h-5 w-5 text-slate-500" />
                        </button>
                      </div>
                      <div className="mb-1 grid grid-cols-7 gap-1">
                        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                          <div key={d} className="py-1 text-center text-xs font-semibold text-slate-400">{d}</div>
                        ))}
                      </div>
                      <div className="grid grid-cols-7 gap-1">
                        {Array.from({ length: firstDow }, (_, i) => <div key={`pad-${i}`} className="h-14" />)}
                        {Array.from({ length: daysInMonth }, (_, i) => {
                          const day = i + 1;
                          const dateStr = `${sendMonth.y}-${pad(sendMonth.m + 1)}-${pad(day)}`;
                          const isPast = dateStr < todayStr;
                          const isPicked = sendDraft.review_date === dateStr;
                          const isToday = dateStr === todayStr;
                          const openSlots = openDates[dateStr] || 0;
                          const hasSlots = !isPast && openSlots > 0;
                          return (
                            <button
                              key={day}
                              type="button"
                              disabled={isPast}
                              // Availability is per-day, so a new date drops the Head Physio
                              // and slot chosen under the old one.
                              onClick={() => setSendDraft({ ...sendDraft, review_date: dateStr, head_physio_id: "", review_time: "", duration: null })}
                              className={`h-14 rounded-lg text-lg font-semibold transition ${
                                isPicked
                                  ? "bg-teal-600 text-white shadow-sm ring-2 ring-teal-200"
                                  : isPast
                                  ? "cursor-not-allowed text-slate-300"
                                  : hasSlots
                                  ? "bg-violet-300 text-white shadow-sm hover:bg-violet-400"
                                  : isToday
                                  ? "border border-teal-300 bg-teal-50 text-teal-700 hover:bg-teal-100"
                                  : "text-slate-600 hover:bg-slate-100"
                              }`}
                              title={hasSlots ? `${openSlots} slot${openSlots === 1 ? "" : "s"} open` : undefined}
                              data-testid={`branch-review-day-${day}`}
                            >
                              {day}
                            </button>
                          );
                        })}
                      </div>
                      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3 text-xs font-semibold text-slate-400">
                        <span className="flex items-center gap-1.5"><span className="inline-block h-3.5 w-3.5 rounded bg-violet-300" /> Slots open</span>
                        <span className="flex items-center gap-1.5"><span className="inline-block h-3.5 w-3.5 rounded bg-teal-600" /> Picked</span>
                      </div>
                    </>
                  );
                })()}
              </div>

              {/* STEP 2 — Head Physio */}
              <div className="w-full flex-shrink-0 border-b border-slate-200 p-5 lg:w-[22rem] lg:border-b-0 lg:border-r lg:overflow-y-auto" data-testid="branch-review-hp-panel">
                <p className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-400">2 · Head Physio</p>
                <p className="mb-3 text-xs text-slate-400">Only those with availability on the picked date.</p>
                {!sendDraft.review_date ? (
                  <p className="rounded-lg border border-dashed border-slate-200 px-3 py-10 text-center text-sm text-slate-400">Pick a date first.</p>
                ) : hpAvail.loading ? (
                  <p className="text-sm text-slate-400">Checking availability...</p>
                ) : hpAvail.experts.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-200 px-3 py-10 text-center text-sm text-slate-400">No Head Physio is available on this date.</p>
                ) : (
                  <div className="space-y-2">
                    {hpAvail.experts.map((doc) => {
                      const active = sendDraft.head_physio_id === doc.id;
                      const open = (doc.free_slots || []).length;
                      return (
                        <button
                          key={doc.id}
                          type="button"
                          onClick={() => setSendDraft({ ...sendDraft, head_physio_id: doc.id, review_time: "", duration: null })}
                          className={`flex w-full items-center gap-3 rounded-lg border-2 p-3.5 text-left transition ${active ? "border-teal-500 bg-teal-50 shadow-sm" : "border-slate-200 bg-white hover:border-teal-300 hover:bg-slate-50"}`}
                          data-testid={`branch-review-hp-${doc.id}`}
                        >
                          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-bold ${active ? "bg-teal-600 text-white" : "bg-teal-100 text-teal-700"}`}>
                            {doc.full_name?.charAt(0) || "H"}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-slate-800">{doc.full_name}</p>
                            <p className={`truncate text-xs ${open > 0 ? "text-slate-400" : "text-amber-600"}`}>
                              {open > 0 ? `${open} slot${open === 1 ? "" : "s"} open` : "Nothing published"}
                            </p>
                          </div>
                          {active && <CheckCircle2 className="ml-auto h-5 w-5 shrink-0 text-teal-600" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* STEP 3 — Time slot, from what the Head Physio actually published. */}
              <div className="w-full flex-shrink-0 p-4 sm:p-5 lg:flex-1 lg:overflow-y-auto" data-testid="branch-review-slot-panel">
                <p className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-400">3 · Time Slot</p>
                <p className="mb-3 text-xs text-slate-400">Published availability only.</p>
                {!sendDraft.head_physio_id ? (
                  <p className="rounded-lg border border-dashed border-slate-200 px-3 py-10 text-center text-sm text-slate-400">Select a Head Physio to see their available times.</p>
                ) : sendSlots.length === 0 ? (
                  <div className="rounded-lg border-2 border-amber-200 bg-amber-50 px-4 py-3" data-testid="branch-review-no-slots">
                    <p className="text-sm font-semibold text-amber-800">No availability published for this date.</p>
                    <p className="mt-0.5 text-xs text-amber-700">
                      Confirm with the Head Physio, then open MANAGEMENT → CONSULTANT CALENDAR and mark them available.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4" data-testid="branch-review-slots">
                    {sendSlots.map((s) => {
                      const active = sendDraft.review_time === s.time;
                      return (
                        <button
                          key={s.slot_time}
                          type="button"
                          onClick={() => setSendDraft({ ...sendDraft, review_time: s.time, duration: s.duration })}
                          className={`rounded-lg border-2 px-2 py-2.5 text-center transition ${active ? "border-teal-500 bg-teal-50 text-teal-700 shadow-sm ring-2 ring-teal-100" : "border-slate-200 bg-white text-slate-600 hover:border-teal-300 hover:bg-slate-50"}`}
                          data-testid={`branch-review-slot-${s.time}`}
                        >
                          <span className="block text-base font-bold">{to12h(s.time)}</span>
                          <span className="block text-[11px] text-slate-400">{s.duration} min</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {sendDraft.review_time && sendDraft.duration && (
                  <p className="mt-4 rounded-lg border-2 border-teal-300 bg-teal-50 px-4 py-2.5 text-sm font-bold text-teal-700" data-testid="branch-review-slot-summary">
                    {to12h(sendDraft.review_time)} – {endTime12h(sendDraft.review_time, sendDraft.duration)} · {sendDraft.duration} minute review
                  </p>
                )}

                {sendDraft.review.physio_notes && (
                  <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Physio's Notes</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{sendDraft.review.physio_notes}</p>
                  </div>
                )}

                <div className="mt-5">
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">Notes</label>
                  <textarea
                    rows={3}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
                    placeholder="Optional notes for the Head Physio..."
                    value={sendDraft.notes}
                    onChange={(e) => setSendDraft({ ...sendDraft, notes: e.target.value })}
                    data-testid="branch-review-notes"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-100 px-6 py-3.5">
              <Button variant="outline" onClick={() => setSendDraft(null)} data-testid="branch-review-send-cancel">Cancel</Button>
              <Button className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={submitSend} disabled={sending || !sendDraft.head_physio_id} data-testid="branch-review-send-submit">
                {sending ? "Sending..." : "Confirm"}
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
