import { useCallback, useEffect, useState } from "react";
import {
  Calendar,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  MessageSquare,
  Send,
  User,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import {
  physioConsultations,
  physioCompleteConsultation,
  physioToday,
  physioCalendar,
  physioPatients,
  physioSessions,
  physioCompleteSession,
  physioWeeklyAssessment,
} from "@/lib/api";
import { to12h, slotTo12h } from "@/lib/time";

const TABS = [
  { key: "consultations", label: "Consultations", icon: ClipboardList },
  { key: "today", label: "Today", icon: Clock },
  { key: "calendar", label: "Full Calendar", icon: CalendarDays },
  { key: "patients", label: "Patients History", icon: Users },
];

export const PhysioBoard = ({ physioId } = {}) => {
  const [activeTab, setActiveTab] = useState("consultations");

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

      {activeTab === "consultations" && <ConsultationsTab physioId={physioId} />}
      {activeTab === "today" && <TodayTab physioId={physioId} />}
      {activeTab === "calendar" && <CalendarTab physioId={physioId} />}
      {activeTab === "patients" && <PatientsTab physioId={physioId} />}
    </div>
  );
};

function ConsultationsTab({ physioId }) {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedLead, setSelectedLead] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await physioConsultations(physioId);
      setLeads(data.leads || []);
    } catch { /* silent */ }
    setLoading(false);
  }, [physioId]);

  useEffect(() => { load(); }, [load]);

  const formatDateTime = (lead) => {
    if (!lead.appointment_date) return "No appointment scheduled yet";
    const time = lead.appointment_time ? ` · ${to12h(lead.appointment_time)}` : "";
    return `${lead.appointment_date}${time}`;
  };

  return (
    <div data-testid="physio-consultations-tab">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-700">Assigned Consultations</h3>
        <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-[10px] font-semibold text-sky-700">{leads.length} assigned</span>
      </div>

      {leads.length === 0 && !loading ? (
        <div className="text-center py-16">
          <ClipboardList className="h-10 w-10 text-slate-200 mx-auto mb-3" />
          <p className="text-sm text-slate-400">No consultations assigned to you yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {leads.map((l) => (
            <button
              type="button"
              key={l.id}
              onClick={() => setSelectedLead(l)}
              className="w-full rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-sky-200 hover:shadow-sm"
              data-testid={`consultation-lead-${l.id}`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{l.name}</p>
                  <p className="text-[10px] text-slate-400">{l.phone}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  {l.physio_stage === "Complete" && (
                    <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-semibold text-emerald-700">Complete</span>
                  )}
                  {l.consultation_stage && (
                    <span className="rounded-full bg-sky-100 px-2.5 py-1 text-[10px] font-semibold text-sky-700">{l.consultation_stage}</span>
                  )}
                </div>
              </div>
              <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-600">
                <Calendar className="h-3.5 w-3.5 text-slate-400" /> {formatDateTime(l)}
              </div>
              {l.condition && <p className="text-[10px] text-slate-400 mt-1">Condition: {l.condition}</p>}
              {l.notes && <p className="text-[10px] text-slate-500 mt-1 whitespace-pre-wrap">{l.notes}</p>}
            </button>
          ))}
        </div>
      )}

      {selectedLead && (
        <ConsultationDetailModal
          lead={selectedLead}
          physioId={physioId}
          onClose={() => setSelectedLead(null)}
          onDone={(updated) => { setSelectedLead(null); setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l))); }}
        />
      )}
    </div>
  );
}

