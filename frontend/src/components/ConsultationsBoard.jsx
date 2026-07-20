import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Calendar, CheckCircle2, ChevronRight, RefreshCw, XCircle, Search, Phone, Stethoscope, ClipboardList, Lock, Pencil, Dumbbell, Users, X, Bell } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { StageTabBar } from "@/components/ui/stage-tab";
import {
  getConsultationsBoard, moveConsultationStage, moveHeadConsultationStage, listStoreItems,
  assignPackage, collectPackagePayment, collectTreatmentFee, savePhysioDiagnosis, unlockPhysioDiagnosis,
  saveTreatmentSummary, unlockTreatmentSummary, stagesList, getDoctors,
  assignConsultationPhysio,
  scheduleConsultationFollowUp, rescheduleConsultationFollowUp,
  getLeadRemarks, getLeadActivity,
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
  { value: "emi", label: "EMI" },
  { value: "partial", label: "Partial Payment" },
];

// This Branch Consultation stage name is mirrored (read-only) from the Head Physio's
// own independent pipeline — Branch Admin can see it but not click it. Consultation
// Pack is chosen inline in Head Physio's own popup (not a stage move) and Physio
// Assign is Branch Admin's own actionable stage now, so neither is mirrored/locked.
const MIRRORED_HEAD_STAGE_NAMES = ["Consultation Visit"];

