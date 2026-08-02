import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Calendar,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Send,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import {
  physioConsultations,
  physioCompleteConsultation,
  physioCalendar,
  physioPatients,
  physioSessions,
  physioCompleteSession,
  physioWeeklyAssessment,
} from "@/lib/api";
import { to12h, slotTo12h } from "@/lib/time";

const TABS = [
  { key: "treatment", label: "Treatment", icon: ClipboardList },
  { key: "review", label: "Review", icon: ClipboardCheck },
  { key: "calendar", label: "Calendar", icon: CalendarDays },
  { key: "patients", label: "Patients History", icon: Users },
];

export const PhysioBoard = ({ physioId } = {}) => {
  const [activeTab, setActiveTab] = useState("treatment");

  return (
    <div className="space-y-4" data-testid="physio-board-root">
      <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? "border-sky-500 text-sky-700"
                  : "border-transparent text-slate-400 hover:text-slate-600"
              }`}
              data-testid={`physio-tab-${tab.key}`}
            >
              <Icon className="h-4 w-4" /> {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "treatment" && <TreatmentTab physioId={physioId} />}
      {activeTab === "review" && <ReviewTab physioId={physioId} />}
      {activeTab === "calendar" && <CalendarTab physioId={physioId} />}
      {activeTab === "patients" && <PatientsTab physioId={physioId} />}
    </div>
  );
};

const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const shiftIso = (iso, days) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return isoOf(d);
};
// Seven days at a time, newest on the left, with the anchored day in the middle.
const DAY_STRIP_LENGTH = 7;
const DAY_STRIP_HALF = Math.floor(DAY_STRIP_LENGTH / 2);

function TreatmentTab({ physioId }) {
  const [leads, setLeads] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedLead, setSelectedLead] = useState(null);

  const todayIso = isoOf(new Date());
  const [selectedDate, setSelectedDate] = useState(todayIso);
  // Held apart from the selected day so clicking a chip only moves the highlight —
  // the arrows are the only thing that slides the seven-day window.
  const [stripCentre, setStripCentre] = useState(todayIso);

  const stripDates = useMemo(
    () => Array.from({ length: DAY_STRIP_LENGTH }, (_, i) => shiftIso(stripCentre, DAY_STRIP_HALF - i)),
    [stripCentre],
  );

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

  // Treatment days ticked off out of however many were booked for this patient.
  const completeDays = (lead) => (
    lead?.total_sessions ? `${lead.completed_sessions || 0} of ${lead.total_sessions}` : null
  );

  const leadById = useMemo(() => Object.fromEntries(leads.map((l) => [l.id, l])), [leads]);

  // Everything on the selected day: the branch-booked appointment, plus any treatment
  // day scheduled that date. Both land in the same list, earliest time first.
  const dayRows = useMemo(() => {
    const rows = leads
      .filter((l) => l.appointment_date === selectedDate)
      .map((l) => ({ key: `appt-${l.id}`, lead: l, time: l.appointment_time || "", label: "Appointment" }));
    sessions
      .filter((s) => (s.slot_time || "").startsWith(selectedDate))
      .forEach((s) => {
        const lead = leadById[s.lead_id];
        rows.push({
          key: `day-${s.id}`,
          lead: lead || { id: s.lead_id, name: s.lead_name },
          time: (s.slot_time.split("T")[1] || "").slice(0, 5),
          label: `Day ${s.session_number} of ${s.total_sessions}`,
        });
      });
    return rows.sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  }, [leads, sessions, leadById, selectedDate]);

  const countFor = (date) => (
    leads.filter((l) => l.appointment_date === date).length
    + sessions.filter((s) => (s.slot_time || "").startsWith(date)).length
  );

  return (
    <div data-testid="physio-treatment-tab">
      {/* Day strip — newest on the left, today anchored in the middle on first load. */}
      <div className="mb-4 flex w-full items-center gap-1.5 rounded-lg border border-slate-200 bg-white p-1.5" data-testid="physio-treatment-day-strip">
        <Button size="sm" variant="outline" className="shrink-0" onClick={() => setStripCentre((c) => shiftIso(c, 1))} data-testid="physio-day-strip-newer">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        {stripDates.map((date) => {
          const d = new Date(`${date}T00:00:00`);
          const isSelected = date === selectedDate;
          const isToday = date === todayIso;
          const n = countFor(date);
          return (
            <button
              key={date}
              type="button"
              onClick={() => setSelectedDate(date)}
              className={`min-w-0 flex-1 basis-0 rounded-md border py-1.5 text-center leading-tight transition ${
                isSelected
                  ? "border-sky-600 bg-sky-600 text-white shadow-sm"
                  : isToday
                  ? "border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
              title={isToday ? "Today" : undefined}
              data-testid={`physio-day-${date}`}
            >
              <span className="block truncate px-1 text-sm font-semibold">
                {d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </span>
              <span className={`block text-[10px] font-medium ${isSelected ? "text-sky-100" : "text-slate-400"}`}>
                {d.toLocaleDateString("en-US", { weekday: "short" })}{n > 0 ? ` · ${n}` : ""}
              </span>
            </button>
          );
        })}
        <Button size="sm" variant="outline" className="shrink-0" onClick={() => setStripCentre((c) => shiftIso(c, -1))} data-testid="physio-day-strip-older">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {dayRows.length === 0 && !loading ? (
        <div className="text-center py-16">
          <ClipboardList className="h-10 w-10 text-slate-200 mx-auto mb-3" />
          <p className="text-sm text-slate-400">
            Nothing booked for {new Date(`${selectedDate}T00:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </p>
        </div>
      ) : (
        <div className="overflow-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Patient</th>
                <th className="px-4 py-2.5">Phone</th>
                <th className="px-4 py-2.5">Stage</th>
                <th className="px-4 py-2.5">Complete Days</th>
                <th className="px-4 py-2.5">Updated</th>
                <th className="px-4 py-2.5">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {dayRows.map((r) => {
                const l = r.lead;
                return (
                  <tr
                    key={r.key}
                    onClick={() => l?.phone !== undefined && setSelectedLead(l)}
                    className="cursor-pointer transition-colors hover:bg-slate-50"
                    data-testid={`consultation-lead-${l.id}`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-sky-50 text-xs font-bold text-sky-700">
                          {l.name?.charAt(0)?.toUpperCase() || "?"}
                        </span>
                        <div className="min-w-0">
                          <span className="block font-medium text-slate-800">{l.name}</span>
                          <span className="block text-[10px] text-slate-400">{r.label}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{l.phone || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                        l.physio_stage === "Complete" ? "bg-emerald-100 text-emerald-700" : "bg-sky-100 text-sky-700"
                      }`}>
                        {l.physio_stage === "Complete" ? "Complete" : (l.consultation_stage || "New Appointment")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{completeDays(l) || "—"}</td>
                    <td className="px-4 py-3 text-slate-500">{(l.updated_at || "").slice(0, 10) || "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{r.time ? to12h(r.time) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selectedLead && (
        <ConsultationDetailModal
          lead={selectedLead}
          physioId={physioId}
          // Days are completed inside the popup, so re-pull on close to refresh the counts.
          onClose={() => { setSelectedLead(null); load(); }}
          onDone={() => { setSelectedLead(null); load(); }}
        />
      )}
    </div>
  );
}

function ReviewTab({ physioId }) {
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(false);
  const [weeksTarget, setWeeksTarget] = useState(null); // patient whose weeks are being picked
  const [assessmentTarget, setAssessmentTarget] = useState(null); // { leadId, leadName, week } | null

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await physioPatients(physioId);
      // A patient only reaches Review once at least one treatment day has been
      // completed in Treatment — that completed day is what there is to write up.
      setPatients((data.patients || []).filter((p) => (p.completed_sessions || 0) > 0));
    } catch { /* silent */ }
    setLoading(false);
  }, [physioId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div data-testid="physio-review-tab">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-700">Weekly Reviews</h3>
        <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-[10px] font-semibold text-sky-700">{patients.length} patients</span>
      </div>

      {patients.length === 0 && !loading ? (
        <div className="text-center py-16">
          <ClipboardCheck className="h-10 w-10 text-slate-200 mx-auto mb-3" />
          <p className="text-sm text-slate-400">Nothing to review yet — complete a treatment day first</p>
        </div>
      ) : (
        <div className="overflow-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Patient</th>
                <th className="px-4 py-2.5">Phone</th>
                <th className="px-4 py-2.5">Stage</th>
                <th className="px-4 py-2.5">Complete Days</th>
                <th className="px-4 py-2.5">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {patients.map((p) => (
                <tr
                  key={p.lead_id}
                  onClick={() => setWeeksTarget(p)}
                  className="cursor-pointer transition-colors hover:bg-slate-50"
                  data-testid={`physio-review-patient-${p.lead_id}`}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-sky-50 text-xs font-bold text-sky-700">
                        {p.lead_name?.charAt(0)?.toUpperCase() || "?"}
                      </span>
                      <span className="font-medium text-slate-800">{p.lead_name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{p.phone || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                      p.physio_stage === "Complete" ? "bg-emerald-100 text-emerald-700" : "bg-sky-100 text-sky-700"
                    }`}>
                      {p.physio_stage === "Complete" ? "Complete" : (p.consultation_stage || "In Treatment")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{p.completed_sessions} of {p.total_sessions}</td>
                  <td className="px-4 py-3 text-slate-500">{(p.updated_at || "").slice(0, 10) || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
                  {weeksTarget.completed_sessions} of {weeksTarget.total_sessions} days complete
                </p>
              </div>
              <button type="button" onClick={() => setWeeksTarget(null)} className="rounded-full p-1.5 text-white/80 hover:bg-white/20"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-5">
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

function ConsultationDetailModal({ lead, physioId, onClose, onDone }) {
  const [submitting, setSubmitting] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [completeTarget, setCompleteTarget] = useState(null);
  const isComplete = lead.physio_stage === "Complete";

  const loadSessions = useCallback(async () => {
    try {
      const data = await physioSessions(lead.id);
      setSessions(data.sessions || []);
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
                  return (
                    <div
                      key={s.id}
                      className={`flex items-center gap-3 rounded-lg border p-3 ${done ? "border-emerald-200 bg-emerald-50/50" : "border-slate-200 bg-white"}`}
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
                      ) : (
                        <Button
                          size="sm"
                          className="shrink-0 bg-sky-600 text-xs text-white hover:bg-sky-700"
                          onClick={() => setCompleteTarget(s)}
                          data-testid={`physio-complete-day-${s.id}`}
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
          <p className="text-[11px] text-slate-500">Completing a day sends that week's session to Review for a weekly write-up.</p>
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

function CalendarTab({ physioId }) {
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
    <div className="flex gap-4" data-testid="physio-calendar-tab">
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
          {Array.from({ length: firstDay }, (_, i) => <div key={`e-${i}`} className="h-16" />)}
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
                className={`h-16 rounded-lg text-xs font-medium p-1 flex flex-col items-center transition-all ${
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
      <div className="w-80 rounded-xl border border-slate-200 bg-white p-4 overflow-y-auto max-h-[600px]">
        {!selectedDate ? (
          <div className="flex items-center justify-center h-48">
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
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-50 text-sm font-bold text-sky-700">
                  {p.lead_name?.charAt(0)?.toUpperCase()}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-slate-800">{p.lead_name}</p>
                  <p className="text-[10px] text-slate-400">{p.phone} · {p.package_weeks || "?"} weeks program</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-center">
                    <p className="text-lg font-bold text-emerald-600">{p.completed_sessions}</p>
                    <p className="text-[9px] text-slate-400">Done</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-sky-600">{p.remaining_sessions}</p>
                    <p className="text-[9px] text-slate-400">Left</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-slate-600">{p.total_sessions}</p>
                    <p className="text-[9px] text-slate-400">Total</p>
                  </div>
                </div>
                <Button size="sm" variant="outline" className="text-xs" onClick={() => setSelectedPatient(p)} data-testid={`physio-view-patient-${p.lead_id}`}>
                  <ClipboardList className="h-3 w-3 mr-1" /> Details
                </Button>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
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
