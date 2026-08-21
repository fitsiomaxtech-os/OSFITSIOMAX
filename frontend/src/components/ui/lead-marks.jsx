import { AlertCircle, Star } from "lucide-react";

/**
 * The two marks a branch puts on a patient by hand, shown read-only.
 *
 * They are set in one place — Branch Leads, All Stages, where the whole branch is in one
 * list and the judgement can actually be made. Everywhere else a patient surfaces they are
 * only reported: a Consultant seeing the gold star knows to treat this one especially well,
 * a Physio seeing the red flag knows something needs looking at, and neither is being asked
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

export default LeadMarks;
