import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Calendar, CheckCircle2, ChevronLeft, ChevronRight, RefreshCw, XCircle, Search, Phone, Stethoscope, ClipboardList, Lock, Pencil, Dumbbell, Users, X, Bell, Plus, Trash2, Ban, ClipboardCheck, IndianRupee, Printer, Share2, Download } from "lucide-react";
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
import { endTime12h, to12h } from "@/lib/time";
import { LOGO_URL, PRINTABLE_STYLES, escapeHtml, openPrintable, downloadPrintable, sharePrintable } from "@/lib/printable";

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
const INSTALLMENT_PAYMENT_MODES = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "cheque", label: "Cheque" },
];
const PARTIAL_ORDINALS = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth"];
const partialInstallmentLabel = (idx) => `${PARTIAL_ORDINALS[idx] || `#${idx + 1}`} Payment`;

// ---- Payment receipt ----------------------------------------------------------------
// The receipt is built as a standalone HTML document rather than printed from the page:
// window.print() here would send the whole board — modals, sidebar and all — to the
// printer, and the same document is what gets downloaded, so paper and file always match.
// The receipt's own document content. The branding, styles and the open/print/download/
// share mechanics are shared with every other printable in lib/printable.js.
const receiptRows = (r) => [
  [isSchedule(r) ? "Reference No." : "Receipt No.", r.receiptNo],
  ["Date", r.dateLabel],
  ["Patient", r.patient],
  ["Patient No.", r.patientNo],
  ["Phone", r.phone],
  [isSchedule(r) ? "Scheduled For" : "Paid For", r.paidFor],
  r.packageName ? ["Package", r.packageName] : null,
  r.sessionsCovered ? ["Sessions Covered", r.sessionsCovered] : null,
  ["Payment Mode", r.modeLabel],
  r.reference ? ["Reference", r.reference] : null,
  r.originalAmount != null && r.originalAmount !== r.amount ? ["Original Price", `Rs.${r.originalAmount}`] : null,
  r.discount ? ["Discount", `- Rs.${r.discount}`] : null,
  [isSchedule(r) ? "Total Payable" : "Amount Paid", `Rs.${r.amount}`],
  r.balanceDue ? ["Balance Due", r.balanceDue] : null,
  [isSchedule(r) ? "Prepared By" : "Collected By", r.collectedBy],
].filter(Boolean);

const receiptHtml = (r) => `<!doctype html><html><head><meta charset="utf-8">
<title>Receipt ${escapeHtml(r.receiptNo)}</title><style>${PRINTABLE_STYLES}</style></head>
<body><div class="wrap">
  <div class="head">
    <img class="logo" src="${LOGO_URL}" alt="FITSIOMAX">
    <div>
      <div class="brand">FITSIOMAX</div>
      <div class="sub">${escapeHtml(r.branch || "Physiotherapy & Rehabilitation")}</div>
    </div>
  </div>
  <div class="tag${isSchedule(r) ? " tag-sch" : ""}">${isSchedule(r) ? "PAYMENT SCHEDULE" : "PAYMENT RECEIVED"}</div>
  <hr>
  <div class="amt-label">${isSchedule(r) ? "Total Payable" : "Amount Paid"}</div>
  <div class="amt${isSchedule(r) ? " amt-sch" : ""}">Rs.${escapeHtml(r.amount)}</div>
  <hr>
  <table>${receiptRows(r).map(([k, v]) => `<tr><td class="k">${escapeHtml(k)}</td><td class="v">${escapeHtml(v)}</td></tr>`).join("")}</table>
  ${(r.installments || []).length ? `<hr><div class="amt-label">Installments</div>
  <table>${r.installments.map((i, n) => `<tr><td class="k">#${n + 1}${i.sessions ? ` · ${escapeHtml(i.sessions)} sessions` : ""} · due ${escapeHtml(i.due_date || "—")}</td><td class="v">Rs.${escapeHtml(i.amount)}${i.paid ? " · PAID" : ""}</td></tr>`).join("")}</table>` : ""}
  <hr>
  <div class="foot">${isSchedule(r)
    ? "This is a payment schedule, not a receipt — no amount has been collected yet.<br>A receipt is issued for each installment when it is paid."
    : "This is a computer-generated receipt and needs no signature.<br>Thank you for choosing FITSIOMAX."}</div>
</div></body></html>`;

const receiptText = (r) => [
  `FITSIOMAX — Payment Receipt`,
  ...receiptRows(r).map(([k, v]) => `${k}: ${v}`),
].join("\n");

const printReceipt = (r) => openPrintable(receiptHtml(r), { print: true });
const downloadReceipt = (r) => downloadPrintable(receiptHtml(r), `receipt-${r.receiptNo}.html`);
const shareReceipt = (r) => sharePrintable(receiptText(r), `FITSIOMAX Receipt ${r.receiptNo}`);

