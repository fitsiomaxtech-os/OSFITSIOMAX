import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  Calendar,
  CalendarClock,
  Check,
  ChevronRight,
  ClipboardList,
  FileText,
  MessageSquare,
  Package,
  Phone,
  Send,
  Stethoscope,
  User,
  UserCircle,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { ConsultationsBoard } from "@/components/ConsultationsBoard";
import {
  getHPMyCalendar,
  getHPMyPatients,
  hpRecommendPackage,
  hpGetAssessments,
  hpWeeklyReview,
  physioSessions,
} from "@/lib/api";

const VIEW_TABS = [
  { key: "consultations", label: "Consultations", icon: Calendar },
  { key: "assessments", label: "Review", icon: ClipboardList },
  { key: "rehab", label: "Rehab", icon: Activity },
  { key: "calendar", label: "Calendar", icon: CalendarClock },
  { key: "profile", label: "My Profile", icon: UserCircle },
];

export const HeadPhysioBoard = ({ branchId, user }) => {
  const [activeTab, setActiveTab] = useState("consultations");
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [showRecommendModal, setShowRecommendModal] = useState(null);
  const [showReviewModal, setShowReviewModal] = useState(null);

  const loadPatients = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getHPMyPatients();
      setPatients(data.patients || []);
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadPatients(); }, [loadPatients]);

  return (
    <div className="space-y-4" data-testid="head-physio-board-root">
      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200">
        {VIEW_TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? "border-teal-500 text-teal-700"
                  : "border-transparent text-slate-400 hover:text-slate-600"
              }`}
              data-testid={`hp-tab-${tab.key}`}
            >
              <Icon className="h-4 w-4" /> {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "consultations" && <ConsultationsBoard branchId={branchId} viewerRole="head_physio" />}

      {activeTab === "rehab" && (
        <PatientsTab
          patients={patients}
          onRecommend={(p) => setShowRecommendModal(p)}
          onSelect={(p) => setSelectedPatient(p)}
          loading={loading}
        />
      )}

      {activeTab === "assessments" && (
        <AssessmentsTab
          patients={patients}
          onReview={(p, w) => setShowReviewModal({ patient: p, week: w })}
        />
      )}

      {activeTab === "calendar" && <MyCalendarTab />}

      {activeTab === "profile" && <MyProfileTab user={user} />}

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

      {loading && <div className="fixed bottom-4 right-4 rounded-md bg-slate-900 px-3 py-2 text-sm text-white">Loading...</div>}
    </div>
  );
};

function MyCalendarTab() {
  const [data, setData] = useState({ slots: [], booked: {} });
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await getHPMyCalendar()); } catch { /* silent */ }
    setLoading(false);
  }, []);

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
              const time = slot.split("T")[1];
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

function MyProfileTab({ user }) {
  if (!user) return null;
  const fields = [
    { label: "Name", value: user.full_name },
    { label: "Email", value: user.email },
    { label: "Role", value: "Consultant / Head Physio" },
  ];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 max-w-md" data-testid="hp-profile-tab">
      <div className="flex items-center gap-3 mb-5">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-teal-100 text-lg font-bold text-teal-700">
          {user.full_name?.charAt(0)?.toUpperCase()}
        </div>
        <div>
          <p className="text-base font-semibold text-slate-800">{user.full_name}</p>
          <p className="text-xs text-slate-400">Consultant / Head Physio</p>
        </div>
      </div>
      <div className="space-y-3">
        {fields.map((f) => (
          <div key={f.label} className="flex items-center justify-between border-b border-slate-100 pb-2">
            <span className="text-xs text-slate-400">{f.label}</span>
            <span className="text-sm text-slate-700">{f.value}</span>
          </div>
        ))}
      </div>
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

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="hp-patients-grid">
      {patients.map((p) => (
        <div
          key={p.lead_id}
          className="rounded-xl border border-slate-200 bg-white p-4 hover:shadow-sm transition-shadow"
          data-testid={`hp-patient-${p.lead_id}`}
        >
          <div className="flex items-start gap-3 mb-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-50 text-sm font-bold text-teal-700">
              {p.lead_name?.charAt(0)?.toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-800 truncate">{p.lead_name}</p>
              <p className="text-[10px] text-slate-400 flex items-center gap-1"><Phone className="h-3 w-3" />{p.phone}</p>
            </div>
            <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${
              p.branch_stage === "Portfolio" ? "bg-emerald-100 text-emerald-700" :
              p.has_recommendation ? "bg-violet-100 text-violet-700" :
              "bg-slate-100 text-slate-500"
            }`}>
              {p.branch_stage || "—"}
            </span>
          </div>

          {p.recommendation && (
            <div className="rounded-lg bg-violet-50 border border-violet-100 p-2.5 mb-3">
              <p className="text-[10px] font-semibold text-violet-600 uppercase mb-1">Package Recommended</p>
              <p className="text-xs text-violet-800">
                {p.recommendation.recommended_weeks}w × {p.recommendation.sessions_per_week}/week = {p.recommendation.total_sessions} sessions
              </p>
              {p.recommendation.notes && (
                <p className="text-[10px] text-violet-500 mt-1">{p.recommendation.notes}</p>
              )}
              <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[9px] font-semibold ${
                p.recommendation.status === "assigned" ? "bg-emerald-100 text-emerald-700" :
                "bg-amber-100 text-amber-700"
              }`}>
                {p.recommendation.status}
              </span>
            </div>
          )}

          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => onSelect(p)} data-testid={`hp-view-sessions-${p.lead_id}`}>
              <Calendar className="h-3 w-3 mr-1" /> Sessions
            </Button>
            {!p.has_recommendation && (
              <Button size="sm" className="flex-1 text-xs bg-teal-600 hover:bg-teal-700 text-white" onClick={() => onRecommend(p)} data-testid={`hp-recommend-${p.lead_id}`}>
                <Package className="h-3 w-3 mr-1" /> Recommend
              </Button>
            )}
          </div>
        </div>
      ))}
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} data-testid="recommend-modal-overlay">
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl" data-testid="recommend-modal">
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} data-testid="review-modal-overlay">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl" data-testid="review-modal">
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
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
                    <p className="text-[10px] text-slate-400">{s.slot_time?.replace("T", " at ")}</p>
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