export const ConsultationsBoard = ({ branchId, viewerRole }) => {
  const isConsultant = viewerRole === "head_physio";
  // Head Physio tracks progress on their own independent pipeline (head_consultation_stage),
  // fully separate from Branch's own consultation_stage pipeline.
  const stageField = isConsultant ? "head_consultation_stage" : "consultation_stage";
  const [board, setBoard] = useState({ leads: [], stage_counts: {} });
  const [stages, setStages] = useState([]); // dynamic Consultation Stages, from Super Admin > Pipeline Stage Management
  const [stageFilter, setStageFilter] = useState(null);
  const [search, setSearch] = useState("");
  const [selectedLead, setSelectedLead] = useState(null);
  const [detailTab, setDetailTab] = useState("overview");
  const [timelineRemarks, setTimelineRemarks] = useState([]);
  const [timelineActivity, setTimelineActivity] = useState([]);
  const [storeItems, setStoreItems] = useState([]);
  const [followUpDraft, setFollowUpDraft] = useState(null); // { date, time, remarks } | null
  const [rescheduleDraft, setRescheduleDraft] = useState(null); // { followupId, date, time, reason } | null
  const [selling, setSelling] = useState(false);
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

  // Consultation package picker (Head Physio only) — an inline section in the popup,
  // not a separate modal. showSessionModal just toggles picker vs. summary view.
  const [showSessionModal, setShowSessionModal] = useState(false);
  const [sessionDraft, setSessionDraft] = useState({ item_id: "", mode: "offline" });

  // Collect Fee popup (Branch Admin only) — at the Consultation Fee stage, Cash/UPI/Card only
  const [collectFeeDraft, setCollectFeeDraft] = useState(null); // { paid_amount, payment_mode } | null
  const [collectingFee, setCollectingFee] = useState(false);

  // Collect Treatment Fee popup (Branch Admin only) — at the Treatment Fee stage, any payment method
  const [treatmentFeeDraft, setTreatmentFeeDraft] = useState(null); // { paid_amount, payment_mode } | null
  const [collectingTreatmentFee, setCollectingTreatmentFee] = useState(false);

  // Physio Assign popup (Branch Admin only) — pick an available Jr. Physio to deliver the package
  const [showPhysioModal, setShowPhysioModal] = useState(false);
  const [physioOptions, setPhysioOptions] = useState([]);
  const [physioPick, setPhysioPick] = useState("");
  const [assigningPhysio, setAssigningPhysio] = useState(false);

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

  const filtered = useMemo(() => {
    let rows = board.leads || [];
    if (stageFilter) rows = rows.filter((l) => l[stageField] === stageFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((l) => `${l.name || ""} ${l.phone || ""}`.toLowerCase().includes(q));
    }
    return rows;
  }, [board.leads, stageFilter, search, stageField]);

  // Stage counts for the head bar — derived client-side from the current lead list so they
  // always match whichever pipeline (branch vs. head physio) is active for this viewer.
  const derivedStageCounts = useMemo(() => {
    const counts = {};
    stages.forEach((s) => { counts[s.name] = (board.leads || []).filter((l) => l[stageField] === s.name).length; });
    return counts;
  }, [board.leads, stages, stageField]);

  useEffect(() => {
    listStoreItems().then(setStoreItems).catch(() => setStoreItems([]));
    stagesList(isConsultant ? "head_consultation" : "consultation").then(setStages).catch(() => setStages([]));
  }, [isConsultant]);

  const stageColor = useCallback(
    (name) => stages.find((s) => s.name === name)?.color || "#64748b",
    [stages],
  );

  useEffect(() => {
    setPhysioDiagDraft(selectedLead?.physio_diagnosis_report || "");
    setPhysioDiagEditing(!selectedLead?.physio_diagnosis_report);
    setTreatmentDraft(selectedLead?.treatment_summary || "");
    setTreatmentEditing(!selectedLead?.treatment_summary);
    setShowSessionModal(false);
    setShowPhysioModal(false);
    setPhysioPick("");
    setFollowUpDraft(null);
    setRescheduleDraft(null);
    setCollectFeeDraft(null);
    setTreatmentFeeDraft(null);
  }, [selectedLead?.id]);

  useEffect(() => {
    if (!selectedLead?.id || detailTab !== "timeline") return;
    getLeadRemarks(selectedLead.id).then(setTimelineRemarks).catch(() => setTimelineRemarks([]));
    getLeadActivity(selectedLead.id).then(setTimelineActivity).catch(() => setTimelineActivity([]));
  }, [selectedLead?.id, detailTab]);

  const sessionItems = storeItems.filter((i) => i.item_type === "consultation");
  // Session packages (weeks/session-count items) — chosen separately at the Treatment
  // Fee stage, distinct from the Consultation package Head Physio chooses above.
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

  const applyUpdatedLead = (updatedLead) => {
    setBoard((b) => ({ ...b, leads: (b.leads || []).map((l) => l.id === updatedLead.id ? updatedLead : l) }));
    setSelectedLead(updatedLead);
  };

  // ---- Head Physio's own consultation pipeline (independent from Branch's) ----
  const moveHeadStage = async (lead, next) => {
    if (next === lead.head_consultation_stage) return;
    try {
      const res = await moveHeadConsultationStage(lead.id, next);
      toast.success(`Moved → ${next}`);
      applyUpdatedLead(res.lead);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Move failed");
    }
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

  // ---- Consultation package assignment (Head Physio) ----
  const openSessionModal = () => {
    const mode = selectedLead.appointment_mode || "offline";
    const auto = sessionItems.length === 1 ? sessionItems[0] : null;
    setSessionDraft({ item_id: auto?.id || "", mode });
    setShowSessionModal(true);
  };

  const submitSession = async () => {
    if (!sessionDraft.item_id) { toast.error("Choose a consultation package"); return; }
    setSelling(true);
    try {
      const res = await assignPackage(selectedLead.id, {
        item_id: sessionDraft.item_id,
        mode: sessionDraft.mode,
      });
      toast.success("Consultation package assigned to patient");
      setShowSessionModal(false);
      applyUpdatedLead(res.lead);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to assign package");
    }
    setSelling(false);
  };

  // ---- Collect Fee (Branch Admin) — at the Consultation Fee stage ----
  const openCollectFeeDraft = () => {
    setCollectFeeDraft({
      paid_amount: selectedLead.package_price != null ? String(selectedLead.package_price) : "",
      payment_mode: "cash",
    });
  };

  const submitCollectFee = async () => {
    const amount = parseFloat(collectFeeDraft.paid_amount);
    if (!amount || amount <= 0) { toast.error("Enter a valid amount"); return; }
    setCollectingFee(true);
    try {
      const res = await collectPackagePayment(selectedLead.id, {
        paid_amount: amount,
        payment_mode: collectFeeDraft.payment_mode,
      });
      toast.success("Fee collected");
      setCollectFeeDraft(null);
      applyUpdatedLead(res.lead);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to collect fee");
    }
    setCollectingFee(false);
  };

  // ---- Collect Treatment Fee (Branch Admin) — at the Treatment Fee stage ----
  const openTreatmentFeeDraft = () => {
    const mode = selectedLead.appointment_mode || "offline";
    const auto = treatmentPackageItems.length === 1 ? treatmentPackageItems[0] : null;
    const baseSessions = auto ? (mode === "online" ? auto.sessions_online : auto.sessions_offline) : "";
    const perSessionRate = auto ? (mode === "online" ? auto.price_online : auto.price_offline) : "";
    const totalPrice = perSessionRate && baseSessions ? perSessionRate * baseSessions : "";
    setTreatmentFeeDraft({
      item_id: auto?.id || "",
      mode,
      sessions: baseSessions ? String(baseSessions) : "",
      paid_amount: totalPrice ? String(totalPrice) : "",
      payment_mode: "cash",
      card_number: "",
      card_holder_name: "",
      bank_name: "",
      cheque_number: "",
      emi_monthly_date: "",
      emi_tenure_months: "",
      partial_first_amount: "",
      partial_second_amount: "",
      partial_second_due_date: "",
    });
  };

  // EMI/Partial derived figures — computed from the Amount field, never stored directly
  // in state, so they can't drift out of sync with it.
  const treatmentFeeTotal = parseFloat(treatmentFeeDraft?.paid_amount) || 0;
  const emiFirstPayment = Math.round(treatmentFeeTotal * 0.1 * 100) / 100;
  const emiBalance = Math.round((treatmentFeeTotal - emiFirstPayment) * 100) / 100;
  const emiTenureNum = parseInt(treatmentFeeDraft?.emi_tenure_months, 10) || 0;
  const emiMonthlyAmount = emiTenureNum > 0 ? Math.round((emiBalance / emiTenureNum) * 100) / 100 : 0;
  const partialFirstNum = parseFloat(treatmentFeeDraft?.partial_first_amount) || 0;
  const partialSecondNum = parseFloat(treatmentFeeDraft?.partial_second_amount) || 0;
  const partialMismatch = Math.abs(partialFirstNum + partialSecondNum - treatmentFeeTotal) > 0.01;

  const submitTreatmentFee = async () => {
    if (!treatmentFeeDraft.item_id) { toast.error("Choose a session package"); return; }
    const amount = parseFloat(treatmentFeeDraft.paid_amount);
    if (!amount || amount <= 0) { toast.error("Enter a valid amount"); return; }
    const mode = treatmentFeeDraft.payment_mode;
    const payload = {
      item_id: treatmentFeeDraft.item_id,
      mode: treatmentFeeDraft.mode,
      sessions_override: treatmentFeeDraft.sessions ? parseInt(treatmentFeeDraft.sessions, 10) : undefined,
      paid_amount: amount,
      payment_mode: mode,
    };
    if (mode === "card") {
      if (!treatmentFeeDraft.card_number.trim() || !treatmentFeeDraft.card_holder_name.trim()) {
        toast.error("Card Number and Card Holder Name are required");
        return;
      }
      payload.card_number = treatmentFeeDraft.card_number.trim();
      payload.card_holder_name = treatmentFeeDraft.card_holder_name.trim();
    } else if (mode === "cheque") {
      if (!treatmentFeeDraft.bank_name.trim() || !treatmentFeeDraft.cheque_number.trim()) {
        toast.error("Bank Name and Cheque Number are required");
        return;
      }
      payload.bank_name = treatmentFeeDraft.bank_name.trim();
      payload.cheque_number = treatmentFeeDraft.cheque_number.trim();
    } else if (mode === "emi") {
      if (!treatmentFeeDraft.emi_monthly_date || !treatmentFeeDraft.emi_tenure_months) {
        toast.error("Monthly Collection Date and Tenure are required");
        return;
      }
      payload.emi_monthly_date = parseInt(treatmentFeeDraft.emi_monthly_date, 10);
      payload.emi_tenure_months = parseInt(treatmentFeeDraft.emi_tenure_months, 10);
    } else if (mode === "partial") {
      if (!treatmentFeeDraft.partial_first_amount || !treatmentFeeDraft.partial_second_amount || !treatmentFeeDraft.partial_second_due_date) {
        toast.error("First Payment, Second Payment and Second Payment Due Date are required");
        return;
      }
      if (partialMismatch) {
        toast.error("First Payment + Second Payment must equal the Total Amount");
        return;
      }
      payload.partial_first_amount = partialFirstNum;
      payload.partial_second_amount = partialSecondNum;
      payload.partial_second_due_date = treatmentFeeDraft.partial_second_due_date;
    }
    setCollectingTreatmentFee(true);
    try {
      const res = await collectTreatmentFee(selectedLead.id, payload);
      toast.success("Treatment fee collected");
      setTreatmentFeeDraft(null);
      applyUpdatedLead(res.lead);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to collect treatment fee");
    }
    setCollectingTreatmentFee(false);
  };

  // ---- Physio Assign (Branch Admin) — after fees are collected ----
  const openPhysioModal = async () => {
    setShowPhysioModal(true);
    try {
      const rows = await getDoctors({ branch_id: branchId });
      setPhysioOptions((rows || []).filter((d) => d.profile_type === "physio"));
    } catch {
      setPhysioOptions([]);
    }
  };

  const submitPhysioAssign = async () => {
    if (!physioPick) { toast.error("Choose a physio"); return; }
    setAssigningPhysio(true);
    try {
      const res = await assignConsultationPhysio(selectedLead.id, physioPick);
      toast.success("Physio assigned for treatment");
      setShowPhysioModal(false);
      applyUpdatedLead(res.lead);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to assign physio");
    }
    setAssigningPhysio(false);
  };

  return (
    <div className="space-y-3" data-testid="consultations-board">
      {/* Stage Head Bar — Pre-Sales / Branch Leads style sticky segmented tabs */}
      <StageTabBar
        stages={stages}
        stageFilter={stageFilter}
        setStageFilter={setStageFilter}
        counts={derivedStageCounts}
        totalCount={(board.leads || []).length}
        testid="cons-metric"
      />

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
        <CardContent className="p-0">
          <table className="w-full table-fixed text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="w-[18%] px-4 py-2 text-left">Patient</th>
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
                <tr><td colSpan="7" className="px-4 py-8 text-center text-sm text-slate-400">
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
                <h3 className="text-base font-semibold text-slate-900" data-testid="cons-detail-title">{selectedLead.name || "Lead"}</h3>
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

            {/* Consultation Package — an inline part of the popup, not a stage move.
                Shows the assigned package (name + duration, never price) once chosen,
                with a Change button; otherwise shows the picker directly. */}
            {isConsultant && (
              <div className="rounded-lg border border-violet-200 bg-violet-50 p-3" data-testid="cons-package-section">
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-violet-700">
                  <Dumbbell className="h-3.5 w-3.5" /> Consultation Package
                </p>
                {selectedLead.package_id && !showSessionModal ? (
                  <>
                    <p className="text-xs text-slate-700">
                      <span className="font-semibold">{selectedLead.package_name}</span>
                      {selectedLead.package_duration_minutes ? ` · ${selectedLead.package_duration_minutes} min` : ""}
                      {" "}({selectedLead.package_mode})
                    </p>
                    <Button size="sm" variant="outline" className="mt-2 text-xs" onClick={openSessionModal} data-testid="cons-package-change">
                      <Pencil className="mr-1 h-3 w-3" /> Change
                    </Button>
                  </>
                ) : (
                  <>
                    <select
                      value={sessionDraft.item_id}
                      onChange={(e) => setSessionDraft({ ...sessionDraft, item_id: e.target.value })}
                      className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-xs"
                      data-testid="cons-session-item-select"
                    >
                      <option value="">-- choose a consultation package --</option>
                      {sessionItems.map((i) => (
                        <option key={i.id} value={i.id}>{i.name} — {i.duration_minutes ? `${i.duration_minutes} min` : "duration n/a"}</option>
                      ))}
                    </select>
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" className="bg-violet-600 hover:bg-violet-700 text-xs" onClick={submitSession} disabled={selling || !sessionDraft.item_id} data-testid="cons-session-submit">
                        {selling ? "Saving..." : "Save"}
                      </Button>
                      {selectedLead.package_id && (
                        <Button size="sm" variant="outline" className="text-xs" onClick={() => setShowSessionModal(false)} data-testid="cons-package-cancel">
                          Cancel
                        </Button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Move to Stage — Head Physio's own pipeline (New Appointment, Consultation
                Visit). Package choice happens above; physio assignment now lives on
                Branch Admin's own board, after fees are collected. */}
            {isConsultant && (() => {
              const currentName = selectedLead.head_consultation_stage || "New Appointment";
              const currentIdx = stages.findIndex((x) => x.name === currentName);
              return (
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-600">Move to Stage</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {stages.map((s, idx) => {
                      const active = idx === currentIdx;
                      const passed = currentIdx >= 0 && idx < currentIdx;
                      const hex = s.color || "#64748b";
                      const isDisabled = active || passed || s.name === "New Appointment";
                      return (
                        <Fragment key={s.id}>
                          <button
                            onClick={() => {
                              if (isDisabled) return;
                              moveHeadStage(selectedLead, s.name);
                            }}
                            disabled={isDisabled}
                            className="flex flex-1 basis-32 items-center justify-center gap-1 rounded-[5px] border px-2 py-2 text-center text-[11px] font-semibold leading-tight transition disabled:opacity-100"
                            style={
                              active
                                ? { background: hex, color: "white", borderColor: hex }
                                : { background: `${hex}10`, color: hex, borderColor: `${hex}33` }
                            }
                            data-testid={`cons-head-move-${s.name}`}
                          >
                            <span className="whitespace-nowrap">{s.name}</span>
                            {(active || passed) && <CheckCircle2 className="h-3 w-3 shrink-0" />}
                          </button>
                          {idx < stages.length - 1 && (
                            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300" />
                          )}
                        </Fragment>
                      );
                    })}
                  </div>

                  {selectedLead.assigned_physio_name && (
                    <p className="mt-2 text-xs text-slate-500">
                      Physio: <span className="font-semibold text-slate-700">{selectedLead.assigned_physio_name}</span>
                    </p>
                  )}
                </div>
              );
            })()}

            {!isConsultant && (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-600">Move to Stage</p>
                <div className="grid grid-cols-5 gap-x-4 gap-y-2">
                  {stages.map((s, idx) => {
                    const active = selectedLead.consultation_stage === s.name;
                    const hex = s.color || "#64748b";
                    const viewOnly = MIRRORED_HEAD_STAGE_NAMES.includes(s.name) && viewerRole === "branch_admin";
                    const showArrow = idx < stages.length - 1 && (idx + 1) % 5 !== 0;
                    return (
                      <div key={s.id} className="relative">
                        <button
                          onClick={() => {
                            if (viewOnly) return;
                            if (s.name === "Follow Up") {
                              const today = new Date();
                              const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
                              setFollowUpDraft({ date: tomorrow.toISOString().slice(0, 10), time: "10:00", remarks: "" });
                              return;
                            }
                            if (s.name === "Consultation Fee") {
                              openCollectFeeDraft();
                              return;
                            }
                            if (s.name === "Treatment Fee") {
                              openTreatmentFeeDraft();
                              return;
                            }
                            if (s.name === "Physio Assign") {
                              openPhysioModal();
                              return;
                            }
                            moveStage(selectedLead, s.name);
                          }}
                          disabled={(active && s.name !== "Consultation Fee" && s.name !== "Treatment Fee" && s.name !== "Physio Assign") || viewOnly}
                          title={viewOnly ? "Set by the Head Physio's own pipeline — view only here" : s.name === "Consultation Fee" && !selectedLead.package_paid ? "Click to collect the fee" : s.name === "Treatment Fee" && !selectedLead.treatment_fee_paid ? "Click to collect the treatment fee" : undefined}
                          className="flex w-full items-center justify-center gap-1 rounded-[5px] border px-2 py-2 text-center text-[11px] font-semibold leading-tight transition disabled:opacity-100"
                          style={
                            active
                              ? { background: hex, color: "white", borderColor: hex }
                              : viewOnly
                                ? { background: "#f8fafc", color: "#94a3b8", borderColor: "#e2e8f0" }
                                : { background: `${hex}10`, color: hex, borderColor: `${hex}33` }
                          }
                          data-testid={`cons-move-${s.name}`}
                        >
                          <span className="whitespace-nowrap">{s.name}</span>
                          {active && <CheckCircle2 className="h-3 w-3 shrink-0" />}
                          {viewOnly && !active && <Lock className="h-3 w-3 shrink-0" />}
                        </button>
                        {showArrow && (
                          <ChevronRight className="absolute -right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-300" />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
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

            {/* Collect Fee popup (Branch Admin) — Consultation Fee stage */}
            {collectFeeDraft && (
              <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" data-testid="cons-collect-fee-modal">
                <div className="w-full max-w-sm space-y-3 rounded-xl bg-white p-4 shadow-2xl">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-slate-800">Collect Consultation Fee</p>
                    <button onClick={() => setCollectFeeDraft(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100" data-testid="cons-collect-fee-close"><X className="h-4 w-4" /></button>
                  </div>
                  {selectedLead.package_name && (
                    <p className="text-[11px] text-slate-500">
                      Package: <span className="font-semibold text-slate-700">{selectedLead.package_name}</span>
                    </p>
                  )}
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-slate-500">Amount (₹)</label>
                    <Input
                      type="number"
                      min="0"
                      value={collectFeeDraft.paid_amount}
                      onChange={(e) => setCollectFeeDraft({ ...collectFeeDraft, paid_amount: e.target.value })}
                      className="h-9"
                      data-testid="cons-collect-fee-amount"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-slate-500">Payment Mode</label>
                    <select
                      value={collectFeeDraft.payment_mode}
                      onChange={(e) => setCollectFeeDraft({ ...collectFeeDraft, payment_mode: e.target.value })}
                      className="h-9 w-full rounded-md border border-slate-200 px-2 text-xs"
                      data-testid="cons-collect-fee-mode"
                    >
                      {CONSULTATION_FEE_PAYMENT_MODES.map((m) => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                  </div>
                  <Button
                    className="w-full bg-sky-600 hover:bg-sky-700 text-xs"
                    onClick={submitCollectFee}
                    disabled={collectingFee || !collectFeeDraft.paid_amount}
                    data-testid="cons-collect-fee-submit"
                  >
                    {collectingFee ? "Collecting..." : "Confirm & Move to Consultation Fee"}
                  </Button>
                </div>
              </div>
            )}

            {/* Collect Treatment Fee popup (Branch Admin) — Treatment Fee stage, any payment method */}
            {treatmentFeeDraft && (
              <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" data-testid="cons-treatment-fee-modal">
                <div className="w-full max-w-sm space-y-3 rounded-xl bg-white p-4 shadow-2xl">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-slate-800">Collect Treatment Fee</p>
                    <button onClick={() => setTreatmentFeeDraft(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100" data-testid="cons-treatment-fee-close"><X className="h-4 w-4" /></button>
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-slate-500">Session Package</label>
                    <select
                      value={treatmentFeeDraft.item_id}
                      onChange={(e) => {
                        const item = treatmentPackageItems.find((i) => i.id === e.target.value);
                        const isOnline = treatmentFeeDraft.mode === "online";
                        const base = item ? (isOnline ? item.sessions_online : item.sessions_offline) : "";
                        const perSessionRate = item ? (isOnline ? item.price_online : item.price_offline) : "";
                        const totalPrice = perSessionRate && base ? perSessionRate * base : "";
                        setTreatmentFeeDraft({
                          ...treatmentFeeDraft,
                          item_id: e.target.value,
                          sessions: base ? String(base) : "",
                          paid_amount: totalPrice ? String(totalPrice) : "",
                        });
                      }}
                      className="h-9 w-full rounded-md border border-slate-200 px-2 text-xs"
                      data-testid="cons-treatment-fee-item-select"
                    >
                      <option value="">-- choose a session package --</option>
                      {treatmentPackageItems.map((i) => (
                        <option key={i.id} value={i.id}>{i.name}</option>
                      ))}
                    </select>
                  </div>
                  {treatmentFeeDraft.item_id && (
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-slate-500">Sessions</label>
                      <Input
                        type="number"
                        min="1"
                        value={treatmentFeeDraft.sessions}
                        onChange={(e) => setTreatmentFeeDraft({ ...treatmentFeeDraft, sessions: e.target.value })}
                        className="h-9"
                        data-testid="cons-treatment-fee-sessions"
                      />
                    </div>
                  )}
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-slate-500">Amount (₹)</label>
                    <Input
                      type="number"
                      min="0"
                      value={treatmentFeeDraft.paid_amount}
                      onChange={(e) => setTreatmentFeeDraft({ ...treatmentFeeDraft, paid_amount: e.target.value })}
                      className="h-9"
                      data-testid="cons-treatment-fee-amount"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-slate-500">Payment Mode</label>
                    <select
                      value={treatmentFeeDraft.payment_mode}
                      onChange={(e) => setTreatmentFeeDraft({ ...treatmentFeeDraft, payment_mode: e.target.value })}
                      className="h-9 w-full rounded-md border border-slate-200 px-2 text-xs"
                      data-testid="cons-treatment-fee-mode"
                    >
                      {TREATMENT_FEE_PAYMENT_MODES.map((m) => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                  </div>

                  {treatmentFeeDraft.payment_mode === "card" && (
                    <>
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-slate-500">Card Number</label>
                        <Input
                          value={treatmentFeeDraft.card_number}
                          onChange={(e) => setTreatmentFeeDraft({ ...treatmentFeeDraft, card_number: e.target.value })}
                          className="h-9"
                          data-testid="cons-treatment-fee-card-number"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-slate-500">Card Holder Name</label>
                        <Input
                          value={treatmentFeeDraft.card_holder_name}
                          onChange={(e) => setTreatmentFeeDraft({ ...treatmentFeeDraft, card_holder_name: e.target.value })}
                          className="h-9"
                          data-testid="cons-treatment-fee-card-holder"
                        />
                      </div>
                    </>
                  )}

                  {treatmentFeeDraft.payment_mode === "cheque" && (
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

                  {treatmentFeeDraft.payment_mode === "emi" && (
                    <>
                      <div className="rounded-md bg-slate-50 p-2 text-[11px] text-slate-600" data-testid="cons-treatment-fee-emi-first-payment">
                        First (Head) Payment — 10% of ₹{treatmentFeeTotal || 0}: <span className="font-bold text-slate-800">₹{emiFirstPayment}</span>
                        <br />Balance to split: <span className="font-bold text-slate-800">₹{emiBalance}</span>
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-slate-500">Monthly Collection Date (day of month)</label>
                        <Input
                          type="number"
                          min="1"
                          max="31"
                          value={treatmentFeeDraft.emi_monthly_date}
                          onChange={(e) => setTreatmentFeeDraft({ ...treatmentFeeDraft, emi_monthly_date: e.target.value })}
                          className="h-9"
                          data-testid="cons-treatment-fee-emi-date"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-slate-500">Tenure (No. of months)</label>
                        <Input
                          type="number"
                          min="1"
                          value={treatmentFeeDraft.emi_tenure_months}
                          onChange={(e) => setTreatmentFeeDraft({ ...treatmentFeeDraft, emi_tenure_months: e.target.value })}
                          className="h-9"
                          data-testid="cons-treatment-fee-emi-tenure"
                        />
                      </div>
                      {emiTenureNum > 0 && (
                        <div className="rounded-md bg-sky-50 p-2 text-[11px] text-sky-700" data-testid="cons-treatment-fee-emi-monthly-amount">
                          Monthly EMI Amount: <span className="font-bold">₹{emiMonthlyAmount}</span>
                        </div>
                      )}
                    </>
                  )}

                  {treatmentFeeDraft.payment_mode === "partial" && (
                    <>
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-slate-500">First Payment Amount</label>
                        <Input
                          type="number"
                          min="0"
                          value={treatmentFeeDraft.partial_first_amount}
                          onChange={(e) => setTreatmentFeeDraft({ ...treatmentFeeDraft, partial_first_amount: e.target.value })}
                          className="h-9"
                          data-testid="cons-treatment-fee-partial-first"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-slate-500">Second Payment Amount</label>
                        <Input
                          type="number"
                          min="0"
                          value={treatmentFeeDraft.partial_second_amount}
                          onChange={(e) => setTreatmentFeeDraft({ ...treatmentFeeDraft, partial_second_amount: e.target.value })}
                          className="h-9"
                          data-testid="cons-treatment-fee-partial-second"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-slate-500">Second Payment Due Date</label>
                        <Input
                          type="date"
                          value={treatmentFeeDraft.partial_second_due_date}
                          onChange={(e) => setTreatmentFeeDraft({ ...treatmentFeeDraft, partial_second_due_date: e.target.value })}
                          className="h-9"
                          data-testid="cons-treatment-fee-partial-due-date"
                        />
                      </div>
                      {(partialFirstNum > 0 || partialSecondNum > 0) && partialMismatch && (
                        <p className="text-[11px] text-rose-600" data-testid="cons-treatment-fee-partial-mismatch">
                          First + Second (₹{Math.round((partialFirstNum + partialSecondNum) * 100) / 100}) must equal the Total Amount (₹{treatmentFeeTotal})
                        </p>
                      )}
                    </>
                  )}

                  <Button
                    className="w-full bg-sky-600 hover:bg-sky-700 text-xs"
                    onClick={submitTreatmentFee}
                    disabled={
                      collectingTreatmentFee ||
                      !treatmentFeeDraft.paid_amount ||
                      !treatmentFeeDraft.item_id ||
                      (treatmentFeeDraft.payment_mode === "card" && (!treatmentFeeDraft.card_number.trim() || !treatmentFeeDraft.card_holder_name.trim())) ||
                      (treatmentFeeDraft.payment_mode === "cheque" && (!treatmentFeeDraft.bank_name.trim() || !treatmentFeeDraft.cheque_number.trim())) ||
                      (treatmentFeeDraft.payment_mode === "emi" && (!treatmentFeeDraft.emi_monthly_date || !treatmentFeeDraft.emi_tenure_months)) ||
                      (treatmentFeeDraft.payment_mode === "partial" && (!treatmentFeeDraft.partial_first_amount || !treatmentFeeDraft.partial_second_amount || !treatmentFeeDraft.partial_second_due_date || partialMismatch))
                    }
                    data-testid="cons-treatment-fee-submit"
                  >
                    {collectingTreatmentFee ? "Collecting..." : "Confirm & Move to Physio Assign"}
                  </Button>
                </div>
              </div>
            )}

            {/* Physio Assign popup (Branch Admin) — after fees are collected */}
            {showPhysioModal && (
              <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" data-testid="cons-physio-modal">
                <div className="w-full max-w-sm space-y-3 rounded-xl bg-white p-4 shadow-2xl">
                  <div className="flex items-center justify-between">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800"><Users className="h-4 w-4 text-emerald-600" /> Assign Physio</p>
                    <button onClick={() => setShowPhysioModal(false)} className="rounded p-1 text-slate-400 hover:bg-slate-100" data-testid="cons-physio-close"><X className="h-4 w-4" /></button>
                  </div>
                  <p className="text-[11px] text-slate-500">Available physios in this branch</p>

                  {physioOptions.length === 0 ? (
                    <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-400">No physios found for this branch yet.</p>
                  ) : (
                    <div className="max-h-56 space-y-1.5 overflow-y-auto">
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

                  <Button
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-xs"
                    onClick={submitPhysioAssign}
                    disabled={assigningPhysio || !physioPick}
                    data-testid="cons-physio-submit"
                  >
                    {assigningPhysio ? "Assigning..." : "Assign"}
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
                          applyUpdatedLead(updated);
                          setFollowUpDraft(null);
                          toast.success(`Follow-up scheduled for ${followUpDraft.date} at ${followUpDraft.time}`);
                        } catch (e) { toast.error(e?.response?.data?.detail || "Failed to schedule"); }
                      }}
                      data-testid="cons-followup-save"
                    >
                      <CheckCircle2 className="mr-1 h-4 w-4" /> Save & Move to Follow Up
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