// Month-grid helpers for the treatment-session slot picker — the same shape the PHYSIO
// CALENDAR itself uses, so the two read as one workflow.
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const pad2 = (n) => String(n).padStart(2, "0");
const isoDate = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`;
const longDate = (d) => new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
/** "2026-08-03" -> "Monday, 3 Aug" — how a treatment day reads on the plan. */
const dayLabel = (d) => new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "short" });
/** Same week rule the backend stamps on each session: whole weeks from the first day. */
const weekOf = (d, firstDay) => Math.floor((new Date(`${d}T00:00:00`) - new Date(`${firstDay}T00:00:00`)) / 604800000) + 1;
// The treatment slot length is the one FITSIO STORE publishes for session packages —
// the same value PHYSIO CALENDAR cuts a physio's day into, so one published slot is
// always exactly one treatment session.
const FALLBACK_SESSION_MINUTES = 30;

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

export const ConsultationsBoard = ({ branchId, viewerRole, externalStageFilter, showOwnStageBar = true, autoOpenLeadId, onAutoOpened, externalDate, hideDateFilter = false, onCountChange }) => {
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

  // Shown after a fee is actually taken — the money has changed hands and the client is
  // standing there, so the acknowledgement has to be something that can be handed over,
  // not a toast that disappears. Lives outside the lead dialog so it survives that
  // closing on the last fee.
  const [receipt, setReceipt] = useState(null);

  /** Every fee path builds its receipt here, so they can't drift apart field by field. */
  const makeReceipt = ({ lead, payload, prefix, paidFor, packageName, assignedPrice, kind = "paid", sessionsCovered, balanceDue, installments }) => {
    const amount = payload.amount;
    // A Branch-Admin-negotiated amount below the assigned price is a discount, and the
    // receipt has to show both numbers or it reads as though the price was simply lower.
    const discount = assignedPrice != null && assignedPrice > amount
      ? Math.round((assignedPrice - amount) * 100) / 100
      : null;
    return {
      kind,
      receiptNo: `${prefix}-${(lead.patient_number || lead.id || "").toString().slice(-8).toUpperCase()}-${Date.now().toString().slice(-6)}`,
      dateLabel: new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }),
      patient: lead.name || "—",
      patientNo: lead.patient_number || "—",
      phone: lead.phone || "—",
      branch: lead.branch_name || "",
      paidFor,
      packageName: packageName || "",
      sessionsCovered: sessionsCovered || "",
      balanceDue: balanceDue || "",
      installments: installments || [],
      amount,
      originalAmount: assignedPrice != null ? assignedPrice : null,
      discount,
      modeLabel: ALL_PAYMENT_MODE_LABELS[payload.payment_mode] || payload.payment_mode,
      reference: paymentReference(payload),
      collectedBy: "Branch Admin",
      isCash: payload.payment_mode === "cash",
    };
  };

  // Collect Treatment Fee popup (Branch Admin only) — at the Treatment Fee stage, any payment method
  const [treatmentFeeDraft, setTreatmentFeeDraft] = useState(null); // { paid_amount, payment_mode } | null
  const [collectingTreatmentFee, setCollectingTreatmentFee] = useState(false);
  // Same second-step confirm popup as packageConfirmDraft above, but for Cash/UPI/Card
  // on the Treatment Fee. Cheque and Partial Payment keep their existing single-popup
  // flow (locked amount, no manual override, no confirm step).
  const [treatmentConfirmDraft, setTreatmentConfirmDraft] = useState(null);

  // Partial Payment schedule's own per-row Collect popup — collecting one specific
  // installment is a real payment in its own right (amount, mode, UTR/cheque number),
  // same as every other Treatment Fee mode, not just a bare "mark paid" flip.
  const [partialCollectDraft, setPartialCollectDraft] = useState(null); // { idx, amount, payment_mode, ... } | null

  // Physio Assign (Branch Admin only) — two steps. Step 1 picks an available Jr. Physio;
  // clicking one opens step 2, the slot picker, where every session of the paid package is
  // placed on a *chosen* date and time from that physio's own PHYSIO CALENDAR. The dates
  // are never auto-filled: a treatment plan is spread across days deliberately, so the
  // Branch Admin fixes each session's date and time themselves.
  const [showPhysioModal, setShowPhysioModal] = useState(false);
  const [physioOptions, setPhysioOptions] = useState([]);
  const [physioPick, setPhysioPick] = useState("");
  const [assigningPhysio, setAssigningPhysio] = useState(false);
  const [physioCalendarData, setPhysioCalendarData] = useState(null);
  const [loadingPhysioCalendar, setLoadingPhysioCalendar] = useState(false);
  // Step 2 — the "pick the treatment dates and times" popup.
  const [showSlotPicker, setShowSlotPicker] = useState(false);
  const [pickedSessionSlots, setPickedSessionSlots] = useState([]); // ["YYYY-MM-DDTHH:MM", ...]
  const [pickerMonth, setPickerMonth] = useState(new Date().getMonth());
  const [pickerYear, setPickerYear] = useState(new Date().getFullYear());
  const [pickerDate, setPickerDate] = useState(null); // "YYYY-MM-DD"
  const [sessionMinutes, setSessionMinutes] = useState(FALLBACK_SESSION_MINUTES);

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

  // Lets a parent label a tab with how many rows are behind it without fetching the
  // board's data a second time.
  useEffect(() => {
    if (onCountChange) onCountChange(dateAndSearchFiltered.length);
  }, [dateAndSearchFiltered.length, onCountChange]);

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

  // A parent day-picker (the Head Physio board's week strip) drives the date filter, so
  // the board shows one day at a time without its own popover fighting the selection.
  useEffect(() => {
    if (externalDate === undefined) return;
    if (!externalDate) { setDateFilter(null); return; }
    const from = new Date(`${externalDate}T00:00:00`);
    const to = new Date(`${externalDate}T23:59:59`);
    setDateFilter({ from, to, key: externalDate, label: externalDate });
  }, [externalDate]);

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
    // A Partial Payment schedule that already exists on the lead (whether or not
    // every installment is collected yet) is reloaded from the real saved rows —
    // never reset back to two blank ones — so reopening this always shows what's
    // actually still owed, with already-collected rows carrying their paid flag.
    const total = selectedLead.session_package_sessions || 0;
    const rate = total ? (selectedLead.session_package_price || 0) / total : 0;
    const existing = selectedLead.treatment_fee_payment_details?.installments;
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
      partial_installments: existing && existing.length
        ? existing.map((inst) => ({
            sessions: rate ? String(Math.round((inst.amount || 0) / rate)) : "",
            due_date: inst.due_date || "",
            paid: !!inst.paid,
          }))
        : [
            { sessions: "", due_date: new Date().toISOString().slice(0, 10) },
            { sessions: "", due_date: "" },
          ],
    });
  };

  // Jumps straight to the Payment Schedule view (skipping the mode-picker click)
  // for a lead whose Partial Payment plan already exists — used by both the
  // combined "Collect Fees" popup and the Fee Collected side panel once
  // hasPendingInstallments is true.
  const openPartialScheduleDraft = () => {
    openTreatmentFeeDraft();
    setTreatmentConfirmDraft({ upi_transaction_id: "", upi_utr: "", account_number: "", account_holder_name: "", bank_name: "", ifsc_code: "" });
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

  // A Partial Payment schedule leaves treatment_fee_paid set (the full price) the
  // moment it's created — even though nothing may actually be collected yet — so
  // "already collected" everywhere else in this file has to be read together with
  // whether any installment is still unpaid, not treatment_fee_paid alone.
  const savedInstallments = selectedLead?.treatment_fee_payment_details?.installments || [];
  const hasPendingInstallments = selectedLead?.treatment_fee_payment_mode === "partial" && savedInstallments.some((i) => !i.paid);

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
      setReceipt(makeReceipt({
        lead: selectedLead, payload, prefix: "CF",
        paidFor: "Consultation Fee",
        packageName: selectedLead.package_name || "",
        assignedPrice: selectedLead.package_price,
      }));
      // The receipt closes on its own button; the patient stays open behind it so the
      // Treatment Fee can be taken next without reopening them.
      setCollectFeeDraft(null);
      setTreatmentFeeDraft(null);
      setSelectedLead(res.lead);
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

      const totalSessions = selectedLead.session_package_sessions || 0;
      const savedInst = res.lead?.treatment_fee_payment_details?.installments || [];
      const scheduleOnly = payload.payment_mode === "partial";
      // Cash/UPI/Card/Cheque can cover only some of the package's sessions now, with the
      // rest scheduled — the receipt has to say which sessions this money bought, or it
      // reads as payment for the whole package.
      const partOfPackage = !scheduleOnly && payload.sessions_now != null && totalSessions && payload.sessions_now < totalSessions;
      const unpaid = savedInst.filter((i) => !i.paid);
      setReceipt(makeReceipt({
        lead: selectedLead, payload,
        prefix: scheduleOnly ? "TS" : "TF",
        kind: scheduleOnly ? "schedule" : "paid",
        paidFor: "Treatment Fee",
        packageName: selectedLead.session_package_name
          ? `${selectedLead.session_package_name} · ${totalSessions} sessions`
          : "",
        // Against what these sessions should cost, not the whole package — collecting for
        // fewer sessions must never be recorded as a discount.
        assignedPrice: scheduleOnly
          ? null
          : partOfPackage
          ? Math.round((selectedLead.session_package_price || 0) / totalSessions * payload.sessions_now)
          : selectedLead.session_package_price,
        sessionsCovered: partOfPackage ? `${payload.sessions_now} of ${totalSessions}` : "",
        balanceDue: unpaid.length
          ? `Rs.${unpaid.reduce((s, i) => s + (i.amount || 0), 0)}${unpaid[0]?.due_date ? ` · due ${unpaid[0].due_date}` : ""}`
          : "",
        installments: scheduleOnly ? savedInst : [],
      }));
      // Same as the installment path: the receipt is the confirmation and closes on
      // its own button, so the patient stays open behind it rather than the whole
      // stack vanishing the moment the money goes through.
      setCollectFeeDraft(null);
      setTreatmentFeeDraft(null);
      setSelectedLead(res.lead);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to collect Treatment Fee");
    }
    setCollectingTreatmentFee(false);
  };

  // Opens the Collect popup for one specific Partial Payment installment — amount
  // pre-filled from the real saved amount if the schedule already exists on the
  // lead, or computed from that row's sessions x rate for a schedule not yet
  // saved — but always re-editable, plus a payment mode picker (same 4 modes as
  // everywhere else) and that mode's own fields.
  const openPartialCollectPopup = (idx) => {
    const inst = partialInstallments[idx] || {};
    const saved = savedInstallments[idx];
    const amount = saved?.amount ?? Math.round((parseInt(inst.sessions, 10) || 0) * perSessionRate);
    setPartialCollectDraft({
      idx,
      amount: amount > 0 ? String(amount) : "",
      payment_mode: "cash",
      upi_transaction_id: "", upi_utr: "",
      account_number: "", account_holder_name: "", bank_name: "", ifsc_code: "",
      cheque_number: "",
    });
  };

  // Submits the per-installment Collect popup. If the Partial Payment schedule
  // hasn't been saved to the lead yet (first-ever collect on this draft), it's
  // created first — every installment still starts unpaid, same as always — then
  // this one specific installment is collected with its own mode/UTR/cheque details,
  // which also logs a real activity entry so it shows up in Session Collections /
  // Accountant Manage exactly like any other Treatment Fee collection.
  const submitPartialCollect = async () => {
    const draft = partialCollectDraft;
    const amount = parseFloat(draft.amount);
    if (!(amount > 0)) {
      toast.error("Enter a valid amount");
      return;
    }
    const mode = draft.payment_mode;
    const payload = { payment_mode: mode, amount };
    if (mode === "upi") {
      payload.upi_transaction_id = draft.upi_transaction_id.trim();
      payload.upi_utr = draft.upi_utr.trim();
    } else if (mode === "card") {
      if (!draft.account_number.trim() || !draft.account_holder_name.trim() || !draft.bank_name.trim() || !draft.ifsc_code.trim()) {
        toast.error("Account Number, Account Holder Name, Bank Name and IFSC Code are required");
        return;
      }
      payload.account_number = draft.account_number.trim();
      payload.account_holder_name = draft.account_holder_name.trim();
      payload.bank_name = draft.bank_name.trim();
      payload.ifsc_code = draft.ifsc_code.trim();
    } else if (mode === "cheque") {
      if (!draft.bank_name.trim() || !draft.cheque_number.trim()) {
        toast.error("Bank Name and Cheque Number are required");
        return;
      }
      payload.bank_name = draft.bank_name.trim();
      payload.cheque_number = draft.cheque_number.trim();
    }

    setCollectingTreatmentFee(true);
    try {
      let lead = selectedLead;
      const scheduleExists = (lead.treatment_fee_payment_details?.installments || []).length > 0;
      if (!scheduleExists) {
        const schedulePayload = buildTreatmentFeePayload();
        if (!schedulePayload) {
          setCollectingTreatmentFee(false);
          return;
        }
        const res = await collectTreatmentFee(lead.id, schedulePayload);
        lead = res.lead;
      }
      await markInstallmentPaid(lead.id, draft.idx + 1, payload);
      const installments = (lead.treatment_fee_payment_details?.installments || []).map((inst, i) =>
        i === draft.idx ? { ...inst, paid: true, amount, payment_mode: mode } : inst
      );
      const updatedLead = { ...lead, treatment_fee_payment_details: { ...lead.treatment_fee_payment_details, installments } };
      toast.success(`Payment #${draft.idx + 1} collected`);
      setBoard((b) => ({ ...b, leads: (b.leads || []).map((l) => (l.id === updatedLead.id ? updatedLead : l)) }));
      setPartialCollectDraft(null);

      const stillOwed = installments.filter((i) => !i.paid);
      const thisInst = installments[draft.idx] || {};
      setReceipt(makeReceipt({
        lead: updatedLead, payload, prefix: `TF${draft.idx + 1}`,
        paidFor: `Treatment Fee · Payment #${draft.idx + 1} of ${installments.length}`,
        packageName: updatedLead.session_package_name
          ? `${updatedLead.session_package_name} · ${updatedLead.session_package_sessions || 0} sessions`
          : "",
        sessionsCovered: thisInst.sessions ? `${thisInst.sessions} sessions` : "",
        balanceDue: stillOwed.length
          ? `Rs.${stillOwed.reduce((s, i) => s + (i.amount || 0), 0)}${stillOwed[0]?.due_date ? ` · due ${stillOwed[0].due_date}` : ""}`
          : "",
      }));
      // The receipt above is the confirmation and closes on its own button, so the
      // patient stays open behind it — collecting one installment shouldn't throw the
      // admin out of the patient they're working on. The remaining balance and the
      // next due date are both on the Fee Collected panel they land back on.
      setCollectFeeDraft(null);
      setTreatmentFeeDraft(null);
      setSelectedLead(updatedLead);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to collect this installment");
    }
    setCollectingTreatmentFee(false);
  };

  // ---- Physio Assign (Branch Admin) — after fees are collected ----
  const openPhysioModal = async () => {
    setShowPhysioModal(true);
    setShowSlotPicker(false);
    setPhysioPick(selectedLead.assigned_physio_id || "");
    setPhysioCalendarData(null);
    setPickedSessionSlots([]);
    setPickerDate(null);
    setPickerMonth(new Date().getMonth());
    setPickerYear(new Date().getFullYear());
    try {
      const rows = await getDoctors({ branch_id: branchId });
      setPhysioOptions((rows || []).filter((d) => d.profile_type === "physio"));
    } catch {
      setPhysioOptions([]);
    }
  };

  // Load the picked physio's own calendar (same one managed at MANAGEMENT > PHYSIO
  // CALENDAR) so the slot picker can only ever offer times that physio has actually
  // published, and can grey out the ones another patient already holds.
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

  // How long one treatment session runs. Read from FITSIO STORE exactly the way PHYSIO
  // CALENDAR reads it, so the length shown here is always the length of the slots that
  // calendar actually publishes — one published slot is one treatment session.
  useEffect(() => {
    if (!showPhysioModal) return;
    let cancelled = false;
    listStoreItems(undefined, "session")
      .then((items) => {
        const configured = (items || []).map((i) => i.duration_minutes).find((d) => Number(d) > 0);
        if (!cancelled && configured) setSessionMinutes(Number(configured));
      })
      .catch(() => { /* keep the fallback */ });
    return () => { cancelled = true; };
  }, [showPhysioModal]);

  const totalSessionsNeeded = selectedLead?.session_package_sessions || 0;

  // A slot this same lead already holds (re-opening this for the physio they're already
  // assigned to) is still selectable — it'd just be re-booked as itself. Only someone
  // else's booking genuinely takes a slot off the table.
  const slotTakenByOther = useCallback((slot) => {
    const b = physioCalendarData?.booked?.[slot];
    return !!b && b.lead_id !== selectedLead?.id;
  }, [physioCalendarData, selectedLead]);

  // Every published slot of the picked physio, grouped by date, so the picker's month grid
  // can flag which days actually have availability and the day panel can list its times.
  const physioSlotsByDate = useMemo(() => {
    const map = {};
    for (const slot of physioCalendarData?.slots || []) {
      const [d, t] = slot.split("T");
      if (!d || !t) continue;
      (map[d] = map[d] || []).push(t);
    }
    Object.values(map).forEach((times) => times.sort());
    return map;
  }, [physioCalendarData]);

  const openSlotCount = useMemo(
    () => (physioCalendarData?.slots || []).filter((s) => !slotTakenByOther(s)).length,
    [physioCalendarData, slotTakenByOther],
  );

  // Re-opening this for the physio the lead is already with: start from the sessions they
  // already hold rather than a blank picker, so a reschedule only means moving the few
  // that actually change.
  useEffect(() => {
    if (!physioCalendarData || !selectedLead || physioPick !== selectedLead.assigned_physio_id) return;
    const seenDays = new Set();
    const mine = Object.entries(physioCalendarData.booked || {})
      .filter(([, b]) => b.lead_id === selectedLead.id)
      .map(([slot]) => slot)
      .sort()
      // Keep one a day, matching the rule the picker now enforces. Sessions booked before
      // that rule existed can sit several to a day; those extra days come back as unfixed
      // rather than being carried forward as a plan that could no longer be built here.
      .filter((slot) => {
        const day = slot.split("T")[0];
        if (seenDays.has(day)) return false;
        seenDays.add(day);
        return true;
      });
    if (mine.length === 0) return;
    setPickedSessionSlots((prev) => (prev.length === 0 ? mine.slice(0, selectedLead.session_package_sessions || 0) : prev));
  }, [physioCalendarData, physioPick, selectedLead]);

  const sortedPickedSlots = useMemo(() => [...pickedSessionSlots].sort(), [pickedSessionSlots]);
  const allSessionsPicked = totalSessionsNeeded > 0 && sortedPickedSlots.length === totalSessionsNeeded;

  // How much of this package the patient has actually paid for, in sessions. The Treatment
  // Fee can be collected for only some of the sessions up front (e.g. 6 of 9, balance due
  // later), and the picker has to say so — the last few treatment days are being scheduled
  // against money that hasn't come in yet.
  const sessionPayment = useMemo(() => {
    const total = totalSessionsNeeded;
    const price = selectedLead?.session_package_price || 0;
    const rate = total > 0 ? price / total : 0;
    const installments = selectedLead?.treatment_fee_payment_details?.installments || [];

    // No schedule on the record means it was collected in one go — every session is
    // covered. Deriving from the amount instead would mis-round a negotiated discount.
    if (installments.length === 0) {
      const paid = selectedLead?.treatment_fee_paid != null ? total : 0;
      return { total, paid, unpaid: total - paid, paidAmount: selectedLead?.treatment_fee_paid || 0, price, dueAmount: 0, dueDate: null };
    }

    // Each installment covers a number of sessions — recorded outright when the collection
    // was made per-session, otherwise taken from its share of the package price.
    const sessionsIn = (i) => (i.sessions != null ? i.sessions : rate ? i.amount / rate : 0);
    const paid = Math.min(total, Math.round(installments.filter((i) => i.paid).reduce((n, i) => n + sessionsIn(i), 0)));
    const outstanding = installments.filter((i) => !i.paid);
    return {
      total,
      paid,
      unpaid: total - paid,
      paidAmount: installments.filter((i) => i.paid).reduce((n, i) => n + (i.amount || 0), 0),
      price,
      dueAmount: outstanding.reduce((n, i) => n + (i.amount || 0), 0),
      dueDate: outstanding.map((i) => i.due_date).filter(Boolean).sort()[0] || null,
    };
  }, [selectedLead, totalSessionsNeeded]);

  // Days are numbered in date order, so the first `paid` of them are the ones covered.
  const isPaidSession = (dayNumber) => dayNumber <= sessionPayment.paid;

  // The plan itself: one treatment session per day, numbered Day 1, Day 2 … in date order
  // and stamped with the week it falls in — the same week rule the backend records, so a
  // "03 Week · 9 sessions" package reads as 3 weeks of 3 treatment days.
  const treatmentPlan = useMemo(() => {
    if (sortedPickedSlots.length === 0) return [];
    const firstDay = sortedPickedSlots[0].split("T")[0];
    return sortedPickedSlots.map((slot, i) => {
      const [date, time] = slot.split("T");
      return { slot, date, time, day: i + 1, week: weekOf(date, firstDay) };
    });
  }, [sortedPickedSlots]);

  const planByDate = useMemo(() => {
    const map = {};
    treatmentPlan.forEach((p) => { map[p.date] = p; });
    return map;
  }, [treatmentPlan]);

  /** The next date after `after` that still has an open slot and no session on it yet. */
  const nextOpenDateAfter = (after, alreadyFixed) => Object.keys(physioSlotsByDate)
    .filter((d) => d > after
      && !alreadyFixed.has(d)
      && physioSlotsByDate[d].some((t) => !slotTakenByOther(`${d}T${t}`)))
    .sort()[0];

  const togglePickedSlot = (slot) => {
    if (slotTakenByOther(slot)) return;
    const day = slot.split("T")[0];
    const prev = pickedSessionSlots;

    if (prev.includes(slot)) { setPickedSessionSlots(prev.filter((s) => s !== slot)); return; }

    // One treatment session a day — a 9-session package is 9 separate treatment days, not
    // 9 back-to-back slots. Picking another time on a day that already holds a session
    // moves that day's session rather than stacking a second one onto it.
    const sameDay = prev.find((s) => s.startsWith(`${day}T`));
    if (sameDay) { setPickedSessionSlots([...prev.filter((s) => s !== sameDay), slot]); return; }

    if (prev.length >= totalSessionsNeeded) {
      toast.error(`All ${totalSessionsNeeded} treatment days are already fixed — remove one first`);
      return;
    }
    const next = [...prev, slot];
    setPickedSessionSlots(next);

    // Fixing a day's time settles that day, so jump straight to the next date still
    // needing one — the whole plan gets laid out in a single run of clicks instead of
    // going back to the calendar between every session. Moving an already-fixed day
    // deliberately doesn't advance: that's a correction, and the result should stay in
    // view. Neither does the last one, so the finished plan can be checked over.
    if (next.length < totalSessionsNeeded) {
      const nextDate = nextOpenDateAfter(day, new Set(next.map((s) => s.split("T")[0])));
      if (nextDate) {
        const [y, m] = nextDate.split("-").map(Number);
        setPickerYear(y);
        setPickerMonth(m - 1);
        setPickerDate(nextDate);
      }
    }
  };

  // Opening the picker for the physio this lead is already with pre-loads the sessions
  // they already hold, so a reschedule starts from what's booked instead of a blank slate.
  const openSlotPickerFor = (physioId) => {
    setPhysioPick(physioId);
    setPickedSessionSlots(physioId === selectedLead?.assigned_physio_id ? pickedSessionSlots : []);
    setPickerDate(null);
    setShowSlotPicker(true);
  };

  const submitPhysioAssign = async () => {
    if (!physioPick) { toast.error("Choose a physio"); return; }
    if (!allSessionsPicked) {
      toast.error(`Pick a date and time for all ${totalSessionsNeeded} sessions (${sortedPickedSlots.length} placed so far)`);
      return;
    }
    setAssigningPhysio(true);
    try {
      const res = await assignPhysioWithSessions(selectedLead.id, { physio_id: physioPick, slot_times: sortedPickedSlots });
      toast.success(`Physio assigned — ${res.sessions_booked} sessions booked`);
      setShowSlotPicker(false);
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
        {!hideDateFilter && <DateFilterPopover value={dateFilter} onChange={setDateFilter} testid="cons-date-filter" />}
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
                    <td className="px-4 py-3 text-xs text-slate-500">{l.appointment_date ? `${l.appointment_date} ${l.appointment_time ? to12h(l.appointment_time) : ""}`.trim() : "—"}</td>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 sm:p-2" data-testid="cons-detail-dialog">
          <div className="w-full h-full sm:w-[96vw] sm:max-w-5xl sm:h-[calc(100vh-1rem)] overflow-y-auto space-y-3 bg-white p-5 shadow-2xl sm:rounded-xl">
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
                    <>· <Calendar className="ml-1 h-3 w-3" /> {selectedLead.appointment_date} {to12h(selectedLead.appointment_time)}</>
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
                              {treatmentPaid && !hasPendingInstallments && <span className="ml-1 capitalize text-emerald-600">({selectedLead.treatment_fee_payment_mode})</span>}
                              {hasPendingInstallments && <span className="ml-1 capitalize text-indigo-600">(partial)</span>}
                            </span>
                          </div>
                        </div>
                        {hasPendingInstallments ? (
                          // What's still owed and when it's due, with Collect right here —
                          // reopening a partially-paid patient is exactly when the rest
                          // gets taken, so it shouldn't need a trip through the schedule.
                          (() => {
                            const unpaid = savedInstallments.filter((i) => !i.paid);
                            const nextIdx = savedInstallments.findIndex((i) => !i.paid);
                            const next = savedInstallments[nextIdx] || {};
                            const balance = unpaid.reduce((s, i) => s + (i.amount || 0), 0);
                            const nextOverdue = !!next.due_date && next.due_date < new Date().toISOString().slice(0, 10);
                            return (
                              <>
                                <p className="mt-1 text-[11px] text-slate-500">
                                  {savedInstallments.filter((i) => i.paid).length} of {savedInstallments.length} installments collected.
                                </p>
                                <div className={`mt-2 rounded-md border px-2.5 py-2 ${nextOverdue ? "border-rose-200 bg-rose-50" : "border-amber-200 bg-amber-50"}`} data-testid="cons-partial-balance-summary">
                                  <div className="flex items-center justify-between">
                                    <span className={`text-[11px] font-semibold ${nextOverdue ? "text-rose-700" : "text-amber-700"}`}>Balance Amount</span>
                                    <span className={`text-sm font-bold ${nextOverdue ? "text-rose-700" : "text-amber-700"}`}>Rs.{balance}</span>
                                  </div>
                                  <p className={`mt-0.5 text-[10px] ${nextOverdue ? "text-rose-600" : "text-amber-600"}`}>
                                    Next · {partialInstallmentLabel(nextIdx)}
                                    {next.sessions ? ` · ${next.sessions} sessions` : ""}
                                    {next.amount != null ? ` · Rs.${next.amount}` : ""}
                                    {next.due_date ? ` · due ${next.due_date}` : ""}
                                    {nextOverdue ? " · OVERDUE" : ""}
                                  </p>
                                </div>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  <Button size="sm" className="bg-emerald-600 text-xs hover:bg-emerald-700" onClick={() => openPartialCollectPopup(nextIdx)} data-testid="cons-collect-next-installment">
                                    Collect Rs.{next.amount ?? balance}
                                  </Button>
                                  <Button size="sm" variant="outline" className="text-xs" onClick={openPartialScheduleDraft} data-testid="cons-open-partial-schedule-sidebar">
                                    View Payment Schedule
                                  </Button>
                                </div>
                              </>
                            );
                          })()
                        ) : treatmentPaid ? (
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
                      selectedLead.treatment_fee_paid != null && !hasPendingInstallments ? "border-emerald-200 bg-emerald-50"
                      : selectedLead.package_paid == null ? "border-slate-200 bg-slate-50"
                      : "border-indigo-200 bg-indigo-50/40"
                    }`}>
                      <p className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider ${
                        selectedLead.treatment_fee_paid != null && !hasPendingInstallments ? "text-emerald-700"
                        : selectedLead.package_paid == null ? "text-slate-400"
                        : "text-indigo-700"
                      }`}>
                        <Dumbbell className="h-3.5 w-3.5" /> Treatment Fee
                      </p>
                      {selectedLead.package_paid == null ? (
                        <p className="text-xs text-slate-500" data-testid="cons-treatment-fee-gated">
                          Collect the Consultation Fee above first — Treatment Fee unlocks once it's paid.
                        </p>
                      ) : hasPendingInstallments ? (
                        <div data-testid="cons-treatment-fee-partial-pending">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-xs text-slate-500">Treatment Fee</span>
                            <span className="font-semibold text-slate-800">
                              Rs.{selectedLead.session_package_price}
                              <span className="ml-1 capitalize text-indigo-600">(partial)</span>
                            </span>
                          </div>
                          <p className="mt-1 text-[11px] text-slate-500">
                            {savedInstallments.filter((i) => i.paid).length} of {savedInstallments.length} installments collected.
                          </p>
                          <Button size="sm" className="mt-2 bg-indigo-600 text-xs hover:bg-indigo-700" onClick={openPartialScheduleDraft} data-testid="cons-open-partial-schedule">
                            View Payment Schedule
                          </Button>
                        </div>
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
                        onCollectRow={openPartialCollectPopup}
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

            {/* Collect Payment #N — the Partial Payment schedule's own per-row Collect
                popup, opened from PartialInstallmentsEditor above. Layered above the
                Partial Payment Schedule popup itself (z-[80] > z-[70]) since that's
                where the row it belongs to is rendered. */}
            {partialCollectDraft && (() => {
              const mode = partialCollectDraft.payment_mode;
              const modeLabel = INSTALLMENT_PAYMENT_MODES.find((m) => m.value === mode)?.label || "";
              return (
                <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" data-testid="cons-partial-collect-modal">
                  <div className="max-h-[90vh] w-full max-w-sm space-y-3 overflow-y-auto rounded-xl bg-white p-4 shadow-2xl">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-slate-800">Collect {partialInstallmentLabel(partialCollectDraft.idx)}</p>
                      <button onClick={() => setPartialCollectDraft(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100" data-testid="cons-partial-collect-close"><X className="h-4 w-4" /></button>
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-slate-500">Amount (₹) *</label>
                      <Input
                        type="number"
                        min="0"
                        value={partialCollectDraft.amount}
                        onChange={(e) => setPartialCollectDraft({ ...partialCollectDraft, amount: e.target.value })}
                        className="h-9"
                        data-testid="cons-partial-collect-amount"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-slate-500">Payment Mode</label>
                      <PaymentModeSelect
                        value={mode}
                        options={INSTALLMENT_PAYMENT_MODES}
                        onChange={(v) => setPartialCollectDraft({ ...partialCollectDraft, payment_mode: v })}
                        testId="cons-partial-collect-mode"
                      />
                    </div>

                    {mode === "upi" && (
                      <>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">UPI Transaction ID</label>
                          <Input
                            value={partialCollectDraft.upi_transaction_id}
                            onChange={(e) => setPartialCollectDraft({ ...partialCollectDraft, upi_transaction_id: e.target.value })}
                            className="h-9"
                            data-testid="cons-partial-collect-upi-txn"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">UTR</label>
                          <Input
                            value={partialCollectDraft.upi_utr}
                            onChange={(e) => setPartialCollectDraft({ ...partialCollectDraft, upi_utr: e.target.value })}
                            className="h-9"
                            data-testid="cons-partial-collect-upi-utr"
                          />
                        </div>
                      </>
                    )}

                    {mode === "card" && (
                      <>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">Account Number</label>
                          <Input
                            value={partialCollectDraft.account_number}
                            onChange={(e) => setPartialCollectDraft({ ...partialCollectDraft, account_number: e.target.value })}
                            className="h-9"
                            data-testid="cons-partial-collect-account-number"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">Account Holder Name</label>
                          <Input
                            value={partialCollectDraft.account_holder_name}
                            onChange={(e) => setPartialCollectDraft({ ...partialCollectDraft, account_holder_name: e.target.value })}
                            className="h-9"
                            data-testid="cons-partial-collect-account-holder"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">Bank Name</label>
                          <Input
                            value={partialCollectDraft.bank_name}
                            onChange={(e) => setPartialCollectDraft({ ...partialCollectDraft, bank_name: e.target.value })}
                            className="h-9"
                            data-testid="cons-partial-collect-bank-name"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">IFSC Code</label>
                          <Input
                            value={partialCollectDraft.ifsc_code}
                            onChange={(e) => setPartialCollectDraft({ ...partialCollectDraft, ifsc_code: e.target.value.toUpperCase() })}
                            className="h-9"
                            data-testid="cons-partial-collect-ifsc"
                          />
                        </div>
                      </>
                    )}

                    {mode === "cheque" && (
                      <>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">Bank Name</label>
                          <Input
                            value={partialCollectDraft.bank_name}
                            onChange={(e) => setPartialCollectDraft({ ...partialCollectDraft, bank_name: e.target.value })}
                            className="h-9"
                            data-testid="cons-partial-collect-cheque-bank-name"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">Cheque Number</label>
                          <Input
                            value={partialCollectDraft.cheque_number}
                            onChange={(e) => setPartialCollectDraft({ ...partialCollectDraft, cheque_number: e.target.value })}
                            className="h-9"
                            data-testid="cons-partial-collect-cheque-number"
                          />
                        </div>
                      </>
                    )}

                    <Button
                      className="w-full bg-emerald-600 text-xs hover:bg-emerald-700"
                      onClick={submitPartialCollect}
                      disabled={
                        collectingTreatmentFee ||
                        !(parseFloat(partialCollectDraft.amount) > 0) ||
                        (mode === "card" && (!partialCollectDraft.account_number.trim() || !partialCollectDraft.account_holder_name.trim() || !partialCollectDraft.bank_name.trim() || !partialCollectDraft.ifsc_code.trim())) ||
                        (mode === "cheque" && (!partialCollectDraft.bank_name.trim() || !partialCollectDraft.cheque_number.trim()))
                      }
                      data-testid="cons-partial-collect-submit"
                    >
                      {collectingTreatmentFee ? "Saving..." : `Collect ${modeLabel} Payment`}
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

                  <p className="text-[11px] text-slate-500">Available physios in this branch — pick one to choose their treatment dates</p>

                  {physioOptions.length === 0 ? (
                    <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-400">No physios found for this branch yet.</p>
                  ) : (
                    <div className="max-h-40 space-y-1.5 overflow-y-auto">
                      {physioOptions.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => openSlotPickerFor(p.id)}
                          className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-xs font-semibold transition ${
                            physioPick === p.id ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                          }`}
                          data-testid={`cons-physio-option-${p.id}`}
                        >
                          <span>{p.full_name}{p.specialization ? ` · ${p.specialization}` : ""}</span>
                          <span className="flex items-center gap-1.5 shrink-0">
                            {physioPick === p.id && <CheckCircle2 className="h-3.5 w-3.5" />}
                            <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {physioPick && sortedPickedSlots.length > 0 && (
                    <div className="rounded-lg border border-violet-200 bg-violet-50 p-3" data-testid="cons-physio-sessions-preview">
                      <div className="mb-1.5 flex items-center justify-between">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-violet-700">Treatment days fixed</p>
                        <button
                          type="button"
                          onClick={() => setShowSlotPicker(true)}
                          className="text-[11px] font-semibold text-violet-600 underline underline-offset-2 hover:text-violet-800"
                          data-testid="cons-physio-change-slots"
                        >
                          Change
                        </button>
                      </div>
                      <div className="max-h-28 space-y-1 overflow-y-auto text-xs" data-testid="cons-physio-sessions-list">
                        {treatmentPlan.map((p) => (
                          <p key={p.slot} className={isPaidSession(p.day) ? "text-emerald-700" : "text-rose-700"}>
                            <b>Day {p.day}</b> · {dayLabel(p.date)} · {to12h(p.time)} – {endTime12h(p.time, sessionMinutes)}
                            <span className="ml-1 font-bold">{isPaidSession(p.day) ? "PAID" : "UNPAID"}</span>
                          </p>
                        ))}
                      </div>
                    </div>
                  )}

                  <Button
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-xs"
                    onClick={() => (allSessionsPicked ? submitPhysioAssign() : setShowSlotPicker(true))}
                    disabled={assigningPhysio || !physioPick}
                    data-testid="cons-physio-submit"
                  >
                    {assigningPhysio
                      ? "Assigning..."
                      : allSessionsPicked
                      ? `Assign & Book ${totalSessionsNeeded} Sessions`
                      : "Choose Treatment Dates & Times"}
                  </Button>
                </div>
              </div>
            )}

            {/* Step 2 — Treatment date & time picker, driven entirely by the picked physio's
                own PHYSIO CALENDAR. Every session of the package gets a date and a time the
                Branch Admin fixes by hand; nothing is auto-filled, and only slots that physio
                has actually published are offered. */}
            {showPhysioModal && showSlotPicker && physioPick && (
              <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-2" data-testid="cons-slot-picker-modal">
                <div className="flex h-[calc(100vh-1rem)] max-h-[calc(100vh-1rem)] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
                  <div className="flex items-center justify-between bg-gradient-to-r from-violet-600 to-indigo-600 px-6 py-4 text-white">
                    <div className="flex items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/20 text-lg font-bold text-white">
                        {(physioCalendarData?.doctor_name || physioOptions.find((p) => p.id === physioPick)?.full_name || "P").charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-lg font-semibold" data-testid="cons-slot-picker-physio">
                          {selectedLead.name} <span className="font-normal text-white/70">with</span>{" "}
                          {physioCalendarData?.doctor_name || physioOptions.find((p) => p.id === physioPick)?.full_name || "Physio"}
                        </p>
                        <p className="text-[13px] text-white/75">
                          {selectedLead.session_package_name || "Session package"} · {totalSessionsNeeded} sessions ·
                          {" "}one session a day · {sessionMinutes} min each · {openSlotCount} slots open
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {/* Same bordered-box treatment as the PAID / UNPAID status badges below,
                          in dark green so it reads as the popup's headline status. */}
                      <span
                        className="rounded-lg border-2 border-emerald-900 bg-emerald-700 px-4 py-2 text-sm font-bold text-white shadow-sm"
                        data-testid="cons-slot-picker-count"
                      >
                        {sortedPickedSlots.length} of {totalSessionsNeeded} treatment days fixed
                      </span>
                      <button onClick={() => setShowSlotPicker(false)} className="rounded-full p-1.5 text-white/80 hover:bg-white/20" data-testid="cons-slot-picker-close">
                        <X className="h-5 w-5" />
                      </button>
                    </div>
                  </div>

                  {/* Treatment Fee standing — which of these treatment days are actually paid
                      for. The balance sessions still get scheduled, but they're marked unpaid
                      so nobody books them believing the money is in. */}
                  <div className="flex flex-wrap items-center gap-3 border-b-2 border-slate-200 bg-slate-100 px-6 py-3.5" data-testid="cons-slot-picker-payment">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Treatment Fee</span>
                    <span className="rounded-lg border-2 border-emerald-400 bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-700 shadow-sm" data-testid="cons-payment-paid">
                      {sessionPayment.paid} session{sessionPayment.paid === 1 ? "" : "s"} PAID
                      {sessionPayment.paidAmount > 0 && <span className="ml-2 font-semibold text-emerald-600">Rs.{sessionPayment.paidAmount}</span>}
                      {sessionPayment.paid > 0 && <span className="ml-2 font-medium text-emerald-500">Day 1–{sessionPayment.paid}</span>}
                    </span>
                    {sessionPayment.unpaid > 0 ? (
                      <span className="rounded-lg border-2 border-rose-400 bg-rose-50 px-4 py-2 text-sm font-bold text-rose-700 shadow-sm" data-testid="cons-payment-unpaid">
                        {sessionPayment.unpaid} session{sessionPayment.unpaid === 1 ? "" : "s"} UNPAID
                        {sessionPayment.dueAmount > 0 && <span className="ml-2 font-semibold text-rose-600">Rs.{sessionPayment.dueAmount}</span>}
                        <span className="ml-2 font-medium text-rose-500">
                          Day {sessionPayment.paid + 1}–{sessionPayment.total}
                          {sessionPayment.dueDate ? ` · due ${dayLabel(sessionPayment.dueDate)}` : ""}
                        </span>
                      </span>
                    ) : (
                      <span className="rounded-lg border-2 border-emerald-400 bg-emerald-100 px-4 py-2 text-sm font-bold text-emerald-800 shadow-sm">
                        Package fully paid
                      </span>
                    )}
                    {sessionPayment.price > 0 && (
                      <span className="ml-auto text-[13px] font-bold text-slate-600">
                        Rs.{sessionPayment.paidAmount} of Rs.{sessionPayment.price} collected
                      </span>
                    )}
                  </div>

                  {loadingPhysioCalendar ? (
                    <p className="px-5 py-14 text-center text-sm text-slate-400">Loading this physio's calendar...</p>
                  ) : (
                    <div className="flex flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
                      {/* Month grid — a dot marks a day this physio has published slots on */}
                      <div className="w-full flex-shrink-0 border-b border-slate-100 p-5 lg:w-[25rem] lg:border-b-0 lg:border-r lg:overflow-y-auto">
                        <div className="mb-3 flex items-center justify-between">
                          <button
                            type="button"
                            onClick={() => (pickerMonth === 0 ? (setPickerMonth(11), setPickerYear(pickerYear - 1)) : setPickerMonth(pickerMonth - 1))}
                            className="rounded p-1 hover:bg-slate-100"
                            data-testid="cons-slot-prev-month"
                          >
                            <ChevronLeft className="h-5 w-5 text-slate-500" />
                          </button>
                          <h4 className="text-base font-bold text-slate-700">{MONTH_NAMES[pickerMonth]} {pickerYear}</h4>
                          <button
                            type="button"
                            onClick={() => (pickerMonth === 11 ? (setPickerMonth(0), setPickerYear(pickerYear + 1)) : setPickerMonth(pickerMonth + 1))}
                            className="rounded p-1 hover:bg-slate-100"
                            data-testid="cons-slot-next-month"
                          >
                            <ChevronRight className="h-5 w-5 text-slate-500" />
                          </button>
                        </div>

                        <div className="mb-1 grid grid-cols-7 gap-1">
                          {WEEKDAY_LABELS.map((d) => (
                            <div key={d} className="py-1 text-center text-[13px] font-semibold text-slate-400">{d}</div>
                          ))}
                        </div>

                        <div className="grid grid-cols-7 gap-1">
                          {Array.from({ length: new Date(pickerYear, pickerMonth, 1).getDay() }, (_, i) => (
                            <div key={`pad-${i}`} className="h-12" />
                          ))}
                          {Array.from({ length: new Date(pickerYear, pickerMonth + 1, 0).getDate() }, (_, i) => {
                            const day = i + 1;
                            const d = isoDate(pickerYear, pickerMonth, day);
                            const dayOpen = (physioSlotsByDate[d] || []).filter((t) => !slotTakenByOther(`${d}T${t}`)).length;
                            const planned = planByDate[d];
                            const isFocused = pickerDate === d;
                            return (
                              <button
                                key={day}
                                type="button"
                                onClick={() => setPickerDate(d)}
                                disabled={dayOpen === 0 && !planned}
                                className={`relative h-12 rounded-lg text-base font-semibold transition-all ${
                                  isFocused
                                    ? "bg-violet-600 text-white shadow-md ring-2 ring-violet-300 ring-offset-1"
                                    : planned
                                    ? isPaidSession(planned.day)
                                      ? "border border-emerald-300 bg-emerald-50 text-emerald-700"
                                      : "border border-rose-300 bg-rose-50 text-rose-700"
                                    : dayOpen > 0
                                    ? "text-slate-600 hover:bg-slate-100"
                                    : "cursor-not-allowed text-slate-300"
                                }`}
                                title={planned
                                  ? `Day ${planned.day} · ${to12h(planned.time)} · ${isPaidSession(planned.day) ? "paid" : "unpaid"}`
                                  : dayOpen > 0 ? `${dayOpen} slot${dayOpen > 1 ? "s" : ""} open` : "No slots published"}
                                data-testid={`cons-slot-day-${day}`}
                              >
                                {day}
                                {planned ? (
                                  <span className={`absolute -right-1 -top-1 flex h-[1.3rem] min-w-[1.3rem] items-center justify-center rounded-full px-1 text-[11px] font-bold shadow-sm ${
                                    isPaidSession(planned.day) ? "bg-emerald-500 text-white" : "bg-rose-500 text-white"
                                  }`}>
                                    {planned.day}
                                  </span>
                                ) : dayOpen > 0 && !isFocused ? (
                                  <span className="absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-emerald-400" />
                                ) : null}
                              </button>
                            );
                          })}
                        </div>

                        <div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
                          <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-slate-500">
                            <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-full bg-emerald-500" /> Paid day</span>
                            <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-full bg-rose-500" /> Unpaid day</span>
                            <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" /> Slots open</span>
                          </div>
                          <p className="text-[13px] text-slate-400">
                            One treatment session a day — {totalSessionsNeeded} sessions means {totalSessionsNeeded} separate
                            days. Only days this physio has opened in <b>PHYSIO CALENDAR</b> can be picked. Pick a
                            time and it <b>jumps to the next open date</b> on its own, so the plan is laid out in one
                            run. Picking another time on a day already fixed <b>moves</b> that day's session and stays put.
                          </p>
                        </div>
                      </div>

                      {/* Times published on the focused date */}
                      <div className="flex-1 overflow-y-auto p-4">
                        {!pickerDate ? (
                          <div className="flex h-full items-center justify-center">
                            <div className="text-center">
                              <Calendar className="mx-auto mb-2 h-10 w-10 text-slate-200" />
                              <p className="text-sm text-slate-400">Pick a treatment date to see this physio's open times</p>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                              <h4 className="text-lg font-bold text-slate-800" data-testid="cons-slot-picker-date">{longDate(pickerDate)}</h4>
                              <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-slate-400">
                                <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-400" /> Open</span>
                                <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-600" /> Paid day</span>
                                <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-rose-500" /> Unpaid day</span>
                                <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-400" /> Booked</span>
                              </div>
                            </div>

                            {planByDate[pickerDate] && (
                              <p
                                className={`mb-3 rounded-lg border-2 px-4 py-2.5 text-sm font-semibold shadow-sm ${
                                  isPaidSession(planByDate[pickerDate].day)
                                    ? "border-emerald-400 bg-emerald-50 text-emerald-800"
                                    : "border-rose-400 bg-rose-50 text-rose-800"
                                }`}
                                data-testid="cons-slot-day-fixed"
                              >
                                <b>Day {planByDate[pickerDate].day}</b> is fixed for {to12h(planByDate[pickerDate].time)} – {endTime12h(planByDate[pickerDate].time, sessionMinutes)} ·{" "}
                                {isPaidSession(planByDate[pickerDate].day) ? "PAID" : "UNPAID"}.
                                <span className="ml-1 font-normal">Pick another time to move it, or click it again to free the day.</span>
                              </p>
                            )}

                            {(physioSlotsByDate[pickerDate] || []).length === 0 ? (
                              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-8 text-center text-sm text-slate-400">
                                Nothing published on this day — open it in MANAGEMENT → PHYSIO CALENDAR first.
                              </p>
                            ) : (
                              <div className="grid grid-cols-2 gap-2 lg:grid-cols-3" data-testid="cons-slot-picker-grid">
                                {(physioSlotsByDate[pickerDate] || []).map((time) => {
                                  const slot = `${pickerDate}T${time}`;
                                  const taken = slotTakenByOther(slot);
                                  const picked = planByDate[pickerDate]?.slot === slot;
                                  const pickedPaid = picked && isPaidSession(planByDate[pickerDate].day);
                                  return (
                                    <button
                                      key={time}
                                      type="button"
                                      onClick={() => togglePickedSlot(slot)}
                                      disabled={taken}
                                      className={`rounded-lg border-2 p-3 text-left transition-all ${
                                        taken
                                          ? "cursor-not-allowed border-amber-300 bg-amber-50 opacity-70"
                                          : picked
                                          ? pickedPaid
                                            ? "border-emerald-500 bg-emerald-100 shadow-md ring-2 ring-emerald-200"
                                            : "border-rose-400 bg-rose-100 shadow-md ring-2 ring-rose-200"
                                          : "border-emerald-200 bg-emerald-50 hover:border-emerald-400 hover:shadow-sm"
                                      }`}
                                      data-testid={`cons-slot-pick-${time}`}
                                    >
                                      <div className="flex items-center justify-between gap-1">
                                        <span className={`text-base font-bold ${taken ? "text-amber-800" : picked ? (pickedPaid ? "text-emerald-900" : "text-rose-900") : "text-emerald-800"}`}>
                                          {to12h(time)}
                                        </span>
                                        {picked && (
                                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold text-white ${pickedPaid ? "bg-emerald-600" : "bg-rose-600"}`}>
                                            Day {planByDate[pickerDate].day}
                                          </span>
                                        )}
                                      </div>
                                      <p className={`mt-0.5 text-xs font-medium ${taken ? "truncate text-amber-600" : picked ? (pickedPaid ? "text-emerald-700" : "text-rose-700") : "text-emerald-600"}`}>
                                        {taken
                                          ? `Booked · ${physioCalendarData?.booked?.[slot]?.lead_name || "—"}`
                                          : picked
                                          ? `ends ${endTime12h(time, sessionMinutes)} · ${pickedPaid ? "PAID" : "UNPAID"}`
                                          : `ends ${endTime12h(time, sessionMinutes)}`}
                                      </p>
                                    </button>
                                  );
                                })}
                              </div>
                            )}

                            {treatmentPlan.length > 0 && (
                              <div className="mt-4 rounded-xl border-2 border-violet-200 bg-violet-50/70 p-4" data-testid="cons-treatment-plan">
                                <div className="mb-2 flex items-center justify-between">
                                  <p className="text-sm font-bold uppercase tracking-wider text-violet-700">Treatment plan</p>
                                  <button
                                    type="button"
                                    onClick={() => setPickedSessionSlots([])}
                                    className="text-[13px] font-bold text-rose-600 hover:text-rose-800"
                                    data-testid="cons-slot-picker-clear"
                                  >
                                    Clear all
                                  </button>
                                </div>
                                {/* Grouped the way the package is sold — "03 Week · 9 sessions" reads back
                                    as 3 weeks of treatment days, each day one session. Each day carries
                                    whether the Treatment Fee actually covers it. */}
                                <div className="max-h-48 space-y-2.5 overflow-y-auto">
                                  {[...new Set(treatmentPlan.map((p) => p.week))].map((week) => (
                                    <div key={week}>
                                      <p className="mb-1 text-xs font-bold uppercase tracking-wider text-violet-500">Week {week}</p>
                                      <div className="flex flex-wrap gap-1.5">
                                        {treatmentPlan.filter((p) => p.week === week).map((p) => {
                                          const paid = isPaidSession(p.day);
                                          return (
                                            <button
                                              key={p.slot}
                                              type="button"
                                              onClick={() => togglePickedSlot(p.slot)}
                                              className={`flex items-center gap-1.5 rounded-full border-2 bg-white px-3 py-1.5 text-xs font-bold transition ${
                                                paid
                                                  ? "border-emerald-300 text-emerald-700 hover:border-emerald-500"
                                                  : "border-rose-300 text-rose-700 hover:border-rose-500"
                                              }`}
                                              title={`Remove this treatment day · ${paid ? "paid" : "unpaid"}`}
                                              data-testid={`cons-slot-picked-${p.slot}`}
                                            >
                                              <span className={`rounded-full px-2 py-0.5 text-[11px] text-white ${paid ? "bg-emerald-600" : "bg-rose-600"}`}>Day {p.day}</span>
                                              {dayLabel(p.date)} · {to12h(p.time)} – {endTime12h(p.time, sessionMinutes)}
                                              <span className={`font-extrabold ${paid ? "text-emerald-600" : "text-rose-600"}`}>{paid ? "PAID" : "UNPAID"}</span>
                                              <X className="h-3.5 w-3.5" />
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-3 border-t-2 border-slate-200 bg-slate-100 px-6 py-4">
                    <div className="text-[13px] text-slate-500">
                      <p className="font-bold text-slate-700">
                        {allSessionsPicked
                          ? `All ${totalSessionsNeeded} treatment days are fixed${treatmentPlan.length > 0 ? ` · ${dayLabel(treatmentPlan[0].date)} to ${dayLabel(treatmentPlan[treatmentPlan.length - 1].date)}` : ""}.`
                          : `${totalSessionsNeeded - sortedPickedSlots.length} more treatment day${totalSessionsNeeded - sortedPickedSlots.length === 1 ? "" : "s"} still need a date and time.`}
                      </p>
                      {sessionPayment.unpaid > 0 && (
                        <p className="mt-1 font-bold text-rose-600" data-testid="cons-slot-picker-unpaid-note">
                          Day {sessionPayment.paid + 1}–{sessionPayment.total} are booked against an unpaid balance of Rs.{sessionPayment.dueAmount}
                          {sessionPayment.dueDate ? ` · due ${dayLabel(sessionPayment.dueDate)}` : ""}.
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" className="text-sm" onClick={() => setShowSlotPicker(false)} data-testid="cons-slot-picker-back">
                        Back
                      </Button>
                      <Button
                        className="bg-emerald-600 text-sm hover:bg-emerald-700"
                        onClick={submitPhysioAssign}
                        disabled={assigningPhysio || !allSessionsPicked}
                        data-testid="cons-slot-picker-submit"
                      >
                        {assigningPhysio ? "Assigning..." : `Assign & Book ${totalSessionsNeeded} Sessions`}
                      </Button>
                    </div>
                  </div>
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

      {/* Payment receipt — the acknowledgement the client is handed. Rendered here rather
          than inside the lead dialog because collecting the last outstanding fee closes
          that dialog, and the receipt has to outlive it. */}
      {receipt && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-3" data-testid="cons-receipt-modal">
          <div className="flex max-h-[94vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className={`flex items-start justify-between gap-3 px-6 py-4 text-white ${isSchedule(receipt) ? "bg-amber-600" : "bg-emerald-600"}`}>
              <div className="flex min-w-0 items-center gap-3">
                <img src={LOGO_URL} alt="FITSIOMAX" className="h-11 w-11 shrink-0 rounded-lg bg-white/90 object-contain p-1" />
                <div className="min-w-0">
                  <p className="text-lg font-bold">{isSchedule(receipt) ? "Payment Schedule Created" : "Payment Received"}</p>
                  <p className="truncate text-xs text-white/80">{isSchedule(receipt) ? "Reference" : "Receipt"} {receipt.receiptNo}</p>
                </div>
              </div>
              <button onClick={() => setReceipt(null)} className="shrink-0 rounded-full p-1.5 text-white/80 hover:bg-white/20" data-testid="cons-receipt-close">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <div className="mb-4 flex items-center justify-center gap-2 text-center">
                <img src={LOGO_URL} alt="" className="h-7 w-7 object-contain" />
                <div className="text-left">
                  <p className="text-base font-extrabold tracking-wide text-slate-800">FITSIOMAX</p>
                  <p className="text-[10px] text-slate-400">{receipt.branch || "Physiotherapy & Rehabilitation"}</p>
                </div>
              </div>

              <div className={`rounded-xl border-2 px-4 py-5 text-center ${isSchedule(receipt) ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
                <p className={`text-xs font-bold uppercase tracking-widest ${isSchedule(receipt) ? "text-amber-600" : "text-emerald-600"}`}>
                  {isSchedule(receipt) ? "Total Payable" : "Amount Paid"}
                </p>
                <p className={`mt-1 text-4xl font-extrabold ${isSchedule(receipt) ? "text-amber-700" : "text-emerald-700"}`} data-testid="cons-receipt-amount">Rs.{receipt.amount}</p>
                <p className={`mt-1 text-sm font-semibold ${isSchedule(receipt) ? "text-amber-600" : "text-emerald-600"}`}>{receipt.modeLabel}</p>
                {isSchedule(receipt) && (
                  <p className="mt-2 text-xs font-medium text-amber-700">Nothing collected yet — each installment gets its own receipt.</p>
                )}
              </div>

              <dl className="mt-5 space-y-2 text-sm">
                {receiptRows(receipt).map(([k, v]) => (
                  <div key={k} className="flex items-start justify-between gap-3 border-b border-slate-100 pb-2">
                    <dt className="text-slate-500">{k}</dt>
                    <dd className={`text-right font-semibold ${
                      k === "Amount Paid" ? "text-emerald-700"
                      : k === "Total Payable" ? "text-amber-700"
                      : k === "Discount" ? "text-rose-600"
                      : k === "Balance Due" ? "text-rose-600"
                      : "text-slate-700"}`}>{v}</dd>
                  </div>
                ))}
              </dl>

              {receipt.installments.length > 0 && (
                <div className="mt-5">
                  <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">Installments</p>
                  <div className="space-y-1.5">
                    {receipt.installments.map((i, n) => (
                      <div key={n} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-xs">
                        <span className="text-slate-600">
                          #{n + 1}{i.sessions ? ` · ${i.sessions} sessions` : ""} · due {i.due_date || "—"}
                        </span>
                        <span className={`font-bold ${i.paid ? "text-emerald-600" : "text-amber-600"}`}>
                          Rs.{i.amount}{i.paid ? " · PAID" : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2 border-t border-slate-200 bg-slate-50 px-6 py-4">
              {/* Cash needs a bill in hand, so Print leads. Everything else already left a
                  trail with the bank, so sharing the receipt is the more useful default. */}
              <div className="grid grid-cols-2 gap-2">
                <Button
                  className={receipt.isCash ? "bg-emerald-600 text-white hover:bg-emerald-700" : ""}
                  variant={receipt.isCash ? undefined : "outline"}
                  onClick={() => printReceipt(receipt)}
                  data-testid="cons-receipt-print"
                >
                  <Printer className="mr-1.5 h-4 w-4" /> {isSchedule(receipt) ? "Print Schedule" : "Print Bill"}
                </Button>
                <Button
                  className={receipt.isCash ? "" : "bg-emerald-600 text-white hover:bg-emerald-700"}
                  variant={receipt.isCash ? "outline" : undefined}
                  onClick={() => shareReceipt(receipt)}
                  data-testid="cons-receipt-share"
                >
                  <Share2 className="mr-1.5 h-4 w-4" /> Share
                </Button>
              </div>
              <Button variant="outline" className="w-full" onClick={() => downloadReceipt(receipt)} data-testid="cons-receipt-download">
                <Download className="mr-1.5 h-4 w-4" /> {isSchedule(receipt) ? "Download Schedule" : "Download Receipt"}
              </Button>
              <Button variant="ghost" className="w-full text-slate-500" onClick={() => setReceipt(null)} data-testid="cons-receipt-done">
                Done
              </Button>
            </div>
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
        const overdue = !!inst.due_date && inst.due_date < todayIso;
        const isPaid = !!inst.paid;
        return (
          <div key={idx} className="flex items-end gap-1.5" data-testid={`cons-treatment-fee-partial-row-${idx}`}>
            <div className="flex-1">
              <label className="mb-1 block text-[11px] font-medium text-slate-500">{partialInstallmentLabel(idx)} Sessions *</label>
              <Input
                type="number"
                min="1"
                max={totalSessions || undefined}
                value={inst.sessions}
                disabled={isPaid}
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
                disabled={isPaid}
                onChange={(e) => {
                  const next = [...installments];
                  next[idx] = { ...next[idx], due_date: e.target.value };
                  setInstallments(next);
                }}
                className="h-9"
                data-testid={`cons-treatment-fee-partial-date-${idx}`}
              />
            </div>
            {isPaid ? (
              <Button
                size="sm"
                disabled
                className="h-9 bg-emerald-600 text-xs text-white hover:bg-emerald-600 disabled:!opacity-100"
                data-testid={`cons-treatment-fee-partial-paid-${idx}`}
              >
                <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Paid
              </Button>
            ) : (
              // The due date is when the money is expected, not the only day it can be
              // taken — a patient who walks in early still has to be collectable, so Due
              // is a state the row wears, not a lock on the button beside it.
              <>
                <span
                  className={`mb-1.5 shrink-0 rounded-md px-2 py-1 text-[10px] font-bold ${
                    overdue ? "bg-rose-100 text-rose-700" : isToday ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"
                  }`}
                  data-testid={`cons-treatment-fee-partial-due-${idx}`}
                >
                  {overdue ? "OVERDUE" : isToday ? "DUE TODAY" : "DUE"}
                </span>
                <Button
                  size="sm"
                  onClick={() => onCollectRow(idx)}
                  disabled={collecting || !allFilled || mismatch}
                  className="h-9 bg-emerald-600 text-xs hover:bg-emerald-700"
                  data-testid={`cons-treatment-fee-partial-collect-${idx}`}
                >
                  Collect
                </Button>
              </>
            )}
            {installments.length > 2 && !isPaid && (
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
