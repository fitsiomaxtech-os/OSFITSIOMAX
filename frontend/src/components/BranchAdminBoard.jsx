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
  LayoutDashboard,
  FileText,
  CalendarRange,
  ShoppingCart,
  ClipboardList,
  Bell,
  MessageSquare,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { DateFilterPopover } from "@/components/DateFilterPopover";
import { StageTabBar } from "@/components/ui/stage-tab";
import {
  addLeadRemark,
  scheduleBranchAppointment,
  getBranchBoard,
  getAvailableExperts,
  getLeadActivity,
  getLeadRemarks,
  moveBranchStage,
  stagesList,
  scheduleBranchFollowUp,
  rescheduleBranchFollowUp,
} from "@/lib/api";
import { HeadPhysioCalendar } from "@/components/HeadPhysioCalendar";
import { ConsultationsBoard } from "@/components/ConsultationsBoard";
import { FinanceBoard } from "@/components/FinanceBoard";
import { BranchSessionsPanel, FitsiomaxStorePanel } from "@/components/BranchStoreBoard";
import { PullFromSheetButton } from "@/components/PullFromSheetButton";
import { PlaceholderPanel } from "@/components/PackagesBoard";

export const BranchAdminBoard = ({ branchId }) => {
  const [boardData, setBoardData] = useState({ leads: [], stage_counts: {} });
  const [stages, setStages] = useState([]); // dynamic Branch Stages, from Super Admin > Pipeline Stage Management
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLead, setSelectedLead] = useState(null);
  const [activeView, setActiveView] = useState("pipeline");
  const [consultationsSubTab, setConsultationsSubTab] = useState("consultation");
  const [stageFilter, setStageFilter] = useState(null); // null = show all stages
  const [dateFilter, setDateFilter] = useState(null); // { from, to, label, key } | null

  const loadBoard = useCallback(async () => {
    if (!branchId) return null;
    setLoading(true);
    let data = null;
    try {
      data = await getBranchBoard(branchId);
      setBoardData(data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Failed to load branch board");
    }
    setLoading(false);
    return data;
  }, [branchId]);

  useEffect(() => { loadBoard(); }, [loadBoard]);
  useEffect(() => { stagesList("sales").then(setStages).catch(() => {}); }, []);

  const stageColor = useCallback(
    (name) => stages.find((s) => s.name === name)?.color || "#64748b",
    [stages],
  );

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

  // "All Stages" is just the total lead count for this branch — every lead the branch has,
  // regardless of which stage it currently sits in. (The backend now always stamps a lead's
  // branch_stage with a currently-valid stage name, so this naturally stays in sync with the
  // sum of the individual stage pills too.)
  const totalLeads = boardData.leads.length;

  const handleStageUpdate = async () => {
    const data = await loadBoard();
    if (selectedLead && data) {
      const updated = data.leads.find((l) => l.id === selectedLead.id);
      if (updated) setSelectedLead(updated);
    }
  };

  const VIEW_TABS = [
    { key: "pipeline", label: "Branch Leads", icon: LayoutDashboard },
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
            <ConsultationsBoard branchId={branchId} viewerRole="branch_admin" />
          ) : (
            <HeadPhysioCalendar branchId={branchId} />
          )}
        </div>
      ) : activeView === "sessions" ? (
        <BranchSessionsPanel />
      ) : activeView === "rehab" ? (
        <PlaceholderPanel label="Rehab" testid="branch-rehab-panel" />
      ) : activeView === "finance" ? (
        <FinanceBoard branchId={branchId} />
      ) : activeView === "store" ? (
        <FitsiomaxStorePanel />
      ) : (
        <>
          <div data-testid="branch-pipeline-header">
            <h2 className="text-2xl font-bold text-slate-900">Branch Leads</h2>
            <p className="text-sm text-slate-500">Track patients from first appointment through to their stage in your branch.</p>
          </div>

          {/* Stage Head Bar — Pre-Sales style sticky segmented tabs */}
          <StageTabBar
            stages={stages}
            stageFilter={stageFilter}
            setStageFilter={setStageFilter}
            counts={boardData.stage_counts}
            totalCount={totalLeads}
            testid="branch-metric"
          />

          {/* Toolbar */}
          <div className="flex items-center gap-3" data-testid="branch-toolbar">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input className="pl-9" placeholder="Search patients..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} data-testid="branch-search" />
            </div>
            <DateFilterPopover value={dateFilter} onChange={setDateFilter} testid="branch-date-filter" />
            <PullFromSheetButton
              onPulled={loadBoard}
              notConnectedHint="Google Sheets isn't connected yet — ask your Super Admin to connect it."
              noSourcesHint="No Google Sheet is linked to this branch yet — ask your Super Admin to tag one to this branch in Marketing Board → Lead Sources."
            />
            {stageFilter && (
              <div className="flex items-center gap-2 text-xs text-slate-600" data-testid="branch-stage-filter-indicator">
                <span>Showing:</span>
                <span
                  className="rounded-full border px-2 py-0.5 font-medium"
                  style={{ background: `${stageColor(stageFilter)}14`, color: stageColor(stageFilter), border: `1px solid ${stageColor(stageFilter)}33` }}
                >
                  {stageFilter}
                </span>
                <button type="button" onClick={() => setStageFilter(null)} className="text-sky-600 hover:underline" data-testid="branch-stage-filter-clear">Clear</button>
              </div>
            )}
          </div>

          {/* List View (table) */}
          <div className="rounded-lg border border-slate-200 bg-white" data-testid="branch-list">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="sticky top-[89px] z-10 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
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
                    const rowStageHex = lead.branch_stage ? stageColor(lead.branch_stage) : null;
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
                          <span
                            className="inline-flex items-center rounded-[5px] border px-2.5 py-0.5 text-xs font-medium"
                            style={rowStageHex ? { background: `${rowStageHex}14`, color: rowStageHex, border: `1px solid ${rowStageHex}33` } : { background: "#f1f5f9", color: "#475569", border: "1px solid #e2e8f0" }}
                          >
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
          stages={stages}
          onClose={() => setSelectedLead(null)}
          onUpdate={handleStageUpdate}
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
function BranchLeadModal({ lead, branchId, stages, onClose, onUpdate }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [remarks, setRemarks] = useState([]);
  const [newRemark, setNewRemark] = useState("");
  const [activityLog, setActivityLog] = useState([]);

  const [apptDraft, setApptDraft] = useState(null); // { appointment_date, appointment_time, physio_id, notes, final_stage } | null
  const [apptExperts, setApptExperts] = useState({ experts: [], available_count: 0, busy_count: 0, loading: false });

  // Follow-up scheduling
  const tomorrowIso = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const [followUpForm, setFollowUpForm] = useState({ date: tomorrowIso(), time: "10:00", remarks: "" });
  const [rescheduleDraft, setRescheduleDraft] = useState(null); // { followupId, date, time, reason } | null
  const [followUpBusy, setFollowUpBusy] = useState(false);

  // "Move to Stage" popup for Follow Up (mirrors Appointment Date & Time's popup pattern)
  const [followUpMoveDraft, setFollowUpMoveDraft] = useState(null); // { date, time, remarks } | null
  const [followUpMoveBusy, setFollowUpMoveBusy] = useState(false);

  const fetchAvailableExperts = useCallback(async (branch, dateStr) => {
    if (!branch || !dateStr) return;
    setApptExperts((p) => ({ ...p, loading: true }));
    try {
      const res = await getAvailableExperts(branch, dateStr);
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
    if (!apptDraft || !apptDraft.appointment_date || !branchId) return;
    fetchAvailableExperts(branchId, apptDraft.appointment_date);
  }, [apptDraft?.appointment_date, branchId, fetchAvailableExperts]);

  useEffect(() => {
    if (activeTab === "history") { loadRemarks(); loadActivity(); }
  }, [activeTab, lead.id]);

  const loadRemarks = async () => {
    try { setRemarks(await getLeadRemarks(lead.id)); } catch { /* silent */ }
  };
  const loadActivity = async () => {
    try { setActivityLog(await getLeadActivity(lead.id)); } catch { /* silent */ }
  };

  const moveStage = async (stage) => {
    try {
      const updated = await moveBranchStage(lead.id, { branch_stage: stage });
      toast.success(`Moved to ${stage}`);
      await onUpdate();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Move failed");
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

  const submitFollowUp = async () => {
    if (!followUpForm.date || !followUpForm.time) { toast.error("Date and time are required"); return; }
    try {
      setFollowUpBusy(true);
      await scheduleBranchFollowUp(lead.id, followUpForm);
      toast.success("Follow-up scheduled");
      setFollowUpForm({ date: tomorrowIso(), time: "10:00", remarks: "" });
      await onUpdate();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to schedule follow-up");
    } finally {
      setFollowUpBusy(false);
    }
  };

  const submitReschedule = async () => {
    if (!rescheduleDraft?.date || !rescheduleDraft?.time) { toast.error("Date and time are required"); return; }
    try {
      setFollowUpBusy(true);
      await rescheduleBranchFollowUp(lead.id, rescheduleDraft.followupId, {
        date: rescheduleDraft.date,
        time: rescheduleDraft.time,
        reason: rescheduleDraft.reason,
      });
      toast.success("Follow-up rescheduled");
      setRescheduleDraft(null);
      await onUpdate();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to reschedule");
    } finally {
      setFollowUpBusy(false);
    }
  };

  const submitFollowUpMove = async () => {
    if (!followUpMoveDraft?.date || !followUpMoveDraft?.time) { toast.error("Date and time are required"); return; }
    try {
      setFollowUpMoveBusy(true);
      await scheduleBranchFollowUp(lead.id, followUpMoveDraft);
      toast.success("Moved to Follow Up");
      setFollowUpMoveDraft(null);
      await onUpdate();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to schedule");
    } finally {
      setFollowUpMoveBusy(false);
    }
  };

  const TABS = [
    { key: "overview", label: "Overview", color: "bg-sky-500" },
    { key: "history", label: "History", color: "bg-violet-500" },
    { key: "follow-up", label: "Follow-Up", color: "bg-amber-500" },
    { key: "portfolio", label: "Portfolio", color: "bg-emerald-500" },
  ];

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

              {(lead.appointment_department || lead.appointment_mode || lead.diagnosis) && (
                <div className="overflow-hidden rounded-xl border border-blue-100 bg-white shadow-sm" data-testid="branch-lead-appointment-details">
                  <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-100 text-blue-700"><ClipboardList className="h-4 w-4" /></span>
                    <p className="text-xs font-bold uppercase tracking-wider text-blue-700">Appointment Details</p>
                  </div>
                  <div className="space-y-2 px-4 py-3">
                    {lead.appointment_department && (
                      <div className="flex items-center justify-between text-sm"><span className="text-xs font-medium text-slate-500">Service</span><span className="font-medium capitalize text-slate-800">{lead.appointment_department === "physio" ? "Physiotherapy" : "Fitness"}</span></div>
                    )}
                    {lead.appointment_mode && (
                      <div className="flex items-center justify-between text-sm"><span className="text-xs font-medium text-slate-500">Type</span><span className="font-medium capitalize text-slate-800">{lead.appointment_mode}</span></div>
                    )}
                    {lead.diagnosis && (
                      <div className="text-sm"><span className="text-xs font-medium text-slate-500">Diagnosis</span><p className="mt-0.5 font-medium text-slate-800">{lead.diagnosis}</p></div>
                    )}
                  </div>
                </div>
              )}

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
                  {(stages || []).map((s) => {
                    const stage = s.name;
                    const isActive = lead.branch_stage === stage;
                    const tint = s.color || "#64748b";
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
                      if (stage === "Follow Up") {
                        setFollowUpMoveDraft({ date: tomorrowIso(), time: "10:00", remarks: "" });
                        return;
                      }
                      moveStage(stage);
                    };
                    return (
                      <button
                        key={s.id}
                        type="button"
                        disabled={isActive}
                        onClick={handleClick}
                        className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-all hover:shadow-md disabled:cursor-not-allowed disabled:opacity-90"
                        style={isActive ? { background: tint, color: "#ffffff" } : { background: `${tint}14`, color: tint, border: `1px solid ${tint}33` }}
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

          {activeTab === "history" && (
            <div className="space-y-3" data-testid="branch-lead-history">
              <div className="flex gap-2">
                <Input value={newRemark} onChange={(e) => setNewRemark(e.target.value)} placeholder="Add a remark..." className="flex-1" data-testid="branch-remark-input" />
                <Button size="sm" onClick={addRemarkNow} className="bg-sky-600 text-white hover:bg-sky-700" data-testid="branch-remark-submit">Add</Button>
              </div>
              {(() => {
                const combined = [
                  ...remarks.map((r) => ({ ...r, _kind: "remark" })),
                  ...activityLog.map((a) => ({ ...a, _kind: "activity" })),
                ].sort((x, y) => new Date(y.created_at) - new Date(x.created_at));
                if (combined.length === 0) return <p className="py-4 text-center text-sm text-slate-400">No history yet</p>;
                return combined.map((h) => (
                  <div
                    key={`${h._kind}-${h.id}`}
                    className={`flex items-start gap-2 rounded-lg border p-3 ${h._kind === "remark" ? "border-amber-100 bg-amber-50/50" : "border-slate-100 bg-slate-50"}`}
                    data-testid={`branch-history-${h._kind}-${h.id}`}
                  >
                    <div className={`mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full ${h._kind === "remark" ? "bg-amber-100" : "bg-sky-100"}`}>
                      {h._kind === "remark" ? <MessageSquare className="h-3 w-3 text-amber-600" /> : <Activity className="h-3 w-3 text-sky-600" />}
                    </div>
                    <div>
                      <p className="text-sm text-slate-700">{h._kind === "remark" ? h.text : h.details}</p>
                      <p className="mt-1 text-[10px] text-slate-400">{h.created_by} · {h.created_at?.slice(0, 16).replace("T", " ")}</p>
                    </div>
                  </div>
                ));
              })()}
            </div>
          )}

          {activeTab === "follow-up" && (
            <div className="space-y-4" data-testid="branch-lead-followup">
              <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-4" data-testid="branch-followup-form">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-amber-700"><Bell className="h-3.5 w-3.5" /> Schedule Follow-Up</p>
                <div className="flex flex-wrap items-end gap-2">
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-slate-500">Date</label>
                    <Input type="date" value={followUpForm.date} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setFollowUpForm({ ...followUpForm, date: e.target.value })} className="w-40" data-testid="branch-followup-date" />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-slate-500">Time</label>
                    <Input type="time" value={followUpForm.time} onChange={(e) => setFollowUpForm({ ...followUpForm, time: e.target.value })} className="w-32" data-testid="branch-followup-time" />
                  </div>
                  <Input value={followUpForm.remarks} onChange={(e) => setFollowUpForm({ ...followUpForm, remarks: e.target.value })} placeholder="Remarks (optional)" className="min-w-[10rem] flex-1" data-testid="branch-followup-remarks" />
                  <Button size="sm" onClick={submitFollowUp} disabled={followUpBusy} className="bg-amber-600 text-white hover:bg-amber-700" data-testid="branch-followup-submit">Schedule</Button>
                </div>
              </div>

              {(lead.follow_ups || []).length === 0 ? (
                <p className="py-4 text-center text-sm text-slate-400">No follow-ups scheduled yet</p>
              ) : (
                <div className="space-y-2">
                  {(lead.follow_ups || []).slice().reverse().map((f, idx) => {
                    const dt = new Date(`${f.date}T${f.time}:00`);
                    const isUpcoming = dt.getTime() > Date.now();
                    const isRescheduled = f.status === "rescheduled";
                    const isActive = idx === 0 && !isRescheduled;
                    return (
                      <div key={f.id} className={`flex items-start gap-3 rounded-lg border p-3 ${isRescheduled ? "border-slate-200 bg-slate-50/70 opacity-70" : isUpcoming ? "border-emerald-200 bg-emerald-50/40" : "border-slate-200 bg-white"}`} data-testid={`branch-followup-row-${f.id}`}>
                        <span className={`mt-0.5 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full ${isRescheduled ? "bg-slate-100 text-slate-400" : isUpcoming ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                          <Bell className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className={`text-sm font-semibold ${isRescheduled ? "text-slate-500 line-through decoration-slate-300" : "text-slate-800"}`}>
                              {dt.toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short", year: "numeric" })} · {f.time}
                            </p>
                            {isRescheduled && <span className="rounded-full bg-slate-300 px-2 py-0.5 text-[10px] font-bold text-white">RESCHEDULED</span>}
                            {!isRescheduled && isUpcoming && <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold text-white">UPCOMING</span>}
                          </div>
                          {f.remarks && <div className="mt-1.5 rounded-md bg-white px-2.5 py-1.5 text-sm text-slate-700 ring-1 ring-slate-100">{f.remarks}</div>}
                          {isRescheduled && f.reschedule_reason && (
                            <div className="mt-1.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700 ring-1 ring-amber-100"><span className="font-semibold">Reschedule reason:</span> {f.reschedule_reason}</div>
                          )}
                          <p className="mt-1.5 text-[11px] text-slate-400">Set by {f.created_by || "—"}</p>
                        </div>
                        {isActive && (
                          <Button size="sm" variant="outline" className="h-8 flex-shrink-0 border-amber-200 text-amber-700 hover:bg-amber-50" onClick={() => setRescheduleDraft({ followupId: f.id, date: f.date, time: f.time, reason: "" })} data-testid={`branch-followup-reschedule-${f.id}`}>
                            Reschedule
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {rescheduleDraft && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-4" data-testid="branch-followup-reschedule-form">
                  <p className="mb-2 text-xs font-semibold text-amber-700">Reschedule Follow-Up</p>
                  <div className="flex flex-wrap items-end gap-2">
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-slate-500">New Date</label>
                      <Input type="date" value={rescheduleDraft.date} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setRescheduleDraft({ ...rescheduleDraft, date: e.target.value })} className="w-40" data-testid="branch-followup-reschedule-date" />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-slate-500">New Time</label>
                      <Input type="time" value={rescheduleDraft.time} onChange={(e) => setRescheduleDraft({ ...rescheduleDraft, time: e.target.value })} className="w-32" data-testid="branch-followup-reschedule-time" />
                    </div>
                    <Input value={rescheduleDraft.reason} onChange={(e) => setRescheduleDraft({ ...rescheduleDraft, reason: e.target.value })} placeholder="Reason (optional)" className="min-w-[10rem] flex-1" data-testid="branch-followup-reschedule-reason" />
                    <Button size="sm" variant="outline" onClick={() => setRescheduleDraft(null)} data-testid="branch-followup-reschedule-cancel">Cancel</Button>
                    <Button size="sm" onClick={submitReschedule} disabled={followUpBusy} className="bg-amber-600 text-white hover:bg-amber-700" data-testid="branch-followup-reschedule-save">Save</Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === "portfolio" && (
            <div className="flex min-h-[200px] items-center justify-center" data-testid="branch-lead-portfolio">
              <p className="text-sm text-slate-400">Portfolio — coming soon</p>
            </div>
          )}
        </div>
      </div>

      {/* Appointment Date & Time Popup */}
      {apptDraft && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) setApptDraft(null); }} data-testid="branch-appt-modal">
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl max-h-[90vh] overflow-y-auto">
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
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Date *</label>
                <Input type="date" value={apptDraft.appointment_date} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setApptDraft({ ...apptDraft, appointment_date: e.target.value })} data-testid="branch-appt-date" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Time *</label>
                <Input type="time" value={apptDraft.appointment_time} onChange={(e) => setApptDraft({ ...apptDraft, appointment_time: e.target.value })} data-testid="branch-appt-time" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Experts *</label>
                <p className="mb-1.5 text-[11px] text-slate-400">Showing experts available on this date.</p>
                {apptExperts.loading ? (
                  <p className="text-xs text-slate-400">Checking availability...</p>
                ) : apptExperts.experts.length === 0 ? (
                  <p className="text-xs text-slate-400">No experts available on this date.</p>
                ) : (
                  <div className="space-y-1.5">
                    {apptExperts.experts.map((doc) => (
                      <button
                        key={doc.id}
                        type="button"
                        onClick={() => setApptDraft({ ...apptDraft, physio_id: doc.id })}
                        className={`flex w-full items-center gap-3 rounded-md border p-2.5 text-left ${apptDraft.physio_id === doc.id ? "border-teal-400 bg-teal-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}
                        data-testid={`branch-appt-expert-${doc.id}`}
                      >
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-100 text-xs font-bold text-teal-700">
                          {doc.full_name?.charAt(0) || "E"}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-800">{doc.full_name}</p>
                          <p className="text-[10px] text-slate-400">{doc.specialization || doc.profile_type || "Expert"}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
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
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={apptDraft.final_stage === "Cancelled"}
                  onChange={(e) => setApptDraft({ ...apptDraft, final_stage: e.target.checked ? "Cancelled" : "Appointment Date & Time" })}
                  data-testid="branch-appt-cancel-toggle"
                />
                Cancelled
              </label>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/40 px-5 py-3">
              <Button variant="outline" onClick={() => setApptDraft(null)} data-testid="branch-appt-cancel">Cancel</Button>
              <Button
                className="bg-teal-600 text-white hover:bg-teal-700"
                onClick={async () => {
                  if (!apptDraft.appointment_date || !apptDraft.appointment_time) { toast.error("Date and time are required"); return; }
                  if (!apptDraft.physio_id) { toast.error("Please select an expert"); return; }
                  try {
                    await scheduleBranchAppointment(lead.id, apptDraft);
                    toast.success(`Appointment ${apptDraft.appointment_date} ${apptDraft.appointment_time} → ${apptDraft.final_stage}`);
                    setApptDraft(null);
                    await onUpdate();
                    onClose && onClose();
                  } catch (e) { toast.error(e?.response?.data?.detail || "Failed to schedule"); }
                }}
                data-testid="branch-appt-save"
              >
                Confirm
              </Button>
            </div>
          </div>
        </div>
      )}


      {/* Follow Up Date & Time Popup (triggered from Move to Stage) */}
      {followUpMoveDraft && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) setFollowUpMoveDraft(null); }} data-testid="branch-followup-move-modal">
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-4 text-white">
              <div className="flex items-center gap-2">
                <Bell className="h-5 w-5" />
                <p className="text-base font-semibold">Follow Up — Date & Time</p>
              </div>
              <button onClick={() => setFollowUpMoveDraft(null)} className="rounded-full p-1.5 text-white/80 hover:bg-white/20" data-testid="branch-followup-move-close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 p-5">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Date *</label>
                <Input type="date" value={followUpMoveDraft.date} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setFollowUpMoveDraft({ ...followUpMoveDraft, date: e.target.value })} data-testid="branch-followup-move-date" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Time *</label>
                <Input type="time" value={followUpMoveDraft.time} onChange={(e) => setFollowUpMoveDraft({ ...followUpMoveDraft, time: e.target.value })} data-testid="branch-followup-move-time" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Remarks</label>
                <textarea
                  rows={3}
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
                  placeholder="Optional remarks..."
                  value={followUpMoveDraft.remarks}
                  onChange={(e) => setFollowUpMoveDraft({ ...followUpMoveDraft, remarks: e.target.value })}
                  data-testid="branch-followup-move-remarks"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/40 px-5 py-3">
              <Button variant="outline" onClick={() => setFollowUpMoveDraft(null)} data-testid="branch-followup-move-cancel">Cancel</Button>
              <Button className="bg-amber-600 text-white hover:bg-amber-700" onClick={submitFollowUpMove} disabled={followUpMoveBusy} data-testid="branch-followup-move-save">Save & Move</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
