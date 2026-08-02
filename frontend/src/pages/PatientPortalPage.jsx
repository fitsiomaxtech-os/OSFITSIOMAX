import { useCallback, useEffect, useState } from "react";
import { Calendar, Check, ClipboardList, Clock, Eye, EyeOff, LogOut } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { slotTo12h } from "@/lib/time";
import {
  loadPortalSession, savePortalSession, clearPortalSession,
  patientPortalLogin, patientPortalLogout, patientPortalMe,
} from "@/lib/patientPortalApi";

const LOGO_URL =
  "https://customer-assets.emergentagent.com/job_3d74aa9e-a241-4207-b148-2bbe29802707/artifacts/nozl77ti_Logo%20Icon.webp";

// Standalone route (/portal) — the patient's own login, entirely separate from the staff
// CRM's auth. A Branch Admin generates these credentials from the Patients tab and shares
// them (link + email + password) over WhatsApp once the Treatment Fee is collected.
export const PatientPortalPage = () => {
  const [session, setSession] = useState(loadPortalSession());

  const handleLogin = (data) => {
    savePortalSession(data);
    setSession(data);
  };

  const handleLogout = async () => {
    await patientPortalLogout();
    clearPortalSession();
    setSession(null);
  };

  if (!session?.token) {
    return <PortalLogin onLogin={handleLogin} />;
  }
  return <PortalDashboard onLogout={handleLogout} />;
};

function PortalLogin({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const data = await patientPortalLogin(email.trim(), password);
      onLogin(data);
      toast.success("Login successful");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Login failed");
    }
    setLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-8" data-testid="patient-portal-login">
      <Card className="w-full max-w-sm rounded-xl border border-slate-200 shadow-[0_8px_30px_rgb(2,6,23,0.06)]">
        <CardHeader className="space-y-2 pb-2 text-center">
          <img src={LOGO_URL} alt="Fitsiomax" className="mx-auto h-12 w-12 rounded-lg object-contain" />
          <p className="text-sm font-semibold text-sky-600">FitsiomaxOS</p>
          <h1 className="text-lg font-bold text-slate-900">Client Portal</h1>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Email</label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required data-testid="patient-portal-email" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Password</label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="pr-9"
                  data-testid="patient-portal-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={loading} data-testid="patient-portal-login-submit">
              {loading ? "Signing in..." : "Sign In"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function PortalDashboard({ onLogout }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await patientPortalMe());
    } catch (err) {
      setError(err?.response?.data?.detail || "Unable to load your records");
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="flex min-h-screen items-center justify-center"><p className="text-slate-400">Loading...</p></div>;
  if (error || !data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3">
        <p className="text-rose-500">{error || "Unable to load your records"}</p>
        <Button variant="outline" onClick={onLogout}>Sign In Again</Button>
      </div>
    );
  }

  const completedPct = data.total_sessions > 0 ? Math.round((data.completed_sessions / data.total_sessions) * 100) : 0;

  return (
    <div className="min-h-screen bg-slate-50" data-testid="patient-portal-dashboard">
      <div className="border-b border-slate-200 bg-white px-4 py-5 sm:px-6">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-sky-100 text-lg font-bold text-sky-700">
              {data.patient_name?.charAt(0)?.toUpperCase()}
            </div>
            <div>
              <h1 className="text-lg font-semibold text-slate-800">{data.patient_name}</h1>
              <p className="text-xs text-slate-400">Physiotherapy Progress{data.physio_name && ` · Assigned to ${data.physio_name}`}</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={onLogout} data-testid="patient-portal-logout">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6">
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
            <p className="text-[10px] text-slate-400">Total Sessions</p>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium text-slate-600">Overall Progress</p>
            <p className="text-xs font-bold text-sky-700">{completedPct}%</p>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-gradient-to-r from-sky-400 to-emerald-400 transition-all" style={{ width: `${completedPct}%` }} />
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-3">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
              <Calendar className="h-4 w-4 text-sky-500" /> Session History
            </h2>
          </div>
          <div className="divide-y divide-slate-50">
            {(data.sessions || []).length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-slate-400">No sessions booked yet</p>
            ) : (
              (data.sessions || []).map((s) => (
                <div key={s.session_number} className="flex items-center gap-3 px-4 py-3" data-testid={`patient-portal-session-${s.session_number}`}>
                  <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
                    s.status === "completed" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                  }`}>
                    {s.status === "completed" ? <Check className="h-4 w-4" /> : s.session_number}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-slate-700">
                      Session {s.session_number} <span className="text-slate-400">· Week {s.week_number}</span>
                    </p>
                    <p className="flex items-center gap-1 text-[10px] text-slate-400">
                      <Clock className="h-3 w-3" />
                      {s.slot_time ? `${s.slot_time.split("T")[0]} at ${slotTo12h(s.slot_time)}` : "—"}
                    </p>
                    {s.jr_physio_remarks && (
                      <div className="mt-1.5 rounded border border-emerald-100 bg-emerald-50 p-2">
                        <p className="text-[10px] text-emerald-600">{s.jr_physio_remarks}</p>
                      </div>
                    )}
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${
                    s.status === "completed" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                  }`}>
                    {s.status}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {data.weekly_assessments && data.weekly_assessments.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-3">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
                <ClipboardList className="h-4 w-4 text-sky-500" /> Weekly Progress Notes
              </h2>
            </div>
            <div className="divide-y divide-slate-50">
              {data.weekly_assessments.map((a) => (
                <div key={a.week_number} className="px-4 py-3">
                  <p className="mb-1 text-xs font-semibold text-slate-700">Week {a.week_number}</p>
                  {a.jr_physio_notes ? (
                    <p className="text-xs text-slate-600">{a.jr_physio_notes}</p>
                  ) : (
                    <p className="text-xs italic text-slate-300">No notes yet</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
