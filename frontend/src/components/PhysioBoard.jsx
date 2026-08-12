import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  Calendar,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Eye,
  FileText,
  PhoneCall,
  Search,
  Send,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { DateFilterPopover } from "@/components/DateFilterPopover";
import { StatTile } from "@/components/ui/stat-tile";
import {
  physioConsultations,
  physioCompleteConsultation,
  physioCalendar,
  physioPatients,
  physioPatientDetail,
  physioSessions,
  physioCompleteSession,
  physioWeeklyAssessment,
  physioReviews,
  physioRaiseReview,
  leadDocuments,
  openLeadDocument,
} from "@/lib/api";
import { to12h, slotTo12h } from "@/lib/time";

// The board's three views, rendered twice: an underlined strip along the top on a
// desk, a fixed bar at the bottom on a phone. Treatment and Patients keep their old
// icons; Review takes the slot Calendar used to hold — Calendar moved to the
// top-right page button instead, alongside Profile on the top-left.
const VIEW_TABS = [
  { key: "treatment", label: "Treatment", icon: ClipboardList },
  { key: "review", label: "Review", icon: ClipboardCheck },
  { key: "patients", label: "Patients", icon: Users },
];

export const PhysioBoard = ({ physioId } = {}) => {
  const [activeTab, setActiveTab] = useState("treatment");
  // Counts shown on both switchers — every one of them is what's still
  // outstanding, so it counts down as the physio works through it rather than
  // holding at a fixed total: Treatment is today's pending sessions/appointments
  // (the date filter defaults to Today already), Review is patients newly due (drops
  // off the moment one is raised), Patients is who's still ongoing. All three tabs
  // stay mounted (hidden via CSS, not unmounted) so every badge stays live even
  // while another tab is the one showing.
  const [treatmentCount, setTreatmentCount] = useState(0);
  const [reviewCount, setReviewCount] = useState(0);
  const [patientsCount, setPatientsCount] = useState(0);
  const badgeFor = { treatment: treatmentCount, review: reviewCount, patients: patientsCount };

  // Where the open tab's search and date filter render. A callback ref rather than
  // useRef: the node has to arrive as state so the tabs re-render once it exists,
  // otherwise the first paint sees null and nothing ever portals in.
  const [toolbarSlot, setToolbarSlot] = useState(null);
  // Only the tab on screen gets the slot. All three stay mounted, so handing it to
  // every tab would stack three toolbars in the one row.
  const slotFor = (key) => (activeTab === key ? toolbarSlot : null);

  return (
    <div className="space-y-3 pb-20 md:pb-0" data-testid="physio-board-root">
      {/* Tabs on the left, the open tab's search and date filter on the right. The
          strip is desk-only — a phone gets the fixed bar at the end of this file —
          but the toolbar slot is not, so on a phone this row is just the toolbar,
          which is why the border and the tab baseline are both md-only.

          The filled-pill tabs Human Resource uses, so moving between boards doesn't
          mean learning a second way to switch view. The counts come along rather
          than being dropped on desktop: an outstanding count is the reason to look
          at a tab you aren't already on — on the selected pill it goes white-on-indigo,
          since a slate badge on a filled tab reads as disabled. */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-4 md:border-b md:border-slate-200 md:pb-2" data-testid="physio-view-bar">
      <div className="hidden flex-wrap items-center gap-2 overflow-x-auto md:flex" data-testid="physio-view-tabs">
        {VIEW_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.key;
          const count = badgeFor[tab.key] || 0;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              aria-current={active ? "page" : undefined}
              className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition ${
                active ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
              data-testid={`physio-view-tab-${tab.key}`}
            >
              <Icon className="h-4 w-4" /> {tab.label}
              {count > 0 && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${active ? "bg-white/25 text-white" : "bg-slate-100 text-slate-500"}`}
                  data-testid={`physio-view-tab-badge-${tab.key}`}
                >
                  {count > 99 ? "99+" : count}
                </span>
              )}
            </button>
          );
        })}
      </div>
        <div ref={setToolbarSlot} className="flex flex-wrap items-center gap-2 md:pb-1.5" data-testid="physio-view-toolbar" />
      </div>

      <div style={{ display: activeTab === "treatment" ? "block" : "none" }}>
        <TreatmentTab physioId={physioId} onCountChange={setTreatmentCount} toolbarSlot={slotFor("treatment")} />
      </div>
      <div style={{ display: activeTab === "review" ? "block" : "none" }}>
        <ReviewTab physioId={physioId} onCountChange={setReviewCount} toolbarSlot={slotFor("review")} />
      </div>
      <div style={{ display: activeTab === "patients" ? "block" : "none" }}>
        <PatientsTab physioId={physioId} onCountChange={setPatientsCount} />
      </div>

      {/* Phones only. It used to render at every width, so a desk got a bar pinned
          across the bottom of the window for a switcher that belongs at the top. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden" data-testid="physio-bottom-nav">
        <div className="mx-auto flex max-w-lg items-stretch justify-around">
          {VIEW_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            const count = badgeFor[tab.key] || 0;
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
                <span className="relative">
                  <Icon className="h-5 w-5" />
                  {count > 0 && (
                    <span
                      className="absolute -right-2 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold leading-none text-white"
                      data-testid={`physio-bottom-tab-badge-${tab.key}`}
                    >
                      {count > 99 ? "99+" : count}
                    </span>
                  )}
                </span>
                {tab.label}
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

/** A stored phone in E.164 for wa.me, which takes digits only — no +, spaces or the
 *  "p:" prefix some records carry. A bare 10-digit number is assumed Indian, matching
 *  every other number in the system; anything already carrying a country code is left
 *  alone. Returns "" when there's nothing dialable, so the button can hide itself. */
const waNumber = (raw) => {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  return digits;
};

/** lucide has no WhatsApp glyph and the brand mark can't be approximated with a generic
 *  chat bubble — staff scan for this exact shape. */
const WhatsAppIcon = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884M20.52 3.449C18.24 1.245 15.24.03 12.045 0c-6.472 0-11.734 5.262-11.736 11.735a11.7 11.7 0 001.567 5.87L.057 24l6.607-1.732a11.7 11.7 0 005.376 1.37h.005c6.472 0 11.734-5.262 11.735-11.734a11.68 11.68 0 00-3.26-8.457" />
  </svg>
);

// Tile colours. The money boards give every card its own hex and read it back for the
// figure, the corner disc and the selected ring, so the colour is the card's identity
// rather than decoration. Naming them here keeps one meaning per colour across the three
// places this board shows tiles — pending is amber wherever it appears.
const TILE = {
  total: "#0284c7",
  done: "#059669",
  pending: "#d97706",
  review: "#7c3aed",
  request: "#db2777",
};

// Every 7th treatment day is a review milestone — reviewsSoFar counts how many the patient
// has already passed, isReviewDay flags this one as the next. One definition because the
// phone list and the desktop table both draw the violet from it, and two copies of the
// arithmetic is two chances for a row to say "Review Today" in one layout and not the other.
const reviewMarks = (r) => ({
  reviewsSoFar: r.sessionNumber ? Math.floor(r.sessionNumber / 7) : 0,
  isReviewDay: r.sessionNumber > 0 && r.sessionNumber % 7 === 0,
});

const MODAL_TABS = [
  { key: "overview", label: "Overview" },
  { key: "report", label: "Consultation Report" },
  { key: "days", label: "Treatment Days" },
  { key: "documents", label: "Documents" },
];

const docSize = (n) => {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * The patient's uploaded records, read-only.
 *
 * A physio is in READ_ROLES but not WRITE_ROLES on the documents router, so this lists and
 * opens and offers nothing else — no upload, no delete, no share toggle. Putting buttons
 * here that the API would reject is worse than not having them.
 *
 * Bytes come back as an authenticated blob rather than a static URL, so opening one means
 * fetching it first. The object URL is revoked on a timer instead of immediately: revoking
 * it in the same tick closes the tab that was just handed it.
 */
const DocumentsPanel = ({ leadId }) => {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(null);

  useEffect(() => {
    let alive = true;
    if (!leadId) return undefined;
    setLoading(true);
    leadDocuments(leadId)
      .then((r) => { if (alive) setDocs(r.documents || []); })
      .catch(() => { if (alive) setDocs([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [leadId]);

  const view = async (doc) => {
    setOpening(doc.id);
    try {
      const url = await openLeadDocument(leadId, doc.id);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      toast.error("Could not open that document");
    } finally {
      setOpening(null);
    }
  };

  return (
    <div data-testid="physio-documents-panel">
      <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
        Documents {docs.length > 0 && <span className="text-slate-400">({docs.length})</span>}
      </p>
      {loading ? (
        <div className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">Loading documents…</div>
      ) : docs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">No documents uploaded for this patient</div>
      ) : (
        <div className="space-y-2">
          {docs.map((d) => (
            <div
              key={d.id}
              className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-2.5"
              data-testid={`physio-document-${d.id}`}
            >
              <FileText className="h-4 w-4 shrink-0 text-sky-500" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-slate-700">{d.label || d.original_name || "Document"}</p>
                <p className="text-[10px] text-slate-400">
                  {[d.kind, d.size_bytes ? docSize(d.size_bytes) : null, d.created_at ? String(d.created_at).slice(0, 10) : null]
                    .filter(Boolean).join(" · ")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => view(d)}
                disabled={opening === d.id}
                className="flex shrink-0 items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-[11px] font-semibold text-sky-700 transition hover:bg-sky-100 disabled:opacity-50"
                data-testid={`physio-document-view-${d.id}`}
              >
                <Eye className="h-3.5 w-3.5" /> {opening === d.id ? "Opening…" : "View"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

function TreatmentTab({ physioId, onCountChange, toolbarSlot }) {
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

  // Badge is what's still outstanding today, not the whole day's total — it counts
  // down to 0 as each session/appointment gets marked complete.
  useEffect(() => { onCountChange?.(filterStats.pending); }, [filterStats.pending, onCountChange]);

  const [searchOpen, setSearchOpen] = useState(false);

  // Icon-only search that expands on tap, plus the Meta-style date filter. Rendered
  // into the board's tab row rather than here, so on a desk it sits beside the tabs
  // instead of below the summary. Portaled rather than lifted into the board so this
  // tab keeps its own search text and date range — Review has its own pair, and one
  // shared filter would let a range picked over there silently narrow this tab.
  //
  // When nothing's picked the summary above shows Overall; the week strip below
  // always keeps today selected by default regardless.
  const toolbar = (
    <div className="flex flex-wrap items-center gap-2" data-testid="physio-treatment-toolbar">
      {searchOpen ? (
        <div className="relative w-full sm:w-[240px]">
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
      <DateFilterPopover value={filterValue} onChange={handleFilterChange} testid="physio-treatment-date-filter" centered iconOnly />
    </div>
  );

  return (
    <div data-testid="physio-treatment-tab">
      {/* The tinted panel these sat in is gone — the Head Physio cards sit straight on
          the page, and boxing the same cards here made two identical controls look like
          two different ones. The heading stays: it names the range the counts answer to. */}
      <div className="mb-4" data-testid="physio-treatment-summary">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">{filterValue ? filterValue.label : "Overall Treatment"}</p>
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <StatTile
            icon={Calendar} label="Total Days" value={filterStats.total} color={TILE.total}
            onClick={() => setRowFilter("all")} active={rowFilter === "all"} testid="physio-stat-total"
          />
          <StatTile
            icon={CheckCircle2} label="Completed" value={filterStats.completed} color={TILE.done}
            sub={filterStats.total ? `${Math.round((filterStats.completed / filterStats.total) * 100)}% done` : null}
            onClick={() => setRowFilter(rowFilter === "completed" ? "all" : "completed")} active={rowFilter === "completed"} testid="physio-stat-completed"
          />
          <StatTile
            icon={Clock} label="Pending" value={filterStats.pending} sub="Days left" color={TILE.pending}
            onClick={() => setRowFilter(rowFilter === "pending" ? "all" : "pending")} active={rowFilter === "pending"} testid="physio-stat-pending"
          />
        </div>
      </div>

      {toolbarSlot ? createPortal(toolbar, toolbarSlot) : toolbar}

      {/* Sun-Sat week strip — today is always the default selection.
          Kept deliberately short: this is a date picker sitting between the summary and
          the day's list, and at its old height it pushed the first patient below the fold
          on a laptop. The month line and the day cells both lost their spare padding. */}
      <div className="mb-3 rounded-xl border border-slate-200 bg-white px-3 py-2" data-testid="physio-treatment-week-strip">
        <div className="mb-1 flex items-center justify-between">
          <button type="button" onClick={() => setWeekAnchor((a) => shiftIso(a, -7))} className="rounded p-0.5 text-slate-400 hover:bg-slate-100" data-testid="physio-week-prev">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <p className="text-[11px] font-semibold text-slate-600">
            {new Date(`${weekAnchor}T00:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
          </p>
          <button type="button" onClick={() => setWeekAnchor((a) => shiftIso(a, 7))} className="rounded p-0.5 text-slate-400 hover:bg-slate-100" data-testid="physio-week-next">
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
                className={`flex flex-col items-center gap-0.5 rounded-lg py-1 transition ${isSelected ? "bg-sky-600" : "hover:bg-slate-50"}`}
                data-testid={`physio-day-${date}`}
              >
                <span className={`text-[9px] font-semibold ${isSelected ? "text-sky-100" : "text-slate-400"}`}>{DAY_LETTERS[i]}</span>
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                    isSelected ? "bg-white/20 text-white" : isToday ? "bg-sky-100 text-sky-700" : "text-slate-600"
                  }`}
                >
                  {day}
                </span>
                {n > 0 && <span className={`text-[9px] font-medium leading-none ${isSelected ? "text-sky-100" : "text-slate-400"}`}>{n}</span>}
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
        <>
          {/* Cards on a phone, table from sm up — the same two-mode list Human Resource
              uses for its candidates. A table is the right shape for scanning a day of
              appointments down a column, but eight columns on a 375px screen is a
              horizontal scrollbar and nothing readable, so the phone keeps the row. */}
          <div className="space-y-2 sm:hidden" data-testid="physio-treatment-list-mobile">
            {visibleRows.map((r) => {
              const l = r.lead;
              const clickable = l?.phone !== undefined;
              const { reviewsSoFar, isReviewDay } = reviewMarks(r);
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

          <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white sm:block" data-testid="physio-treatment-list-desktop">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Time</th>
                    <th className="px-4 py-2.5 font-semibold">Patient</th>
                    <th className="px-4 py-2.5 font-semibold">Day</th>
                    <th className="px-4 py-2.5 font-semibold">Reviews</th>
                    <th className="px-4 py-2.5 font-semibold">Status</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleRows.map((r) => {
                    const l = r.lead;
                    const clickable = l?.phone !== undefined;
                    const { reviewsSoFar, isReviewDay } = reviewMarks(r);
                    return (
                      <tr
                        key={r.key}
                        onClick={() => clickable && setSelectedLead(l)}
                        // The done/review tint stays on the row. It is how a physio picks
                        // out what is left to do without reading the Status column, and
                        // dropping it was the one thing the table could not afford to lose.
                        className={`${clickable ? "cursor-pointer" : "cursor-default"} ${
                          r.done ? "bg-emerald-50/50 hover:bg-emerald-50" : isReviewDay ? "bg-violet-50/40 hover:bg-violet-50" : "hover:bg-slate-50"
                        }`}
                        data-testid={`treatment-row-${r.key}`}
                      >
                        <td className="px-4 py-3">
                          <span className={`inline-flex whitespace-nowrap rounded-lg px-2 py-1 text-[11px] font-bold ${r.done ? "bg-emerald-200 text-emerald-800" : "bg-sky-100 text-sky-700"}`}>
                            {r.time ? to12h(r.time) : "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-800">{l.name}</p>
                          {l.phone ? <p className="text-[11px] text-slate-400">{l.phone}</p> : null}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {r.sessionNumber
                            ? <span className="whitespace-nowrap">{String(r.sessionNumber).padStart(2, "0")}/{r.totalSessions}</span>
                            : <span className="text-slate-400">{r.label}</span>}
                        </td>
                        <td className="px-4 py-3">
                          {r.sessionNumber ? (
                            <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ${reviewsSoFar > 0 ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-400"}`}>
                              {reviewsSoFar} Review{reviewsSoFar === 1 ? "" : "s"}
                            </span>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          {r.done ? (
                            <span className="inline-flex whitespace-nowrap rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Done</span>
                          ) : isReviewDay ? (
                            <span className="inline-flex whitespace-nowrap rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-semibold text-white">Review Today</span>
                          ) : (
                            <span className="inline-flex whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Pending</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <ChevronRight className="ml-auto h-4 w-4 text-slate-300" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
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

// In pipeline order, earliest first. "Not Due" exists because bucketOf() has always
// returned it for patients short of their next milestone, but there was no tab to reach
// them through — so Total counted five patients while the tabs between them showed one,
// which read as the review flow being broken when it was working correctly.
const REVIEW_TABS = [
  { key: "not_due", label: "Not Due", icon: Clock, color: TILE.pending },
  { key: "new_review", label: "New Review", icon: ClipboardCheck, color: TILE.review },
  { key: "requests", label: "Requests", icon: Send, color: TILE.request },
  { key: "assigned", label: "Assigned", icon: Users, color: TILE.total },
  { key: "completed", label: "Completed", icon: CheckCircle2, color: TILE.done },
];

const ordinal = (n) => {
  const v = n % 100;
  const suffix = v >= 11 && v <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th";
  return `${n}${suffix}`;
};

/**
 * Review — the Physio's end of the post-treatment review chain, in one place.
 *
 * A new review only becomes raisable every 7 completed sessions — 7, 14, 21, 28... —
 * not "7 or more"; a 28-session package gets exactly 4 review points. New Review shows only
 * patients who've just reached one and don't already have one in flight or covering it,
 * computed server-side (_review_eligibility in v3_reviews.py) so raising one is rejected
 * the same way if attempted outside that window.
 *
 * Raising a review is what starts the chain: it lands with the Branch Admin, who
 * dispatches it to a named Head Physio, who writes it up. Requests / Assigned / Completed
 * follow a patient along that hand-off, and the weekly write-up hangs off the same rows.
 */
function ReviewTab({ physioId, onCountChange, toolbarSlot }) {
  const [patients, setPatients] = useState([]);
  const [threshold, setThreshold] = useState(7);
  const [loading, setLoading] = useState(false);
  const [bucket, setBucket] = useState("new_review");
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [filterValue, setFilterValue] = useState(null);
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
    // The notes are the whole point of the hand-off: the Head Physio writes their review
    // off the back of what the treating physio observed. A review raised without them
    // arrives as a name and a reason, which is not enough to review anything.
    if (!draft.physio_notes.trim()) {
      toast.error("Add your notes for the Head Physio — they can't review the patient without them");
      return;
    }
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

  // Who currently holds the review. due_for_review (server-computed) means a fresh
  // 7-day milestone is reached and nothing is blocking a new one — that's New Review.
  const bucketOf = (p) => {
    if (p.review_status === "completed") return "completed";
    if (p.review_status === "sent") return "assigned";
    if (p.review_status === "send_to_review") return "requests";
    return p.due_for_review ? "new_review" : "not_due";
  };

  // Date filter narrows the whole tab, not just the final list — the Total pill and
  // every bucket's count on the tabs below are computed from this, not from `patients`.
  const dateFiltered = useMemo(() => {
    if (!filterValue) return patients;
    const fromIso = isoOf(filterValue.from);
    const toIso = isoOf(filterValue.to);
    return patients.filter((p) => {
      const d = p.first_session_date || "";
      return d && d >= fromIso && d <= toIso;
    });
  }, [patients, filterValue]);

  const counts = useMemo(() => {
    const c = { not_due: 0, new_review: 0, requests: 0, assigned: 0, completed: 0 };
    dateFiltered.forEach((p) => { const b = bucketOf(p); if (b in c) c[b] += 1; });
    return c;
  }, [dateFiltered]);

  // Nav badge reflects every patient newly due, regardless of whatever date filter
  // is currently narrowing the tab's own view.
  const newReviewTotal = useMemo(() => patients.filter((p) => bucketOf(p) === "new_review").length, [patients]);
  useEffect(() => { onCountChange?.(newReviewTotal); }, [newReviewTotal, onCountChange]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return dateFiltered.filter((p) => {
      if (bucketOf(p) !== bucket) return false;
      if (q && !(
        (p.lead_name || "").toLowerCase().includes(q)
        || (p.phone || "").toLowerCase().includes(q)
        || (p.patient_number || "").toLowerCase().includes(q)
      )) return false;
      return true;
    });
  }, [dateFiltered, bucket, search]);

  const STATUS_BADGE = {
    completed: { label: "Review Completed", cls: "bg-emerald-100 text-emerald-700" },
    sent: { label: "With Head Physio", cls: "bg-violet-100 text-violet-700" },
    send_to_review: { label: "With Branch Admin", cls: "bg-sky-100 text-sky-700" },
  };

  const EMPTY_TEXT = {
    not_due: "Every patient is either due a review or already in one",
    new_review: "No one has reached a new review milestone yet",
    requests: "No requests waiting on the Branch Admin",
    assigned: "No reviews assigned to a Head Physio",
    completed: "No completed reviews yet",
  };

  // Icon-only search, the Meta-style date filter, and a small Total pill next to it —
  // everything the bucket cards below read from is filtered by this date range first,
  // so Total and every bucket count move together. Rendered into the board's tab row;
  // see the note on TreatmentTab's toolbar for why it's portaled rather than lifted.
  const toolbar = (
    <div className="flex flex-wrap items-center gap-2" data-testid="physio-review-toolbar">
      {searchOpen ? (
        <div className="relative w-full sm:w-[240px]">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search patient by name, phone or patient no..."
            className="h-10 pl-9 pr-9"
            data-testid="physio-review-search"
          />
          <button
            type="button"
            onClick={() => { setSearchOpen(false); setSearch(""); }}
            className="absolute right-2 top-2 rounded p-1 text-slate-400 hover:bg-slate-100"
            data-testid="physio-review-search-close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
          data-testid="physio-review-search-open"
        >
          <Search className="h-4 w-4" />
        </button>
      )}
      <DateFilterPopover value={filterValue} onChange={setFilterValue} testid="physio-review-date-filter" centered iconOnly />
      <div className="flex h-10 shrink-0 items-center gap-1.5 rounded-md border border-sky-200 bg-sky-50 px-3" data-testid="physio-review-total">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-sky-600">Total</span>
        <span className="text-sm font-bold text-sky-700">{dateFiltered.length}</span>
      </div>
    </div>
  );

  return (
    <div data-testid="physio-review-tab">
      {toolbarSlot ? createPortal(toolbar, toolbarSlot) : toolbar}

      {/* New Review / Requests / Assigned / Completed — same hand-off the patient
          actually moves through, one bucket at a time; New Review is the default.
          The same tile the Treatment summary uses, so both tabs of this board filter
          through one control rather than two that happen to sit on the same screen.
          Three across on a phone; all five from sm up. */}
      <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-5 sm:gap-3" data-testid="physio-review-buckets">
        {REVIEW_TABS.map((t) => (
          <StatTile
            key={t.key}
            icon={t.icon}
            label={t.label}
            value={counts[t.key]}
            color={t.color}
            active={bucket === t.key}
            onClick={() => setBucket(t.key)}
            testid={`physio-review-bucket-${t.key}`}
          />
        ))}
      </div>

      {visible.length === 0 && !loading ? (
        <div className="text-center py-16">
          <ClipboardCheck className="h-10 w-10 text-slate-200 mx-auto mb-3" />
          <p className="text-sm text-slate-400">{EMPTY_TEXT[bucket] || "No patient matches these filters"}</p>
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
                      {/* "11 / 7 sessions" was nonsense for anyone past their first
                          milestone. Show what they've done, then either that they've
                          reached a milestone or which session brings the next one. */}
                      <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold ${
                        p.due_for_review ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"
                      }`}>
                        {p.treatment_days} session{p.treatment_days === 1 ? "" : "s"} done
                      </span>
                      {!p.due_for_review && !p.review_status && (
                        <span className="inline-flex items-center rounded-md bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                          next review at {(Math.floor(p.treatment_days / threshold) + 1) * threshold}
                        </span>
                      )}
                      {p.review_number > 0 && (
                        <span className="inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
                          {ordinal(p.review_number)} Review
                        </span>
                      )}
                      {badge && (
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.cls}`}>
                          {badge.label}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
                {p.due_for_review && (
                  <Button
                    size="sm"
                    className="mt-2 w-full bg-amber-600 text-xs text-white hover:bg-amber-700"
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
                  {weeksTarget.treatment_days} completed sessions
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
                <p className="text-xs text-white/80">
                  {draft.patient.lead_name} · {ordinal(draft.patient.review_number)} Review · {draft.patient.treatment_days} completed sessions
                </p>
              </div>
              <button onClick={() => setDraft(null)} className="rounded-lg border-2 border-orange-200 bg-orange-100 p-2 text-orange-600 hover:bg-orange-200" data-testid="physio-raise-review-close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 p-5">
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
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                  Notes for the Head Physio <span className="text-rose-500">*</span>
                </label>
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
  const [tab, setTab] = useState("overview");
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

  // Days still to do come first, then the ones already done — a finished day is a record,
  // an unfinished one is work, and the work should not be below thirty rows of history.
  // Both halves stay in session order, so a day is always where its number says it is
  // within its half; only the halves move.
  //
  // The day actually opened from the date strip is pinned above both, whatever its
  // status: it is the only one that can be ticked off, and once it is completed it would
  // otherwise drop below every pending day the moment you finish it.
  const orderedSessions = useMemo(() => {
    const bySessionNumber = (a, b) => (a.session_number || 0) - (b.session_number || 0);
    const isOpened = (s) => !!activeDate && (s.slot_time || "").startsWith(activeDate);
    const opened = sessions.filter(isOpened).sort(bySessionNumber);
    const rest = sessions.filter((s) => !isOpened(s));
    return [
      ...opened,
      ...rest.filter((s) => s.status !== "completed").sort(bySessionNumber),
      ...rest.filter((s) => s.status === "completed").sort(bySessionNumber),
    ];
  }, [sessions, activeDate]);

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
        {/* Plain white header, as the Pre-Sales detail popup uses. The day count keeps
            its emphasis by going sky on a tinted chip — on the old slate bar it was
            carried by white-on-colour, which there is no colour left to do. */}
        <div className="flex items-start justify-between gap-3 bg-white px-6 py-4">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-bold text-slate-900">{lead.name}</h3>
            <p className="truncate text-xs text-slate-500">{lead.phone}{lead.email ? ` · ${lead.email}` : ""}</p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="whitespace-nowrap rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-sm font-bold text-sky-700">
              {completedSessions.length}/{sessions.length} days
            </span>
            <button type="button" onClick={onClose} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
          </div>
        </div>

        {/* One popup, four things in it: what is happening now, what the Head Physio
            wrote, the day list to tick off, and the patient's files. Stacked, that was a
            long scroll where the Complete button — the reason the popup is open — sat far
            below the reading material. Tabs keep each within one screen.
            Overview leads because it answers "what am I doing with this patient today". */}
        <div className="flex gap-1 overflow-x-auto border-b border-slate-200 px-5 pt-2" data-testid="physio-detail-tabs">
          {MODAL_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`shrink-0 whitespace-nowrap rounded-t-md px-3 py-2 text-xs font-medium transition ${
                tab === t.key ? "border-b-2 border-sky-500 text-sky-700" : "border-b-2 border-transparent text-slate-400 hover:text-slate-600"
              }`}
              data-testid={`physio-detail-tab-${t.key}`}
            >
              {t.label}
              {t.key === "days" && sessions.length > 0 && (
                <span className="ml-1.5 text-[10px] text-slate-400">{completedSessions.length}/{sessions.length}</span>
              )}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {tab === "overview" && (
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
          )}

          {tab === "report" && (
          <div data-testid="physio-consultation-report">
            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Consultation Report</p>
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
              <div className="mt-3 rounded-lg border border-slate-200 p-3">
                <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-slate-400">Pre-Sales Diagnosis</p>
                <p className="text-xs text-slate-700 whitespace-pre-wrap">{lead.diagnosis}</p>
              </div>
            )}
            {lead.physio_diagnosis_report && (
              <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50 p-3">
                <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-sky-500">Diagnosis Report</p>
                <p className="text-xs text-sky-900 whitespace-pre-wrap">{lead.physio_diagnosis_report}</p>
              </div>
            )}
            {lead.treatment_summary && (
              <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50 p-3">
                <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-violet-500">Treatment Summary</p>
                <p className="text-xs text-violet-900 whitespace-pre-wrap">{lead.treatment_summary}</p>
              </div>
            )}
          </div>
          )}

          {/* Treatment days — one row per booked session, completed in order */}
          {tab === "days" && (
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
                {orderedSessions.map((s, i) => {
                  const done = s.status === "completed";
                  // Where the list crosses from work to history, so the jump back to
                  // Day 1 reads as a divider rather than as the order being wrong.
                  const firstDone = done && i > 0 && orderedSessions[i - 1].status !== "completed";
                  // Only the day being viewed can be ticked off — a day is completed on
                  // the date it actually falls on, so the others stay read-only until
                  // their own date is picked in the strip behind this popup.
                  const isActiveDay = !activeDate || (s.slot_time || "").startsWith(activeDate);
                  return (
                    <Fragment key={s.id}>
                    {firstDone && (
                      <div className="flex items-center gap-2 pt-2" data-testid="physio-treatment-days-divider">
                        <span className="h-px flex-1 bg-slate-200" />
                        {/* Counted from here down, not the overall total — the opened day
                            is pinned above and may already be complete. */}
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                          {orderedSessions.slice(i).filter((x) => x.status === "completed").length} completed
                        </span>
                        <span className="h-px flex-1 bg-slate-200" />
                      </div>
                    )}
                    <div
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
                        <p className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-slate-700">
                          Day {s.session_number} of {s.total_sessions} · Week {s.week_number}
                          {/* Says why this row is at the top, which is not obvious once it
                              has been completed and every pending day sits below it. */}
                          {isActiveDay && activeDate && (
                            <span className="rounded bg-sky-100 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-sky-700">
                              Opened
                            </span>
                          )}
                        </p>
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
                    </Fragment>
                  );
                })}
              </div>
            )}
          </div>
          )}

          {tab === "documents" && <DocumentsPanel leadId={lead.id} />}

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

function PatientsTab({ physioId, onCountChange }) {
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [historyTab, setHistoryTab] = useState("ongoing");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // review_number is only on /physio/reviews — merged in here so a patient's card
      // can show how many review milestones they've had without a second round trip
      // when opening their detail page.
      const [data, rev] = await Promise.all([physioPatients(physioId), physioReviews(physioId)]);
      const reviewByLead = Object.fromEntries((rev.patients || []).map((r) => [r.lead_id, r.review_number || 0]));
      setPatients((data.patients || []).map((p) => ({ ...p, review_number: reviewByLead[p.lead_id] || 0 })));
    } catch { /* silent */ }
    setLoading(false);
  }, [physioId]);

  useEffect(() => { load(); }, [load]);

  const isCompleted = (p) => p.physio_stage === "Complete";
  const ongoingCount = patients.filter((p) => !isCompleted(p)).length;
  const completedCount = patients.filter(isCompleted).length;
  const visiblePatients = patients.filter((p) => (historyTab === "completed" ? isCompleted(p) : !isCompleted(p)));

  // Badge is who's still ongoing, not the whole caseload — it counts down to 0 once
  // every patient has finished their full treatment course.
  useEffect(() => { onCountChange?.(ongoingCount); }, [ongoingCount, onCountChange]);

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
            <button
              type="button"
              key={p.lead_id}
              onClick={() => setSelectedPatient(p)}
              className="block w-full rounded-xl border border-slate-200 bg-white p-4 text-left transition-shadow hover:shadow-sm"
              data-testid={`physio-patient-${p.lead_id}`}
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sm font-bold text-sky-700">
                  {p.lead_name?.charAt(0)?.toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800">{p.lead_name}</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="truncate text-[10px] text-slate-400">{p.phone} · {p.package_weeks || "?"} weeks program</p>
                    {p.review_number > 0 && (
                      <span className="shrink-0 rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-semibold text-violet-700">
                        {ordinal(p.review_number)} Review
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); if (p.phone) window.location.href = `tel:${p.phone.replace(/[^0-9+]/g, "")}`; }}
                    onKeyDown={(e) => e.stopPropagation()}
                    className={`flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 text-slate-500 ${p.phone ? "hover:bg-slate-50" : "cursor-not-allowed opacity-40"}`}
                    data-testid={`physio-patient-call-${p.lead_id}`}
                  >
                    <PhoneCall className="h-3.5 w-3.5" />
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      const num = waNumber(p.phone);
                      if (!num) { toast.error("This patient has no phone number on file"); return; }
                      // window.open(..., "_blank") hands mobile browsers an ambiguous new-tab/
                      // popup context — on the way back from WhatsApp that often leaves the
                      // original tab on a blank white screen. Same-tab navigation (like the
                      // tel: Call button already uses) hands off to the OS cleanly instead.
                      window.location.href = `https://wa.me/${num}`;
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 text-[#25D366] hover:bg-slate-50"
                    data-testid={`physio-patient-whatsapp-${p.lead_id}`}
                  >
                    <WhatsAppIcon className="h-4 w-4" />
                  </span>
                </div>
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
            </button>
          ))}
        </div>
      )}

      {selectedPatient && (
        <PatientDetailPage
          patient={selectedPatient}
          physioId={physioId}
          onClose={() => setSelectedPatient(null)}
          onRefresh={load}
        />
      )}
    </div>
  );
}

