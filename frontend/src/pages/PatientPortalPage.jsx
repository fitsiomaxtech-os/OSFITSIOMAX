import { useCallback, useEffect, useRef, useState } from "react";
import { Calendar, Check, ClipboardCheck, ClipboardList, Clock, Eye, EyeOff, IndianRupee, LogOut, MessageSquareHeart, PhoneCall, Salad, UserRound } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { slotTo12h } from "@/lib/time";
import {
  loadPortalSession, savePortalSession, clearPortalSession,
  patientPortalLogin, patientPortalLogout, patientPortalMe, patientPortalGoogleLogin,
  patientPortalDocuments, patientPortalDocumentUrl, patientPortalSubmitFeedback, patientPortalMyFeedback,
  patientPortalReplyFeedback,
} from "@/lib/patientPortalApi";

const LOGO_URL =
  "https://customer-assets.emergentagent.com/job_3d74aa9e-a241-4207-b148-2bbe29802707/artifacts/nozl77ti_Logo%20Icon.webp";

// Unset until the clinic creates a Google Cloud OAuth Client ID and this env var is
// set on the frontend build — until then the button below simply doesn't render.
const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID;

// Standalone route (/portal) — the patient's own login, entirely separate from the staff
// CRM's auth. A Branch Admin generates these credentials from the Patients tab and shares
// them (link + email + password) over WhatsApp once the Treatment Fee is collected.
export const PatientPortalPage = () => {
  const [session, setSession] = useState(loadPortalSession());

  // Gives /portal its own installable PWA identity — separate icon, name and manifest
  // from the staff CRM that shares this same index.html — without touching index.html
  // itself, so /app is never affected.
  useEffect(() => {
    const setLink = (rel, href, extra = {}) => {
      let el = document.querySelector(`link[rel="${rel}"][data-portal-pwa]`);
      if (!el) {
        el = document.createElement("link");
        el.rel = rel;
        el.setAttribute("data-portal-pwa", "true");
        document.head.appendChild(el);
      }
      el.href = href;
      Object.entries(extra).forEach(([k, v]) => el.setAttribute(k, v));
    };
    const setMeta = (name, content) => {
      let el = document.querySelector(`meta[name="${name}"][data-portal-pwa]`);
      if (!el) {
        el = document.createElement("meta");
        el.name = name;
        el.setAttribute("data-portal-pwa", "true");
        document.head.appendChild(el);
      }
      el.content = content;
    };

    setLink("manifest", "/portal-manifest.json");
    setLink("apple-touch-icon", "/portal-icon.svg");
    setLink("icon", "/portal-icon.svg", { type: "image/svg+xml" });
    setMeta("theme-color", "#0284c7");
    setMeta("apple-mobile-web-app-capable", "yes");
    setMeta("apple-mobile-web-app-status-bar-style", "black-translucent");
    setMeta("apple-mobile-web-app-title", "Fitsiomax Portal");

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/portal-sw.js", { scope: "/portal" }).catch(() => {});
    }
  }, []);

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
          <GoogleSignInButton onLogin={onLogin} />
        </CardContent>
      </Card>
    </div>
  );
}

// Only account emails a Branch Admin already created get in this way — signing in with
// Google links to an existing portal account by email, it never creates a new one.
function GoogleSignInButton({ onLogin }) {
  const buttonRef = useRef(null);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;

    const handleCredential = async (response) => {
      try {
        const data = await patientPortalGoogleLogin(response.credential);
        onLogin(data);
        toast.success("Login successful");
      } catch (err) {
        toast.error(err?.response?.data?.detail || "Google sign-in failed");
      }
    };

    const init = () => {
      if (!window.google?.accounts?.id || !buttonRef.current) return;
      window.google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleCredential });
      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: "outline", size: "large", width: 280, text: "signin_with",
      });
    };

    if (window.google?.accounts?.id) {
      init();
      return;
    }
    const existing = document.getElementById("google-identity-script");
    if (existing) {
      existing.addEventListener("load", init, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.id = "google-identity-script";
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = init;
    document.head.appendChild(script);
  }, [onLogin]);

  if (!GOOGLE_CLIENT_ID) return null;

  return (
    <div className="mt-4">
      <div className="mb-3 flex items-center gap-3 text-xs text-slate-400">
        <div className="h-px flex-1 bg-slate-200" />
        <span>OR</span>
        <div className="h-px flex-1 bg-slate-200" />
      </div>
      <div ref={buttonRef} className="flex justify-center" data-testid="patient-portal-google-button" />
    </div>
  );
}