function ConsultationDetailModal({ lead, physioId, onClose, onDone }) {
  const [submitting, setSubmitting] = useState(false);
  const isComplete = lead.physio_stage === "Complete";

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

  const Row = ({ label, value }) => (
    !value ? null : (
      <div>
        <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
        <p className="text-xs text-slate-700">{value}</p>
      </div>
    )
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-2xl rounded-xl bg-white shadow-2xl max-h-[85vh] flex flex-col" data-testid="physio-consultation-detail-modal">
        <div className="flex items-center justify-between border-b p-5">
          <div>
            <h3 className="text-base font-semibold text-slate-800">{lead.name}</h3>
            <p className="text-[10px] text-slate-400">{lead.phone}{lead.email ? ` · ${lead.email}` : ""}</p>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X className="h-5 w-5 text-slate-400" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
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

          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-600">Move to Stage</p>
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
              <Check className="h-3.5 w-3.5" /> {isComplete ? "Complete" : submitting ? "Marking..." : "Mark Complete"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TodayTab({ physioId }) {
  const [data, setData] = useState({ sessions: [], new_assigned: [], date: "" });
  const [loading, setLoading] = useState(false);
  const [completeModal, setCompleteModal] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await physioToday(physioId)); } catch { /* silent */ }
    setLoading(false);
  }, [physioId]);

  useEffect(() => { load(); }, [load]);

  const formatTime = (iso) => (iso ? slotTo12h(iso) : "");

  return (
    <div data-testid="physio-today-tab">
      {(data.new_assigned || []).length > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-700">Newly Assigned Today</h3>
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-semibold text-amber-700">{data.new_assigned.length} new</span>
          </div>
          <div className="space-y-2">
            {data.new_assigned.map((l) => (
              <div key={l.id} className="rounded-xl border border-amber-200 bg-amber-50/50 p-4" data-testid={`today-new-assigned-${l.id}`}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-800">{l.name}</p>
                  <span className="text-[10px] text-slate-400">{l.phone}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 text-[10px] text-slate-500">
                  {l.age && <span>Age: {l.age}</span>}
                  {l.gender && <span>{l.gender}</span>}
                  {l.condition && <span>Condition: {l.condition}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-700">
          Today's Sessions — {new Date().toLocaleDateString("en-IN", { weekday: "long", month: "long", day: "numeric" })}
        </h3>
        <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-[10px] font-semibold text-sky-700">{data.sessions?.length || 0} sessions</span>
      </div>

      {(!data.sessions || data.sessions.length === 0) && !loading ? (
        <div className="text-center py-16">
          <Calendar className="h-10 w-10 text-slate-200 mx-auto mb-3" />
          <p className="text-sm text-slate-400">No sessions scheduled for today</p>
        </div>
      ) : (
        <div className="space-y-2">
          {(data.sessions || []).map((s) => (
            <div
              key={s.id}
              className={`rounded-xl border p-4 flex items-center gap-4 ${
                s.status === "completed"
                  ? "border-emerald-200 bg-emerald-50/50"
                  : "border-slate-200 bg-white"
              }`}
              data-testid={`today-session-${s.id}`}
            >
              <div className={`h-12 w-12 rounded-xl flex items-center justify-center text-lg font-bold ${
                s.status === "completed" ? "bg-emerald-200 text-emerald-800" : "bg-sky-100 text-sky-700"
              }`}>
                {formatTime(s.slot_time)}
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-slate-800">{s.lead_name}</p>
                <p className="text-[10px] text-slate-400">Session #{s.session_number} of {s.total_sessions} · Week {s.week_number}</p>
                {s.jr_physio_remarks && <p className="text-[10px] text-emerald-600 mt-0.5">{s.jr_physio_remarks}</p>}
              </div>
              {s.status === "upcoming" ? (
                <Button size="sm" className="bg-sky-600 hover:bg-sky-700 text-white text-xs" onClick={() => setCompleteModal(s)} data-testid={`complete-session-${s.id}`}>
                  <Check className="h-3 w-3 mr-1" /> Complete
                </Button>
              ) : (
                <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-semibold text-emerald-700">Done</span>
              )}
            </div>
          ))}
        </div>
      )}

      {completeModal && (
        <CompleteSessionModal
          session={completeModal}
          onClose={() => setCompleteModal(null)}
          onDone={() => { setCompleteModal(null); load(); }}
        />
      )}
    </div>
  );
}

function CalendarTab({ physioId }) {
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth() + 1);
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [data, setData] = useState({ sessions: [] });
  const [selectedDate, setSelectedDate] = useState(null);

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
