import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, Plus, Search, Settings as Cog, Calendar as CalendarIcon, Phone, FileText, StickyNote, ArrowRight, ArrowLeft, CheckCircle2, X, Pencil, PhoneOff, Clock, Bell, Building2, Trash2, Dumbbell, Stethoscope, Lock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import {
  getLeads, createManualLead, stagesList, updateLead, rnrAttempt, scheduleFollowUp, rescheduleFollowUp, scheduleAppointment, getBranches, leadActivity, deleteLead,
} from "@/lib/api";
import { LeadEditModal } from "@/components/LeadEditModal";
import { CreateLeadModal } from "@/components/CreateLeadModal";
import { SourcePill } from "@/components/marketing/SourcePill";
import { PullFromSheetButton } from "@/components/PullFromSheetButton";
import { DateFilterPopover } from "@/components/DateFilterPopover";

const initials = (name) => (name || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

// Deterministic avatar color per first letter so A→one hue, B→another, etc.
// Tailwind 26-letter palette (bg + text pair) chosen for legibility on white rows.
const AVATAR_PALETTE = [
  { bg: "bg-red-100",     fg: "text-red-700" },     // A
  { bg: "bg-orange-100",  fg: "text-orange-700" },  // B
  { bg: "bg-amber-100",   fg: "text-amber-700" },   // C
  { bg: "bg-yellow-100",  fg: "text-yellow-800" },  // D
  { bg: "bg-lime-100",    fg: "text-lime-700" },    // E
  { bg: "bg-green-100",   fg: "text-green-700" },   // F
  { bg: "bg-emerald-100", fg: "text-emerald-700" }, // G
  { bg: "bg-teal-100",    fg: "text-teal-700" },    // H
  { bg: "bg-cyan-100",    fg: "text-cyan-700" },    // I
  { bg: "bg-sky-100",     fg: "text-sky-700" },     // J
  { bg: "bg-blue-100",    fg: "text-blue-700" },    // K
  { bg: "bg-indigo-100",  fg: "text-indigo-700" },  // L
  { bg: "bg-violet-100",  fg: "text-violet-700" },  // M
  { bg: "bg-purple-100",  fg: "text-purple-700" },  // N
  { bg: "bg-fuchsia-100", fg: "text-fuchsia-700" }, // O
  { bg: "bg-pink-100",    fg: "text-pink-700" },    // P
  { bg: "bg-rose-100",    fg: "text-rose-700" },    // Q
  { bg: "bg-red-200",     fg: "text-red-800" },     // R
  { bg: "bg-orange-200",  fg: "text-orange-800" },  // S
  { bg: "bg-amber-200",   fg: "text-amber-800" },   // T
  { bg: "bg-lime-200",    fg: "text-lime-800" },    // U
  { bg: "bg-emerald-200", fg: "text-emerald-800" }, // V
  { bg: "bg-cyan-200",    fg: "text-cyan-800" },    // W
  { bg: "bg-blue-200",    fg: "text-blue-800" },    // X
  { bg: "bg-violet-200",  fg: "text-violet-800" },  // Y
  { bg: "bg-pink-200",    fg: "text-pink-800" },    // Z
];

const avatarColor = (name) => {
  const c = (name || "?").trim().charAt(0).toUpperCase();
  const idx = c.charCodeAt(0) - 65;
  if (idx < 0 || idx > 25) return { bg: "bg-slate-100", fg: "text-slate-700" };
  return AVATAR_PALETTE[idx];
};

const PRESALES_CRM_LOCKED = false;

export const PreSalesCRM = ({ onManageStages, role, currentUser }) => {
  const [stages, setStages] = useState([]);
  const [leads, setLeads] = useState([]);
  const [branches, setBranches] = useState([]);
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("All");
  const [sourceFilter, setSourceFilter] = useState("");
  const [dateFilter, setDateFilter] = useState(null);
  const [editing, setEditing] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [loading, setLoading] = useState(false);
  const [visibleCount, setVisibleCount] = useState(50);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [stgs, ldList] = await Promise.all([stagesList("pre_sales"), getLeads({})]);
      setStages(stgs);
      setLeads(ldList);
      // If a lead is currently open in the detail dialog, refresh its reference
      // so saved edits show up immediately.
      setEditing((prev) => prev ? (ldList.find((l) => l.id === prev.id) || prev) : prev);
    } catch (e) { toast.error("Failed to load"); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { getBranches().then(setBranches).catch(() => {}); }, []);

  // Leads narrowed by Date Filter + Source filter only — feeds both the KPI
  // summary cards and the table, so the cards stay dynamic with those two filters
  // without also collapsing to whatever single stage tab is currently selected.
  const dateSourceFiltered = useMemo(() => {
    let rows = leads;
    if (sourceFilter) rows = rows.filter((l) => (l.source_tab || l.source_type || "") === sourceFilter);
    if (dateFilter) {
      const from = dateFilter.from?.getTime();
      const to = dateFilter.to?.getTime();
      rows = rows.filter((l) => {
        const ts = new Date(l.created_at || 0).getTime();
        if (!ts) return false;
        if (from && ts < from) return false;
        if (to && ts > to) return false;
        return true;
      });
    }
    return rows;
  }, [leads, sourceFilter, dateFilter]);

  const stageCounts = useMemo(() => {
    const map = { All: dateSourceFiltered.length };
    stages.forEach((s) => { map[s.name] = 0; });
    dateSourceFiltered.forEach((l) => { if (map[l.stage] != null) map[l.stage] += 1; });
    return map;
  }, [dateSourceFiltered, stages]);

  const sourceOptions = useMemo(() => {
    const set = new Set();
    leads.forEach((l) => { const s = l.source_tab || l.source_type; if (s) set.add(s); });
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [leads]);

  const filtered = useMemo(() => {
    let rows = dateSourceFiltered;
    if (stageFilter !== "All") rows = rows.filter((l) => l.stage === stageFilter);
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((l) => (l.name || "").toLowerCase().includes(q) || (l.phone || "").includes(q) || (l.email || "").toLowerCase().includes(q));
    }
    return rows.slice().sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  }, [dateSourceFiltered, stageFilter, search]);

  // Rendering thousands of rows at once is fine on desktop but chokes mobile
  // devices, so re-page back to 50 whenever the filtered set changes.
  useEffect(() => { setVisibleCount(50); }, [stageFilter, sourceFilter, search, dateFilter]);
  const visibleLeads = filtered.slice(0, visibleCount);

  const moveToStage = async (leadId, stageName) => {
    try { await updateLead(leadId, { stage: stageName }); toast.success(`Moved to ${stageName}`); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Move failed"); }
  };

  // Pick KPI cards: total + up to 8 stage cards
  const kpiStages = stages.slice(0, 8);

  if (PRESALES_CRM_LOCKED) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white py-24 text-center" data-testid="presales-crm-locked">
        <Lock className="h-10 w-10 text-slate-300" />
        <h2 className="text-xl font-bold text-slate-700">Pre-Sales CRM is locked</h2>
        <p className="max-w-sm text-sm text-slate-500">This dashboard has been locked by a Super Admin. Contact your administrator to restore access.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="presales-crm-page">
      {/* KPI Cards */}
      <div className="flex flex-nowrap gap-3" data-testid="presales-kpi-row">
        <KpiCard label="Total Leads" value={stageCounts.All} active={stageFilter === "All"} color="#22c55e" onClick={() => setStageFilter("All")} testid="presales-kpi-all" />
        {kpiStages.map((s) => (
          <KpiCard key={s.id} label={s.name} value={stageCounts[s.name] || 0} active={stageFilter === s.name} color={s.color} onClick={() => setStageFilter(s.name)} testid={`presales-kpi-${s.name}`} />
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2" data-testid="presales-toolbar">
        <div className="relative min-w-[260px] flex-1">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search leads by name, email, phone..." className="h-10 pl-8" data-testid="presales-search" />
        </div>
        <DateFilterPopover value={dateFilter} onChange={setDateFilter} testid="presales-date-filter" />
        <PullFromSheetButton onPulled={load} />
        <Button onClick={() => setShowCreate(true)} className="h-10 bg-sky-600 hover:bg-sky-700" data-testid="presales-create-lead-btn"><Plus className="h-4 w-4 mr-1" />Create Lead</Button>
        <select
          className="h-10 w-[200px] rounded-md border border-slate-200 px-3 text-sm"
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          data-testid="presales-source-filter"
        >
          <option value="">All Sources</option>
          {sourceOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {role === "super_admin" && (
          <Button variant="outline" className="h-10" onClick={onManageStages} data-testid="presales-manage-stages-btn"><Cog className="h-4 w-4 mr-1" />Manage Stages</Button>
        )}
      </div>

      {/* Stage Tabs — one continuous strip (divide-x between segments, rounding only
          on the outer edges) rather than separate gapped pills. */}
      <div className="-mx-1" data-testid="presales-stage-tabs">
        <div className="flex flex-wrap divide-x divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white/95">
          <StageTab label="All" active={stageFilter === "All"} onClick={() => setStageFilter("All")} color="#0ea5e9" testid="presales-chip-all" />
          {stages.map((s) => (
            <StageTab key={s.id} label={s.name} active={stageFilter === s.name} onClick={() => setStageFilter(s.name)} color={s.color} testid={`presales-chip-${s.name}`} />
          ))}
        </div>
      </div>

      {/* Leads table */}
      <Card data-testid="presales-leads-card">
        <CardContent className="p-0">
          <div className="overflow-auto">
            <table className="min-w-full border-separate border-spacing-x-0 border-spacing-y-2 text-sm">
              <thead className="text-center text-xs text-slate-500">
                <tr><th className="px-3 py-2 text-left">LEAD</th><th className="px-3 py-2">PHONE</th><th className="px-3 py-2">EMAIL</th><th className="px-3 py-2">SOURCE</th><th className="px-3 py-2">STAGE</th>{stageFilter === "Appointment" && <th className="px-3 py-2">BRANCH ADMIN STATUS</th>}<th className="px-3 py-2">CREATED</th><th className="px-3 py-2">ACTIONS</th></tr>
              </thead>
              <tbody>
                {visibleLeads.map((l) => {
                  const stg = stages.find((s) => s.name === l.stage);
                  return (
                    <tr key={l.id} onClick={() => setEditing(l)} className="group cursor-pointer" data-testid={`presales-lead-row-${l.id}`}>
                      <td className="rounded-l-[5px] border-y border-l border-slate-200 bg-white px-3 py-3 text-left font-medium text-slate-800 transition-colors group-hover:bg-slate-50">
                        <div className="flex items-center gap-2">
                          <span className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${avatarColor(l.name).bg} ${avatarColor(l.name).fg}`}>{initials(l.name)}</span>
                          <span className="truncate">{l.name}</span>
                        </div>
                      </td>
                      <td className="border-y border-slate-200 bg-white px-3 py-3 text-center font-mono text-xs text-slate-700 transition-colors group-hover:bg-slate-50">{l.phone || "—"}</td>
                      <td className="border-y border-slate-200 bg-white px-3 py-3 text-center text-xs text-slate-600 transition-colors group-hover:bg-slate-50">{l.email || "—"}</td>
                      <td className="border-y border-slate-200 bg-white px-3 py-3 text-center transition-colors group-hover:bg-slate-50"><SourcePill source={l.source_tab || l.source_type} /></td>
                      <td className="border-y border-slate-200 bg-white px-3 py-3 transition-colors group-hover:bg-slate-50">
                        <div className="flex flex-col items-center gap-1">
                          <div className="flex items-center gap-1.5">
                            <span className="inline-flex h-6 items-center rounded border px-2 text-[10px] font-semibold" style={{ borderColor: stg?.color || "#cbd5e1", color: stg?.color || "#64748b" }}>{l.stage}</span>
                            {l.stage === "RNR" && (l.rnr_attempts || 0) > 0 && (
                              <span className="inline-flex items-center gap-0.5 rounded-full bg-rose-100 px-1.5 py-0.5 text-[9px] font-bold text-rose-700" title={`${l.rnr_attempts} unanswered call attempts`} data-testid={`presales-rnr-badge-${l.id}`}>
                                <PhoneOff className="h-2.5 w-2.5" />×{l.rnr_attempts}
                              </span>
                            )}
                          </div>
                          {l.stage === "Follow Up" && l.next_follow_up_at && (() => {
                            const dt = new Date(l.next_follow_up_at);
                            const today = new Date(); today.setHours(0, 0, 0, 0);
                            const diff = Math.floor((dt.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
                            const isToday = diff === 0;
                            const isTomorrow = diff === 1;
                            const isPast = dt.getTime() < Date.now();
                            const tone = isPast ? "bg-rose-50 text-rose-700 border-rose-200" : isToday ? "bg-amber-50 text-amber-700 border-amber-300" : "bg-emerald-50 text-emerald-700 border-emerald-200";
                            return (
                              <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${tone}`} data-testid={`presales-followup-badge-${l.id}`}>
                                <Clock className="h-2.5 w-2.5" />
                                {isToday ? "Today" : isTomorrow ? "Tomorrow" : dt.toLocaleDateString(undefined, { day: "2-digit", month: "short" })}
                                {" · "}
                                {dt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })}
                              </span>
                            );
                          })()}
                        </div>
                      </td>
                      {stageFilter === "Appointment" && (() => {
                        const branchName = l.branch_id ? (branches.find((b) => b.id === l.branch_id)?.branch_name || branches.find((b) => b.id === l.branch_id)?.name) : (l.appointment_mode === "online" ? "Online Consultation" : "Unassigned");
                        const status = l.branch_stage || "Pending";
                        const statusColor = {
                          "New Appointment": "bg-blue-50 text-blue-700 border-blue-200",
                          "Portfolio": "bg-violet-50 text-violet-700 border-violet-200",
                          "Follow Up": "bg-orange-50 text-orange-700 border-orange-200",
                          "Appointment Date & Time": "bg-teal-50 text-teal-700 border-teal-200",
                          "Cancelled": "bg-rose-50 text-rose-700 border-rose-200",
                        }[status] || "bg-slate-50 text-slate-600 border-slate-200";
                        return (
                          <td className="border-y border-slate-200 bg-white px-3 py-3 text-center text-xs transition-colors group-hover:bg-slate-50">
                            <div className="flex flex-col items-center gap-1" data-testid={`presales-branch-status-${l.id}`}>
                              <span className="font-semibold text-slate-700">{branchName || "—"}</span>
                              <span className={`inline-flex w-fit items-center rounded border px-1.5 text-[10px] font-semibold ${statusColor}`}>{status}</span>
                              {l.assigned_physio_name ? (
                                <span className="text-[10px] text-emerald-600">Expert: {l.assigned_physio_name}</span>
                              ) : (
                                <span className="text-[10px] text-amber-600">Pending Expert</span>
                              )}
                            </div>
                          </td>
                        );
                      })()}
                      <td className="border-y border-slate-200 bg-white px-3 py-3 text-center text-xs text-slate-400 transition-colors group-hover:bg-slate-50">{(l.created_at || "").slice(0, 10)}</td>
                      <td className="rounded-r-[5px] border-y border-r border-slate-200 bg-white px-3 py-3 text-center transition-colors group-hover:bg-slate-50">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={(e) => { e.stopPropagation(); setEditing(l); }} className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-sky-600" data-testid={`presales-lead-view-${l.id}`} title="View / Edit">
                            <Eye className="h-4 w-4" />
                          </button>
                          {role === "super_admin" && (
                            <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(l); }} className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600" data-testid={`presales-lead-delete-${l.id}`} title="Delete lead">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && <tr><td colSpan={stageFilter === "Appointment" ? 8 : 7} className="px-3 py-8 text-center text-slate-400">{loading ? "Loading..." : "No leads match."}</td></tr>}
              </tbody>
            </table>
          </div>
          {filtered.length > visibleCount && (
            <div className="flex items-center justify-center border-t border-slate-100 p-3">
              <Button variant="outline" onClick={() => setVisibleCount((c) => c + 50)} data-testid="presales-load-more">
                Load More ({filtered.length - visibleCount} remaining)
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {editing && (
        <LeadDetailDialog lead={editing} stages={stages} currentUser={currentUser} onClose={() => setEditing(null)} onSaved={load} onMoveStage={moveToStage} />
      )}

      {showCreate && (
        <CreateLeadModal onClose={() => setShowCreate(false)} onSaved={load} />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-testid="presales-delete-dialog">
          <div className="w-full max-w-sm space-y-4 rounded-xl bg-white p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-rose-100">
                <Trash2 className="h-5 w-5 text-rose-600" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-900" data-testid="presales-delete-title">Delete lead?</h3>
                <p className="mt-1 text-xs text-slate-500">This will permanently delete <b className="text-slate-700">{confirmDelete.name || "this lead"}</b> along with its activity history and follow-ups. This cannot be undone.</p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setConfirmDelete(null)} data-testid="presales-delete-cancel">Cancel</Button>
              <Button
                onClick={async () => {
                  try {
                    await deleteLead(confirmDelete.id);
                    toast.success(`Deleted ${confirmDelete.name || "lead"}`);
                    setConfirmDelete(null);
                    load();
                  } catch (e) {
                    toast.error(e?.response?.data?.detail || "Delete failed");
                  }
                }}
                className="bg-rose-600 hover:bg-rose-700"
                data-testid="presales-delete-confirm"
              >
                Yes, Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const KpiCard = ({ label, value, color, active, onClick, testid }) => (
  <button onClick={onClick} data-testid={testid} className={`min-w-0 flex-1 rounded-2xl p-4 text-left transition ${active ? "ring-2 ring-inset" : ""}`} style={{ background: `${color}14`, border: `1px solid ${color}33`, ...(active ? { "--tw-ring-color": color } : {}) }}>
    <p className="truncate text-xs font-medium" style={{ color }}>{label}</p>
    <p className="mt-1 text-3xl font-bold" style={{ color }}>{value}</p>
  </button>
);

const StageTab = ({ label, active, onClick, color, testid }) => {
  const tint = color || "#0ea5e9";
  return (
    <button
      onClick={onClick}
      data-testid={testid}
      type="button"
      className="relative flex flex-1 min-w-[110px] items-center justify-center px-4 py-3 text-center transition-colors hover:brightness-95"
      style={active ? { background: tint, color: "#ffffff" } : { background: `${tint}14`, color: tint }}
    >
      <span className="text-xs font-semibold uppercase tracking-wider leading-tight">{label}</span>
    </button>
  );
};

// Legacy compact chip kept for callers that haven't migrated yet (unused after redesign).
const ChipTab = ({ label, active, onClick, color, testid }) => (
  <button onClick={onClick} data-testid={testid} className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition ${active ? "text-white" : "text-slate-600 bg-slate-100 hover:bg-slate-200"}`} style={active ? { background: color } : undefined}>
    <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: color }} />{label}
  </button>
);

// ============ Lead Detail Dialog (Overview + Move-to-Stage + Edit) ============

const LeadDetailDialog = ({ lead, stages, currentUser, onClose, onSaved, onMoveStage }) => {
  const [tab, setTab] = useState("overview");
  const [showEdit, setShowEdit] = useState(false);
  const [currentLead, setCurrentLead] = useState(lead);
  const [followUpDraft, setFollowUpDraft] = useState(null); // { date, time, remarks } | null
  const [rescheduleDraft, setRescheduleDraft] = useState(null); // { followupId, date, time, reason } | null
  const [appointmentDraft, setAppointmentDraft] = useState(null); // { department, appointment_date, appointment_time, remarks } | null
  const [appointmentResult, setAppointmentResult] = useState(null); // summary shown after a successful schedule
  const [branches, setBranches] = useState([]);
  const [activity, setActivity] = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);

  useEffect(() => {
    getBranches().then(setBranches).catch(() => {});
  }, []);

  useEffect(() => {
    if (tab === "history" && currentLead?.id) {
      setActivityLoading(true);
      leadActivity(currentLead.id).then(setActivity).catch(() => setActivity([])).finally(() => setActivityLoading(false));
    }
  }, [tab, currentLead?.id]);

  useEffect(() => { setCurrentLead(lead); }, [lead]);

  const refreshAndKeep = () => { onSaved && onSaved(); };

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" data-testid="presales-detail-dialog">
      {!showEdit && (
      <div className="w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200">
        {/* Colored gradient header */}
        <div className="relative bg-gradient-to-r from-sky-500 via-indigo-500 to-violet-500 px-6 py-5 text-white">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className={`inline-flex h-12 w-12 items-center justify-center rounded-full text-base font-bold shadow-md ${avatarColor(currentLead.name).bg} ${avatarColor(currentLead.name).fg}`}>{initials(currentLead.name)}</span>
              <div>
                <p className="text-lg font-semibold leading-tight" data-testid="presales-detail-name">{currentLead.name}</p>
                <div className="mt-1 flex items-center gap-2">
                  <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white backdrop-blur-sm">
                    {currentLead.source_tab || currentLead.source_type || "—"}
                  </span>
                  <span className="rounded-full bg-white/95 px-2.5 py-0.5 text-[11px] font-semibold text-slate-700">
                    {currentLead.stage}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {currentLead.source_type === "manual" && (
                <Button size="sm" onClick={() => setShowEdit(true)} className="h-8 bg-white text-indigo-600 hover:bg-white/90" data-testid="presales-detail-edit-btn">
                  <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                </Button>
              )}
              <button onClick={onClose} className="rounded-full p-1.5 text-white/80 hover:bg-white/20" data-testid="presales-detail-close">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Pill tabs */}
        <div className="flex flex-wrap gap-1.5 border-b border-slate-100 bg-slate-50/60 px-5 py-2.5">
          {[
            { key: "overview", color: "bg-sky-500" },
            { key: "history", color: "bg-violet-500" },
            { key: "follow-up", color: "bg-emerald-500" },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-full px-3.5 py-1 text-xs font-semibold capitalize transition-all ${tab === t.key ? `${t.color} text-white shadow-sm` : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200"}`}
              data-testid={`presales-detail-tab-${t.key}`}
            >
              {t.key}
            </button>
          ))}
        </div>

        <div className="max-h-[55vh] overflow-y-auto bg-slate-50/30 p-5">
          {tab === "overview" && (
            <div className="space-y-3">
              <ColorSection title="Contact Information" tone="sky" icon={<Phone className="h-4 w-4" />}>
                <ColorRow k="Phone" v={currentLead.phone} />
                <ColorRow k="Email" v={currentLead.email || "—"} />
                <ColorRow k="Location" v={currentLead.location || "—"} />
              </ColorSection>
              <ColorSection title="Additional Details" tone="violet" icon={<FileText className="h-4 w-4" />}>
                <ColorRow k="Expected Consultation" v={currentLead.expected_consultation_date || "—"} />
                <ColorRow k="Months of Pain" v={currentLead.months_of_pain ?? "—"} />
                <ColorRow k="Age" v={currentLead.age ?? "—"} />
                <ColorRow k="Gender" v={currentLead.gender || "—"} />
                <ColorRow k="Occupation" v={currentLead.occupation || "—"} />
                <ColorRow k="Department" v={currentLead.department || "—"} />
                <ColorRow k="Vertical" v={currentLead.vertical} />
              </ColorSection>
              {currentLead.notes && (
                <ColorSection title="Notes" tone="amber" icon={<StickyNote className="h-4 w-4" />}>
                  <p className="text-sm leading-relaxed text-slate-700">{currentLead.notes}</p>
                </ColorSection>
              )}
              {(currentLead.follow_ups || []).filter((f) => f.status !== "rescheduled").length > 0 && (
                <ColorSection title="Follow-up Reminders" tone="emerald" icon={<Bell className="h-4 w-4" />}>
                  {(currentLead.follow_ups || []).filter((f) => f.status !== "rescheduled").slice().reverse().map((f) => {
                    const dt = new Date(`${f.date}T${f.time}:00`);
                    const isUpcoming = dt.getTime() > Date.now();
                    return (
                      <div key={f.id} className={`flex items-start justify-between gap-3 rounded-lg border p-2.5 ${isUpcoming ? "border-emerald-200 bg-emerald-50/60" : "border-slate-200 bg-slate-50"}`} data-testid={`presales-followup-row-${f.id}`}>
                        <div className="flex items-start gap-2">
                          <Clock className={`mt-0.5 h-4 w-4 ${isUpcoming ? "text-emerald-600" : "text-slate-400"}`} />
                          <div>
                            <p className="text-sm font-semibold text-slate-800">
                              {dt.toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short", year: "numeric" })} · {f.time}
                            </p>
                            {f.remarks && <p className="mt-0.5 text-xs text-slate-600">{f.remarks}</p>}
                            <p className="mt-0.5 text-[10px] text-slate-400">Set by {f.created_by || "—"}</p>
                          </div>
                        </div>
                        {isUpcoming && <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold text-white">UPCOMING</span>}
                      </div>
                    );
                  })}
                </ColorSection>
              )}
            </div>
          )}
          {tab !== "overview" && tab === "history" && (
            <div className="space-y-2" data-testid="presales-detail-history">
              {activityLoading && <p className="text-sm text-slate-400">Loading history...</p>}
              {!activityLoading && activity.length === 0 && (
                <div className="rounded-lg border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-400" data-testid="presales-history-empty">
                  No activity recorded yet.
                </div>
              )}
              {!activityLoading && activity.map((a) => (
                <div key={a.id} className="flex items-start gap-3 rounded-lg border border-violet-100 bg-white p-3 shadow-sm" data-testid={`presales-history-row-${a.id}`}>
                  <span className="mt-0.5 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-600">
                    <Clock className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-violet-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-700">{a.action || "event"}</span>
                      <span className="text-[11px] text-slate-400">{new Date(a.created_at).toLocaleString()}</span>
                    </div>
                    {a.details && <p className="mt-1 text-sm text-slate-700">{a.details}</p>}
                    <p className="mt-1 text-[11px] text-slate-400">
                      by {a.created_by || "system"}{a.created_by_role ? ` · ${a.created_by_role}` : ""}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === "follow-up" && (
            <div className="space-y-2" data-testid="presales-detail-followups">
              {(currentLead.follow_ups || []).length === 0 && (
                <div className="rounded-lg border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-400" data-testid="presales-followups-empty">
                  No follow-ups scheduled yet. Use <span className="font-semibold">Move to Stage → Follow Up</span> to schedule one.
                </div>
              )}
              {(currentLead.follow_ups || []).slice().reverse().map((f, idx) => {
                const dt = new Date(`${f.date}T${f.time}:00`);
                const isUpcoming = dt.getTime() > Date.now();
                const isRescheduled = f.status === "rescheduled";
                const isActive = idx === 0 && !isRescheduled;
                return (
                  <div
                    key={f.id}
                    className={`flex items-start gap-3 rounded-lg border p-3 shadow-sm ${
                      isRescheduled ? "border-slate-200 bg-slate-50/70 opacity-70" : isUpcoming ? "border-emerald-200 bg-emerald-50/40" : "border-slate-200 bg-white"
                    }`}
                    data-testid={`presales-followup-tab-row-${f.id}`}
                  >
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
                      {f.remarks && (
                        <div className="mt-1.5 rounded-md bg-white px-2.5 py-1.5 text-sm text-slate-700 ring-1 ring-slate-100">
                          {f.remarks}
                        </div>
                      )}
                      {isRescheduled && f.reschedule_reason && (
                        <div className="mt-1.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700 ring-1 ring-amber-100">
                          <span className="font-semibold">Reschedule reason:</span> {f.reschedule_reason}
                        </div>
                      )}
                      <p className="mt-1.5 text-[11px] text-slate-400">Set by {f.created_by || "—"} · {new Date(f.created_at).toLocaleString()}</p>
                    </div>
                    {isActive && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 flex-shrink-0 border-amber-200 text-amber-700 hover:bg-amber-50"
                        onClick={() => setRescheduleDraft({ followupId: f.id, date: f.date, time: f.time, reason: "" })}
                        data-testid={`presales-followup-reschedule-${f.id}`}
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

        <div className="border-t border-slate-200 bg-white px-5 py-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
            <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
            Move to Stage
          </p>
          <div className="flex flex-wrap gap-2" data-testid="presales-detail-move-stages">
            {stages.filter((s) => s.name === "New Leads" ? currentLead.stage === "New Leads" : true).map((s) => {
              const active = currentLead.stage === s.name;
              const handleClick = async () => {
                if (s.name === "Follow Up") {
                  // Open the follow-up scheduling form instead of moving immediately
                  const today = new Date();
                  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
                  setFollowUpDraft({
                    date: tomorrow.toISOString().slice(0, 10),
                    time: "10:00",
                    remarks: "",
                  });
                  return;
                }
                if (s.name === "Appointment") {
                  const tmrw = new Date(Date.now() + 24 * 60 * 60 * 1000);
                  setAppointmentDraft({ department: "", appointment_date: tmrw.toISOString().slice(0, 10), appointment_time: "10:00", remarks: "" });
                  return;
                }
                await onMoveStage(currentLead.id, s.name);
                setCurrentLead({ ...currentLead, stage: s.name });
              };
              return (
                <button
                  key={s.id}
                  onClick={handleClick}
                  disabled={active}
                  className="rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
                  style={
                    active
                      ? { background: s.color, color: "#fff", boxShadow: `0 2px 8px ${s.color}40` }
                      : { background: `${s.color}14`, color: s.color, border: `1px solid ${s.color}33` }
                  }
                  data-testid={`presales-detail-move-${s.name}`}
                >
                  {active && <CheckCircle2 className="mr-1 inline h-3 w-3" />}
                  {s.name}
                </button>
              );
            })}
          </div>

          {currentLead.stage === "RNR" && (
            <div className="mt-3 flex items-center justify-between rounded-lg border border-rose-200 bg-rose-50 px-3 py-2" data-testid="presales-detail-rnr-tracker">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-100 text-rose-600">
                  <PhoneOff className="h-3.5 w-3.5" />
                </span>
                <div>
                  <p className="text-xs font-semibold text-rose-700">Client Not Answered</p>
                  <p className="text-[11px] text-rose-500">
                    Attempts so far: <span className="font-bold">{currentLead.rnr_attempts || 0}</span>
                    {currentLead.rnr_last_attempt_at && <span className="ml-2">· last {new Date(currentLead.rnr_last_attempt_at).toLocaleString()}</span>}
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                onClick={async () => {
                  try {
                    const updated = await rnrAttempt(currentLead.id);
                    setCurrentLead(updated);
                    toast.success(`Attempt logged (#${updated.rnr_attempts})`);
                    onSaved && onSaved();
                  } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
                }}
                className="h-8 bg-rose-600 text-white hover:bg-rose-700"
                data-testid="presales-detail-rnr-attempt"
              >
                <PhoneOff className="mr-1 h-3.5 w-3.5" /> +1 No Answer
              </Button>
            </div>
          )}
        </div>
      </div>
      )}

      {showEdit && (
        <LeadEditModal lead={currentLead} onClose={() => setShowEdit(false)} onSaved={() => { refreshAndKeep(); setShowEdit(false); }} />
      )}

      {followUpDraft && !showEdit && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4" data-testid="presales-followup-modal">
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-4 text-white">
              <div className="flex items-center gap-2">
                <Bell className="h-5 w-5" />
                <p className="text-base font-semibold">Schedule Follow-Up</p>
              </div>
              <button onClick={() => setFollowUpDraft(null)} className="rounded-full p-1.5 text-white/80 hover:bg-white/20" data-testid="presales-followup-close">
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
                  data-testid="presales-followup-date"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Time *</label>
                <Input
                  type="time"
                  value={followUpDraft.time}
                  onChange={(e) => setFollowUpDraft({ ...followUpDraft, time: e.target.value })}
                  data-testid="presales-followup-time"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Remarks</label>
                <textarea
                  rows={3}
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
                  placeholder="What to discuss in the next call..."
                  value={followUpDraft.remarks}
                  onChange={(e) => setFollowUpDraft({ ...followUpDraft, remarks: e.target.value })}
                  data-testid="presales-followup-remarks"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/40 px-5 py-3">
              <Button variant="outline" onClick={() => setFollowUpDraft(null)} data-testid="presales-followup-cancel">Cancel</Button>
              <Button
                className="bg-amber-500 text-white hover:bg-amber-600"
                onClick={async () => {
                  if (!followUpDraft.date || !followUpDraft.time) {
                    toast.error("Date and time are required");
                    return;
                  }
                  try {
                    const updated = await scheduleFollowUp(currentLead.id, followUpDraft);
                    setCurrentLead(updated);
                    setFollowUpDraft(null);
                    toast.success(`Follow-up scheduled for ${followUpDraft.date} at ${followUpDraft.time}`);
                    onSaved && onSaved();
                  } catch (e) { toast.error(e?.response?.data?.detail || "Failed to schedule"); }
                }}
                data-testid="presales-followup-save"
              >
                <CheckCircle2 className="mr-1 h-4 w-4" /> Save & Move to Follow Up
              </Button>
            </div>
          </div>
        </div>
      )}

      {rescheduleDraft && !showEdit && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4" data-testid="presales-reschedule-modal">
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-4 text-white">
              <div className="flex items-center gap-2">
                <Bell className="h-5 w-5" />
                <p className="text-base font-semibold">Reschedule Follow-Up</p>
              </div>
              <button onClick={() => setRescheduleDraft(null)} className="rounded-full p-1.5 text-white/80 hover:bg-white/20" data-testid="presales-reschedule-close">
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
                  data-testid="presales-reschedule-date"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">New Time *</label>
                <Input
                  type="time"
                  value={rescheduleDraft.time}
                  onChange={(e) => setRescheduleDraft({ ...rescheduleDraft, time: e.target.value })}
                  data-testid="presales-reschedule-time"
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
                  data-testid="presales-reschedule-reason"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/40 px-5 py-3">
              <Button variant="outline" onClick={() => setRescheduleDraft(null)} data-testid="presales-reschedule-cancel">Cancel</Button>
              <Button
                className="bg-amber-500 text-white hover:bg-amber-600"
                onClick={async () => {
                  if (!rescheduleDraft.date || !rescheduleDraft.time || !rescheduleDraft.reason.trim()) {
                    toast.error("Date, time and reason are required");
                    return;
                  }
                  try {
                    const updated = await rescheduleFollowUp(currentLead.id, rescheduleDraft.followupId, {
                      date: rescheduleDraft.date, time: rescheduleDraft.time, reason: rescheduleDraft.reason,
                    });
                    setCurrentLead(updated);
                    setRescheduleDraft(null);
                    toast.success(`Follow-up rescheduled to ${rescheduleDraft.date} at ${rescheduleDraft.time}`);
                    onSaved && onSaved();
                  } catch (e) { toast.error(e?.response?.data?.detail || "Failed to reschedule"); }
                }}
                data-testid="presales-reschedule-save"
              >
                <CheckCircle2 className="mr-1 h-4 w-4" /> Reschedule
              </Button>
            </div>
          </div>
        </div>
      )}

      {appointmentDraft && !showEdit && (() => {
        const step = !appointmentDraft.department ? "department" : "details";
        const myBranchName = branches.find((b) => b.id === currentUser?.branch_id)?.branch_name || branches.find((b) => b.id === currentUser?.branch_id)?.name || "";
        const resolvedBranchName = () => myBranchName || branches.find((b) => b.id === appointmentDraft.branch_id)?.branch_name || branches.find((b) => b.id === appointmentDraft.branch_id)?.name || "your branch";
        const closeAll = () => { setAppointmentDraft(null); setAppointmentResult(null); };
        return (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4" data-testid="presales-appointment-modal">
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-gradient-to-r from-emerald-500 to-teal-600 px-5 py-4 text-white">
              <div className="flex items-center gap-2">
                <CalendarIcon className="h-5 w-5" />
                <p className="text-base font-semibold">{appointmentResult ? "Moved to Branch Admin" : "Schedule Appointment"}</p>
              </div>
              <button onClick={closeAll} className="rounded-full p-1.5 text-white/80 hover:bg-white/20" data-testid="presales-appointment-close">
                <X className="h-4 w-4" />
              </button>
            </div>

            {appointmentResult ? (
              <>
                <div className="space-y-3 p-5">
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-emerald-700">Sent To Branch Admin</p>
                    <dl className="space-y-1.5 text-sm">
                      <div className="flex justify-between"><dt className="text-slate-500">Service</dt><dd className="font-semibold text-slate-800">{appointmentResult.department === "physio" ? "Physiotherapy" : "Fitness"}</dd></div>
                      <div className="flex justify-between"><dt className="text-slate-500">Branch</dt><dd className="font-semibold text-slate-800">{appointmentResult.branchName}</dd></div>
                      <div className="flex justify-between"><dt className="text-slate-500">Date</dt><dd className="font-semibold text-slate-800">{appointmentResult.appointment_date}</dd></div>
                      <div className="flex justify-between"><dt className="text-slate-500">Time</dt><dd className="font-semibold text-slate-800">{appointmentResult.appointment_time}</dd></div>
                    </dl>
                    <p className="mt-2 border-t border-emerald-200 pt-2 text-[11px] text-emerald-700">
                      The branch admin will see this in New Appointment and assign a Fitsiomax Expert for this date &amp; time.
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Lead Summary</p>
                    <p className="text-sm font-semibold text-slate-800">{currentLead.name || "Unknown"}</p>
                    <p className="text-xs text-slate-500">{currentLead.phone}</p>
                  </div>
                  {appointmentResult.remarks && (
                    <div className="rounded-lg border border-slate-200 p-3">
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Remarks</p>
                      <p className="text-sm text-slate-700">{appointmentResult.remarks}</p>
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/40 px-5 py-3">
                  <Button className="bg-emerald-500 text-white hover:bg-emerald-600" onClick={closeAll} data-testid="presales-appointment-done">
                    <CheckCircle2 className="mr-1 h-4 w-4" /> Done
                  </Button>
                </div>
              </>
            ) : (
            <>
            <div className="space-y-4 p-5">
              {step === "department" && (
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-600">Which service?</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setAppointmentDraft({ ...appointmentDraft, department: "physio" })}
                      className="flex items-center justify-center gap-2 rounded-lg border-2 border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 transition-all hover:border-emerald-300 hover:text-emerald-700"
                      data-testid="presales-appointment-dept-physio"
                    >
                      <Stethoscope className="h-4 w-4" /> Physiotherapy
                    </button>
                    <button
                      type="button"
                      onClick={() => setAppointmentDraft({ ...appointmentDraft, department: "fitness" })}
                      className="flex items-center justify-center gap-2 rounded-lg border-2 border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 transition-all hover:border-teal-300 hover:text-teal-700"
                      data-testid="presales-appointment-dept-fitness"
                    >
                      <Dumbbell className="h-4 w-4" /> Fitness
                    </button>
                  </div>
                </div>
              )}

              {step === "details" && (
                <div>
                  <button
                    type="button"
                    onClick={() => setAppointmentDraft({ ...appointmentDraft, department: "" })}
                    className="mb-2 flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"
                    data-testid="presales-appointment-back-department"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" /> {appointmentDraft.department === "physio" ? "Physiotherapy" : "Fitness"}
                  </button>

                  {appointmentDraft.department === "fitness" ? (
                    <div className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-xs text-teal-700">
                      Fitness scheduling is coming soon — for now, Physiotherapy appointments can be scheduled end-to-end.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {myBranchName ? (
                        <div className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                          <Building2 className="h-3.5 w-3.5" /> {myBranchName}
                        </div>
                      ) : (
                        <div>
                          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-600">Select Branch *</label>
                          <select
                            value={appointmentDraft.branch_id || ""}
                            onChange={(e) => setAppointmentDraft({ ...appointmentDraft, branch_id: e.target.value })}
                            className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400"
                            data-testid="presales-appointment-branch"
                          >
                            <option value="">-- choose a branch --</option>
                            {branches.map((b) => (
                              <option key={b.id} value={b.id}>{b.branch_name || b.name}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-600">Date *</label>
                          <Input
                            type="date"
                            value={appointmentDraft.appointment_date}
                            min={new Date().toISOString().slice(0, 10)}
                            onChange={(e) => setAppointmentDraft({ ...appointmentDraft, appointment_date: e.target.value })}
                            data-testid="presales-appointment-date"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-600">Time *</label>
                          <Input
                            type="time"
                            value={appointmentDraft.appointment_time}
                            onChange={(e) => setAppointmentDraft({ ...appointmentDraft, appointment_time: e.target.value })}
                            data-testid="presales-appointment-time"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-600">Remarks</label>
                        <textarea
                          rows={3}
                          className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400"
                          placeholder="e.g. Lower back pain, 3 months"
                          value={appointmentDraft.remarks}
                          onChange={(e) => setAppointmentDraft({ ...appointmentDraft, remarks: e.target.value })}
                          data-testid="presales-appointment-remarks"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/40 px-5 py-3">
              <Button variant="outline" onClick={closeAll} data-testid="presales-appointment-cancel">Cancel</Button>
              {step === "details" && appointmentDraft.department === "physio" && (
                <Button
                  className="bg-emerald-500 text-white hover:bg-emerald-600"
                  onClick={async () => {
                    if (!myBranchName && !appointmentDraft.branch_id) {
                      toast.error("Please select a branch");
                      return;
                    }
                    if (!appointmentDraft.appointment_date || !appointmentDraft.appointment_time) {
                      toast.error("Pick a date and time");
                      return;
                    }
                    try {
                      const payload = {
                        department: appointmentDraft.department,
                        mode: "offline",
                        appointment_date: appointmentDraft.appointment_date,
                        appointment_time: appointmentDraft.appointment_time,
                        remarks: appointmentDraft.remarks,
                      };
                      if (!myBranchName) payload.branch_id = appointmentDraft.branch_id;
                      const updated = await scheduleAppointment(currentLead.id, payload);
                      setCurrentLead(updated);
                      setAppointmentResult({
                        department: appointmentDraft.department,
                        branchName: resolvedBranchName(),
                        appointment_date: appointmentDraft.appointment_date,
                        appointment_time: appointmentDraft.appointment_time,
                        remarks: appointmentDraft.remarks,
                      });
                      onSaved && onSaved();
                    } catch (e) { toast.error(e?.response?.data?.detail || "Failed to schedule appointment"); }
                  }}
                  data-testid="presales-appointment-save"
                >
                  <CheckCircle2 className="mr-1 h-4 w-4" /> Move to Branch Admin
                </Button>
              )}
            </div>
            </>
            )}
          </div>
        </div>
        );
      })()}
    </div>
  );
};

const Section = ({ title, children }) => (
  <div className="rounded-lg border border-slate-200 p-3">
    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
    <div className="space-y-1">{children}</div>
  </div>
);

const Row = ({ k, v }) => (
  <div className="flex items-center justify-between text-xs">
    <span className="text-slate-500">{k}</span>
    <span className="text-slate-800">{String(v)}</span>
  </div>
);

const TONE_MAP = {
  sky: { bar: "bg-sky-500", iconBg: "bg-sky-100 text-sky-600", title: "text-sky-700", border: "border-sky-100" },
  violet: { bar: "bg-violet-500", iconBg: "bg-violet-100 text-violet-600", title: "text-violet-700", border: "border-violet-100" },
  amber: { bar: "bg-amber-500", iconBg: "bg-amber-100 text-amber-700", title: "text-amber-700", border: "border-amber-100" },
  emerald: { bar: "bg-emerald-500", iconBg: "bg-emerald-100 text-emerald-700", title: "text-emerald-700", border: "border-emerald-100" },
};

const ColorSection = ({ title, tone = "sky", icon, children }) => {
  const t = TONE_MAP[tone] || TONE_MAP.sky;
  return (
    <div className={`overflow-hidden rounded-xl border bg-white shadow-sm ${t.border}`}>
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${t.iconBg}`}>{icon}</span>
        <p className={`text-xs font-bold uppercase tracking-wider ${t.title}`}>{title}</p>
      </div>
      <div className="space-y-2 px-4 py-3">{children}</div>
    </div>
  );
};

const ColorRow = ({ k, v }) => (
  <div className="flex items-center justify-between text-sm">
    <span className="text-xs font-medium text-slate-500">{k}</span>
    <span className="font-medium text-slate-800">{String(v)}</span>
  </div>
);

export default PreSalesCRM;
