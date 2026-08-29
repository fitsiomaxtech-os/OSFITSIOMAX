import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Calendar,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  LayoutList,
  Package,
  RefreshCw,
  Search,
  Send,
  Stethoscope,
  User,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatTile } from "@/components/ui/stat-tile";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { ConsultationsBoard } from "@/components/ConsultationsBoard";
import { HeadPhysioReviewTab } from "@/components/HeadPhysioReviewTab";
import { WeekStrip, todayIso } from "@/components/WeekStrip";
import { DateFilterPopover } from "@/components/DateFilterPopover";
import {
  getHPMyCalendar,
  hpRecommendPackage,
  physioSessions,
} from "@/lib/api";
import { to12h, slotTo12h } from "@/lib/time";

// The summary cards ARE the navigation now. Consultations are what Branch Admin books in;
// Reviews are what Branch Admin sends over once a Physio flags a patient at seven days of
// treatment; Rehab is the patient list. All puts the day's two work lists on one screen.
//
// Calendar and My Profile used to sit alongside these. Both moved to the header beside the
// avatar — neither is a list to work through, and keeping them here made five things look
// like five queues.
//
// They also replaced the consultation board's own stage pills: Consultations is the first
// stage of the head-consultation pipeline, All is the same board with no stage narrowing.
// The stage's *name* is never assumed — it's configured in Pipeline Stage Management and
// gets renamed, so it's read from the board rather than written down here.

// Stage pill colours for the merged All list — the one thing that keeps a mixed list of
// consultations, reviews and rehab patients readable.
const STAGE_TONES = {
  sky: "border-sky-200 bg-sky-50 text-sky-700",
  violet: "border-violet-200 bg-violet-50 text-violet-700",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  // For a patient whose entries don't agree on a stage. Deliberately colourless: the
  // pill is naming a count rather than a kind of work, and giving it one of the colours
  // above would claim the whole group is that when only some of it is.
  slate: "border-slate-200 bg-slate-100 text-slate-600",
};

// One track per tile. Written out rather than built from the count, because Tailwind reads
// the source for class names and `sm:grid-cols-${n}` would compile to nothing at all —
// leaving the row as one unstyled column. Same reason segmented-tabs spells its layouts out.
const TAB_GRID_COLS = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-4",
};

const WORK_TABS = [
  { key: "consultations", label: "Consultations", icon: Calendar, color: "#0284c7" },
  { key: "review", label: "Review", icon: ClipboardCheck, color: "#7c3aed" },
  { key: "all", label: "All", icon: LayoutList, color: "#0d9488" },
];

// The two queues All merges, and the labels its own filter offers. Kept beside WORK_TABS
// because the keys have to match the `kind` each row is flattened to.
const ALL_KINDS = [
  { key: "all", label: "All" },
  { key: "consult", label: "Consult" },
  { key: "review", label: "Review" },
];

// A stage counts as finished when it says so. Read from the name rather than matched
// against a list of them, because these are renamed in Pipeline Stage Management and a
// hardcoded "Consultation Completed" would quietly stop matching the day someone edits it.
const isDone = (...stages) => stages.some((s) => /complete/i.test(String(s || "")));

