import { useCallback, useEffect, useState } from "react";
import { Calendar, Check, ClipboardCheck, ClipboardList, Clock, Eye, EyeOff, IndianRupee, LogOut, PhoneCall, UserRound } from "lucide-react";
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

const ordinal = (n) => {
  const v = n % 100;
  const suffix = v >= 11 && v <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th";
  return `${n}${suffix}`;
};

// Small header shown at the top of Sessions and Treatment — who's actually treating
// this patient. No contact/call action for the Head Physio anywhere in the portal,
// by design; only the branch itself is reachable from here (see ProfileTab).
function DoctorMiniCard({ physioName, headPhysioName }) {
  if (!physioName && !headPhysioName) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border border-slate-200 bg-white p-3 text-xs" data-testid="patient-portal-doctor-card">
      {headPhysioName && (
        <div>
          <span className="text-slate-400">Head Physio</span>{" "}
          <span className="font-semibold text-slate-700">{headPhysioName}</span>
        </div>
      )}
      {physioName && (
        <div>
          <span className="text-slate-400">Physio</span>{" "}
          <span className="font-semibold text-slate-700">{physioName}</span>
        </div>
      )}
    </div>
  );
}

function SessionsTab({ data }) {
  const completedPct = data.total_sessions > 0 ? Math.round((data.completed_sessions / data.total_sessions) * 100) : 0;
  return (
    <div className="space-y-4" data-testid="patient-portal-sessions-tab">
      <DoctorMiniCard physioName={data.physio_name} headPhysioName={data.head_physio_name} />

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-center">
          <p className="text-xl font-bold text-emerald-700">{data.completed_sessions}</p>
          <p className="text-[10px] text-emerald-500">Completed</p>
        </div>
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-center">
          <p className="text-xl font-bold text-sky-700">{data.remaining_sessions}</p>
          <p className="text-[10px] text-sky-500">Remaining</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
          <p className="text-xl font-bold text-slate-700">{data.total_sessions}</p>
          <p className="text-[10px] text-slate-400">Total</p>
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
  );
}

