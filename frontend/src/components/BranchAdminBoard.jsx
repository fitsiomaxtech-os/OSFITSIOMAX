import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Calendar,
  Check,
  ChevronRight,
  CreditCard,
  Phone,
  Mail,
  Search,
  Stethoscope,
  User,
  UserPlus,
  X,
  Activity,
  RefreshCw,
  LayoutDashboard,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import {
  addLeadRemark,
  assignPhysio,
  bookAppointment,
  collectFee,
  getAvailableDoctors,
  getBranchBoard,
  getDoctors,
  getLeadActivity,
  getLeadRemarks,
  moveBranchStage,
} from "@/lib/api";
import { HeadPhysioCalendar } from "@/components/HeadPhysioCalendar";
import { FinanceBoard } from "@/components/FinanceBoard";

const BRANCH_STAGES = [
  "New Appointment",
  "Qualified",
  "Portfolio",
  "Follow Up",
  "Appointment Date & Time",
  "Branch",
  "Assigned Physio",
  "Cancelled",
];

const STAGE_COLORS = {
  "New Appointment": { bg: "bg-blue-500", light: "bg-blue-50 text-blue-700 border-blue-200", col: "border-blue-200 bg-blue-50/40" },
  "Qualified": { bg: "bg-amber-500", light: "bg-amber-50 text-amber-700 border-amber-200", col: "border-amber-200 bg-amber-50/40" },
  "Portfolio": { bg: "bg-violet-500", light: "bg-violet-50 text-violet-700 border-violet-200", col: "border-violet-200 bg-violet-50/40" },
  "Follow Up": { bg: "bg-orange-500", light: "bg-orange-50 text-orange-700 border-orange-200", col: "border-orange-200 bg-orange-50/40" },
  "Appointment Date & Time": { bg: "bg-teal-500", light: "bg-teal-50 text-teal-700 border-teal-200", col: "border-teal-200 bg-teal-50/40" },
  "Branch": { bg: "bg-emerald-500", light: "bg-emerald-50 text-emerald-700 border-emerald-200", col: "border-emerald-200 bg-emerald-50/40" },
  "Assigned Physio": { bg: "bg-sky-500", light: "bg-sky-50 text-sky-700 border-sky-200", col: "border-sky-200 bg-sky-50/40" },
  "Cancelled": { bg: "bg-rose-500", light: "bg-rose-50 text-rose-700 border-rose-200", col: "border-rose-200 bg-rose-50/40" },
};