export const HeadPhysioBoard = ({ branchId, branchIds, user, search = "", onSearchChange }) => {
  const [workTab, setWorkTab] = useState("consultations");
  // The day every list under Consultations answers to. Starts on today.
  const [workDate, setWorkDate] = useState(todayIso());
  // A range covering several days, from the filter beside Refresh. While one is set it
  // replaces the single day rather than narrowing it further: the board offers one scope
  // at a time, or the counts on the cards would describe a different set from the list.
  const [dateRange, setDateRange] = useState(null);
  // Which of the three queues All is showing. Lives on the All card itself.
  const [allKind, setAllKind] = useState("all");
  // Reported up by each list so the cards can be labelled without fetching twice.
  // `consultStages` is the per-stage breakdown — the cards took over the board's own
  // stage bar, so they need to know what sits behind each stage.
  const [consultCount, setConsultCount] = useState(0);
  const [consultStages, setConsultStages] = useState({});
  const [consultStageNames, setConsultStageNames] = useState([]);
  const [reviewCount, setReviewCount] = useState(0);
  // The rows behind those counts, so All can merge all three into one list.
  const [consultRows, setConsultRows] = useState([]);
  const [reviewRows, setReviewRows] = useState([]);
  // New Rehab is a patient with no package recommended yet — the same shape as the other
  // cards: what is still waiting on this Head Physio, not everything on their list.
  // Whatever the first head-consultation stage is currently called.
  const firstStage = consultStageNames[0] || null;

  const q = search.trim().toLowerCase();
  const matches = (...fields) => !q || fields.some((f) => String(f || "").toLowerCase().includes(q));

  // All is one list, not three stacked sections — the same patient can be in more than one
  // of them, and reading three tables to find the day's work defeats the point. Every row
  // is flattened to the same shape and carries the stage it came from, so the mix stays
  // legible.
  //
  // The Stage pill names the queue a row came from and whether that work is finished —
  // Consultation, Review, Rehab, each with "· Completed" once it is. It used to print the
  // lead's raw pipeline stage, which in a mixed list said nothing about which of the three
  // kinds of work a row was, and read as "All" for anyone whose stage happened to be named
  // that. Which list a row belongs to is the thing this column exists to answer.
  const allRows = useMemo(() => [
    ...consultRows.map((l) => {
      const done = isDone(l.head_consultation_stage, l.consultation_stage);
      return {
        key: `c-${l.id}`,
        kind: "consult",
        leadId: l.id,
        name: l.name || "Unknown",
        patientNo: l.patient_number || "",
        phone: l.phone || "",
        stage: done ? "Consultation · Completed" : "Consultation",
        tone: done ? "emerald" : "sky",
        when: l.appointment_date ? `${l.appointment_date} ${to12h(l.appointment_time)}` : "",
        // Sorted on separately from `when`, which is written to be read: to12h turns 15:00
        // into "3:00 PM", and "3:00 PM" sorts above "10:00 AM" as text. This is the raw
        // 24-hour value, zero-padded, which compares correctly.
        at: `${l.appointment_date}T${l.appointment_time || "99:99"}`,
        who: l.assigned_physio_name || "",
      };
    }),
    ...reviewRows.filter((r) => matches(r.lead_name, r.phone, r.patient_number)).map((r) => ({
      key: `r-${r.id}`,
      kind: "review",
      reviewId: r.id,
      name: r.lead_name || "Unknown",
      patientNo: r.patient_number || "",
      phone: r.phone || "",
      stage: r.status === "completed" ? "Review · Completed" : "Review",
      tone: r.status === "completed" ? "emerald" : "violet",
      when: r.review_date || "",
      // A review is booked on a day and not at an hour, so it sorts to the end of its own
      // day rather than to some invented time inside it.
      at: r.review_date ? `${r.review_date}T99:99` : "",
      who: r.physio_name || "",
    })),
  ]
    // In the order the day is worked -- 10:00 AM, then 3:00 PM, then 5:00 PM -- the same
    // order the Consultations tab beside this one is in. The rows arrive newest-updated
    // first, which is the order they were last touched in and not the order they happen
    // in; merging two queues that way put whoever was edited most recently on top of a
    // list somebody reads downwards.
    //
    // Anything with no date at all goes last rather than first, where an empty string
    // would otherwise put it.
    .sort((a, b) => {
      if (!a.at) return b.at ? 1 : 0;
      if (!b.at) return -1;
      return a.at.localeCompare(b.at);
    }), [consultRows, reviewRows]);

  // What All actually renders. Narrowed by the filter on the All card itself; the
  // count on that card stays the full total, because it is the card's own figure and
  // a number that moved when you filtered under it would be reporting the filter.
  const visibleAllRows = useMemo(
    () => (allKind === "all" ? allRows : allRows.filter((r) => r.kind === allKind)),
    [allRows, allKind],
  );

  /* One row per patient, not one per piece of work.
   *
   * A patient legitimately turns up more than once on a day — a consultation and the
   * review that follows it, or two reviews dispatched against one visit — and this list
   * printed each as its own row. The trouble is that the columns which would tell those
   * rows apart are exactly the ones that repeat: same name, same patient number, same
   * phone, same expert, same date. Four rows for two people reads as four people, and
   * nothing on screen says otherwise until you stop and compare them character by
   * character. So the patient appears once and the work they have that day is counted on
   * the row, where a repeat is a number instead of something you have to notice.
   *
   * Identity is the patient number wherever there is one: it is the only field here that
   * is issued rather than typed, so it is the only one that can carry this safely. Phone
   * is the fallback, and the name is the last resort — two people sharing a name is a
   * real thing, so a name only ever groups rows that have neither of the other two and
   * there is nothing better to go on.
   */
  const groupedAllRows = useMemo(() => {
    const groups = [];
    const byKey = new Map();
    for (const r of visibleAllRows) {
      // Falling back to the row's own key leaves an unidentifiable row standing alone,
      // which is the right answer: with no number, no phone and no name there is nothing
      // to say it is the same person as the next one like it.
      const key = String(r.patientNo || r.phone || r.name || "").trim().toLowerCase() || r.key;
      let g = byKey.get(key);
      if (!g) {
        g = { key: `g-${key}`, name: r.name, patientNo: r.patientNo, phone: r.phone, entries: [] };
        byKey.set(key, g);
        groups.push(g);
      }
      // A later entry fills in a field the first happened to be missing rather than
      // overwriting one it already had — grouped on the phone, one row may carry the
      // patient number and another not, and the row should show it either way.
      g.patientNo = g.patientNo || r.patientNo;
      g.phone = g.phone || r.phone;
      g.entries.push(r);
    }
    return groups;
  }, [visibleAllRows]);

  const [loading, setLoading] = useState(false);
  // The patient whose entries are being listed, held by key rather than by object so a
  // refresh behind the popup refreshes what it shows. If that patient drops off the day
  // entirely the lookup comes back empty and the popup closes itself, instead of standing
  // there describing work that is no longer there.
  const [entriesForKey, setEntriesForKey] = useState(null);
  const entriesFor = useMemo(
    () => (entriesForKey ? groupedAllRows.find((g) => g.key === entriesForKey) || null : null),
    [entriesForKey, groupedAllRows],
  );
  // Set by View on the All list, consumed by whichever board owns that row's popup.
  const [autoOpenLead, setAutoOpenLead] = useState(null);
  const [autoOpenReview, setAutoOpenReview] = useState(null);

  /**
   * View on an All row. The two queues merged into that list keep their own detail popups,
   * so this routes to the right one rather than building a third that would show less than
   * either of them.
   *
   * Both switch tab first: the boards stay mounted but `hidden` when not selected, and a
   * modal rendered inside display:none does not appear.
   */
  const openRow = (r) => {
    if (r.kind === "consult") { setWorkTab("consultations"); setAutoOpenLead(r.leadId); return; }
    setWorkTab("review"); setAutoOpenReview(r.reviewId);
  };

  /**
   * View on a grouped row.
   *
   * A patient with one thing on the day opens that thing, exactly as before. Putting a
   * chooser in front of a single entry would be a dialog whose only content is one row
   * and whose only purpose is to be dismissed — the popup earns its place only where
   * there is genuinely a choice to make.
   */
  const openGroup = (g) => {
    if (g.entries.length === 1) { openRow(g.entries[0]); return; }
    setEntriesForKey(g.key);
  };

  // Closed before routing: openRow switches tab, and leaving this open would strand a
  // list of one patient's day over a board now showing something else.
  const chooseEntry = (r) => { setEntriesForKey(null); openRow(r); };

  /* What a column says for a whole group: the shared value where every entry agrees, and
   * the first with a "+n" where they don't. A group of one collapses to its own value, so
   * the ordinary row is worded exactly as it always was.
   *
   * The "+n" matters more than it looks. Two reviews by two different experts must not
   * quietly render as one expert's name — that would be the row asserting something
   * false, which is worse than the repetition this replaced. */
  const collapse = (entries, pick) => {
    const seen = [...new Set(entries.map(pick).filter(Boolean))];
    if (seen.length === 0) return "";
    if (seen.length === 1) return seen[0];
    return `${seen[0]} +${seen.length - 1}`;
  };

  // The Stage pill for a group. One shared stage keeps its own colour and wording; a
  // mixture is named by its count in the neutral tone, because no single stage is true of
  // the group and picking one to show would misreport the rest.
  const groupStage = (g) => {
    const stages = [...new Set(g.entries.map((e) => e.stage))];
    if (stages.length === 1) return { label: stages[0], tone: g.entries[0].tone };
    return { label: `${g.entries.length} entries`, tone: "slate" };
  };
  // One Refresh for the two boards behind this one. Each owns its own fetch, so both are
  // told by token rather than called from here.
  const [refreshTick, setRefreshTick] = useState(0);

  // Head Physios cover every branch and carry none of their own, so "all" is the normal
  // case here — without it the board asked for branch `undefined` and every list came back
  // empty while the appointments sat there booked.
  const assignedBranchIds = branchIds && branchIds.length ? branchIds : (branchId ? [branchId] : []);
  const effectiveBranchId = assignedBranchIds[0] || branchId || "all";

  return (
    // Bottom padding on phones clears the fixed bottom bar, so the last row of any list
    // is still reachable instead of sitting underneath it.
    <div className="space-y-4 pb-20 sm:pb-0" data-testid="head-physio-board-root">
      {/* Two regions. The left is deliberately left empty — reserved space, not a gap to
          be filled later by whatever comes along. The day filter takes only the width it
          needs on the right, divided off from it. */}
      <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-2 lg:flex-row lg:items-center lg:gap-4">
        {/* One search for the whole board, so it works on Review, Rehab and All and not
            only on Consultations — that tab had its own box and the other three had
            nothing. Hidden on a phone, where the header's magnifier does the same job
            without costing a row of vertical space above the lists. */}
        <div className="relative hidden min-h-[2.25rem] flex-1 sm:block" data-testid="hp-header-search">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => onSearchChange && onSearchChange(e.target.value)}
            placeholder="Search patient, phone or patient no..."
            className="h-9 w-full rounded-md border border-slate-200 pl-9 pr-3 text-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
            data-testid="hp-search-input"
          />
        </div>
        {/* Dimmed and inert while a range is set — two live scopes on one row invite the
            reader to combine them, and the board answers to one. */}
        <div
          className={`shrink-0 lg:border-l lg:border-slate-100 lg:pl-4 ${dateRange ? "pointer-events-none opacity-40" : ""}`}
          aria-disabled={dateRange ? "true" : undefined}
          data-testid="hp-header-day-filter"
        >
          <WeekStrip value={workDate} onChange={setWorkDate} testid="hp-week-strip" bare />
        </div>
        <button
          type="button"
          onClick={() => setRefreshTick((n) => n + 1)}
          disabled={loading}
          title="Refresh"
          aria-label="Refresh"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-500 text-white transition hover:bg-slate-600 disabled:opacity-50"
          data-testid="hp-refresh-btn"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
        {/* After Refresh, with its own presets and a custom range. Clearing it hands the
            board back to the week strip. */}
        <div className="shrink-0" data-testid="hp-header-range-filter">
          <DateFilterPopover value={dateRange} onChange={setDateRange} testid="hp-date-filter" centered />
        </div>
      </div>

      <div className="space-y-4" data-testid="hp-work-view">
          {/* The board's navigation and its stage filter in one. Each card carries the
              count behind it, so the day's workload reads without opening anything.
              Two-up on phones, four across from tablet; the bottom bar stays for
              thumb reach. */}
          {/* items-stretch on the phone row too, so the cards come out level there as well
              as in the grid — they hold different amounts of text and the row has to answer
              to the tallest rather than each card to itself. */}
          <div className={`-mx-1 flex items-stretch gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:grid ${TAB_GRID_COLS[WORK_TABS.length] || "sm:grid-cols-4"} sm:gap-3 sm:overflow-visible sm:px-0 sm:pb-0`} data-testid="hp-work-tabs">
            {WORK_TABS.map((t) => {
              const n = t.key === "consultations" ? (consultStages[firstStage] || 0)
                : t.key === "review" ? reviewCount
                // All is the two of them together, every stage, nothing narrowed.
                : consultCount + reviewCount;
              const sub = t.key === "consultations" ? (firstStage ? `in ${firstStage}` : "on this day")
                : t.key === "review" ? "on this day"
                : "everything on this day";
              // The wrapper keeps the phone's side-scrolling row of fixed-width cards; the
              // tile itself fills whatever it is given.
              return (
                // Wider on a phone where the card carries the kind filter in its corner:
                // at 10.5rem the three buttons and the icon have nowhere to go, and the
                // card clips rather than wraps. The grid from sm up sizes them equally.
                <div key={t.key} className={`h-full shrink-0 sm:w-auto ${t.key === "all" ? "w-[13.5rem]" : "w-[10.5rem]"}`}>
                  <StatTile
                    label={t.label}
                    value={n}
                    sub={sub}
                    icon={t.icon}
                    color={t.color}
                    active={workTab === t.key}
                    onClick={() => setWorkTab(t.key)}
                    testid={`hp-work-tab-${t.key}`}
                    // Inside the All card rather than above the list: All is the only tab
                    // that merges three queues, so the control that picks between them
                    // belongs to that card and to no other.
                    //
                    // On the card's top line, running up to its icon, rather than on a rule
                    // beneath the figure. Under it the three buttons read as a strip of
                    // their own — a second card grafted to the bottom of this one — and
                    // pushed the count and its caption up off the line the other three
                    // cards keep. In the corner they read as what they are: which of the
                    // things this card counts it is showing.
                    corner={t.key === "all" ? (
                      <div className="flex items-center gap-1" data-testid="hp-all-kind-filter">
                        {ALL_KINDS.map((k) => (
                          <button
                            key={k.key}
                            type="button"
                            onClick={() => { setWorkTab("all"); setAllKind(k.key); }}
                            className={`rounded px-1.5 py-0.5 text-[10px] font-bold transition ${
                              allKind === k.key ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100"
                            }`}
                            data-testid={`hp-all-kind-${k.key}`}
                          >
                            {k.label}
                          </button>
                        ))}
                      </div>
                    ) : undefined}
                  />
                </div>
              );
            })}
          </div>

          {/* Both stay mounted and hidden rather than unmounted, so every card keeps a
              live count whichever one is open, and switching costs no refetch. */}
          <div className={workTab === "consultations" ? "" : "hidden"} data-testid="hp-work-consultations">
            <ConsultationsBoard
              branchId={effectiveBranchId}
              viewerRole="head_physio"
              externalDate={dateRange ? undefined : workDate}
              externalDateFilter={dateRange || undefined}
              hideDateFilter
              externalSearch={search}
              mobileCards
              // The cards ARE the stage filter now: Consultations is the New Appointment
              // queue, All drops the stage narrowing entirely. Keeping the board's own
              // stage pills as well would be the same control offered twice.
              showOwnStageBar={false}
              externalStageFilter={workTab === "consultations" ? firstStage : null}
              onCountChange={(total, stages, names) => { setConsultCount(total); setConsultStages(stages || {}); setConsultStageNames(names || []); }}
              onRowsChange={setConsultRows}
              autoOpenLeadId={autoOpenLead}
              onAutoOpened={() => setAutoOpenLead(null)}
              reloadToken={refreshTick}
            />
          </div>

          <div className={workTab === "review" ? "" : "hidden"} data-testid="hp-work-review">
            <HeadPhysioReviewTab
              selectedDate={dateRange ? null : workDate}
              dateRange={dateRange}
              compact={workTab === "all"}
              onCountChange={setReviewCount}
              onRowsChange={setReviewRows}
              autoOpenReviewId={autoOpenReview}
              onAutoOpened={() => setAutoOpenReview(null)}
              reloadToken={refreshTick}
            />
          </div>

          {/* Rehab is a patient list rather than a day's queue, so it isn't date-filtered.
              Its own card narrows to the ones still needing a recommendation; All shows
              every patient, matching how Consultations narrows and All doesn't. The
              weekly assessments sit under it — same patients, the per-week record rather
              than the dispatched reviews. */}
          {workTab === "all" && (
            <div data-testid="hp-work-all">
              {/* Six columns can't reflow onto a phone, so the same rows render as cards
                  there rather than scrolling sideways past the ones that matter. */}
              <div className="space-y-2 sm:hidden">
                {groupedAllRows.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-200 px-3 py-10 text-center text-sm text-slate-400">Nothing on this day.</p>
                ) : groupedAllRows.map((g, i) => {
                  const st = groupStage(g);
                  const who = collapse(g.entries, (e) => e.who);
                  const when = collapse(g.entries, (e) => e.when);
                  return (
                  // The whole card opens it on a phone — a View link in a corner is a
                  // small target next to a row that is already the thing being tapped.
                  <button
                    key={g.key}
                    type="button"
                    onClick={() => openGroup(g)}
                    className="w-full rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-sky-200"
                    data-testid={`hp-all-card-${g.key}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-slate-800">
                          <span className="mr-1.5 font-semibold text-slate-300">{i + 1}.</span>{g.name}
                          {g.entries.length > 1 && (
                            <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">×{g.entries.length}</span>
                          )}
                        </p>
                        <p className="truncate text-xs text-slate-500">{g.phone || "—"}</p>
                      </div>
                      <span className={`shrink-0 whitespace-nowrap rounded-[5px] border px-2 py-0.5 text-[10px] font-bold ${STAGE_TONES[st.tone]}`}>
                        {st.label}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                      {g.patientNo && <span className="font-mono">{g.patientNo}</span>}
                      {who && <span>· {who}</span>}
                      {when && <span>· {when}</span>}
                    </div>
                  </button>
                  );
                })}
              </div>

              <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white sm:block">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="bg-slate-500 text-left text-[10px] uppercase tracking-wider text-white">
                    <tr>
                      {/* Patient stays left — it's the column the eye scans down to find
                          a row, and a ragged left edge is exactly what makes a name list
                          hard to scan. Everything after it is centred. */}
                      <th className="w-12 px-4 py-2.5 text-left font-semibold">S.No</th>
                      <th className="px-4 py-2.5 text-left font-semibold">Patient</th>
                      <th className="px-4 py-2.5 text-center font-semibold">Patient No.</th>
                      <th className="px-4 py-2.5 text-center font-semibold">Phone</th>
                      <th className="px-4 py-2.5 text-center font-semibold">Stage</th>
                      <th className="px-4 py-2.5 text-center font-semibold">Expert / Branch</th>
                      <th className="px-4 py-2.5 text-center font-semibold">When</th>
                      <th className="px-4 py-2.5 text-center font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {groupedAllRows.length === 0 ? (
                      <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-400">Nothing on this day.</td></tr>
                    ) : groupedAllRows.map((g, i) => {
                      const st = groupStage(g);
                      const many = g.entries.length > 1;
                      return (
                      <tr key={g.key} className="hover:bg-slate-50" data-testid={`hp-all-row-${g.key}`}>
                        {/* Numbers what is on screen — the merged list reorders as the
                            three queues change, so this is a position, never an id. */}
                        <td className="px-4 py-3 text-left text-slate-400">{i + 1}</td>
                        <td className="px-4 py-3 text-left font-medium text-slate-800">
                          {g.name}
                          {/* The count sits on the name because that is the thing that
                              used to be printed twice — it reads as "this patient, twice"
                              rather than as a second patient. */}
                          {many && (
                            <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500" data-testid={`hp-all-count-${g.key}`}>×{g.entries.length}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center font-mono text-[11px] text-slate-400">{g.patientNo || "—"}</td>
                        <td className="px-4 py-3 text-center text-slate-600">{g.phone || "—"}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex whitespace-nowrap rounded-[5px] border px-2 py-0.5 text-[10px] font-bold ${STAGE_TONES[st.tone]}`}>
                            {st.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center text-slate-600">{collapse(g.entries, (e) => e.who) || "—"}</td>
                        <td className="px-4 py-3 text-center text-slate-500">{collapse(g.entries, (e) => e.when) || "—"}</td>
                        <td className="px-4 py-3 text-center">
                          <button
                            type="button"
                            onClick={() => openGroup(g)}
                            className="inline-flex items-center gap-0.5 whitespace-nowrap text-[11px] font-semibold text-sky-600 hover:text-sky-800"
                            data-testid={`hp-all-view-${g.key}`}
                          >
                            {many ? `View ${g.entries.length}` : "View"} <ChevronRight className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              </div>
            </div>
          )}

      </div>

      {/* One patient's work for the day, opened from a row that stands for more than one
          piece of it. This is a way through to the existing popups rather than a third
          detail view: each line says what the work is and hands off to the board that
          owns it, which is the same route View took before the rows were grouped. */}
      {entriesFor && (
        <div
          className="fixed inset-0 z-[65] flex items-center justify-center bg-black/50 p-3"
          onClick={(e) => { if (e.target === e.currentTarget) setEntriesForKey(null); }}
          data-testid="hp-all-entries-modal"
        >
          <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 bg-slate-900 px-5 py-4 text-white">
              <div className="min-w-0">
                <p className="truncate text-lg font-bold">{entriesFor.name}</p>
                {/* The identifying fields sit here, once, instead of down every row of
                    the list this replaced. */}
                <p className="mt-0.5 truncate text-[11px] text-slate-300">
                  {[entriesFor.patientNo, entriesFor.phone].filter(Boolean).join(" · ") || "No patient number on file"}
                </p>
              </div>
              <button
                onClick={() => setEntriesForKey(null)}
                className="shrink-0 rounded-lg border-2 border-orange-200 bg-orange-100 p-2 text-orange-600 hover:bg-orange-200"
                data-testid="hp-all-entries-close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="border-b border-slate-100 bg-slate-50 px-5 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              {entriesFor.entries.length} on this day
            </p>
            <div className="flex-1 space-y-2 overflow-y-auto p-4">
              {entriesFor.entries.map((r, i) => (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => chooseEntry(r)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-sky-300 hover:bg-sky-50/40"
                  data-testid={`hp-all-entry-${r.key}`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold text-slate-300">{i + 1}.</span>
                      <span className={`inline-flex whitespace-nowrap rounded-[5px] border px-2 py-0.5 text-[10px] font-bold ${STAGE_TONES[r.tone]}`}>
                        {r.stage}
                      </span>
                    </div>
                    {/* Expert and time are what actually tell two entries apart once the
                        patient is settled, so they are the line under the stage. */}
                    <p className="mt-1.5 truncate text-[11px] text-slate-500">
                      {[r.who, r.when].filter(Boolean).join(" · ") || "No expert or time recorded"}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Sits above the bottom bar on phones so it never covers the nav. */}
      {loading && <div className="fixed bottom-20 right-4 z-40 rounded-md bg-slate-900 px-3 py-2 text-sm text-white sm:bottom-4">Loading...</div>}

      {/* Mobile bottom bar — the Head Physio works this board on a phone between
          patients, where the cards at the top are a stretch away. Same tabs, thumb-high. */}
      <nav className="fixed inset-x-0 bottom-0 z-50 flex border-t border-slate-600 bg-slate-500 shadow-[0_-2px_10px_rgba(0,0,0,0.06)] sm:hidden" data-testid="hp-bottom-nav">
        {WORK_TABS.map((t) => {
          const Icon = t.icon;
          const active = workTab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setWorkTab(t.key)}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold transition ${
                active ? "text-white" : "text-slate-200"
              }`}
              data-testid={`hp-bottom-nav-${t.key}`}
            >
              {/* The active pill was bg-teal-100. On the slate bar the icon inside it is
                  now white, which that pale mint would have swallowed — a translucent
                  white reads as the same chip and leaves the icon legible. */}
              <span className={`rounded-full px-4 py-1 transition ${active ? "bg-white/20" : ""}`}>
                <Icon className="h-5 w-5" />
              </span>
              {t.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
};

/**
 * The Head Physio's own calendar, lifted out of the tab row into a modal opened from the
 * header next to their profile — it's a reference they glance at, not one of the lists
 * they work through, so it no longer takes a slot alongside them.
 */
export const HeadPhysioCalendarModal = ({ branchId, onClose }) => (
  <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-3" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} data-testid="hp-calendar-modal">
    <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
      {/* Black, not slate. The grey read as a disabled bar rather than a header, and it
          is the same grey the phone nav uses two levels down. */}
      <div className="flex items-center justify-between bg-slate-900 px-6 py-4 text-white">
        <div className="flex items-center gap-2.5">
          <CalendarClock className="h-5 w-5" />
          <p className="text-lg font-bold">My Calendar</p>
        </div>
        <button onClick={onClose} className="rounded-lg border-2 border-orange-200 bg-orange-100 p-2 text-orange-600 hover:bg-orange-200" data-testid="hp-calendar-modal-close">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-5">
        <MyCalendarTab branchId={branchId} />
      </div>
    </div>
  </div>
);

// What can be sitting in a Head Physio's slot. Consultation and Review are the two things
// actually booked into one — the colours are the same ones their cards wear on the board
// above, so a violet dot here and the violet Review card are recognisably one thing.
//
// Rehab is deliberately absent. It is a queue of patients waiting for a package to be
// recommended, with no time attached to any of them, so it has nothing to occupy an hour
// with. A third colour in this legend would be one that never appears.
const SLOT_KINDS = {
  consultation: {
    label: "Consultation",
    dot: "bg-sky-500",
    box: "border-sky-200 bg-sky-50 text-sky-700",
  },
  review: {
    label: "Review",
    dot: "bg-violet-500",
    box: "border-violet-200 bg-violet-50 text-violet-700",
  },
  free: {
    label: "Available",
    dot: "bg-slate-300",
    box: "border-slate-200 text-slate-500",
  },
};

const WEEKDAY_HEADS = ["S", "M", "T", "W", "T", "F", "S"];

// "all" first: the filter opens showing everything, and the three after it are the same
// three the legend used to tally, so a reader picks the row they just read a count off.
const CALENDAR_FILTERS = [
  { key: "all", label: "All" },
  { key: "consultation", label: "Consultation" },
  { key: "review", label: "Review" },
  { key: "free", label: "Available" },
];

const isoOfParts = (y, m, d) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * The CONSULTANT's own calendar: a month first, one day at a time after that.
 *
 * It used to print every day it had slots for as one wall of chips — a hundred and forty
 * of them in a single scroll, which answers "what am I doing on the 12th" only by
 * scrolling to the 12th. A month grid answers that at a glance and the day view answers
 * it exactly, so the two together replace the one list that did neither well.
 */
function MyCalendarTab({ branchId }) {
  const [data, setData] = useState({ slots: [], booked: {} });
  const [loading, setLoading] = useState(false);
  const [kindFilter, setKindFilter] = useState("all");
  const [selectedDate, setSelectedDate] = useState(null);
  const [month, setMonth] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  // Set once, so the one-time jump to where the slots actually are cannot fight a reader
  // who has since paged to an empty month on purpose.
  const [jumped, setJumped] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await getHPMyCalendar(branchId)); } catch { /* silent */ }
    setLoading(false);
  }, [branchId]);

  useEffect(() => { load(); }, [load]);

  const kindOf = useCallback((slot) => data.booked?.[slot]?.kind || "free", [data.booked]);

  // Every slot the filter admits, grouped by date. Both the grid and the day view read
  // this, so a day showing "3" and then listing three is guaranteed rather than intended.
  const byDate = useMemo(() => {
    const acc = {};
    (data.slots || []).forEach((slot) => {
      if (kindFilter !== "all" && kindOf(slot) !== kindFilter) return;
      const date = slot.split("T")[0];
      (acc[date] = acc[date] || []).push(slot);
    });
    Object.values(acc).forEach((list) => list.sort());
    return acc;
  }, [data.slots, kindFilter, kindOf]);

  // Open on the month the calendar actually holds, when today's has nothing in it.
  useEffect(() => {
    if (jumped || !(data.slots || []).length) return;
    const dates = (data.slots || []).map((s) => s.split("T")[0]).sort();
    const prefix = `${month.y}-${String(month.m + 1).padStart(2, "0")}`;
    if (!dates.some((d) => d.startsWith(prefix))) {
      const [y, m] = dates[0].split("-");
      setMonth({ y: Number(y), m: Number(m) - 1 });
    }
    setJumped(true);
  }, [data.slots, jumped, month.y, month.m]);

  const tally = useMemo(() => (data.slots || []).reduce((acc, s) => {
    const kind = kindOf(s);
    acc[kind] = (acc[kind] || 0) + 1;
    return acc;
  }, {}), [data.slots, kindOf]);

  const shiftMonth = (delta) => {
    setSelectedDate(null);
    setMonth(({ y, m }) => {
      const next = m + delta;
      if (next < 0) return { y: y - 1, m: 11 };
      if (next > 11) return { y: y + 1, m: 0 };
      return { y, m: next };
    });
  };

  // Leading blanks so the 1st lands under its weekday, then the month's days.
  const cells = useMemo(() => {
    const first = new Date(month.y, month.m, 1).getDay();
    const days = new Date(month.y, month.m + 1, 0).getDate();
    return [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  }, [month]);

  if ((data.slots || []).length === 0 && !loading) {
    return (
      <div className="text-center py-16" data-testid="hp-calendar-empty">
        <Calendar className="h-10 w-10 text-slate-200 mx-auto mb-3" />
        <p className="text-sm text-slate-400">No calendar slots set up yet — ask your branch admin to add availability</p>
      </div>
    );
  }

  const todayStr = todayIso();

  return (
    <div className="space-y-4" data-testid="hp-calendar-tab">
      {/* The filter decides what the grid under it is counting, so it sits above: read
          top-down it says "show me X", then "here is where X falls". */}
      <div className="flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-1" data-testid="hp-calendar-filter">
        {CALENDAR_FILTERS.map((f) => {
          const active = kindFilter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => { setKindFilter(f.key); setSelectedDate(null); }}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"}`}
              data-testid={`hp-calendar-filter-${f.key}`}
            >
              {f.key !== "all" && <span className={`h-2 w-2 rounded-full ${SLOT_KINDS[f.key].dot}`} aria-hidden />}
              {f.label}
              <span className={active ? "text-white/70" : "text-slate-400"}>
                {f.key === "all" ? (data.slots || []).length : (tally[f.key] || 0)}
              </span>
            </button>
          );
        })}
      </div>

      {selectedDate ? (
        <DaySlots
          date={selectedDate}
          slots={byDate[selectedDate] || []}
          booked={data.booked}
          onBack={() => setSelectedDate(null)}
        />
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-4" data-testid="hp-calendar-month">
          <div className="mb-3 flex items-center justify-between">
            <button type="button" onClick={() => shiftMonth(-1)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Previous month" data-testid="hp-calendar-prev-month">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <p className="text-sm font-bold text-slate-800">
              {new Date(month.y, month.m, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
            </p>
            <button type="button" onClick={() => shiftMonth(1)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Next month" data-testid="hp-calendar-next-month">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1">
            {WEEKDAY_HEADS.map((d, i) => (
              <div key={i} className="pb-1 text-center text-[10px] font-bold uppercase tracking-wide text-slate-400">{d}</div>
            ))}
            {cells.map((day, i) => {
              if (day === null) return <div key={`blank-${i}`} />;
              const iso = isoOfParts(month.y, month.m, day);
              const slots = byDate[iso] || [];
              const isToday = iso === todayStr;
              // A day holding nothing the filter admits is not a destination — showing it
              // as pressable and opening an empty panel is a click that answers nothing.
              const has = slots.length > 0;
              return (
                <button
                  key={iso}
                  type="button"
                  disabled={!has}
                  onClick={() => setSelectedDate(iso)}
                  className={`flex min-h-[3.25rem] flex-col items-center justify-center rounded-lg border p-1 transition ${
                    has ? "border-slate-200 bg-white hover:border-teal-300 hover:bg-teal-50" : "border-transparent bg-slate-50/60"
                  } ${isToday ? "ring-1 ring-teal-400" : ""}`}
                  data-testid={`hp-calendar-day-${iso}`}
                >
                  <span className={`text-xs font-bold ${has ? "text-slate-700" : "text-slate-300"}`}>{day}</span>
                  {has && (
                    <span className="mt-0.5 flex items-center gap-0.5" aria-hidden>
                      {["consultation", "review", "free"]
                        .filter((k) => slots.some((sl) => kindOf(sl) === k))
                        .map((k) => <span key={k} className={`h-1.5 w-1.5 rounded-full ${SLOT_KINDS[k].dot}`} />)}
                    </span>
                  )}
                  {has && <span className="text-[9px] font-semibold text-slate-400">{slots.length}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** One day's slots, reached by picking that day out of the month. */
function DaySlots({ date, slots, booked, onBack }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4" data-testid={`hp-calendar-dayview-${date}`}>
      <div className="mb-3 flex items-center gap-2">
        <button type="button" onClick={onBack} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Back to the month" data-testid="hp-calendar-back">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <h4 className="text-sm font-semibold text-slate-700">
          {new Date(date + "T00:00").toLocaleDateString("en-IN", { weekday: "long", month: "short", day: "numeric" })}
        </h4>
        <span className="ml-auto text-[11px] font-semibold text-slate-400">{slots.length} slot{slots.length === 1 ? "" : "s"}</span>
      </div>

      {slots.length === 0 ? (
        <p className="py-8 text-center text-xs text-slate-400">Nothing on this day for the filter above.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {slots.map((slot) => {
            const booking = booked?.[slot];
            const time = to12h(slot.split("T")[1]);
            const meta = SLOT_KINDS[booking?.kind] || SLOT_KINDS.free;
            return (
              <div
                key={slot}
                className={`rounded-lg border px-3 py-2 text-xs ${meta.box}`}
                data-testid={`hp-calendar-slot-${slot}`}
                title={booking ? `${meta.label} · ${booking.lead_name}` : "Available"}
              >
                {/* The dot is what makes a day readable at a glance: the times are all
                    the same length and the names carry no colour, so the kind of work
                    has to be something other than more text to be seen at speed. */}
                <p className="flex items-center gap-1.5 font-semibold">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} aria-hidden />
                  {time}
                </p>
                <p className="text-[10px]">{booking ? booking.lead_name : "Available"}</p>
                {booking && <p className="text-[9px] font-bold uppercase tracking-wider opacity-70">{meta.label}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
