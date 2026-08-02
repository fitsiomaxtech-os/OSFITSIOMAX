import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, Plus, Search, Settings as Cog, Calendar as CalendarIcon, Phone, FileText, StickyNote, ArrowRight, CheckCircle2, X, Pencil, PhoneOff, Clock, Bell, Building2, Trash2, Lock, Users, CalendarCheck, UserRound, LogOut, Mail, Youtube } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import {
  getLeads, createManualLead, stagesList, updateLead, rnrAttempt, scheduleFollowUp, rescheduleFollowUp, scheduleAppointment, getBranches, leadActivity, deleteLead,
  listTestimonials, addTestimonial, deleteTestimonial,
} from "@/lib/api";
import { LeadEditModal } from "@/components/LeadEditModal";
import { CreateLeadModal } from "@/components/CreateLeadModal";
import { SourcePill } from "@/components/marketing/SourcePill";
import { PullFromSheetButton } from "@/components/PullFromSheetButton";
import { DateFilterPopover } from "@/components/DateFilterPopover";
import { StageTabBar } from "@/components/ui/stage-tab";

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

// 10-digit → prepend 91; 11-digit leading 0 → drop the 0 and prepend 91 — same
// sanitizer used for WhatsApp links elsewhere in this app (PhysioBoard, Client Portal).
const waNumber = (raw) => {
  const digits = (raw || "").replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  return digits;
};

// lucide-react has no WhatsApp glyph, so this is hand-drawn (duplicated per-file,
// matching the convention already used in PhysioBoard.jsx / PatientsPortalPanel.jsx).
const WhatsAppIcon = ({ className }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor">
    <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.29-1.39a9.9 9.9 0 0 0 4.75 1.21h.01c5.46 0 9.9-4.45 9.9-9.91C21.96 6.45 17.5 2 12.04 2m0 18.15a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.14.82.84-3.06-.2-.31a8.22 8.22 0 0 1-1.26-4.36c0-4.54 3.7-8.24 8.25-8.24 2.2 0 4.27.86 5.83 2.42a8.18 8.18 0 0 1 2.41 5.83c0 4.55-3.7 8.24-8.24 8.24m4.52-6.17c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.17.24-.64.81-.78.97-.15.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.24-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.5.11-.11.25-.29.37-.43.13-.15.17-.25.25-.42.08-.17.04-.31-.02-.43-.06-.12-.56-1.36-.77-1.86-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31s-.87.85-.87 2.08.89 2.41 1.02 2.58c.12.17 1.75 2.67 4.24 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.08.15-1.18-.06-.1-.23-.16-.48-.28"/>
  </svg>
);

const testimonialsUrl = () => `${window.location.origin}/testimonials`;

