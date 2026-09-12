import { useCallback, useEffect, useRef, useState } from "react";
import {
  BarChart3,
  Building2,
  CalendarCheck,
  Clock,
  FileSpreadsheet,
  Globe,
  Headphones,
  IndianRupee,
  LayoutDashboard,
  Megaphone,
  Percent,
  Plus,
  RefreshCw,
  Settings,
  Sparkles,
  TrendingDown,
  TrendingUp,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import {
  createSheetConnection,
  getBdSummary,
  getBdSummaryRows,
  getBranches,
  getLeadSources,
  getSheetConnections,
  saveSheetMapping,
  syncSheetConnection,
} from "@/lib/api";
import { CreateLeadModal } from "@/components/CreateLeadModal";
// The Marketing and Sales master views and the Branch Control panel, mounted as three
// tabs below. Imported statically, the way OperationsBoard already mounts these same two
// boards: this file is itself behind a lazy() in CRMPage, so webpack lifts what the
// chunks share rather than copying either board into each.
import { PreSalesCRM } from "@/components/PreSalesCRM";
import { BranchManagementBoard } from "@/components/branch/BranchManagementBoard";

// Marketing View and Sales View are the same two boards Super Admin reaches as
// "Marketing Master View" and "Sales Master View" -- the same PreSalesCRM mount, under the
// shorter names, because here they are two tabs on a strip and not two entries on a
// top-level nav. They sit second and third, right after the figures: the desk reads the
// day on Dashboard, then reads what the other two desks did with it.
//
// Branch Control is BranchManagementBoard in full -- the same panel Operations opens as a
// "Branch Manager" dialog, mounted as a tab instead of a popup so it has the room its
// four sub-tabs need. It replaced a "Branches" tab that held a create form and a card
// list, both of which that panel does better.
//
// Lead Master is gone. It was a second leads table on a board whose Dashboard cards now
// open the same rows, and whose Sales View works them properly.
const TABS = [
  { key: "dashboard", label: "Dashboard", icon: BarChart3 },
  { key: "marketing_view", label: "Marketing View", icon: Megaphone },
  { key: "sales_view", label: "Sales View", icon: Headphones },
  { key: "branch_control", label: "Branch Control", icon: LayoutDashboard },
  { key: "settings", label: "Settings", icon: Settings },
];

// Settings is a second name for this pair of views rather than a view of its own -- the
// same shape CRMPage's own SETTINGS_SUB_VIEWS uses for Super Admin. `activeTab` holds one
// of these directly when Settings is open, so nothing has to track both a tab and a
// sub-tab and keep the two agreeing.
//
// Google Sheet Connection and Lead Source were two entries on the main strip. Neither is
// a place this desk works: one is a connection to configure, the other a read-only table
// of where leads came from. Behind Settings they stop competing with Dashboard and Sales
// View for the eye.
const SETTINGS_SUB_VIEWS = ["sheets", "lead_source"];
const SETTINGS_SUB_TABS = [
  { key: "sheets", label: "Google Sheet Connection", icon: FileSpreadsheet },
  { key: "lead_source", label: "Lead Source", icon: Globe },
];
const isTabActive = (view, key) => (key === "settings" ? SETTINGS_SUB_VIEWS.includes(view) : view === key);

const PIPELINE_STAGES = [
  "New Leads",
  "Follow Up",
  "Appointment",
];

const defaultSheetForm = {
  connection_name: "",
  spreadsheet_id: "",
  sync_interval_minutes: 30,
};

const defaultMapping = { name: "name", phone: "phone", email: "email", vertical: "vertical" };

const defaultSyncPayload = `{
  "tabs": [
    {
      "tab_name": "Instagram",
      "rows": [
        {
          "name": "Priya",
          "phone": "9000010001",
          "email": "priya@example.com",
          "vertical": "offline_physiotherapy",
          "campaign": "meta_1"
        }
      ]
    }
  ]
}`;

function formatMoney(v) {
  const n = Number(v || 0);
  return `Rs.${n.toLocaleString("en-IN")}`;
}

/**
 * @param currentUser  the signed-in Business Development Executive. Read by the three
 *                     tabs that mount another desk's board -- Marketing View, Sales View
 *                     and Branch Control. PreSalesCRM schedules and stamps activity
 *                     against whoever is looking, and BranchManagementBoard's Branch
 *                     Control sub-tab acts as them; without this those tabs would be
 *                     working on behalf of nobody.
 */
export const BusinessLeadsDashboard = ({ currentUser = null }) => {
  // Holds a main tab key, or -- while Settings is open -- one of SETTINGS_SUB_VIEWS.
  const [activeTab, setActiveTab] = useState("dashboard");
  const [loading, setLoading] = useState(false);

  const [summary, setSummary] = useState(null);
  const [branches, setBranches] = useState([]);
  const [sheetConnections, setSheetConnections] = useState([]);
  const [leadSources, setLeadSources] = useState([]);
  const [showCreateLead, setShowCreateLead] = useState(false);

  const [sheetForm, setSheetForm] = useState(defaultSheetForm);
  const [selectedConnectionId, setSelectedConnectionId] = useState("");
  const [mappingFields, setMappingFields] = useState(defaultMapping);
  const [syncPayload, setSyncPayload] = useState(defaultSyncPayload);

  // Which summary card is open, and the rows behind it. One card at a time: these lists
  // answer "which ones are they" about a figure just clicked, and two of them open at
  // once would be a report rather than an answer.
  const [openMetric, setOpenMetric] = useState(null);
  const [drill, setDrill] = useState(null);
  const [drillLoading, setDrillLoading] = useState(false);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getBdSummary();
      setSummary(data);
    } catch (e) { console.warn("[BD load failed]", e?.message || e); }
    setLoading(false);
  }, []);

  const loadBranches = useCallback(async () => {
    try {
      const data = await getBranches();
      setBranches(data);
    } catch (e) { console.warn("[BD load failed]", e?.message || e); }
  }, []);

  const loadSheets = useCallback(async () => {
    try {
      const data = await getSheetConnections();
      setSheetConnections(data);
    } catch (e) { console.warn("[BD load failed]", e?.message || e); }
  }, []);

  const loadSources = useCallback(async () => {
    try {
      const data = await getLeadSources();
      setLeadSources(data);
    } catch (e) { console.warn("[BD load failed]", e?.message || e); }
  }, []);

  // The rows behind a card. Asked for on the click rather than held for all nine: eight of
  // the nine are never opened in a given sitting, and Total Leads alone is thousands of
  // rows this board would otherwise fetch to show a number it already has.
  const openCard = useCallback(async (metricKey) => {
    if (openMetric === metricKey) { setOpenMetric(null); setDrill(null); return; }
    setOpenMetric(metricKey);
    setDrill(null);
    setDrillLoading(true);
    try {
      setDrill(await getBdSummaryRows(metricKey));
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not open that list");
      setOpenMetric(null);
    }
    setDrillLoading(false);
  }, [openMetric]);

  useEffect(() => {
    loadDashboard();
    loadBranches();
  }, [loadDashboard, loadBranches]);

  useEffect(() => {
    if (activeTab === "sheets") loadSheets();
    if (activeTab === "lead_source") loadSources();
  }, [activeTab, loadSheets, loadSources]);

  const refreshAll = async () => {
    await Promise.all([loadDashboard(), loadBranches(), loadSheets(), loadSources()]);
    // An open list is refreshed along with everything else, or Refresh would leave the
    // rows on screen older than the card above them.
    if (openMetric) {
      try { setDrill(await getBdSummaryRows(openMetric)); } catch { /* the toast on open already said so */ }
    }
    toast.success("Data refreshed");
  };

  const createConnectionNow = async (e) => {
    e.preventDefault();
    if (!sheetForm.connection_name.trim() || !sheetForm.spreadsheet_id.trim()) {
      toast.error("Connection name and spreadsheet ID required");
      return;
    }
    try {
      await createSheetConnection({ ...sheetForm, sync_interval_minutes: Number(sheetForm.sync_interval_minutes) || 30 });
      setSheetForm(defaultSheetForm);
      toast.success("Connection created");
      await loadSheets();
      await loadDashboard();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Connection failed");
    }
  };

  const saveMappingNow = async () => {
    if (!selectedConnectionId) {
      toast.error("Select a connection first");
      return;
    }
    try {
      await saveSheetMapping(selectedConnectionId, { field_map: mappingFields, create_new_fields: true });
      toast.success("Mapping saved");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Save mapping failed");
    }
  };

  const runSyncNow = async () => {
    if (!selectedConnectionId) {
      toast.error("Select a connection first");
      return;
    }
    try {
      const parsed = JSON.parse(syncPayload);
      const result = await syncSheetConnection(selectedConnectionId, parsed);
      toast.success(`Synced: ${result.imported} imported, ${result.skipped} skipped`);
      await loadDashboard();
      await loadSources();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Sync failed — verify JSON");
    }
  };

  return (
    <div className="space-y-5" data-testid="bd-dashboard-root">
      {/* Top navigation, in Branch Admin's shape: underlines on a rule rather than filled
          pills in a floating white card. The pills read as five buttons to press; a desk
          this size wants a nav that says where it is and otherwise gets out of the way.

          Always on screen, unlike Branch Admin's own copy (`hidden md:flex`) -- that board
          has a fixed bottom nav for phones to fall back on and this one has none, so
          hiding the strip would leave a phone with no way between tabs. */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-200" data-testid="bd-tab-bar">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = isTabActive(activeTab, tab.key);
          return (
            <button
              key={tab.key}
              type="button"
              // Settings has no view of its own -- it opens on the first of its two.
              onClick={() => setActiveTab(tab.key === "settings" ? SETTINGS_SUB_VIEWS[0] : tab.key)}
              className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 py-2.5 text-xs font-medium transition-colors sm:px-4 sm:text-sm ${
                isActive
                  ? "border-sky-500 text-sky-700"
                  : "border-transparent text-slate-400 hover:text-slate-600"
              }`}
              data-testid={`bd-tab-${tab.key}`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
        <div className="ml-auto flex flex-shrink-0 items-center gap-1.5 pb-1.5 pl-2">
          <Button size="sm" onClick={() => setShowCreateLead(true)} className="bg-sky-600 hover:bg-sky-700" data-testid="bd-quick-add-lead-btn">
            <UserPlus className="mr-1 h-4 w-4" /> Add Lead
          </Button>
          {/* The same Refresh as Branch Admin > Branch Leads: grey, icon-only, square,
              with the word on title/aria-label. */}
          <Button
            onClick={refreshAll}
            disabled={loading}
            title="Refresh"
            aria-label="Refresh"
            className="h-10 w-10 shrink-0 bg-slate-500 p-0 text-white hover:bg-slate-600"
            data-testid="bd-refresh-all-btn"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Dashboard Tab */}
      {activeTab === "dashboard" && (
        <DashboardTab
          summary={summary}
          loading={loading}
          branches={branches}
          openMetric={openMetric}
          onOpenCard={openCard}
          drill={drill}
          drillLoading={drillLoading}
        />
      )}

      {/* Marketing View / Sales View — the same two PreSalesCRM mounts Super Admin gets.
          The role is hardcoded on each, not read from the signed-in user: the prop picks
          which board PreSalesCRM draws, and a Business Development Executive passing
          their own role would land on a rep's own filtered book rather than either
          master view. What they may actually read is settled by the API off their token,
          the same as it is for Super Admin's copy of these tabs.

          `embedded` because this board is the host: PreSalesCRM's own phone padding is
          for a fixed bottom nav, and there is none under this strip. */}
      {activeTab === "marketing_view" && (
        <PreSalesCRM role="marketing_head" currentUser={currentUser} embedded />
      )}

      {activeTab === "sales_view" && (
        <PreSalesCRM role="sales_head" currentUser={currentUser} embedded />
      )}

      {/* Branch Control — the Branch Manager panel in full, as a tab rather than the
          dialog Operations opens it in. No `lockTab`, which is the whole point of it being
          here: that flag drops the sub-tab row, and Overview, Analytics and Branch Control
          are exactly what this desk did not have before.

          It opens on MANAGER, the tab that lists the branches and creates them -- the
          thing the old Branches tab did, so the board opens where it used to.

          `detailReadOnly` is the one thing held back. Drilling into a branch reaches HR's
          account actions (activate, deactivate, permanently delete a user) and the
          payment/UPI settings, and neither is branch control -- see the note on the
          widened guards in backend/routers/v3_branch_mgmt.py. */}
      {activeTab === "branch_control" && (
        <BranchManagementBoard actingUser={currentUser} initialTab="creation" detailReadOnly />
      )}

      {/* Settings — Google Sheet Connection and Lead Source, as a sub-tab pair. */}
      {SETTINGS_SUB_VIEWS.includes(activeTab) && (
        <div className="space-y-4" data-testid="bd-settings">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-1" data-testid="bd-settings-subtabs">
            {SETTINGS_SUB_TABS.map((t) => {
              const Icon = t.icon;
              const active = activeTab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setActiveTab(t.key)}
                  className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition ${active ? "bg-sky-50 text-sky-700" : "text-slate-600 hover:bg-slate-50"}`}
                  data-testid={`bd-settings-subtab-${t.key}`}
                >
                  <Icon className="h-4 w-4" />{t.label}
                </button>
              );
            })}
          </div>

          {activeTab === "sheets" && (
            <SheetsTab
              sheetConnections={sheetConnections}
              sheetForm={sheetForm}
              setSheetForm={setSheetForm}
              createConnectionNow={createConnectionNow}
              selectedConnectionId={selectedConnectionId}
              setSelectedConnectionId={setSelectedConnectionId}
              mappingFields={mappingFields}
              setMappingFields={setMappingFields}
              saveMappingNow={saveMappingNow}
              syncPayload={syncPayload}
              setSyncPayload={setSyncPayload}
              runSyncNow={runSyncNow}
            />
          )}

          {activeTab === "lead_source" && (
            <LeadSourceTab leadSources={leadSources} loading={loading} />
          )}
        </div>
      )}

      {showCreateLead && (
        <CreateLeadModal
          isSuperAdmin
          onClose={() => setShowCreateLead(false)}
          onSaved={() => {
            loadDashboard();
            loadSources();
          }}
        />
      )}

      {loading && (
        <div className="fixed bottom-4 right-4 rounded-full bg-slate-900 px-4 py-2 text-xs font-medium text-white shadow-lg" data-testid="bd-loading-indicator">
          Loading...
        </div>
      )}
    </div>
  );
};

