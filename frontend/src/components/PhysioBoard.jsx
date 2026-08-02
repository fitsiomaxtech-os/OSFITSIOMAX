import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Search,
  Send,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { StageTab } from "@/components/ui/stage-tab";
import { DateFilterPopover } from "@/components/DateFilterPopover";
import {
  physioConsultations,
  physioCompleteConsultation,
  physioCalendar,
  physioPatients,
  physioSessions,
  physioCompleteSession,
  physioWeeklyAssessment,
  physioReviews,
  physioRaiseReview,
} from "@/lib/api";
import { to12h, slotTo12h } from "@/lib/time";

// Bottom nav (mobile-first): Treatment and Patients keep their old icons; Review
// takes the slot Calendar used to hold there — Calendar moved to the top-right
// page button instead, alongside Profile on the top-left.
const BOTTOM_TABS = [
  { key: "treatment", label: "Treatment", icon: ClipboardList },
  { key: "review", label: "Review", icon: ClipboardCheck },
  { key: "patients", label: "Patients", icon: Users },
];

export const PhysioBoard = ({ physioId } = {}) => {
  const [activeTab, setActiveTab] = useState("treatment");

  return (
    <div className="space-y-3 pb-20" data-testid="physio-board-root">
      {activeTab === "treatment" && <TreatmentTab physioId={physioId} />}
      {activeTab === "review" && <ReviewTab physioId={physioId} />}
      {activeTab === "patients" && <PatientsTab physioId={physioId} />}

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white" data-testid="physio-bottom-nav">
        <div className="mx-auto flex max-w-lg items-stretch justify-around">
          {BOTTOM_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition ${
                  isActive ? "text-sky-600" : "text-slate-400"
                }`}
                data-testid={`physio-bottom-tab-${tab.key}`}
              >
                <Icon className="h-5 w-5" /> {tab.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const shiftIso = (iso, days) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return isoOf(d);
};
// Sunday-to-Saturday calendar week containing `iso` — the week strip always shows
// a real week, not an arbitrary sliding window, so it reads like a normal calendar.
const weekDatesFor = (iso) => {
  const sunday = shiftIso(iso, -new Date(`${iso}T00:00:00`).getDay());
  return Array.from({ length: 7 }, (_, i) => shiftIso(sunday, i));
};
const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

// Summary tile. `solidClass` fills the tile — used on the one figure in each group
// that the physio is actually acting on, so it carries the group rather than
// sitting level with the counts either side of it.
const StatTile = ({ label, value, sub, valueClass, solidClass, onClick, active, testid }) => {
  const Tag = onClick ? "button" : "div";
  const tagProps = onClick ? { type: "button", onClick, "data-testid": testid } : { "data-testid": testid };
  return solidClass ? (
    <Tag
      {...tagProps}
      className={`w-full text-left rounded-lg px-3 py-2.5 transition ${solidClass} ${active ? "ring-2 ring-white/70" : ""} ${onClick ? "hover:opacity-90" : ""}`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-white/75">{label}</p>
      <p className="text-xl font-bold text-white">{value}</p>
      {sub && <p className="text-[10px] text-white/70">{sub}</p>}
    </Tag>
  ) : (
    <Tag
      {...tagProps}
      className={`w-full text-left rounded-lg border px-3 py-2.5 transition ${active ? "border-sky-400 bg-sky-50" : "border-slate-200 bg-white"} ${onClick ? "hover:border-sky-300" : ""}`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`text-xl font-bold ${valueClass || "text-slate-700"}`}>{value}</p>
      {sub && <p className="text-[10px] text-slate-400">{sub}</p>}
    </Tag>
  );
};

function TreatmentTab({ physioId }) {
  const [leads, setLeads] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedLead, setSelectedLead] = useState(null);

  const todayIso = isoOf(new Date());
  const [search, setSearch] = useState("");
  const [selectedDate, setSelectedDate] = useState(todayIso);
  // Which Sun-Sat week is showing — held apart from selectedDate so the arrows
  // move the whole week without disturbing which single day is highlighted.
  const [weekAnchor, setWeekAnchor] = useState(todayIso);

  const stripDates = useMemo(() => weekDatesFor(weekAnchor), [weekAnchor]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Leads carry the appointment Branch Admin booked; the calendar carries the
      // treatment days booked against this physio. Both are appointments for the day.
      const months = [...new Set(stripDates.map((d) => d.slice(0, 7)))];
      const [consults, ...calendars] = await Promise.all([
        physioConsultations(physioId),
        ...months.map((m) => physioCalendar(Number(m.slice(5, 7)), Number(m.slice(0, 4)), physioId)),
      ]);
      setLeads(consults.leads || []);
      setSessions(calendars.flatMap((c) => c.sessions || []));
    } catch { /* silent */ }
    setLoading(false);
  }, [physioId, stripDates.join(",")]);

  useEffect(() => { load(); }, [load]);

  const leadById = useMemo(() => Object.fromEntries(leads.map((l) => [l.id, l])), [leads]);

  // Everything booked on a given day: the branch-booked appointment, plus any treatment
  // day scheduled that date. Both land in the same list, earliest time first.
  const rowsFor = useCallback((date) => {
    const rows = leads
      .filter((l) => l.appointment_date === date)
      .map((l) => ({
        key: `appt-${l.id}`, lead: l, time: l.appointment_time || "",
        label: "Appointment", done: l.physio_stage === "Complete",
      }));
    sessions
      .filter((s) => (s.slot_time || "").startsWith(date))
      .forEach((s) => {
        const lead = leadById[s.lead_id];
        rows.push({
          key: `day-${s.id}`,
          lead: lead || { id: s.lead_id, name: s.lead_name },
          time: (s.slot_time.split("T")[1] || "").slice(0, 5),
          label: `Day ${s.session_number} of ${s.total_sessions}`,
          sessionNumber: s.session_number,
          totalSessions: s.total_sessions,
          week: s.week_number,
          done: s.status === "completed",
        });
      });
    return rows.sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  }, [leads, sessions, leadById]);

  const dayRows = useMemo(() => rowsFor(selectedDate), [rowsFor, selectedDate]);

  // Which of the three summary tiles is narrowing the day's list — "all" (the
  // default, tapping "Total Days") shows everything; "completed"/"pending" isolate
  // just that group. Tapping an already-active tile clears back to "all".
  const [rowFilter, setRowFilter] = useState("all");

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = dayRows;
    if (q) {
      rows = rows.filter((r) => (
        (r.lead.name || "").toLowerCase().includes(q) || (r.lead.phone || "").toLowerCase().includes(q)
      ));
    }
    if (rowFilter === "completed") rows = rows.filter((r) => r.done);
    else if (rowFilter === "pending") rows = rows.filter((r) => !r.done);
    // Incomplete cards always show first, completed (green) cards always last —
    // each group keeps its own time order from rowsFor's sort.
    const incomplete = rows.filter((r) => !r.done);
    const completed = rows.filter((r) => r.done);
    return [...incomplete, ...completed];
  }, [dayRows, search, rowFilter]);

  // Every treatment day this physio holds, regardless of date — the default when
  // no Meta-style date filter is active.
  const overall = useMemo(() => {
    const total = leads.reduce((n, l) => n + (l.total_sessions || 0), 0);
    const completed = leads.reduce((n, l) => n + (l.completed_sessions || 0), 0);
    return { total, completed, pending: total - completed };
  }, [leads]);

  const countFor = (date) => (
    leads.filter((l) => l.appointment_date === date).length
    + sessions.filter((s) => (s.slot_time || "").startsWith(date)).length
  );

  // Meta Ads-style date filter for the summary tile only — separate from the week
  // strip below, which always keeps its own single selected day. Defaults to Today
  // rather than Overall, same as the week strip's own default. Picking a preset
  // whose range is a single day (Today, Yesterday, an exact calendar date) also
  // jumps the week strip there, since there's no ambiguity about which day to show.
  const [filterValue, setFilterValue] = useState(() => {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date();
    to.setHours(23, 59, 59, 999);
    return { key: "today", label: "Today", from, to };
  });
  const [filterSessions, setFilterSessions] = useState([]);

  const handleFilterChange = (next) => {
    setFilterValue(next);
    if (next && isoOf(next.from) === isoOf(next.to)) {
      const d = isoOf(next.from);
      setSelectedDate(d);
      setWeekAnchor(d);
    }
  };

  useEffect(() => {
    if (!filterValue) { setFilterSessions([]); return; }
    let cancelled = false;
    (async () => {
      const months = [];
      let y = filterValue.from.getFullYear(), m = filterValue.from.getMonth();
      const endY = filterValue.to.getFullYear(), endM = filterValue.to.getMonth();
      while (y < endY || (y === endY && m <= endM)) {
        months.push({ year: y, month: m + 1 });
        m += 1;
        if (m > 11) { m = 0; y += 1; }
      }
      try {
        const results = await Promise.all(months.map((mo) => physioCalendar(mo.month, mo.year, physioId)));
        if (!cancelled) setFilterSessions(results.flatMap((r) => r.sessions || []));
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [filterValue, physioId]);

  const filterStats = useMemo(() => {
    if (!filterValue) return overall;
    const fromIso = isoOf(filterValue.from);
    const toIso = isoOf(filterValue.to);
    const inRange = (d) => d && d >= fromIso && d <= toIso;
    const apptRows = leads.filter((l) => inRange(l.appointment_date));
    const dayRows = filterSessions.filter((s) => inRange((s.slot_time || "").slice(0, 10)));
    const total = apptRows.length + dayRows.length;
    const completed = apptRows.filter((l) => l.physio_stage === "Complete").length + dayRows.filter((s) => s.status === "completed").length;
    return { total, completed, pending: total - completed };
  }, [filterValue, leads, filterSessions, overall]);

  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <div data-testid="physio-treatment-tab">
      <div className="mb-4 rounded-xl border border-sky-100 bg-sky-50/40 p-3" data-testid="physio-treatment-summary">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-sky-700">{filterValue ? filterValue.label : "Overall Treatment"}</p>
        <div className="grid grid-cols-3 gap-2">
          <StatTile
            label="Total Days" value={filterStats.total} valueClass="text-sky-700"
            onClick={() => setRowFilter("all")} active={rowFilter === "all"} testid="physio-stat-total"
          />
          <StatTile
            label="Completed" value={filterStats.completed} valueClass="text-emerald-600"
            sub={filterStats.total ? `${Math.round((filterStats.completed / filterStats.total) * 100)}% done` : null}
            onClick={() => setRowFilter(rowFilter === "completed" ? "all" : "completed")} active={rowFilter === "completed"} testid="physio-stat-completed"
          />
          <StatTile
            label="Pending" value={filterStats.pending} solidClass="bg-violet-600" sub="Days left"
            onClick={() => setRowFilter(rowFilter === "pending" ? "all" : "pending")} active={rowFilter === "pending"} testid="physio-stat-pending"
          />
        </div>
      </div>

      {/* Icon-only search that expands on tap, plus the Meta-style date filter —
          when nothing's picked the summary above shows Overall; the week strip
          below always keeps today selected by default regardless. */}
      <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="physio-treatment-toolbar">
        {searchOpen ? (
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search patient by name or phone..."
              className="h-10 pl-9 pr-9"
              data-testid="physio-treatment-search"
            />
            <button
              type="button"
              onClick={() => { setSearchOpen(false); setSearch(""); }}
              className="absolute right-2 top-2 rounded p-1 text-slate-400 hover:bg-slate-100"
              data-testid="physio-treatment-search-close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
            data-testid="physio-treatment-search-open"
          >
            <Search className="h-4 w-4" />
          </button>
        )}
        <DateFilterPopover value={filterValue} onChange={handleFilterChange} testid="physio-treatment-date-filter" />
      </div>

      {/* Sun-Sat week strip — today is always the default selection. */}
      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3" data-testid="physio-treatment-week-strip">
        <div className="mb-2 flex items-center justify-between">
          <button type="button" onClick={() => setWeekAnchor((a) => shiftIso(a, -7))} className="rounded p-1 text-slate-400 hover:bg-slate-100" data-testid="physio-week-prev">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <p className="text-xs font-semibold text-slate-600">
            {new Date(`${weekAnchor}T00:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
          </p>
          <button type="button" onClick={() => setWeekAnchor((a) => shiftIso(a, 7))} className="rounded p-1 text-slate-400 hover:bg-slate-100" data-testid="physio-week-next">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {stripDates.map((date, i) => {
            const day = parseInt(date.split("-")[2], 10);
            const isSelected = date === selectedDate;
            const isToday = date === todayIso;
            const n = countFor(date);
            return (
              <button
                key={date}
                type="button"
                onClick={() => setSelectedDate(date)}
                className={`flex flex-col items-center gap-1 rounded-lg py-1.5 transition ${isSelected ? "bg-sky-600" : "hover:bg-slate-50"}`}
                data-testid={`physio-day-${date}`}
              >
                <span className={`text-[10px] font-semibold ${isSelected ? "text-sky-100" : "text-slate-400"}`}>{DAY_LETTERS[i]}</span>
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold ${
                    isSelected ? "bg-white/20 text-white" : isToday ? "bg-sky-100 text-sky-700" : "text-slate-600"
                  }`}
                >
                  {day}
                </span>
                {n > 0 && <span className={`text-[9px] font-medium ${isSelected ? "text-sky-100" : "text-slate-400"}`}>{n}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {visibleRows.length === 0 && !loading ? (
        <div className="text-center py-16">
          <ClipboardList className="h-10 w-10 text-slate-200 mx-auto mb-3" />
          <p className="text-sm text-slate-400">
            {search.trim()
              ? `No patient matches "${search.trim()}" on this day`
              : `Nothing booked for ${new Date(`${selectedDate}T00:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}`}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {visibleRows.map((r) => {
            const l = r.lead;
            const clickable = l?.phone !== undefined;
            // Every 7th treatment day is a review milestone — reviewsSoFar counts how
            // many the patient has already passed; isReviewDay flags today as one of them.
            const reviewsSoFar = r.sessionNumber ? Math.floor(r.sessionNumber / 7) : 0;
            const isReviewDay = r.sessionNumber > 0 && r.sessionNumber % 7 === 0;
            return (
              <button
                type="button"
                key={r.key}
                onClick={() => clickable && setSelectedLead(l)}
                disabled={!clickable}
                className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition disabled:cursor-default ${
                  r.done ? "border-emerald-200 bg-emerald-50/50" : isReviewDay ? "border-violet-200 bg-violet-50/40" : "border-slate-200 bg-white hover:border-sky-200"
                }`}
                data-testid={`treatment-row-${r.key}`}
              >
                <div className={`flex h-11 w-16 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold ${r.done ? "bg-emerald-200 text-emerald-800" : "bg-sky-100 text-sky-700"}`}>
                  {r.time ? to12h(r.time) : "—"}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800">{l.name}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500">
                    {r.sessionNumber ? (
                      <>
                        <span>{String(r.sessionNumber).padStart(2, "0")}/{r.totalSessions}</span>
                        <span className={`rounded-full px-1.5 py-0.5 font-semibold ${reviewsSoFar > 0 ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-400"}`}>
                          {reviewsSoFar} Review{reviewsSoFar === 1 ? "" : "s"}
                        </span>
                        {isReviewDay && <span className="rounded-full bg-violet-600 px-1.5 py-0.5 font-semibold text-white">Review Today</span>}
                      </>
                    ) : (
                      <span>{r.label}</span>
                    )}
                  </div>
                </div>
                {r.done ? (
                  <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-semibold text-emerald-700">Done</span>
                ) : (
                  <span className="flex shrink-0 items-center gap-0.5 text-[11px] font-semibold text-sky-600">
                    View <ChevronRight className="h-3.5 w-3.5" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {selectedLead && (
        <ConsultationDetailModal
          lead={selectedLead}
          physioId={physioId}
          activeDate={selectedDate}
          // Days are completed inside the popup, so re-pull on close to refresh the counts.
          onClose={() => { setSelectedLead(null); load(); }}
          onDone={() => { setSelectedLead(null); load(); }}
        />
      )}
    </div>
  );
}

const REVIEW_TABS = [
  { key: "overall", label: "Overall", color: "#0ea5e9" },
  { key: "branch_admin", label: "Branch Admin", color: "#a855f7" },
  { key: "head_physio", label: "Head Physio", color: "#f59e0b" },
  { key: "completed", label: "Completed", color: "#22c55e" },
];

/**
 * Review — the Physio's end of the post-treatment review chain, in one place.
 *
 * Raising a review is what starts the chain: it lands with the Branch Admin, who
 * dispatches it to a named Head Physio, who writes it up. The tabs follow a patient
 * along that hand-off, and the weekly write-up hangs off the same rows.
 *
 * Treatment days are counted from days actually attended, not from when the package was
 * bought: a package booked three weeks out is not three weeks of treatment. A patient
 * under the threshold can still be sent up early, because a physio noticing something
 * wrong in week one is exactly when a Head Physio most needs to see them — the badge
 * just stops flagging it as due.
 */
function ReviewTab({ physioId }) {
  const [patients, setPatients] = useState([]);
  const [threshold, setThreshold] = useState(7);
  const [loading, setLoading] = useState(false);
  const [bucket, setBucket] = useState("overall");
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [weeksTarget, setWeeksTarget] = useState(null); // patient whose weeks are being picked
  const [assessmentTarget, setAssessmentTarget] = useState(null); // { leadId, leadName, week } | null
  const [draft, setDraft] = useState(null); // { patient, reason, physio_notes } | null
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Two sources: the review chain's own state, and the session tallies that say how
      // many weeks there are to write up. Keyed together on lead_id.
      const [rev, pats] = await Promise.all([physioReviews(physioId), physioPatients(physioId)]);
      const byLead = Object.fromEntries((pats.patients || []).map((p) => [p.lead_id, p]));
      setThreshold(rev.review_after_days || 7);
      setPatients((rev.patients || []).map((p) => ({ ...(byLead[p.lead_id] || {}), ...p })));
    } catch { /* silent */ }
    setLoading(false);
  }, [physioId]);

  useEffect(() => { load(); }, [load]);

  const submitRaise = async () => {
    setSaving(true);
    try {
      await physioRaiseReview(draft.patient.lead_id, { reason: draft.reason, physio_notes: draft.physio_notes }, physioId);
      toast.success("Sent to Branch Admin for review");
      setDraft(null);
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to raise the review");
    }
    setSaving(false);
  };

  // Who currently holds the review. A patient with none raised sits outside the chain
  // and only shows under Overall, which is where they get sent up from.
  const bucketOf = (p) => {
    if (p.review_status === "completed") return "completed";
    if (p.review_status === "sent") return "head_physio";
    if (p.review_status === "send_to_review") return "branch_admin";
    return "not_raised";
  };

  const counts = useMemo(() => {
    const c = { overall: patients.length, branch_admin: 0, head_physio: 0, completed: 0, not_raised: 0 };
    patients.forEach((p) => { c[bucketOf(p)] += 1; });
    return c;
  }, [patients]);

  const dueCount = useMemo(
    () => patients.filter((p) => p.due_for_review && !p.review_status).length,
    [patients],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return patients.filter((p) => {
      if (bucket !== "overall" && bucketOf(p) !== bucket) return false;
      if (dateFilter && (p.first_session_date || "") !== dateFilter) return false;
      if (q && !(
        (p.lead_name || "").toLowerCase().includes(q)
        || (p.phone || "").toLowerCase().includes(q)
        || (p.patient_number || "").toLowerCase().includes(q)
      )) return false;
      return true;
    });
  }, [patients, bucket, search, dateFilter]);

  const STATUS_BADGE = {
    completed: { label: "Review Completed", cls: "bg-emerald-100 text-emerald-700" },
    sent: { label: "With Head Physio", cls: "bg-violet-100 text-violet-700" },
    send_to_review: { label: "With Branch Admin", cls: "bg-sky-100 text-sky-700" },
  };

  return (
    <div data-testid="physio-review-tab">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-700">Weekly Reviews</h3>
        <div className="flex items-center gap-2">
          {dueCount > 0 && (
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-bold text-amber-700" data-testid="physio-review-due-count">
              {dueCount} due
            </span>
          )}
          <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-[10px] font-semibold text-sky-700">{visible.length} patients</span>
        </div>
      </div>

      {/* Where each patient's weeks have got to along the review hand-off — same
          coloured count pills the Branch Leads stage bar uses. */}
      <div className="mb-3 -mx-1 rounded-xl border border-slate-200 bg-white/95 p-1 shadow-sm" data-testid="physio-review-buckets">
        <div className="flex flex-nowrap gap-1 overflow-x-auto sm:overflow-visible">
          {REVIEW_TABS.map((t) => (
            <StageTab
              key={t.key}
              label={t.label}
              count={counts[t.key]}
              active={bucket === t.key}
              onClick={() => setBucket(t.key)}
              color={t.color}
              testid={`physio-review-bucket-${t.key}`}
            />
          ))}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="physio-review-toolbar">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search patient by name, phone or patient no..."
            className="h-10 pl-9"
            data-testid="physio-review-search"
          />
        </div>
        <Input
          type="date"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="h-10 w-44"
          title="Filter by treatment start date"
          data-testid="physio-review-date-filter"
        />
        {dateFilter && (
          <Button variant="outline" className="h-10" onClick={() => setDateFilter("")} data-testid="physio-review-date-clear">
            Clear
          </Button>
        )}
      </div>

      {visible.length === 0 && !loading ? (
        <div className="text-center py-16">
          <ClipboardCheck className="h-10 w-10 text-slate-200 mx-auto mb-3" />
          <p className="text-sm text-slate-400">
            {patients.length === 0
              ? "No patients assigned to you yet"
              : "No patient matches these filters"}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((p) => {
            const badge = STATUS_BADGE[p.review_status];
            return (
              <div key={p.lead_id} className="rounded-xl border border-slate-200 bg-white p-3" data-testid={`physio-review-patient-${p.lead_id}`}>
                <button type="button" onClick={() => setWeeksTarget(p)} className="flex w-full items-start gap-2.5 text-left">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-50 text-xs font-bold text-sky-700">
                    {p.lead_name?.charAt(0)?.toUpperCase() || "?"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-800">{p.lead_name}</p>
                    <p className="truncate text-[10px] text-slate-400">
                      {p.phone || "—"}{p.patient_number ? ` · ${p.patient_number}` : ""}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold ${
                        p.due_for_review ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"
                      }`}>
                        {p.treatment_days} / {threshold} days
                      </span>
                      {badge ? (
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.cls}`}>
                          {badge.label}
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-400">Not raised</span>
                      )}
                    </div>
                  </div>
                </button>
                {!p.review_status && (
                  <Button
                    size="sm"
                    className={`mt-2 w-full text-xs text-white ${p.due_for_review ? "bg-amber-600 hover:bg-amber-700" : "bg-slate-400 hover:bg-slate-500"}`}
                    onClick={() => setDraft({ patient: p, reason: "", physio_notes: "" })}
                    data-testid={`physio-raise-review-${p.lead_id}`}
                  >
                    Send for Review
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Row click opens that patient's weeks — the write-up itself is the same
          WeeklyAssessmentModal the per-patient detail view uses. */}
      {weeksTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => { if (e.target === e.currentTarget) setWeeksTarget(null); }}>
          <div className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-2xl" data-testid="physio-review-weeks-modal">
            <div className="flex items-start justify-between gap-3 bg-slate-500 px-5 py-4 text-white">
              <div className="min-w-0">
                <h3 className="text-base font-bold">{weeksTarget.lead_name}</h3>
                <p className="text-xs text-white/80">
                  {weeksTarget.treatment_days} treatment days
                  {weeksTarget.total_sessions ? ` · ${weeksTarget.completed_sessions} of ${weeksTarget.total_sessions} booked days complete` : ""}
                </p>
              </div>
              <button type="button" onClick={() => setWeeksTarget(null)} className="rounded-full p-1.5 text-white/80 hover:bg-white/20"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-5">
              {(weeksTarget.weeks || weeksTarget.package_weeks || 0) === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-400">
                  No treatment weeks booked yet — nothing to write up.
                </p>
              ) : (
                <>
                  <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Pick a week to write up</p>
                  <div className="flex flex-wrap gap-2">
                    {Array.from({ length: weeksTarget.weeks || weeksTarget.package_weeks || 0 }, (_, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setAssessmentTarget({ leadId: weeksTarget.lead_id, leadName: weeksTarget.lead_name, week: i + 1 })}
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-medium text-slate-600 transition-all hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700"
                        data-testid={`physio-review-week-${weeksTarget.lead_id}-${i + 1}`}
                      >
                        Week {i + 1}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Raising the review — reason and notes travel with it to the Head Physio. */}
      {draft && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-3" onClick={(e) => { if (e.target === e.currentTarget) setDraft(null); }}>
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl" data-testid="physio-raise-review-modal">
            <div className="flex items-center justify-between bg-slate-500 px-6 py-4 text-white">
              <div>
                <p className="text-lg font-bold">Send for Review</p>
                <p className="text-xs text-white/80">{draft.patient.lead_name} · {draft.patient.treatment_days} treatment days</p>
              </div>
              <button onClick={() => setDraft(null)} className="rounded-lg border-2 border-orange-200 bg-orange-100 p-2 text-orange-600 hover:bg-orange-200" data-testid="physio-raise-review-close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 p-5">
              {!draft.patient.due_for_review && (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  This patient has {draft.patient.treatment_days} of {threshold} treatment days. You can still send them up early.
                </p>
              )}
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">Reason</label>
                <Input
                  value={draft.reason}
                  onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
                  placeholder="e.g. Week 1 progress review"
                  data-testid="physio-raise-review-reason"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">Notes for the Head Physio</label>
                <textarea
                  rows={4}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-400"
                  placeholder="How has the patient responded so far?"
                  value={draft.physio_notes}
                  onChange={(e) => setDraft({ ...draft, physio_notes: e.target.value })}
                  data-testid="physio-raise-review-notes"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-3.5">
              <Button variant="outline" onClick={() => setDraft(null)} data-testid="physio-raise-review-cancel">Cancel</Button>
              <Button className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={submitRaise} disabled={saving} data-testid="physio-raise-review-submit">
                {saving ? "Sending..." : "Send to Branch Admin"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {assessmentTarget && (
        <WeeklyAssessmentModal
          leadId={assessmentTarget.leadId}
          week={assessmentTarget.week}
          physioId={physioId}
          onClose={() => setAssessmentTarget(null)}
          onDone={() => setAssessmentTarget(null)}
        />
      )}
    </div>
  );
}

function ConsultationDetailModal({ lead, physioId, activeDate, onClose, onDone }) {
  const [submitting, setSubmitting] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [assessments, setAssessments] = useState([]);
  const [completeTarget, setCompleteTarget] = useState(null);
  const isComplete = lead.physio_stage === "Complete";

  const loadSessions = useCallback(async () => {
    try {
      const data = await physioSessions(lead.id);
      setSessions(data.sessions || []);
      setAssessments(data.assessments || []);
    } catch { /* silent */ }
  }, [lead.id]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  const markComplete = async () => {
    setSubmitting(true);
    try {
      const updated = await physioCompleteConsultation(lead.id, physioId);
      toast.success("Marked complete");
      onDone(updated);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to mark complete");
    }
    setSubmitting(false);
  };

  const todayIso = new Date().toISOString().slice(0, 10);
  // Next unpaid Treatment Fee installment on this client's record, if any.
  const paymentDue = ((lead.treatment_fee_payment_details?.installments) || [])
    .filter((i) => !i.paid)
    .sort((a, b) => (a.due_date || "").localeCompare(b.due_date || ""))[0] || null;
  const overdue = paymentDue && paymentDue.due_date < todayIso;

  const completedSessions = sessions.filter((s) => s.status === "completed");
  const upcomingSession = sessions.find((s) => s.status === "upcoming") || null;
  const lastCompleted = completedSessions[completedSessions.length - 1] || null;

  // Each week of days goes to the Head Physio for a review appointment; that review
  // is only "completed" once they've written it up (status flips to reviewed).
  const totalWeeks = sessions.length ? Math.max(...sessions.map((s) => s.week_number || 1)) : 0;
  const reviewedWeeks = assessments.filter((a) => a.status === "reviewed").length;
  const allReviewed = totalWeeks > 0 && reviewedWeeks >= totalWeeks;

  const fmtDate = (iso) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" }) : null);

  const Stat = ({ label, children }) => (
    <p className="text-sm">
      <span className="text-xs font-bold uppercase tracking-wider text-slate-400">{label}</span><br />
      {children}
    </p>
  );

  const Row = ({ label, value }) => (
    !value ? null : (
      <div>
        <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
        <p className="text-xs text-slate-700">{value}</p>
      </div>
    )
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-3xl overflow-hidden rounded-xl bg-white shadow-2xl max-h-[90vh] flex flex-col" data-testid="physio-consultation-detail-modal">
        <div className="flex items-start justify-between gap-3 bg-slate-500 px-6 py-4 text-white">
          <div className="min-w-0">
            <h3 className="text-lg font-bold">{lead.name}</h3>
            <p className="text-xs text-white/80">{lead.phone}{lead.email ? ` · ${lead.email}` : ""}</p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="whitespace-nowrap rounded-lg border-2 border-white/40 bg-white/15 px-3 py-1.5 text-sm font-bold">
              {completedSessions.length}/{sessions.length} days
            </span>
            <button type="button" onClick={onClose} className="rounded-full p-1.5 text-white/80 hover:bg-white/20"><X className="h-5 w-5" /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <div className="rounded-xl border-2 border-slate-200 bg-white p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Stat label="Physio">
                <span className="text-slate-700">{lead.assigned_physio_name || "—"}</span>
              </Stat>
              <Stat label="Time">
                <span className="font-semibold text-violet-700">{lead.appointment_time ? to12h(lead.appointment_time) : "—"}</span>
              </Stat>
              <Stat label="Payment Due">
                {paymentDue ? (
                  <span className={overdue ? "font-bold text-rose-600" : "font-bold text-amber-600"}>
                    Rs.{paymentDue.amount} · {fmtDate(paymentDue.due_date)}{overdue && " · OVERDUE"}
                  </span>
                ) : (
                  <span className="font-semibold text-emerald-600">Nothing due</span>
                )}
              </Stat>
              <Stat label="Upcoming">
                {upcomingSession ? (
                  <span className="font-semibold text-sky-700">
                    {fmtDate(upcomingSession.slot_time)} · {slotTo12h(upcomingSession.slot_time)}
                  </span>
                ) : (
                  <span className="text-slate-400">No future session booked</span>
                )}
              </Stat>
              <Stat label="Last Completed">
                {lastCompleted ? (
                  <span className="font-semibold text-emerald-600">
                    Day {lastCompleted.session_number} · {fmtDate(lastCompleted.completed_at || lastCompleted.slot_time)}
                  </span>
                ) : (
                  <span className="text-slate-400">None yet</span>
                )}
              </Stat>
              <Stat label="Stage">
                <span className="text-slate-700">{lead.physio_stage === "Complete" ? "Complete" : (lead.consultation_stage || "New Appointment")}</span>
              </Stat>
              <Stat label="Review Completed">
                {totalWeeks ? (
                  <span className={allReviewed ? "font-semibold text-emerald-600" : "font-semibold text-amber-600"}>
                    {reviewedWeeks} of {totalWeeks} week{totalWeeks === 1 ? "" : "s"}
                    {!allReviewed && " · awaiting Head Physio"}
                  </span>
                ) : (
                  <span className="text-slate-400">—</span>
                )}
              </Stat>
            </div>
          </div>

          {/* Treatment days — one row per booked session, completed in order */}
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
              Treatment Days {sessions.length > 0 && <span className="text-slate-400">({completedSessions.length} of {sessions.length} complete)</span>}
            </p>
            {sessions.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">
                No treatment days booked yet — Branch Admin assigns these once the Treatment Fee is collected.
              </div>
            ) : (
              <div className="space-y-2">
                {sessions.map((s) => {
                  const done = s.status === "completed";
                  // Only the day being viewed can be ticked off — a day is completed on
                  // the date it actually falls on, so the others stay read-only until
                  // their own date is picked in the strip behind this popup.
                  const isActiveDay = !activeDate || (s.slot_time || "").startsWith(activeDate);
                  return (
                    <div
                      key={s.id}
                      className={`flex items-center gap-3 rounded-lg border p-3 ${
                        done ? "border-emerald-200 bg-emerald-50/50"
                        : isActiveDay ? "border-sky-200 bg-sky-50/40"
                        : "border-slate-200 bg-white"
                      }`}
                      data-testid={`physio-treatment-day-${s.id}`}
                    >
                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${done ? "bg-emerald-200 text-emerald-800" : "bg-slate-100 text-slate-500"}`}>
                        {s.session_number}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-slate-700">Day {s.session_number} of {s.total_sessions} · Week {s.week_number}</p>
                        <p className="text-[10px] text-slate-400">
                          {s.slot_time ? `${fmtDate(s.slot_time)} at ${slotTo12h(s.slot_time)}` : "—"}
                        </p>
                        {s.jr_physio_remarks && <p className="mt-0.5 text-[10px] text-emerald-600">Remarks: {s.jr_physio_remarks}</p>}
                      </div>
                      {done ? (
                        <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-semibold text-emerald-700">Complete</span>
                      ) : isActiveDay ? (
                        <Button
                          size="sm"
                          className="shrink-0 bg-sky-600 text-xs text-white hover:bg-sky-700"
                          onClick={() => setCompleteTarget(s)}
                          data-testid={`physio-complete-day-${s.id}`}
                        >
                          <Check className="mr-1 h-3 w-3" /> Complete
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          disabled
                          className="shrink-0 bg-slate-100 text-xs text-slate-400 hover:bg-slate-100"
                          title={`Pick ${fmtDate(s.slot_time)} in the date strip to complete this day`}
                          data-testid={`physio-day-locked-${s.id}`}
                        >
                          <Check className="mr-1 h-3 w-3" /> Complete
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Row label="Alternative Phone" value={lead.alternative_phone} />
            <Row label="Address" value={lead.address} />
            <Row label="City / State" value={[lead.city, lead.state].filter(Boolean).join(", ")} />
            <Row label="Age" value={lead.age} />
            <Row label="Gender" value={lead.gender} />
            <Row label="Occupation" value={lead.occupation} />
            <Row label="Condition" value={lead.condition} />
            <Row label="Months of Pain" value={lead.months_of_pain} />
            <Row label="Appointment" value={lead.appointment_date ? `${lead.appointment_date}${lead.appointment_time ? ` · ${to12h(lead.appointment_time)}` : ""}` : null} />
          </div>

          {lead.diagnosis && (
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-slate-400">Pre-Sales Diagnosis</p>
              <p className="text-xs text-slate-700 whitespace-pre-wrap">{lead.diagnosis}</p>
            </div>
          )}
          {lead.physio_diagnosis_report && (
            <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
              <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-sky-500">Diagnosis Report</p>
              <p className="text-xs text-sky-900 whitespace-pre-wrap">{lead.physio_diagnosis_report}</p>
            </div>
          )}
          {lead.treatment_summary && (
            <div className="rounded-lg border border-violet-200 bg-violet-50 p-3">
              <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-violet-500">Treatment Summary</p>
              <p className="text-xs text-violet-900 whitespace-pre-wrap">{lead.treatment_summary}</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-6 py-3.5">
          <p className="text-[11px] text-slate-500">
            {activeDate
              ? "Only the day you opened can be completed — pick another date in the strip to complete that one."
              : "Completing a day sends that week's session to Review for a weekly write-up."}
          </p>
          <button
            type="button"
            onClick={markComplete}
            disabled={isComplete || submitting}
            className={`flex items-center gap-1.5 rounded-lg border px-4 py-2 text-xs font-semibold transition ${
              isComplete
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100"
            }`}
            data-testid="physio-consultation-complete"
          >
            <Check className="h-3.5 w-3.5" /> {isComplete ? "Complete" : submitting ? "Marking..." : "Mark Treatment Complete"}
          </button>
        </div>

        {completeTarget && (
          <CompleteSessionModal
            session={completeTarget}
            onClose={() => setCompleteTarget(null)}
            onDone={() => { setCompleteTarget(null); loadSessions(); }}
          />
        )}
      </div>
    </div>
  );
}

export function CalendarPage({ physioId, onClose }) {
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth() + 1);
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [data, setData] = useState({ sessions: [] });
  // Opens on today's date so the day detail panel doubles as the old "Today" tab —
  // no extra click needed to see today's sessions.
  const [selectedDate, setSelectedDate] = useState(() => {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  });

  const load = useCallback(async () => {
    try { setData(await physioCalendar(currentMonth, currentYear, physioId)); } catch { /* silent */ }
  }, [currentMonth, currentYear, physioId]);

  useEffect(() => { load(); }, [load]);

  const monthNames = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
  const firstDay = new Date(currentYear, currentMonth - 1, 1).getDay();

  const dateStr = (day) => `${currentYear}-${String(currentMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const getSessionsForDay = (day) => {
    const d = dateStr(day);
    return (data.sessions || []).filter((s) => s.slot_time?.startsWith(d));
  };

  const prevMonth = () => { if (currentMonth === 1) { setCurrentMonth(12); setCurrentYear(currentYear - 1); } else setCurrentMonth(currentMonth - 1); };
  const nextMonth = () => { if (currentMonth === 12) { setCurrentMonth(1); setCurrentYear(currentYear + 1); } else setCurrentMonth(currentMonth + 1); };

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const daySessions = selectedDate ? (data.sessions || []).filter((s) => s.slot_time?.startsWith(selectedDate)) : [];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white" data-testid="physio-calendar-page">
      <div className="flex items-center gap-2 border-b border-slate-200 p-4">
        <button type="button" onClick={onClose} className="rounded p-1.5 text-slate-500 hover:bg-slate-100" data-testid="physio-calendar-back">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h2 className="text-sm font-semibold text-slate-800">My Calendar</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex flex-col gap-4 sm:flex-row">
          {/* Calendar Grid */}
          <div className="flex-1 rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between mb-4">
              <button type="button" onClick={prevMonth} className="p-1 rounded hover:bg-slate-100"><ChevronLeft className="h-4 w-4" /></button>
              <h4 className="text-sm font-semibold text-slate-700">{monthNames[currentMonth]} {currentYear}</h4>
              <button type="button" onClick={nextMonth} className="p-1 rounded hover:bg-slate-100"><ChevronRight className="h-4 w-4" /></button>
            </div>
            <div className="grid grid-cols-7 gap-1 mb-2">
              {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                <div key={d} className="text-center text-[10px] font-semibold text-slate-400 py-1">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: firstDay }, (_, i) => <div key={`e-${i}`} className="h-14 sm:h-16" />)}
              {Array.from({ length: daysInMonth }, (_, i) => {
                const day = i + 1;
                const d = dateStr(day);
                const isToday = d === todayStr;
                const isSelected = d === selectedDate;
                const sessions = getSessionsForDay(day);
                const hasCompleted = sessions.some((s) => s.status === "completed");
                const hasUpcoming = sessions.some((s) => s.status === "upcoming");

                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => setSelectedDate(d)}
                    className={`h-14 sm:h-16 rounded-lg text-xs font-medium p-1 flex flex-col items-center transition-all ${
                      isSelected ? "bg-sky-600 text-white" :
                      isToday ? "bg-sky-50 text-sky-700 border border-sky-200" :
                      "hover:bg-slate-50 text-slate-600"
                    }`}
                  >
                    <span>{day}</span>
                    {sessions.length > 0 && (
                      <div className="flex gap-0.5 mt-auto">
                        {hasUpcoming && <span className={`h-1.5 w-1.5 rounded-full ${isSelected ? "bg-white" : "bg-sky-400"}`} />}
                        {hasCompleted && <span className={`h-1.5 w-1.5 rounded-full ${isSelected ? "bg-white/60" : "bg-emerald-400"}`} />}
                        <span className={`text-[8px] ${isSelected ? "text-white/80" : "text-slate-400"}`}>{sessions.length}</span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Day Detail */}
          <div className="w-full sm:w-80 rounded-xl border border-slate-200 bg-white p-4 overflow-y-auto sm:max-h-[600px]">
            {!selectedDate ? (
              <div className="flex items-center justify-center h-32 sm:h-48">
                <div className="text-center">
                  <Calendar className="h-8 w-8 text-slate-200 mx-auto mb-2" />
                  <p className="text-xs text-slate-400">Select a date</p>
                </div>
              </div>
            ) : (
              <>
                <h4 className="text-sm font-semibold text-slate-700 mb-3">
                  {new Date(selectedDate + "T00:00").toLocaleDateString("en-IN", { weekday: "long", month: "short", day: "numeric" })}
                </h4>
                {daySessions.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-6">No sessions</p>
                ) : (
                  <div className="space-y-2">
                    {daySessions.map((s) => (
                      <div key={s.id} className={`rounded-lg border p-3 ${s.status === "completed" ? "border-emerald-200 bg-emerald-50" : "border-slate-200"}`}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-semibold text-slate-700">{slotTo12h(s.slot_time)}</span>
                          <span className={`text-[9px] rounded-full px-1.5 py-0.5 font-semibold ${s.status === "completed" ? "bg-emerald-100 text-emerald-700" : "bg-sky-100 text-sky-700"}`}>
                            {s.status}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600">{s.lead_name}</p>
                        <p className="text-[9px] text-slate-400">#{s.session_number} · W{s.week_number}</p>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PatientsTab({ physioId }) {
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [historyTab, setHistoryTab] = useState("ongoing");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await physioPatients(physioId);
      setPatients(data.patients || []);
    } catch { /* silent */ }
    setLoading(false);
  }, [physioId]);

  useEffect(() => { load(); }, [load]);

  const isCompleted = (p) => p.physio_stage === "Complete";
  const ongoingCount = patients.filter((p) => !isCompleted(p)).length;
  const completedCount = patients.filter(isCompleted).length;
  const visiblePatients = patients.filter((p) => (historyTab === "completed" ? isCompleted(p) : !isCompleted(p)));

  return (
    <div data-testid="physio-patients-tab">
      <div className="mb-4 flex gap-1 rounded-lg border border-slate-200 bg-white p-1 w-fit">
        {[{ key: "ongoing", label: "Ongoing", count: ongoingCount }, { key: "completed", label: "Completed", count: completedCount }].map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setHistoryTab(t.key)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
              historyTab === t.key ? "bg-sky-100 text-sky-700" : "text-slate-500 hover:bg-slate-50"
            }`}
            data-testid={`physio-history-subtab-${t.key}`}
          >
            {t.label} <span className="text-[10px] text-slate-400">({t.count})</span>
          </button>
        ))}
      </div>

      {visiblePatients.length === 0 && !loading ? (
        <div className="text-center py-16">
          <Users className="h-10 w-10 text-slate-200 mx-auto mb-3" />
          <p className="text-sm text-slate-400">{historyTab === "completed" ? "No completed patients yet" : "No patients assigned yet"}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visiblePatients.map((p) => (
            <div key={p.lead_id} className="rounded-xl border border-slate-200 bg-white p-4 hover:shadow-sm transition-shadow" data-testid={`physio-patient-${p.lead_id}`}>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sm font-bold text-sky-700">
                  {p.lead_name?.charAt(0)?.toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800">{p.lead_name}</p>
                  <p className="truncate text-[10px] text-slate-400">{p.phone} · {p.package_weeks || "?"} weeks program</p>
                </div>
                <Button size="sm" variant="outline" className="shrink-0 text-xs" onClick={() => setSelectedPatient(p)} data-testid={`physio-view-patient-${p.lead_id}`}>
                  <ClipboardList className="h-3 w-3 sm:mr-1" /> <span className="hidden sm:inline">Details</span>
                </Button>
              </div>
              <div className="mt-3 flex items-center justify-around rounded-lg bg-slate-50 py-2 text-center sm:justify-start sm:gap-6 sm:bg-transparent sm:py-0">
                <div>
                  <p className="text-base font-bold text-emerald-600">{p.completed_sessions}</p>
                  <p className="text-[9px] text-slate-400">Done</p>
                </div>
                <div>
                  <p className="text-base font-bold text-sky-600">{p.remaining_sessions}</p>
                  <p className="text-[9px] text-slate-400">Left</p>
                </div>
                <div>
                  <p className="text-base font-bold text-slate-600">{p.total_sessions}</p>
                  <p className="text-[9px] text-slate-400">Total</p>
                </div>
              </div>
              {/* Progress bar */}
              <div className="mt-3 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-sky-400 to-emerald-400 transition-all"
                  style={{ width: `${p.total_sessions > 0 ? (p.completed_sessions / p.total_sessions) * 100 : 0}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedPatient && (
        <PatientDetailModal
          patient={selectedPatient}
          physioId={physioId}
          onClose={() => setSelectedPatient(null)}
          onRefresh={load}
        />
      )}
    </div>
  );
}

function PatientDetailModal({ patient, physioId, onClose, onRefresh }) {
  const [sessions, setSessions] = useState([]);
  const [assessments, setAssessments] = useState([]);
  const [detailTab, setDetailTab] = useState("sessions");
  const [completeModal, setCompleteModal] = useState(null);
  const [assessmentWeek, setAssessmentWeek] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await physioSessions(patient.lead_id);
      setSessions(data.sessions || []);
      setAssessments(data.assessments || []);
    } catch { /* silent */ }
  }, [patient.lead_id]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-3xl rounded-xl bg-white shadow-2xl max-h-[85vh] flex flex-col" data-testid="patient-detail-modal">
        <div className="flex items-center justify-between border-b p-5">
          <div>
            <h3 className="text-base font-semibold text-slate-800">{patient.lead_name}</h3>
            <p className="text-[10px] text-slate-400">{patient.completed_sessions}/{patient.total_sessions} completed · {patient.package_weeks || "?"} weeks</p>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X className="h-5 w-5 text-slate-400" /></button>
        </div>

        <div className="flex gap-1 px-5 pt-3">
          {[{ key: "sessions", label: "Sessions" }, { key: "assessments", label: "Weekly Assessments" }].map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setDetailTab(t.key)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                detailTab === t.key ? "bg-sky-100 text-sky-700" : "text-slate-400 hover:bg-slate-50"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {detailTab === "sessions" && (
            <div className="space-y-2">
              {sessions.map((s) => (
                <div key={s.id} className={`rounded-lg border p-3 flex items-center gap-3 ${s.status === "completed" ? "border-emerald-200 bg-emerald-50/50" : "border-slate-200"}`}>
                  <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold ${s.status === "completed" ? "bg-emerald-200 text-emerald-800" : "bg-slate-100 text-slate-500"}`}>
                    {s.session_number}
                  </div>
                  <div className="flex-1">
                    <p className="text-xs font-medium text-slate-700">Session #{s.session_number} · Week {s.week_number}</p>
                    <p className="text-[10px] text-slate-400">{s.slot_time ? `${s.slot_time.split("T")[0]} at ${slotTo12h(s.slot_time)}` : "—"}</p>
                    {s.jr_physio_remarks && <p className="text-[10px] text-emerald-600 mt-0.5">Remarks: {s.jr_physio_remarks}</p>}
                  </div>
                  {s.status === "upcoming" ? (
                    <Button size="sm" className="bg-sky-600 hover:bg-sky-700 text-white text-xs" onClick={() => setCompleteModal(s)}>
                      <Check className="h-3 w-3 mr-1" /> Complete
                    </Button>
                  ) : (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-semibold text-emerald-700">Done</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {detailTab === "assessments" && (
            <div className="space-y-3">
              {Array.from({ length: patient.package_weeks || 1 }, (_, i) => {
                const week = i + 1;
                const existing = assessments.find((a) => a.week_number === week);
                return (
                  <div key={week} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-slate-700">Week {week}</p>
                      {existing ? (
                        <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${
                          existing.status === "reviewed" ? "bg-teal-100 text-teal-700" :
                          "bg-amber-100 text-amber-700"
                        }`}>{existing.status}</span>
                      ) : (
                        <Button size="sm" variant="outline" className="text-[10px] h-6" onClick={() => setAssessmentWeek(week)}>
                          <Send className="h-3 w-3 mr-1" /> Submit
                        </Button>
                      )}
                    </div>
                    {existing?.jr_physio_notes && (
                      <div className="rounded bg-sky-50 p-2 mb-1">
                        <p className="text-[9px] font-semibold text-sky-500 uppercase">Your Notes</p>
                        <p className="text-xs text-sky-800">{existing.jr_physio_notes}</p>
                      </div>
                    )}
                    {existing?.head_physio_notes && (
                      <div className="rounded bg-teal-50 p-2">
                        <p className="text-[9px] font-semibold text-teal-500 uppercase">Head Physio Feedback</p>
                        <p className="text-xs text-teal-800">{existing.head_physio_notes}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {completeModal && (
          <CompleteSessionModal
            session={completeModal}
            onClose={() => setCompleteModal(null)}
            onDone={() => { setCompleteModal(null); load(); onRefresh(); }}
          />
        )}

        {assessmentWeek && (
          <WeeklyAssessmentModal
            leadId={patient.lead_id}
            week={assessmentWeek}
            physioId={physioId}
            onClose={() => setAssessmentWeek(null)}
            onDone={() => { setAssessmentWeek(null); load(); }}
          />
        )}
      </div>
    </div>
  );
}

function CompleteSessionModal({ session, onClose, onDone }) {
  const [remarks, setRemarks] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!remarks.trim()) { toast.error("Please add remarks"); return; }
    setSubmitting(true);
    try {
      await physioCompleteSession(session.id, { remarks });
      toast.success("Session completed");
      onDone();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed");
    }
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl" data-testid="complete-session-modal">
        <div className="border-b p-5">
          <h3 className="text-base font-semibold text-slate-800">Complete Session #{session.session_number}</h3>
          <p className="text-[10px] text-slate-400">{session.lead_name} · {session.slot_time ? `${session.slot_time.split("T")[0]} at ${slotTo12h(session.slot_time)}` : "—"}</p>
        </div>
        <div className="p-5">
          <label className="text-xs font-medium text-slate-600 mb-1 block">Session Remarks (visible to patient)</label>
          <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={4} placeholder="Exercises done, observations, next steps..." className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" data-testid="session-remarks" />
        </div>
        <div className="flex justify-end gap-2 border-t p-4">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSubmit} disabled={submitting} className="bg-sky-600 hover:bg-sky-700 text-white" data-testid="session-complete-submit">
            {submitting ? "Completing..." : "Mark Complete"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function WeeklyAssessmentModal({ leadId, week, physioId, onClose, onDone }) {
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!notes.trim()) { toast.error("Please add notes"); return; }
    setSubmitting(true);
    try {
      await physioWeeklyAssessment(leadId, week, { jr_physio_notes: notes }, physioId);
      toast.success("Assessment submitted");
      onDone();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed");
    }
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl" data-testid="weekly-assessment-modal">
        <div className="border-b p-5">
          <h3 className="text-base font-semibold text-slate-800">Week {week} Assessment</h3>
        </div>
        <div className="p-5">
          <label className="text-xs font-medium text-slate-600 mb-1 block">Your Notes (visible to patient)</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} placeholder="Progress, observations, patient feedback..." className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" data-testid="assessment-notes" />
        </div>
        <div className="flex justify-end gap-2 border-t p-4">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSubmit} disabled={submitting} className="bg-sky-600 hover:bg-sky-700 text-white" data-testid="assessment-submit">
            {submitting ? "Submitting..." : "Submit Assessment"}
          </Button>
        </div>
      </div>
    </div>
  );
}
