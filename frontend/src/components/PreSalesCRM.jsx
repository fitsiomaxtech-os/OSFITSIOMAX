import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, Plus, RefreshCw, Search, Settings as Cog, Calendar as CalendarIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import {
  getLeads, createManualLead, stagesList, updateLead,
} from "@/lib/api";
import { LeadEditModal } from "@/components/LeadEditModal";
import { CreateLeadModal } from "@/components/CreateLeadModal";
import { SourcePill } from "@/components/marketing/SourcePill";
import { MaskedContact } from "@/components/MaskedContact";
import { AutoSyncPopover } from "@/components/AutoSyncPopover";

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

export const PreSalesCRM = ({ onManageStages }) => {
  const [stages, setStages] = useState([]);
  const [leads, setLeads] = useState([]);
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("All");
  const [sourceFilter, setSourceFilter] = useState("");
  const [sortNewest, setSortNewest] = useState(true);
  const [editing, setEditing] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [stgs, ldList] = await Promise.all([stagesList("pre_sales"), getLeads({})]);
      setStages(stgs);
      setLeads(ldList);
    } catch (e) { toast.error("Failed to load"); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const stageCounts = useMemo(() => {
    const map = { All: leads.length };
    stages.forEach((s) => { map[s.name] = 0; });
    leads.forEach((l) => { if (map[l.stage] != null) map[l.stage] += 1; });
    return map;
  }, [leads, stages]);

  const filtered = useMemo(() => {
    let rows = leads;
    if (stageFilter !== "All") rows = rows.filter((l) => l.stage === stageFilter);
    if (sourceFilter) rows = rows.filter((l) => (l.source_tab || l.source_type || "").toLowerCase().includes(sourceFilter.toLowerCase()));
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((l) => (l.name || "").toLowerCase().includes(q) || (l.phone || "").includes(q) || (l.email || "").toLowerCase().includes(q));
    }
    return rows.slice().sort((a, b) => {
      const da = a.created_at || ""; const db = b.created_at || "";
      return sortNewest ? db.localeCompare(da) : da.localeCompare(db);
    });
  }, [leads, stageFilter, sourceFilter, search, sortNewest]);

  const moveToStage = async (leadId, stageName) => {
    try { await updateLead(leadId, { stage: stageName }); toast.success(`Moved to ${stageName}`); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Move failed"); }
  };

  // Pick KPI cards: total + up to 8 stage cards
  const kpiStages = stages.slice(0, 8);

  return (
    <div className="space-y-5" data-testid="presales-crm-page">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Pre-Sales CRM</h2>
          <p className="text-sm text-slate-500">Manage incoming leads, follow-ups, and stage transitions.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} data-testid="presales-refresh-btn"><RefreshCw className="h-4 w-4" /></Button>
          <Button variant="outline" onClick={onManageStages} data-testid="presales-manage-stages-btn"><Cog className="h-4 w-4 mr-1" />Manage Stages</Button>
          <Button onClick={() => setShowCreate(true)} className="bg-indigo-600 hover:bg-indigo-700" data-testid="presales-create-lead-btn"><Plus className="h-4 w-4 mr-1" />Create Lead</Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5" data-testid="presales-kpi-row">
        <KpiCard label="Total Leads" value={stageCounts.All} active={stageFilter === "All"} color="#22c55e" onClick={() => setStageFilter("All")} testid="presales-kpi-all" />
        {kpiStages.map((s) => (
          <KpiCard key={s.id} label={s.name} value={stageCounts[s.name] || 0} active={stageFilter === s.name} color={s.color} onClick={() => setStageFilter(s.name)} testid={`presales-kpi-${s.name}`} />
        ))}
      </div>

      {/* Toolbar */}
      <div className="grid gap-2 md:grid-cols-7">
        <div className="md:col-span-2 relative">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search leads by name, email, phone..." className="pl-8" data-testid="presales-search" />
        </div>
        <Button variant="outline" onClick={() => setSortNewest((s) => !s)} data-testid="presales-sort"><CalendarIcon className="mr-1 h-4 w-4" />{sortNewest ? "Newest first" : "Oldest first"}</Button>
        <div className="flex justify-start md:justify-center"><AutoSyncPopover /></div>
        <Input className="md:col-span-2" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} placeholder="Source filter" data-testid="presales-source-filter" />
      </div>

      {/* Stage Tabs — segmented bar, equal-width, larger hit-target */}
      <div className="rounded-xl border border-slate-200 bg-white p-1 shadow-sm" data-testid="presales-stage-tabs">
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-5">
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
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr><th className="px-4 py-2 w-12"></th><th className="px-3 py-2">LEAD</th><th className="px-3 py-2">CONTACT</th><th className="px-3 py-2">SOURCE</th><th className="px-3 py-2">STAGE</th><th className="px-3 py-2">DEPARTMENT</th><th className="px-3 py-2">CREATED</th><th className="px-3 py-2">ACTIONS</th></tr>
              </thead>
              <tbody>
                {filtered.map((l) => {
                  const stg = stages.find((s) => s.name === l.stage);
                  const ac = avatarColor(l.name);
                  return (
                    <tr key={l.id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`presales-lead-row-${l.id}`}>
                      <td className="px-4 py-3"><span className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${ac.bg} ${ac.fg}`}>{initials(l.name)}</span></td>
                      <td className="px-3 py-3 font-medium text-slate-800">{l.name}</td>
                      <td className="px-3 py-3"><MaskedContact phone={l.phone} email={l.email} /></td>
                      <td className="px-3 py-3"><SourcePill source={l.source_tab || l.source_type} /></td>
                      <td className="px-3 py-3">
                        <span className="inline-flex h-6 items-center rounded border px-2 text-[10px] font-semibold" style={{ borderColor: stg?.color || "#cbd5e1", color: stg?.color || "#64748b" }}>{l.stage}</span>
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-600">{l.department || "—"}</td>
                      <td className="px-3 py-3 text-xs text-slate-400">{(l.created_at || "").slice(0, 10)}</td>
                      <td className="px-3 py-3"><button onClick={() => setEditing(l)} className="text-slate-500 hover:text-sky-600" data-testid={`presales-lead-view-${l.id}`}><Eye className="h-4 w-4" /></button></td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && <tr><td colSpan="8" className="px-3 py-8 text-center text-slate-400">{loading ? "Loading..." : "No leads match."}</td></tr>}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {editing && (
        <LeadDetailDialog lead={editing} stages={stages} onClose={() => setEditing(null)} onSaved={load} onMoveStage={moveToStage} />
      )}

      {showCreate && (
        <CreateLeadModal onClose={() => setShowCreate(false)} onSaved={load} />
      )}
    </div>
  );
};

const KpiCard = ({ label, value, color, active, onClick, testid }) => (
  <button onClick={onClick} data-testid={testid} className={`rounded-2xl p-4 text-left transition ${active ? "ring-2 ring-offset-2" : ""}`} style={{ background: `${color}14`, border: `1px solid ${color}33` }}>
    <p className="text-xs font-medium" style={{ color }}>{label}</p>
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
      className="relative flex items-center justify-center rounded-lg px-4 py-3 text-center transition-all hover:shadow-sm"
      style={
        active
          ? { background: tint, color: "#ffffff", boxShadow: `0 2px 8px ${tint}40` }
          : { background: `${tint}14`, color: tint, border: `1px solid ${tint}33` }
      }
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

const LeadDetailDialog = ({ lead, stages, onClose, onSaved, onMoveStage }) => {
  const [tab, setTab] = useState("overview");
  const [showEdit, setShowEdit] = useState(false);
  const [currentLead, setCurrentLead] = useState(lead);

  useEffect(() => { setCurrentLead(lead); }, [lead]);

  const refreshAndKeep = () => { onSaved && onSaved(); };

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" data-testid="presales-detail-dialog">
      <div className="w-full max-w-3xl rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700">{initials(currentLead.name)}</span>
            <div>
              <p className="text-base font-semibold text-slate-900">{currentLead.name}</p>
              <div className="mt-0.5 flex items-center gap-2">
                <SourcePill source={currentLead.source_tab || currentLead.source_type} />
                <span className="text-xs text-slate-500">{currentLead.stage}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowEdit(true)} data-testid="presales-detail-edit-btn">✏ Edit</Button>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600" data-testid="presales-detail-close">✕</button>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 border-b border-slate-200 px-5 py-2 text-xs">
          {["overview", "history", "remarks", "follow-up", "activity"].map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`rounded px-2 py-1 ${tab === t ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`} data-testid={`presales-detail-tab-${t}`}>{t}</button>
          ))}
        </div>

        <div className="max-h-[55vh] overflow-y-auto p-5">
          {tab === "overview" && (
            <div className="space-y-4">
              <Section title="Contact Information">
                <Row k="Phone" v={currentLead.phone} />
                <Row k="Email" v={currentLead.email || "—"} />
                <Row k="Location" v={currentLead.location || "—"} />
              </Section>
              <Section title="Additional Details">
                <Row k="Expected Consultation" v={currentLead.expected_consultation_date || "—"} />
                <Row k="Months of Pain" v={currentLead.months_of_pain ?? "—"} />
                <Row k="Age" v={currentLead.age ?? "—"} />
                <Row k="Gender" v={currentLead.gender || "—"} />
                <Row k="Occupation" v={currentLead.occupation || "—"} />
                <Row k="Department" v={currentLead.department || "—"} />
                <Row k="Vertical" v={currentLead.vertical} />
              </Section>
              {currentLead.notes && <Section title="Notes"><p className="text-sm text-slate-600">{currentLead.notes}</p></Section>}
            </div>
          )}
          {tab !== "overview" && <p className="text-sm text-slate-400">(Coming in next iteration — current view focused on overview + stage moves.)</p>}
        </div>

        <div className="border-t border-slate-200 px-5 py-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Move to Stage:</p>
          <div className="flex flex-wrap gap-2" data-testid="presales-detail-move-stages">
            {stages.map((s) => (
              <button key={s.id} onClick={async () => { await onMoveStage(currentLead.id, s.name); setCurrentLead({ ...currentLead, stage: s.name }); }} disabled={currentLead.stage === s.name} className="rounded-md border px-3 py-1 text-xs font-medium transition disabled:opacity-50" style={{ borderColor: s.color, color: s.color, background: currentLead.stage === s.name ? `${s.color}22` : "white" }} data-testid={`presales-detail-move-${s.name}`}>
                {s.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {showEdit && (
        <LeadEditModal lead={currentLead} onClose={() => setShowEdit(false)} onSaved={() => { refreshAndKeep(); setShowEdit(false); }} />
      )}
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

export default PreSalesCRM;