function TreatmentTab({ data }) {
  return (
    <div className="space-y-4" data-testid="patient-portal-treatment-tab">
      <DoctorMiniCard physioName={data.physio_name} headPhysioName={data.head_physio_name} />

      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-slate-400">Treatment Package</p>
        <p className="text-sm font-semibold text-slate-800">
          {data.session_package_name || "—"}{data.session_package_sessions ? ` · ${data.session_package_sessions} sessions` : ""}
        </p>
      </div>
      {data.diagnosis && (
        <div className="rounded-lg border border-slate-200 p-3">
          <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-slate-400">Diagnosis</p>
          <p className="whitespace-pre-wrap text-xs text-slate-700">{data.diagnosis}</p>
        </div>
      )}
      {data.physio_diagnosis_report && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
          <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-sky-500">Diagnosis Report</p>
          <p className="whitespace-pre-wrap text-xs text-sky-900">{data.physio_diagnosis_report}</p>
        </div>
      )}
      {data.treatment_summary && (
        <div className="rounded-lg border border-violet-200 bg-violet-50 p-3">
          <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-violet-500">Treatment Plan</p>
          <p className="whitespace-pre-wrap text-xs text-violet-900">{data.treatment_summary}</p>
        </div>
      )}
      {!data.physio_diagnosis_report && !data.treatment_summary && (
        <p className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">
          No treatment details shared yet.
        </p>
      )}

      {data.reviews && data.reviews.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-3">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
              <ClipboardCheck className="h-4 w-4 text-sky-500" /> Reviews
            </h2>
          </div>
          <div className="divide-y divide-slate-50">
            {data.reviews.map((r, i) => (
              <div key={i} className="px-4 py-3" data-testid={`patient-portal-review-${r.review_number}`}>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-700">{ordinal(r.review_number)} Review</p>
                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${
                    r.status === "completed" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                  }`}>
                    {r.status === "completed" ? "Completed" : "In Progress"}
                  </span>
                </div>
                {r.review_date && <p className="mt-0.5 text-[10px] text-slate-400">{r.review_date}</p>}
                {r.head_physio_suggestions && <p className="mt-1.5 text-xs text-slate-600">{r.head_physio_suggestions}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PaymentTab({ data }) {
  const p = data.payment || {};
  const totalAll = (p.consultation_fee_total || 0) + (p.treatment_fee_total || 0);
  const collectedAll = (p.consultation_fee_paid || 0) + (p.treatment_fee_paid || 0);
  const pendingAll = Math.max(totalAll - collectedAll, 0);

  return (
    <div className="space-y-4" data-testid="patient-portal-payment-tab">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-center">
          <p className="text-lg font-bold text-sky-700">₹{totalAll}</p>
          <p className="text-[10px] text-sky-500">Total</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-center">
          <p className="text-lg font-bold text-emerald-700">₹{collectedAll}</p>
          <p className="text-[10px] text-emerald-500">Collected</p>
        </div>
        <div className={`rounded-xl border p-3 text-center ${pendingAll > 0 ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}>
          <p className={`text-lg font-bold ${pendingAll > 0 ? "text-amber-700" : "text-slate-700"}`}>₹{pendingAll}</p>
          <p className={`text-[10px] ${pendingAll > 0 ? "text-amber-500" : "text-slate-400"}`}>Pending</p>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-3" data-testid="patient-portal-consultation-fee">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Consultation Fee</p>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${p.consultation_fee_paid ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
            {p.consultation_fee_paid ? "Paid" : "Pending"}
          </span>
        </div>
        {p.consultation_fee_paid ? (
          <p className="text-xs text-slate-600">₹{p.consultation_fee_paid} <span className="capitalize text-slate-400">via {p.consultation_payment_mode}</span></p>
        ) : (
          <p className="text-xs text-slate-400">Not yet collected{p.consultation_fee_total ? ` — ₹${p.consultation_fee_total} due` : ""}</p>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-3" data-testid="patient-portal-treatment-fee">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Treatment Fee</p>
          {p.treatment_fee_total == null ? (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">Not Assigned</span>
          ) : p.is_partial ? (
            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700">Partial</span>
          ) : p.treatment_fee_paid ? (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Paid in Full</span>
          ) : (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Pending</span>
          )}
        </div>
        {p.is_partial ? (
          <div className="space-y-2">
            <p className="text-[11px] text-slate-500">{p.installments_paid} of {p.installments_total} payments collected</p>
            {p.next_due_date ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
                Next payment <span className="font-semibold">₹{p.next_due_amount}</span> due {p.next_due_date}
              </div>
            ) : (
              <p className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-xs text-emerald-700">All installments collected</p>
            )}
          </div>
        ) : p.treatment_fee_paid ? (
          <p className="text-xs text-slate-600">₹{p.treatment_fee_paid} <span className="capitalize text-slate-400">via {p.treatment_payment_mode}</span></p>
        ) : (
          <p className="text-xs text-slate-400">No treatment fee collected yet</p>
        )}
      </div>
    </div>
  );
}

function ProfileTab({ data }) {
  const Row = ({ label, value }) => (
    !value ? null : (
      <div>
        <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
        <p className="text-xs text-slate-700">{value}</p>
      </div>
    )
  );

  return (
    <div className="space-y-4" data-testid="patient-portal-profile-tab">
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Your Details</p>
        <div className="grid grid-cols-2 gap-3">
          <Row label="Patient Number" value={data.patient_number} />
          <Row label="Phone" value={data.phone} />
          <Row label="Email" value={data.email} />
          <Row label="Age" value={data.age} />
          <Row label="Gender" value={data.gender} />
          <Row label="Occupation" value={data.occupation} />
          <Row label="Address" value={data.address} />
          <Row label="City / State" value={[data.city, data.state].filter(Boolean).join(", ")} />
          <Row label="Condition" value={data.condition} />
        </div>
      </div>

      {(data.head_physio_name || data.physio_name) && (
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Your Care Team</p>
          <div className="space-y-2">
            {/* Deliberately no call/contact action here for the Head Physio — name only. */}
            <Row label="Head Physio" value={data.head_physio_name} />
            <Row label="Physio" value={data.physio_name} />
          </div>
        </div>
      )}

      {(data.branch_name || data.branch_phone) && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-sky-600">Your Branch</p>
          <p className="text-sm font-semibold text-slate-800">{data.branch_name}</p>
          {data.branch_address && <p className="mt-0.5 text-xs text-slate-600">{data.branch_address}</p>}
          {data.branch_phone && (
            <Button
              size="sm"
              className="mt-2 bg-sky-600 text-xs text-white hover:bg-sky-700"
              onClick={() => { window.location.href = `tel:${data.branch_phone.replace(/[^0-9+]/g, "")}`; }}
              data-testid="patient-portal-call-branch"
            >
              <PhoneCall className="mr-1.5 h-3.5 w-3.5" /> Call Branch
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

const PORTAL_TABS = [
  { key: "sessions", label: "Sessions", icon: Calendar },
  { key: "treatment", label: "Treatment", icon: ClipboardList },
  { key: "payment", label: "Payment History", icon: IndianRupee },
  { key: "profile", label: "Profile", icon: UserRound },
];

function PortalDashboard({ onLogout }) {
  const [activeTab, setActiveTab] = useState("sessions");
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

  return (
    <div className="min-h-screen bg-slate-50 pb-20" data-testid="patient-portal-dashboard">
      <div className="border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-100 text-sm font-bold text-sky-700">
              {data.patient_name?.charAt(0)?.toUpperCase()}
            </div>
            <div>
              <h1 className="text-sm font-semibold text-slate-800">{data.patient_name}</h1>
              <p className="text-[10px] text-sky-600">FitsiomaxOS Client Portal</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={onLogout} data-testid="patient-portal-logout">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        {activeTab === "sessions" && <SessionsTab data={data} />}
        {activeTab === "treatment" && <TreatmentTab data={data} />}
        {activeTab === "payment" && <PaymentTab data={data} />}
        {activeTab === "profile" && <ProfileTab data={data} />}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white" data-testid="patient-portal-bottom-nav">
        <div className="mx-auto flex max-w-lg items-stretch justify-around">
          {PORTAL_TABS.map((t) => {
            const Icon = t.icon;
            const isActive = activeTab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition ${isActive ? "text-sky-600" : "text-slate-400"}`}
                data-testid={`patient-portal-tab-${t.key}`}
              >
                <Icon className="h-5 w-5" /> {t.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