/* ─── Sparkline ─── */
/**
 * A cubic through the points, as a path string.
 *
 * The same curve OverAll Growth draws (DashboardBoard.jsx's own `smoothPath`), carried
 * here as its own copy the way this codebase already carries `isOnlineVertical` in four
 * files. Keep the two in step: the tension is what makes the line read as the same mark
 * on both screens, and a different one here would be a second house style.
 */
const smoothPath = (pts) => {
  if (!pts.length) return "";
  if (pts.length < 3) return pts.map((p, i) => `${i ? "L" : "M"} ${p[0]},${p[1]}`).join(" ");
  const t = 0.2; // Low tension: enough to read as a curve, not enough to loop or overshoot far.
  let d = `M ${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    d += ` C ${p1[0] + (p2[0] - p0[0]) * t},${p1[1] + (p2[1] - p0[1]) * t}`
      + ` ${p2[0] - (p3[0] - p1[0]) * t},${p2[1] - (p3[1] - p1[1]) * t}`
      + ` ${p2[0]},${p2[1]}`;
  }
  return d;
};

// OverAll Growth's first ink and its baseline grey — BRANCH_INKS[0] and the hairline
// under the plot, both from DashboardBoard.jsx.
const TREND_INK = "#18181b";
const TREND_BASELINE = "#e4e4e7";

/**
 * The trend line inside a summary card, in OverAll Growth's style.
 *
 * It was a blue line over a blue filled area. That reads as a chart in its own right on a
 * card whose subject is one number, and it was the only blue-on-blue mark on a board
 * whose cards are otherwise white and slate. This is the treatment the OS's own growth
 * chart uses: a near-black cubic, a hairline baseline under it, a dot at every reading,
 * and no fill at all.
 *
 * The dots are the point of it, not decoration. The curve between two readings is
 * interpolation; the dots are the only places on the line where the ink is a measurement,
 * which is exactly how OverAll Growth puts it.
 */
function Sparkline({ data, color = TREND_INK }) {
  // Measured rather than drawn in a stretched viewBox. A viewBox with
  // preserveAspectRatio="none" is the cheap way to fill a card of unknown width, but it
  // scales x and y by different factors, and under that a round dot comes out an oval --
  // on a card this wide, two and a bit times wider than it is tall. Drawing in the box's
  // own pixels keeps the markers round, which is the half of this style that carries the
  // meaning.
  const ref = useRef(null);
  const [w, setW] = useState(160);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const apply = () => setW(Math.max(40, Math.round(el.clientWidth)));
    apply();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", apply);
      return () => window.removeEventListener("resize", apply);
    }
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const h = 26;
  const r = 2;
  // Inset by the marker's radius at all four edges, so a dot at the highest or lowest
  // reading sits inside the box instead of half outside it.
  const plotW = Math.max(1, w - r * 2);
  const plotH = h - r * 2;

  if (!data || data.length < 2) return <span ref={ref} className="block h-6" />;

  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = Math.max(max - min, 1);
  const step = plotW / (data.length - 1);
  const pts = data.map((v, i) => [r + i * step, r + plotH - ((v - min) / range) * plotH]);

  return (
    <span ref={ref} className="block">
      <svg width={w} height={h} className="block" aria-hidden="true">
        <line x1="0" x2={w} y1={h - r} y2={h - r} stroke={TREND_BASELINE} strokeWidth="1" />
        <path
          d={smoothPath(pts)}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* Every reading marked. The curve between them is interpolation; these are the
            only places on the line where the ink is a measurement. */}
        {pts.map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r={r} fill={color} />
        ))}
      </svg>
    </span>
  );
}

/* ─── KPI Card ─── */
/**
 * A figure on this board, in the shape Super Admin > HR Admin > Dashboard uses: white,
 * a two-pixel slate rule, the label small and capitalised above a large dark number.
 *
 * A card with an `onClick` renders as a button and opens the rows behind it; one without
 * renders as plain text, so a card that leads nowhere never invites a click that does
 * nothing. That is HR's rule for these tiles and it is the reason the blank card at the
 * end of the second group is inert rather than a dead button.
 *
 * `trend` and `sparkline` are what HR's tiles do not carry. The pill is tinted by
 * direction -- green for a rise, red for a fall -- because on a white card the direction
 * has to come from the pill's own colour rather than from an arrow on a translucent chip.
 */
function KpiCard({ label, value, icon: Icon, trend, sparkline, onClick, open, testid }) {
  const Tag = onClick ? "button" : "div";
  const trendTone = trend?.direction === "up"
    ? "bg-emerald-50 text-emerald-700"
    : trend?.direction === "down"
      ? "bg-rose-50 text-rose-700"
      : "bg-slate-100 text-slate-500";
  return (
    <Tag
      {...(onClick ? { type: "button", onClick } : {})}
      className={`w-full rounded-xl border-2 bg-white px-4 py-3.5 text-left transition ${
        open
          ? "border-sky-500 shadow-sm"
          : `border-slate-200 ${onClick ? "cursor-pointer hover:border-sky-300 hover:shadow-sm" : ""}`
      }`}
      {...(onClick ? { "aria-expanded": !!open } : {})}
      data-testid={testid}
    >
      <span className={`flex items-center gap-1.5 ${open ? "text-sky-700" : "text-slate-500"}`}>
        {Icon && <Icon className="h-4 w-4 shrink-0" />}
        <span className="truncate text-[11px] font-bold uppercase tracking-wider">{label}</span>
      </span>
      <span className="mt-1 block text-3xl font-extrabold text-slate-800">{value}</span>
      {trend && (
        <span className={`mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${trendTone}`}>
          {trend.direction === "up" && <TrendingUp className="h-3 w-3" />}
          {trend.direction === "down" && <TrendingDown className="h-3 w-3" />}
          {trend.text}
        </span>
      )}
      {sparkline && (
        <span className="mt-1.5 block">
          <Sparkline data={sparkline} />
        </span>
      )}
    </Tag>
  );
}

/* ─── Drill-down list ─── */

// What each kind of row is worth showing, in HR Admin's column order: an index, the thing
// itself with its secondary line under it, then the facts that name it, then when it
// arrived. One definition per kind drives both the table and the phone cards below, so
// the two can never list different facts about the same row.
const DRILL_COLUMNS = {
  lead: [
    { key: "name", label: "Lead", primary: true, value: (r) => r.name || "—", sub: (r) => r.phone || r.email || "" },
    { key: "source", label: "Source", value: (r) => r.source_tab || r.source_type || "—" },
    { key: "stage", label: "Stage", value: (r) => r.stage || "—" },
    { key: "branch", label: "Branch", value: (r, ctx) => ctx.branchName(r.branch_id) },
    { key: "created", label: "Created", value: (r) => (r.created_at || "").slice(0, 10) || "—" },
  ],
  appointment: [
    { key: "lead_name", label: "Patient", primary: true, value: (r) => r.lead_name || "—" },
    { key: "doctor_name", label: "Consultant", value: (r) => r.doctor_name || "—" },
    { key: "slot_time", label: "Slot", value: (r) => r.slot_time || "—" },
    { key: "status", label: "Status", value: (r) => r.status || "—" },
    { key: "branch", label: "Branch", value: (r, ctx) => ctx.branchName(r.branch_id) },
    { key: "created", label: "Booked", value: (r) => (r.created_at || "").slice(0, 10) || "—" },
  ],
  branch: [
    { key: "branch_name", label: "Branch", primary: true, value: (r) => r.branch_name || "—", sub: (r) => r.address || "" },
    { key: "vertical", label: "Service Type", value: (r) => r.vertical || "—" },
    { key: "admin_name", label: "Branch Admin", value: (r) => r.admin_name || "Not assigned yet" },
    { key: "admin_contact", label: "Contact", value: (r) => r.admin_email || r.admin_phone || "—" },
    { key: "created", label: "Opened", value: (r) => (r.created_at || "").slice(0, 10) || "—" },
  ],
  connection: [
    { key: "connection_name", label: "Connection", primary: true, value: (r) => r.connection_name || "—" },
    { key: "spreadsheet_id", label: "Spreadsheet ID", value: (r) => r.spreadsheet_id || "—" },
    { key: "sync_interval_minutes", label: "Every", value: (r) => (r.sync_interval_minutes ? `${r.sync_interval_minutes} min` : "—") },
    { key: "last_synced_at", label: "Last Synced", value: (r) => (r.last_synced_at || "").slice(0, 16).replace("T", " ") || "Never" },
    { key: "created", label: "Added", value: (r) => (r.created_at || "").slice(0, 10) || "—" },
  ],
};

/**
 * The rows behind a summary card: a table from tablet up, the same rows as cards on a
 * phone. The Human Resource Master View's list, which is the pattern the OS uses wherever
 * a list has more than two facts per row -- same slate header, same row rule, same
 * hover, same centred line where there is nothing to show.
 *
 * `total` is the count the server holds and `rows` is what it sent, which is capped. The
 * two differing is the one thing a list like this must admit rather than just stopping.
 */
function DrillList({ title, drill, loading, branches, onClose }) {
  const branchName = useCallback(
    (id) => (id ? (branches.find((b) => b.id === id)?.branch_name || "Unknown") : "Unassigned"),
    [branches],
  );
  const ctx = { branchName };
  const columns = drill ? (DRILL_COLUMNS[drill.kind] || []) : [];
  // No column set for the kind that came back means a metric was added to the endpoint
  // without one here. Showing nothing beats rendering rows with no headings, and beats
  // the crash the phone branch below would take reading a first column that isn't there.
  const rows = columns.length ? (drill?.rows || []) : [];
  const clipped = drill ? drill.total - rows.length : 0;

  return (
    <Card data-testid="bd-drill-card">
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <div className="min-w-0">
          <CardTitle className="truncate text-base" data-testid="bd-drill-title">{title}</CardTitle>
          {drill && (
            <p className="mt-0.5 text-xs text-slate-500" data-testid="bd-drill-count">
              {drill.total.toLocaleString("en-IN")} in total
              {clipped > 0 && ` · showing the ${rows.length.toLocaleString("en-IN")} most recent`}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Close list"
          aria-label="Close list"
          className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          data-testid="bd-drill-close"
        >
          <X className="h-4 w-4" />
        </button>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <p className="px-3 py-8 text-center text-sm text-slate-400" data-testid="bd-drill-loading">Loading...</p>
        ) : rows.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-slate-400" data-testid="bd-drill-empty">Nothing to show.</p>
        ) : (
          <>
            {/* Phone: the same facts stacked, the primary column as the heading. */}
            <div className="space-y-2 p-3 md:hidden" data-testid="bd-drill-list-mobile">
              {rows.map((r, i) => {
                const [head, ...rest] = columns;
                return (
                  <div key={r.id || i} className="rounded-xl border border-slate-200 bg-white p-3" data-testid={`bd-drill-card-${r.id || i}`}>
                    <p className="truncate text-sm font-bold text-slate-800">{head.value(r, ctx)}</p>
                    {head.sub?.(r) && <p className="truncate text-xs text-slate-500">{head.sub(r)}</p>}
                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                      {rest.map((c) => (
                        <div key={c.key} className="min-w-0">
                          <dt className="truncate text-[10px] font-bold uppercase tracking-wider text-slate-400">{c.label}</dt>
                          <dd className="truncate text-xs text-slate-600">{c.value(r, ctx)}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                );
              })}
            </div>

            <div className="hidden overflow-auto md:block">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">S.No</th>
                    {columns.map((c) => <th key={c.key} className="px-3 py-2">{c.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.id || i} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`bd-drill-row-${r.id || i}`}>
                      <td className="px-3 py-2 text-slate-500">{i + 1}</td>
                      {columns.map((c) => (
                        <td key={c.key} className="px-3 py-2 text-slate-600">
                          {c.primary ? (
                            <div className="min-w-0">
                              <p className="font-medium text-slate-800">{c.value(r, ctx)}</p>
                              {c.sub?.(r) && <p className="text-xs text-slate-400">{c.sub(r)}</p>}
                            </div>
                          ) : c.value(r, ctx)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ─── Dashboard Tab ─── */
function DashboardTab({ summary, loading, branches, openMetric, onOpenCard, drill, drillLoading }) {
  if (!summary && loading) {
    return <p className="py-8 text-center text-sm text-slate-400" data-testid="bd-dash-loading">Loading dashboard...</p>;
  }
  if (!summary) {
    return <p className="py-8 text-center text-sm text-slate-400" data-testid="bd-dash-empty">No data yet</p>;
  }

  const weekTrendCounts = (summary.week_trend || []).map((d) => d.count);
  const todayCount = summary.today_leads || 0;
  const yesterdayCount = weekTrendCounts.length >= 2 ? weekTrendCounts[weekTrendCounts.length - 2] : null;
  const todayTrend = yesterdayCount === null ? null : todayCount === yesterdayCount
    ? { direction: "flat", text: "Same as yesterday" }
    : todayCount > yesterdayCount
      ? { direction: "up", text: `+${todayCount - yesterdayCount} vs yesterday` }
      : { direction: "down", text: `-${yesterdayCount - todayCount} vs yesterday` };

  const weekChangePct = summary.leads_last_week
    ? Math.round(((summary.leads_this_week - summary.leads_last_week) / summary.leads_last_week) * 100)
    : null;
  const weekTrend = weekChangePct === null ? null : {
    direction: weekChangePct >= 0 ? "up" : "down",
    text: `${weekChangePct >= 0 ? "+" : ""}${weekChangePct}% vs last week`,
  };

  const followUp = summary.stage_counts?.["Follow Up"] || 0;

  // Two groups, because the nine cards answer two different questions. OnBoarding is the
  // pipeline as it stands today -- what came in and how far along it is, the figures a
  // desk acts on this morning. Systematic statistics is what the desk and the group have
  // built: money, rate, and the estate the leads arrive through. Read as one row of nine
  // they were a wall; split, each row has a subject.
  //
  // `metric` on each card is the key its rows are fetched by -- see BD_ROW_METRICS in
  // backend/routers/v3_dashboard.py. A card with no metric opens nothing.
  const groups = [
    {
      key: "onboarding",
      label: "OnBoarding",
      hint: "The pipeline as it stands today",
      cards: [
        { key: "total", metric: "total", label: "Total Leads", value: summary.total_leads, icon: Users, trend: weekTrend, sparkline: weekTrendCounts },
        { key: "today", metric: "today", label: "Today's Leads", value: todayCount, icon: Sparkles, trend: todayTrend, sparkline: weekTrendCounts },
        { key: "followup", metric: "followup", label: "Active Follow-ups", value: followUp, icon: Clock },
        { key: "appointments", metric: "appointments", label: "Appointments", value: summary.total_appointments, icon: CalendarCheck },
        { key: "converted", metric: "converted", label: "Converted", value: summary.completed_appointments, icon: TrendingUp },
      ],
    },
    {
      key: "statistics",
      label: "systematic statistics",
      hint: "What the desk and the estate have built",
      cards: [
        { key: "revenue", metric: "revenue", label: "Revenue Generated", value: formatMoney(summary.revenue_generated), icon: IndianRupee },
        { key: "conversion", metric: "conversion", label: "Conversion Rate", value: `${summary.conversion_rate}%`, icon: Percent },
        { key: "branches", metric: "branches", label: "Branches", value: summary.total_branches, icon: Building2 },
        { key: "sheets", metric: "sheets", label: "Connected Sheets", value: summary.total_connections, icon: FileSpreadsheet },
        // Held open on purpose. The row is five wide and this group has four figures, so
        // the alternative is a four-card row that does not line up with the five above it.
        { key: "blank", blank: true },
      ],
    },
  ];

  const openCardDef = groups.flatMap((g) => g.cards).find((c) => c.metric && c.metric === openMetric);

  return (
    <div className="space-y-5" data-testid="bd-dashboard-content">
      {groups.map((group) => (
        <div key={group.key} className="space-y-2" data-testid={`bd-group-${group.key}`}>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h2 className="text-sm font-bold text-slate-800" data-testid={`bd-group-title-${group.key}`}>{group.label}</h2>
            <p className="text-[11px] text-slate-400">{group.hint}</p>
          </div>
          {/* The same grid HR Admin's Dashboard lays its row out on -- two up on a phone,
              five across on a desk. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" data-testid={`bd-metrics-${group.key}`}>
            {group.cards.map((m) => (
              m.blank
                ? <div key={m.key} className="hidden rounded-xl border-2 border-dashed border-slate-100 lg:block" aria-hidden="true" data-testid="bd-metric-blank" />
                : (
                  <KpiCard
                    key={m.key}
                    label={m.label}
                    value={m.value}
                    icon={m.icon}
                    trend={m.trend}
                    sparkline={m.sparkline}
                    open={openMetric === m.metric}
                    onClick={m.metric ? () => onOpenCard(m.metric) : undefined}
                    testid={`bd-metric-${m.key}`}
                  />
                )
            ))}
          </div>
        </div>
      ))}

      {openMetric && (
        <DrillList
          title={openCardDef?.label || "Rows"}
          drill={drill}
          loading={drillLoading}
          branches={branches}
          onClose={() => onOpenCard(openMetric)}
        />
      )}
    </div>
  );
}

/* ─── Sheets Tab ─── */
function SheetsTab({
  sheetConnections,
  sheetForm,
  setSheetForm,
  createConnectionNow,
  selectedConnectionId,
  setSelectedConnectionId,
  mappingFields,
  setMappingFields,
  saveMappingNow,
  syncPayload,
  setSyncPayload,
  runSyncNow,
}) {
  return (
    <div className="space-y-4" data-testid="bd-sheets-content">
      <h2 className="text-lg font-semibold text-slate-800" data-testid="bd-sheets-title">Google Sheet Connections</h2>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Create Connection */}
        <Card className="rounded-2xl border-slate-200 shadow-sm" data-testid="bd-sheet-create-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Add Connection</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={createConnectionNow} className="space-y-3" data-testid="bd-sheet-create-form">
              <Input value={sheetForm.connection_name} onChange={(e) => setSheetForm((p) => ({ ...p, connection_name: e.target.value }))} placeholder="Connection Name" data-testid="bd-sheet-conn-name-input" />
              <Input value={sheetForm.spreadsheet_id} onChange={(e) => setSheetForm((p) => ({ ...p, spreadsheet_id: e.target.value }))} placeholder="Spreadsheet ID" data-testid="bd-sheet-spreadsheet-id-input" />
              <Input type="number" value={sheetForm.sync_interval_minutes} onChange={(e) => setSheetForm((p) => ({ ...p, sync_interval_minutes: Number(e.target.value) }))} placeholder="Sync interval (minutes)" data-testid="bd-sheet-interval-input" />
              <Button type="submit" className="bg-sky-600 hover:bg-sky-700" data-testid="bd-sheet-create-btn">
                <Plus className="mr-1 h-4 w-4" /> Add Connection
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Existing Connections */}
        <Card className="rounded-2xl border-slate-200 shadow-sm" data-testid="bd-sheet-list-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Existing Connections ({sheetConnections.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {sheetConnections.length === 0 ? (
              <p className="text-sm text-slate-400">No connections yet</p>
            ) : (
              sheetConnections.map((conn) => (
                <div
                  key={conn.id}
                  className={`cursor-pointer rounded-xl border p-3 transition-colors ${
                    selectedConnectionId === conn.id
                      ? "border-sky-300 bg-sky-50"
                      : "border-slate-200 bg-white hover:bg-slate-50"
                  }`}
                  onClick={() => setSelectedConnectionId(conn.id)}
                  data-testid={`bd-sheet-conn-${conn.id}`}
                >
                  <p className="text-sm font-medium text-slate-800">{conn.connection_name}</p>
                  <p className="text-xs text-slate-500">Sheet: {conn.spreadsheet_id}</p>
                  <p className="text-xs text-slate-400">Interval: {conn.sync_interval_minutes}min</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Mapping & Sync */}
      {selectedConnectionId && (
        <Card className="rounded-2xl border-slate-200 shadow-sm" data-testid="bd-sheet-mapping-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Field Mapping & Sync</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Input value={mappingFields.name} onChange={(e) => setMappingFields((p) => ({ ...p, name: e.target.value }))} placeholder="Name column" data-testid="bd-map-name-input" />
              <Input value={mappingFields.phone} onChange={(e) => setMappingFields((p) => ({ ...p, phone: e.target.value }))} placeholder="Phone column" data-testid="bd-map-phone-input" />
              <Input value={mappingFields.email} onChange={(e) => setMappingFields((p) => ({ ...p, email: e.target.value }))} placeholder="Email column" data-testid="bd-map-email-input" />
              <Input value={mappingFields.vertical} onChange={(e) => setMappingFields((p) => ({ ...p, vertical: e.target.value }))} placeholder="Vertical column" data-testid="bd-map-vertical-input" />
            </div>
            <Button variant="outline" onClick={saveMappingNow} data-testid="bd-map-save-btn">Save Mapping</Button>

            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-500">Sync Payload (JSON)</p>
              <textarea
                value={syncPayload}
                onChange={(e) => setSyncPayload(e.target.value)}
                className="min-h-[140px] w-full rounded-md border border-slate-200 bg-white p-3 font-mono text-xs"
                data-testid="bd-sync-payload-textarea"
              />
              <Button onClick={runSyncNow} className="bg-sky-600 hover:bg-sky-700" data-testid="bd-sync-run-btn">Run Sync</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ─── Lead Source Tab ─── */
function LeadSourceTab({ leadSources, loading }) {
  return (
    <div className="space-y-4" data-testid="bd-lead-source-content">
      <h2 className="text-lg font-semibold text-slate-800" data-testid="bd-lead-source-title">Lead Sources</h2>

      <div className="overflow-auto rounded-2xl border border-slate-200 shadow-sm" data-testid="bd-lead-source-table">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">Source</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Total Leads</th>
              {PIPELINE_STAGES.map((s) => (
                <th key={s} className="px-3 py-2 font-medium">{s}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {leadSources.length === 0 ? (
              <tr>
                <td colSpan={3 + PIPELINE_STAGES.length} className="px-3 py-6 text-center text-slate-400">
                  {loading ? "Loading..." : "No lead source data"}
                </td>
              </tr>
            ) : (
              leadSources.map((src) => (
                <tr key={`${src.source_tab}-${src.source_type}`} className="border-t border-slate-100" data-testid={`bd-source-row-${src.source_tab}`}>
                  <td className="px-3 py-2 font-medium text-slate-800">{src.source_tab}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${src.source_type === "google_sheet" ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-600"}`}>
                      {src.source_type}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-semibold text-sky-600">{src.total}</td>
                  {PIPELINE_STAGES.map((stage) => (
                    <td key={stage} className="px-3 py-2 text-slate-600">{src.stage_breakdown?.[stage] || 0}</td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
