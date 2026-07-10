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
  FileText,
  Wifi,
  MapPin,
  Clock,
  CalendarRange,
  ShoppingCart,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { DateFilterPopover } from "@/components/DateFilterPopover";
import {
  addLeadRemark,
  assignPhysio,
  scheduleBranchAppointment,
  bookAppointment,
  collectFee,
  getAvailableDoctors,
  getBranchBoard,
  getDoctors,
  getAvailableExperts,
  getLeadActivity,
  getLeadRemarks,
  moveBranchStage,
  listStoreItems,
} from "@/lib/api";
import { HeadPhysioCalendar } from "@/components/HeadPhysioCalendar";
import { ConsultationsBoard } from "@/components/ConsultationsBoard";
import { FinanceBoard } from "@/components/FinanceBoard";
import { BranchSessionsPanel, FitsiomaxStorePanel } from "@/components/BranchStoreBoard";
import { SmartBookingPicker } from "@/components/SmartBookingPicker";
import { DURATION_OPTIONS, PlaceholderPanel } from "@/components/PackagesBoard";

const BRANCH_STAGES = [
  "New Appointment",
  "Portfolio",
  "Appointment Date & Time",
  "Cancelled",
];

const STAGE_COLORS = {
  "New Appointment": { bg: "bg-blue-500", light: "bg-blue-50 text-blue-700 border-blue-200", col: "border-blue-200 bg-blue-50/40", text: "text-blue-600", count: "text-blue-700", hex: "#3b82f6" },
  "Portfolio": { bg: "bg-yellow-500", light: "bg-yellow-50 text-yellow-700 border-yellow-200", col: "border-yellow-200 bg-yellow-50/40", text: "text-yellow-600", count: "text-yellow-700", hex: "#eab308" },
  "Appointment Date & Time": { bg: "bg-teal-500", light: "bg-teal-50 text-teal-700 border-teal-200", col: "border-teal-200 bg-teal-50/40", text: "text-teal-600", count: "text-teal-700", hex: "#14b8a6" },
  "Cancelled": { bg: "bg-rose-500", light: "bg-rose-50 text-rose-700 border-rose-200", col: "border-rose-200 bg-rose-50/40", text: "text-rose-600", count: "text-rose-700", hex: "#f43f5e" },
};