export const BranchAdminBoard = ({ branchId }) => {
  const [boardData, setBoardData] = useState({ leads: [], stage_counts: {} });
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLead, setSelectedLead] = useState(null);
  const [activeView, setActiveView] = useState("pipeline");
  const [stageFilter, setStageFilter] = useState(null); // null = show all stages

  const loadBoard = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    try {
      const data = await getBranchBoard(branchId);
      setBoardData(data);
    } catch { /* silent */ }
    setLoading(false);
  }, [branchId]);

  useEffect(() => { loadBoard(); }, [loadBoard]);

  const filteredLeads = useMemo(() => {
    if (!searchQuery.trim()) return boardData.leads;
    const q = searchQuery.toLowerCase();
    return boardData.leads.filter((l) =>
      l.name?.toLowerCase().includes(q) || l.phone?.includes(q) || l.email?.toLowerCase().includes(q)
    );
  }, [boardData.leads, searchQuery]);

  const totalLeads = boardData.leads.length;

  const handleStageUpdate = async () => {
    await loadBoard();
    if (selectedLead) {
      const updated = boardData.leads.find((l) => l.id === selectedLead.id);
      if (updated) setSelectedLead(updated);
    }
  };

  const VIEW_TABS = [
    { key: "pipeline", label: "Appointment", icon: LayoutDashboard },
    { key: "head_physio", label: "Head Physio Calendar", icon: Stethoscope },
    { key: "finance", label: "Finance", icon: CreditCard },
  ];

  return (
    <div className="space-y-4" data-testid="branch-admin-board-root">
      {/* View Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200 pb-0" data-testid="branch-view-tabs">
        {VIEW_TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveView(tab.key)}
              className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                activeView === tab.key
                  ? "border-sky-500 text-sky-700"
                  : "border-transparent text-slate-400 hover:text-slate-600"
              }`}
              data-testid={`branch-view-tab-${tab.key}`}
            >
              <Icon className="h-4 w-4" /> {tab.label}
            </button>
          );
        })}
      </div>

      {activeView === "head_physio" ? (
        <HeadPhysioCalendar branchId={branchId} />
      ) : activeView === "finance" ? (
        <FinanceBoard />
      ) : (
        <>
          {/* Metric Strip */}
      <div className="flex gap-2 overflow-x-auto pb-1" data-testid="branch-metrics">
        <button
          type="button"
          onClick={() => setStageFilter(null)}
          className={`flex-shrink-0 rounded-lg border px-4 py-2 text-left transition-shadow hover:shadow-md ${stageFilter === null ? "border-sky-500 bg-sky-100 ring-2 ring-sky-300" : "border-sky-200 bg-sky-50"}`}
          data-testid="branch-metric-total"
        >
          <p className="text-[10px] font-medium text-slate-500">All Stages</p>
          <p className="text-xl font-bold text-sky-700">{totalLeads}</p>
        </button>
        {BRANCH_STAGES.map((stage) => {
          const isActive = stageFilter === stage;
          return (
            <button
              key={stage}
              type="button"
              onClick={() => setStageFilter(isActive ? null : stage)}
              className={`flex-shrink-0 rounded-lg border px-3 py-2 text-left transition-shadow hover:shadow-md ${STAGE_COLORS[stage]?.col || "border-slate-200 bg-slate-50"} ${isActive ? "ring-2 ring-offset-1 ring-slate-700" : ""}`}
              data-testid={`branch-metric-${stage}`}
            >
              <p className="text-[10px] font-medium text-slate-500 whitespace-nowrap">{stage}</p>
              <p className="text-lg font-bold text-slate-800">{boardData.stage_counts?.[stage] || 0}</p>
            </button>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3" data-testid="branch-toolbar">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <Input className="pl-9" placeholder="Search patients..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} data-testid="branch-search" />
        </div>
        <Button size="sm" variant="outline" onClick={loadBoard} data-testid="branch-refresh-btn">
          <RefreshCw className="mr-1 h-4 w-4" /> Refresh
        </Button>
      </div>

      {/* Kanban Board */}
      {stageFilter && (
        <div className="flex items-center gap-2 text-xs text-slate-600" data-testid="branch-stage-filter-indicator">
          <span>Filtering by:</span>
          <span className={`rounded-full border px-2 py-0.5 font-medium ${STAGE_COLORS[stageFilter]?.light || ""}`}>{stageFilter}</span>
          <button type="button" onClick={() => setStageFilter(null)} className="text-sky-600 hover:underline" data-testid="branch-stage-filter-clear">Clear</button>
        </div>
      )}
      <div className="flex gap-2.5 overflow-x-auto pb-2" data-testid="branch-kanban">
        {(stageFilter ? [stageFilter] : BRANCH_STAGES).map((stage) => {
          const stageLeads = filteredLeads.filter((l) => l.branch_stage === stage);
          return (
            <div key={stage} className={`min-w-[240px] flex-1 rounded-lg border p-2.5 ${STAGE_COLORS[stage]?.col || "border-slate-200 bg-slate-50"}`} data-testid={`branch-col-${stage}`}>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-700 leading-tight">{stage}</p>
                <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600 shadow-sm">{stageLeads.length}</span>
              </div>
              <div className="space-y-1.5">
                {stageLeads.map((lead) => (
                  <div
                    key={lead.id}
                    onClick={() => setSelectedLead(lead)}
                    className="cursor-pointer rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm transition-shadow hover:shadow-md"
                    data-testid={`branch-card-${lead.id}`}
                  >
                    <div className="flex items-start gap-2">
                      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-bold text-violet-700">
                        {lead.name?.charAt(0)?.toUpperCase() || "?"}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-slate-800">{lead.name}</p>
                        <p className="truncate text-[10px] text-slate-500">{lead.phone}</p>
                      </div>
                    </div>
                    {(lead.consultation_fee || lead.package_amount || lead.assigned_physio_name) && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {lead.consultation_fee && (
                          <span className="rounded bg-teal-50 px-1.5 py-0.5 text-[9px] font-medium text-teal-700">Fee: Rs.{lead.consultation_fee}</span>
                        )}
                        {lead.package_amount && (
                          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[9px] font-medium text-emerald-700">Pkg: Rs.{lead.package_amount}</span>
                        )}
                        {lead.assigned_physio_name && (
                          <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[9px] font-medium text-sky-700">{lead.assigned_physio_name}</span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                {stageLeads.length === 0 && (
                  <p className="py-3 text-center text-[10px] text-slate-400">Empty</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Lead Detail Modal */}
      {selectedLead && (
        <BranchLeadModal
          lead={selectedLead}
          branchId={branchId}
          onClose={() => setSelectedLead(null)}
          onUpdate={handleStageUpdate}
          reloadBoard={loadBoard}
        />
      )}
        </>
      )}

      {loading && (
        <div className="fixed bottom-4 right-4 rounded-md bg-slate-900 px-3 py-2 text-sm text-white">Loading...</div>
      )}
    </div>
  );
};

/* ─── Branch Lead Detail Modal ─── */
function BranchLeadModal({ lead, branchId, onClose, onUpdate, reloadBoard }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [remarks, setRemarks] = useState([]);
  const [newRemark, setNewRemark] = useState("");
  const [activityLog, setActivityLog] = useState([]);

  // Fee collection
  const [feeAmount, setFeeAmount] = useState("");
  const [packageWeeks, setPackageWeeks] = useState("8");
  const [packageAmount, setPackageAmount] = useState("");

  // Appointment booking
  const [doctors, setDoctors] = useState([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedSlot, setSelectedSlot] = useState("");
  const [selectedDoctorId, setSelectedDoctorId] = useState("");

  // Jr. Physio assignment
  const [allDoctors, setAllDoctors] = useState([]);
  const [selectedPhysioId, setSelectedPhysioId] = useState("");

  useEffect(() => {
    if (activeTab === "remarks") loadRemarks();
    if (activeTab === "activity") loadActivity();
  }, [activeTab, lead.id]);

  useEffect(() => {
    loadDoctors();
  }, [branchId]);

  const loadRemarks = async () => {
    try { setRemarks(await getLeadRemarks(lead.id)); } catch { /* silent */ }
  };
  const loadActivity = async () => {
    try { setActivityLog(await getLeadActivity(lead.id)); } catch { /* silent */ }
  };
  const loadDoctors = async () => {
    if (!branchId) return;
    try { const d = await getDoctors({ branch_id: branchId }); setDoctors(d); setAllDoctors(d); } catch { /* silent */ }
  };

  const moveStage = async (stage) => {
    try {
      const updated = await moveBranchStage(lead.id, { branch_stage: stage });
      toast.success(`Moved to ${stage}`);
      await reloadBoard();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Move failed");
    }
  };

  const collectConsultationFee = async () => {
    if (!feeAmount || Number(feeAmount) <= 0) { toast.error("Enter valid amount"); return; }
    try {
      await collectFee(lead.id, { fee_type: "consultation", amount: Number(feeAmount) });
      setFeeAmount("");
      toast.success("Consultation fee collected");
      await reloadBoard();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed");
    }
  };

  const collectPackageFee = async () => {
    if (!packageAmount || Number(packageAmount) <= 0) { toast.error("Enter valid amount"); return; }
    try {
      await collectFee(lead.id, { fee_type: "package", amount: Number(packageAmount), package_weeks: Number(packageWeeks) });
      setPackageAmount("");
      toast.success("Package fee collected");
      await reloadBoard();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed");
    }
  };

  const bookNow = async () => {
    if (!selectedDoctorId || !selectedSlot) { toast.error("Select doctor and time"); return; }
    try {
      await bookAppointment(lead.id, { doctor_id: selectedDoctorId, slot_time: selectedSlot });
      toast.success("Head Physio appointment booked!");
      setSelectedDate(""); setSelectedSlot(""); setSelectedDoctorId("");
      await reloadBoard();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Booking failed");
    }
  };

  const assignPhysioNow = async () => {
    if (!selectedPhysioId) { toast.error("Select a Jr. Physio"); return; }
    try {
      await assignPhysio(lead.id, { physio_id: selectedPhysioId });
      toast.success("Jr. Physio assigned!");
      setSelectedPhysioId("");
      await reloadBoard();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Assignment failed");
    }
  };

  const addRemarkNow = async () => {
    if (!newRemark.trim()) return;
    try {
      await addLeadRemark(lead.id, { text: newRemark });
      setNewRemark("");
      toast.success("Remark added");
      await loadRemarks();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed");
    }
  };

  const generateTimeSlots = () => {
    if (!selectedDate) return [];
    const slots = [];
    for (let h = 8; h <= 20; h++) {
      for (let m = 0; m < 60; m += 30) {
        slots.push(`${selectedDate}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`);
      }
    }
    return slots;
  };

  const TABS = [
    { key: "overview", label: "Overview", icon: User },
    { key: "actions", label: "Actions", icon: ChevronRight },
    { key: "remarks", label: "Remarks", icon: Phone },
    { key: "activity", label: "Activity", icon: Activity },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} data-testid="branch-lead-modal-overlay">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-2xl" data-testid="branch-lead-modal">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-200 p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-violet-100 text-lg font-bold text-violet-700">
              {lead.name?.charAt(0)?.toUpperCase() || "?"}
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-800" data-testid="branch-lead-name">{lead.name}</h3>
              <div className="flex flex-wrap gap-1.5">
                <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STAGE_COLORS[lead.branch_stage]?.light || "bg-slate-100 text-slate-600 border-slate-200"}`} data-testid="branch-lead-stage">
                  {lead.branch_stage || "No Stage"}
                </span>
                {lead.consultation_fee && <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs text-teal-700">Fee: Rs.{lead.consultation_fee}</span>}
                {lead.package_amount && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">Pkg: Rs.{lead.package_amount}</span>}
              </div>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 hover:bg-slate-100" data-testid="branch-lead-close">
            <X className="h-5 w-5 text-slate-400" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200" data-testid="branch-lead-tabs">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button key={tab.key} type="button" onClick={() => setActiveTab(tab.key)}
                className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors ${activeTab === tab.key ? "border-sky-500 text-sky-700" : "border-transparent text-slate-400 hover:text-slate-600"}`}
                data-testid={`branch-lead-tab-${tab.key}`}>
                <Icon className="h-3.5 w-3.5" /> {tab.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4" data-testid="branch-lead-content">
          {activeTab === "overview" && (
            <>
              <div className="rounded-lg border border-slate-200 p-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Contact</p>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-sm text-slate-700"><Phone className="h-4 w-4 text-slate-400" /> {lead.phone || "—"}</div>
                  <div className="flex items-center gap-2 text-sm text-slate-700"><Mail className="h-4 w-4 text-slate-400" /> {lead.email || "—"}</div>
                </div>
              </div>
              {lead.notes && (
                <div className="rounded-lg border border-slate-200 p-4">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Notes</p>
                  <p className="text-sm text-slate-600">{lead.notes}</p>
                </div>
              )}
              {lead.assigned_physio_name && (
                <div className="rounded-lg border border-sky-200 bg-sky-50 p-4">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-sky-500">Assigned Jr. Physio</p>
                  <p className="text-sm font-medium text-sky-700">{lead.assigned_physio_name}</p>
                </div>
              )}

              {/* Stage Pipeline */}
              <div className="rounded-lg border border-slate-200 p-4" data-testid="branch-lead-pipeline">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Pipeline Stage</p>
                <div className="flex flex-wrap gap-1.5">
                  {BRANCH_STAGES.map((stage) => {
                    const isActive = lead.branch_stage === stage;
                    const color = STAGE_COLORS[stage];
                    return (
                      <button key={stage} type="button" disabled={isActive} onClick={() => moveStage(stage)}
                        className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all ${isActive ? `${color?.bg || "bg-slate-500"} border-transparent text-white` : `${color?.light || "bg-slate-50 text-slate-600 border-slate-200"} hover:shadow-sm`}`}
                        data-testid={`branch-stage-btn-${stage}`}>
                        {stage}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {activeTab === "actions" && (
            <>
              {/* Consultation Fee */}
              <div className="rounded-lg border border-teal-200 bg-teal-50/30 p-4" data-testid="branch-action-consultation-fee">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-teal-700"><CreditCard className="h-3.5 w-3.5" /> Consultation Fee</p>
                {lead.consultation_fee ? (
                  <p className="text-sm font-medium text-teal-800">Collected: Rs.{lead.consultation_fee}</p>
                ) : (
                  <div className="flex gap-2">
                    <Input type="number" value={feeAmount} onChange={(e) => setFeeAmount(e.target.value)} placeholder="Amount (Rs.)" className="w-40" data-testid="branch-consultation-fee-input" />
                    <Button size="sm" onClick={collectConsultationFee} className="bg-teal-600 text-white hover:bg-teal-700" data-testid="branch-consultation-fee-btn">Collect</Button>
                  </div>
                )}
              </div>

              {/* Head Physio Appointment */}
              <div className="rounded-lg border border-violet-200 bg-violet-50/30 p-4" data-testid="branch-action-appointment">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-violet-700"><Calendar className="h-3.5 w-3.5" /> Head Physio Appointment</p>
                <div className="space-y-2">
                  <Input type="date" value={selectedDate} onChange={(e) => { setSelectedDate(e.target.value); setSelectedSlot(""); setSelectedDoctorId(""); }} data-testid="branch-appt-date" />
                  {selectedDate && (
                    <div className="grid grid-cols-4 gap-1" data-testid="branch-appt-slots">
                      {generateTimeSlots().map((slot) => {
                        const t = slot.slice(11, 16);
                        return (
                          <button key={slot} type="button" onClick={() => setSelectedSlot(slot)}
                            className={`rounded-md border px-2 py-1.5 text-[11px] font-medium ${selectedSlot === slot ? "border-violet-500 bg-violet-100 text-violet-800" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
                            data-testid={`branch-slot-${t}`}>{t}</button>
                        );
                      })}
                    </div>
                  )}
                  {selectedSlot && (
                    <div className="space-y-1.5" data-testid="branch-appt-doctors">
                      {doctors.map((doc) => {
                        const hasSlot = (doc.slots || []).some((s) => s.startsWith(selectedSlot.slice(0, 16)));
                        return (
                          <button key={doc.id} type="button" onClick={() => hasSlot && setSelectedDoctorId(doc.id)} disabled={!hasSlot}
                            className={`flex w-full items-center gap-3 rounded-md border p-2.5 text-left transition-all ${!hasSlot ? "cursor-not-allowed border-slate-100 bg-slate-50 opacity-40" : selectedDoctorId === doc.id ? "border-violet-400 bg-violet-50 shadow-sm" : "border-slate-200 bg-white hover:bg-slate-50"}`}
                            data-testid={`branch-doctor-${doc.id}`}>
                            <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${hasSlot ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-400"}`}>
                              {doc.full_name?.charAt(0) || "D"}
                            </div>
                            <div className="flex-1">
                              <p className={`text-sm font-medium ${hasSlot ? "text-slate-800" : "text-slate-400"}`}>{doc.full_name}</p>
                              <p className="text-[10px] text-slate-400">{doc.specialization || "Physiotherapist"}</p>
                            </div>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${hasSlot ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-400"}`}>
                              {hasSlot ? "Available" : "Unavailable"}
                            </span>
                          </button>
                        );
                      })}
                      <Button size="sm" onClick={bookNow} disabled={!selectedDoctorId} className="bg-violet-600 text-white hover:bg-violet-700" data-testid="branch-book-btn">Book Appointment</Button>
                    </div>
                  )}
                </div>
              </div>

              {/* Package Payment */}
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/30 p-4" data-testid="branch-action-package">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-emerald-700"><CreditCard className="h-3.5 w-3.5" /> Package Payment</p>
                {lead.package_amount ? (
                  <p className="text-sm font-medium text-emerald-800">Paid: Rs.{lead.package_amount} ({lead.package_weeks || 8} weeks)</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Input type="number" value={packageAmount} onChange={(e) => setPackageAmount(e.target.value)} placeholder="Amount (Rs.)" className="w-32" data-testid="branch-package-amount-input" />
                    <Input type="number" value={packageWeeks} onChange={(e) => setPackageWeeks(e.target.value)} placeholder="Weeks" className="w-20" data-testid="branch-package-weeks-input" />
                    <Button size="sm" onClick={collectPackageFee} className="bg-emerald-600 text-white hover:bg-emerald-700" data-testid="branch-package-pay-btn">Collect Package</Button>
                  </div>
                )}
              </div>

              {/* Jr. Physio Assignment */}
              <div className="rounded-lg border border-sky-200 bg-sky-50/30 p-4" data-testid="branch-action-assign-physio">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-sky-700"><UserPlus className="h-3.5 w-3.5" /> Assign Jr. Physio</p>
                {lead.assigned_physio_name ? (
                  <p className="text-sm font-medium text-sky-800">Assigned: {lead.assigned_physio_name}</p>
                ) : (
                  <div className="space-y-1.5">
                    {allDoctors.filter((d) => d.profile_type === "physio").length === 0 ? (
                      <p className="text-xs text-slate-400">No Jr. Physios in this branch</p>
                    ) : (
                      allDoctors.filter((d) => d.profile_type === "physio").map((doc) => (
                        <button key={doc.id} type="button" onClick={() => setSelectedPhysioId(doc.id)}
                          className={`flex w-full items-center gap-3 rounded-md border p-2.5 text-left ${selectedPhysioId === doc.id ? "border-sky-400 bg-sky-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}
                          data-testid={`branch-physio-${doc.id}`}>
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-100 text-xs font-bold text-sky-700">
                            {doc.full_name?.charAt(0) || "P"}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-slate-800">{doc.full_name}</p>
                            <p className="text-[10px] text-slate-400">{doc.specialization || "Jr. Physiotherapist"}</p>
                          </div>
                        </button>
                      ))
                    )}
                    {allDoctors.filter((d) => d.profile_type === "physio").length > 0 && (
                      <Button size="sm" onClick={assignPhysioNow} disabled={!selectedPhysioId} className="bg-sky-600 text-white hover:bg-sky-700" data-testid="branch-assign-physio-btn">Assign Jr. Physio</Button>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {activeTab === "remarks" && (
            <div className="space-y-3" data-testid="branch-lead-remarks">
              <div className="flex gap-2">
                <Input value={newRemark} onChange={(e) => setNewRemark(e.target.value)} placeholder="Add a remark..." className="flex-1" data-testid="branch-remark-input" />
                <Button size="sm" onClick={addRemarkNow} className="bg-sky-600 text-white hover:bg-sky-700" data-testid="branch-remark-submit">Add</Button>
              </div>
              {remarks.length === 0 ? (
                <p className="py-4 text-center text-sm text-slate-400">No remarks yet</p>
              ) : (
                remarks.map((r) => (
                  <div key={r.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3" data-testid={`branch-remark-${r.id}`}>
                    <p className="text-sm text-slate-700">{r.text}</p>
                    <p className="mt-1 text-[10px] text-slate-400">{r.created_by} · {r.created_at?.slice(0, 16).replace("T", " ")}</p>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === "activity" && (
            <div className="space-y-2" data-testid="branch-lead-activity">
              {activityLog.length === 0 ? (
                <p className="py-4 text-center text-sm text-slate-400">No activity yet</p>
              ) : (
                activityLog.map((a) => (
                  <div key={a.id} className="flex items-start gap-2 rounded-lg border border-slate-100 bg-slate-50 p-3" data-testid={`branch-activity-${a.id}`}>
                    <div className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-sky-100">
                      <Activity className="h-3 w-3 text-sky-600" />
                    </div>
                    <div>
                      <p className="text-sm text-slate-700">{a.details}</p>
                      <p className="text-[10px] text-slate-400">{a.created_by} · {a.created_at?.slice(0, 16).replace("T", " ")}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
