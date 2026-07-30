import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Calendar, CheckCircle2, ChevronRight, RefreshCw, XCircle, Search, Phone, Stethoscope, ClipboardList, Lock, Pencil, Dumbbell, Users, X, Bell, Plus, Trash2, Ban, ClipboardCheck, IndianRupee } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { StageTabBar } from "@/components/ui/stage-tab";
import { DateFilterPopover } from "@/components/DateFilterPopover";
import {
  getConsultationsBoard, moveConsultationStage, listStoreItems,
  collectPackagePayment, collectTreatmentFee, markInstallmentPaid, savePhysioDiagnosis, unlockPhysioDiagnosis,
  saveTreatmentSummary, unlockTreatmentSummary, stagesList, getDoctors,
  assignPhysioWithSessions, getDoctorCalendar,
  scheduleConsultationFollowUp, rescheduleConsultationFollowUp,
  getLeadRemarks, getLeadActivity,
  saveConsultationDecision, markConsultationCompleted,
} from "@/lib/api";

const CONSULTATION_FEE_PAYMENT_MODES = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
];
const TREATMENT_FEE_PAYMENT_MODES = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "cheque", label: "Cheque" },
  { value: "partial", label: "Partial Payment" },
];
const PARTIAL_ORDINALS = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth"];
const partialInstallmentLabel = (idx) => `${PARTIAL_ORDINALS[idx] || `#${idx + 1}`} Payment`;

// One distinct color per Treatment Package option (cycles if there are ever more than 5).
const TREATMENT_PACKAGE_COLORS = ["#2563eb", "#059669", "#d97706", "#7c3aed", "#e11d48"];

// FITSIO STORE session packages are named like "02 Weeks" / "03 Week" — there's no
// separate structured weeks field, so the duration is read off the leading number in
// the name. Falls back to null (shown as "—") for a package that isn't named this way.
const weeksFromPackageName = (name) => {
  const match = (name || "").match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : null;
};

// One fixed color per payment mode, consistent everywhere it's offered.
const PAYMENT_MODE_COLORS = {
  cash: "#059669",
  upi: "#2563eb",
  card: "#7c3aed",
  cheque: "#d97706",
  partial: "#e11d48",
};

