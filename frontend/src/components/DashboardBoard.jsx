import { useEffect, useState } from "react";
import { Users, CalendarCheck, Activity, IndianRupee, X, Building2, LayoutDashboard, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { DateFilterPopover } from "@/components/DateFilterPopover";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
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
  // Overview first, and the landing tab: it answers "how are we doing" in one screen,
  // which is the question a Super Admin opens this board with. The four tabs after it
  // answer "how are we doing at X", which is the follow-up.
  { key: "overview", label: "Executive Overview", icon: LayoutDashboard },
  { key: "leads", label: "Leads", icon: Users },
  // BRANCHS carries both halves of the sales chain: the branches, and the Pre-Sales
  // agents who fed them. Pre-Sales had its own tab and it didn't earn one — the two
  // are read against each other, and a tab apiece meant switching back and forth to
  // compare what was handed over with what was closed.
  { key: "branch", label: "BRANCHS", icon: Building2, team: "sales", panel: "branch" },
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
// `short` is the phone label. Six full labels cannot share a phone's width, and the
// alternatives are worse: truncating gives "Last 9…", wrapping costs a row, scrolling
// hides the last two off the edge. Shortening is the only one that keeps all six on
// screen and readable. `label` is still what the chip and the filter state carry, so
// nothing downstream sees the abbreviation.
const DASH_PRESETS = [
  { key: "all", label: "All", short: "All", range: () => ({ from: null, to: null }) },
  { key: "today", label: "Today", short: "Today", range: () => ({ from: startOfDay(new Date()), to: endOfDay(new Date()) }) },
  { key: "this_week", label: "This Week", short: "Week", range: () => ({ from: mondayOf(new Date()), to: endOfDay(sundayOf(new Date())) }) },
  { key: "this_month", label: "This Month", short: "Month", range: () => { const t = new Date(); return { from: startOfDay(new Date(t.getFullYear(), t.getMonth(), 1)), to: endOfDay(new Date(t.getFullYear(), t.getMonth() + 1, 0)) }; } },
  { key: "last_90", label: "Last 90 Days", short: "90d", range: () => ({ from: daysBack(new Date(), 89), to: endOfDay(new Date()) }) },
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
  const [activeTab, setActiveTab] = useState("overview");
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
      {/* One row on a phone, six equal columns, nothing off screen. An earlier pass used
          overflow-x-auto here, which is what put Last 90 Days half past the edge — that
          row was built to extend beyond the viewport and scroll. A six-column grid can't:
          every cell is a sixth of the width the container already has.
          Short labels on a phone, full ones from sm up, and the Custom trigger drops its
          calendar icon on a phone to spend that width on its label instead.

          On a phone the six share the row edge to edge (flex-1) rather than sitting at
          their natural widths — six controls bunched to the left with dead space beside
          them reads like something failed to load. The labels are short enough that an
          even sixth still fits the longest of them on a 320px screen; min-w-0 + truncate
          is the fallback if it ever isn't. Desktop keeps natural widths, since stretching
          six buttons across a 1400px board would be absurd. */}
      <div className="flex items-center gap-1 sm:flex-wrap sm:gap-2" data-testid="dashboard-date-filter">
        {DASH_PRESETS.map((p) => {
          const active = dateFilter.key === p.key;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => setDateFilter(presetFilter(p))}
              className={`h-10 min-w-0 flex-1 truncate rounded-md px-1 text-[11px] font-medium transition sm:flex-none sm:px-3 sm:text-sm ${active ? "bg-sky-600 text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
              data-testid={`dashboard-preset-${p.key}`}
            >
              <span className="sm:hidden">{p.short}</span>
              <span className="hidden sm:inline">{p.label}</span>
            </button>
          );
        })}
        {/* The trigger is a Button this component doesn't own, so its width, padding, text
            size and icon are pinned from out here rather than by adding breakpoint props
            to a control five other boards share. */}
        <span className="min-w-0 flex-1 sm:flex-none [&_button]:h-10 [&_button]:w-full [&_button]:justify-center [&_button]:px-1 [&_button]:text-[11px] [&_svg]:hidden sm:[&_button]:w-auto sm:[&_button]:px-4 sm:[&_button]:text-sm sm:[&_svg]:inline-block">
          <DateFilterPopover
            value={DASH_PRESETS.some((p) => p.key === dateFilter.key) ? null : dateFilter}
            onChange={(next) => setDateFilter(next || defaultFilter())}
            testid="dashboard-date-filter-popover"
            placeholder="Custom"
            centered
          />
        </span>
      </div>

      <SegmentedTabs tabs={DASH_TABS} value={activeTab} onChange={setActiveTab} testid="dashboard-tab" />

      {activeTab === "overview" ? (
        <ExecutiveOverview data={data} loading={loading} dateFilter={dateFilter} />
      ) : activeTeam ? (
        teamLoading || !team ? (
          <p className="py-16 text-center text-sm text-slate-400">{teamLoading ? "Loading..." : "No data."}</p>
        ) : (
          // Branches first, then the Pre-Sales agents who fed them — the order the work
          // happens in reversed, because the branch figures are what this tab is named
          // for and Pre-Sales is the context behind them. Both come out of the one
          // /marketing/team-members response already fetched, so showing them together
          // costs no extra request.
          <div className="space-y-4">
            <TeamCard
              title={TEAM_PANELS[activePanel].title}
              subtitle={TEAM_PANELS[activePanel].subtitle}
              members={team[activeTeam] || []}
              kind={activePanel}
            />
            <TeamCard
              title={TEAM_PANELS.pre_sales.title}
              subtitle={TEAM_PANELS.pre_sales.subtitle}
              members={team.pre_sales || []}
              kind="pre_sales"
            />
          </div>
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
              instead of dropping one underneath.

              A phone gets one dropdown instead of a card each. Five branches stacked ate
              the whole screen before the breakdown they open had anywhere to appear, so
              picking a branch meant scrolling past every other branch to see it. Each
              option carries its own figure, so the numbers are still all readable in one
              gesture — they just don't hold the screen open. */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Physiotherapy Branches</p>
            {activeData.physio_branches.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-200 py-6 text-center text-sm text-slate-400">
                No Physiotherapy branches yet.
              </p>
            ) : (
              <>
              <select
                className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 sm:hidden"
                value={drillBranch?.branch_id || ""}
                onChange={(e) => {
                  const next = activeData.physio_branches.find((b) => b.branch_id === e.target.value);
                  setDrillBranch(next || null);
                }}
                data-testid="dashboard-physio-select"
              >
                <option value="">Pick a branch…</option>
                {activeData.physio_branches.map((b) => (
                  <option key={b.branch_id} value={b.branch_id}>
                    {b.branch_name} · {fmtValue(activeTab, b.value)}
                  </option>
                ))}
              </select>

              <div
                className="hidden sm:grid sm:gap-3"
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
                      // min-w-0 because a grid item defaults to min-width:auto, which lets
                      // a long branch name push its own column wider than its 1fr track.
                      className={`min-w-0 cursor-pointer transition ${
                        open ? "border-sky-500 bg-sky-50/60 shadow-sm" : "hover:border-sky-300 hover:shadow-md"
                      }`}
                      data-testid={`dashboard-physio-${b.branch_id}`}
                    >
                      <CardContent className="p-4">
                        <p className="min-w-0 truncate text-sm font-semibold text-slate-700">{b.branch_name}</p>
                        <p className="mt-1 truncate text-2xl font-bold text-sky-600">{fmtValue(activeTab, b.value)}</p>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
              </>
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

          {activeTab === "leads" && <BranchShareDonut branches={activeData.physio_branches} />}
        </div>
      )}
    </div>
  );
};

/**
 * Executive Overview — the whole business on one screen, before any of the per-metric
 * tabs narrow it down.
 *
 * The four headline figures come from the same payload every other tab reads, so this
 * can't disagree with them. Each carries a change against the immediately preceding
 * window of the same length — last 30 days against the 30 before it — fetched separately
 * because the endpoint answers for one range at a time.
 *
 * `All` has no preceding window, so it shows no deltas rather than inventing a baseline.
 */
const ExecutiveOverview = ({ data, loading, dateFilter }) => {
  const [prev, setPrev] = useState(null);
  const [prevLoading, setPrevLoading] = useState(false);

  const from = dateFilter?.from;
  const to = dateFilter?.to;

  useEffect(() => {
    if (!from || !to) { setPrev(null); return undefined; }
    // The window immediately before this one, the same number of days long, ending the
    // day before it starts. Anything else ("last month" for a 7-day range) would compare
    // spans of different lengths and call the difference performance.
    const days = Math.max(1, Math.round((startOfDay(to) - startOfDay(from)) / 86400000) + 1);
    const prevTo = new Date(startOfDay(from).getTime() - 86400000);
    const prevFrom = new Date(prevTo.getTime() - (days - 1) * 86400000);
    let cancelled = false;
    setPrevLoading(true);
    getDashboardOverview({ start_date: toIso(prevFrom), end_date: toIso(prevTo) })
      .then((r) => { if (!cancelled) setPrev(r); })
      .catch(() => { if (!cancelled) setPrev(null); })
      .finally(() => { if (!cancelled) setPrevLoading(false); });
    return () => { cancelled = true; };
  }, [from, to]);

  if (loading || !data) {
    return <p className="py-16 text-center text-sm text-slate-400">{loading ? "Loading..." : "No data."}</p>;
  }

  const metrics = [
    { key: "leads", label: "Total Leads", icon: Users, value: data.leads?.total ?? 0 },
    { key: "appointments", label: "Appointments", icon: CalendarCheck, value: data.appointments?.total ?? 0 },
    { key: "treatments", label: "Treatments", icon: Activity, value: data.treatments?.total ?? 0 },
    { key: "revenue", label: "Revenue", icon: IndianRupee, value: data.revenue?.total ?? 0, currency: true },
  ];

  const branches = data.leads?.physio_branches || [];
  const apptByBranch = Object.fromEntries((data.appointments?.physio_branches || []).map((b) => [b.branch_id, b.value]));
  const revByBranch = Object.fromEntries((data.revenue?.physio_branches || []).map((b) => [b.branch_id, b.value]));
  const rows = [...branches].sort((a, b) => b.value - a.value);

  return (
    <div className="space-y-4" data-testid="dashboard-overview">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map((m) => {
          const before = prev?.[m.key]?.total;
          return (
            <Card key={m.key} data-testid={`dashboard-overview-${m.key}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{m.label}</p>
                  <m.icon className="h-4 w-4 shrink-0 text-slate-300" />
                </div>
                <p className="mt-1 truncate text-3xl font-extrabold text-slate-800">
                  {m.currency ? fmtValue("revenue", m.value) : (m.value || 0).toLocaleString("en-IN")}
                </p>
                <Delta now={m.value} before={before} loading={prevLoading} available={!!from && !!to} />
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card data-testid="dashboard-overview-branches">
        <CardContent className="p-4 sm:p-5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Leads by Branch</p>
          {rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">No Physiotherapy branches yet.</p>
          ) : (
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              {/* Scrolls inside its own container rather than widening the card — four
                  numeric columns don't fit a phone, and the alternative is the page
                  scrolling sideways. */}
              <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wider text-slate-400">
                      <th className="py-2 pr-3 font-semibold">Branch</th>
                      <th className="py-2 px-3 text-right font-semibold">Leads</th>
                      {/* Of the leads this branch took, how many reached a booked
                          appointment. Both sides come from the same date range, so a
                          branch can't look better by having old leads. */}
                      <th className="py-2 px-3 text-right font-semibold">Conversion</th>
                      <th className="py-2 pl-3 text-right font-semibold">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((b, i) => {
                      const appts = apptByBranch[b.branch_id] || 0;
                      const conv = b.value ? (appts / b.value) * 100 : 0;
                      return (
                        <tr key={b.branch_id} className="border-b border-slate-100 last:border-0" data-testid={`dashboard-overview-row-${b.branch_id}`}>
                          <td className="py-2.5 pr-3">
                            <span className="flex items-center gap-2">
                              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: i < SERIES.length ? SERIES[i] : OTHER_HUE }} />
                              <span className="truncate font-medium text-slate-700">{b.branch_name}</span>
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right font-bold tabular-nums text-slate-800">{(b.value || 0).toLocaleString("en-IN")}</td>
                          <td className="py-2.5 px-3 text-right tabular-nums text-slate-600">{b.value ? `${conv.toFixed(1)}%` : "—"}</td>
                          <td className="py-2.5 pl-3 text-right tabular-nums text-slate-600">{fmtValue("revenue", revByBranch[b.branch_id] || 0)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <BranchShareDonut branches={branches} bare />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

/** Change against the preceding window. Silent rather than "0%" when there is nothing to
 *  compare against — an unknown and a flat period are different things, and printing 0%
 *  for the first is the kind of number people act on. */
const Delta = ({ now, before, loading, available }) => {
  if (!available) return <p className="mt-1 text-[11px] text-slate-400">All time · no prior period</p>;
  if (loading) return <p className="mt-1 text-[11px] text-slate-300">Comparing…</p>;
  if (before == null) return <p className="mt-1 text-[11px] text-slate-400">No prior period</p>;
  if (!before) {
    // Growth from zero has no percentage — any increase is infinite. Say what happened.
    return <p className="mt-1 text-[11px] text-slate-400">{now ? "New this period" : "None either period"}</p>;
  }
  const pct = ((now - before) / before) * 100;
  const flat = Math.abs(pct) < 0.05;
  const Icon = flat ? Minus : pct > 0 ? TrendingUp : TrendingDown;
  const tone = flat ? "text-slate-400" : pct > 0 ? "text-emerald-600" : "text-rose-600";
  return (
    <p className={`mt-1 flex items-center gap-1 text-[11px] font-semibold ${tone}`}>
      <Icon className="h-3 w-3 shrink-0" />
      {flat ? "0%" : `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`}
      <span className="font-normal text-slate-400">vs prior period</span>
    </p>
  );
};

// Categorical slots 1-4, in the fixed validated order. Assigned by the branch's position
// in the payload — which is stable across requests — and never by rank, so filtering or
// re-sorting can't repaint a branch someone has already learned the colour of.
//
// Validated against the white card surface: lightness band, chroma floor, CVD separation
// (worst adjacent pair ΔE 9.1 protan) and normal-vision separation (22.9) all pass. Two
// of the four sit under 3:1 contrast, which obliges visible labels rather than
// colour-only identity — hence every value printed in the legend beside its swatch.
const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const OTHER_HUE = "#898781";

/**
 * Share of leads across the Physiotherapy branches.
 *
 * The centre total is the sum of the segments, NOT the Dashboard's grand total — that
 * one also counts the other verticals and anything sitting outside a branch, so printing
 * it here would put a whole in the middle that its own parts don't add up to.
 *
 * Part-to-whole at a glance is the one job a donut is right for, and it holds here
 * because the shares are far apart. If branch volumes ever converge this should become a
 * bar chart: a ring can't be read for close values.
 */
const BranchShareDonut = ({ branches, bare = false }) => {
  const [hover, setHover] = useState(null);

  const rows = (branches || []).map((b, i) => ({
    ...b,
    // Past eight the tail folds into one grey "Other" rather than inventing a ninth hue
    // that nothing could tell from an existing one.
    color: i < SERIES.length ? SERIES[i] : OTHER_HUE,
  }));
  const total = rows.reduce((n, b) => n + (Number(b.value) || 0), 0);

  if (rows.length === 0) return null;

  const R = 70;
  const C = 2 * Math.PI * R;
  const GAP = 2; // surface gap, in path units — white doing the separating, not a stroke
  let offset = 0;
  const arcs = rows.map((b) => {
    const len = total ? ((Number(b.value) || 0) / total) * C : 0;
    const arc = { ...b, len, drawLen: Math.max(len - GAP, 0), offset };
    offset += len;
    return arc;
  });

  const focus = hover !== null ? arcs[hover] : null;
  const pct = (v) => (total ? Math.round((v / total) * 1000) / 10 : 0);

  const ring = (
    <div className="relative shrink-0">
      <svg width="180" height="180" viewBox="0 0 180 180" role="img" aria-label="Leads by branch">
        <g transform="rotate(-90 90 90)">
          {total === 0 ? (
            <circle cx="90" cy="90" r={R} fill="none" stroke="#e1e0d9" strokeWidth="22" />
          ) : arcs.map((b, i) => b.drawLen > 0 && (
            <circle
              key={b.branch_id}
              cx="90" cy="90" r={R}
              fill="none"
              stroke={b.color}
              strokeWidth={hover === i ? 26 : 22}
              strokeDasharray={`${b.drawLen} ${C - b.drawLen}`}
              strokeDashoffset={-b.offset}
              className="cursor-pointer transition-[stroke-width]"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              data-testid={`dashboard-branch-share-arc-${b.branch_id}`}
            >
              <title>{`${b.branch_name}: ${(Number(b.value) || 0).toLocaleString("en-IN")} (${pct(Number(b.value) || 0)}%)`}</title>
            </circle>
          ))}
        </g>
      </svg>
      {/* Hovering swaps the centre to that branch. Every value is already in text beside
          the ring — the legend here, the table in Executive Overview — so this enhances
          rather than gates anything. */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
        <p className="max-w-full truncate text-[11px] text-slate-500">{focus ? focus.branch_name : "Branch Leads"}</p>
        <p className="text-2xl font-bold text-slate-900">
          {(focus ? Number(focus.value) || 0 : total).toLocaleString("en-IN")}
        </p>
        {focus && <p className="text-[11px] text-slate-500">{pct(Number(focus.value) || 0)}%</p>}
      </div>
    </div>
  );

  // `bare` drops the card and the legend: in Executive Overview the ring sits beside a
  // table that already prints every branch, its count and its share, so a legend there
  // would be the same list twice.
  if (bare) return ring;

  return (
    <Card data-testid="dashboard-branch-share">
      <CardContent className="flex flex-col items-center gap-6 p-5 sm:flex-row sm:items-center sm:gap-8">
        <div className="min-w-0 flex-1 order-2 sm:order-1">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Leads by branch</p>
          {/* The legend carries every value in text. That is what discharges the
              contrast warning on the lighter two hues, and it is why a branch too small
              to render an arc is still readable. */}
          <ul className="space-y-1.5">
            {arcs.map((b, i) => (
              <li
                key={b.branch_id}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                className={`flex items-center gap-2 rounded-md px-2 py-1 transition ${hover === i ? "bg-slate-100" : ""}`}
                data-testid={`dashboard-branch-share-legend-${b.branch_id}`}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: b.color }} />
                <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{b.branch_name}</span>
                <span className="shrink-0 text-sm font-bold text-slate-900">{(Number(b.value) || 0).toLocaleString("en-IN")}</span>
                <span className="w-12 shrink-0 text-right text-xs tabular-nums text-slate-500">{pct(Number(b.value) || 0)}%</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="order-1 sm:order-2">{ring}</div>
      </CardContent>
    </Card>
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
