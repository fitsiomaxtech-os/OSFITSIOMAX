import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Calendar,
  CalendarClock,
  Check,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  FileText,
  LayoutList,
  MessageSquare,
  Package,
  Send,
  Stethoscope,
  User,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { ConsultationsBoard } from "@/components/ConsultationsBoard";
import { HeadPhysioReviewTab } from "@/components/HeadPhysioReviewTab";
import { WeekStrip, todayIso } from "@/components/WeekStrip";
import {
  getHPMyCalendar,
  getHPMyPatients,
  hpRecommendPackage,
  hpGetAssessments,
  hpWeeklyReview,
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
};

const WORK_TABS = [
  { key: "consultations", label: "Consultations", icon: Calendar },
  { key: "review", label: "Review", icon: ClipboardCheck },
  { key: "rehab", label: "Rehab", icon: Activity },
  { key: "all", label: "All", icon: LayoutList },
];

export const HeadPhysioBoard = ({ branchId, branchIds, user, search = "" }) => {
  const [workTab, setWorkTab] = useState("consultations");
  // The day every list under Consultations answers to. Starts on today.
  const [workDate, setWorkDate] = useState(todayIso());
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
  const [patients, setPatients] = useState([]);
  // New Rehab is a patient with no package recommended yet — the same shape as the other
  // cards: what is still waiting on this Head Physio, not everything on their list.
  // Whatever the first head-consultation stage is currently called.
  const firstStage = consultStageNames[0] || null;

  const q = search.trim().toLowerCase();
  const matches = (...fields) => !q || fields.some((f) => String(f || "").toLowerCase().includes(q));
  const visiblePatients = patients.filter((p) => matches(p.lead_name, p.phone));
  const newRehab = visiblePatients.filter((p) => !p.has_recommendation);

  // All is one list, not three stacked sections — the same patient can be in more than one
  // of them, and reading three tables to find the day's work defeats the point. Every row
  // is flattened to the same shape and carries the stage it came from, so the mix stays
  // legible.
  const allRows = useMemo(() => [
    ...consultRows.map((l) => ({
      key: `c-${l.id}`,
      name: l.name || "Unknown",
      patientNo: l.patient_number || "",
      phone: l.phone || "",
      stage: l.head_consultation_stage || l.consultation_stage || "Consultation",
      tone: "sky",
      when: l.appointment_date ? `${l.appointment_date} ${to12h(l.appointment_time)}` : "",
      who: l.assigned_physio_name || "",
    })),
    ...reviewRows.filter((r) => matches(r.lead_name, r.phone, r.patient_number)).map((r) => ({
      key: `r-${r.id}`,
      name: r.lead_name || "Unknown",
      patientNo: r.patient_number || "",
      phone: r.phone || "",
      stage: r.status === "completed" ? "Review · Completed" : "Review",
      tone: r.status === "completed" ? "emerald" : "violet",
      when: r.review_date || "",
      who: r.physio_name || "",
    })),
    ...visiblePatients.map((p) => ({
      key: `p-${p.lead_id}`,
      name: p.lead_name || "Unknown",
      patientNo: "",
      phone: p.phone || "",
      stage: p.has_recommendation ? "Rehab · Recommended" : "Rehab",
      tone: p.has_recommendation ? "emerald" : "amber",
      when: "",
      who: p.branch_stage || "",
    })),
  ], [consultRows, reviewRows, visiblePatients]);
  const [loading, setLoading] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [showRecommendModal, setShowRecommendModal] = useState(null);
  const [showReviewModal, setShowReviewModal] = useState(null);

  // Head Physios cover every branch and carry none of their own, so "all" is the normal
  // case here — without it the board asked for branch `undefined` and every list came back
  // empty while the appointments sat there booked.
  const assignedBranchIds = branchIds && branchIds.length ? branchIds : (branchId ? [branchId] : []);
  const effectiveBranchId = assignedBranchIds[0] || branchId || "all";

  const loadPatients = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getHPMyPatients(effectiveBranchId);
      setPatients(data.patients || []);
    } catch { /* silent */ }
    setLoading(false);
  }, [effectiveBranchId]);

  useEffect(() => { loadPatients(); }, [loadPatients]);

  return (
    // Bottom padding on phones clears the fixed bottom bar, so the last row of any list
    // is still reachable instead of sitting underneath it.
    <div className="space-y-4 pb-20 sm:pb-0" data-testid="head-physio-board-root">
      {/* Two regions. The left is deliberately left empty — reserved space, not a gap to
          be filled later by whatever comes along. The day filter takes only the width it
          needs on the right, divided off from it. */}
      <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-2 lg:flex-row lg:items-center lg:gap-4">
        <div className="hidden min-h-[2.25rem] flex-1 lg:block" data-testid="hp-header-reserved" />
        <div className="shrink-0 lg:border-l lg:border-slate-100 lg:pl-4" data-testid="hp-header-day-filter">
          <WeekStrip value={workDate} onChange={setWorkDate} testid="hp-week-strip" bare />
        </div>
      </div>

      <div className="space-y-4" data-testid="hp-work-view">
          {/* The board's navigation and its stage filter in one. Each card carries the
              count behind it, so the day's workload reads without opening anything.
              Two-up on phones, four across from tablet; the bottom bar stays for
              thumb reach. */}
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:grid sm:grid-cols-4 sm:gap-3 sm:overflow-visible sm:px-0 sm:pb-0" data-testid="hp-work-tabs">
            {WORK_TABS.map((t) => {
              const Icon = t.icon;
              const active = workTab === t.key;
              const n = t.key === "consultations" ? (consultStages[firstStage] || 0)
                : t.key === "review" ? reviewCount
                : t.key === "rehab" ? newRehab.length
                // All is the three of them together, every stage, nothing narrowed.
                : consultCount + reviewCount + patients.length;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setWorkTab(t.key)}
                  className={`w-[7.5rem] shrink-0 rounded-xl border-2 px-3 py-2.5 text-left transition sm:w-auto sm:px-4 sm:py-4 ${
                    active
                      ? "border-teal-600 bg-teal-50 shadow-sm"
                      : "border-slate-200 bg-white hover:border-teal-300 hover:shadow-sm"
                  }`}
                  data-testid={`hp-work-tab-${t.key}`}
                >
                  <span className={`flex items-center gap-1.5 ${active ? "text-teal-700" : "text-slate-500"}`}>
                    <Icon className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
                    <span className="truncate text-[10px] font-bold uppercase tracking-wider sm:text-xs">{t.label}</span>
                  </span>
                  <span className={`mt-0.5 block text-2xl font-extrabold sm:mt-1 sm:text-3xl ${active ? "text-teal-700" : "text-slate-800"}`}>
                    {n}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Both stay mounted and hidden rather than unmounted, so every card keeps a
              live count whichever one is open, and switching costs no refetch. */}
          <div className={workTab === "consultations" ? "" : "hidden"} data-testid="hp-work-consultations">
            <ConsultationsBoard
              branchId={effectiveBranchId}
              viewerRole="head_physio"
              externalDate={workDate}
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
            />
          </div>

          <div className={workTab === "review" ? "" : "hidden"} data-testid="hp-work-review">
            <HeadPhysioReviewTab
              selectedDate={workDate}
              compact={workTab === "all"}
              onCountChange={setReviewCount}
              onRowsChange={setReviewRows}
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
                {allRows.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-200 px-3 py-10 text-center text-sm text-slate-400">Nothing on this day.</p>
                ) : allRows.map((r) => (
                  <div key={r.key} className="rounded-xl border border-slate-200 bg-white p-3" data-testid={`hp-all-card-${r.key}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-slate-800">{r.name}</p>
                        <p className="truncate text-xs text-slate-500">{r.phone || "—"}</p>
                      </div>
                      <span className={`shrink-0 whitespace-nowrap rounded-[5px] border px-2 py-0.5 text-[10px] font-bold ${STAGE_TONES[r.tone]}`}>
                        {r.stage}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                      {r.patientNo && <span className="font-mono">{r.patientNo}</span>}
                      {r.who && <span>· {r.who}</span>}
                      {r.when && <span>· {r.when}</span>}
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white sm:block">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wider text-slate-400">
                    <tr>
                      {/* Patient stays left — it's the column the eye scans down to find
                          a row, and a ragged left edge is exactly what makes a name list
                          hard to scan. Everything after it is centred. */}
                      <th className="px-4 py-2.5 text-left font-semibold">Patient</th>
                      <th className="px-4 py-2.5 text-center font-semibold">Patient No.</th>
                      <th className="px-4 py-2.5 text-center font-semibold">Phone</th>
                      <th className="px-4 py-2.5 text-center font-semibold">Stage</th>
                      <th className="px-4 py-2.5 text-center font-semibold">Expert / Branch</th>
                      <th className="px-4 py-2.5 text-center font-semibold">When</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {allRows.length === 0 ? (
                      <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-400">Nothing on this day.</td></tr>
                    ) : allRows.map((r) => (
                      <tr key={r.key} className="hover:bg-slate-50" data-testid={`hp-all-row-${r.key}`}>
                        <td className="px-4 py-3 text-left font-medium text-slate-800">{r.name}</td>
                        <td className="px-4 py-3 text-center font-mono text-[11px] text-slate-400">{r.patientNo || "—"}</td>
                        <td className="px-4 py-3 text-center text-slate-600">{r.phone || "—"}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex whitespace-nowrap rounded-[5px] border px-2 py-0.5 text-[10px] font-bold ${STAGE_TONES[r.tone]}`}>
                            {r.stage}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center text-slate-600">{r.who || "—"}</td>
                        <td className="px-4 py-3 text-center text-slate-500">{r.when || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </div>
            </div>
          )}

          {workTab === "rehab" && (
            <div className="space-y-6" data-testid="hp-work-rehab">
              <PatientsTab
                patients={newRehab}
                onRecommend={(p) => setShowRecommendModal(p)}
                onSelect={(p) => setSelectedPatient(p)}
                loading={loading}
              />
              <div className="border-t border-slate-200 pt-5">
                <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">Weekly Assessments</p>
                <AssessmentsTab
                  patients={patients}
                  onReview={(p, w) => setShowReviewModal({ patient: p, week: w })}
                />
              </div>
            </div>
          )}
      </div>

      {showRecommendModal && (
        <RecommendPackageModal
          patient={showRecommendModal}
          onClose={() => setShowRecommendModal(null)}
          onDone={() => { setShowRecommendModal(null); loadPatients(); }}
        />
      )}

      {showReviewModal && (
        <WeeklyReviewModal
          patient={showReviewModal.patient}
          week={showReviewModal.week}
          onClose={() => setShowReviewModal(null)}
          onDone={() => { setShowReviewModal(null); loadPatients(); }}
        />
      )}

      {selectedPatient && (
        <PatientSessionsModal
          patient={selectedPatient}
          onClose={() => setSelectedPatient(null)}
        />
      )}

      {/* Sits above the bottom bar on phones so it never covers the nav. */}
      {loading && <div className="fixed bottom-20 right-4 z-40 rounded-md bg-slate-900 px-3 py-2 text-sm text-white sm:bottom-4">Loading...</div>}

      {/* Mobile bottom bar — the Head Physio works this board on a phone between
          patients, where the cards at the top are a stretch away. Same four, thumb-high. */}
      <nav className="fixed inset-x-0 bottom-0 z-50 flex border-t border-slate-200 bg-white shadow-[0_-2px_10px_rgba(0,0,0,0.06)] sm:hidden" data-testid="hp-bottom-nav">
        {WORK_TABS.map((t) => {
          const Icon = t.icon;
          const active = workTab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setWorkTab(t.key)}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold transition ${
                active ? "text-teal-700" : "text-slate-400"
              }`}
              data-testid={`hp-bottom-nav-${t.key}`}
            >
              <span className={`rounded-full px-4 py-1 transition ${active ? "bg-teal-100" : ""}`}>
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
      <div className="flex items-center justify-between bg-slate-500 px-6 py-4 text-white">
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

function MyCalendarTab({ branchId }) {
  const [data, setData] = useState({ slots: [], booked: {} });
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await getHPMyCalendar(branchId)); } catch { /* silent */ }
    setLoading(false);
  }, [branchId]);

  useEffect(() => { load(); }, [load]);

  const grouped = [...(data.slots || [])].sort().reduce((acc, slot) => {
    const date = slot.split("T")[0];
    (acc[date] = acc[date] || []).push(slot);
    return acc;
  }, {});
  const dates = Object.keys(grouped).sort();

  if (dates.length === 0 && !loading) {
    return (
      <div className="text-center py-16" data-testid="hp-calendar-empty">
        <Calendar className="h-10 w-10 text-slate-200 mx-auto mb-3" />
        <p className="text-sm text-slate-400">No calendar slots set up yet — ask your branch admin to add availability</p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="hp-calendar-tab">
      {dates.map((date) => (
        <div key={date} className="rounded-xl border border-slate-200 bg-white p-4" data-testid={`hp-calendar-day-${date}`}>
          <h4 className="text-sm font-semibold text-slate-700 mb-2">
            {new Date(date + "T00:00").toLocaleDateString("en-IN", { weekday: "long", month: "short", day: "numeric" })}
          </h4>
          <div className="flex flex-wrap gap-2">
            {grouped[date].map((slot) => {
              const booking = data.booked?.[slot];
              const time = to12h(slot.split("T")[1]);
              return (
                <div
                  key={slot}
                  className={`rounded-lg border px-3 py-2 text-xs ${booking ? "border-teal-200 bg-teal-50 text-teal-700" : "border-slate-200 text-slate-500"}`}
                  data-testid={`hp-calendar-slot-${slot}`}
                >
                  <p className="font-semibold">{time}</p>
                  <p className="text-[10px]">{booking ? booking.lead_name : "Available"}</p>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function PatientsTab({ patients, onRecommend, onSelect, loading }) {
  if (patients.length === 0 && !loading) {
    return (
      <div className="text-center py-16">
        <Stethoscope className="h-10 w-10 text-slate-200 mx-auto mb-3" />
        <p className="text-sm text-slate-400">No patients assigned yet</p>
      </div>
    );
  }

  // A list rather than a card grid: these are read down a column and compared — who has a
  // package, who is still waiting — which a grid of three-across cards makes harder than
  // it needs to be.
  return (
    <div data-testid="hp-patients-list">
      {/* Cards on a phone, the table from sm — same rows either way. */}
      <div className="space-y-2 sm:hidden">
        {patients.map((p) => (
          <div key={p.lead_id} className="rounded-xl border border-slate-200 bg-white p-3" data-testid={`hp-patient-card-${p.lead_id}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-50 text-xs font-bold text-teal-700">
                  {p.lead_name?.charAt(0)?.toUpperCase() || "?"}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-800">{p.lead_name}</p>
                  <p className="truncate text-xs text-slate-500">{p.phone || "—"}</p>
                </div>
              </div>
              <span className={`shrink-0 whitespace-nowrap rounded-[5px] px-2 py-0.5 text-[10px] font-bold ${
                p.branch_stage === "Portfolio" ? "bg-emerald-100 text-emerald-700"
                  : p.has_recommendation ? "bg-violet-100 text-violet-700"
                  : "bg-slate-100 text-slate-500"
              }`}>
                {p.branch_stage || "—"}
              </span>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              {p.recommendation
                ? `${p.recommendation.recommended_weeks}w × ${p.recommendation.sessions_per_week}/week = ${p.recommendation.total_sessions} sessions · ${p.recommendation.status}`
                : "Not recommended yet"}
            </p>
            <div className="mt-2.5 flex gap-2">
              <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => onSelect(p)}>
                <Calendar className="mr-1 h-3 w-3" /> Sessions
              </Button>
              {!p.has_recommendation && (
                <Button size="sm" className="flex-1 bg-teal-600 text-xs text-white hover:bg-teal-700" onClick={() => onRecommend(p)}>
                  <Package className="mr-1 h-3 w-3" /> Recommend
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white sm:block">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Patient</th>
              <th className="px-4 py-2.5 font-semibold">Phone</th>
              <th className="px-4 py-2.5 font-semibold">Stage</th>
              <th className="px-4 py-2.5 font-semibold">Recommendation</th>
              <th className="px-4 py-2.5 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {patients.map((p) => (
              <tr key={p.lead_id} className="hover:bg-slate-50" data-testid={`hp-patient-${p.lead_id}`}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-50 text-xs font-bold text-teal-700">
                      {p.lead_name?.charAt(0)?.toUpperCase() || "?"}
                    </span>
                    <span className="font-medium text-slate-800">{p.lead_name}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-600">{p.phone || "—"}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex whitespace-nowrap rounded-[5px] px-2 py-0.5 text-[10px] font-bold ${
                    p.branch_stage === "Portfolio" ? "bg-emerald-100 text-emerald-700"
                      : p.has_recommendation ? "bg-violet-100 text-violet-700"
                      : "bg-slate-100 text-slate-500"
                  }`}>
                    {p.branch_stage || "—"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {p.recommendation ? (
                    <div>
                      <p className="text-xs font-semibold text-violet-800">
                        {p.recommendation.recommended_weeks}w × {p.recommendation.sessions_per_week}/week
                        {" = "}{p.recommendation.total_sessions} sessions
                      </p>
                      <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[9px] font-semibold ${
                        p.recommendation.status === "assigned" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                      }`}>
                        {p.recommendation.status}
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-400">Not recommended yet</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <Button size="sm" variant="outline" className="text-xs" onClick={() => onSelect(p)} data-testid={`hp-view-sessions-${p.lead_id}`}>
                      <Calendar className="mr-1 h-3 w-3" /> Sessions
                    </Button>
                    {!p.has_recommendation && (
                      <Button size="sm" className="bg-teal-600 text-xs text-white hover:bg-teal-700" onClick={() => onRecommend(p)} data-testid={`hp-recommend-${p.lead_id}`}>
                        <Package className="mr-1 h-3 w-3" /> Recommend
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </div>
    </div>
  );
}

function AssessmentsTab({ patients, onReview }) {
  const patientsWithSessions = patients.filter((p) => p.recommendation?.status === "assigned");

  if (patientsWithSessions.length === 0) {
    return (
      <div className="text-center py-16">
        <ClipboardList className="h-10 w-10 text-slate-200 mx-auto mb-3" />
        <p className="text-sm text-slate-400">No active sessions to review yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="hp-assessments-list">
      {patientsWithSessions.map((p) => {
        const weeks = p.recommendation?.recommended_weeks || 0;
        return (
          <div key={p.lead_id} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-50 text-xs font-bold text-teal-700">
                {p.lead_name?.charAt(0)?.toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800">{p.lead_name}</p>
                <p className="text-[10px] text-slate-400">{weeks} weeks program</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: weeks }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => onReview(p, i + 1)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-teal-50 hover:border-teal-200 hover:text-teal-700 transition-all"
                  data-testid={`hp-review-week-${i + 1}`}
                >
                  Week {i + 1}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RecommendPackageModal({ patient, onClose, onDone }) {
  const [weeks, setWeeks] = useState(8);
  const [sessionsPerWeek, setSessionsPerWeek] = useState(3);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await hpRecommendPackage({
        lead_id: patient.lead_id,
        recommended_weeks: weeks,
        sessions_per_week: sessionsPerWeek,
        notes,
      });
      toast.success("Package recommended successfully");
      onDone();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed");
    }
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} data-testid="recommend-modal-overlay">
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-xl bg-white shadow-2xl" data-testid="recommend-modal">
        <div className="flex items-center justify-between border-b p-5">
          <h3 className="text-base font-semibold text-slate-800">Recommend Package — {patient.lead_name}</h3>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X className="h-5 w-5 text-slate-400" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Weeks</label>
              <Input type="number" value={weeks} onChange={(e) => setWeeks(parseInt(e.target.value) || 1)} min={1} data-testid="rec-weeks" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Sessions/Week</label>
              <Input type="number" value={sessionsPerWeek} onChange={(e) => setSessionsPerWeek(parseInt(e.target.value) || 1)} min={1} data-testid="rec-sessions" />
            </div>
          </div>
          <div className="rounded-lg bg-teal-50 p-3 text-center">
            <p className="text-2xl font-bold text-teal-700">{weeks * sessionsPerWeek}</p>
            <p className="text-[10px] text-teal-500">Total Sessions</p>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">Notes / Treatment Plan</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Focus areas, exercises, precautions..."
              rows={3}
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              data-testid="rec-notes"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t p-4">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSubmit} disabled={submitting} className="bg-teal-600 hover:bg-teal-700 text-white" data-testid="rec-submit">
            {submitting ? "Submitting..." : "Recommend Package"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function WeeklyReviewModal({ patient, week, onClose, onDone }) {
  const [hpNotes, setHpNotes] = useState("");
  const [suggestions, setSuggestions] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [existingData, setExistingData] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await hpGetAssessments(patient.lead_id);
        const existing = (data.assessments || []).find((a) => a.week_number === week);
        if (existing) {
          setExistingData(existing);
          setHpNotes(existing.head_physio_notes || "");
          setSuggestions(existing.head_physio_suggestions || "");
        }
      } catch { /* silent */ }
    })();
  }, [patient.lead_id, week]);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await hpWeeklyReview(patient.lead_id, week, {
        head_physio_notes: hpNotes,
        head_physio_suggestions: suggestions,
      });
      toast.success("Review submitted");
      onDone();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed");
    }
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} data-testid="review-modal-overlay">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white shadow-2xl" data-testid="review-modal">
        <div className="flex items-center justify-between border-b p-5">
          <h3 className="text-base font-semibold text-slate-800">{patient.lead_name} — Week {week} Review</h3>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X className="h-5 w-5 text-slate-400" /></button>
        </div>
        <div className="p-5 space-y-4">
          {existingData?.jr_physio_notes && (
            <div className="rounded-lg bg-blue-50 border border-blue-100 p-3">
              <p className="text-[10px] font-semibold text-blue-600 uppercase mb-1">Jr. Physio's Notes</p>
              <p className="text-xs text-blue-800">{existingData.jr_physio_notes}</p>
            </div>
          )}
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block flex items-center gap-1">
              <MessageSquare className="h-3 w-3" /> Your Notes <span className="text-[9px] text-red-400">(Private — patient can't see)</span>
            </label>
            <textarea value={hpNotes} onChange={(e) => setHpNotes(e.target.value)} rows={3} placeholder="Observations, progress notes..." className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" data-testid="review-hp-notes" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block flex items-center gap-1">
              <FileText className="h-3 w-3" /> Suggestions <span className="text-[9px] text-red-400">(Private)</span>
            </label>
            <textarea value={suggestions} onChange={(e) => setSuggestions(e.target.value)} rows={2} placeholder="Adjustments for next week..." className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" data-testid="review-suggestions" />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t p-4">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSubmit} disabled={submitting} className="bg-teal-600 hover:bg-teal-700 text-white" data-testid="review-submit">
            {submitting ? "Submitting..." : "Submit Review"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function PatientSessionsModal({ patient, onClose }) {
  const [sessions, setSessions] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const data = await physioSessions(patient.lead_id);
        setSessions(data.sessions || []);
      } catch { /* silent */ }
    })();
  }, [patient.lead_id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-2xl rounded-xl bg-white shadow-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between border-b p-5">
          <h3 className="text-base font-semibold text-slate-800">{patient.lead_name} — Sessions</h3>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X className="h-5 w-5 text-slate-400" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {sessions.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-8">No sessions assigned yet</p>
          ) : (
            <div className="space-y-2">
              {sessions.map((s) => (
                <div key={s.id} className={`rounded-lg border p-3 flex items-center gap-3 ${s.status === "completed" ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"}`}>
                  <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold ${s.status === "completed" ? "bg-emerald-200 text-emerald-800" : "bg-slate-100 text-slate-500"}`}>
                    {s.session_number}
                  </div>
                  <div className="flex-1">
                    <p className="text-xs font-medium text-slate-700">Session #{s.session_number} · Week {s.week_number}</p>
                    <p className="text-[10px] text-slate-400">{s.slot_time ? `${s.slot_time.split("T")[0]} at ${slotTo12h(s.slot_time)}` : "—"}</p>
                    {s.jr_physio_remarks && <p className="text-[10px] text-emerald-600 mt-0.5">Remarks: {s.jr_physio_remarks}</p>}
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${s.status === "completed" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                    {s.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