export const BranchAdminBoard = ({ branchId }) => {
  const [boardData, setBoardData] = useState({ leads: [], stage_counts: {} });
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLead, setSelectedLead] = useState(null);
  const [activeView, setActiveView] = useState("pipeline");
  const [consultationsSubTab, setConsultationsSubTab] = useState("consultation");
  const [stageFilter, setStageFilter] = useState(null); // null = show all stages
  const [dateFilter, setDateFilter] = useState(null); // { from, to, label, key } | null

  const loadBoard = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    try {
      const data = await getBranchBoard(branchId);
      setBoardData(data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Failed to load branch board");
    }
    setLoading(false);
  }, [branchId]);

  useEffect(() => { loadBoard(); }, [loadBoard]);

  const filteredLeads = useMemo(() => {
    let list = boardData.leads;
    if (dateFilter) {
      const from = dateFilter.from?.getTime();
      const to = dateFilter.to?.getTime();
      list = list.filter((l) => {
        const ts = new Date(l.created_at || 0).getTime();
        if (!ts) return false;
        if (from && ts < from) return false;
        if (to && ts > to) return false;
        return true;
      });
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((l) =>
        l.name?.toLowerCase().includes(q) || l.phone?.includes(q) || l.email?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [boardData.leads, searchQuery, dateFilter]);

  const totalLeads = boardData.leads.length;

  const handleStageUpdate = async () => {
    await loadBoard();
    if (selectedLead) {
      const updated = boardData.leads.find((l) => l.id === selectedLead.id);
      if (updated) setSelectedLead(updated);
    }
  };

  const VIEW_TABS = [
    { key: "pipeline", label: "Appointment Lead", icon: LayoutDashboard },
    { key: "consultations", label: "Consultations", icon: Stethoscope },
    { key: "sessions", label: "Treatment Sessions", icon: CalendarRange },
    { key: "rehab", label: "Rehab", icon: Activity },
    { key: "finance", label: "Finance", icon: CreditCard },
    { key: "store", label: "Fitsiomax Store", icon: ShoppingCart },
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

      {activeView === "consultations" ? (
        <div className="space-y-4" data-testid="branch-consultations-headphysio">
          <div className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-1" data-testid="branch-consultations-subtabs">
            <button
              type="button"
              onClick={() => setConsultationsSubTab("consultation")}
              className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${consultationsSubTab === "consultation" ? "bg-sky-50 text-sky-600" : "text-slate-600 hover:bg-slate-50"}`}
              data-testid="branch-consultations-subtab-consultation"
            >
              <User className="h-4 w-4" />Consultation
            </button>
            <button
              type="button"
              onClick={() => setConsultationsSubTab("head_physio")}
              className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${consultationsSubTab === "head_physio" ? "bg-sky-50 text-sky-600" : "text-slate-600 hover:bg-slate-50"}`}
              data-testid="branch-consultations-subtab-head_physio"
            >
              <Calendar className="h-4 w-4" />Consultant Calendar
            </button>
          </div>
          {consultationsSubTab === "consultation" ? (
            <ConsultationsBoard branchId={branchId} />
          ) : (
            <HeadPhysioCalendar branchId={branchId} />
          )}
        </div>
      ) : activeView === "sessions" ? (
        <BranchSessionsPanel />
      ) : activeView === "rehab" ? (
        <PlaceholderPanel label="Rehab" testid="branch-rehab-panel" />
      ) : activeView === "finance" ? (
        <FinanceBoard />
      ) : activeView === "store" ? (
        <FitsiomaxStorePanel />
      ) : (
        <>
          {/* Stage Head Bar — Pre-Sales style sticky segmented tabs */}
          <div className="sticky top-[88px] z-10 -mx-1 rounded-xl border border-slate-200 bg-white/95 p-1 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/80" data-testid="branch-metrics">
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-7">
              <BranchStageTab
                label="All Stages"
                count={totalLeads}
                active={stageFilter === null}
                onClick={() => setStageFilter(null)}
                color="#0ea5e9"
                testid="branch-metric-total"
              />
              {BRANCH_STAGES.map((stage) => {
                const isActive = stageFilter === stage;
                const colorMap = STAGE_COLORS[stage] || {};
                return (
                  <BranchStageTab
                    key={stage}
                    label={stage}
                    count={boardData.stage_counts?.[stage] || 0}
                    active={isActive}
                    onClick={() => setStageFilter(isActive ? null : stage)}
                    color={colorMap.hex || "#64748b"}
                    testid={`branch-metric-${stage}`}
                  />
                );
              })}
            </div>
          </div>

          {/* Toolbar */}
          <div className="flex items-center gap-3" data-testid="branch-toolbar">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input className="pl-9" placeholder="Search patients..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} data-testid="branch-search" />
            </div>
            <DateFilterPopover value={dateFilter} onChange={setDateFilter} testid="branch-date-filter" />
            {stageFilter && (
              <div className="flex items-center gap-2 text-xs text-slate-600" data-testid="branch-stage-filter-indicator">
                <span>Showing:</span>
                <span className={`rounded-full border px-2 py-0.5 font-medium ${STAGE_COLORS[stageFilter]?.light || ""}`}>{stageFilter}</span>
                <button type="button" onClick={() => setStageFilter(null)} className="text-sky-600 hover:underline" data-testid="branch-stage-filter-clear">Clear</button>
              </div>
            )}
            <Button size="sm" variant="outline" onClick={loadBoard} data-testid="branch-refresh-btn">
              <RefreshCw className="mr-1 h-4 w-4" /> Refresh
            </Button>
          </div>

          {/* List View (table) */}
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white" data-testid="branch-list">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Patient</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">Stage</th>
                  <th className="px-4 py-3">Assigned Physio</th>
                  <th className="px-4 py-3 text-right">Fee / Package</th>
                  <th className="px-4 py-3 text-right">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(() => {
                  const visible = (stageFilter ? filteredLeads.filter((l) => l.branch_stage === stageFilter) : filteredLeads);
                  if (visible.length === 0) {
                    return (
                      <tr>
                        <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-400" data-testid="branch-list-empty">
                          No patients {stageFilter ? `in stage "${stageFilter}"` : "yet"}.
                        </td>
                      </tr>
                    );
                  }
                  return visible.map((lead) => {
                    const stageColor = STAGE_COLORS[lead.branch_stage]?.light || "bg-slate-100 text-slate-600 border-slate-200";
                    return (
                      <tr
                        key={lead.id}
                        onClick={() => setSelectedLead(lead)}
                        className="cursor-pointer transition-colors hover:bg-slate-50"
                        data-testid={`branch-row-${lead.id}`}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-bold text-violet-700">
                              {lead.name?.charAt(0)?.toUpperCase() || "?"}
                            </div>
                            <span className="font-medium text-slate-800">{lead.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{lead.phone || "—"}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${stageColor}`}>
                            {lead.branch_stage || "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{lead.assigned_physio_name || <span className="text-slate-400">—</span>}</td>
                        <td className="px-4 py-3 text-right">
                          {(lead.consultation_fee || lead.package_amount) ? (
                            <div className="flex flex-wrap justify-end gap-1">
                              {lead.consultation_fee && <span className="rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-medium text-teal-700">Fee Rs.{lead.consultation_fee}</span>}
                              {lead.package_amount && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">Pkg Rs.{lead.package_amount}</span>}
                            </div>
                          ) : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-slate-400">{(lead.updated_at || "").slice(0, 10)}</td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
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

const BranchStageTab = ({ label, count, active, onClick, color, testid }) => {
  const tint = color || "#0ea5e9";
  return (
    <button
      onClick={onClick}
      data-testid={testid}
      type="button"
      className="relative flex flex-col items-center justify-center rounded-lg px-3 py-2.5 text-center transition-all hover:shadow-sm"
      style={
        active
          ? { background: tint, color: "#ffffff", boxShadow: `0 2px 8px ${tint}40` }
          : { background: `${tint}14`, color: tint, border: `1px solid ${tint}33` }
      }
    >
      <span className="text-[11px] font-semibold uppercase tracking-wider leading-tight">{label}</span>
      <span className="mt-0.5 text-lg font-bold leading-none">{count}</span>
    </button>
  );
};

/* ─── Consultations & Sessions list (inside lead popup) ─── */
const LeadPackageRow = ({ item, isSession, onBook }) => (
  <div className="flex items-center justify-between gap-3 px-3 py-2.5" data-testid={`lead-package-row-${item.id}`}>
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-semibold text-slate-800">{item.name}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
          <Wifi className="h-3 w-3" />Online ₹{item.price_online ?? 0}{isSession ? ` × ${item.sessions_online ?? 0}` : ""}
        </span>
        <span className="inline-flex items-center gap-1 font-semibold text-amber-700">
          <MapPin className="h-3 w-3" />Offline ₹{item.price_offline ?? 0}{isSession ? ` × ${item.sessions_offline ?? 0}` : ""}
        </span>
        {!isSession && item.duration_minutes && (
          <span className="inline-flex items-center gap-1 text-slate-500">
            <Clock className="h-3 w-3" />
            {DURATION_OPTIONS.find((d) => d.minutes === item.duration_minutes)?.label || `${item.duration_minutes} mins`}
          </span>
        )}
      </div>
    </div>
    <Button size="sm" onClick={() => onBook(item)} className="shrink-0 bg-emerald-600 text-white hover:bg-emerald-700" data-testid={`lead-package-book-${item.id}`}>
      Book
    </Button>
  </div>
);

const LeadPackagesTab = () => {
  const [consultations, setConsultations] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      listStoreItems("physiotherapy", "consultation").catch(() => []),
      listStoreItems("physiotherapy", "session").catch(() => []),
    ]).then(([c, s]) => {
      setConsultations(c);
      setSessions(s);
      setLoading(false);
    });
  }, []);

  const handleBook = (item) => toast.info(`Booking "${item.name}" — coming soon`);

  if (loading) {
    return <p className="py-6 text-center text-sm text-slate-400">Loading packages...</p>;
  }

  return (
    <div className="space-y-4" data-testid="branch-lead-packages-tab">
      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wider text-sky-700">Consultations</p>
        {consultations.length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-white py-4 text-center text-xs text-slate-400">No consultations available.</p>
        ) : (
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white" data-testid="lead-consultations-list">
            {consultations.map((it) => <LeadPackageRow key={it.id} item={it} isSession={false} onBook={handleBook} />)}
          </div>
        )}
      </div>

      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wider text-emerald-700">Sessions</p>
        {sessions.length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-white py-4 text-center text-xs text-slate-400">No session packages available.</p>
        ) : (
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white" data-testid="lead-sessions-list">
            {sessions.map((it) => <LeadPackageRow key={it.id} item={it} isSession onBook={handleBook} />)}
          </div>
        )}
      </div>
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
  const [apptDraft, setApptDraft] = useState(null); // { appointment_date, appointment_time, physio_id, notes, final_stage } | null
  const [apptExperts, setApptExperts] = useState({ experts: [], available_count: 0, busy_count: 0, loading: false });

  const fetchAvailableExperts = useCallback(async (branch, dateStr, timeStr) => {
    if (!branch || !dateStr || !timeStr) return;
    setApptExperts((p) => ({ ...p, loading: true }));
    try {
      const res = await getAvailableExperts(branch, dateStr, timeStr);
      setApptExperts({
        experts: res.experts || [],
        available_count: res.available_count || 0,
        busy_count: res.busy_count || 0,
        loading: false,
      });
      setApptDraft((curr) => {
        if (!curr || !curr.physio_id) return curr;
        const stillAvail = (res.experts || []).some((dd) => dd.id === curr.physio_id);
        return stillAvail ? curr : { ...curr, physio_id: "" };
      });
    } catch {
      setApptExperts({ experts: [], available_count: 0, busy_count: 0, loading: false });
    }
  }, []);

  useEffect(() => {
    if (!apptDraft || !apptDraft.appointment_date || !apptDraft.appointment_time || !branchId) return;
    fetchAvailableExperts(branchId, apptDraft.appointment_date, apptDraft.appointment_time);
  }, [apptDraft?.appointment_date, apptDraft?.appointment_time, branchId, fetchAvailableExperts]);
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
    { key: "overview", label: "Overview", color: "bg-sky-500" },
    { key: "packages", label: "Consultations & Sessions", color: "bg-emerald-500" },
    { key: "actions", label: "Actions", color: "bg-violet-500" },
    { key: "remarks", label: "Remarks", color: "bg-amber-500" },
    { key: "activity", label: "Activity", color: "bg-rose-500" },
  ];

  const stageColorMap = STAGE_COLORS[lead.branch_stage] || {};
  const avatarFirstChar = (lead.name?.trim()?.charAt(0) || "?").toUpperCase();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} data-testid="branch-lead-modal-overlay">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200" data-testid="branch-lead-modal">
        {/* Gradient header */}
        <div className="relative bg-gradient-to-r from-sky-500 via-indigo-500 to-violet-500 px-5 py-4 text-white">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/95 text-base font-bold text-indigo-600 shadow-md">{avatarFirstChar}</span>
              <div>
                <p className="text-base font-semibold leading-tight" data-testid="branch-lead-name">{lead.name}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-white/95 px-2.5 py-0.5 text-[11px] font-semibold text-slate-700" data-testid="branch-lead-stage">
                    {lead.branch_stage || "No Stage"}
                  </span>
                  {lead.consultation_fee && <span className="rounded-full bg-teal-100/95 px-2 py-0.5 text-[10px] font-semibold text-teal-800">Fee Rs.{lead.consultation_fee}</span>}
                  {lead.package_amount && <span className="rounded-full bg-emerald-100/95 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">Pkg Rs.{lead.package_amount}</span>}
                </div>
              </div>
            </div>
            <button onClick={onClose} className="rounded-full p-1.5 text-white/80 hover:bg-white/20" data-testid="branch-lead-close">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Pill tabs */}
        <div className="flex flex-wrap gap-1.5 border-b border-slate-100 bg-slate-50/60 px-5 py-2.5" data-testid="branch-lead-tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`rounded-full px-3.5 py-1 text-xs font-semibold capitalize transition-all ${activeTab === t.key ? `${t.color} text-white shadow-sm` : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200"}`}
              data-testid={`branch-lead-tab-${t.key}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto bg-slate-50/30 p-5" data-testid="branch-lead-content">
          {activeTab === "overview" && (
            <div className="space-y-3">
              <div className="overflow-hidden rounded-xl border border-sky-100 bg-white shadow-sm">
                <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-100 text-sky-600"><Phone className="h-4 w-4" /></span>
                  <p className="text-xs font-bold uppercase tracking-wider text-sky-700">Contact</p>
                </div>
                <div className="space-y-2 px-4 py-3">
                  <div className="flex items-center justify-between text-sm"><span className="text-xs font-medium text-slate-500">Phone</span><span className="font-medium text-slate-800">{lead.phone || "—"}</span></div>
                  <div className="flex items-center justify-between text-sm"><span className="text-xs font-medium text-slate-500">Email</span><span className="font-medium text-slate-800">{lead.email || "—"}</span></div>
                </div>
              </div>

              {lead.assigned_physio_name && (
                <div className="overflow-hidden rounded-xl border border-emerald-100 bg-white shadow-sm">
                  <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700"><UserPlus className="h-4 w-4" /></span>
                    <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">Assigned Jr. Physio</p>
                  </div>
                  <p className="px-4 py-3 text-sm font-medium text-slate-800">{lead.assigned_physio_name}</p>
                </div>
              )}

              {lead.notes && (
                <div className="overflow-hidden rounded-xl border border-amber-100 bg-white shadow-sm">
                  <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 text-amber-700"><FileText className="h-4 w-4" /></span>
                    <p className="text-xs font-bold uppercase tracking-wider text-amber-700">Notes</p>
                  </div>
                  <p className="px-4 py-3 text-sm leading-relaxed text-slate-700">{lead.notes}</p>
                </div>
              )}

              {/* Stage Pipeline */}
              <div className="overflow-hidden rounded-xl border border-violet-100 bg-white shadow-sm" data-testid="branch-lead-pipeline">
                <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-100 text-violet-700"><ChevronRight className="h-4 w-4" /></span>
                  <p className="text-xs font-bold uppercase tracking-wider text-violet-700">Pipeline Stage</p>
                </div>
                <div className="flex flex-wrap gap-2 px-4 py-3">
                  {BRANCH_STAGES.map((stage) => {
                    const isActive = lead.branch_stage === stage;
                    const c = STAGE_COLORS[stage] || {};
                    const handleClick = () => {
                      if (stage === "Appointment Date & Time") {
                        setApptDraft({
                          appointment_date: lead.appointment_date || new Date(Date.now() + 86400000).toISOString().slice(0, 10),
                          appointment_time: lead.appointment_time || "10:00",
                          physio_id: lead.assigned_physio_id || "",
                          notes: "",
                          final_stage: "Appointment Date & Time",
                        });
                        return;
                      }
                      moveStage(stage);
                    };
                    return (
                      <button
                        key={stage}
                        type="button"
                        disabled={isActive}
                        onClick={handleClick}
                        className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all hover:shadow-md disabled:cursor-not-allowed disabled:opacity-90 ${isActive ? `${c.bg || "bg-slate-500"} text-white shadow-sm` : `${c.light || "bg-slate-100 text-slate-600 border border-slate-200"}`}`}
                        data-testid={`branch-stage-btn-${stage}`}
                      >
                        {stage}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {activeTab === "packages" && <LeadPackagesTab />}

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

      {/* Appointment Date & Time Popup */}
      {apptDraft && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) setApptDraft(null); }} data-testid="branch-appt-modal">
          <div className="w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between bg-gradient-to-r from-teal-500 to-cyan-600 px-5 py-4 text-white">
              <div className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                <p className="text-base font-semibold">Appointment Date & Time</p>
              </div>
              <button onClick={() => setApptDraft(null)} className="rounded-full p-1.5 text-white/80 hover:bg-white/20" data-testid="branch-appt-close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 p-5">
              <SmartBookingPicker
                branchId={branchId}
                value={{
                  appointment_date: apptDraft.appointment_date,
                  appointment_time: apptDraft.appointment_time,
                  physio_id: apptDraft.physio_id,
                }}
                onChange={(v) => setApptDraft({ ...apptDraft, ...v })}
              />
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Notes</label>
                <textarea
                  rows={3}
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
                  placeholder="Optional notes about the appointment..."
                  value={apptDraft.notes}
                  onChange={(e) => setApptDraft({ ...apptDraft, notes: e.target.value })}
                  data-testid="branch-appt-notes"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Move to *</label>
                <select
                  value={apptDraft.final_stage}
                  onChange={(e) => setApptDraft({ ...apptDraft, final_stage: e.target.value })}
                  className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
                  data-testid="branch-appt-final-stage"
                >
                  <option value="Appointment Date & Time">Appointment Date & Time</option>
                  <option value="Cancelled">Cancelled</option>
                </select>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/40 px-5 py-3">
              <Button variant="outline" onClick={() => setApptDraft(null)} data-testid="branch-appt-cancel">Cancel</Button>
              <Button
                className="bg-teal-600 text-white hover:bg-teal-700"
                onClick={async () => {
                  if (!apptDraft.appointment_date || !apptDraft.appointment_time) { toast.error("Date and time are required"); return; }
                  if (!apptDraft.physio_id) { toast.error("Please select a physio"); return; }
                  try {
                    await scheduleBranchAppointment(lead.id, apptDraft);
                    toast.success(`Appointment ${apptDraft.appointment_date} ${apptDraft.appointment_time} → ${apptDraft.final_stage}`);
                    setApptDraft(null);
                    await reloadBoard();
                    onClose && onClose();
                  } catch (e) { toast.error(e?.response?.data?.detail || "Failed to schedule"); }
                }}
                data-testid="branch-appt-save"
              >
                Save & Move
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
