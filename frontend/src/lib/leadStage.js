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
/**
 * Has the diet side finished?
 *
 * The same question the Nutritionist's own Consultations tab answers, asked off the lead
 * instead of off that board's row so the two cannot drift: the report is owed unless the
 * referral was for a chart alone, and the chart is owed only where one was actually
 * promised. Both flags false is the plain referral every consultation before them carries,
 * and that has always meant the report.
 *
 * Asked of every patient, not only the ones whose diet IS their course. It used to carry
 * that restriction inside it, which read correctly for the one caller it then had and made
 * it useless to the second: diet runs ALONGSIDE physio, so "still has treatment days" is a
 * fact about the physio course and says nothing at all about whether the diet plan was
 * delivered. The restriction belongs to the caller that wants it — dietCourseComplete
 * below, where a diet-only patient is the whole point — and not to the reading itself,
 * which programmePending asks of patients who are mid-course by definition.
 *
 * Check-in days are deliberately not part of this. They are follow-ups to a plan already
 * delivered, tracked on the Nutritionist's Patients tab against total_days, and a lead
 * does not carry those counts anyway.
 */
const dietSideSettled = (lead) => {
  // Referred is not enrolled — no coach, no programme, nothing to have finished.
  if (!lead.diet_coach_id) return false;
  const chartOnly = !!lead.diet_chart && !lead.diet_consultation;
  const owesReport = !chartOnly && !lead.diet_consultation_report;
  const owesChart = !!lead.diet_chart && !lead.diet_chart_sent_at;
  return !owesReport && !owesChart;
};

// The diet-only reading of it: no treatment course of their own, and the diet side done.
const dietCourseComplete = (lead) => (lead.total_sessions || 0) === 0 && dietSideSettled(lead);

/**
 * Is a programme running alongside the treatment course still owed?
 *
 * A consultation can send a patient away with three things at once — treatment, rehab and
 * a diet plan — and only one of them is measured in treatment days. Read off those days
 * alone, a patient who finished their sessions was "Completed" while their rehab fee had
 * never been collected and no Nutritionist had ever seen them: they left every pill on the
 * bar, including the Rehab and Diet Consultation pills that are the only places those two
 * programmes are worked, so the outstanding fee became uncollectable and the referral
 * unfindable. Finishing one of three things is not finishing.
 *
 * Only programmes the patient was actually put on count. A tick from the Consultant, a
 * course on the lead, or money already taken all mean the branch owes them something; a
 * patient nobody referred owes nothing and is unaffected by any of this.
 *
 * Each side is pending until the branch has done the two things it can do from this board:
 * take the fee, and put an expert on it. What happens after that — the rehab days
 * themselves, the check-ins — is delivered on the expert's own board and counted there,
 * and a lead does not carry those counts to be read from here.
 */
const programmePending = (lead) => {
  const rehabOn = !!lead.rehab_referred || !!lead.rehab_package_id || lead.rehab_fee_paid != null;
  if (rehabOn && (lead.rehab_fee_paid == null || !lead.rehab_physio_id)) return true;
  const dietOn = !!lead.diet_recommended || !!lead.diet_consultation || !!lead.diet_chart
    || lead.diet_fee_paid != null || lead.diet_chart_fee_paid != null;
  if (dietOn && !dietSideSettled(lead)) return true;
  return false;
};

export const isCourseComplete = (lead) => {
  // Not while the Head Physio still owes a review. Finishing the last booked day is not
  // finishing treatment -- every course earns a closing review (v3_reviews' own
  // _review_eligibility raises one past the last whole week precisely so the days a
  // seven-day rule leaves over still get read), and until it is written the patient is
  // mid-hand-off rather than discharged. Without this the branch moved them into Completed
  // the moment the physio ticked off the last day, out of every stage anyone would look
  // for them in, while the review sat on the Branch Admin's desk.
  //
  // Above the clauses below rather than folded into the last one, because it outranks all
  // of them -- including the physio's own Mark Treatment Complete, which is now refused
  // while a review is owed (physio_complete_consultation) but sits on leads closed out
  // before that guard existed.
  //
  // Stamped by the server, so only where the server was asked -- see review_pending in
  // schemas/v3.py. Undefined reads as "no review owed", which keeps every board that does
  // not stamp it reading exactly as it did before.
  if (lead.review_pending) return false;
  // Nor while rehab or diet is still open. Those run ALONGSIDE the treatment course rather
  // than instead of it, so none of the clauses below can see them: physio_stage is the
  // physio's word on their own sessions, "Consultation Completed" closes a consultation,
  // and the day count at the bottom counts treatment days. Each of the three used to
  // discharge a patient who still owed a rehab fee or had never been given a Nutritionist.
  //
  // Above them all rather than folded into one, because it outranks all of them for the
  // same reason review_pending does: there is demonstrably something left to do.
  if (programmePending(lead)) return false;
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
  // A Diet-only patient ends on the diet side and nowhere else. Without this they could
  // not reach this stage at all: they hold no physio_stage, the branch never marks a diet
  // patient "Consultation Completed", and their check-ins are diet_sessions rather than
  // the treatment days the line below counts — so a patient whose report was written and
  // whose chart had gone out sat wherever the branch last left them, reading as Follow Up
  // for good, while the Nutritionist's own board counted them finished.
  if (dietCourseComplete(lead)) return true;
  // Otherwise off the days themselves, rather than a stage somebody remembers to set.
  // Gated on there having been days at all: a patient with none booked has not finished a
  // course, they have not started one.
  return (lead.total_sessions || 0) > 0 && (lead.completed_sessions || 0) >= lead.total_sessions;
};
