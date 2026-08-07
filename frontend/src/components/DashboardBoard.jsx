import { useEffect, useState } from "react";
import { Users, CalendarCheck, Activity, IndianRupee, X, Building2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { DateFilterPopover } from "@/components/DateFilterPopover";
import { toast } from "@/components/ui/sonner";
import { getDashboardOverview, getDashboardBranchBreakdown, mkGetTeam } from "@/lib/api";
import { TeamCard } from "@/components/marketing/TeamCard";

// The four count tabs read the same branch/vertical payload; the two people tabs are a
// different shape entirely and come from their own endpoint. They sit between Leads and
// Appointments because that is the order the work happens in: a lead arrives, Pre-Sales
// qualifies it, the branch converts it, and only then is there an appointment to count.
//
// `panel` names which TeamCard tier to render, and is not the same as the API key the
// rows come back under — Branch reads the endpoint's `sales` list but presents it as
// branches, which is what those accounts actually are.
const DASH_TABS = [
  { key: "leads", label: "Leads", icon: Users },
  { key: "pre_sales_team", label: "Pre-Sales Team", icon: Users, team: "pre_sales", panel: "pre_sales" },
  { key: "branch", label: "Branch", icon: Building2, team: "sales", panel: "branch" },
  { key: "appointments", label: "Appointments", icon: CalendarCheck },
  { key: "treatments", label: "Treatments", icon: Activity },
  { key: "revenue", label: "Revenue", icon: IndianRupee },
];

const TEAM_PANELS = {
  pre_sales: { title: "Pre-Sales Team", subtitle: "Lead qualification and appointment booking" },
  branch: { title: "Branch", subtitle: "Consultations booked in, and how many reached a physio" },
};

const startOfDay = (d) => { const n = new Date(d); n.setHours(0, 0, 0, 0); return n; };
const endOfDay = (d) => { const n = new Date(d); n.setHours(23, 59, 59, 999); return n; };
const toIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// A real Monday→Sunday calendar week, not a rolling last-7-days window.
const mondayOf = (d) => {
  const n = startOfDay(d);
  const day = n.getDay(); // 0 = Sun .. 6 = Sat
  n.setDate(n.getDate() + (day === 0 ? -6 : 1 - day));
  return n;
};
const sundayOf = (d) => { const m = mondayOf(d); const n = new Date(m); n.setDate(n.getDate() + 6); return n; };
const daysBack = (d, n) => { const x = startOfDay(d); x.setDate(x.getDate() - n); return x; };

// One-tap ranges, widest first, then the day, the week, the month and the quarter.
// Anything else is a Custom Range away.
//
// All carries no dates at all — the overview endpoint treats a missing start and end as
// unfiltered rather than needing some sentinel "since the beginning" date, so All is the
// absence of a range rather than a very wide one.
//
// Last 90 Days counts today as one of the ninety, so it runs today-89 → today. The
// alternative — ninety whole days ending yesterday — makes the figure exclude the
// morning's takings, which is the one thing a Super Admin opening this board is
// most likely to be checking.
const DASH_PRESETS = [
  { key: "all", label: "All", range: () => ({ from: null, to: null }) },
  { key: "today", label: "Today", range: () => ({ from: startOfDay(new Date()), to: endOfDay(new Date()) }) },
  { key: "this_week", label: "This Week", range: () => ({ from: mondayOf(new Date()), to: endOfDay(sundayOf(new Date())) }) },
  { key: "this_month", label: "This Month", range: () => { const t = new Date(); return { from: startOfDay(new Date(t.getFullYear(), t.getMonth(), 1)), to: endOfDay(new Date(t.getFullYear(), t.getMonth() + 1, 0)) }; } },
  { key: "last_90", label: "Last 90 Days", range: () => ({ from: daysBack(new Date(), 89), to: endOfDay(new Date()) }) },
];

const presetFilter = (p) => ({ key: p.key, label: p.label, ...p.range() });

// What the board opens on, and where clearing the Custom filter lands: All. The shared
// filter's cleared state is null, which this board can't hold — every card reads from
// `dateFilter` — so it resolves to the preset that means the same thing.
const defaultFilter = () => presetFilter(DASH_PRESETS[0]);

const fmtValue = (tabKey, value) => (tabKey === "revenue" ? `₹${(value || 0).toLocaleString("en-IN")}` : value);

// Super Admin's default landing page — Leads / Appointments / Treatments / Revenue split
// per Physiotherapy branch, plus the two sales-team tabs, each scoped to a date range.
export const DashboardBoard = () => {
  const [dateFilter, setDateFilter] = useState(defaultFilter);
  const [activeTab, setActiveTab] = useState("leads");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [drillBranch, setDrillBranch] = useState(null); // the branch card being opened
  const [team, setTeam] = useState(null);
  const [teamLoading, setTeamLoading] = useState(false);

  const activeTabDef = DASH_TABS.find((t) => t.key === activeTab);
  const activeTeam = activeTabDef?.team || null;   // which list on the payload
  const activePanel = activeTabDef?.panel || null; // which tier to render it as

  useEffect(() => {
    setLoading(true);
    // No dates on All — the endpoint reads that as unfiltered.
    const params = dateFilter.from && dateFilter.to
      ? { start_date: toIso(dateFilter.from), end_date: toIso(dateFilter.to) }
      : {};
    getDashboardOverview(params)
      .then(setData)
      .catch(() => toast.error("Failed to load dashboard"))
      .finally(() => setLoading(false));
  }, [dateFilter]);

  // Fetched once, on the first visit to either team tab, and not refetched when the date
  // range changes — /marketing/team-members counts a person's whole book and takes no
  // dates. Refetching on every range change would burn a request to return the same
  // numbers, and would imply the figures answer to the filter when they don't.
  useEffect(() => {
    if (!activeTeam || team || teamLoading) return;
    setTeamLoading(true);
    mkGetTeam()
      .then(setTeam)
      .catch(() => { toast.error("Failed to load the team"); setTeam({ pre_sales: [], sales: [] }); })
      .finally(() => setTeamLoading(false));
  }, [activeTeam, team, teamLoading]);

  const activeData = data?.[activeTab];

  return (
    // No title block. The tab above already reads Dashboard, and the strapline named the
    // four tabs sitting right below it.
    <div className="space-y-4" data-testid="dashboard-board">
      {/* Five one-tap ranges, then Custom for everything else — the OS's shared date
          filter, which also carries Yesterday, Last Month and an exact day.

          Custom only shows a label when the range came from inside it. Picking Today or
          This Month in there sets the same key a button owns, so the button lights up
          and Custom goes back to reading "Custom" rather than the two of them naming the
          same range side by side. */}
      <div className="flex flex-wrap items-center gap-2" data-testid="dashboard-date-filter">
        {DASH_PRESETS.map((p) => {
          const active = dateFilter.key === p.key;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => setDateFilter(presetFilter(p))}
              className={`h-10 rounded-md px-3 text-sm font-medium transition ${active ? "bg-sky-600 text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
              data-testid={`dashboard-preset-${p.key}`}
            >
              {p.label}
            </button>
          );
        })}
        <DateFilterPopover
          value={DASH_PRESETS.some((p) => p.key === dateFilter.key) ? null : dateFilter}
          onChange={(next) => setDateFilter(next || defaultFilter())}
          testid="dashboard-date-filter-popover"
          placeholder="Custom"
          centered
        />
      </div>

      {/* Single row always — no min-width per tab (that's what forced a 2-row wrap on
          a phone), each tab just shrinks to share the row instead. */}
      <div className="flex gap-1 rounded-xl border border-slate-200 bg-white/95 p-1" data-testid="dashboard-tabs">
        {DASH_TABS.map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveTab(t.key)}
              className={`flex flex-1 min-w-0 items-center justify-center gap-1 rounded-lg px-1.5 py-2 text-[11px] font-semibold transition sm:gap-1.5 sm:px-3 sm:text-sm ${active ? "bg-sky-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`}
              data-testid={`dashboard-tab-${t.key}`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
              <span className="truncate">{t.label}</span>
            </button>
          );
        })}
      </div>

      {activeTeam ? (
        teamLoading || !team ? (
          <p className="py-16 text-center text-sm text-slate-400">{teamLoading ? "Loading..." : "No data."}</p>
        ) : (
          <TeamCard
            title={TEAM_PANELS[activePanel].title}
            subtitle={TEAM_PANELS[activePanel].subtitle}
            members={team[activeTeam] || []}
            kind={activePanel}
          />
        )
      ) : loading || !activeData ? (
        <p className="py-16 text-center text-sm text-slate-400">{loading ? "Loading..." : "No data."}</p>
      ) : (
        <div className="space-y-4">
          {/* The headline split, on the same Consultation / Session line Accountant
              Manage draws, so the two boards can't disagree about what a payment was
              for. Total stays alongside them — it is the pair added up, and dropping it
              would mean reading two figures to answer "how much came in".

              Spot Joining is a slice of Session, not money on top: a treatment fee
              collected on the same day as the consultation, i.e. the patient signed up
              on the spot. So the four don't sum — hence the note under it, which is
              there to stop someone adding all four and finding it over. */}
          {activeTab === "revenue" && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="dashboard-revenue-totals">
              <Card className="border-emerald-200 bg-emerald-50/60" data-testid="dashboard-total-revenue">
                <CardContent className="p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">Total Revenue</p>
                  <p className="mt-1 text-3xl font-bold text-emerald-700">{fmtValue("revenue", activeData.total)}</p>
                </CardContent>
              </Card>
              <Card data-testid="dashboard-consultation-revenue">
                <CardContent className="p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-sky-700">Total Consultation Revenue</p>
                  <p className="mt-1 text-3xl font-bold text-sky-700">{fmtValue("revenue", activeData.consultation)}</p>
                </CardContent>
              </Card>
              <Card data-testid="dashboard-session-revenue">
                <CardContent className="p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-violet-700">Total Session Revenue</p>
                  <p className="mt-1 text-3xl font-bold text-violet-700">{fmtValue("revenue", activeData.session)}</p>
                </CardContent>
              </Card>
              <Card data-testid="dashboard-spot-joining-revenue">
                <CardContent className="p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">Total Spot Joining Revenue</p>
                  <p className="mt-1 text-3xl font-bold text-amber-700">{fmtValue("revenue", activeData.spot_joining)}</p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* One row, always — branches read as a comparison, and 2x2 made the two on
              the bottom row look like a second, lesser group. Columns counted off the
              data rather than hardcoded, so opening a fifth branch re-divides the row
              instead of dropping one underneath. On a phone the row scrolls sideways
              rather than wrapping, which is the same thing by another name. */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Physiotherapy Branches</p>
            {activeData.physio_branches.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-200 py-6 text-center text-sm text-slate-400">
                No Physiotherapy branches yet.
              </p>
            ) : (
              <div
                className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1 sm:mx-0 sm:grid sm:overflow-visible sm:px-0 sm:pb-0"
                style={{ gridTemplateColumns: `repeat(${activeData.physio_branches.length}, minmax(0, 1fr))` }}
              >
                {activeData.physio_branches.map((b) => {
                  const open = drillBranch?.branch_id === b.branch_id;
                  return (
                    <Card
                      key={b.branch_id}
                      role="button"
                      aria-expanded={open}
                      tabIndex={0}
                      // Clicking the open branch closes it — the card is the toggle, so
                      // there's no separate control to hunt for.
                      onClick={() => setDrillBranch(open ? null : b)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDrillBranch(open ? null : b); } }}
                      className={`min-w-[9rem] shrink-0 cursor-pointer transition sm:min-w-0 ${
                        open ? "border-sky-500 bg-sky-50/60 shadow-sm" : "hover:border-sky-300 hover:shadow-md"
                      }`}
                      data-testid={`dashboard-physio-${b.branch_id}`}
                    >
                      <CardContent className="p-4">
                        <p className="truncate text-sm font-semibold text-slate-700">{b.branch_name}</p>
                        <p className="mt-1 truncate text-2xl font-bold text-sky-600">{fmtValue(activeTab, b.value)}</p>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}

            {/* Opens in place, under the row it belongs to, rather than over the board
                in a modal. A branch's breakdown is something to read against the other
                branches' numbers, and a dialog hides exactly what you'd compare it to. */}
            {drillBranch && (
              <BranchBreakdown
                branch={drillBranch}
                dateFilter={dateFilter}
                onClose={() => setDrillBranch(null)}
              />
            )}
          </div>
          {/* Other Verticals removed from the board. The endpoint still returns them —
              other callers read the same payload — they just aren't drawn here. */}
        </div>
      )}
    </div>
  );
};

/**
 * Who did the work behind one branch's number, over the range the board is showing.
 *
 * Counts only — no lead lists. Super Admin is reading performance here; the screens for
 * actually working a lead already exist under Pre-Sales CRM and Branch Wise, and putting
 * a second editing surface on a reporting board would mean Super Admin edits bypassing
 * the branch's own flow.
 *
 * Each column scrolls on its own past a dozen or so people. A branch with thirty physios
 * would otherwise push the rest of the page out of reach to show one list.
 */
const BranchBreakdown = ({ branch, dateFilter, onClose }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = { branch_id: branch.branch_id };
    if (dateFilter.from && dateFilter.to) {
      params.start_date = toIso(dateFilter.from);
      params.end_date = toIso(dateFilter.to);
    }
    getDashboardBranchBreakdown(params)
      .then(setData)
      .catch(() => { toast.error("Failed to load the branch breakdown"); setData(null); })
      .finally(() => setLoading(false));
  }, [branch.branch_id, dateFilter]);

  return (
    <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50/40 p-3" data-testid="dashboard-branch-breakdown">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-xs font-bold uppercase tracking-wider text-sky-700">
          {branch.branch_name}
          <span className="ml-2 font-medium normal-case tracking-normal text-slate-500">{dateFilter.label}</span>
        </p>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-full p-1.5 text-slate-400 hover:bg-white hover:text-slate-600"
          title="Close"
          aria-label="Close breakdown"
          data-testid="dashboard-branch-breakdown-close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {loading ? (
        <p className="py-10 text-center text-sm text-slate-400">Loading...</p>
      ) : !data ? (
        <p className="py-10 text-center text-sm text-slate-400">No breakdown available.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {data.groups.map((g) => (
            <div key={g.key} className="overflow-hidden rounded-xl border border-slate-200 bg-white" data-testid={`dashboard-breakdown-${g.key}`}>
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2.5">
                <p className="min-w-0 text-[11px] font-bold uppercase leading-tight tracking-wider text-slate-500">{g.label}</p>
                <p className="shrink-0 text-lg font-bold text-sky-600">{g.total}</p>
              </div>
              {g.members.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-slate-400">No one assigned yet.</p>
              ) : (
                <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
                  {g.members.map((m) => (
                    <li key={m.key} className="flex items-center justify-between gap-2 px-3 py-2">
                      <span className="min-w-0 truncate text-sm text-slate-700">{m.name}</span>
                      <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-bold ${m.count ? "bg-sky-50 text-sky-700" : "bg-slate-100 text-slate-400"}`}>
                        {m.count}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