// Call → native dialer (tel:); WhatsApp → a template message pointing the lead at the
// patient testimonial videos before the rep even gets them on the phone. Same-tab
// navigation (window.location.href, not window.open), matching the fix applied
// elsewhere for the mobile "blank screen on return from WhatsApp" bug.
const LeadContactIcons = ({ lead }) => {
  if (!lead.phone) return null;
  const num = waNumber(lead.phone);
  const handleCall = (e) => { e.stopPropagation(); window.location.href = `tel:${lead.phone}`; };
  const handleWhatsApp = (e) => {
    e.stopPropagation();
    const text = [
      `Hi ${lead.name || "there"}, this is Fitsiomax!`,
      "",
      "Take a look at real patient success stories before we connect:",
      testimonialsUrl(),
    ].join("\n");
    window.location.href = `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
  };
  return (
    <div className="flex items-center justify-center gap-1">
      <button type="button" onClick={handleCall} className="rounded-full p-1.5 text-sky-600 hover:bg-sky-50" title="Call" data-testid={`presales-call-${lead.id}`}>
        <Phone className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={handleWhatsApp} className="rounded-full p-1.5 text-emerald-600 hover:bg-emerald-50" title="WhatsApp" data-testid={`presales-whatsapp-${lead.id}`}>
        <WhatsAppIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};

// Shared between the desktop Appointment column and the mobile Consultations tab —
// same branch_stage vocabulary the Branch Admin's own pipeline already uses.
const branchStatusInfo = (lead, branches) => {
  const branchName = lead.branch_id
    ? (branches.find((b) => b.id === lead.branch_id)?.branch_name || branches.find((b) => b.id === lead.branch_id)?.name)
    : (lead.appointment_mode === "online" ? "Online Consultation" : "Unassigned");
  const status = lead.branch_stage || "Pending";
  const statusColor = {
    "New Appointment": "bg-blue-50 text-blue-700 border-blue-200",
    "Portfolio": "bg-violet-50 text-violet-700 border-violet-200",
    "Follow Up": "bg-orange-50 text-orange-700 border-orange-200",
    "Appointment Date & Time": "bg-teal-50 text-teal-700 border-teal-200",
    "Cancelled": "bg-rose-50 text-rose-700 border-rose-200",
  }[status] || "bg-slate-50 text-slate-600 border-slate-200";
  return { branchName, status, statusColor };
};

const PRESALES_TABS = [
  { key: "leads", label: "Leads", icon: Users },
  { key: "consultations", label: "Consultations", icon: CalendarCheck },
  { key: "profile", label: "Profile", icon: UserRound },
];

const PRESALES_CRM_LOCKED = false;

export const PreSalesCRM = ({ onManageStages, role, currentUser, onLogout }) => {
  const [stages, setStages] = useState([]);
  const [leads, setLeads] = useState([]);
  const [branches, setBranches] = useState([]);
  const [search, setSearch] = useState("");
  // Opens on New Leads, not All — that's the stage that needs action; a rep shouldn't
  // have to dig through everything already worked on just to see what's new.
  const [stageFilter, setStageFilter] = useState("New Leads");
  const [sourceFilter, setSourceFilter] = useState("");
  const [dateFilter, setDateFilter] = useState(null);
  const [editing, setEditing] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [loading, setLoading] = useState(false);
  const [visibleCount, setVisibleCount] = useState(50);
  const [activeTab, setActiveTab] = useState("leads"); // mobile bottom-nav only; desktop always shows Leads

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

  // Mobile Consultations tab — this rep's leads currently booked for a consultation.
  // Not narrowed by the Leads tab's own date filter — ConsultationsTab applies its own.
  const appointmentLeads = useMemo(
    () => leads.filter((l) => l.stage === "Appointment").sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")),
    [leads],
  );

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

  // flex+gap, not space-y — space-y's sibling selector keys off the `hidden` HTML
  // attribute, not the `hidden` class, so the desktop leads block (hidden by class
  // on mobile, not attribute) would still count as a sibling and hand the next
  // block phantom top margin for content a phone never draws.
  return (
    <div className={`flex flex-col gap-5 ${role === "pre_sales" ? "pb-20 md:pb-0" : ""}`} data-testid="presales-crm-page">
    <div className={role === "pre_sales" ? "hidden space-y-5 md:block" : "space-y-5"} data-testid="presales-leads-tab">
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
                <tr><th className="px-3 py-2 text-left">LEAD</th><th className="px-3 py-2">PHONE</th><th className="px-3 py-2">EMAIL</th><th className="px-3 py-2">SOURCE</th><th className="px-3 py-2">STAGE</th>{stageFilter === "Appointment" && <th className="px-3 py-2">BRANCH ADMIN STATUS</th>}<th className="px-3 py-2">CREATED</th><th className="px-3 py-2">ASSIGNED TO</th><th className="px-3 py-2">ACTIONS</th></tr>
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
                      <td className="border-y border-slate-200 bg-white px-3 py-3 text-center transition-colors group-hover:bg-slate-50">
                        <div className="flex flex-col items-center gap-1">
                          <span className="font-mono text-xs text-slate-700">{l.phone || "—"}</span>
                          <LeadContactIcons lead={l} />
                        </div>
                      </td>
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
                        const { branchName, status, statusColor } = branchStatusInfo(l, branches);
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
                      <td className="border-y border-slate-200 bg-white px-3 py-3 text-center transition-colors group-hover:bg-slate-50" onClick={(e) => e.stopPropagation()}>
                        <select
                          value={l.branch_id || ""}
                          onChange={async (e) => {
                            const branchId = e.target.value;
                            if (!branchId) return;
                            try {
                              await scheduleAppointment(l.id, { department: "physio", mode: "offline", branch_id: branchId });
                              toast.success(`Assigned to ${branches.find((b) => b.id === branchId)?.branch_name || branches.find((b) => b.id === branchId)?.name || "branch"}`);
                              load();
                            } catch (err) { toast.error(err?.response?.data?.detail || "Failed to assign branch"); }
                          }}
                          className="h-8 rounded-md border border-slate-200 px-2 text-xs focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400"
                          data-testid={`presales-assign-branch-${l.id}`}
                        >
                          <option value="">— Assign —</option>
                          {branches.map((b) => (
                            <option key={b.id} value={b.id}>{b.branch_name || b.name}</option>
                          ))}
                        </select>
                      </td>
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
                {filtered.length === 0 && <tr><td colSpan={stageFilter === "Appointment" ? 9 : 8} className="px-3 py-8 text-center text-slate-400">{loading ? "Loading..." : "No leads match."}</td></tr>}
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
    </div>

      {role === "pre_sales" && activeTab === "leads" && (
        <div className="space-y-3 md:hidden" data-testid="presales-leads-mobile">
          <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search leads..."
              className="h-8 border-0 p-0 focus-visible:ring-0"
              data-testid="presales-mobile-search"
            />
            <DateFilterPopover value={dateFilter} onChange={setDateFilter} testid="presales-mobile-date-filter" />
            <PullFromSheetButton onPulled={() => { load(); setStageFilter("New Leads"); }} iconOnly />
          </div>

          <StageTabBar
            stages={stages}
            stageFilter={stageFilter === "All" ? null : stageFilter}
            setStageFilter={(v) => setStageFilter(v === null ? "All" : v)}
            counts={stageCounts}
            totalCount={stageCounts.All}
            testid="presales-mobile-stagebar"
          />

          <div className="space-y-2">
            {visibleLeads.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-200 px-3 py-10 text-center text-sm text-slate-400">
                {loading ? "Loading..." : "No leads match."}
              </p>
            ) : visibleLeads.map((l) => {
              const stg = stages.find((s) => s.name === l.stage);
              const hex = stg?.color || "#64748b";
              return (
                <div
                  key={l.id}
                  onClick={() => setEditing(l)}
                  className="rounded-xl border border-slate-200 bg-white p-3"
                  data-testid={`presales-mobile-card-${l.id}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${avatarColor(l.name).bg} ${avatarColor(l.name).fg}`}>{initials(l.name)}</span>
                      <p className="min-w-0 truncate text-sm font-bold text-slate-800">{l.name || "—"}</p>
                    </div>
                    <span className="shrink-0 rounded-[5px] px-2 py-0.5 text-[10px] font-bold" style={{ background: `${hex}14`, color: hex, border: `1px solid ${hex}33` }}>
                      {l.stage}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
                      {l.stage === "RNR" && (l.rnr_attempts || 0) > 0 && (
                        <span className="inline-flex items-center gap-0.5 font-semibold text-rose-600">
                          <PhoneOff className="h-2.5 w-2.5" />×{l.rnr_attempts}
                        </span>
                      )}
                      {l.stage === "Follow Up" && l.next_follow_up_at && (
                        <span className="inline-flex items-center gap-0.5 font-semibold text-amber-600">
                          <Clock className="h-2.5 w-2.5" />
                          {new Date(l.next_follow_up_at).toLocaleDateString(undefined, { day: "2-digit", month: "short" })}
                        </span>
                      )}
                      {(l.source_tab || l.source_type) && <span className="truncate">{l.source_tab || l.source_type}</span>}
                    </div>
                    <LeadContactIcons lead={l} />
                  </div>
                </div>
              );
            })}
          </div>

          {filtered.length > visibleCount && (
            <div className="flex items-center justify-center pt-1">
              <Button variant="outline" onClick={() => setVisibleCount((c) => c + 50)} data-testid="presales-mobile-load-more">
                Load More ({filtered.length - visibleCount} remaining)
              </Button>
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="fixed bottom-24 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-sky-600 text-white shadow-lg hover:bg-sky-700"
            data-testid="presales-mobile-create-fab"
            aria-label="Create Lead"
          >
            <Plus className="h-6 w-6" />
          </button>
        </div>
      )}

      {role === "pre_sales" && activeTab === "consultations" && (
        <ConsultationsTab leads={appointmentLeads} branches={branches} loading={loading} onOpen={setEditing} />
      )}

      {role === "pre_sales" && activeTab === "profile" && (
        <ProfileTab currentUser={currentUser} branches={branches} onLogout={onLogout} />
      )}

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

      {role === "pre_sales" && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white md:hidden" data-testid="presales-bottom-nav">
          <div className="mx-auto flex max-w-lg items-stretch justify-around">
            {PRESALES_TABS.map((t) => {
              const Icon = t.icon;
              const active = activeTab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setActiveTab(t.key)}
                  className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition-colors ${active ? "text-sky-600" : "text-slate-400"}`}
                  data-testid={`presales-nav-${t.key}`}
                >
                  <Icon className="h-5 w-5" />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

// ============ Mobile: Consultations tab (leads booked for a consultation) ============

// Read-only milestone tracker for what happens to a lead after it's handed to a
// branch: branch_stage carries the first two ("New Appointment" is set the instant a
// branch is assigned; "Appointment Date & Time" is set once a specific date/time is
// booked, and branch_stage never advances past it). The doctor finishing the visit
// and suggesting a treatment plan is a *different* field — consultation_stage (or
// head_consultation_stage) hits "Consultation Visit" — so it's tracked separately and
// can be true at the same time branch_stage is still "Appointment Date & Time".
const CONSULT_MILESTONES = [
  { key: "new", label: "New Branch Assign", color: "#0ea5e9" },
  { key: "booked", label: "Consultation Booked", color: "#f59e0b" },
  { key: "completed", label: "Consultation Completed", color: "#22c55e" },
];

const consultMilestoneMatch = (l, key) => {
  if (key === "new") return l.branch_stage === "New Appointment";
  if (key === "booked") return l.branch_stage === "Appointment Date & Time";
  if (key === "completed") return l.consultation_stage === "Consultation Visit" || l.head_consultation_stage === "Consultation Visit";
  return false;
};

const ConsultationsTab = ({ leads, branches, loading, onOpen }) => {
  const [dateFilter, setDateFilter] = useState(null);
  const [milestoneFilter, setMilestoneFilter] = useState(null);

  const milestoneCounts = useMemo(() => ({
    new: leads.filter((l) => consultMilestoneMatch(l, "new")).length,
    booked: leads.filter((l) => consultMilestoneMatch(l, "booked")).length,
    completed: leads.filter((l) => consultMilestoneMatch(l, "completed")).length,
  }), [leads]);

  // Filters by appointment_date (when the consultation is booked), not created_at —
  // same field ConsultationsBoard's own date filter uses for this stage of leads.
  const filtered = useMemo(() => {
    let rows = leads;
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
    if (milestoneFilter) rows = rows.filter((l) => consultMilestoneMatch(l, milestoneFilter));
    return rows;
  }, [leads, dateFilter, milestoneFilter]);

  return (
    <div className="space-y-3 md:hidden" data-testid="presales-consultations-tab">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-700">Consultations ({filtered.length})</h2>
        <DateFilterPopover value={dateFilter} onChange={setDateFilter} testid="presales-consult-date-filter" />
      </div>

      <div className="grid grid-cols-3 gap-2" data-testid="presales-consult-milestones">
        {CONSULT_MILESTONES.map((m) => {
          const active = milestoneFilter === m.key;
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => setMilestoneFilter(active ? null : m.key)}
              className="rounded-xl p-2.5 text-center transition-all"
              style={
                active
                  ? { background: m.color, color: "#fff", boxShadow: `0 2px 8px ${m.color}40` }
                  : { background: `${m.color}14`, color: m.color, border: `1px solid ${m.color}33` }
              }
              data-testid={`presales-consult-milestone-${m.key}`}
            >
              <p className="text-lg font-bold leading-none">{milestoneCounts[m.key]}</p>
              <p className="mt-1 text-[9px] font-semibold uppercase leading-tight tracking-tight">{m.label}</p>
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white py-10 text-center text-sm text-slate-400">
          {loading ? "Loading..." : "No consultations booked yet."}
        </p>
      ) : (
        filtered.map((l) => {
          const { branchName, status, statusColor } = branchStatusInfo(l, branches);
          const completed = consultMilestoneMatch(l, "completed");
          return (
            <div
              key={l.id}
              onClick={() => onOpen(l)}
              className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
              data-testid={`presales-consultation-card-${l.id}`}
            >
              <div className="flex items-center gap-2">
                <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${avatarColor(l.name).bg} ${avatarColor(l.name).fg}`}>{initials(l.name)}</span>
                <p className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{l.name}</p>
                <LeadContactIcons lead={l} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-medium text-slate-600">{branchName || "—"}</span>
                <span className={`inline-flex items-center rounded border px-1.5 text-[10px] font-semibold ${statusColor}`}>{status}</span>
                {l.assigned_physio_name ? (
                  <span className="text-[10px] text-emerald-600">Expert: {l.assigned_physio_name}</span>
                ) : (
                  <span className="text-[10px] text-amber-600">Pending Expert</span>
                )}
                {completed && (
                  <span className="inline-flex items-center gap-0.5 rounded border border-emerald-200 bg-emerald-50 px-1.5 text-[10px] font-semibold text-emerald-700">
                    <CheckCircle2 className="h-2.5 w-2.5" />Treatment Suggested
                  </span>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
};

// ============ Mobile: Profile tab (rep's own info + testimonial video management) ============

const ProfileTab = ({ currentUser, branches, onLogout }) => {
  const [videos, setVideos] = useState([]);
  const [loadingVideos, setLoadingVideos] = useState(false);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);

  const loadVideos = useCallback(async () => {
    setLoadingVideos(true);
    try { setVideos(await listTestimonials()); }
    catch { /* keep whatever was already shown */ }
    setLoadingVideos(false);
  }, []);

  useEffect(() => { loadVideos(); }, [loadVideos]);

  const branchName = currentUser?.branch_id
    ? (branches.find((b) => b.id === currentUser.branch_id)?.branch_name || branches.find((b) => b.id === currentUser.branch_id)?.name)
    : null;
  const joinedOn = currentUser?.created_at
    ? new Date(currentUser.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })
    : "—";

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!url.trim()) return;
    setSaving(true);
    try {
      await addTestimonial({ youtube_url: url.trim(), title: title.trim() || undefined });
      setUrl(""); setTitle("");
      toast.success("Testimonial added");
      loadVideos();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not add — check the YouTube link");
    }
    setSaving(false);
  };

  const handleDelete = async (id) => {
    try { await deleteTestimonial(id); setVideos((v) => v.filter((x) => x.id !== id)); }
    catch { toast.error("Delete failed"); }
  };

  return (
    <div className="space-y-4 md:hidden" data-testid="presales-profile-tab">
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-sky-100 text-xl font-bold text-sky-700">
              {currentUser?.full_name?.charAt(0)?.toUpperCase() || "?"}
            </div>
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-slate-800">{currentUser?.full_name}</p>
              <p className="flex items-center gap-1 text-xs text-slate-400"><Mail className="h-3 w-3" />{currentUser?.email}</p>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <span className="text-xs text-slate-400">Role</span>
              <span className="text-sm font-medium text-slate-700">Pre-Sales</span>
            </div>
            {branchName && (
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <span className="text-xs text-slate-400">Branch</span>
                <span className="text-sm font-medium text-slate-700">{branchName}</span>
              </div>
            )}
            <div className="flex items-center justify-between pb-1">
              <span className="text-xs text-slate-400">Joined On</span>
              <span className="text-sm font-medium text-slate-700">{joinedOn}</span>
            </div>
          </div>
          <Button variant="outline" onClick={onLogout} className="mt-4 w-full text-rose-600 hover:bg-rose-50" data-testid="presales-profile-logout">
            <LogOut className="mr-1.5 h-4 w-4" />Logout
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-1.5 text-sm">
            <Youtube className="h-4 w-4 text-rose-500" />Testimonial Videos
          </CardTitle>
          <p className="text-xs text-slate-400">Shown live on the link shared with leads over WhatsApp.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <form onSubmit={handleAdd} className="space-y-2">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste YouTube video link" data-testid="presales-testimonial-url" />
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" data-testid="presales-testimonial-title" />
            <Button type="submit" disabled={saving || !url.trim()} className="w-full bg-sky-600 hover:bg-sky-700" data-testid="presales-testimonial-add">
              {saving ? "Adding..." : "Add Video"}
            </Button>
          </form>

          <div className="space-y-2 pt-1">
            {loadingVideos ? (
              <p className="text-center text-xs text-slate-400">Loading...</p>
            ) : videos.length === 0 ? (
              <p className="text-center text-xs text-slate-400">No videos added yet.</p>
            ) : (
              videos.map((v) => (
                <div key={v.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2" data-testid={`presales-testimonial-row-${v.id}`}>
                  <span className="truncate text-xs font-medium text-slate-700">{v.title || v.video_id}</span>
                  <button type="button" onClick={() => handleDelete(v.id)} className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600" data-testid={`presales-testimonial-delete-${v.id}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
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

        {/* Pill tabs — Move to Stage lives behind "Additional Details" rather than as
            an always-visible footer: that footer had no height cap of its own, and on
            a small phone it could push the dialog past the viewport and get clipped by
            the outer overflow-hidden wrapper. */}
        <div className="flex flex-wrap gap-1.5 border-b border-slate-100 bg-slate-50/60 px-5 py-2.5">
          {[
            { key: "overview", label: "Overview", color: "bg-sky-500" },
            { key: "history", label: "History", color: "bg-violet-500" },
            { key: "follow-up", label: "Follow-up", color: "bg-emerald-500" },
            { key: "additional", label: "Additional Details", color: "bg-amber-500" },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-full px-3.5 py-1 text-xs font-semibold transition-all ${tab === t.key ? `${t.color} text-white shadow-sm` : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200"}`}
              data-testid={`presales-detail-tab-${t.key}`}
            >
              {t.label}
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

          {tab === "additional" && (
            <div className="space-y-3" data-testid="presales-detail-additional">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
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
                  setAppointmentDraft({ department: "physio", appointment_date: tmrw.toISOString().slice(0, 10), appointment_time: "10:00", remarks: "" });
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
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/40 px-5 py-3">
              <Button variant="outline" onClick={closeAll} data-testid="presales-appointment-cancel">Cancel</Button>
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
