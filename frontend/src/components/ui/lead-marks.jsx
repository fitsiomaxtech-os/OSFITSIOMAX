import { AlertCircle, RotateCcw, Star } from "lucide-react";

/**
 * The two marks a branch puts on a patient by hand, shown read-only.
 *
 * They are set in one place — Branch Leads, on any of its stages, where the branch's own
 * admin has the patient in front of them. Everywhere else a patient surfaces they are only
 * reported: a Consultant seeing the gold star knows to treat this one especially well, a
 * Physio seeing the red flag knows something needs looking at, and neither is being asked
 * to decide it from the fraction of the branch their own board shows them.
 *
 * Renders nothing at all when a patient carries neither, because these lists are long and a
 * pair of empty outlines on every row of them is noise standing in for information. The
 * editable pair in Branch Leads does the opposite, and for the opposite reason: there the
 * control has to be findable before it has ever been used.
 */
export const LeadMarks = ({ lead, className = "" }) => {
  const vip = !!(lead?.is_vip);
  const attention = !!(lead?.needs_attention);
  if (!vip && !attention) return null;
  return (
    <span className={`inline-flex shrink-0 items-center gap-0.5 align-middle ${className}`} data-testid="lead-marks">
      {vip && (
        <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-500" aria-label="VIP client">
          <title>VIP client</title>
        </Star>
      )}
      {attention && (
        <AlertCircle className="h-3.5 w-3.5 fill-rose-500 text-white" aria-label="Needs attention">
          <title>Needs attention</title>
        </AlertCircle>
      )}
    </span>
  );
};

/**
 * "Rescheduled" — this patient's consultation was moved off the slot it was first booked
 * onto.
 *
 * A mark, not a stage, and it lives here beside the other two for the same reason: it says
 * something about how a patient's booking has gone, never about where they are in the
 * pipeline. A rescheduled lead is still sitting in Appointment waiting for the same
 * consultation.
 *
 * Set in one place — Branch Leads, by rebooking the appointment onto a different slot —
 * and reported read-only everywhere else. The Consultant about to see this patient, and
 * the Head Physio looking at the day's calendar, both want to know the 10:30 in front of
 * them is not the time that was originally arranged; neither is being asked to decide it.
 *
 * Renders nothing when the patient has not been moved, like LeadMarks above and for the
 * same reason: an empty outline on every row of a long list is noise standing in for
 * information.
 *
 * The count shows from the second move on. One reschedule is ordinary and needs no number;
 * three is a patient who keeps not coming, and that is worth reading off the row rather
 * than out of the activity log.
 */
export const RescheduledTag = ({ lead, className = "", compact = false }) => {
  if (!lead?.appointment_rescheduled) return null;
  const count = Number(lead.appointment_reschedule_count) || 1;
  const from = lead.appointment_rescheduled_from || "";
  const title = from
    ? `Rescheduled ${count > 1 ? `${count} times, last ` : ""}from ${from.replace("T", " ")}`
    : "Appointment rescheduled";
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-0.5 rounded-full bg-amber-100 font-bold uppercase tracking-wide text-amber-700 ring-1 ring-amber-200 align-middle ${
        compact ? "px-1 py-0 text-[8px]" : "px-1.5 py-0.5 text-[9px]"
      } ${className}`}
      title={title}
      aria-label={title}
      data-testid="lead-rescheduled-tag"
    >
      <RotateCcw className={compact ? "h-2 w-2" : "h-2.5 w-2.5"} />
      {compact ? (count > 1 ? `×${count}` : "") : <>Rescheduled{count > 1 ? ` ×${count}` : ""}</>}
    </span>
  );
};

export default LeadMarks;
