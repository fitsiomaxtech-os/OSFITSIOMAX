/**
 * Has this patient's course finished?
 *
 * "Completed" is a consultation stage that nothing ever writes to a lead -- see
 * ensure_diet_and_completed_stages in seed.py. It is read off the lead instead, which
 * means every board showing that stage has to agree on what puts a patient under it.
 * Two of them were deciding it independently, in matching blocks kept in step by a
 * comment asking the next reader to keep them that way. This is that block, once, so a
 * third reader cannot quietly disagree with the first two.
 */
export const isCourseComplete = (lead) => {
  // The physio said so. The only deliberate signal in here -- Mark Treatment Complete in
  // the Physio Master View, which writes physio_stage -- and the one the branch could not
  // see: the physio closed the course and the patient stayed wherever the branch had last
  // left them, with nothing on the branch's own board saying they were done.
  if (lead.physio_stage === "Complete") return true;
  // A Consultation Only patient finishes without ever having a treatment day, and the
  // branch marks them done on the Consultations board. They belong here for the same
  // reason everybody else does -- there is nothing left for them to attend -- and the
  // stage they carry is still written, it just no longer has a pill of its own.
  if (lead.consultation_stage === "Consultation Completed") return true;
  // Otherwise off the days themselves, rather than a stage somebody remembers to set.
  // Gated on there having been days at all: a patient with none booked has not finished a
  // course, they have not started one.
  return (lead.total_sessions || 0) > 0 && (lead.completed_sessions || 0) >= lead.total_sessions;
};
