import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Calendar,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Phone,
  Mail,
  Search,
  Stethoscope,
  UserPlus,
  X,
  Activity,
  LayoutDashboard,
  FileText,
  ShoppingCart,
  ClipboardList,
  Bell,
  BadgeIndianRupee,
  UserCog,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { DateFilterPopover } from "@/components/DateFilterPopover";
import { StageTabBar, stageDisplayLabel } from "@/components/ui/stage-tab";
import {
  scheduleBranchAppointment,
  getBranchBoard,
  getAvailableExperts,
  getAvailableDates,
  getLeadActivity,
  getLeadRemarks,
  moveBranchStage,
  stagesList,
  scheduleBranchFollowUp,
  rescheduleBranchFollowUp,
} from "@/lib/api";
import { to12h, endTime12h } from "@/lib/time";
import { HeadPhysioCalendar } from "@/components/HeadPhysioCalendar";
import { ConsultationsBoard } from "@/components/ConsultationsBoard";
import { FitsiomaxStorePanel } from "@/components/BranchStoreBoard";
import { PullFromSheetButton } from "@/components/PullFromSheetButton";
import { PlaceholderPanel } from "@/components/PackagesBoard";
import { AccountantManageTab } from "@/components/branch/AccountantManageTab";
import { BranchCalendarPanel } from "@/components/branch/BranchCalendarPanel";
import { BranchDetailPage } from "@/components/branch/BranchDetailPage";
import { CreateLeadModal } from "@/components/CreateLeadModal";

