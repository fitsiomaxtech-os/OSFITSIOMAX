import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Calendar, CheckCircle2, ChevronRight, RefreshCw, XCircle, Search, Phone, Stethoscope, ShoppingBag, ClipboardList, Lock, Pencil, Dumbbell, X, Bell } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { StageTabBar } from "@/components/ui/stage-tab";
import {
  getConsultationsBoard, moveConsultationStage, listStoreItems, sellStoreItem,
  assignPackage, collectPackagePayment, savePhysioDiagnosis, unlockPhysioDiagnosis,
  saveTreatmentSummary, unlockTreatmentSummary, stagesList,
  scheduleConsultationFollowUp, rescheduleConsultationFollowUp,
} from "@/lib/api";

const PAYMENT_MODES = ["cash", "upi", "card", "bank_transfer"];

export const ConsultationsBoard = ({ branchId, viewerRole }) => {
  const isConsultant = viewerRole === "head_physio";
  const [board, setBoard] = useState({ leads: [], stage_counts: {} });
  const [stages, setStages] = useState([]); // dynamic Consultation Stages, from Super Admin > Pipeline Stage Management
  const [stageFilter, setStageFilter] = useState(null);
  const [search, setSearch] = useState("");
  const [selectedLead, setSelectedLead] = useState(null);
  const [storeItems, setStoreItems] = useState([]);
  const [followUpDraft, setFollowUpDraft] = useState(null); // { date, time, remarks } | null
  const [rescheduleDraft, setRescheduleDraft] = useState(null); // { followupId, date, time, reason } | null
  const [consultPick, setConsultPick] = useState({ item_id: "", mode: "offline", paid: "", payment_mode: "cash" });
  const [collectDraft, setCollectDraft] = useState({ amount: "", payment_mode: "cash" });
  const [selling, setSelling] = useState(false);
  const [loading, setLoading] = useState(false);

  // Head Physio's own diagnosis report — separate from Pre-Sales' read-only `diagnosis`
  const [physioDiagDraft, setPhysioDiagDraft] = useState("");
  const [physioDiagEditing, setPhysioDiagEditing] = useState(false);
  const [savingPhysioDiag, setSavingPhysioDiag] = useState(false);

  // Head Physio's treatment plan summary
  const [treatmentDraft, setTreatmentDraft] = useState("");
  const [treatmentEditing, setTreatmentEditing] = useState(false);
  const [savingTreatment, setSavingTreatment] = useState(false);

  // Session package assignment popup (Head Physio only)
  const [showSessionModal, setShowSessionModal] = useState(false);
  const [sessionDraft, setSessionDraft] = useState({ item_id: "", mode: "offline", sessions: "" });

  useEffect(() => {
    if (!branchId) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const res = await getConsultationsBoard(branchId);
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
      const res = await getConsultationsBoard(branchId);
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
    if (stageFilter) rows = rows.filter((l) => l.consultation_stage === stageFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((l) => `${l.name || ""} ${l.phone || ""}`.toLowerCase().includes(q));
    }
    return rows;
  }, [board.leads, stageFilter, search]);

  useEffect(() => {
    listStoreItems().then(setStoreItems).catch(() => setStoreItems([]));
    stagesList("consultation").then(setStages).catch(() => setStages([]));
  }, []);

  const stageColor = useCallback(
    (name) => stages.find((s) => s.name === name)?.color || "#64748b",
    [stages],
  );

  useEffect(() => {
    setConsultPick({ item_id: "", mode: "offline", paid: "", payment_mode: "cash" });
    setCollectDraft({ amount: "", payment_mode: "cash" });
    setPhysioDiagDraft(selectedLead?.physio_diagnosis_report || "");
    setPhysioDiagEditing(!selectedLead?.physio_diagnosis_report);
    setTreatmentDraft(selectedLead?.treatment_summary || "");
    setTreatmentEditing(!selectedLead?.treatment_summary);
    setShowSessionModal(false);
    setFollowUpDraft(null);
    setRescheduleDraft(null);
  }, [selectedLead?.id]);

  const consultationItems = storeItems.filter((i) => i.item_type !== "session");
  const sessionItems = storeItems.filter((i) => i.item_type === "session");

  const moveStage = async (lead, next) => {
    if (next === lead.consultation_stage) return;
    try {
      const updated = await moveConsultationStage(lead.id, next);
      toast.success(`${lead.name || "Lead"} moved → ${next}`);
      setSelectedLead(null);
      // Optimistic update
      setBoard((b) => {
        const leads = (b.leads || []).map((l) => l.id === lead.id ? { ...l, consultation_stage: updated.consultation_stage } : l);
        const stage_counts = {};
        stages.forEach((s) => { stage_counts[s.name] = leads.filter((l) => l.consultation_stage === s.name).length; });
        return { ...b, leads, stage_counts };
      });
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Move failed");
    }
  };

  const applyUpdatedLead = (updatedLead) => {
    setBoard((b) => {
      const leads = (b.leads || []).map((l) => l.id === updatedLead.id ? updatedLead : l);
      const stage_counts = {};
      stages.forEach((s) => { stage_counts[s.name] = leads.filter((l) => l.consultation_stage === s.name).length; });
      return { ...b, leads, stage_counts };
    });
    setSelectedLead(updatedLead);
  };

  const sellConsultation = async () => {
    if (!consultPick.item_id) { toast.error("Choose an item"); return; }
    setSelling(true);
    try {
      const res = await sellStoreItem(selectedLead.id, {
        item_id: consultPick.item_id,
        mode: consultPick.mode,
        paid_amount: consultPick.paid ? parseFloat(consultPick.paid) : null,
        payment_mode: consultPick.payment_mode,
      });
      toast.success("Consultation payment recorded");
      setConsultPick({ item_id: "", mode: "offline", paid: "", payment_mode: "cash" });
      applyUpdatedLead(res.lead);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to record payment");
    }
    setSelling(false);
  };

  const collectPayment = async () => {
    const amount = collectDraft.amount !== "" ? parseFloat(collectDraft.amount) : selectedLead.package_price;
    if (amount == null || Number.isNaN(amount)) { toast.error("Enter an amount"); return; }
    setSelling(true);
    try {
      const res = await collectPackagePayment(selectedLead.id, amount, collectDraft.payment_mode);
      toast.success("Payment collected");
      setCollectDraft({ amount: "", payment_mode: "cash" });
      applyUpdatedLead(res.lead);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to collect payment");
    }
    setSelling(false);
  };

  // ---- Head Physio's diagnosis report (separate from Pre-Sales' read-only diagnosis) ----
  const savePhysioDiag = async (lock) => {
    if (!physioDiagDraft.trim()) { toast.error("Enter a diagnosis report"); return; }
    setSavingPhysioDiag(true);
    try {
      const updated = await savePhysioDiagnosis(selectedLead.id, physioDiagDraft.trim(), lock);
      applyUpdatedLead(updated);
      setPhysioDiagEditing(!lock);
      toast.success(lock ? "Diagnosis report saved & locked" : "Diagnosis report saved");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to save diagnosis report");
    }
    setSavingPhysioDiag(false);
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
  const saveTreatment = async (lock) => {
    if (!treatmentDraft.trim()) { toast.error("Enter a treatment summary"); return; }
    setSavingTreatment(true);
    try {
      const updated = await saveTreatmentSummary(selectedLead.id, treatmentDraft.trim(), lock);
      applyUpdatedLead(updated);
      setTreatmentEditing(!lock);
      toast.success(lock ? "Treatment summary saved & locked" : "Treatment summary saved");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to save treatment summary");
    }
    setSavingTreatment(false);
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

  // ---- Session package assignment (Head Physio) ----
  const openSessionModal = () => {
    const mode = selectedLead.appointment_mode || "offline";
    const auto = sessionItems.length === 1 ? sessionItems[0] : null;
    const baseSessions = auto ? (mode === "online" ? auto.sessions_online : auto.sessions_offline) : "";
    setSessionDraft({ item_id: auto?.id || "", mode, sessions: baseSessions ? String(baseSessions) : "" });
    setShowSessionModal(true);
  };

  const submitSession = async () => {
    if (!sessionDraft.item_id) { toast.error("Choose a session package"); return; }
    const sessionsNum = parseInt(sessionDraft.sessions, 10);
    if (!sessionsNum || sessionsNum < 1) { toast.error("Enter a valid session count"); return; }
    setSelling(true);
    try {
      const res = await assignPackage(selectedLead.id, {
        item_id: sessionDraft.item_id,
        mode: sessionDraft.mode,
        sessions_override: sessionsNum,
      });
      toast.success("Session package assigned to patient");
      setShowSessionModal(false);
      applyUpdatedLead(res.lead);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to assign package");
    }
    setSelling(false);
  };

  return (
    <div className="space-y-3" data-testid="consultations-board">
      {/* Stage Head Bar — Pre-Sales / Branch Leads style sticky segmented tabs */}
      <StageTabBar
        stages={stages}
        stageFilter={stageFilter}
        setStageFilter={setStageFilter}
        counts={board.stage_counts}
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
        <Button variant="outline" size="sm" onClick={load} data-testid="cons-refresh"><RefreshCw className="h-3.5 w-3.5" /></Button>
      </div>

      {/* Table */}
      <Card className="overflow-hidden border-slate-200">
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">Patient</th>
                <th className="px-4 py-2 text-left">Phone</th>
                <th className="px-4 py-2 text-left">Consultation Stage</th>
                <th className="px-4 py-2 text-left">Assigned Expert</th>
                <th className="px-4 py-2 text-left">Appointment</th>
                <th className="px-4 py-2 text-left">Updated</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => {
                const hex = stageColor(l.consultation_stage);
                return (
                  <tr key={l.id} onClick={() => setSelectedLead(l)} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" data-testid={`cons-row-${l.id}`}>
                    <td className="px-4 py-3 font-medium text-slate-800">{l.name || "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{l.phone || "—"}</td>
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
                        style={{ background: `${hex}14`, color: hex, border: `1px solid ${hex}33` }}
                      >
                        {l.consultation_stage || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{l.assigned_physio_name || "—"}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{l.appointment_date ? `${l.appointment_date} ${l.appointment_time || ""}` : "—"}</td>
                    <td className="px-4 py-3 text-xs text-slate-400">{(l.updated_at || "").slice(0, 10)}</td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan="6" className="px-4 py-8 text-center text-sm text-slate-400">
                  {loading ? "Loading…" : "No leads in consultations yet. Book an appointment with a Head Physio to populate this list."}
                </td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Detail / move-stage dialog */}
      {selectedLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-testid="cons-detail-dialog">
          <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto space-y-4 rounded-xl bg-white p-5 shadow-2xl">
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
                    className={`mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
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

            {/* Pre-Sales Diagnosis — read-only reference, mini card */}
            {selectedLead.diagnosis && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3" data-testid="cons-presales-diagnosis">
                <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <Stethoscope className="h-3.5 w-3.5" /> Pre-Sales Diagnosis
                </p>
                <p className="text-xs text-slate-700">{selectedLead.diagnosis}</p>
              </div>
            )}

            {/* Head Physio's own diagnosis report — bigger box, lock/edit */}
            {(isConsultant || selectedLead.physio_diagnosis_report) && (
              <LockableTextBox
                icon={Stethoscope}
                label="Diagnosis Report"
                accent="sky"
                value={physioDiagDraft}
                onChange={setPhysioDiagDraft}
                editing={physioDiagEditing}
                locked={!!selectedLead.physio_diagnosis_locked}
                savedText={selectedLead.physio_diagnosis_report}
                saving={savingPhysioDiag}
                canEdit={isConsultant}
                onSave={() => savePhysioDiag(true)}
                onSaveDraft={() => savePhysioDiag(false)}
                onEdit={() => setPhysioDiagEditing(true)}
                onUnlock={unlockPhysioDiag}
                rows={5}
                placeholder="Write the full diagnosis report..."
                testPrefix="cons-physio-diagnosis"
              />
            )}

            {/* Treatment Summary — what treatment to give the patient */}
            {(isConsultant || selectedLead.treatment_summary) && (
              <LockableTextBox
                icon={ClipboardList}
                label="Treatment Summary"
                accent="indigo"
                value={treatmentDraft}
                onChange={setTreatmentDraft}
                editing={treatmentEditing}
                locked={!!selectedLead.treatment_summary_locked}
                savedText={selectedLead.treatment_summary}
                saving={savingTreatment}
                canEdit={isConsultant}
                onSave={() => saveTreatment(true)}
                onSaveDraft={() => saveTreatment(false)}
                onEdit={() => setTreatmentEditing(true)}
                onUnlock={unlockTreatment}
                rows={4}
                placeholder="What treatment should be given to the patient..."
                testPrefix="cons-treatment-summary"
              />
            )}

            {/* Payment Summary */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3" data-testid="cons-payment-summary">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-600">Payment Summary</p>
              <div className="space-y-1.5 text-xs text-slate-700">
                <div className="flex items-center justify-between">
                  <span>Consultation{selectedLead.consultation_item_name ? ` · ${selectedLead.consultation_item_name}` : ""}{selectedLead.consultation_mode ? ` (${selectedLead.consultation_mode})` : ""}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${selectedLead.consultation_fee ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>
                    {selectedLead.consultation_fee ? `₹${selectedLead.consultation_fee} Paid` : "Not paid"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Sessions{selectedLead.package_name ? ` · ${selectedLead.package_name}` : ""}{selectedLead.package_sessions ? ` · ${selectedLead.package_sessions} sessions` : ""}{selectedLead.package_mode ? ` (${selectedLead.package_mode})` : ""}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${selectedLead.package_paid ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>
                    {selectedLead.package_paid ? `₹${selectedLead.package_paid} Paid` : "Not sold yet"}
                  </span>
                </div>
              </div>
            </div>

            {/* Sell from Fitsiomax Store */}
            <div className="space-y-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-violet-700">
                <ShoppingBag className="h-3.5 w-3.5" /> Sell from Fitsiomax Store
              </p>

              {isConsultant ? (
                <div className="rounded-lg border border-violet-200 bg-violet-50 p-3" data-testid="cons-session-trigger">
                  {selectedLead.package_id ? (
                    <div className="space-y-1 text-xs text-violet-700">
                      <p className="font-semibold">{selectedLead.package_name} · {selectedLead.package_sessions} sessions ({selectedLead.package_mode})</p>
                      <p>Rs.{selectedLead.package_price} total — {selectedLead.package_paid ? "collected by branch admin" : "awaiting branch admin collection"}</p>
                    </div>
                  ) : (
                    <p className="mb-2 text-xs text-violet-500">No session package assigned yet.</p>
                  )}
                  <Button
                    size="sm"
                    className="mt-2 w-full bg-violet-600 hover:bg-violet-700 text-xs"
                    onClick={openSessionModal}
                    data-testid="cons-session-btn"
                  >
                    <Dumbbell className="mr-1 h-3.5 w-3.5" /> {selectedLead.package_id ? "Change Session Package" : "Session"}
                  </Button>
                </div>
              ) : (
                <>
                  <StoreSellSection
                    title="Consultations"
                    items={consultationItems}
                    pick={consultPick}
                    setPick={setConsultPick}
                    onSell={sellConsultation}
                    selling={selling}
                    testPrefix="cons-store-consult"
                    buttonLabel="Record Consultation Payment"
                    showPaymentMode
                  />

                  {selectedLead.package_id && (
                    <div className="rounded-lg border border-teal-200 bg-teal-50 p-3" data-testid="cons-treatment-collect">
                      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-teal-700">Treatment · Recommended by Doctor</p>
                      <p className="text-xs text-teal-800">{selectedLead.package_name} — {selectedLead.package_sessions} sessions ({selectedLead.package_mode})</p>
                      <p className="mt-0.5 text-sm font-semibold text-teal-900">Total: Rs.{selectedLead.package_price}</p>
                      {selectedLead.package_paid ? (
                        <p className="mt-2 text-xs font-semibold text-emerald-700">Rs.{selectedLead.package_paid} collected via {selectedLead.package_payment_mode || "—"}</p>
                      ) : (
                        <div className="mt-2 grid grid-cols-3 gap-2">
                          <select
                            value={collectDraft.payment_mode}
                            onChange={(e) => setCollectDraft({ ...collectDraft, payment_mode: e.target.value })}
                            className="h-9 rounded-md border border-teal-200 px-2 text-xs capitalize"
                            data-testid="cons-collect-mode"
                          >
                            {PAYMENT_MODES.map((m) => <option key={m} value={m}>{m.replace("_", " ")}</option>)}
                          </select>
                          <Input
                            type="number"
                            min="0"
                            value={collectDraft.amount}
                            onChange={(e) => setCollectDraft({ ...collectDraft, amount: e.target.value })}
                            placeholder={`Amount (default Rs.${selectedLead.package_price})`}
                            className="col-span-2 h-9"
                            data-testid="cons-collect-amount"
                          />
                        </div>
                      )}
                      {!selectedLead.package_paid && (
                        <Button
                          size="sm"
                          className="mt-2 w-full bg-teal-600 hover:bg-teal-700 text-xs"
                          onClick={collectPayment}
                          disabled={selling}
                          data-testid="cons-collect-btn"
                        >
                          {selling ? "Collecting..." : "Collect Payment"}
                        </Button>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {!isConsultant && (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-600">Move to Stage</p>
                <div className="flex flex-nowrap items-center gap-1">
                  {stages.map((s, idx) => {
                    const active = selectedLead.consultation_stage === s.name;
                    const hex = s.color || "#64748b";
                    return (
                      <Fragment key={s.id}>
                        <button
                          onClick={() => {
                            if (s.name === "Follow Up") {
                              const today = new Date();
                              const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
                              setFollowUpDraft({ date: tomorrow.toISOString().slice(0, 10), time: "10:00", remarks: "" });
                              return;
                            }
                            moveStage(selectedLead, s.name);
                          }}
                          disabled={active}
                          className="flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg border px-1.5 py-2 text-center text-[11px] font-semibold leading-tight transition disabled:opacity-100"
                          style={
                            active
                              ? { background: hex, color: "white", borderColor: hex }
                              : { background: `${hex}10`, color: hex, borderColor: `${hex}33` }
                          }
                          data-testid={`cons-move-${s.name}`}
                        >
                          <span className="w-full truncate">{s.name}</span>
                          {active && <CheckCircle2 className="h-3 w-3 shrink-0" />}
                        </button>
                        {idx < stages.length - 1 && (
                          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300" />
                        )}
                      </Fragment>
                    );
                  })}
                </div>

                {(selectedLead.consultation_follow_ups || []).length > 0 && (
                  <div className="mt-2 space-y-1.5" data-testid="cons-followups-list">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Follow-up History</p>
                    {selectedLead.consultation_follow_ups.slice().reverse().map((f) => {
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
                          {isActive && (
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
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Session package assignment popup (Head Physio) */}
            {showSessionModal && (
              <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" data-testid="cons-session-modal">
                <div className="w-full max-w-sm space-y-3 rounded-xl bg-white p-4 shadow-2xl">
                  <div className="flex items-center justify-between">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800"><Dumbbell className="h-4 w-4 text-violet-600" /> Assign Session Package</p>
                    <button onClick={() => setShowSessionModal(false)} className="rounded p-1 text-slate-400 hover:bg-slate-100" data-testid="cons-session-close"><X className="h-4 w-4" /></button>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {selectedLead.appointment_department === "physio" ? "Physiotherapy" : "Fitness"} · {selectedLead.appointment_mode || "offline"} (selected)
                  </p>

                  <select
                    value={sessionDraft.item_id}
                    onChange={(e) => {
                      const item = sessionItems.find((i) => i.id === e.target.value);
                      const base = item ? (sessionDraft.mode === "online" ? item.sessions_online : item.sessions_offline) : "";
                      setSessionDraft({ ...sessionDraft, item_id: e.target.value, sessions: base ? String(base) : "" });
                    }}
                    className="h-9 w-full rounded-md border border-slate-200 px-2 text-xs"
                    data-testid="cons-session-item-select"
                  >
                    <option value="">-- choose a package --</option>
                    {sessionItems.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </select>

                  {(() => {
                    const item = sessionItems.find((i) => i.id === sessionDraft.item_id);
                    if (!item) return null;
                    const baseSessions = sessionDraft.mode === "online" ? item.sessions_online : item.sessions_offline;
                    return (
                      <>
                        <div className="flex gap-1.5">
                          {[1, 2].map((weeks) => (
                            <button
                              key={weeks}
                              type="button"
                              onClick={() => setSessionDraft({ ...sessionDraft, sessions: String((baseSessions || 0) * weeks) })}
                              className="flex-1 rounded-md border border-violet-200 bg-violet-50 py-1.5 text-[11px] font-semibold text-violet-700 hover:bg-violet-100"
                              data-testid={`cons-session-week-${weeks}`}
                            >
                              {weeks} week{weeks > 1 ? "s" : ""} · {(baseSessions || 0) * weeks} sessions
                            </button>
                          ))}
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">Sessions</label>
                          <Input
                            type="number"
                            min="1"
                            value={sessionDraft.sessions}
                            onChange={(e) => setSessionDraft({ ...sessionDraft, sessions: e.target.value })}
                            className="h-9"
                            data-testid="cons-session-count-input"
                          />
                        </div>
                      </>
                    );
                  })()}

                  <Button
                    className="w-full bg-violet-600 hover:bg-violet-700 text-xs"
                    onClick={submitSession}
                    disabled={selling || !sessionDraft.item_id}
                    data-testid="cons-session-submit"
                  >
                    {selling ? "Submitting..." : "Submit"}
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

function StoreSellSection({ title, items, pick, setPick, onSell, selling, testPrefix, buttonLabel, showPaymentMode }) {
  const selectedItem = items.find((i) => i.id === pick.item_id);
  const price = selectedItem ? (pick.mode === "online" ? selectedItem.price_online : selectedItem.price_offline) : null;
  const sessions = selectedItem?.item_type === "session"
    ? (pick.mode === "online" ? selectedItem.sessions_online : selectedItem.sessions_offline)
    : null;

  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50 p-3" data-testid={testPrefix}>
      <p className="mb-1.5 text-[11px] font-semibold text-violet-700">{title}</p>
      {items.length === 0 ? (
        <p className="text-xs text-violet-400">No {title.toLowerCase()} items in the store yet.</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <select
              value={pick.item_id}
              onChange={(e) => setPick({ ...pick, item_id: e.target.value })}
              className="col-span-2 h-9 rounded-md border border-violet-200 px-2 text-xs"
              data-testid={`${testPrefix}-select`}
            >
              <option value="">-- choose --</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </select>
            <select
              value={pick.mode}
              onChange={(e) => setPick({ ...pick, mode: e.target.value })}
              className="h-9 rounded-md border border-violet-200 px-2 text-xs"
              data-testid={`${testPrefix}-mode`}
            >
              <option value="offline">Offline</option>
              <option value="online">Online</option>
            </select>
          </div>

          {selectedItem && (
            <p className="mt-1.5 text-[11px] text-violet-600">
              ₹{price}{sessions ? ` · ${sessions} sessions` : ""}
            </p>
          )}

          <div className={showPaymentMode ? "mt-2 grid grid-cols-3 gap-2" : "mt-2"}>
            {showPaymentMode && (
              <select
                value={pick.payment_mode}
                onChange={(e) => setPick({ ...pick, payment_mode: e.target.value })}
                className="h-9 rounded-md border border-violet-200 px-2 text-xs capitalize"
                data-testid={`${testPrefix}-payment-mode`}
              >
                {PAYMENT_MODES.map((m) => <option key={m} value={m}>{m.replace("_", " ")}</option>)}
              </select>
            )}
            <Input
              type="number"
              min="0"
              value={pick.paid}
              onChange={(e) => setPick({ ...pick, paid: e.target.value })}
              placeholder={price != null ? `Paid (default ₹${price})` : "Paid"}
              className={showPaymentMode ? "col-span-2 h-9" : "h-9"}
              data-testid={`${testPrefix}-paid`}
            />
          </div>
          <Button
            size="sm"
            className="mt-2 w-full bg-violet-600 hover:bg-violet-700 text-xs"
            onClick={onSell}
            disabled={selling || !pick.item_id}
            data-testid={`${testPrefix}-sell`}
          >
            {selling ? "Saving..." : buttonLabel}
          </Button>
        </>
      )}
    </div>
  );
}

/**
 * A text box that starts editable, then locks (read-only) once saved.
 * A locked box can be reopened for editing via the Edit button, which calls
 * the backend unlock endpoint so the lock state persists across reloads.
 */
function LockableTextBox({
  icon: Icon, label, accent, value, onChange, editing, locked, savedText,
  saving, canEdit, onSave, onSaveDraft, onEdit, onUnlock, rows, placeholder, testPrefix,
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
          <div className="mt-2 flex gap-2">
            <Button size="sm" className={`${colors.btn} text-xs`} onClick={onSave} disabled={saving} data-testid={`${testPrefix}-save-lock`}>
              {saving ? "Saving..." : "Save & Lock"}
            </Button>
            <Button size="sm" variant="outline" className="text-xs" onClick={onSaveDraft} disabled={saving} data-testid={`${testPrefix}-save-draft`}>
              Save
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