// Full page (not a popup) — Sessions / Treatment / Payment History / Profile.
// Same fixed inset-0 full-bleed pattern as CalendarPage, opened from a patient card
// in PatientsTab instead of a modal.
export function PatientDetailPage({ patient, physioId, onClose, onRefresh }) {
  const [detailTab, setDetailTab] = useState("sessions");
  const [lead, setLead] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [sessionFilter, setSessionFilter] = useState("all"); // all | pending | completed
  const [viewSession, setViewSession] = useState(null);

  const load = useCallback(async () => {
    try {
      const [leadData, sessData] = await Promise.all([
        physioPatientDetail(patient.lead_id, physioId),
        physioSessions(patient.lead_id),
      ]);
      setLead(leadData);
      setSessions(sessData.sessions || []);
    } catch { /* silent */ }
  }, [patient.lead_id, physioId]);

  useEffect(() => { load(); }, [load]);

  const pendingSessions = sessions.filter((s) => s.status !== "completed").length;
  const completedSessions = sessions.filter((s) => s.status === "completed").length;
  const visibleSessions = sessions.filter((s) => (
    sessionFilter === "pending" ? s.status !== "completed"
    : sessionFilter === "completed" ? s.status === "completed"
    : true
  ));

  const Row = ({ label, value }) => (
    !value ? null : (
      <div>
        <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
        <p className="text-xs text-slate-700">{value}</p>
      </div>
    )
  );

  // No Payment History here: what a patient owes and has paid is the branch's business,
  // not the treating physio's. It stays available to Branch Admin and Accountant Manage.
  const TABS = [
    { key: "sessions", label: "Sessions" },
    { key: "treatment", label: "Treatment" },
    { key: "profile", label: "Profile" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white" data-testid="physio-patient-detail-page">
      <div className="flex items-center gap-2 border-b border-slate-200 p-4">
        <button type="button" onClick={onClose} className="rounded p-1.5 text-slate-500 hover:bg-slate-100" data-testid="physio-patient-back">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-slate-800">{patient.lead_name}</h2>
          <p className="text-[10px] text-slate-400">{patient.phone}</p>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-slate-200 px-4 pt-2" data-testid="physio-patient-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setDetailTab(t.key)}
            className={`shrink-0 whitespace-nowrap rounded-t-md px-3 py-2 text-xs font-medium transition ${
              detailTab === t.key ? "border-b-2 border-sky-500 text-sky-700" : "border-b-2 border-transparent text-slate-400 hover:text-slate-600"
            }`}
            data-testid={`physio-patient-tab-${t.key}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {detailTab === "sessions" && (
          <div className="space-y-3" data-testid="physio-patient-sessions-tab">
            <div className="grid grid-cols-3 gap-2">
              <StatTile
                icon={Clock} label="Pending" value={pendingSessions} color={TILE.pending}
                onClick={() => setSessionFilter("pending")} active={sessionFilter === "pending"} testid="physio-patient-stat-pending"
              />
              <StatTile
                icon={CheckCircle2} label="Completed" value={completedSessions} color={TILE.done}
                onClick={() => setSessionFilter("completed")} active={sessionFilter === "completed"} testid="physio-patient-stat-completed"
              />
              <StatTile
                icon={Calendar} label="Total" value={sessions.length} color={TILE.total}
                onClick={() => setSessionFilter("all")} active={sessionFilter === "all"} testid="physio-patient-stat-total"
              />
            </div>
            {visibleSessions.length === 0 ? (
              <p className="py-10 text-center text-xs text-slate-400">No sessions</p>
            ) : (
              <div className="space-y-2">
                {visibleSessions.map((s) => {
                  const done = s.status === "completed";
                  return (
                    <button
                      type="button"
                      key={s.id}
                      onClick={() => setViewSession(s)}
                      className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition ${done ? "border-emerald-200 bg-emerald-50/50" : "border-slate-200 bg-white hover:border-sky-200"}`}
                      data-testid={`physio-patient-session-${s.id}`}
                    >
                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${done ? "bg-emerald-200 text-emerald-800" : "bg-slate-100 text-slate-500"}`}>
                        {s.session_number}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-slate-700">Session #{s.session_number} · Week {s.week_number}</p>
                        <p className="text-[10px] text-slate-400">{s.slot_time ? `${s.slot_time.split("T")[0]} at ${slotTo12h(s.slot_time)}` : "—"}</p>
                        {done && s.jr_physio_remarks && <p className="mt-0.5 truncate text-[10px] text-emerald-600">{s.jr_physio_remarks}</p>}
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold ${done ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                        {done ? "Completed" : "Pending"}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {detailTab === "treatment" && (
          <div className="space-y-3" data-testid="physio-patient-treatment-tab">
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-slate-400">Treatment Package</p>
              <p className="text-sm font-semibold text-slate-800">
                {lead?.session_package_name || "—"}{lead?.session_package_sessions ? ` · ${lead.session_package_sessions} sessions` : ""}
              </p>
            </div>
            {lead?.diagnosis && (
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-slate-400">Pre-Sales Diagnosis</p>
                <p className="whitespace-pre-wrap text-xs text-slate-700">{lead.diagnosis}</p>
              </div>
            )}
            {lead?.physio_diagnosis_report && (
              <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
                <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-sky-500">Diagnosis Report (Head Physio)</p>
                <p className="whitespace-pre-wrap text-xs text-sky-900">{lead.physio_diagnosis_report}</p>
              </div>
            )}
            {lead?.treatment_summary && (
              <div className="rounded-lg border border-violet-200 bg-violet-50 p-3">
                <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-violet-500">Treatment Summary (Head Physio)</p>
                <p className="whitespace-pre-wrap text-xs text-violet-900">{lead.treatment_summary}</p>
              </div>
            )}
            {lead && !lead.physio_diagnosis_report && !lead.treatment_summary && (
              <p className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">
                No treatment details submitted by the Head Physio yet.
              </p>
            )}
          </div>
        )}


        {detailTab === "profile" && lead && (
          <div className="grid grid-cols-2 gap-3" data-testid="physio-patient-profile-tab">
            <Row label="Patient Number" value={lead.patient_number} />
            <Row label="Phone" value={lead.phone} />
            <Row label="Email" value={lead.email} />
            <Row label="Alternative Phone" value={lead.alternative_phone} />
            <Row label="Age" value={lead.age} />
            <Row label="Gender" value={lead.gender} />
            <Row label="Occupation" value={lead.occupation} />
            <Row label="Address" value={lead.address} />
            <Row label="City / State" value={[lead.city, lead.state].filter(Boolean).join(", ")} />
            <Row label="Condition" value={lead.condition} />
            <Row label="Months of Pain" value={lead.months_of_pain} />
          </div>
        )}
      </div>

      {viewSession && (
        <CompleteSessionModal
          session={viewSession}
          onClose={() => setViewSession(null)}
          onDone={() => { setViewSession(null); load(); onRefresh?.(); }}
        />
      )}
    </div>
  );
}

// Doubles as a read-only "view summary" for an already-completed session — any
// session, in any stage, can be opened here; only an upcoming one gets an editable
// textarea and a submit button.
function CompleteSessionModal({ session, onClose, onDone }) {
  const [remarks, setRemarks] = useState(session.jr_physio_remarks || "");
  const [submitting, setSubmitting] = useState(false);
  const isDone = session.status === "completed";

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
          <h3 className="text-base font-semibold text-slate-800">{isDone ? "Session Summary" : "Complete Session"} #{session.session_number}</h3>
          <p className="text-[10px] text-slate-400">{session.lead_name} · {session.slot_time ? `${session.slot_time.split("T")[0]} at ${slotTo12h(session.slot_time)}` : "—"}</p>
        </div>
        <div className="p-5">
          <label className="text-xs font-medium text-slate-600 mb-1 block">Session {isDone ? "Summary" : "Remarks (visible to patient)"}</label>
          <textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={4}
            disabled={isDone}
            placeholder="Exercises done, observations, next steps..."
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-500"
            data-testid="session-remarks"
          />
        </div>
        <div className="flex justify-end gap-2 border-t p-4">
          <Button variant="outline" size="sm" onClick={onClose}>{isDone ? "Close" : "Cancel"}</Button>
          {!isDone && (
            <Button size="sm" onClick={handleSubmit} disabled={submitting} className="bg-sky-600 hover:bg-sky-700 text-white" data-testid="session-complete-submit">
              {submitting ? "Completing..." : "Mark Complete"}
            </Button>
          )}
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
