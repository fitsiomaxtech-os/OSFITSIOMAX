import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CalendarCheck, MapPin, XCircle } from "lucide-react";
import { getPublicAppointment } from "@/lib/api";
import { to12h, endTime12h } from "@/lib/time";
import { LOGO_URL } from "@/lib/printable";

/** "2026-08-04" -> "Tuesday, August 4" */
const weekdayLabel = (d) => (d
  ? new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
  : "—");
/** "2026-08-04" -> "04 - 08 - 2026" */
const dmyLabel = (d) => {
  const [y, m, day] = String(d || "").split("-");
  return y && m && day ? `${day} - ${m} - ${y}` : d || "—";
};

const Row = ({ k, v }) => (
  <div className="flex items-start justify-between gap-3 border-b border-slate-100 py-2.5 last:border-b-0">
    <dt className="text-sm text-slate-500">{k}</dt>
    <dd className="text-right text-sm font-semibold text-slate-800">{v}</dd>
  </div>
);

/**
 * The page behind the appointment link the branch sends the patient. Public by design —
 * the patient has no login — and read-only: it shows what their confirmation already
 * said, nothing more. Built phone-first, because that is where the link gets opened.
 */
export const AppointmentPage = () => {
  const { token } = useParams();
  const [state, setState] = useState({ loading: true, appt: null, error: "" });

  useEffect(() => {
    let cancelled = false;
    getPublicAppointment(token)
      .then((appt) => { if (!cancelled) setState({ loading: false, appt, error: "" }); })
      .catch((e) => {
        if (cancelled) return;
        setState({
          loading: false,
          appt: null,
          error: e?.response?.status === 404
            ? "This appointment link is not valid."
            : "Couldn't load this appointment. Please try again.",
        });
      });
    return () => { cancelled = true; };
  }, [token]);

  const { loading, appt, error } = state;

  return (
    <div className="min-h-screen bg-slate-100 px-3 py-6 sm:px-4 sm:py-10">
      <div className="mx-auto w-full max-w-md">
        <div className="overflow-hidden rounded-2xl bg-white shadow-lg ring-1 ring-slate-200">
          <div className={`flex items-center gap-3 px-5 py-4 text-white ${appt?.cancelled ? "bg-rose-600" : "bg-teal-600"}`}>
            <img src={LOGO_URL} alt="FITSIOMAX" className="h-11 w-11 shrink-0 rounded-lg bg-white/90 object-contain p-1" />
            <div className="min-w-0">
              <p className="text-lg font-bold">
                {appt?.cancelled ? "Appointment Cancelled" : "Appointment Confirmed"}
              </p>
              {appt?.refNo && <p className="truncate text-xs text-white/80">Ref {appt.refNo}</p>}
            </div>
          </div>

          {loading ? (
            <p className="px-6 py-16 text-center text-sm text-slate-400">Loading your appointment...</p>
          ) : error ? (
            <div className="px-6 py-14 text-center">
              <XCircle className="mx-auto mb-3 h-10 w-10 text-slate-300" />
              <p className="text-sm text-slate-500">{error}</p>
              <p className="mt-1 text-xs text-slate-400">Please contact the branch for help.</p>
            </div>
          ) : (
            <div className="p-5 sm:p-6">
              <div className={`rounded-xl border-2 px-4 py-5 text-center ${appt.cancelled ? "border-rose-200 bg-rose-50" : "border-teal-200 bg-teal-50"}`}>
                <p className={`text-xs font-bold uppercase tracking-widest ${appt.cancelled ? "text-rose-600" : "text-teal-600"}`}>
                  Your Appointment
                </p>
                <p className={`mt-1 text-2xl font-extrabold ${appt.cancelled ? "text-rose-700" : "text-teal-700"}`}>
                  {weekdayLabel(appt.date)}
                </p>
                <p className={`text-lg font-bold ${appt.cancelled ? "text-rose-700" : "text-teal-700"}`}>
                  {to12h(appt.time)} – {endTime12h(appt.time, appt.duration)}
                </p>
                <p className={`mt-1 text-sm font-semibold ${appt.cancelled ? "text-rose-600" : "text-teal-600"}`}>
                  with {appt.headPhysio}
                </p>
              </div>

              {appt.cancelled && (
                <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-semibold text-rose-700">
                  This appointment has been cancelled. Contact the branch to book another.
                </p>
              )}

              <dl className="mt-5">
                <Row k="Reference No." v={appt.refNo || "—"} />
                <Row k="Patient" v={appt.patient} />
                <Row k="Patient No." v={appt.patientNo} />
                <Row k="Phone" v={appt.phone} />
                <Row k="Date" v={dmyLabel(appt.date)} />
                <Row k="Time" v={`${to12h(appt.time)} – ${endTime12h(appt.time, appt.duration)}`} />
                <Row k="Duration" v={`${appt.duration} minutes`} />
                <Row k="Head Physio" v={appt.headPhysio} />
                {appt.branch && <Row k="Branch" v={appt.branch} />}
                {appt.bookedBy && <Row k="Booked By" v={appt.bookedBy} />}
              </dl>

              {appt.branchAddress && (
                <div className="mt-4 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  <p className="text-xs leading-relaxed text-slate-600">{appt.branchAddress}</p>
                </div>
              )}

              {appt.notes && (
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Notes</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{appt.notes}</p>
                </div>
              )}

              {!appt.cancelled && (
                <div className="mt-4 rounded-lg border border-teal-100 bg-teal-50/60 p-3 text-xs leading-relaxed text-teal-800">
                  <p>Please arrive 10 minutes early.</p>
                  <p>To reschedule or cancel, contact the branch quoting reference {appt.refNo || "above"}.</p>
                </div>
              )}

              <button
                type="button"
                onClick={() => window.print()}
                className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-700"
                data-testid="public-appt-print"
              >
                <CalendarCheck className="h-4 w-4" /> Save / Print
              </button>
            </div>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-slate-400">
          FITSIOMAX · Physiotherapy &amp; Rehabilitation
        </p>
      </div>
    </div>
  );
};