export const ConsultationsBoard = ({ branchId, viewerRole, externalStageFilter, showOwnStageBar = true, autoOpenLeadId, onAutoOpened }) => {
  const isConsultant = viewerRole === "head_physio";
  // Head Physio tracks progress on their own independent pipeline (head_consultation_stage),
  // fully separate from Branch's own consultation_stage pipeline.
  const stageField = isConsultant ? "head_consultation_stage" : "consultation_stage";
  const [board, setBoard] = useState({ leads: [], stage_counts: {} });
  const [stages, setStages] = useState([]); // dynamic Consultation Stages, from Super Admin > Pipeline Stage Management
  const [stageFilter, setStageFilter] = useState(null);
  const [dateFilter, setDateFilter] = useState(null); // { from, to, label, key } | null — filters by appointment date
  const [search, setSearch] = useState("");
  const [selectedLead, setSelectedLead] = useState(null);
  const [detailTab, setDetailTab] = useState("overview");
  const [timelineRemarks, setTimelineRemarks] = useState([]);
  const [timelineActivity, setTimelineActivity] = useState([]);
  const [storeItems, setStoreItems] = useState([]);
  const [followUpDraft, setFollowUpDraft] = useState(null); // { date, time, remarks } | null
  const [rescheduleDraft, setRescheduleDraft] = useState(null); // { followupId, date, time, reason } | null
  const [loading, setLoading] = useState(false);

  // Head Physio's own diagnosis report — separate from Pre-Sales' read-only `diagnosis`
  const [physioDiagDraft, setPhysioDiagDraft] = useState("");
  const [physioDiagEditing, setPhysioDiagEditing] = useState(false);
  const [savingPhysioDiag, setSavingPhysioDiag] = useState(false);
  const physioDiagDebounceRef = useRef(null);

  // Head Physio's treatment plan summary
  const [treatmentDraft, setTreatmentDraft] = useState("");
  const [treatmentEditing, setTreatmentEditing] = useState(false);
  const [savingTreatment, setSavingTreatment] = useState(false);
  const treatmentDebounceRef = useRef(null);

  // Collect Fee popup (Branch Admin only) — at the Consultation Fee stage, Cash/UPI/Card only
  const [collectFeeDraft, setCollectFeeDraft] = useState(null); // { amount, payment_mode } | null
  const [collectingFee, setCollectingFee] = useState(false);
  // Second-step popup — only opens if the entered amount doesn't match the assigned
  // package price (needs an explicit "yes, that's right" confirm) and/or the chosen
  // mode needs its own extra fields (UPI Transaction ID/UTR, Card account details).
  // Cash at the expected amount skips this entirely and submits straight away.
  const [packageConfirmDraft, setPackageConfirmDraft] = useState(null);

  // Collect Treatment Fee popup (Branch Admin only) — at the Treatment Fee stage, any payment method
  const [treatmentFeeDraft, setTreatmentFeeDraft] = useState(null); // { paid_amount, payment_mode } | null
  const [collectingTreatmentFee, setCollectingTreatmentFee] = useState(false);
  // Same second-step confirm popup as packageConfirmDraft above, but for Cash/UPI/Card
  // on the Treatment Fee. Cheque and Partial Payment keep their existing single-popup
  // flow (locked amount, no manual override, no confirm step).
  const [treatmentConfirmDraft, setTreatmentConfirmDraft] = useState(null);

  // Physio Assign popup (Branch Admin only) — pick an available Jr. Physio, then book all
  // of the paid session package's sessions against that physio's own calendar (Consultations
  // > Physio Calendar) in the same step.
  const [showPhysioModal, setShowPhysioModal] = useState(false);
  const [physioOptions, setPhysioOptions] = useState([]);
  const [physioPick, setPhysioPick] = useState("");
  const [assigningPhysio, setAssigningPhysio] = useState(false);
  const [physioCalendarData, setPhysioCalendarData] = useState(null);
  const [loadingPhysioCalendar, setLoadingPhysioCalendar] = useState(false);

  // Treatment (Head Physio only) — "Save & Move": every patient goes on to treatment
  // sessions once Diagnosis Report + Treatment Summary are written; only the Treatment
  // Package (names only, no prices shown here) is chosen. "consultation_only" is a legacy
  // decision value some existing leads already carry — no longer offered as a choice.
  const [decisionDraft, setDecisionDraft] = useState({ decision: "consultation_treatment", item_id: "", mode: "offline", sessionsPerWeek: "" });
  const [savingDecision, setSavingDecision] = useState(false);

  // Mark Consultation Completed (Branch Admin only) — "Consultation Only" patients, at
  // the Fee Collected stage.
  const [completingConsultation, setCompletingConsultation] = useState(false);

  useEffect(() => {
    if (!branchId) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const res = await getConsultationsBoard(branchId, isConsultant ? "head_consultation" : undefined);
        if (!cancelled) setBoard(res);
      } catch (err) {
        console.error("Consultations board load error:", err);
        if (!cancelled) toast.error("Failed to load consultations");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [branchId]);

  const load = useCallback(async () => {
    if (!branchId) return;
    try {
      setLoading(true);
      const res = await getConsultationsBoard(branchId, isConsultant ? "head_consultation" : undefined);
      setBoard(res);
    } catch (err) {
      console.error("Consultations board load error:", err);
      toast.error("Failed to load consultations");
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  // Date Filter + search only — deliberately excludes the stage-pill filter, so this can
  // also drive the per-stage counts below (counting by stage after narrowing to
  // "everything in the date range", not after already narrowing to one stage).
  const dateAndSearchFiltered = useMemo(() => {
    let rows = board.leads || [];
    if (dateFilter) {
      const from = dateFilter.from?.getTime();
      const to = dateFilter.to?.getTime();
      rows = rows.filter((l) => {
        if (!l.appointment_date) return false;
        const ts = new Date(`${l.appointment_date}T00:00:00`).getTime();
        if (!ts) return false;
        if (from && ts < from) return false;
        if (to && ts > to) return false;
        return true;
      });
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((l) => `${l.name || ""} ${l.phone || ""}`.toLowerCase().includes(q));
    }
    return rows;
  }, [board.leads, dateFilter, search]);

  // "Treatments" (Head Physio's own board only) is a cross-cutting view, not a real
  // position in the head_consultation_stage pipeline — a lead shows up here the moment
  // any Treatment Fee amount is collected, while staying visible under "Consultation
  // Visit" too, since head_consultation_stage itself never actually changes to
  // "Treatments" (there's nothing to "leave" for it to count as a real stage move).
  const matchesStage = useCallback((lead, stageName) => {
    if (isConsultant && stageName === "Treatments") return lead.treatment_fee_paid != null;
    return lead[stageField] === stageName;
  }, [isConsultant, stageField]);

  const filtered = useMemo(() => {
    if (!stageFilter) return dateAndSearchFiltered;
    return dateAndSearchFiltered.filter((l) => matchesStage(l, stageFilter));
  }, [dateAndSearchFiltered, stageFilter, matchesStage]);

  // Stage counts for the head bar — derived client-side from the Date Filter/search-only
  // list so they always match whichever pipeline (branch vs. head physio) is active for
  // this viewer, and reflect the active filters rather than all-time totals.
  const derivedStageCounts = useMemo(() => {
    const counts = {};
    stages.forEach((s) => { counts[s.name] = dateAndSearchFiltered.filter((l) => matchesStage(l, s.name)).length; });
    return counts;
  }, [dateAndSearchFiltered, stages, matchesStage]);

  useEffect(() => {
    listStoreItems().then(setStoreItems).catch(() => setStoreItems([]));
    stagesList(isConsultant ? "head_consultation" : "consultation").then(setStages).catch(() => setStages([]));
  }, [isConsultant]);

  // When embedded inside another board (e.g. Branch Leads' unified stage bar), let the
  // parent drive which stage this board is filtered to.
  useEffect(() => {
    if (externalStageFilter !== undefined) setStageFilter(externalStageFilter);
  }, [externalStageFilter]);

  // Branch Leads' own lead popup hands off a specific lead here (rather than duplicating
  // this board's stage-specific popups) — once this board's own data has loaded, find that
  // lead and open its detail modal directly.
  useEffect(() => {
    if (!autoOpenLeadId || !(board.leads || []).length) return;
    const match = board.leads.find((l) => l.id === autoOpenLeadId);
    if (match) {
      setSelectedLead(match);
      onAutoOpened && onAutoOpened();
    }
  }, [autoOpenLeadId, board.leads]);

  const stageColor = useCallback(
    (name) => stages.find((s) => s.name === name)?.color || "#64748b",
    [stages],
  );

  useEffect(() => {
    setPhysioDiagDraft(selectedLead?.physio_diagnosis_report || "");
    setPhysioDiagEditing(!selectedLead?.physio_diagnosis_report);
    setTreatmentDraft(selectedLead?.treatment_summary || "");
    setTreatmentEditing(!selectedLead?.treatment_summary);
    setShowPhysioModal(false);
    setPhysioPick("");
    setFollowUpDraft(null);
    setRescheduleDraft(null);
    setCollectFeeDraft(null);
    setTreatmentFeeDraft(null);
    setDecisionDraft({ decision: "consultation_treatment", item_id: "", mode: "offline", sessionsPerWeek: "" });
  }, [selectedLead?.id]);

  useEffect(() => {
    if (!selectedLead?.id || detailTab !== "timeline") return;
    getLeadRemarks(selectedLead.id).then(setTimelineRemarks).catch(() => setTimelineRemarks([]));
    getLeadActivity(selectedLead.id).then(setTimelineActivity).catch(() => setTimelineActivity([]));
  }, [selectedLead?.id, detailTab]);

  // Session packages (weeks/session-count items) — the Treatment Package chosen
  // as part of the Consultation Decision (Consultation + Treatment only).
  const treatmentPackageItems = storeItems.filter((i) => i.item_type === "session");

  const moveStage = async (lead, next) => {
    if (next === lead.consultation_stage) return;
    try {
      const updated = await moveConsultationStage(lead.id, next);
      toast.success(`${lead.name || "Lead"} moved → ${next}`);
      setSelectedLead(null);
      setBoard((b) => ({ ...b, leads: (b.leads || []).map((l) => l.id === lead.id ? { ...l, consultation_stage: updated.consultation_stage } : l) }));
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Move failed");
    }
  };

  // ---- Consultation Decision (Head Physio) — "Save & Move" ----
  const submitConsultationDecision = async () => {
    if (!(selectedLead.physio_diagnosis_report || "").trim()) { toast.error("Write the Diagnosis Report first"); return; }
    if (!(selectedLead.treatment_summary || "").trim()) { toast.error("Write the Treatment Summary first"); return; }
    if (!decisionDraft.item_id) { toast.error("Select a Treatment Package"); return; }
    const item = treatmentPackageItems.find((i) => i.id === decisionDraft.item_id);
    const weeks = weeksFromPackageName(item?.name);
    if (!weeks) { toast.error("Couldn't read a week count from this package's name"); return; }
    const perWeek = parseInt(decisionDraft.sessionsPerWeek, 10) || 0;
    if (!perWeek) { toast.error("Enter sessions per week"); return; }
    setSavingDecision(true);
    try {
      const res = await saveConsultationDecision(selectedLead.id, {
        decision: decisionDraft.decision,
        item_id: decisionDraft.item_id,
        mode: decisionDraft.mode,
        sessions_override: weeks * perWeek,
      });
      toast.success("Saved & moved to Branch Admin");
      setSelectedLead(null);
      setBoard((b) => ({ ...b, leads: (b.leads || []).map((l) => l.id === res.lead.id ? res.lead : l) }));
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to save");
    }
    setSavingDecision(false);
  };

  // ---- Mark Consultation Completed (Branch Admin) — "Consultation Only" patients ----
  const submitMarkCompleted = async () => {
    setCompletingConsultation(true);
    try {
      const res = await markConsultationCompleted(selectedLead.id);
      toast.success("Consultation marked completed");
      setSelectedLead(null);
      setBoard((b) => ({ ...b, leads: (b.leads || []).map((l) => l.id === res.lead.id ? res.lead : l) }));
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to mark completed");
    }
    setCompletingConsultation(false);
  };

  const applyUpdatedLead = (updatedLead) => {
    setBoard((b) => ({ ...b, leads: (b.leads || []).map((l) => l.id === updatedLead.id ? updatedLead : l) }));
    setSelectedLead(updatedLead);
  };

  // ---- Head Physio's diagnosis report (separate from Pre-Sales' read-only diagnosis) ----
  // Auto-saves (debounced, silent — no toast) while typing; never re-locks a record, so
  // once opened for editing it just keeps saving in place until "Done" is clicked.
  const autoSavePhysioDiag = async (text) => {
    if (!text.trim()) return;
    setSavingPhysioDiag(true);
    try {
      const updated = await savePhysioDiagnosis(selectedLead.id, text.trim(), false);
      applyUpdatedLead(updated);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to save diagnosis report");
    }
    setSavingPhysioDiag(false);
  };

  const handlePhysioDiagChange = (text) => {
    setPhysioDiagDraft(text);
    if (physioDiagDebounceRef.current) clearTimeout(physioDiagDebounceRef.current);
    physioDiagDebounceRef.current = setTimeout(() => autoSavePhysioDiag(text), 800);
  };

  const finishPhysioDiagEdit = () => {
    if (physioDiagDebounceRef.current) { clearTimeout(physioDiagDebounceRef.current); physioDiagDebounceRef.current = null; }
    if (physioDiagDraft.trim()) autoSavePhysioDiag(physioDiagDraft);
    setPhysioDiagEditing(false);
  };

  const unlockPhysioDiag = async () => {
    try {
      const updated = await unlockPhysioDiagnosis(selectedLead.id);
      applyUpdatedLead(updated);
      setPhysioDiagEditing(true);
    } catch (err) {
      toast.error("Failed to unlock diagnosis report");
    }
  };

  // ---- Head Physio's treatment summary ----
  const autoSaveTreatment = async (text) => {
    if (!text.trim()) return;
    setSavingTreatment(true);
    try {
      const updated = await saveTreatmentSummary(selectedLead.id, text.trim(), false);
      applyUpdatedLead(updated);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to save treatment summary");
    }
    setSavingTreatment(false);
  };

  const handleTreatmentChange = (text) => {
    setTreatmentDraft(text);
    if (treatmentDebounceRef.current) clearTimeout(treatmentDebounceRef.current);
    treatmentDebounceRef.current = setTimeout(() => autoSaveTreatment(text), 800);
  };

  const finishTreatmentEdit = () => {
    if (treatmentDebounceRef.current) { clearTimeout(treatmentDebounceRef.current); treatmentDebounceRef.current = null; }
    if (treatmentDraft.trim()) autoSaveTreatment(treatmentDraft);
    setTreatmentEditing(false);
  };

  const unlockTreatment = async () => {
    try {
      const updated = await unlockTreatmentSummary(selectedLead.id);
      applyUpdatedLead(updated);
      setTreatmentEditing(true);
    } catch (err) {
      toast.error("Failed to unlock treatment summary");
    }
  };

  // ---- Collect Fee (Branch Admin) — at the Consultation Visit stage ----
  // The amount defaults to the assigned package_price but Branch Admin can edit it
  // if a different amount was actually collected. If the Head Physio's decision was
  // "Consultation + Treatment" and the Treatment Fee hasn't been paid yet, its draft
  // opens alongside this one so both fees are collected together in one popup.
  const openCollectFeeDraft = () => {
    setCollectFeeDraft({
      payment_mode: selectedLead.package_payment_mode || "cash",
      amount: selectedLead.package_paid ?? selectedLead.package_price ?? "",
    });
    if (selectedLead.consultation_decision === "consultation_treatment" && selectedLead.treatment_fee_paid == null) {
      openTreatmentFeeDraft();
    }
  };

  // ---- Collect Treatment Fee (Branch Admin) — for "Consultation + Treatment"
  // patients only. The Treatment Package and its price are locked in from what the
  // Head Physio already chose at Save & Move — neither is editable here. Normally
  // opened together with the Consultation Fee draft above; also independently
  // reachable from the Fee Collected panel as a fallback if it wasn't collected
  // together the first time.
  const openTreatmentFeeDraft = () => {
    setTreatmentFeeDraft({
      payment_mode: selectedLead.treatment_fee_payment_mode || "cash",
      amount: selectedLead.treatment_fee_paid ?? selectedLead.session_package_price ?? "",
      bank_name: "",
      cheque_number: "",
      // Cash/UPI/Card/Cheque default to covering every session (today's full
      // Collect behavior) — reducing this reveals a Due Date for the balance.
      sessions_now: selectedLead.session_package_sessions ?? "",
      balance_due_date: "",
      // First installment defaults to today — it's the one being collected right now;
      // later installments get their own scheduled due date.
      partial_installments: [
        { sessions: "", due_date: new Date().toISOString().slice(0, 10) },
        { sessions: "", due_date: "" },
      ],
    });
  };

  // Partial Payment is split by session count, not a raw amount — each installment's
  // amount is derived from how many of the package's sessions it covers, at the
  // package's own per-session rate, so the numbers always agree with "N sessions x
  // Rs.rate/session" shown elsewhere. Total to split is the locked-in
  // session_package_price/session_package_sessions, never client-editable fields.
  const treatmentFeeTotal = selectedLead?.session_package_price || 0;
  const treatmentFeeTotalSessions = selectedLead?.session_package_sessions || 0;
  const perSessionRate = treatmentFeeTotalSessions ? treatmentFeeTotal / treatmentFeeTotalSessions : 0;
  const partialInstallments = treatmentFeeDraft?.partial_installments || [];
  const partialSessionsTotal = partialInstallments.reduce((sum, i) => sum + (parseInt(i.sessions, 10) || 0), 0);
  const partialMismatch = treatmentFeeTotalSessions > 0 && partialSessionsTotal !== treatmentFeeTotalSessions;
  const partialAllFilled = partialInstallments.length >= 2 && partialInstallments.every((i) => parseInt(i.sessions, 10) > 0 && i.due_date);

  // Cash/UPI/Card/Cheque can ALSO collect for only some sessions right now (e.g.
  // 5 of 10) — same session-split math as Partial Payment, but as a single
  // "pay now" / "balance due later" split rather than a full pre-planned schedule.
  const treatmentSessionsNowRaw = treatmentFeeDraft?.sessions_now;
  const treatmentSessionsNow = treatmentSessionsNowRaw === "" || treatmentSessionsNowRaw == null
    ? treatmentFeeTotalSessions
    : (parseInt(treatmentSessionsNowRaw, 10) || 0);
  const treatmentIsPartialSessions = treatmentFeeTotalSessions > 0 && treatmentSessionsNow > 0 && treatmentSessionsNow < treatmentFeeTotalSessions;
  const treatmentComputedAmount = treatmentFeeTotalSessions ? Math.round(treatmentSessionsNow * perSessionRate * 100) / 100 : treatmentFeeTotal;
  const treatmentRemainingSessions = treatmentFeeTotalSessions - treatmentSessionsNow;
  const treatmentRemainingAmount = Math.round((treatmentFeeTotal - (parseFloat(treatmentFeeDraft?.amount) || treatmentComputedAmount)) * 100) / 100;

  // Changing "Sessions Covered Now" re-computes the Treatment Fee amount to match
  // (still hand-editable afterward for a discount, same as the full-package flow).
  const setTreatmentSessionsNow = (value) => {
    const sessionsNum = value === "" ? treatmentFeeTotalSessions : (parseInt(value, 10) || 0);
    const computed = treatmentFeeTotalSessions ? Math.round(sessionsNum * perSessionRate * 100) / 100 : treatmentFeeTotal;
    setTreatmentFeeDraft({ ...treatmentFeeDraft, sessions_now: value, amount: computed });
  };

  // Attaches sessions_now/balance_due_date to a Cash/UPI/Card/Cheque payload when
  // this collection doesn't cover every session — validates the balance Due Date
  // is filled in first. Returns null (after a toast) if validation fails.
  const attachSessionsSplit = (payload) => {
    if (!treatmentIsPartialSessions) return payload;
    if (!treatmentFeeDraft.balance_due_date) {
      toast.error("Enter a Due Date for the balance sessions");
      return null;
    }
    return { ...payload, sessions_now: treatmentSessionsNow, balance_due_date: treatmentFeeDraft.balance_due_date };
  };

  // Shared validation for Cheque/Partial Payment's own fields — Cash/UPI/Card
  // don't use this at all, they go through the separate confirm-popup flow below
  // since their amount is editable and (for UPI/Card) they need their own fields.
  const buildTreatmentFeePayload = () => {
    const mode = treatmentFeeDraft.payment_mode;
    const payload = { payment_mode: mode };
    if (mode === "cheque") {
      if (!treatmentFeeDraft.bank_name.trim() || !treatmentFeeDraft.cheque_number.trim()) {
        toast.error("Bank Name and Cheque Number are required");
        return null;
      }
      payload.bank_name = treatmentFeeDraft.bank_name.trim();
      payload.cheque_number = treatmentFeeDraft.cheque_number.trim();
      return attachSessionsSplit(payload);
    } else if (mode === "partial") {
      if (!partialAllFilled) {
        toast.error("Every installment needs a session count and a due date");
        return null;
      }
      if (partialMismatch) {
        toast.error("Installment sessions must add up to the Total Sessions");
        return null;
      }
      payload.partial_installments = partialInstallments.map((i) => ({
        amount: Math.round((parseInt(i.sessions, 10) || 0) * perSessionRate),
        due_date: i.due_date,
      }));
    }
    return payload;
  };

  // Both fee sections are collected independently — each has its own "Collect"
  // button and can be actioned in either order. The popup only closes once every
  // fee it was opened for is collected; until then it stays open so the other
  // section's own button is still reachable.
  const bothFeesDone = (lead) => !treatmentFeeDraft || lead.treatment_fee_paid != null;
  const consultationFeeDone = (lead) => !collectFeeDraft || lead.package_paid != null;

  // Clicking "Collect Consultation Fee" in the main popup always opens the
  // second "Confirm Payment" popup — a simple, explicit confirm/cancel step
  // (with the amount still editable there) before anything is actually saved.
  const startCollectConsultationFee = () => {
    const amount = parseFloat(collectFeeDraft.amount);
    if (!(amount > 0)) {
      toast.error("Enter a valid Consultation Fee amount");
      return;
    }
    setPackageConfirmDraft({ upi_transaction_id: "", upi_utr: "", account_number: "", account_holder_name: "", bank_name: "", ifsc_code: "" });
  };

  // Confirm button inside the second "Confirm Payment" popup — validates
  // UPI/Card's own fields (Cash just needed the mismatch acknowledged).
  const confirmCollectConsultationFee = () => {
    const amount = parseFloat(collectFeeDraft.amount);
    const mode = collectFeeDraft.payment_mode;
    const payload = { payment_mode: mode, amount, confirmed: true };
    if (mode === "upi") {
      if (!packageConfirmDraft.upi_transaction_id.trim() || !packageConfirmDraft.upi_utr.trim()) {
        toast.error("UPI Transaction ID and UTR are required");
        return;
      }
      payload.upi_transaction_id = packageConfirmDraft.upi_transaction_id.trim();
      payload.upi_utr = packageConfirmDraft.upi_utr.trim();
    } else if (mode === "card") {
      if (!packageConfirmDraft.account_number.trim() || !packageConfirmDraft.account_holder_name.trim() || !packageConfirmDraft.bank_name.trim() || !packageConfirmDraft.ifsc_code.trim()) {
        toast.error("Account Number, Account Holder Name, Bank Name and IFSC Code are required");
        return;
      }
      payload.account_number = packageConfirmDraft.account_number.trim();
      payload.account_holder_name = packageConfirmDraft.account_holder_name.trim();
      payload.bank_name = packageConfirmDraft.bank_name.trim();
      payload.ifsc_code = packageConfirmDraft.ifsc_code.trim();
    }
    submitConsultationFee(payload);
  };

  // Actually calls the API. Leaves the Treatment Fee section (if present)
  // untouched and open for its own button.
  const submitConsultationFee = async (payload) => {
    setCollectingFee(true);
    try {
      const res = await collectPackagePayment(selectedLead.id, payload);
      toast.success(selectedLead.package_paid != null ? "Consultation Fee payment updated" : "Consultation Fee collected");
      setBoard((b) => ({ ...b, leads: (b.leads || []).map((l) => l.id === res.lead.id ? res.lead : l) }));
      setPackageConfirmDraft(null);
      if (bothFeesDone(res.lead)) {
        setCollectFeeDraft(null);
        setTreatmentFeeDraft(null);
        setSelectedLead(null);
      } else {
        setSelectedLead(res.lead);
      }
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to collect Consultation Fee");
    }
    setCollectingFee(false);
  };

  // Clicking one of the 5 Payment Mode buttons opens that mode's own dedicated
  // popup — every mode (including Cash) now goes through its own explicit
  // "Collect" step there, rather than sharing one form with a mode selector.
  const chooseTreatmentPaymentMode = (mode) => {
    setTreatmentFeeDraft({ ...treatmentFeeDraft, payment_mode: mode });
    setTreatmentConfirmDraft({ upi_transaction_id: "", upi_utr: "", account_number: "", account_holder_name: "", bank_name: "", ifsc_code: "" });
  };

  // The dedicated popup's own submit button — dispatches to whichever path
  // already handles that mode (Cheque/Partial build their own payload directly;
  // Cash/UPI/Card go through the shared confirm-and-collect path).
  const submitTreatmentModePopup = () => {
    const mode = treatmentFeeDraft.payment_mode;
    if (mode === "cheque" || mode === "partial") {
      const payload = buildTreatmentFeePayload();
      if (!payload) return;
      submitTreatmentFee(payload);
      return;
    }
    confirmCollectTreatmentFee();
  };

  // Confirm button inside the second "Confirm Payment" popup — validates
  // UPI/Card's own fields (Cash just needed the mismatch acknowledged).
  const confirmCollectTreatmentFee = () => {
    const amount = parseFloat(treatmentFeeDraft.amount);
    const mode = treatmentFeeDraft.payment_mode;
    const payload = { payment_mode: mode, amount, confirmed: true };
    if (mode === "upi") {
      if (!treatmentConfirmDraft.upi_transaction_id.trim() || !treatmentConfirmDraft.upi_utr.trim()) {
        toast.error("UPI Transaction ID and UTR are required");
        return;
      }
      payload.upi_transaction_id = treatmentConfirmDraft.upi_transaction_id.trim();
      payload.upi_utr = treatmentConfirmDraft.upi_utr.trim();
    } else if (mode === "card") {
      if (!treatmentConfirmDraft.account_number.trim() || !treatmentConfirmDraft.account_holder_name.trim() || !treatmentConfirmDraft.bank_name.trim() || !treatmentConfirmDraft.ifsc_code.trim()) {
        toast.error("Account Number, Account Holder Name, Bank Name and IFSC Code are required");
        return;
      }
      payload.account_number = treatmentConfirmDraft.account_number.trim();
      payload.account_holder_name = treatmentConfirmDraft.account_holder_name.trim();
      payload.bank_name = treatmentConfirmDraft.bank_name.trim();
      payload.ifsc_code = treatmentConfirmDraft.ifsc_code.trim();
    }
    const splitPayload = attachSessionsSplit(payload);
    if (!splitPayload) return;
    submitTreatmentFee(splitPayload);
  };

  // Submits the Treatment Fee — used both from the combined popup (its own button,
  // Consultation Fee handled separately above) and from the Fee Collected panel's
  // standalone fallback (where collectFeeDraft is always null, so this always
  // closes the popup on success). Pass a payload directly for Cash/UPI/Card (built
  // above); omit it for Cheque/Partial Payment, which build their own from the
  // inline fields via buildTreatmentFeePayload.
  const submitTreatmentFee = async (directPayload) => {
    const payload = directPayload || buildTreatmentFeePayload();
    if (!payload) return;
    setCollectingTreatmentFee(true);
    try {
      const res = await collectTreatmentFee(selectedLead.id, payload);
      toast.success(selectedLead.treatment_fee_paid != null ? "Treatment Fee payment updated" : "Treatment Fee collected");
      setBoard((b) => ({ ...b, leads: (b.leads || []).map((l) => l.id === res.lead.id ? res.lead : l) }));
      setTreatmentConfirmDraft(null);
      if (consultationFeeDone(res.lead)) {
        setCollectFeeDraft(null);
        setTreatmentFeeDraft(null);
        setSelectedLead(null);
      } else {
        setSelectedLead(res.lead);
      }
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to collect Treatment Fee");
    }
    setCollectingTreatmentFee(false);
  };

  // Collects one specific Partial Payment installment right now: creates the whole
  // schedule (every row starts unpaid — see collect-treatment-fee) and immediately
  // marks just this one row paid, in the same action. Every other row stays pending
  // until its own due date — collectible later from Accountant Manage's Outstanding
  // Amount / Payment Schedules boards, which already read the same paid flags.
  const collectPartialInstallmentNow = async (idx) => {
    const payload = buildTreatmentFeePayload();
    if (!payload) return;
    setCollectingTreatmentFee(true);
    try {
      const res = await collectTreatmentFee(selectedLead.id, payload);
      await markInstallmentPaid(selectedLead.id, idx + 1);
      const installments = res.lead.treatment_fee_payment_details?.installments || [];
      const lead = {
        ...res.lead,
        treatment_fee_payment_details: {
          ...res.lead.treatment_fee_payment_details,
          installments: installments.map((inst, i) => (i === idx ? { ...inst, paid: true } : inst)),
        },
      };
      toast.success(`Payment #${idx + 1} collected`);
      setBoard((b) => ({ ...b, leads: (b.leads || []).map((l) => l.id === lead.id ? lead : l) }));
      if (consultationFeeDone(lead)) {
        setCollectFeeDraft(null);
        setTreatmentFeeDraft(null);
        setSelectedLead(null);
      } else {
        setSelectedLead(lead);
      }
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to collect this installment");
    }
    setCollectingTreatmentFee(false);
  };

  // ---- Physio Assign (Branch Admin) — after fees are collected ----
  const openPhysioModal = async () => {
    setShowPhysioModal(true);
    setPhysioPick(selectedLead.assigned_physio_id || "");
    setPhysioCalendarData(null);
    try {
      const rows = await getDoctors({ branch_id: branchId });
      setPhysioOptions((rows || []).filter((d) => d.profile_type === "physio"));
    } catch {
      setPhysioOptions([]);
    }
  };

  // Load the picked physio's own calendar (same one managed at Consultations > Physio
  // Calendar) so we can propose enough of their already-available, not-yet-booked slots
  // to cover every session in the patient's paid package.
  useEffect(() => {
    if (!showPhysioModal || !physioPick) { setPhysioCalendarData(null); return; }
    let cancelled = false;
    setLoadingPhysioCalendar(true);
    getDoctorCalendar(physioPick)
      .then((data) => { if (!cancelled) setPhysioCalendarData(data); })
      .catch(() => { if (!cancelled) setPhysioCalendarData(null); })
      .finally(() => { if (!cancelled) setLoadingPhysioCalendar(false); });
    return () => { cancelled = true; };
  }, [showPhysioModal, physioPick]);

  const totalSessionsNeeded = selectedLead?.session_package_sessions || 0;
  const availablePhysioSlots = physioCalendarData
    ? [...(physioCalendarData.slots || [])]
        // A slot already booked by this same lead (e.g. re-opening this modal for the
        // physio they're already assigned to) is fine to re-propose — it'll just be
        // replaced with itself. Only someone else's booking makes a slot unavailable.
        .filter((s) => !physioCalendarData.booked?.[s] || physioCalendarData.booked[s].lead_id === selectedLead?.id)
        .sort()
    : [];
  const proposedSessionSlots = availablePhysioSlots.slice(0, totalSessionsNeeded);
  const hasEnoughPhysioSlots = totalSessionsNeeded > 0 && proposedSessionSlots.length === totalSessionsNeeded;

  const submitPhysioAssign = async () => {
    if (!physioPick) { toast.error("Choose a physio"); return; }
    if (!hasEnoughPhysioSlots) {
      toast.error(`This physio only has ${proposedSessionSlots.length} of the ${totalSessionsNeeded} needed slots open — add more in Physio Calendar first`);
      return;
    }
    setAssigningPhysio(true);
    try {
      const res = await assignPhysioWithSessions(selectedLead.id, { physio_id: physioPick, slot_times: proposedSessionSlots });
      toast.success(`Physio assigned — ${res.sessions_booked} sessions booked`);
      setShowPhysioModal(false);
      // Close the lead card instantly, same as a plain stage move.
      setSelectedLead(null);
      setBoard((b) => ({ ...b, leads: (b.leads || []).map((l) => l.id === res.lead.id ? res.lead : l) }));
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to assign physio");
    }
    setAssigningPhysio(false);
  };

  return (
    <div className="space-y-3" data-testid="consultations-board">
      {/* Stage Head Bar — Pre-Sales / Branch Leads style sticky segmented tabs.
          Suppressed when embedded inside Branch Leads' own unified stage bar. */}
      {showOwnStageBar && (
        <StageTabBar
          stages={stages}
          stageFilter={stageFilter}
          setStageFilter={setStageFilter}
          counts={derivedStageCounts}
          totalCount={dateAndSearchFiltered.length}
          hideAllStages
          testid="cons-metric"
        />
      )}

      {/* Search */}
      <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
        <Search className="h-4 w-4 text-slate-400" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search patients in Consultations..."
          className="h-8 border-0 p-0 focus-visible:ring-0"
          data-testid="cons-search"
        />
        <DateFilterPopover value={dateFilter} onChange={setDateFilter} testid="cons-date-filter" />
        <Button
          onClick={load}
          disabled={loading}
          title="Refresh"
          aria-label="Refresh"
          className="h-8 w-8 shrink-0 border-emerald-600 bg-emerald-600 p-0 text-white hover:bg-emerald-700"
          data-testid="cons-refresh"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Table */}
      <Card className="overflow-hidden border-slate-200">
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] table-fixed text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="w-[18%] px-4 py-2 text-left">Patient</th>
                <th className="w-[11%] px-4 py-2 text-left">Patient No.</th>
                <th className="w-[13%] px-4 py-2 text-left">Phone</th>
                <th className="w-[20%] px-4 py-2 text-left">Email</th>
                <th className="w-[15%] px-4 py-2 text-left">{isConsultant ? "Head Consultation Stage" : "Consultation Stage"}</th>
                <th className="w-[15%] px-4 py-2 text-left">Assigned Expert</th>
                <th className="w-[11%] px-4 py-2 text-left">Appointment</th>
                <th className="w-[8%] px-4 py-2 text-left">Updated</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => {
                const hex = stageColor(l[stageField]);
                return (
                  <tr key={l.id} onClick={() => { setSelectedLead(l); setDetailTab("overview"); }} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" data-testid={`cons-row-${l.id}`}>
                    <td className="truncate px-4 py-3 font-medium text-slate-800" title={l.name}>{l.name || "—"}</td>
                    <td className="truncate px-4 py-3 font-mono text-xs text-slate-500" title={l.patient_number}>{l.patient_number || "—"}</td>
                    <td className="truncate px-4 py-3 text-slate-600" title={l.phone}>{l.phone || "—"}</td>
                    <td className="truncate px-4 py-3 text-slate-600" title={l.email}>{l.email || "—"}</td>
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex items-center gap-1 rounded-[5px] px-2 py-0.5 text-xs font-semibold"
                        style={{ background: `${hex}14`, color: hex, border: `1px solid ${hex}33` }}
                      >
                        {l[stageField] || "—"}
                      </span>
                    </td>
                    <td className="truncate px-4 py-3 text-slate-600" title={l.assigned_physio_name}>{l.assigned_physio_name || "—"}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{l.appointment_date ? `${l.appointment_date} ${l.appointment_time || ""}` : "—"}</td>
                    <td className="px-4 py-3 text-xs text-slate-400">{(l.updated_at || "").slice(0, 10)}</td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan="8" className="px-4 py-8 text-center text-sm text-slate-400">
                  {loading ? "Loading…" : "No leads in consultations yet. Book an appointment with a Head Physio to populate this list."}
                </td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Detail / move-stage dialog */}
      {selectedLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 sm:p-4" data-testid="cons-detail-dialog">
          <div className="w-full h-full sm:h-auto sm:w-[92vw] sm:max-w-3xl sm:max-h-[85vh] overflow-y-auto space-y-3 bg-white p-4 shadow-2xl sm:rounded-xl">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900" data-testid="cons-detail-title">
                  {selectedLead.name || "Lead"}
                  {selectedLead.patient_number && (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-500" data-testid="cons-detail-patient-number">{selectedLead.patient_number}</span>
                  )}
                </h3>
                <p className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                  <Phone className="h-3 w-3" /> {selectedLead.phone || "—"}
                  {selectedLead.appointment_date && (
                    <>· <Calendar className="ml-1 h-3 w-3" /> {selectedLead.appointment_date} {selectedLead.appointment_time}</>
                  )}
                </p>
                {selectedLead.assigned_physio_name && (
                  <p className="mt-0.5 text-xs text-emerald-600">Expert: {selectedLead.assigned_physio_name}</p>
                )}
                {isConsultant && (
                  <span
                    className={`mt-1.5 inline-flex items-center gap-1 rounded-[5px] px-2 py-0.5 text-[10px] font-semibold ${
                      selectedLead.consultation_fee ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                    }`}
                    data-testid="cons-consultation-paid-badge"
                  >
                    {selectedLead.consultation_fee ? "Consultation Paid" : "Consultation Pending"}
                  </span>
                )}
              </div>
              <button onClick={() => setSelectedLead(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100" data-testid="cons-detail-close"><XCircle className="h-4 w-4" /></button>
            </div>

            {/* Sub tabs */}
            <div className="flex flex-wrap gap-1.5 border-b border-slate-100 pb-3" data-testid="cons-detail-tabs">
              {[
                { key: "overview", label: "Overview" },
                { key: "followup", label: "Follow up" },
                { key: "timeline", label: "Timeline" },
                { key: "profile", label: "Profile" },
              ].map((t) => (
                <button
                  key={t.key}
                  onClick={() => setDetailTab(t.key)}
                  className={`rounded-[5px] px-3.5 py-1 text-xs font-semibold transition-all ${detailTab === t.key ? "bg-sky-600 text-white shadow-sm" : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200"}`}
                  data-testid={`cons-detail-tab-${t.key}`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {detailTab === "overview" && (
            <>
            {/* Pre-Sales Diagnosis — read-only reference, mini card */}
            {selectedLead.diagnosis && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3" data-testid="cons-presales-diagnosis">
                <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <Stethoscope className="h-3.5 w-3.5" /> Pre-Sales Diagnosis
                </p>
                <p className="text-xs text-slate-700">{selectedLead.diagnosis}</p>
              </div>
            )}

            {/* Diagnosis Report + Treatment Summary — side by side */}
            {((isConsultant || selectedLead.physio_diagnosis_report) || (isConsultant || selectedLead.treatment_summary)) && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {(isConsultant || selectedLead.physio_diagnosis_report) && (
                  <LockableTextBox
                    icon={Stethoscope}
                    label="Diagnosis Report"
                    accent="sky"
                    value={physioDiagDraft}
                    onChange={handlePhysioDiagChange}
                    editing={physioDiagEditing}
                    locked={!!selectedLead.physio_diagnosis_locked}
                    savedText={selectedLead.physio_diagnosis_report}
                    saving={savingPhysioDiag}
                    canEdit={isConsultant}
                    onDone={finishPhysioDiagEdit}
                    onEdit={() => setPhysioDiagEditing(true)}
                    onUnlock={unlockPhysioDiag}
                    rows={3}
                    placeholder="Write the full diagnosis report..."
                    testPrefix="cons-physio-diagnosis"
                  />
                )}

                {(isConsultant || selectedLead.treatment_summary) && (
                  <LockableTextBox
                    icon={ClipboardList}
                    label="Treatment Summary"
                    accent="indigo"
                    value={treatmentDraft}
                    onChange={handleTreatmentChange}
                    editing={treatmentEditing}
                    locked={!!selectedLead.treatment_summary_locked}
                    savedText={selectedLead.treatment_summary}
                    saving={savingTreatment}
                    canEdit={isConsultant}
                    onDone={finishTreatmentEdit}
                    onEdit={() => setTreatmentEditing(true)}
                    onUnlock={unlockTreatment}
                    rows={3}
                    placeholder="What treatment should be given to the patient..."
                    testPrefix="cons-treatment-summary"
                  />
                )}
              </div>
            )}

            {/* Treatment — Head Physio's own "Save & Move". Requires Diagnosis Report +
                Treatment Summary to already be written (that's what marks the consultation
                itself done and ready for Branch Admin to collect the Consultation Fee).
                Every patient goes on to a Treatment Package here — "Consultation Only" is a
                legacy decision value some already-existing leads still carry, no longer
                offered as a choice. Physio assignment lives entirely on Branch Admin's own
                board, after both fees are collected. */}
            {isConsultant && (() => {
              const alreadyMoved = selectedLead.head_consultation_stage === "Consultation Visit";
              const diagnosisReady = !!(selectedLead.physio_diagnosis_report || "").trim();
              const summaryReady = !!(selectedLead.treatment_summary || "").trim();
              const selectedPackage = treatmentPackageItems.find((i) => i.id === decisionDraft.item_id);
              const selectedPackageWeeks = selectedPackage ? weeksFromPackageName(selectedPackage.name) : null;
              const canSave = diagnosisReady && summaryReady && !!decisionDraft.item_id && !!selectedPackageWeeks && !!parseInt(decisionDraft.sessionsPerWeek, 10);

              if (alreadyMoved) {
                return (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3" data-testid="cons-decision-summary">
                    <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-700">
                      <ClipboardCheck className="h-3.5 w-3.5" /> Treatment
                    </p>
                    <p className="text-sm font-semibold text-slate-800">
                      {selectedLead.consultation_decision === "consultation_treatment" ? "Treatment" : "Consultation Only"}
                    </p>
                    {selectedLead.consultation_decision === "consultation_treatment" && selectedLead.session_package_name && (
                      <p className="mt-0.5 text-xs text-slate-600">
                        Treatment Package: <span className="font-semibold">{selectedLead.session_package_name}</span>
                      </p>
                    )}
                    <p className="mt-1.5 text-[11px] text-slate-500">Sent to Branch Admin — Consultation Visit.</p>
                  </div>
                );
              }

              return (
                <div className="rounded-lg border border-sky-200 bg-sky-50 p-3" data-testid="cons-decision-form">
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-sky-700">
                    <ClipboardCheck className="h-3.5 w-3.5" /> Treatment
                  </p>
                  {(!diagnosisReady || !summaryReady) && (
                    <p className="mb-2 text-[11px] font-medium text-amber-600" data-testid="cons-decision-required-hint">
                      Write the Diagnosis Report and Treatment Summary above before Save & Move.
                    </p>
                  )}
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-slate-500">Treatment Package</label>
                    <div className="flex flex-wrap gap-2" data-testid="cons-decision-package-options">
                      {treatmentPackageItems.map((i, idx) => {
                        const color = TREATMENT_PACKAGE_COLORS[idx % TREATMENT_PACKAGE_COLORS.length];
                        const selected = decisionDraft.item_id === i.id;
                        return (
                          <button
                            key={i.id}
                            type="button"
                            onClick={() => setDecisionDraft((p) => ({ ...p, item_id: i.id, sessionsPerWeek: "" }))}
                            className="rounded-md border px-3 py-1.5 text-xs font-semibold transition hover:brightness-95"
                            style={selected
                              ? { background: `${color}22`, color, borderColor: color, boxShadow: `inset 0 0 0 1px ${color}` }
                              : { background: `${color}14`, color, borderColor: `${color}33` }}
                            data-testid={`cons-decision-package-option-${i.id}`}
                          >
                            {i.name}
                          </button>
                        );
                      })}
                    </div>

                    {decisionDraft.item_id && (() => {
                      const item = treatmentPackageItems.find((i) => i.id === decisionDraft.item_id);
                      if (!item) return null;
                      // Head Physio sees the session count only — never the price.
                      // The Treatment Fee amount is derived server-side from
                      // sessions_override and shown to Branch Admin at fee collection.
                      const weeks = weeksFromPackageName(item.name);
                      const perWeek = parseInt(decisionDraft.sessionsPerWeek, 10) || 0;
                      const totalSessions = weeks && perWeek ? weeks * perWeek : 0;
                      return (
                        <div className="mt-2 rounded-md border border-slate-200 bg-white p-3" data-testid="cons-decision-package-summary">
                          <p className="text-sm font-semibold text-slate-800">{item.name}{weeks ? ` · ${weeks} week${weeks > 1 ? "s" : ""}` : ""}</p>
                          <div className="mt-2">
                            <label className="mb-1 block text-[11px] font-medium text-slate-500">Sessions / week</label>
                            <div className="flex flex-wrap gap-1.5" data-testid="cons-decision-sessions-per-week">
                              {[1, 2, 3, 4, 5, 6, 7].map((n) => {
                                const selected = perWeek === n;
                                return (
                                  <button
                                    key={n}
                                    type="button"
                                    onClick={() => setDecisionDraft((p) => ({ ...p, sessionsPerWeek: String(n) }))}
                                    className={`h-8 w-8 rounded-md border text-xs font-semibold transition ${
                                      selected ? "border-sky-500 bg-sky-500 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                                    }`}
                                    data-testid={`cons-decision-sessions-per-week-${n}`}
                                  >
                                    {n}
                                  </button>
                                );
                              })}
                            </div>
                            <p className="mt-2 text-xs text-slate-500" data-testid="cons-decision-total-sessions">
                              {!weeks
                                ? <span className="text-amber-600">Couldn't read a week count from this package's name.</span>
                                : !perWeek
                                ? "Choose sessions per week"
                                : (
                                  <>
                                    {perWeek} session{perWeek > 1 ? "s" : ""} Weekly × {weeks} Week{weeks > 1 ? "s" : ""} = <span className="text-sm font-semibold text-slate-800">{totalSessions} Total Sessions</span>
                                  </>
                                )}
                            </p>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                  <Button
                    size="sm"
                    className="mt-3 bg-sky-600 hover:bg-sky-700 text-xs"
                    onClick={submitConsultationDecision}
                    disabled={savingDecision || !canSave}
                    data-testid="cons-decision-save"
                  >
                    {savingDecision ? "Saving..." : "Choose and Confirm & Select the Package"}
                  </Button>
                </div>
              );
            })()}

            {!isConsultant && (() => {
              const stage = selectedLead.consultation_stage;
              const decision = selectedLead.consultation_decision;
              const cancellable = ["New Appointment", "Follow Up", "Consultation Visit", "Fee Collected", "Physio Assign"].includes(stage);
              // Once a lead has moved forward past a stage, it can never come back —
              // there's no manual "move backward" control anymore (see the backend's
              // matching rejection in move-consultation-stage).
              const activeFollowUp = (selectedLead.consultation_follow_ups || []).slice().reverse().find((f) => f.status !== "rescheduled");

              const CancelButton = cancellable ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="border-rose-200 text-xs text-rose-600 hover:bg-rose-50"
                  onClick={() => { if (window.confirm("Cancel this consultation?")) moveStage(selectedLead, "Cancel"); }}
                  data-testid="cons-cancel-btn"
                >
                  <Ban className="mr-1 h-3.5 w-3.5" /> Cancel
                </Button>
              ) : null;

              const panel = (() => {
                if (stage === "New Appointment") {
                  return (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3" data-testid="cons-stage-panel-early">
                      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-blue-700">
                        <Calendar className="h-3.5 w-3.5" /> Move to Stage
                      </p>
                      <p className="mb-2 text-xs text-slate-600">Schedule the Consultation Date & Time to send this patient to the Head Physio.</p>
                      <div className="flex flex-wrap gap-1.5">
                        <Button
                          size="sm"
                          className="bg-amber-500 text-xs text-white hover:bg-amber-600"
                          onClick={() => setFollowUpDraft({ date: new Date(Date.now() + 86400000).toISOString().slice(0, 10), time: "10:00", remarks: "" })}
                          data-testid="cons-move-followup"
                        >
                          Schedule Consultation & Move
                        </Button>
                        {CancelButton}
                      </div>
                    </div>
                  );
                }

                if (stage === "Follow Up") {
                  return (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3" data-testid="cons-stage-panel-followup">
                      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-700">
                        <Bell className="h-3.5 w-3.5" /> Consultation Scheduled
                      </p>
                      <p className="mb-2 text-xs text-slate-600">
                        {activeFollowUp ? `Scheduled for ${activeFollowUp.date} at ${activeFollowUp.time} — waiting on the Head Physio.` : "Waiting on the Head Physio."}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        <Button
                          size="sm"
                          className="bg-amber-500 text-xs text-white hover:bg-amber-600"
                          onClick={() => (activeFollowUp
                            ? setRescheduleDraft({ followupId: activeFollowUp.id, date: activeFollowUp.date, time: activeFollowUp.time, reason: "" })
                            : setFollowUpDraft({ date: new Date(Date.now() + 86400000).toISOString().slice(0, 10), time: "10:00", remarks: "" }))}
                          data-testid="cons-reschedule-btn"
                        >
                          Reschedule
                        </Button>
                        {CancelButton}
                      </div>
                    </div>
                  );
                }

                if (stage === "Consultation Visit") {
                  const alreadyPaid = selectedLead.package_paid != null;
                  const hasTreatment = decision === "consultation_treatment";
                  return (
                    <div className="rounded-lg border border-sky-200 bg-sky-50 p-3" data-testid="cons-stage-panel-consultation-visit">
                      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-sky-700">
                        <IndianRupee className="h-3.5 w-3.5" /> Collect a Payment
                      </p>
                      <div className="space-y-1.5 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-slate-500">Consultation Fee</span>
                          <span className="font-semibold text-slate-800">{selectedLead.package_price != null ? `Rs.${selectedLead.package_price}` : "—"}</span>
                        </div>
                        {hasTreatment && (
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-slate-500">Treatment Fee</span>
                            <span className="font-semibold text-slate-800">{selectedLead.session_package_price != null ? `Rs.${selectedLead.session_package_price}` : "—"}</span>
                          </div>
                        )}
                        {alreadyPaid && (
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-slate-500">Already Paid Via</span>
                            <span className="font-medium capitalize text-emerald-700">{selectedLead.package_payment_mode}</span>
                          </div>
                        )}
                      </div>
                      <Button size="sm" className="mt-3 bg-sky-600 text-xs hover:bg-sky-700" onClick={openCollectFeeDraft} data-testid="cons-open-collect-fee">
                        {alreadyPaid ? "Update Payment" : "Collect Payment"}
                      </Button>
                      <div className="mt-2 flex flex-wrap gap-1.5">{CancelButton}</div>
                    </div>
                  );
                }

                if (stage === "Fee Collected") {
                  const ConsultationFeeSummary = (
                    <div className="rounded-md border border-slate-200 bg-white p-2.5" data-testid="cons-fee-collected-consultation-summary">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-xs text-slate-500">Consultation Fee</span>
                        <span className="font-semibold text-slate-800">
                          {selectedLead.package_price != null ? `Rs.${selectedLead.package_price}` : "—"}
                          <span className="ml-1 capitalize text-emerald-600">({selectedLead.package_payment_mode})</span>
                        </span>
                      </div>
                      <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                        <CheckCircle2 className="h-3 w-3" /> Already Collected
                      </p>
                    </div>
                  );

                  if (decision === "consultation_only") {
                    return (
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3" data-testid="cons-stage-panel-fee-collected">
                        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-700">
                          <ClipboardCheck className="h-3.5 w-3.5" /> Fee Collected
                        </p>
                        {ConsultationFeeSummary}
                        <p className="mb-2 mt-3 text-xs text-slate-600">Consultation Only — no treatment sessions. Mark this consultation as completed to close it out.</p>
                        <Button size="sm" className="bg-emerald-600 text-xs hover:bg-emerald-700" onClick={submitMarkCompleted} disabled={completingConsultation} data-testid="cons-mark-completed">
                          {completingConsultation ? "Saving..." : "Mark Consultation Completed"}
                        </Button>
                        <div className="mt-2 flex flex-wrap gap-1.5">{CancelButton}</div>
                      </div>
                    );
                  }
                  const treatmentPaid = selectedLead.treatment_fee_paid != null;
                  return (
                    <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3" data-testid="cons-stage-panel-fee-collected">
                      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-indigo-700">
                        <ClipboardCheck className="h-3.5 w-3.5" /> Fee Collected
                      </p>
                      {ConsultationFeeSummary}
                      <div className="mt-3 border-t border-indigo-100 pt-3">
                        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-indigo-700">
                          <Dumbbell className="h-3.5 w-3.5" /> Treatment Fee
                        </p>
                        <div className="space-y-1.5 text-sm">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-slate-500">Treatment Package</span>
                            <span className="font-semibold text-slate-800">
                              {selectedLead.session_package_name || "—"}{selectedLead.session_package_sessions ? ` · ${selectedLead.session_package_sessions} sessions` : ""}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-slate-500">Treatment Fee</span>
                            <span className="font-semibold text-slate-800">
                              {selectedLead.session_package_price != null ? `Rs.${selectedLead.session_package_price}` : "—"}
                              {treatmentPaid && <span className="ml-1 capitalize text-emerald-600">({selectedLead.treatment_fee_payment_mode})</span>}
                            </span>
                          </div>
                        </div>
                        {treatmentPaid ? (
                          <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-emerald-600" data-testid="cons-treatment-fee-already-collected">
                            <CheckCircle2 className="h-3 w-3" /> Already Collected
                          </p>
                        ) : (
                          <Button size="sm" className="mt-3 bg-indigo-600 text-xs hover:bg-indigo-700" onClick={openTreatmentFeeDraft} data-testid="cons-open-treatment-fee">
                            Collect Payment
                          </Button>
                        )}
                      </div>
                      {treatmentPaid && (
                        <div className="mt-3 border-t border-indigo-100 pt-3">
                          <p className="mb-2 text-xs text-slate-600">Both fees collected. Choose the physiotherapist who will deliver the sessions.</p>
                          <Button size="sm" className="bg-violet-600 text-xs hover:bg-violet-700" onClick={openPhysioModal} data-testid="cons-open-physio-assign-from-fee-collected">
                            Assign Physio
                          </Button>
                        </div>
                      )}
                      <div className="mt-3 flex flex-wrap gap-1.5">{CancelButton}</div>
                    </div>
                  );
                }

                if (stage === "Physio Assign") {
                  if (!selectedLead.assigned_physio_name) {
                    return (
                      <div className="rounded-lg border border-violet-200 bg-violet-50 p-3" data-testid="cons-stage-panel-physio-assign">
                        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-violet-700">
                          <Users className="h-3.5 w-3.5" /> Physio Assign
                        </p>
                        <p className="text-xs text-slate-600">Treatment Fee collected. Choose the physiotherapist who will deliver the sessions.</p>
                        <Button size="sm" className="mt-3 bg-violet-600 text-xs hover:bg-violet-700" onClick={openPhysioModal} data-testid="cons-open-physio-assign">
                          Assign Physio
                        </Button>
                        <div className="mt-2 flex flex-wrap gap-1.5">{CancelButton}</div>
                      </div>
                    );
                  }
                  return (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3" data-testid="cons-stage-panel-assigned">
                      <p className="text-sm font-semibold text-emerald-800">Treatment sessions in progress</p>
                      <p className="mt-1 text-xs text-slate-600">Assigned Physio: <span className="font-semibold text-slate-800">{selectedLead.assigned_physio_name}</span></p>
                      <Button size="sm" variant="outline" className="mt-3 text-xs" onClick={openPhysioModal} data-testid="cons-reassign-physio">
                        Reassign Physio
                      </Button>
                    </div>
                  );
                }

                if (stage === "Consultation Completed") {
                  return (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3" data-testid="cons-stage-panel-completed">
                      <p className="text-sm font-semibold text-slate-700">Consultation completed</p>
                      <p className="mt-1 text-xs text-slate-500">Consultation Only — no treatment sessions were required.</p>
                    </div>
                  );
                }

                if (stage === "Cancel") {
                  return (
                    <div className="rounded-lg border border-rose-200 bg-rose-50 p-3" data-testid="cons-stage-panel-cancelled">
                      <p className="text-sm font-semibold text-rose-700">This consultation was cancelled.</p>
                    </div>
                  );
                }

                return null;
              })();

              return (
                <div className="space-y-3">
                  <AllStagesStepper stages={stages} currentStage={stage} />
                  {panel}
                </div>
              );
            })()}
            </>
            )}

            {detailTab === "followup" && (
              <div className="space-y-1.5" data-testid="cons-followups-list">
                {(selectedLead.consultation_follow_ups || []).length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-400">No follow-ups scheduled yet.</p>
                ) : (
                  selectedLead.consultation_follow_ups.slice().reverse().map((f) => {
                    const isActive = f.status !== "rescheduled";
                    return (
                      <div
                        key={f.id}
                        className={`flex items-start justify-between gap-3 rounded-lg border p-2.5 text-xs ${isActive ? "border-orange-200 bg-orange-50/60" : "border-slate-200 bg-slate-50 text-slate-400"}`}
                        data-testid={`cons-followup-row-${f.id}`}
                      >
                        <div>
                          <p className={`font-semibold ${isActive ? "text-orange-700" : "text-slate-400 line-through"}`}>{f.date} at {f.time}</p>
                          {f.remarks && <p className="mt-0.5 text-slate-600">{f.remarks}</p>}
                          {f.status === "rescheduled" && f.reschedule_reason && (
                            <p className="mt-0.5 italic text-slate-400">Rescheduled: {f.reschedule_reason}</p>
                          )}
                        </div>
                        {isActive && !isConsultant && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 shrink-0 text-[11px]"
                            onClick={() => setRescheduleDraft({ followupId: f.id, date: f.date, time: f.time, reason: "" })}
                            data-testid={`cons-followup-reschedule-${f.id}`}
                          >
                            Reschedule
                          </Button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {detailTab === "timeline" && (
              <div className="space-y-3" data-testid="cons-lead-timeline">
                {(() => {
                  const events = [
                    ...timelineRemarks.map((r) => ({ ...r, _kind: "remark" })),
                    ...timelineActivity.map((a) => ({ ...a, _kind: "activity" })),
                  ].sort((x, y) => new Date(x.created_at) - new Date(y.created_at));
                  if (events.length === 0) return <p className="py-8 text-center text-sm text-slate-400">No timeline events yet</p>;
                  return (
                    <ol className="ml-3 space-y-4 border-l-2 border-slate-200 py-1 pl-6">
                      {events.map((h) => (
                        <li key={`${h._kind}-${h.id}`} className="relative" data-testid={`cons-timeline-${h._kind}-${h.id}`}>
                          <span className={`absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-white ${h._kind === "remark" ? "bg-amber-400" : "bg-sky-500"}`} />
                          <div className={`rounded-lg border p-3 ${h._kind === "remark" ? "border-amber-100 bg-amber-50/50" : "border-slate-100 bg-slate-50"}`}>
                            <p className="text-sm text-slate-700">{h._kind === "remark" ? h.text : h.details}</p>
                            <p className="mt-1 text-[10px] text-slate-400">{h.created_by} · {h.created_at?.slice(0, 16).replace("T", " ")}</p>
                          </div>
                        </li>
                      ))}
                    </ol>
                  );
                })()}
              </div>
            )}

            {detailTab === "profile" && (
              <div className="space-y-3" data-testid="cons-lead-profile">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-600">Contact</p>
                  <div className="space-y-1.5 text-xs text-slate-700">
                    <div className="flex items-center justify-between"><span className="text-slate-500">Phone</span><span className="font-medium">{selectedLead.phone || "—"}</span></div>
                    <div className="flex items-center justify-between"><span className="text-slate-500">Alternative Phone</span><span className="font-medium">{selectedLead.alternative_phone || "—"}</span></div>
                    <div className="flex items-center justify-between"><span className="text-slate-500">Email</span><span className="font-medium">{selectedLead.email || "—"}</span></div>
                    <div className="flex items-center justify-between"><span className="text-slate-500">Address</span><span className="font-medium">{selectedLead.address || "—"}</span></div>
                    <div className="flex items-center justify-between"><span className="text-slate-500">City / State</span><span className="font-medium">{[selectedLead.city, selectedLead.state].filter(Boolean).join(", ") || "—"}</span></div>
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-600">Profile</p>
                  <div className="space-y-1.5 text-xs text-slate-700">
                    <div className="flex items-center justify-between"><span className="text-slate-500">Age</span><span className="font-medium">{selectedLead.age ?? "—"}</span></div>
                    <div className="flex items-center justify-between"><span className="text-slate-500">Gender</span><span className="font-medium">{selectedLead.gender || "—"}</span></div>
                    <div className="flex items-center justify-between"><span className="text-slate-500">Occupation</span><span className="font-medium">{selectedLead.occupation || "—"}</span></div>
                    <div className="flex items-center justify-between"><span className="text-slate-500">Department</span><span className="font-medium">{selectedLead.department || "—"}</span></div>
                    <div className="flex items-center justify-between"><span className="text-slate-500">Condition</span><span className="font-medium">{selectedLead.condition || "—"}</span></div>
                    <div className="flex items-center justify-between"><span className="text-slate-500">Months of Pain</span><span className="font-medium">{selectedLead.months_of_pain ?? "—"}</span></div>
                  </div>
                </div>
              </div>
            )}

            {/* Collect Fee popup (Branch Admin) — Consultation Visit stage. When the
                Head Physio's decision is "Consultation + Treatment" and the Treatment
                Fee isn't paid yet, its section renders in this same popup so both
                fees are collected together in one action. */}
            {collectFeeDraft && (
              <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" data-testid="cons-collect-fee-modal">
                <div className="max-h-[85vh] w-full max-w-2xl space-y-3 overflow-y-auto rounded-xl bg-white p-4 shadow-2xl">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-slate-800">
                      {treatmentFeeDraft ? "Collect Fees" : selectedLead.package_paid != null ? "Update Consultation Fee Payment" : "Collect Consultation Fee"}
                    </p>
                    <button onClick={() => { setCollectFeeDraft(null); setTreatmentFeeDraft(null); }} className="rounded p-1 text-slate-400 hover:bg-slate-100" data-testid="cons-collect-fee-close"><X className="h-4 w-4" /></button>
                  </div>

                  <div className="space-y-3">
                  <div className={`space-y-3 rounded-lg border p-3 ${selectedLead.package_paid != null ? "border-emerald-200 bg-emerald-50" : "border-slate-200"}`}>
                    <p className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider ${selectedLead.package_paid != null ? "text-emerald-700" : "text-sky-700"}`}>
                      <Stethoscope className="h-3.5 w-3.5" /> Consultation Fee
                    </p>
                    {selectedLead.package_name && (
                      <p className="text-[11px] text-slate-500">
                        Package: <span className="font-semibold text-slate-700">{selectedLead.package_name}</span>
                      </p>
                    )}
                    {selectedLead.package_paid != null ? (
                      <div data-testid="cons-collect-fee-locked">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-xs text-slate-500">Consultation Fee</span>
                          <span className="font-semibold text-slate-800">
                            Rs.{selectedLead.package_price}
                            <span className="ml-1 capitalize text-emerald-600">({selectedLead.package_payment_mode})</span>
                          </span>
                        </div>
                        <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                          <CheckCircle2 className="h-3 w-3" /> Already Collected
                        </p>
                      </div>
                    ) : (
                      <>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">Consultation Fee (₹)</label>
                          <Input
                            type="number"
                            min="0"
                            value={collectFeeDraft.amount}
                            readOnly
                            disabled
                            className="h-9 bg-slate-50 text-slate-600"
                            data-testid="cons-collect-fee-amount"
                          />
                          {selectedLead.package_price != null && (
                            <p className="mt-1 text-[11px] text-slate-400">Assigned package price: Rs.{selectedLead.package_price} — editable in the next step if a different amount was actually collected.</p>
                          )}
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">Payment Mode</label>
                          <PaymentModeSelect
                            value={collectFeeDraft.payment_mode}
                            options={CONSULTATION_FEE_PAYMENT_MODES}
                            onChange={(v) => setCollectFeeDraft({ ...collectFeeDraft, payment_mode: v })}
                            testId="cons-collect-fee-mode"
                          />
                        </div>
                        <Button
                          className="w-full bg-sky-600 text-xs hover:bg-sky-700"
                          onClick={startCollectConsultationFee}
                          disabled={collectingFee || !(parseFloat(collectFeeDraft.amount) > 0)}
                          data-testid="cons-collect-fee-submit"
                        >
                          {collectingFee ? "Saving..." : "Collect Consultation Fee"}
                        </Button>
                      </>
                    )}
                  </div>

                  {treatmentFeeDraft && (
                    <div className={`space-y-3 rounded-lg border p-3 ${
                      selectedLead.treatment_fee_paid != null ? "border-emerald-200 bg-emerald-50"
                      : selectedLead.package_paid == null ? "border-slate-200 bg-slate-50"
                      : "border-indigo-200 bg-indigo-50/40"
                    }`}>
                      <p className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider ${
                        selectedLead.treatment_fee_paid != null ? "text-emerald-700"
                        : selectedLead.package_paid == null ? "text-slate-400"
                        : "text-indigo-700"
                      }`}>
                        <Dumbbell className="h-3.5 w-3.5" /> Treatment Fee
                      </p>
                      {selectedLead.package_paid == null ? (
                        <p className="text-xs text-slate-500" data-testid="cons-treatment-fee-gated">
                          Collect the Consultation Fee above first — Treatment Fee unlocks once it's paid.
                        </p>
                      ) : selectedLead.treatment_fee_paid != null ? (
                        <div data-testid="cons-treatment-fee-locked">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-xs text-slate-500">Treatment Fee</span>
                            <span className="font-semibold text-slate-800">
                              Rs.{selectedLead.session_package_price}
                              <span className="ml-1 capitalize text-emerald-600">({selectedLead.treatment_fee_payment_mode})</span>
                            </span>
                          </div>
                          <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                            <CheckCircle2 className="h-3 w-3" /> Already Collected
                          </p>
                        </div>
                      ) : (
                        <>
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-slate-500">Treatment Package (chosen by Head Physio)</label>
                        <div className="flex h-9 items-center rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700" data-testid="cons-treatment-fee-item-readonly">
                          {selectedLead.session_package_name || "—"}{selectedLead.session_package_sessions ? ` · ${selectedLead.session_package_sessions} sessions` : ""}
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-slate-500">Payment Mode</label>
                        <PaymentModeSelect
                          value={treatmentFeeDraft.payment_mode}
                          options={TREATMENT_FEE_PAYMENT_MODES}
                          onChange={chooseTreatmentPaymentMode}
                          testId="cons-treatment-fee-mode"
                        />
                        <p className="mt-1 text-[11px] text-slate-400">Pick a payment method to open its own Collect popup.</p>
                      </div>
                        </>
                      )}
                    </div>
                  )}
                  </div>
                </div>
              </div>
            )}

            {/* Confirm Consultation Fee Payment — second-step popup, only shown when the
                entered amount doesn't match the assigned package price and/or the mode
                (UPI/Card) needs its own fields. Layered above the main popup. */}
            {packageConfirmDraft && collectFeeDraft && (() => {
              const amount = parseFloat(collectFeeDraft.amount);
              const expected = selectedLead.package_price;
              const mismatch = expected != null && Math.round(amount * 100) !== Math.round(expected * 100);
              const mode = collectFeeDraft.payment_mode;
              return (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" data-testid="cons-collect-fee-confirm-modal">
                  <div className="w-full max-w-sm space-y-3 rounded-xl bg-white p-4 shadow-2xl">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-slate-800">Confirm Consultation Fee Payment</p>
                      <button onClick={() => setPackageConfirmDraft(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100" data-testid="cons-collect-fee-confirm-close"><X className="h-4 w-4" /></button>
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-slate-500">Consultation Fee (₹)</label>
                      <Input
                        type="number"
                        min="0"
                        value={collectFeeDraft.amount}
                        onChange={(e) => setCollectFeeDraft({ ...collectFeeDraft, amount: e.target.value })}
                        className="h-9"
                        data-testid="cons-collect-fee-confirm-amount"
                      />
                    </div>

                    {mismatch && (
                      <div className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-800" data-testid="cons-collect-fee-mismatch-warning">
                        Entered amount <span className="font-semibold">Rs.{amount}</span> differs from the assigned Consultation Fee <span className="font-semibold">Rs.{expected}</span>. Please confirm this is correct.
                      </div>
                    )}

                    {mode === "upi" && (
                      <>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">UPI Transaction ID</label>
                          <Input
                            value={packageConfirmDraft.upi_transaction_id}
                            onChange={(e) => setPackageConfirmDraft({ ...packageConfirmDraft, upi_transaction_id: e.target.value })}
                            className="h-9"
                            data-testid="cons-collect-fee-upi-txn"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">UTR</label>
                          <Input
                            value={packageConfirmDraft.upi_utr}
                            onChange={(e) => setPackageConfirmDraft({ ...packageConfirmDraft, upi_utr: e.target.value })}
                            className="h-9"
                            data-testid="cons-collect-fee-upi-utr"
                          />
                        </div>
                      </>
                    )}

                    {mode === "card" && (
                      <>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">Account Number</label>
                          <Input
                            value={packageConfirmDraft.account_number}
                            onChange={(e) => setPackageConfirmDraft({ ...packageConfirmDraft, account_number: e.target.value })}
                            className="h-9"
                            data-testid="cons-collect-fee-account-number"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">Account Holder Name</label>
                          <Input
                            value={packageConfirmDraft.account_holder_name}
                            onChange={(e) => setPackageConfirmDraft({ ...packageConfirmDraft, account_holder_name: e.target.value })}
                            className="h-9"
                            data-testid="cons-collect-fee-account-holder"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">Bank Name</label>
                          <Input
                            value={packageConfirmDraft.bank_name}
                            onChange={(e) => setPackageConfirmDraft({ ...packageConfirmDraft, bank_name: e.target.value })}
                            className="h-9"
                            data-testid="cons-collect-fee-bank-name"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">IFSC Code</label>
                          <Input
                            value={packageConfirmDraft.ifsc_code}
                            onChange={(e) => setPackageConfirmDraft({ ...packageConfirmDraft, ifsc_code: e.target.value.toUpperCase() })}
                            className="h-9"
                            data-testid="cons-collect-fee-ifsc"
                          />
                        </div>
                      </>
                    )}

                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        className="flex-1 text-xs"
                        onClick={() => setPackageConfirmDraft(null)}
                        disabled={collectingFee}
                        data-testid="cons-collect-fee-confirm-cancel"
                      >
                        Cancel
                      </Button>
                      <Button
                        className="flex-1 bg-sky-600 text-xs hover:bg-sky-700"
                        onClick={confirmCollectConsultationFee}
                        disabled={
                          collectingFee ||
                          !(parseFloat(collectFeeDraft.amount) > 0) ||
                          (mode === "upi" && (!packageConfirmDraft.upi_transaction_id.trim() || !packageConfirmDraft.upi_utr.trim())) ||
                          (mode === "card" && (!packageConfirmDraft.account_number.trim() || !packageConfirmDraft.account_holder_name.trim() || !packageConfirmDraft.bank_name.trim() || !packageConfirmDraft.ifsc_code.trim()))
                        }
                        data-testid="cons-collect-fee-confirm-submit"
                      >
                        {collectingFee ? "Saving..." : "Confirm & Collect"}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Collect Treatment Fee popup (Branch Admin) — fallback: only reachable on
                its own from the Fee Collected panel if it wasn't collected together
                with the Consultation Fee the first time. */}
            {treatmentFeeDraft && !collectFeeDraft && (
              <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" data-testid="cons-treatment-fee-modal">
                <div className="max-h-[85vh] w-full max-w-2xl space-y-3 overflow-y-auto rounded-xl bg-white p-4 shadow-2xl">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-slate-800">{selectedLead.treatment_fee_paid != null ? "Update Treatment Fee Payment" : "Collect Treatment Fee"}</p>
                    <button onClick={() => setTreatmentFeeDraft(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100" data-testid="cons-treatment-fee-close"><X className="h-4 w-4" /></button>
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-slate-500">Treatment Package (chosen by Head Physio)</label>
                    <div className="flex h-9 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700" data-testid="cons-treatment-fee-item-readonly">
                      {selectedLead.session_package_name || "—"}{selectedLead.session_package_sessions ? ` · ${selectedLead.session_package_sessions} sessions` : ""}
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-slate-500">Payment Mode</label>
                    <PaymentModeSelect
                      value={treatmentFeeDraft.payment_mode}
                      options={TREATMENT_FEE_PAYMENT_MODES}
                      onChange={chooseTreatmentPaymentMode}
                      testId="cons-treatment-fee-mode"
                    />
                    <p className="mt-1 text-[11px] text-slate-400">Pick a payment method to open its own Collect popup.</p>
                  </div>
                </div>
              </div>
            )}

            {/* Collect {Mode} Payment — each of the 5 Treatment Fee payment modes gets
                its own dedicated popup here (opened by chooseTreatmentPaymentMode),
                rather than sharing one form with a mode selector. Layered above
                whichever of the two Treatment Fee popups (combined or standalone) is
                currently open. */}
            {treatmentConfirmDraft && treatmentFeeDraft && (() => {
              const amount = parseFloat(treatmentFeeDraft.amount);
              const expected = selectedLead.session_package_price;
              // When this collection only covers some sessions, "expected" is what
              // those sessions should cost, not the whole package's price — so
              // collecting a fair partial amount is never flagged as a discount.
              const expectedForSessionsNow = treatmentIsPartialSessions ? treatmentComputedAmount : expected;
              const mismatch = expectedForSessionsNow != null && Math.round(amount * 100) !== Math.round(expectedForSessionsNow * 100);
              const mode = treatmentFeeDraft.payment_mode;
              const modeLabel = TREATMENT_FEE_PAYMENT_MODES.find((m) => m.value === mode)?.label || "";
              return (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" data-testid="cons-treatment-fee-confirm-modal">
                  <div className="max-h-[110vh] w-full max-w-xl space-y-3 overflow-y-auto rounded-xl bg-white p-4 shadow-2xl">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-slate-800">{mode === "partial" ? "Partial Payment Schedule" : `Collect ${modeLabel} Payment`}</p>
                      <button onClick={() => setTreatmentConfirmDraft(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100" data-testid="cons-treatment-fee-confirm-close"><X className="h-4 w-4" /></button>
                    </div>

                    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600" data-testid="cons-treatment-fee-confirm-package">
                      {selectedLead.session_package_name || "—"}{selectedLead.session_package_sessions ? ` · ${selectedLead.session_package_sessions} sessions` : ""}
                    </div>

                    {mode !== "partial" && (
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-slate-500">{modeLabel} Amount (₹)</label>
                        {["cash", "upi", "card"].includes(mode) ? (
                          <Input
                            type="number"
                            min="0"
                            value={treatmentFeeDraft.amount}
                            onChange={(e) => setTreatmentFeeDraft({ ...treatmentFeeDraft, amount: e.target.value })}
                            className="h-9"
                            data-testid="cons-treatment-fee-amount"
                          />
                        ) : (
                          <div className="flex h-9 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700" data-testid="cons-treatment-fee-amount">
                            {treatmentFeeTotalSessions ? `Rs.${treatmentComputedAmount}` : (selectedLead.session_package_price != null ? `Rs.${selectedLead.session_package_price}` : "—")}
                          </div>
                        )}
                        {selectedLead.session_package_sessions && selectedLead.session_package_price != null && (
                          <p className="mt-1 text-[11px] text-slate-500" data-testid="cons-treatment-fee-breakdown">
                            {treatmentIsPartialSessions
                              ? `Collect Now = ${treatmentSessionsNow} of ${treatmentFeeTotalSessions} sessions × Rs.${Math.round(perSessionRate * 100) / 100}/session = Rs.${treatmentComputedAmount}`
                              : `Collect Total Session Fee = ${selectedLead.session_package_sessions} sessions × Rs.${Math.round((selectedLead.session_package_price / selectedLead.session_package_sessions) * 100) / 100}/session = Rs.${selectedLead.session_package_price}`}
                          </p>
                        )}
                      </div>
                    )}

                    {mode !== "partial" && treatmentFeeTotalSessions > 0 && (
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-slate-500">Sessions Covered Now *</label>
                        <Input
                          type="number"
                          min="1"
                          max={treatmentFeeTotalSessions}
                          value={treatmentFeeDraft.sessions_now}
                          onChange={(e) => setTreatmentSessionsNow(e.target.value)}
                          className="h-9"
                          data-testid="cons-treatment-fee-sessions-now"
                        />
                      </div>
                    )}

                    {treatmentIsPartialSessions && (
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-slate-500">
                          Due Date for Balance ({treatmentRemainingSessions} sessions, Rs.{treatmentRemainingAmount}) *
                        </label>
                        <Input
                          type="date"
                          value={treatmentFeeDraft.balance_due_date}
                          onChange={(e) => setTreatmentFeeDraft({ ...treatmentFeeDraft, balance_due_date: e.target.value })}
                          className="h-9"
                          data-testid="cons-treatment-fee-balance-due-date"
                        />
                      </div>
                    )}

                    {treatmentIsPartialSessions && (
                      <div className="rounded-md border border-sky-200 bg-sky-50 p-2.5 text-[11px] text-sky-800" data-testid="cons-treatment-fee-partial-sessions-note">
                        Covers <span className="font-semibold">{treatmentSessionsNow} of {treatmentFeeTotalSessions}</span> sessions. Balance <span className="font-semibold">Rs.{treatmentRemainingAmount}</span> ({treatmentRemainingSessions} sessions) due {treatmentFeeDraft.balance_due_date || "—"}.
                      </div>
                    )}

                    {mismatch && (
                      <div className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-800" data-testid="cons-treatment-fee-mismatch-warning">
                        Entered amount <span className="font-semibold">Rs.{amount}</span> differs from {treatmentIsPartialSessions ? `the Rs.${expectedForSessionsNow} price for these ${treatmentSessionsNow} sessions` : <>the assigned Treatment Fee <span className="font-semibold">Rs.{expected}</span></>}. Please confirm this is correct.
                      </div>
                    )}

                    {mode === "upi" && (
                      <>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">UPI Transaction ID</label>
                          <Input
                            value={treatmentConfirmDraft.upi_transaction_id}
                            onChange={(e) => setTreatmentConfirmDraft({ ...treatmentConfirmDraft, upi_transaction_id: e.target.value })}
                            className="h-9"
                            data-testid="cons-treatment-fee-upi-txn"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">UTR</label>
                          <Input
                            value={treatmentConfirmDraft.upi_utr}
                            onChange={(e) => setTreatmentConfirmDraft({ ...treatmentConfirmDraft, upi_utr: e.target.value })}
                            className="h-9"
                            data-testid="cons-treatment-fee-upi-utr"
                          />
                        </div>
                      </>
                    )}

                    {mode === "card" && (
                      <>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">Account Number</label>
                          <Input
                            value={treatmentConfirmDraft.account_number}
                            onChange={(e) => setTreatmentConfirmDraft({ ...treatmentConfirmDraft, account_number: e.target.value })}
                            className="h-9"
                            data-testid="cons-treatment-fee-account-number"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">Account Holder Name</label>
                          <Input
                            value={treatmentConfirmDraft.account_holder_name}
                            onChange={(e) => setTreatmentConfirmDraft({ ...treatmentConfirmDraft, account_holder_name: e.target.value })}
                            className="h-9"
                            data-testid="cons-treatment-fee-account-holder"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">Bank Name</label>
                          <Input
                            value={treatmentConfirmDraft.bank_name}
                            onChange={(e) => setTreatmentConfirmDraft({ ...treatmentConfirmDraft, bank_name: e.target.value })}
                            className="h-9"
                            data-testid="cons-treatment-fee-confirm-bank-name"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">IFSC Code</label>
                          <Input
                            value={treatmentConfirmDraft.ifsc_code}
                            onChange={(e) => setTreatmentConfirmDraft({ ...treatmentConfirmDraft, ifsc_code: e.target.value.toUpperCase() })}
                            className="h-9"
                            data-testid="cons-treatment-fee-ifsc"
                          />
                        </div>
                      </>
                    )}

                    {mode === "cheque" && (
                      <>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">Bank Name</label>
                          <Input
                            value={treatmentFeeDraft.bank_name}
                            onChange={(e) => setTreatmentFeeDraft({ ...treatmentFeeDraft, bank_name: e.target.value })}
                            className="h-9"
                            data-testid="cons-treatment-fee-bank-name"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">Cheque Number</label>
                          <Input
                            value={treatmentFeeDraft.cheque_number}
                            onChange={(e) => setTreatmentFeeDraft({ ...treatmentFeeDraft, cheque_number: e.target.value })}
                            className="h-9"
                            data-testid="cons-treatment-fee-cheque-number"
                          />
                        </div>
                      </>
                    )}

                    {mode === "partial" && (
                      <PartialInstallmentsEditor
                        installments={partialInstallments}
                        setInstallments={(next) => setTreatmentFeeDraft({ ...treatmentFeeDraft, partial_installments: next })}
                        totalSessions={treatmentFeeTotalSessions}
                        perSessionRate={perSessionRate}
                        onCollectRow={collectPartialInstallmentNow}
                        collecting={collectingTreatmentFee}
                      />
                    )}

                    <Button
                      className="w-full bg-indigo-600 text-xs hover:bg-indigo-700"
                      onClick={submitTreatmentModePopup}
                      disabled={
                        collectingTreatmentFee ||
                        selectedLead.session_package_price == null ||
                        (["cash", "upi", "card"].includes(mode) && !(parseFloat(treatmentFeeDraft.amount) > 0)) ||
                        (mode === "cheque" && (!treatmentFeeDraft.bank_name.trim() || !treatmentFeeDraft.cheque_number.trim())) ||
                        (mode === "partial" && (!partialAllFilled || partialMismatch)) ||
                        (["cash", "upi", "card", "cheque"].includes(mode) && treatmentIsPartialSessions && !treatmentFeeDraft.balance_due_date) ||
                        (mode === "upi" && (!treatmentConfirmDraft.upi_transaction_id.trim() || !treatmentConfirmDraft.upi_utr.trim())) ||
                        (mode === "card" && (!treatmentConfirmDraft.account_number.trim() || !treatmentConfirmDraft.account_holder_name.trim() || !treatmentConfirmDraft.bank_name.trim() || !treatmentConfirmDraft.ifsc_code.trim()))
                      }
                      data-testid="cons-treatment-fee-confirm-submit"
                    >
                      {collectingTreatmentFee ? "Saving..." : mode === "partial" ? "Save Payment Schedule" : `Collect ${modeLabel} Payment`}
                    </Button>
                  </div>
                </div>
              );
            })()}

            {/* Physio Assign popup (Branch Admin) — after fees are collected */}
            {showPhysioModal && (
              <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" data-testid="cons-physio-modal">
                <div className="w-full max-w-md space-y-3 rounded-xl bg-white p-4 shadow-2xl">
                  <div className="flex items-center justify-between">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800"><Users className="h-4 w-4 text-emerald-600" /> Assign Physio</p>
                    <button onClick={() => setShowPhysioModal(false)} className="rounded p-1 text-slate-400 hover:bg-slate-100" data-testid="cons-physio-close"><X className="h-4 w-4" /></button>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600" data-testid="cons-physio-package-context">
                    <p className="font-semibold text-slate-700">{selectedLead.session_package_name || "Session package"} · {totalSessionsNeeded} sessions</p>
                    <p className="mt-0.5">
                      Treatment Fee: {selectedLead.treatment_fee_paid != null ? (
                        <span className="font-semibold text-emerald-700">Rs.{selectedLead.treatment_fee_paid} paid ({selectedLead.treatment_fee_payment_mode || "—"})</span>
                      ) : (
                        <span className="text-amber-600">not paid</span>
                      )}
                    </p>
                  </div>

                  <p className="text-[11px] text-slate-500">Available physios in this branch</p>

                  {physioOptions.length === 0 ? (
                    <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-400">No physios found for this branch yet.</p>
                  ) : (
                    <div className="max-h-40 space-y-1.5 overflow-y-auto">
                      {physioOptions.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setPhysioPick(p.id)}
                          className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-xs font-semibold transition ${
                            physioPick === p.id ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                          }`}
                          data-testid={`cons-physio-option-${p.id}`}
                        >
                          <span>{p.full_name}{p.specialization ? ` · ${p.specialization}` : ""}</span>
                          {physioPick === p.id && <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
                        </button>
                      ))}
                    </div>
                  )}

                  {physioPick && (
                    <div className="rounded-lg border border-violet-200 bg-violet-50 p-3" data-testid="cons-physio-sessions-preview">
                      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-violet-700">Sessions to be booked</p>
                      {loadingPhysioCalendar ? (
                        <p className="text-xs text-violet-500">Loading this physio's calendar...</p>
                      ) : !hasEnoughPhysioSlots ? (
                        <p className="text-xs text-amber-700">
                          Only {proposedSessionSlots.length} of {totalSessionsNeeded} needed slots are open on this physio's calendar.
                          Add more in Consultations → Physio Calendar first.
                        </p>
                      ) : (
                        <div className="max-h-28 space-y-1 overflow-y-auto text-xs text-violet-800" data-testid="cons-physio-sessions-list">
                          {proposedSessionSlots.map((slot, i) => (
                            <p key={slot}>#{i + 1} · {slot.replace("T", " ")}</p>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <Button
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-xs"
                    onClick={submitPhysioAssign}
                    disabled={assigningPhysio || !physioPick || loadingPhysioCalendar || !hasEnoughPhysioSlots}
                    data-testid="cons-physio-submit"
                  >
                    {assigningPhysio ? "Assigning..." : "Assign & Book Sessions"}
                  </Button>
                </div>
              </div>
            )}

            {/* Schedule Follow-Up popup */}
            {followUpDraft && (
              <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4" data-testid="cons-followup-modal">
                <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
                  <div className="flex items-center justify-between bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-4 text-white">
                    <div className="flex items-center gap-2">
                      <Bell className="h-5 w-5" />
                      <p className="text-base font-semibold">Schedule Follow-Up</p>
                    </div>
                    <button onClick={() => setFollowUpDraft(null)} className="rounded-full p-1.5 text-white/80 hover:bg-white/20" data-testid="cons-followup-close">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="space-y-4 p-5">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">Date *</label>
                      <Input
                        type="date"
                        value={followUpDraft.date}
                        min={new Date().toISOString().slice(0, 10)}
                        onChange={(e) => setFollowUpDraft({ ...followUpDraft, date: e.target.value })}
                        data-testid="cons-followup-date"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">Time *</label>
                      <Input
                        type="time"
                        value={followUpDraft.time}
                        onChange={(e) => setFollowUpDraft({ ...followUpDraft, time: e.target.value })}
                        data-testid="cons-followup-time"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">Remarks</label>
                      <textarea
                        rows={3}
                        className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
                        placeholder="What to discuss in the next follow-up..."
                        value={followUpDraft.remarks}
                        onChange={(e) => setFollowUpDraft({ ...followUpDraft, remarks: e.target.value })}
                        data-testid="cons-followup-remarks"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/40 px-5 py-3">
                    <Button variant="outline" onClick={() => setFollowUpDraft(null)} data-testid="cons-followup-cancel">Cancel</Button>
                    <Button
                      className="bg-amber-500 text-white hover:bg-amber-600"
                      onClick={async () => {
                        if (!followUpDraft.date || !followUpDraft.time) {
                          toast.error("Date and time are required");
                          return;
                        }
                        try {
                          const updated = await scheduleConsultationFollowUp(selectedLead.id, followUpDraft);
                          setFollowUpDraft(null);
                          // Close the lead card instantly, same as a plain stage move.
                          setSelectedLead(null);
                          setBoard((b) => ({ ...b, leads: (b.leads || []).map((l) => l.id === updated.id ? updated : l) }));
                          toast.success(`Follow-up scheduled for ${followUpDraft.date} at ${followUpDraft.time}`);
                        } catch (e) { toast.error(e?.response?.data?.detail || "Failed to schedule"); }
                      }}
                      data-testid="cons-followup-save"
                    >
                      <CheckCircle2 className="mr-1 h-4 w-4" /> Confirm & Move
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Reschedule Follow-Up popup */}
            {rescheduleDraft && (
              <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4" data-testid="cons-reschedule-modal">
                <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
                  <div className="flex items-center justify-between bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-4 text-white">
                    <div className="flex items-center gap-2">
                      <Bell className="h-5 w-5" />
                      <p className="text-base font-semibold">Reschedule Follow-Up</p>
                    </div>
                    <button onClick={() => setRescheduleDraft(null)} className="rounded-full p-1.5 text-white/80 hover:bg-white/20" data-testid="cons-reschedule-close">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="space-y-4 p-5">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">New Date *</label>
                      <Input
                        type="date"
                        value={rescheduleDraft.date}
                        min={new Date().toISOString().slice(0, 10)}
                        onChange={(e) => setRescheduleDraft({ ...rescheduleDraft, date: e.target.value })}
                        data-testid="cons-reschedule-date"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">New Time *</label>
                      <Input
                        type="time"
                        value={rescheduleDraft.time}
                        onChange={(e) => setRescheduleDraft({ ...rescheduleDraft, time: e.target.value })}
                        data-testid="cons-reschedule-time"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">Reason for Reschedule *</label>
                      <textarea
                        rows={3}
                        className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
                        placeholder="Why is this being rescheduled..."
                        value={rescheduleDraft.reason}
                        onChange={(e) => setRescheduleDraft({ ...rescheduleDraft, reason: e.target.value })}
                        data-testid="cons-reschedule-reason"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/40 px-5 py-3">
                    <Button variant="outline" onClick={() => setRescheduleDraft(null)} data-testid="cons-reschedule-cancel">Cancel</Button>
                    <Button
                      className="bg-amber-500 text-white hover:bg-amber-600"
                      onClick={async () => {
                        if (!rescheduleDraft.date || !rescheduleDraft.time || !rescheduleDraft.reason.trim()) {
                          toast.error("Date, time and reason are required");
                          return;
                        }
                        try {
                          const updated = await rescheduleConsultationFollowUp(selectedLead.id, rescheduleDraft.followupId, {
                            date: rescheduleDraft.date, time: rescheduleDraft.time, reason: rescheduleDraft.reason,
                          });
                          applyUpdatedLead(updated);
                          setRescheduleDraft(null);
                          toast.success(`Follow-up rescheduled to ${rescheduleDraft.date} at ${rescheduleDraft.time}`);
                        } catch (e) { toast.error(e?.response?.data?.detail || "Failed to reschedule"); }
                      }}
                      data-testid="cons-reschedule-save"
                    >
                      <CheckCircle2 className="mr-1 h-4 w-4" /> Reschedule
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/** Read-only "All Stages" overview — every stage in order, current one highlighted,
 * passed ones checked off. Purely informational; there is no way to click back to
 * an earlier stage from here (moving backward isn't allowed once a lead has moved on). */
function AllStagesStepper({ stages, currentStage }) {
  const currentIdx = stages.findIndex((s) => s.name === currentStage);
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-100 bg-slate-50/60 p-2.5" data-testid="cons-all-stages-stepper">
      {stages.map((s, idx) => {
        const hex = s.color || "#64748b";
        const isCurrent = idx === currentIdx;
        const isPassed = currentIdx >= 0 && idx < currentIdx;
        return (
          <span
            key={s.id}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold"
            style={
              isCurrent
                ? { background: hex, color: "#ffffff" }
                : isPassed
                  ? { background: `${hex}1f`, color: hex }
                  : { background: "#f1f5f9", color: "#94a3b8" }
            }
            data-testid={`cons-all-stages-${s.name}`}
          >
            {isPassed && <CheckCircle2 className="h-3 w-3" />}
            {s.name}
          </span>
        );
      })}
    </div>
  );
}

// Colored, centered replacement for a native <select> of payment modes —
// every option is shown inline as its own button (no click-to-open dropdown),
// since native <option> backgrounds also can't be reliably styled cross-browser.
function PaymentModeSelect({ value, options, onChange, testId }) {
  return (
    <div className="flex flex-wrap gap-1.5" data-testid={testId}>
      {options.map((o) => {
        const selected = o.value === value;
        const hex = PAYMENT_MODE_COLORS[o.value] || "#64748b";
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`h-9 min-w-[64px] flex-1 rounded-md text-center text-xs font-semibold transition ${
              selected ? "text-white shadow-sm" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
            style={selected ? { backgroundColor: hex } : undefined}
            data-testid={`${testId}-option-${o.value}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Partial Payment schedule, split by session count rather than a raw rupee amount —
 * each installment's amount is computed from how many sessions it covers at the
 * package's own per-session rate, so it always agrees with "N sessions x rate/session"
 * shown elsewhere. The first installment's due date defaults to today (set by the
 * caller); later ones are scheduled ahead.
 *
 * Only a row whose due date is today can be collected right here — clicking its
 * Collect button saves the whole schedule (every other row stays unpaid) and marks
 * just that one row paid, in one action. Future-dated rows have no Collect button;
 * they're picked up later from Accountant Manage's Outstanding Amount / Payment
 * Schedules boards once their date arrives.
 */
function PartialInstallmentsEditor({ installments, setInstallments, totalSessions, perSessionRate, onCollectRow, collecting }) {
  const sessionsTotal = installments.reduce((sum, i) => sum + (parseInt(i.sessions, 10) || 0), 0);
  const mismatch = totalSessions > 0 && sessionsTotal !== totalSessions;
  const allFilled = installments.length >= 2 && installments.every((i) => parseInt(i.sessions, 10) > 0 && i.due_date);
  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-2 rounded-md border border-slate-200 bg-white p-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold text-slate-600">Payment Schedule</p>
        <button
          type="button"
          onClick={() => setInstallments([...installments, { sessions: "", due_date: "" }])}
          className="flex items-center gap-1 text-[11px] font-semibold text-sky-600 hover:text-sky-700"
          data-testid="cons-treatment-fee-partial-add"
        >
          <Plus className="h-3.5 w-3.5" /> Add Payment
        </button>
      </div>
      {installments.map((inst, idx) => {
        const sessionsNum = parseInt(inst.sessions, 10) || 0;
        const amount = Math.round(sessionsNum * perSessionRate);
        const isToday = !!inst.due_date && inst.due_date === todayIso;
        return (
          <div key={idx} className="flex items-end gap-1.5" data-testid={`cons-treatment-fee-partial-row-${idx}`}>
            <div className="flex-1">
              <label className="mb-1 block text-[11px] font-medium text-slate-500">{partialInstallmentLabel(idx)} Sessions *</label>
              <Input
                type="number"
                min="1"
                max={totalSessions || undefined}
                value={inst.sessions}
                onChange={(e) => {
                  const next = [...installments];
                  next[idx] = { ...next[idx], sessions: e.target.value };
                  setInstallments(next);
                }}
                className="h-9"
                data-testid={`cons-treatment-fee-partial-sessions-${idx}`}
              />
            </div>
            <div className="w-20">
              <label className="mb-1 block text-[11px] font-medium text-slate-500">Amount</label>
              <div className="flex h-9 items-center rounded-md border border-slate-200 bg-slate-50 px-2 text-xs font-semibold text-slate-700" data-testid={`cons-treatment-fee-partial-computed-amount-${idx}`}>
                {sessionsNum > 0 ? `₹${amount}` : "—"}
              </div>
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-[11px] font-medium text-slate-500">Due Date *</label>
              <Input
                type="date"
                value={inst.due_date}
                onChange={(e) => {
                  const next = [...installments];
                  next[idx] = { ...next[idx], due_date: e.target.value };
                  setInstallments(next);
                }}
                className="h-9"
                data-testid={`cons-treatment-fee-partial-date-${idx}`}
              />
            </div>
            {isToday && (
              <Button
                size="sm"
                onClick={() => onCollectRow(idx)}
                disabled={collecting || !allFilled || mismatch}
                className="h-9 bg-emerald-600 text-xs hover:bg-emerald-700"
                data-testid={`cons-treatment-fee-partial-collect-${idx}`}
              >
                Collect
              </Button>
            )}
            {installments.length > 2 && (
              <button
                type="button"
                onClick={() => setInstallments(installments.filter((_, i) => i !== idx))}
                className="mb-1.5 rounded p-1.5 text-rose-400 hover:bg-rose-50 hover:text-rose-600"
                data-testid={`cons-treatment-fee-partial-remove-${idx}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        );
      })}
      {sessionsTotal > 0 && mismatch && (
        <p className="text-[11px] text-rose-600" data-testid="cons-treatment-fee-partial-mismatch">
          Installments total ({sessionsTotal} sessions) must equal the Total Sessions ({totalSessions})
        </p>
      )}
    </div>
  );
}

/**
 * A text box that auto-saves (debounced, silent) while typing — "Done" just exits
 * edit mode, it isn't a save action. Pre-existing records saved under the old
 * Save & Lock flow may still carry a locked flag; the Edit button calls the
 * backend unlock endpoint for those before reopening them for editing.
 */
function LockableTextBox({
  icon: Icon, label, accent, value, onChange, editing, locked, savedText,
  saving, canEdit, onDone, onEdit, onUnlock, rows, placeholder, testPrefix,
}) {
  const colors = {
    sky: { border: "border-sky-200", bg: "bg-sky-50", text: "text-sky-700", btn: "bg-sky-600 hover:bg-sky-700" },
    indigo: { border: "border-indigo-200", bg: "bg-indigo-50", text: "text-indigo-700", btn: "bg-indigo-600 hover:bg-indigo-700" },
  }[accent] || { border: "border-sky-200", bg: "bg-sky-50", text: "text-sky-700", btn: "bg-sky-600 hover:bg-sky-700" };

  const showEditor = canEdit && (editing || !savedText);

  return (
    <div className={`rounded-lg border ${colors.border} ${colors.bg} p-3`} data-testid={testPrefix}>
      <div className="mb-1.5 flex items-center justify-between">
        <p className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider ${colors.text}`}>
          <Icon className="h-3.5 w-3.5" /> {label}
        </p>
        {locked && <Lock className="h-3.5 w-3.5 text-slate-400" />}
      </div>

      {showEditor ? (
        <>
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={rows}
            placeholder={placeholder}
            className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs"
            data-testid={`${testPrefix}-input`}
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="flex items-center gap-1 text-[11px] text-slate-400" data-testid={`${testPrefix}-autosave-status`}>
              {saving ? "Saving..." : value.trim() ? (
                <><CheckCircle2 className="h-3 w-3 text-emerald-500" /> Auto-saved</>
              ) : null}
            </span>
            <Button size="sm" variant="outline" className="text-xs" onClick={onDone} data-testid={`${testPrefix}-done`}>
              Done
            </Button>
          </div>
        </>
      ) : savedText ? (
        <>
          <p className="whitespace-pre-wrap text-xs text-slate-700">{savedText}</p>
          {canEdit && (
            <Button
              size="sm"
              variant="outline"
              className="mt-2 text-xs"
              onClick={locked ? onUnlock : onEdit}
              data-testid={`${testPrefix}-edit`}
            >
              <Pencil className="mr-1 h-3 w-3" /> Edit
            </Button>
          )}
        </>
      ) : (
        <p className="text-xs text-slate-400">Not written yet.</p>
      )}
    </div>
  );
}

export default ConsultationsBoard;
