import { useCallback, useEffect, useState } from "react";
import {
  Calendar,
  Check,
  Clock,
  ClipboardList,
  User,
} from "lucide-react";
import { patientView } from "@/lib/api";
import { slotTo12h } from "@/lib/time";

export const PatientViewPage = ({ token }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await patientView(token));
    } catch (err) {
      setError(err?.response?.data?.detail || "Unable to load your records");
    }
    setLoading(false);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="flex items-center justify-center min-h-screen"><p className="text-slate-400">Loading...</p></div>;
  if (error) return <div className="flex items-center justify-center min-h-screen"><p className="text-red-500">{error}</p></div>;
  if (!data) return null;

  const completedPct = data.total_sessions > 0 ? Math.round((data.completed_sessions / data.total_sessions) * 100) : 0;

  return (
    <div className="min-h-screen bg-slate-50" data-testid="patient-view-page">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-4 py-5 sm:px-6">
        <div className="max-w-3xl mx-auto flex items-center gap-4">
          <div className="h-12 w-12 rounded-full bg-sky-100 flex items-center justify-center text-lg font-bold text-sky-700">
            {data.patient_name?.charAt(0)?.toUpperCase()}
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-800">{data.patient_name}</h1>
            <p className="text-xs text-slate-400">Physiotherapy Progress · {data.physio_name && `Assigned to ${data.physio_name}`}</p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6 sm:px-6">
        {/* Progress Summary */}
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center">
            <p className="text-2xl font-bold text-emerald-700">{data.completed_sessions}</p>
            <p className="text-[10px] text-emerald-500">Completed</p>
          </div>
          <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-center">
            <p className="text-2xl font-bold text-sky-700">{data.remaining_sessions}</p>
            <p className="text-[10px] text-sky-500">Remaining</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-center">
            <p className="text-2xl font-bold text-slate-700">{data.total_sessions}</p>
            <p className="text-[10px] text-slate-400">Total ({data.recommended_weeks || "?"} weeks)</p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-slate-600">Overall Progress</p>
            <p className="text-xs font-bold text-sky-700">{completedPct}%</p>
          </div>
          <div className="h-3 w-full rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-sky-400 to-emerald-400 transition-all"
              style={{ width: `${completedPct}%` }}
            />
          </div>
        </div>

        {/* Sessions List */}
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
              <Calendar className="h-4 w-4 text-sky-500" /> Session History
            </h2>
          </div>
          <div className="divide-y divide-slate-50">
            {(data.sessions || []).map((s) => (
              <div key={s.session_number} className="px-4 py-3 flex items-center gap-3" data-testid={`patient-session-${s.session_number}`}>
                <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold ${
                  s.status === "completed" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                }`}>
                  {s.status === "completed" ? <Check className="h-4 w-4" /> : s.session_number}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-700">
                    Session {s.session_number} <span className="text-slate-400">· Week {s.week_number}</span>
                  </p>
                  <p className="text-[10px] text-slate-400 flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {s.slot_time ? `${s.slot_time.split("T")[0]} at ${slotTo12h(s.slot_time)}` : "—"}
                    {s.physio_name && <span> · {s.physio_name}</span>}
                  </p>
                  {(s.jr_physio_remarks || s.rehab_remarks) && (
                    <div className="mt-1.5 space-y-1 rounded bg-emerald-50 border border-emerald-100 p-2">
                      {s.jr_physio_remarks && (
                        <p className="text-[10px] text-emerald-600"><span className="font-semibold">Treatment: </span>{s.jr_physio_remarks}</p>
                      )}
                      {s.rehab_remarks && (
                        <p className="text-[10px] text-emerald-600"><span className="font-semibold">Rehab: </span>{s.rehab_remarks}</p>
                      )}
                    </div>
                  )}
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${
                  s.status === "completed" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                }`}>
                  {s.status}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Weekly Assessments (Jr. Physio notes only — no Head Physio remarks) */}
        {data.weekly_assessments && data.weekly_assessments.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                <ClipboardList className="h-4 w-4 text-sky-500" /> Weekly Progress Notes
              </h2>
            </div>
            <div className="divide-y divide-slate-50">
              {data.weekly_assessments.map((a) => (
                <div key={a.week_number} className="px-4 py-3">
                  <p className="text-xs font-semibold text-slate-700 mb-1">Week {a.week_number}</p>
                  {a.jr_physio_notes ? (
                    <p className="text-xs text-slate-600">{a.jr_physio_notes}</p>
                  ) : (
                    <p className="text-xs text-slate-300 italic">No notes yet</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