/** Indian digit grouping — 4,97,896 rather than 497896. The patient is reading what they
    were charged, and an ungrouped six-figure number is read wrong before it is read. */
const money = (n) => (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });

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
          <span className="text-slate-400">CONSULTANT</span>{" "}
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

// Exported (Sessions/Treatment/Payment only — pure renders off `data`, nothing
// auth-bound) so Operations' Client tab can show a staff-side preview of a patient's
// own portal without duplicating three tabs' worth of markup.
export function SessionsTab({ data }) {
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
                  {(s.jr_physio_remarks || s.rehab_remarks) && (
                    <div className="mt-1.5 space-y-1 rounded border border-emerald-100 bg-emerald-50 p-2">
                      {s.jr_physio_remarks && (
                        <p className="text-[10px] text-emerald-600"><span className="font-semibold">Treatment: </span>{s.jr_physio_remarks}</p>
                      )}
                      {s.rehab_remarks && (
                        <p className="text-[10px] text-emerald-600"><span className="font-semibold">Rehab: </span>{s.rehab_remarks}</p>
                      )}
                    </div>
                  )}
                </div>
                {/* shrink-0: without it a long physio remark beside this squeezes the
                    badge until "upcoming" wraps mid-word. */}
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold ${
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

/** When the patient sees their Nutrition Coach, and how far through the check-ins they
    are. Renders nothing at all unless a Diet Consultation has been booked. */
function DietCard({ diet }) {
  if (!diet || (!diet.appointment_at && !diet.total_checkins)) return null;
  const date = (diet.appointment_at || "").split("T")[0];
  const done = diet.completed_checkins || 0;
  const total = diet.total_checkins || 0;

  return (
    <div className="overflow-hidden rounded-xl border border-orange-200 bg-white" data-testid="patient-portal-diet-card">
      <div className="border-b border-orange-100 bg-orange-50/60 px-4 py-3">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-orange-700">
          <Salad className="h-4 w-4 text-orange-500" /> Diet Plan
        </h2>
      </div>
      <div className="space-y-2 px-4 py-3">
        {diet.coach_name && (
          <p className="text-xs text-slate-600">
            Nutritionist <span className="font-semibold text-slate-800">{diet.coach_name}</span>
          </p>
        )}
        {date && (
          <div className="rounded-md border border-orange-200 bg-orange-50 px-2.5 py-2 text-xs text-orange-800">
            Diet Consultation on <span className="font-semibold">{date}</span>
            {" at "}<span className="font-semibold">{slotTo12h(diet.appointment_at)}</span>
          </div>
        )}
        {total > 0 && (
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500">
              <span>Check-ins</span>
              <span className="font-semibold text-slate-700">{done} of {total}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-orange-500" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
            </div>
          </div>
        )}

        {/* The plan the patient is meant to follow — the reason they came. */}
        {diet.consultation_report && (
          <div className="rounded-lg border border-orange-200 bg-orange-50/60 p-3" data-testid="patient-portal-diet-report">
            <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-orange-500">
              Diet Consultation Report
            </p>
            <p className="whitespace-pre-wrap text-xs text-orange-900">{diet.consultation_report}</p>
            {diet.consultation_report_by && (
              <p className="mt-1.5 text-[10px] text-orange-400">
                {diet.consultation_report_by}
                {diet.consultation_report_at ? ` · ${String(diet.consultation_report_at).slice(0, 10)}` : ""}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function TreatmentTab({ data }) {
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

      {/* The diet side of their care. Shown only once a Diet Consultation is actually
          booked — diet is optional, and an empty card on every other patient's screen
          would suggest a plan they were never put on. */}
      <DietCard diet={data.diet} />

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

export function PaymentTab({ data }) {
  const p = data.payment || {};
  // All three fees. The diet one was missing, so a patient who paid for a diet
  // consultation was shown a Total that did not include their own money.
  const totalAll = (p.consultation_fee_total || 0) + (p.treatment_fee_total || 0) + (p.diet_fee_total || 0);
  const collectedAll = (p.consultation_fee_paid || 0) + (p.treatment_fee_paid || 0) + (p.diet_fee_paid || 0);
  const pendingAll = Math.max(totalAll - collectedAll, 0);

  return (
    <div className="space-y-4" data-testid="patient-portal-payment-tab">
      {/* Grouped and truncated. These were raw numbers — ₹497896 — in a tile a third of
          a phone wide: hard to read at a glance, and a longer figure would have run past
          its own border rather than shortening. */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-center">
          <p className="truncate text-lg font-bold text-sky-700" title={`₹${money(totalAll)}`}>₹{money(totalAll)}</p>
          <p className="text-[10px] text-sky-500">Total</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-center">
          <p className="truncate text-lg font-bold text-emerald-700" title={`₹${money(collectedAll)}`}>₹{money(collectedAll)}</p>
          <p className="text-[10px] text-emerald-500">Collected</p>
        </div>
        <div className={`rounded-xl border p-3 text-center ${pendingAll > 0 ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}>
          <p className={`truncate text-lg font-bold ${pendingAll > 0 ? "text-amber-700" : "text-slate-700"}`} title={`₹${money(pendingAll)}`}>₹{money(pendingAll)}</p>
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
          <p className="text-xs text-slate-600">₹{money(p.consultation_fee_paid)} <span className="capitalize text-slate-400">via {p.consultation_payment_mode}</span></p>
        ) : (
          <p className="text-xs text-slate-400">Not yet collected{p.consultation_fee_total ? ` — ₹${money(p.consultation_fee_total)} due` : ""}</p>
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
                Next payment <span className="font-semibold">₹{money(p.next_due_amount)}</span> due {p.next_due_date}
              </div>
            ) : (
              <p className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-xs text-emerald-700">All installments collected</p>
            )}
          </div>
        ) : p.treatment_fee_paid ? (
          <p className="text-xs text-slate-600">₹{money(p.treatment_fee_paid)} <span className="capitalize text-slate-400">via {p.treatment_payment_mode}</span></p>
        ) : (
          <p className="text-xs text-slate-400">No treatment fee collected yet</p>
        )}
      </div>

      {/* Only for patients who actually took a diet plan. Diet is optional, so an empty
          card on every other patient's screen would be a bill they never had. */}
      {p.diet_fee_paid != null && (
        <div className="rounded-lg border border-slate-200 bg-white p-3" data-testid="patient-portal-diet-fee">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Diet Consultation Fee</p>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Paid</span>
          </div>
          <p className="text-xs text-slate-600">
            ₹{money(p.diet_fee_paid)} <span className="capitalize text-slate-400">via {p.diet_payment_mode}</span>
          </p>
          {p.diet_package_name && <p className="mt-0.5 text-[11px] text-slate-400">{p.diet_package_name}</p>}
        </div>
      )}
    </div>
  );
}


const prettyBytes = (n) => {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * The patient's own documents.
 *
 * Only what the branch has shared comes back — the server decides that, not this
 * component, so nothing here can widen it. Renders nothing at all when the list is empty,
 * because an empty "Documents" card reads as something having gone missing.
 *
 * Opened through a blob URL rather than a direct link: the download route needs the
 * session token in a header, which an <a href> cannot send.
 */
function PatientDocuments() {
  const [docs, setDocs] = useState([]);
  const [opening, setOpening] = useState(null);

  useEffect(() => {
    let cancelled = false;
    patientPortalDocuments()
      .then((r) => { if (!cancelled) setDocs(r.documents || []); })
      .catch(() => { if (!cancelled) setDocs([]); });
    return () => { cancelled = true; };
  }, []);

  const open = async (doc) => {
    setOpening(doc.id);
    try {
      const url = await patientPortalDocumentUrl(doc.id);
      window.open(url, "_blank", "noopener");
      // Revoked on a delay rather than immediately: the new tab has to have started
      // loading from it first, and revoking straight away leaves a blank tab.
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      toast.error("That document couldn't be opened. Please ask your branch.");
    }
    setOpening(null);
  };

  if (docs.length === 0) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3" data-testid="patient-portal-documents">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Your Documents</p>
      <div className="space-y-2">
        {docs.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => open(d)}
            disabled={opening === d.id}
            className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 p-2.5 text-left transition hover:border-sky-300 hover:bg-sky-50/50 disabled:opacity-50"
            data-testid={`patient-portal-document-${d.id}`}
          >
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-slate-800">
                {d.label || d.original_name}
              </p>
              <p className="text-[10px] text-slate-400">
                {d.kind === "consultation_form" ? "Consultation Form" : "Report"}
                {d.size_bytes ? ` · ${prettyBytes(d.size_bytes)}` : ""}
                {d.created_at ? ` · ${String(d.created_at).slice(0, 10)}` : ""}
              </p>
            </div>
            <span className="shrink-0 text-[11px] font-semibold text-sky-600">
              {opening === d.id ? "Opening..." : "View"}
            </span>
          </button>
        ))}
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
            <Row label="CONSULTANT" value={data.head_physio_name} />
            <Row label="Physio" value={data.physio_name} />
          </div>
        </div>
      )}

      <PatientDocuments />

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

// Overview leads: it is the patient's own details, care team, documents and branch —
// what they are looking at when they first open the app — and the three after it answer
// "how is my treatment going", which is the follow-up.
//
// `short` is the phone label. Four full labels cannot share a phone's width once one of
// them is "Payment History": at 360px each tab gets about 85px, and that label needs
// well over a hundred. Truncating gives "Payment Hist…", wrapping makes that one tab
// two lines tall and pushes the bar off the bottom of the screen. Shortening is the only
// option that keeps all four readable in one row. `label` is what the desktop shows.
const PORTAL_TABS = [
  { key: "profile", label: "Overview", short: "Overview", icon: UserRound },
  { key: "sessions", label: "Sessions", short: "Sessions", icon: Calendar },
  { key: "treatment", label: "Treatment", short: "Treatment", icon: ClipboardList },
  { key: "payment", label: "Payment History", short: "Payments", icon: IndianRupee },
  // Last, because it is the one tab a patient comes to say something rather than to look
  // something up. "Feedback" fits at 360px, so short and label are the same word.
  { key: "feedback", label: "Feedback", short: "Feedback", icon: MessageSquareHeart },
];

/**
 * What the patient made of it.
 *
 * Their words, and who reads them. There is no rating: a star out of five says something
 * happened without saying what, and a branch cannot act on four stars. The words are the
 * part somebody can do something about, so they are the part asked for -- and the only
 * part refused when empty.
 *
 * Not a thread, but not a shout into a well either: the history tab says where each one
 * got to, and a branch closing one has to say what was done, which the patient reads there.
 */
// The two people a patient can write to, and the difference between them in the words a
// patient would use. Named rather than described as "escalation": somebody unhappy enough
// to go past their branch should not have to work out which word means that.
const FEEDBACK_TO = [
  {
    key: "branch_admin",
    label: "My branch",
    who: "Branch Admin",
    blurb: "Anything about your Consultant, Physio or Zumba master. Your branch runs their care and answers for it.",
  },
  {
    key: "super_admin",
    label: "Head office",
    who: "Sumaiya Naaz",
    blurb: "Something serious, or something about the branch itself. Goes straight to head office — your branch does not see it.",
  },
];

const feedbackSentOn = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

/** What this patient has sent, and where each one has got to.
 *
 * A patient who says something and hears nothing assumes it went nowhere, and either sends
 * it again or stops sending. This does not promise a reply — it says somebody has it, which
 * is the smallest honest thing to say.
 */
/** One conversation, and the box to answer it in.
 *
 *  A patient whose answer raises another question had nowhere to put it before — one
 *  message, one reply, and anything further meant opening a second piece of feedback about
 *  the same thing. Both sides can write here, and it keeps its order.
 */
/** Everything said to one of the two, oldest first.
 *
 *  A patient talks to their branch, or to head office. They do not hold it as a stack of
 *  numbered complaints, and the portal used to make them: separate items, one reply each,
 *  and a Feedback History tab to go and look them up in. The records underneath are
 *  unchanged — a branch still works through them one at a time — but they are read here
 *  the way the person who wrote them holds it, as one conversation with each side.
 */
const channelMessages = (rows) => rows
  .flatMap((f) => (f.messages || []).map((m) => ({ ...m, thread_id: f.id })))
  .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));

/** The thread a new message belongs to, or nothing if it starts one.
 *
 *  The most recent one still open. Writing into a conversation should carry on where it
 *  left off rather than opening a second complaint about the same thing beside the first,
 *  which is what the old form did every time somebody had more to say.
 */
const openThreadOf = (rows) => rows.find((f) => (f.status || "new") !== "resolved") || null;

function FeedbackTab() {
  const [draft, setDraft] = useState("");
  const [audience, setAudience] = useState("branch_admin");
  const [sending, setSending] = useState(false);
  const [mine, setMine] = useState([]);
  const endRef = useRef(null);

  const loadMine = useCallback(() => {
    patientPortalMyFeedback()
      .then((data) => setMine(data?.feedback || []))
      .catch(() => { /* the conversation is a courtesy; sending works without it */ });
  }, []);
  useEffect(() => { loadMine(); }, [loadMine]);

  // Rows arrive newest first, which is right for a list and backwards for a conversation.
  const channelRows = mine.filter((f) => (f.audience || "branch_admin") === audience);
  const messages = channelMessages([...channelRows].reverse());
  const asked = channelRows.find((f) => (f.status || "new") === "awaiting_patient") || null;
  const open = openThreadOf(channelRows);
  const them = audience === "super_admin" ? "Head office" : "Your branch";

  // The newest message, not the top of the history. A conversation that opens scrolled to
  // a paragraph from three weeks ago hides the answer somebody came back to read.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, audience]);

  const waiting = (key) => mine.some(
    (f) => (f.audience || "branch_admin") === key && (f.status || "new") === "awaiting_patient",
  );

  const send = async (resolved) => {
    const body = draft.trim();
    if (!body && resolved === undefined) { toast.error("Tell us how it went"); return; }
    setSending(true);
    try {
      if (resolved === undefined && !open) {
        // Nothing open on this side, so this starts the conversation off again.
        await patientPortalSubmitFeedback({ message: body, audience });
      } else {
        const target = resolved === undefined ? open : asked;
        await patientPortalReplyFeedback(target.id, { body, resolved });
      }
      setDraft("");
      loadMine();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not send that. Please try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Card data-testid="portal-feedback">
      <CardContent className="space-y-4 p-5">
        <div>
          <p className="text-sm font-semibold text-slate-800">How has it been?</p>
          <p className="mt-0.5 text-xs text-slate-500">Tell us anything — what went well, or what did not.</p>
        </div>

        {/* Asked before the box rather than under the Send button: who is reading it
            changes what somebody is willing to write, and finding that out afterwards is
            finding it out too late. It now also picks which conversation is on screen, and
            the two are separate — what goes to head office the branch never sees. */}
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Send to</p>
          <div className="grid gap-2 sm:grid-cols-2" data-testid="portal-feedback-audience">
            {FEEDBACK_TO.map((a) => {
              const on = audience === a.key;
              return (
                <button
                  key={a.key}
                  type="button"
                  onClick={() => setAudience(a.key)}
                  aria-pressed={on}
                  className={`relative rounded-lg border p-3 text-left transition ${on ? "border-sky-500 bg-sky-50 ring-1 ring-sky-500" : "border-slate-200 bg-white hover:border-sky-300"}`}
                  data-testid={`portal-feedback-to-${a.key}`}
                >
                  {/* Says the other side is waiting on an answer while you are not looking
                      at it. Without it the only way to find out is to go and check. */}
                  {waiting(a.key) && !on && (
                    <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-violet-500" data-testid={`portal-feedback-dot-${a.key}`} />
                  )}
                  <p className={`text-xs font-bold ${on ? "text-sky-700" : "text-slate-700"}`}>{a.label}</p>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{a.who}</p>
                  <p className="mt-1 text-[11px] leading-snug text-slate-500">{a.blurb}</p>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {messages.length > 0 ? `With ${them.toLowerCase()}` : "In your words"}
          </p>
          <div
            className="max-h-80 space-y-2 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/60 p-3"
            data-testid={`portal-feedback-chat-${audience}`}
          >
            {messages.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-400">
                Nothing sent to {them.toLowerCase()} yet. Whatever you write below starts it off.
              </p>
            ) : messages.map((m) => {
              const own = m.author === "patient";
              return (
                <div key={m.id} className={`flex ${own ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] rounded-lg px-2.5 py-1.5 ${own ? "bg-sky-600 text-white" : "bg-white text-slate-700 shadow-sm"}`}>
                    <p className="whitespace-pre-wrap break-words text-xs leading-5">{m.body}</p>
                    <p className={`mt-0.5 text-[10px] ${own ? "text-sky-100" : "text-slate-400"}`}>
                      {[own ? "You" : them, feedbackSentOn(m.created_at)].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                </div>
              );
            })}
            <div ref={endRef} />
          </div>
        </div>

        {/* Being asked, rather than being told. Whether what they did was enough is the
            patient's to say — a complaint marked dealt with by the people complained about
            is how somebody learns not to bother saying anything. */}
        {asked && (
          <div className="rounded-lg border border-violet-200 bg-violet-50/70 p-3" data-testid="portal-feedback-asked">
            <p className="text-[11px] font-semibold text-violet-900">{them} asked: has this sorted it?</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Button
                size="sm"
                className="h-7 bg-emerald-600 px-2 text-[11px] text-white hover:bg-emerald-700"
                disabled={sending}
                onClick={() => send(true)}
                data-testid="portal-feedback-yes"
              >
                Yes, all sorted
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 border-slate-200 px-2 text-[11px]"
                disabled={sending}
                onClick={() => send(false)}
                data-testid="portal-feedback-no"
              >
                Not yet
              </Button>
            </div>
            <p className="mt-1 text-[10px] text-violet-700/70">Write a line below first if you want to say why.</p>
          </div>
        )}

        <div>
          <textarea
            rows={4}
            value={draft}
            maxLength={2000}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={messages.length > 0 ? "Write back…" : "Optional — but it is the part a branch can act on."}
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-400"
            data-testid="portal-feedback-message"
          />
          <p className="mt-1 text-right text-[10px] text-slate-400">{draft.length}/2000</p>
        </div>

        <Button
          className="w-full"
          disabled={sending || !draft.trim()}
          onClick={() => send(undefined)}
          data-testid="portal-feedback-submit"
        >
          {sending ? "Sending…" : audience === "super_admin" ? "Send to head office" : "Send to my branch"}
        </Button>
      </CardContent>
    </Card>
  );
}

function PortalDashboard({ onLogout }) {
  // Lands on Overview, the first tab. A patient opening the app is most often checking
  // who they are with and when — not scrolling a session list they already know.
  const [activeTab, setActiveTab] = useState("profile");
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
        {activeTab === "feedback" && <FeedbackTab />}
      </div>

      {/* Unlike every other bottom nav in the OS this one has no md:hidden — the portal
          shows it at all widths — so the slate is reverted from md up rather than applied
          outright, keeping the desktop bar white as it was. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-600 bg-slate-500 md:border-slate-200 md:bg-white" data-testid="patient-portal-bottom-nav">
        <div className="mx-auto flex max-w-lg items-stretch justify-around">
          {PORTAL_TABS.map((t) => {
            const Icon = t.icon;
            const isActive = activeTab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition ${isActive ? "text-white md:text-sky-600" : "text-slate-200 md:text-slate-400"}`}
                data-testid={`patient-portal-tab-${t.key}`}
              >
                <Icon className="h-5 w-5 shrink-0" />
                {/* min-w-0 above and truncate here so a long label shortens instead of
                    forcing its tab wider and squeezing the other three. */}
                <span className="w-full truncate px-0.5 text-center sm:hidden">{t.short}</span>
                <span className="hidden w-full truncate px-0.5 text-center sm:inline">{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