export const BranchAdminBoard = ({ branchId }) => {
  const [boardData, setBoardData] = useState({ leads: [], stage_counts: {} });
  const [stages, setStages] = useState([]); // dynamic Branch Stages, from Super Admin > Pipeline Stage Management
  const [consultationStages, setConsultationStages] = useState([]); // dynamic Consultation Stages, merged into the same stage bar
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLead, setSelectedLead] = useState(null);
  const [activeView, setActiveView] = useState("pipeline");
  const [consultationsSubTab, setConsultationsSubTab] = useState("head_physio");
  const [stageFilter, setStageFilter] = useState(null); // null = show all stages
  const [dateFilter, setDateFilter] = useState(null); // { from, to, label, key } | null
  const [showCreateLead, setShowCreateLead] = useState(false);
  // Set when a lead's own detail popup hands off to a Consultation-only stage — tells the
  // embedded ConsultationsBoard which lead to auto-open once it loads, so the handoff lands
  // straight on that lead's own rich modal instead of just the filtered list.
  const [autoOpenLeadId, setAutoOpenLeadId] = useState(null);

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
  useEffect(() => { stagesList("consultation").then(setConsultationStages).catch(() => {}); }, []);

  const stageColor = useCallback(
    (name) => stages.find((s) => s.name === name)?.color || "#64748b",
    [stages],
  );

  // The entry stage of Branch's own pipeline ("New Leads" by default, but Super Admin can
  // rename it) — read structurally off position 0 rather than hardcoding the label, since
  // Pipeline Stage Management lets it be renamed at any time.
  const firstStageName = stages[0]?.name;

  // Branch Leads' stage bar shows both pipelines' stages in one continuous strip, so a
  // branch admin never needs to leave this tab to track a patient's whole journey. Any
  // stage name shared by both pipelines (e.g. "Follow Up") only gets one pill, backed by
  // the sales-side field — the Consultations tab itself is still the place to see a lead
  // sitting in the post-appointment Follow Up.
  const combinedStages = useMemo(
    () => [...stages, ...consultationStages.filter((cs) => !stages.some((s) => s.name === cs.name))],
    [stages, consultationStages],
  );
  // True only when the active pill is one of the Consultation-only stages just merged in —
  // those render the real Consultations board (same table, same popups) instead of the
  // Branch Leads table below.
  const isConsultationStage = !!stageFilter && !stages.some((s) => s.name === stageFilter);

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

  // Summary card counts follow the Date Filter (and search) too, instead of always
  // reflecting the branch's all-time totals — so the cards actually describe what's in
  // the table below them right now.
  const salesCounts = useMemo(() => {
    const counts = {};
    stages.forEach((s) => { counts[s.name] = filteredLeads.filter((l) => l.branch_stage === s.name).length; });
    return counts;
  }, [filteredLeads, stages]);
  const consultationCounts = useMemo(() => {
    const counts = {};
    consultationStages.forEach((s) => { counts[s.name] = filteredLeads.filter((l) => l.consultation_stage === s.name).length; });
    return counts;
  }, [filteredLeads, consultationStages]);
  const combinedCounts = { ...consultationCounts, ...salesCounts };

  // "All Stages" is the count of every lead matching the active Date Filter/search —
  // every lead in the branch when neither is set.
  const totalLeads = filteredLeads.length;

  const handleStageUpdate = async () => {
    const data = await loadBoard();
    if (selectedLead && data) {
      const updated = data.leads.find((l) => l.id === selectedLead.id);
      if (updated) setSelectedLead(updated);
    }
  };

  const VIEW_TABS = [
    { key: "pipeline", label: "Branch Leads", icon: LayoutDashboard },
    { key: "consultations", label: "MANAGEMENT", icon: Stethoscope },
    { key: "accountant_mgmt", label: "Accountant Manage", icon: BadgeIndianRupee },
    { key: "rehab", label: "Rehab", icon: Activity },
    { key: "store", label: "Fitsiomax Store", icon: ShoppingCart },
  ];

  // Everything under MANAGEMENT — Experts and Calendar used to be their own
  // top-level tabs, and Manager used to sit one level deeper inside Calendar;
  // all three now live here alongside the two calendars.
  const MANAGEMENT_SUB_TABS = [
    { key: "head_physio", label: "HEAD PHYSIO CALENDAR", icon: Calendar },
    { key: "physio", label: "PHYSIO CALENDAR", icon: Activity },
    { key: "manager", label: "MANAGER", icon: UserCog },
    { key: "calendar", label: "CALENDAR", icon: Calendar },
  ];

  return (
    <div className="space-y-4" data-testid="branch-admin-board-root">
      {/* View Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-200 pb-0" data-testid="branch-view-tabs">
        {VIEW_TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveView(tab.key)}
              className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
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
            {MANAGEMENT_SUB_TABS.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setConsultationsSubTab(t.key)}
                  className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition ${consultationsSubTab === t.key ? "bg-sky-50 text-sky-600" : "text-slate-600 hover:bg-slate-50"}`}
                  data-testid={`branch-consultations-subtab-${t.key}`}
                >
                  <Icon className="h-4 w-4" />{t.label}
                </button>
              );
            })}
          </div>
          {consultationsSubTab === "physio" ? (
            <HeadPhysioCalendar branchId={branchId} profileType="physio" />
          ) : consultationsSubTab === "manager" ? (
            <BranchDetailPage branchId={branchId} readOnly />
          ) : consultationsSubTab === "calendar" ? (
            <BranchCalendarPanel branchId={branchId} />
          ) : (
            <HeadPhysioCalendar branchId={branchId} />
          )}
        </div>
      ) : activeView === "rehab" ? (
        <PlaceholderPanel label="Rehab" testid="branch-rehab-panel" />
      ) : activeView === "store" ? (
        <FitsiomaxStorePanel />
      ) : activeView === "accountant_mgmt" ? (
        <AccountantManageTab branchId={branchId} />
      ) : (
        <>
          {/* Stage Head Bar — Pre-Sales style sticky segmented tabs. Merges in the
              Consultation pipeline's stages too, so this one bar covers a patient's whole
              journey; selecting one of those switches the view below to the real
              Consultations board (see isConsultationStage). */}
          <StageTabBar
            stages={combinedStages}
            stageFilter={stageFilter}
            setStageFilter={setStageFilter}
            counts={combinedCounts}
            totalCount={totalLeads}
            testid="branch-metric"
          />

          {isConsultationStage ? (
            <ConsultationsBoard
              branchId={branchId}
              viewerRole="branch_admin"
              externalStageFilter={stageFilter}
              showOwnStageBar={false}
              autoOpenLeadId={autoOpenLeadId}
              onAutoOpened={() => setAutoOpenLeadId(null)}
            />
          ) : (
          <>
          {/* Toolbar */}
          <div className="flex items-center gap-3" data-testid="branch-toolbar">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input className="pl-9" placeholder="Search patients..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} data-testid="branch-search" />
            </div>
            <DateFilterPopover value={dateFilter} onChange={setDateFilter} testid="branch-date-filter" />
            <Button onClick={() => setShowCreateLead(true)} className="bg-sky-600 hover:bg-sky-700" data-testid="branch-create-lead-btn">
              <UserPlus className="h-4 w-4 mr-1.5" />Create Lead
            </Button>
            <PullFromSheetButton
              onPulled={loadBoard}
              notConnectedHint="Google Sheets isn't connected yet — ask your Super Admin to connect it."
              noSourcesHint="No Google Sheet is linked to this branch yet — ask your Super Admin to tag one to this branch in Marketing Board → Lead Sources."
              iconOnly
            />
          </div>

          {/* List View (table) — its own scroll region so the sticky header can use top-0
              instead of guessing the page header's pixel height, which was colliding with
              the stat cards row as it scrolled past. */}
          <div className="w-full max-h-[65vh] overflow-auto rounded-lg border border-slate-200 bg-white" data-testid="branch-list">
            <table className="w-full min-w-[640px] table-fixed divide-y divide-slate-200 text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  {/* New Leads haven't had a physio assigned yet, so that column is dropped
                      only for this stage filter — every other view keeps it. */}
                  {stageFilter === firstStageName ? (
                    <>
                      <th className="w-[26%] px-4 py-3">Patient</th>
                      <th className="w-[16%] px-4 py-3">Phone</th>
                      <th className="w-[26%] px-4 py-3">Email</th>
                      <th className="w-[20%] px-4 py-3">Stage</th>
                      <th className="w-[12%] px-4 py-3 text-right">Updated</th>
                    </>
                  ) : (
                    <>
                      <th className="w-[22%] px-4 py-3">Patient</th>
                      <th className="w-[14%] px-4 py-3">Phone</th>
                      <th className="w-[22%] px-4 py-3">Email</th>
                      <th className="w-[16%] px-4 py-3">Stage</th>
                      <th className="w-[16%] px-4 py-3">Assigned Physio</th>
                      <th className="w-[10%] px-4 py-3 text-right">Updated</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(() => {
                  const visible = (stageFilter ? filteredLeads.filter((l) => l.branch_stage === stageFilter) : filteredLeads);
                  const showAssignedPhysio = stageFilter !== firstStageName;
                  if (visible.length === 0) {
                    return (
                      <tr>
                        <td colSpan={showAssignedPhysio ? 6 : 5} className="px-4 py-10 text-center text-sm text-slate-400" data-testid="branch-list-empty">
                          No patients {stageFilter ? `in stage "${stageDisplayLabel(stageFilter)}"` : "yet"}.
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
                            <div className="min-w-0">
                              <span className="block truncate font-medium text-slate-800" title={lead.name}>{lead.name}</span>
                              {lead.patient_number && <span className="block truncate font-mono text-[10px] text-slate-400" title={lead.patient_number}>{lead.patient_number}</span>}
                            </div>
                          </div>
                        </td>
                        <td className="truncate px-4 py-3 text-slate-600" title={lead.phone}>{lead.phone || "—"}</td>
                        <td className="truncate px-4 py-3 text-slate-600" title={lead.email}>{lead.email || "—"}</td>
                        <td className="px-4 py-3">
                          <span
                            className="inline-flex items-center rounded-[5px] border px-2.5 py-0.5 text-xs font-medium"
                            style={rowStageHex ? { background: `${rowStageHex}14`, color: rowStageHex, border: `1px solid ${rowStageHex}33` } : { background: "#f1f5f9", color: "#475569", border: "1px solid #e2e8f0" }}
                          >
                            {lead.branch_stage ? stageDisplayLabel(lead.branch_stage) : "—"}
                          </span>
                        </td>
                        {showAssignedPhysio && (
                          <td className="truncate px-4 py-3 text-slate-600" title={lead.assigned_physio_name}>{lead.assigned_physio_name || <span className="text-slate-400">—</span>}</td>
                        )}
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
          consultationStages={consultationStages}
          onClose={() => setSelectedLead(null)}
          onUpdate={handleStageUpdate}
          onOpenConsultationStage={(stage) => {
            // Hand off to the embedded Consultations board: close this modal, switch the
            // stage bar to the requested Consultation stage, and tell that board which
            // lead to auto-open — same lead, same rich stage-specific popups it already
            // has (Collect Payment, Physio Assign, etc.), instead of duplicating them here.
            setAutoOpenLeadId(selectedLead.id);
            setSelectedLead(null);
            setStageFilter(stage);
          }}
          onMoved={() => {
            // Close first, then refresh the list in the background via loadBoard directly
            // (not handleStageUpdate) — that closure's stale selectedLead would otherwise
            // re-open this same modal once the refresh resolves a couple seconds later.
            setSelectedLead(null);
            loadBoard();
          }}
        />
      )}
          </>
          )}

      {showCreateLead && (
        <CreateLeadModal
          isSuperAdmin={false}
          branchId={branchId}
          onClose={() => setShowCreateLead(false)}
          onSaved={loadBoard}
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
function BranchLeadModal({ lead, branchId, stages, consultationStages, onClose, onUpdate, onMoved, onOpenConsultationStage }) {
  // Same merge as the main Branch Leads stage bar — one continuous pipeline covering both
  // branch_stage and consultation_stage, with shared names (e.g. "Follow Up") kept to a
  // single pill backed by the sales-side field.
  const pipelineStages = [...stages, ...consultationStages.filter((cs) => !stages.some((s) => s.name === cs.name))];
  const isConsultationOnlyStage = (name) => !stages.some((s) => s.name === name);
  const [activeTab, setActiveTab] = useState("overview");
  const [remarks, setRemarks] = useState([]);
  const [activityLog, setActivityLog] = useState([]);

  const [apptDraft, setApptDraft] = useState(null); // { appointment_date, appointment_time, physio_id, notes, final_stage, duration } | null
  const [apptExperts, setApptExperts] = useState({ experts: [], available_count: 0, busy_count: 0, loading: false });
  // Month shown by the popup's own calendar. Held apart from the picked date so paging
  // through months doesn't disturb the booking being built.
  const [apptMonth, setApptMonth] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  // { "YYYY-MM-DD": free slot count } for the shown month — drives the purple marking so
  // the days worth clicking are visible without opening each one.
  const [apptOpenDates, setApptOpenDates] = useState({});

  // Follow-up scheduling
  const tomorrowIso = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const [followUpForm, setFollowUpForm] = useState({ date: tomorrowIso(), time: "10:00", remarks: "" });
  const [rescheduleDraft, setRescheduleDraft] = useState(null); // { followupId, date, time, reason } | null
  const [followUpBusy, setFollowUpBusy] = useState(false);

  // "Move to Stage" popup for Follow Up (mirrors Appointment Date & Time's popup pattern)
  const [followUpMoveDraft, setFollowUpMoveDraft] = useState(null); // { date, time, remarks } | null
  const [followUpMoveBusy, setFollowUpMoveBusy] = useState(false);

  const fetchAvailableExperts = useCallback(async (branch, dateStr, leadId) => {
    if (!branch || !dateStr) return;
    setApptExperts((p) => ({ ...p, loading: true }));
    try {
      const res = await getAvailableExperts(branch, dateStr, undefined, leadId);
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

  // The picked expert's own open times on the picked date. They arrive with the expert
  // list, so choosing an expert reveals their slots without a second round trip.
  const apptSlotsForExpert = useMemo(() => {
    if (!apptDraft?.physio_id) return [];
    const doc = (apptExperts.experts || []).find((d) => d.id === apptDraft.physio_id);
    return doc?.free_slots || [];
  }, [apptExperts.experts, apptDraft?.physio_id]);

  useEffect(() => {
    if (!apptDraft || !apptDraft.appointment_date || !branchId) return;
    fetchAvailableExperts(branchId, apptDraft.appointment_date, lead.id);
  }, [apptDraft?.appointment_date, branchId, lead.id, fetchAvailableExperts]);

  // Which days of the shown month have a free slot, refreshed whenever the popup pages to
  // another month.
  useEffect(() => {
    if (!apptDraft || !branchId) { return; }
    const month = `${apptMonth.y}-${String(apptMonth.m + 1).padStart(2, "0")}`;
    let cancelled = false;
    getAvailableDates(branchId, month, lead.id)
      .then((res) => { if (!cancelled) setApptOpenDates(res?.dates || {}); })
      .catch(() => { if (!cancelled) setApptOpenDates({}); });
    return () => { cancelled = true; };
  }, [apptDraft ? true : false, apptMonth.y, apptMonth.m, branchId, lead.id]);

  // Open the popup's calendar on the month the booking already sits in — reopening an
  // appointment made for next month shouldn't land on today's page with nothing selected.
  useEffect(() => {
    const d = apptDraft?.appointment_date;
    if (!d) return;
    const [y, m] = d.split("-").map(Number);
    setApptMonth((prev) => (prev.y === y && prev.m === m - 1 ? prev : { y, m: m - 1 }));
  }, [apptDraft?.appointment_date]);

  useEffect(() => {
    if (activeTab === "timeline") { loadRemarks(); loadActivity(); }
  }, [activeTab, lead.id]);

  const loadRemarks = async () => {
    try { setRemarks(await getLeadRemarks(lead.id)); } catch { /* silent */ }
  };
  const loadActivity = async () => {
    try { setActivityLog(await getLeadActivity(lead.id)); } catch { /* silent */ }
  };

  const moveStage = async (stage) => {
    try {
      await moveBranchStage(lead.id, { branch_stage: stage });
      toast.success(`Moved to ${stage}`);
      onMoved && onMoved(stage); // closes immediately; parent refreshes the list itself
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Move failed");
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
      onMoved && onMoved("Follow Up"); // closes immediately; parent refreshes the list itself
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to schedule");
    } finally {
      setFollowUpMoveBusy(false);
    }
  };

  const TABS = [
    { key: "overview", label: "Overview", color: "bg-sky-500" },
    { key: "follow-up", label: "Follow-Up", color: "bg-amber-500" },
    { key: "timeline", label: "Timeline", color: "bg-emerald-500" },
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
                  {lead.patient_number && (
                    <span className="rounded-[5px] bg-white/20 px-2 py-0.5 font-mono text-[10px] font-semibold text-white" data-testid="branch-lead-patient-number">{lead.patient_number}</span>
                  )}
                  <span className="rounded-[5px] bg-white/95 px-2.5 py-0.5 text-[11px] font-semibold text-slate-700" data-testid="branch-lead-stage">
                    {lead.branch_stage ? stageDisplayLabel(lead.branch_stage) : "No Stage"}
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
              className={`rounded-[5px] px-3.5 py-1 text-xs font-semibold capitalize transition-all ${activeTab === t.key ? `${t.color} text-white shadow-sm` : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200"}`}
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
                  {(pipelineStages || []).map((s) => {
                    const stage = s.name;
                    const isActive = lead.branch_stage === stage || lead.consultation_stage === stage;
                    const consultationOnly = isConsultationOnlyStage(stage);
                    // A Consultation-only stage isn't reachable until the lead has actually
                    // entered that pipeline (schedule-branch-appointment seeds
                    // consultation_stage the first time) — shown, but not yet clickable.
                    const notYetReached = consultationOnly && !lead.consultation_stage;
                    const tint = s.color || "#64748b";
                    const handleClick = () => {
                      if (stage === "Appointment Date & Time") {
                        setApptDraft({
                          appointment_date: lead.appointment_date || new Date(Date.now() + 86400000).toISOString().slice(0, 10),
                          // Left blank on purpose — the time has to be picked from the
                          // expert's published slots, so pre-filling a guess like 10:00
                          // would show a time that may not actually be bookable.
                          appointment_time: lead.appointment_time || "",
                          physio_id: lead.assigned_physio_id || "",
                          notes: "",
                          duration: null,
                          final_stage: "Appointment Date & Time",
                        });
                        return;
                      }
                      if (stage === "Follow Up") {
                        setFollowUpMoveDraft({ date: tomorrowIso(), time: "10:00", remarks: "" });
                        return;
                      }
                      if (consultationOnly) {
                        if (notYetReached) {
                          toast.error("This lead needs an appointment scheduled before it can enter the Consultations pipeline");
                          return;
                        }
                        onOpenConsultationStage && onOpenConsultationStage(stage);
                        return;
                      }
                      moveStage(stage);
                    };
                    return (
                      <button
                        key={s.id}
                        type="button"
                        disabled={isActive || notYetReached}
                        onClick={handleClick}
                        className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-all hover:shadow-md disabled:cursor-not-allowed disabled:opacity-90"
                        style={isActive ? { background: tint, color: "#ffffff" } : { background: `${tint}14`, color: tint, border: `1px solid ${tint}33` }}
                        data-testid={`branch-stage-btn-${stage}`}
                      >
                        {stageDisplayLabel(stage)}
                      </button>
                    );
                  })}
                </div>
              </div>
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

          {activeTab === "timeline" && (
            <div className="space-y-3" data-testid="branch-lead-timeline">
              {(() => {
                const events = [
                  ...remarks.map((r) => ({ ...r, _kind: "remark" })),
                  ...activityLog.map((a) => ({ ...a, _kind: "activity" })),
                ].sort((x, y) => new Date(x.created_at) - new Date(y.created_at));
                if (events.length === 0) return <p className="py-8 text-center text-sm text-slate-400">No timeline events yet</p>;
                return (
                  <ol className="ml-3 space-y-4 border-l-2 border-slate-200 py-1 pl-6">
                    {events.map((h) => (
                      <li key={`${h._kind}-${h.id}`} className="relative" data-testid={`branch-timeline-${h._kind}-${h.id}`}>
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
        </div>
      </div>

      {/* Appointment Date & Time Popup */}
      {apptDraft && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-2 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) setApptDraft(null); }} data-testid="branch-appt-modal">
          <div className="flex h-[calc(100vh-1rem)] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-100 px-6 py-4">
              <div className="flex items-center gap-2.5">
                <Calendar className="h-5 w-5 text-slate-500" />
                <div>
                  <p className="text-lg font-bold text-slate-800">Appointment</p>
                  <p className="text-xs text-slate-500">{lead.name} · pick a date, then the Head Physio, then their time</p>
                </div>
              </div>
              <button onClick={() => setApptDraft(null)} className="rounded-lg border-2 border-orange-200 bg-orange-100 p-2 text-orange-600 transition hover:border-orange-300 hover:bg-orange-200 hover:text-orange-700" data-testid="branch-appt-close">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Three steps left to right: the date narrows who's available, the chosen
                Head Physio narrows which times exist. Each column only fills in once the
                one before it has an answer. */}
            <div className="flex flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
              {/* STEP 1 — Date */}
              <div className="w-full flex-shrink-0 border-b border-slate-200 p-6 lg:w-[28rem] lg:border-b-0 lg:border-r lg:overflow-y-auto" data-testid="branch-appt-date-panel">
                <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">1 · Date</p>
                {(() => {
                  const todayStr = new Date().toISOString().slice(0, 10);
                  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
                  const firstDow = new Date(apptMonth.y, apptMonth.m, 1).getDay();
                  const daysInMonth = new Date(apptMonth.y, apptMonth.m + 1, 0).getDate();
                  const pad = (n) => String(n).padStart(2, "0");
                  const stepMonth = (delta) => setApptMonth(({ y, m }) => {
                    const d = new Date(y, m + delta, 1);
                    return { y: d.getFullYear(), m: d.getMonth() };
                  });
                  return (
                    <>
                      <div className="mb-3 flex items-center justify-between">
                        <button type="button" onClick={() => stepMonth(-1)} className="rounded p-1 hover:bg-slate-100" data-testid="branch-appt-prev-month">
                          <ChevronLeft className="h-5 w-5 text-slate-500" />
                        </button>
                        <h4 className="text-base font-bold text-slate-700">{monthNames[apptMonth.m]} {apptMonth.y}</h4>
                        <button type="button" onClick={() => stepMonth(1)} className="rounded p-1 hover:bg-slate-100" data-testid="branch-appt-next-month">
                          <ChevronRight className="h-5 w-5 text-slate-500" />
                        </button>
                      </div>
                      <div className="mb-1 grid grid-cols-7 gap-1">
                        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                          <div key={d} className="py-1 text-center text-xs font-semibold text-slate-400">{d}</div>
                        ))}
                      </div>
                      <div className="grid grid-cols-7 gap-1">
                        {Array.from({ length: firstDow }, (_, i) => <div key={`pad-${i}`} className="h-14" />)}
                        {Array.from({ length: daysInMonth }, (_, i) => {
                          const day = i + 1;
                          const dateStr = `${apptMonth.y}-${pad(apptMonth.m + 1)}-${pad(day)}`;
                          const isPast = dateStr < todayStr;
                          const isPicked = apptDraft.appointment_date === dateStr;
                          const isToday = dateStr === todayStr;
                          const openSlots = apptOpenDates[dateStr] || 0;
                          const hasSlots = !isPast && openSlots > 0;
                          return (
                            <button
                              key={day}
                              type="button"
                              disabled={isPast}
                              // A new date invalidates the expert and slot chosen under the
                              // old one — availability is per-day, so both are cleared.
                              onClick={() => setApptDraft({ ...apptDraft, appointment_date: dateStr, physio_id: "", appointment_time: "", duration: null })}
                              className={`h-14 rounded-lg text-lg font-semibold transition ${
                                isPicked
                                  ? "bg-teal-600 text-white shadow-sm ring-2 ring-teal-200"
                                  : isPast
                                  ? "cursor-not-allowed text-slate-300"
                                  : hasSlots
                                  // Purple marks a day that actually has a slot free, so the
                                  // days worth clicking are visible without opening each one.
                                  ? "bg-violet-300 text-white shadow-sm hover:bg-violet-400"
                                  : isToday
                                  ? "border border-teal-300 bg-teal-50 text-teal-700 hover:bg-teal-100"
                                  : "text-slate-600 hover:bg-slate-100"
                              }`}
                              title={hasSlots ? `${openSlots} slot${openSlots === 1 ? "" : "s"} open` : undefined}
                              data-testid={`branch-appt-day-${day}`}
                            >
                              {day}
                            </button>
                          );
                        })}
                      </div>
                      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3 text-xs font-semibold text-slate-400">
                        <span className="flex items-center gap-1.5"><span className="inline-block h-3.5 w-3.5 rounded bg-violet-300" /> Slots open</span>
                        <span className="flex items-center gap-1.5"><span className="inline-block h-3.5 w-3.5 rounded bg-teal-600" /> Picked</span>
                      </div>
                    </>
                  );
                })()}
              </div>

              {/* STEP 2 — Head Physio */}
              <div className="w-full flex-shrink-0 border-b border-slate-200 p-5 lg:w-[22rem] lg:border-b-0 lg:border-r lg:overflow-y-auto" data-testid="branch-appt-expert-panel">
                <p className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-400">2 · Head Physio</p>
                <p className="mb-3 text-xs text-slate-400">Only those with availability on the picked date.</p>
                {!apptDraft.appointment_date ? (
                  <p className="rounded-lg border border-dashed border-slate-200 px-3 py-10 text-center text-sm text-slate-400">Pick a date first.</p>
                ) : apptExperts.loading ? (
                  <p className="text-sm text-slate-400">Checking availability...</p>
                ) : apptExperts.experts.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-200 px-3 py-10 text-center text-sm text-slate-400">No Head Physio is available on this date.</p>
                ) : (
                  <div className="space-y-2">
                    {apptExperts.experts.map((doc) => {
                      const active = apptDraft.physio_id === doc.id;
                      const open = (doc.free_slots || []).length;
                      return (
                        <button
                          key={doc.id}
                          type="button"
                          onClick={() => setApptDraft({ ...apptDraft, physio_id: doc.id, appointment_time: "", duration: null })}
                          className={`flex w-full items-center gap-3 rounded-lg border-2 p-3.5 text-left transition ${active ? "border-teal-500 bg-teal-50 shadow-sm" : "border-slate-200 bg-white hover:border-teal-300 hover:bg-slate-50"}`}
                          data-testid={`branch-appt-expert-${doc.id}`}
                        >
                          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-bold ${active ? "bg-teal-600 text-white" : "bg-teal-100 text-teal-700"}`}>
                            {doc.full_name?.charAt(0) || "E"}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-slate-800">{doc.full_name}</p>
                            <p className={`truncate text-xs ${open > 0 ? "text-slate-400" : "text-amber-600"}`}>
                              {open > 0 ? `${open} slot${open === 1 ? "" : "s"} open` : "Nothing published"}
                            </p>
                          </div>
                          {active && <CheckCircle2 className="ml-auto h-5 w-5 shrink-0 text-teal-600" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* STEP 3 — Time slot. Times come only from what the expert has actually
                  confirmed on HEAD PHYSIO CALENDAR — no free typing, so nothing gets booked
                  into a slot the Head Physio never agreed to. */}
              <div className="flex-1 overflow-y-auto p-5" data-testid="branch-appt-slot-panel">
                <p className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-400">3 · Time Slot</p>
                <p className="mb-3 text-xs text-slate-400">Published availability only.</p>
                {!apptDraft.physio_id ? (
                  <p className="rounded-lg border border-dashed border-slate-200 px-3 py-10 text-center text-sm text-slate-400">Select a Head Physio to see their available times.</p>
                ) : apptSlotsForExpert.length === 0 ? (
                  <div className="rounded-lg border-2 border-amber-200 bg-amber-50 px-4 py-3" data-testid="branch-appt-no-slots">
                    <p className="text-sm font-semibold text-amber-800">No availability published for this date.</p>
                    <p className="mt-0.5 text-xs text-amber-700">
                      Confirm with the expert, then open MANAGEMENT → HEAD PHYSIO CALENDAR and mark them available.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4" data-testid="branch-appt-slots">
                    {apptSlotsForExpert.map((s) => {
                      const active = apptDraft.appointment_time === s.time;
                      return (
                        <button
                          key={s.slot_time}
                          type="button"
                          onClick={() => setApptDraft({ ...apptDraft, appointment_time: s.time, duration: s.duration })}
                          className={`rounded-lg border-2 px-2 py-2.5 text-center transition ${active ? "border-teal-500 bg-teal-50 text-teal-700 shadow-sm ring-2 ring-teal-100" : "border-slate-200 bg-white text-slate-600 hover:border-teal-300 hover:bg-slate-50"}`}
                          data-testid={`branch-appt-slot-${s.time}`}
                        >
                          <span className="block text-base font-bold">{to12h(s.time)}</span>
                          <span className="block text-[11px] text-slate-400">{s.duration} min</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {apptDraft.appointment_time && apptDraft.duration && (
                  <p className="mt-4 rounded-lg border-2 border-teal-300 bg-teal-50 px-4 py-2.5 text-sm font-bold text-teal-700" data-testid="branch-appt-slot-summary">
                    {to12h(apptDraft.appointment_time)} – {endTime12h(apptDraft.appointment_time, apptDraft.duration)} · {apptDraft.duration} minute consultation
                  </p>
                )}

                <div className="mt-5">
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">Notes</label>
                  <textarea
                    rows={3}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
                    placeholder="Optional notes about the appointment..."
                    value={apptDraft.notes}
                    onChange={(e) => setApptDraft({ ...apptDraft, notes: e.target.value })}
                    data-testid="branch-appt-notes"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-100 px-6 py-3.5">
              {/* Marking the lead Cancelled is a destructive move — it frees the slot and
                  drops the lead out of the consultation pipeline — so it reads red the
                  moment it's ticked, and carries the primary button's colour with it. */}
              {(() => {
                const cancelled = apptDraft.final_stage === "Cancelled";
                return (
                  <button
                    type="button"
                    onClick={() => setApptDraft({ ...apptDraft, final_stage: cancelled ? "Appointment Date & Time" : "Cancelled" })}
                    className={`flex items-center gap-2.5 rounded-lg border-2 px-4 py-2 text-sm font-bold transition ${
                      cancelled
                        ? "border-rose-700 bg-rose-600 text-white shadow-sm"
                        : "border-rose-200 bg-white text-rose-600 hover:border-rose-400 hover:bg-rose-50"
                    }`}
                    data-testid="branch-appt-cancel-toggle"
                    aria-pressed={cancelled}
                  >
                    <span className={`flex h-4 w-4 items-center justify-center rounded border-2 ${cancelled ? "border-white bg-white" : "border-rose-300"}`}>
                      {cancelled && <Check className="h-3 w-3 text-rose-600" />}
                    </span>
                    CANCELLED
                  </button>
                );
              })()}
              <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setApptDraft(null)} data-testid="branch-appt-cancel">Cancel</Button>
              <Button
                className={apptDraft.final_stage === "Cancelled"
                  ? "bg-rose-600 text-white hover:bg-rose-700"
                  : "bg-teal-600 text-white hover:bg-teal-700"}
                onClick={async () => {
                  if (!apptDraft.appointment_date) { toast.error("Pick a date"); return; }
                  if (!apptDraft.physio_id) { toast.error("Please select an expert"); return; }
                  if (!apptDraft.appointment_time) { toast.error("Pick a time slot"); return; }
                  try {
                    await scheduleBranchAppointment(lead.id, apptDraft);
                    toast.success(`Appointment ${apptDraft.appointment_date} ${to12h(apptDraft.appointment_time)} → ${apptDraft.final_stage}`);
                    setApptDraft(null);
                    onMoved && onMoved(apptDraft.final_stage); // closes immediately; parent refreshes the list itself
                  } catch (e) { toast.error(e?.response?.data?.detail || "Failed to schedule"); }
                }}
                data-testid="branch-appt-save"
              >
                {apptDraft.final_stage === "Cancelled" ? "Confirm Cancellation" : "Confirm"}
              </Button>
              </div>
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
