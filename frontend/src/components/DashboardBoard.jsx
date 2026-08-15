import { useCallback, useEffect, useRef, useState } from "react";
import { Users, CalendarCheck, Activity, IndianRupee, X, Building2, LayoutDashboard, TrendingUp, TrendingDown, Minus, RefreshCw, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DateFilterPopover } from "@/components/DateFilterPopover";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import { toast } from "@/components/ui/sonner";
import { getDashboardOverview, getDashboardLeadsTrend, getRevenueOverview, mkGetTeam } from "@/lib/api";
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
  { key: "overview", label: "Executive Overview", short: "Overview", icon: LayoutDashboard },
  // Named for the team whose work it reports, not for the records it counts. Every figure
  // on it — enquiries in, calls due, slots fixed, who owns the follow-up — is Pre-Sales
  // work, and the per-agent panel that used to sit under BRANCHS belongs with them.
  { key: "leads", label: "Pre Sales", short: "Pre Sales", icon: Users },
  { key: "branch", label: "BRANCHS", short: "Branch", icon: Building2, team: "sales", panel: "branch" },
  { key: "revenue", label: "Revenue", icon: IndianRupee },
];

const TEAM_PANELS = {
  pre_sales: { title: "Pre-Sales Team", subtitle: "Lead qualification and appointment booking" },
  branch: { title: "Branch Performance", subtitle: "Consultations booked in, and how many reached a physio" },
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

  // A named loader rather than the fetch inline in the effect, so Refresh has something to
  // call — the effect still owns when it runs on a date change.
  const loadOverview = useCallback(() => {
    setLoading(true);
    // No dates on All — the endpoint reads that as unfiltered.
    const params = dateFilter.from && dateFilter.to
      ? { start_date: toIso(dateFilter.from), end_date: toIso(dateFilter.to) }
      : {};
    return getDashboardOverview(params)
      .then(setData)
      .catch(() => toast.error("Failed to load dashboard"))
      .finally(() => setLoading(false));
  }, [dateFilter]);

  useEffect(() => { loadOverview(); }, [loadOverview]);

  // Fetched once, on the first visit to either team tab, and not refetched when the date
  // range changes — /marketing/team-members counts a person's whole book and takes no
  // dates. Refetching on every range change would burn a request to return the same
  // numbers, and would imply the figures answer to the filter when they don't.
  useEffect(() => {
    // Pre Sales needs the roster too, and carries no `team` key of its own — its rows
    // come back under `pre_sales`, which every tab that needs people already reads.
    if (!(activeTeam || activeTab === "leads") || team || teamLoading) return;
    setTeamLoading(true);
    mkGetTeam()
      .then(setTeam)
      .catch(() => { toast.error("Failed to load the team"); setTeam({ pre_sales: [], sales: [] }); })
      .finally(() => setTeamLoading(false));
  }, [activeTeam, activeTab, team, teamLoading]);

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
        {/* Far right of the filter row, desktop only. It complements the one beside the
            branch picker rather than duplicating it: that one is sm:hidden, this one is
            hidden below sm, so exactly one is on screen at any width. Sitting in the
            header, this one reaches every tab rather than only those that draw the branch
            section. ml-auto is scoped to sm because below it the six presets already share
            the row edge to edge and there is no spare width to push into. */}
        <Button
          onClick={() => loadOverview()}
          disabled={loading}
          title="Refresh"
          aria-label="Refresh"
          className="hidden h-10 w-10 shrink-0 bg-slate-500 p-0 text-white hover:bg-slate-600 sm:ml-auto sm:inline-flex"
          data-testid="dashboard-refresh-desktop"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Two rows of three on a phone. Six tabs in one row leaves each about a sixth of
          the width, which even the short labels can't survive — and one of them is
          "Executive Overview". Desktop keeps the single row. */}
      {/* Four columns, not three: at three the fourth tab dropped to a second row on its
          own, which read as a separate control rather than the last of a set. */}
      <SegmentedTabs tabs={DASH_TABS} value={activeTab} onChange={setActiveTab} testid="dashboard-tab" mobileCols={4} />

      {activeTab === "overview" ? (
        <ExecutiveOverview data={data} loading={loading} dateFilter={dateFilter} />
      ) : activeTab === "leads" ? (
        <PreSalesTab team={team} loading={teamLoading} branches={data?.leads?.physio_branches || []} />
      ) : activeTeam ? (
        <BranchesTab team={team} loading={teamLoading} branches={data?.leads?.physio_branches || []} />
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
              there to stop someone adding all four and finding it over.

              Two across on a phone rather than a column of four, so the whole split is on
              screen at once instead of scrolled past one figure at a time. The figure
              drops to text-lg below sm: half a phone is about 130px of inner width, and a
              rupee total like ₹7,00,015.99 at text-3xl needs roughly 200. The labels take
              two lines' height whether they need it or not — "Total Revenue" fits one line
              where the other three wrap, and without it its figure would sit a line above
              its neighbours' across the 2x2. */}
          {activeTab === "revenue" && (
            <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4" data-testid="dashboard-revenue-totals">
              <Card className="border-emerald-200 bg-emerald-50/60" data-testid="dashboard-total-revenue">
                <CardContent className="p-3 sm:p-4">
                  <p className="min-h-[2.6em] text-xs font-semibold uppercase tracking-wider text-emerald-700 sm:min-h-0">Total Revenue</p>
                  <p className="mt-1 text-lg font-bold text-emerald-700 sm:text-3xl">{fmtValue("revenue", activeData.total)}</p>
                </CardContent>
              </Card>
              <Card data-testid="dashboard-consultation-revenue">
                <CardContent className="p-3 sm:p-4">
                  <p className="min-h-[2.6em] text-xs font-semibold uppercase tracking-wider text-sky-700 sm:min-h-0">Total Consultation Revenue</p>
                  <p className="mt-1 text-lg font-bold text-sky-700 sm:text-3xl">{fmtValue("revenue", activeData.consultation)}</p>
                </CardContent>
              </Card>
              <Card data-testid="dashboard-session-revenue">
                <CardContent className="p-3 sm:p-4">
                  <p className="min-h-[2.6em] text-xs font-semibold uppercase tracking-wider text-violet-700 sm:min-h-0">Total Session Revenue</p>
                  <p className="mt-1 text-lg font-bold text-violet-700 sm:text-3xl">{fmtValue("revenue", activeData.session)}</p>
                </CardContent>
              </Card>
              <Card data-testid="dashboard-spot-joining-revenue">
                <CardContent className="p-3 sm:p-4">
                  <p className="min-h-[2.6em] text-xs font-semibold uppercase tracking-wider text-amber-700 sm:min-h-0">Total Spot Joining Revenue</p>
                  <p className="mt-1 text-lg font-bold text-amber-700 sm:text-3xl">{fmtValue("revenue", activeData.spot_joining)}</p>
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
              {/* Refresh beside the picker, where the figures it reloads are being read.
                  The dashboard had none anywhere — every number on it is a snapshot taken
                  when the tab opened, and short of changing the date range and changing it
                  back there was no way to ask for a fresh one. */}
              <div className="flex items-center gap-2 sm:hidden">
                <select
                  className="h-11 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700"
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
                <Button
                  onClick={() => loadOverview()}
                  disabled={loading}
                  title="Refresh"
                  aria-label="Refresh"
                  className="h-11 w-11 shrink-0 bg-slate-500 p-0 text-white hover:bg-slate-600"
                  data-testid="dashboard-refresh"
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                </Button>
              </div>

              {/* The phone's empty state. Until a branch is picked the whole screen below
                  the dropdown was blank, which reads as a page that failed to load rather
                  than one waiting on a choice.

                  A chevron bounces up at the control that needs using, and beneath it sits
                  a ghost of the breakdown that will land here — pulsing in sequence, so the
                  space says "content goes here" rather than "nothing here". Both are
                  motion-safe, so a reader who has asked for reduced motion gets the same
                  message standing still. */}
              {!drillBranch && (
                <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 px-4 py-8 text-center sm:hidden" data-testid="dashboard-physio-empty">
                  <ChevronUp className="mx-auto h-5 w-5 text-sky-500 motion-safe:animate-bounce" />
                  <p className="mt-1 text-sm font-semibold text-slate-600">Pick a branch to see its breakdown</p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {activeData.physio_branches.length} {activeData.physio_branches.length === 1 ? "branch" : "branches"} · each with its own split
                  </p>
                  <div className="mt-5 space-y-2" aria-hidden="true">
                    {[0, 1, 2].map((i) => (
                      <div
                        key={i}
                        className="flex items-center gap-3 rounded-lg bg-slate-100/80 p-3 motion-safe:animate-pulse"
                        style={{ animationDelay: `${i * 150}ms` }}
                      >
                        <div className="h-8 w-8 shrink-0 rounded-full bg-slate-200" />
                        <div className="flex-1 space-y-1.5">
                          <div className="h-2.5 w-1/2 rounded bg-slate-200" />
                          <div className="h-2 w-1/3 rounded bg-slate-200/80" />
                        </div>
                        <div className="h-3 w-12 shrink-0 rounded bg-slate-200" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

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
              <BranchRevenueCards
                branch={drillBranch}
                dateFilter={dateFilter}
                onClose={() => setDrillBranch(null)}
              />
            )}
          </div>
          {/* Other Verticals removed from the board. The endpoint still returns them —
              other callers read the same payload — they just aren't drawn here. */}

          {/* The share breakdown and Quick Actions used to sit here. The share is on
              Executive Overview, beside a table that says more than the donut's legend
              did; the branch cards above are the same numbers again. What's left is the
              one thing this tab had that nothing else showed: the trend. */}
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
const inBranch = (m, bid) => (bid === "none" ? !m.branch_id : m.branch_id === bid);

/**
 * The branch row that heads both people tabs: one card per branch, clicking one narrows
 * the panel beneath it.
 *
 * The branch list comes from the dashboard payload rather than from the people, so a
 * branch with nobody on it still gets a card at zero. "This branch has no cover" is a
 * finding, and a card that quietly fails to exist cannot report it.
 *
 * Anyone whose login carries no branch would vanish the moment a branch is picked, so
 * they get a bucket of their own — shown only when somebody is actually in it.
 */
const BranchFilterCards = ({ branches, members, value, onChange, noun, testid }) => {
  const leadsIn = (bid) => members.filter((m) => inBranch(m, bid)).reduce((s, m) => s + (Number(m.total_assigned) || 0), 0);
  const countIn = (bid) => members.filter((m) => inBranch(m, bid)).length;
  const hasUnassigned = members.some((m) => !m.branch_id);

  const Card_ = ({ id, name }) => {
    const active = value === id;
    const n = countIn(id);
    return (
      <button
        type="button"
        onClick={() => onChange(active ? "" : id)}
        className={`rounded-xl border p-4 text-left transition ${
          active ? "border-sky-400 bg-sky-50 shadow-sm" : "border-slate-200 bg-white hover:border-sky-300 hover:shadow-sm"
        }`}
        data-testid={`${testid}-${id}`}
      >
        <p className="truncate text-xs font-semibold uppercase tracking-wider text-slate-500">{name}</p>
        <p className={`mt-1 text-2xl font-bold ${active ? "text-sky-700" : "text-slate-800"}`}>{leadsIn(id)}</p>
        <p className="mt-0.5 text-[11px] text-slate-400">
          {n} {n === 1 ? noun : `${noun}s`} · leads held
        </p>
      </button>
    );
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Physiotherapy Branches</p>
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="text-[11px] font-semibold text-sky-600 hover:text-sky-800"
            data-testid={`${testid}-clear`}
          >
            Show all branches
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {branches.map((b) => <Card_ key={b.branch_id} id={b.branch_id} name={b.branch_name} />)}
        {hasUnassigned && <Card_ id="none" name="No branch" />}
      </div>
    </div>
  );
};

/**
 * Dashboard > Pre Sales — the branches, and the agents behind whichever is picked.
 *
 * Each branch runs its own Pre-Sales team, so the roster is only readable a branch at a
 * time; all of them at once is a list of people from different places measured against an
 * average that spans all of them.
 */
const PreSalesTab = ({ team, loading, branches }) => {
  const [branchId, setBranchId] = useState("");
  const members = team?.pre_sales || [];
  const shown = branchId ? members.filter((m) => inBranch(m, branchId)) : members;

  if (loading || !team) {
    return <p className="py-16 text-center text-sm text-slate-400">{loading ? "Loading..." : "No data."}</p>;
  }

  return (
    <div className="space-y-4" data-testid="dashboard-pre-sales-tab">
      <BranchFilterCards
        branches={branches}
        members={members}
        value={branchId}
        onChange={setBranchId}
        noun="agent"
        testid="pre-sales-branch"
      />

      {/* No benchmarkFrom, so the average follows the filter. Narrowing to one branch
          measures its agents against each other — they are peers doing the same job in
          the same place, and that is the comparison worth making. */}
      <TeamCard
        title={TEAM_PANELS.pre_sales.title}
        subtitle={
          branchId
            ? `${branches.find((b) => b.branch_id === branchId)?.branch_name || "No branch"} · ${TEAM_PANELS.pre_sales.subtitle}`
            : TEAM_PANELS.pre_sales.subtitle
        }
        members={shown}
        kind="pre_sales"
      />
    </div>
  );
};

/**
 * Dashboard > BRANCHS — the same branch row, over the branch accounts themselves.
 */
const BranchesTab = ({ team, loading, branches }) => {
  const [branchId, setBranchId] = useState("");
  const members = team?.sales || [];
  const shown = branchId ? members.filter((m) => inBranch(m, branchId)) : members;

  if (loading || !team) {
    return <p className="py-16 text-center text-sm text-slate-400">{loading ? "Loading..." : "No data."}</p>;
  }

  return (
    <div className="space-y-4" data-testid="dashboard-branches-tab">
      <BranchFilterCards
        branches={branches}
        members={members}
        value={branchId}
        onChange={setBranchId}
        noun="branch"
        testid="branches-branch"
      />

      {/* benchmarkFrom is EVERY branch, even when one is selected. A branch's peers are
          the other branches, so measuring it against itself would hand every branch a
          delta of zero the moment it was opened — the filter would destroy the only
          number on the panel worth reading. */}
      <TeamCard
        title={TEAM_PANELS.branch.title}
        subtitle={
          branchId
            ? `${branches.find((b) => b.branch_id === branchId)?.branch_name || "No branch"} · ${TEAM_PANELS.branch.subtitle}`
            : TEAM_PANELS.branch.subtitle
        }
        members={shown}
        benchmarkFrom={members}
        kind="branch"
      />
    </div>
  );
};

const ExecutiveOverview = ({ data, loading, dateFilter }) => {
  const [prev, setPrev] = useState(null);
  const [prevLoading, setPrevLoading] = useState(false);
  // Which of the four headline figures the charts below are drawing. Held here rather
  // than inside either chart, so both plot the same metric and one selection drives them.
  const [trendMetric, setTrendMetric] = useState("leads");
  // null is every branch. Scopes the four cards and the total chart; the per-branch chart
  // keeps drawing all of them and highlights this one instead — see BranchGrowthTrend.
  const [branchFilter, setBranchFilter] = useState(null);

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

  // The branch list comes off the leads bucket, which carries every Physiotherapy branch
  // whether or not it took a lead in range — so a quiet branch still offers its card
  // rather than disappearing from the filter for the period it was quiet.
  const branchCards = data.leads?.physio_branches || [];

  /** One metric's figure, scoped to the selected branch or the whole org. */
  const scoped = (bucket) => {
    if (!bucket) return 0;
    if (!branchFilter) return bucket.total ?? 0;
    return (bucket.physio_branches || []).find((b) => b.branch_id === branchFilter)?.value ?? 0;
  };

  const metrics = [
    { key: "leads", label: "Total Leads", icon: Users, value: scoped(data.leads) },
    { key: "appointments", label: "Appointments", icon: CalendarCheck, value: scoped(data.appointments) },
    { key: "treatments", label: "Treatments", icon: Activity, value: scoped(data.treatments) },
    { key: "revenue", label: "Revenue", icon: IndianRupee, value: scoped(data.revenue), currency: true },
  ];
  // `key` is also the key inside each branch's `series` on /dashboard/leads-trend, so the
  // selected card and the lines drawn from it cannot drift apart.

  /** The same figure for the preceding window, scoped the same way — otherwise a branch's
   *  figure would be compared against the whole org's prior total. */
  const scopedPrev = (key) => {
    const bucket = prev?.[key];
    if (!bucket) return undefined;
    if (!branchFilter) return bucket.total;
    return (bucket.physio_branches || []).find((b) => b.branch_id === branchFilter)?.value;
  };

  const activeMetric = metrics.find((m) => m.key === trendMetric) || metrics[0];

  return (
    <div className="space-y-4" data-testid="dashboard-overview">
      {/* Two up on a phone rather than one. Four full-width cards stacked pushed the
          branch table two screens down, and these figures are short enough to share a
          row.

          Each card is also the trend's selector — clicking one draws that metric in the
          two charts below. The card already names the figure and prints its total, so
          putting the choice on it costs nothing and saves a second control repeating the
          same four words. The selected one inverts to solid slate. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {metrics.map((m) => {
          const before = scopedPrev(m.key);
          const on = m.key === trendMetric;
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => setTrendMetric(m.key)}
              aria-pressed={on}
              className={`rounded-xl border p-3 text-left shadow-sm transition sm:p-4 ${
                on ? "border-slate-800 bg-slate-800" : "border-slate-200 bg-white hover:border-slate-300"
              }`}
              data-testid={`dashboard-overview-${m.key}`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className={`min-w-0 truncate text-[10px] font-bold uppercase tracking-wider sm:text-[11px] ${on ? "text-white/80" : "text-slate-500"}`}>{m.label}</p>
                <m.icon className={`h-4 w-4 shrink-0 ${on ? "text-white/60" : "text-slate-300"}`} />
              </div>
              <p className={`mt-1 truncate text-2xl font-extrabold sm:text-3xl ${on ? "text-white" : "text-slate-800"}`}>
                {m.currency ? fmtValue("revenue", m.value) : (m.value || 0).toLocaleString("en-IN")}
              </p>
              <Delta now={m.value} before={before} loading={prevLoading} available={!!from && !!to} inverted={on} />
            </button>
          );
        })}
      </div>

      {/* Branch scope, under the figures it scopes and directly above the charts it also
          drives — so it sits between the two things it changes rather than opening the
          board with a control. Clicking the selected one clears back to every branch,
          which is why there is no fifth "All" card competing for the row. */}
      {branchCards.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="dashboard-branch-filter">
          {branchCards.map((b) => {
            const on = branchFilter === b.branch_id;
            return (
              <button
                key={b.branch_id}
                type="button"
                onClick={() => setBranchFilter(on ? null : b.branch_id)}
                aria-pressed={on}
                className={`rounded-xl border px-4 py-5 text-left text-sm font-bold uppercase tracking-wide transition sm:py-6 ${
                  on ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                }`}
                data-testid={`dashboard-branch-filter-${b.branch_id}`}
              >
                <span className="block truncate">{b.branch_name}</span>
              </button>
            );
          })}
        </div>
      )}

      <BranchGrowthTrend metric={activeMetric} highlightBranch={branchFilter} />
      <LeadsTrend metric={activeMetric} branchId={branchFilter} />
    </div>
  );
};

/**
 * The trend payload, fetched once and shared.
 *
 * Both charts read the same six months, and both redraw on a metric change rather than
 * refetching — the response already carries all four series, so a request per selection
 * would be four round trips for data already in hand.
 */
const useTrendData = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getDashboardLeadsTrend(6)
      .then((r) => { if (!cancelled) setData(r); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return { data, loading };
};

/** The selected metric's series for one branch, falling back to the legacy `values` row
 *  so an older payload without `series` still draws its leads line. */
const branchSeries = (b, metricKey) => b.series?.[metricKey] || (metricKey === "leads" ? b.values : null) || [];

/**
 * The drawing width, measured rather than assumed.
 *
 * A fixed viewBox with a fixed height scales to whichever axis runs out first, and on a
 * wide card that is the height — so the plot was drawn at its natural ratio and centred,
 * leaving a margin down each side. Measuring lets the viewBox be the real pixel box: the
 * chart fills the card, and strokes, text and circles stay the size they are declared
 * instead of being scaled along with the geometry.
 */
const useMeasuredWidth = (fallback = 720) => {
  const ref = useRef(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const apply = () => setWidth(Math.max(320, Math.round(el.clientWidth)));
    apply();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", apply);
      return () => window.removeEventListener("resize", apply);
    }
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, width];
};

/**
 * A Catmull-Rom spline written out as cubic béziers — the curved line the design asks for.
 *
 * Worth knowing what a curve costs: between two months it bows above or below the straight
 * path, so the ink between readings suggests values that were never measured, and a series
 * that touches zero can dip visually below it. The readings themselves stay exact, which
 * is why every point is also marked and printed in the readout.
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

/** Shared axis maths: a 1 / 2 / 5 × power-of-ten step, with the axis topping out at a
 *  multiple of it rather than at the data. Scaling straight to the peak leaves the highest
 *  point sitting on the frame with no gridline above it — and a step derived from the peak
 *  alone gave figures like 560, which makes the reader do the arithmetic the gridline was
 *  there to save. */
const axisFor = (peakValue) => {
  const peak = Math.max(1, peakValue);
  const raw = peak / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = Math.max(1, (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag);
  return { step, axisMax: step * Math.ceil(peak / step) };
};

const monthLabel = (k) => new Date(`${k}-01T00:00:00`).toLocaleDateString("en-US", { month: "short" });

/**
 * Total by month over the last six months, for whichever metric is selected above.
 *
 * One line — the branch split is the chart above this one. This answers what the cards
 * leave open: they say where things stand today, this says which way they have been
 * going.
 *
 * Not filtered by the board's date range, deliberately: a trend answers "which way is
 * this going", and a six-month line inside a one-day filter would be a single point.
 *
 * The total is summed across branches here rather than asking the endpoint for a figure
 * its per-branch rows already contain.
 */
const LeadsTrend = ({ metric, branchId }) => {
  const { data, loading } = useTrendData();
  const [hoverIdx, setHoverIdx] = useState(null);

  if (loading) return <Card><CardContent className="p-5"><p className="py-10 text-center text-sm text-slate-400">Loading trend…</p></CardContent></Card>;
  if (!data || !data.months?.length) return null;

  // With a branch selected this is that branch's own line rather than the org total, so it
  // matches the cards above, which are scoped the same way.
  const inScope = branchId
    ? (data.branches || []).filter((b) => b.branch_id === branchId)
    : (data.branches || []);
  const scopeName = branchId ? (inScope[0]?.branch_name || "") : "";
  const totals = data.months.map((_m, i) =>
    inScope.reduce((sum, b) => sum + (branchSeries(b, metric.key)[i] || 0), 0));
  const { step, axisMax } = axisFor(Math.max(...totals));

  // viewBox units, not pixels — the svg scales to its container and the maths stays in
  // one coordinate space.
  const W = 720;
  const H = 220;
  // Narrow left padding: the axis figures are gone with the banded design, so the plot
  // takes the width they were reserving.
  const PAD_L = 14;
  const PAD_R = 14;
  const PAD_T = 10;
  const PAD_B = 26;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const x = (i) => PAD_L + (data.months.length === 1 ? plotW / 2 : (i / (data.months.length - 1)) * plotW);
  const y = (v) => PAD_T + plotH - (v / axisMax) * plotH;

  const ticks = [];
  for (let v = 0; v <= axisMax + 1e-9; v += step) ticks.push(Math.round(v));

  // Near-black rather than the brand blue. On a banded ground the line is the only mark
  // that carries meaning, and ink reads against those bands at any weight where a mid
  // blue starts to compete with them.
  const LINE = "#18181b";
  const readout = (v) => (metric.currency ? fmtValue("revenue", v) : v.toLocaleString("en-IN"));

  return (
    <Card data-testid="dashboard-leads-trend">
      <CardContent className="p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-bold text-slate-800">{scopeName || "OverAll"}</p>
          <p className="text-[11px] text-slate-400">{metric.label} · last 6 months · not affected by the date filter</p>
        </div>

        <div className="-mx-1 overflow-x-auto px-1">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-56 w-full min-w-[560px]" role="img" aria-label={`Total ${metric.label} over the last six months`}>
            {/* Banded rather than ruled. The bands carry the same scale the gridlines did —
                one band per axis step — but read as a surface the line sits on instead of
                four rules competing with it. The figures beside them are gone with them:
                every value is in the readout below, so the chart is left to do the one
                thing this design is for, which is shape. */}
            {ticks.slice(0, -1).map((v, i) => (
              <rect
                key={v}
                x={PAD_L}
                y={y(ticks[i + 1])}
                width={plotW}
                height={y(v) - y(ticks[i + 1])}
                fill={i % 2 === 0 ? "#f4f4f5" : "#ffffff"}
              />
            ))}
            {data.months.map((k, i) => (
              <text key={k} x={x(i)} y={H - 8} textAnchor="middle" className="fill-slate-400" style={{ fontSize: 9 }}>
                {monthLabel(k)}
              </text>
            ))}

            {hoverIdx !== null && (
              <line x1={x(hoverIdx)} x2={x(hoverIdx)} y1={PAD_T} y2={PAD_T + plotH} stroke="#d4d4d8" strokeWidth="1" />
            )}

            <polyline
              fill="none"
              stroke={LINE}
              strokeWidth="1.75"
              strokeLinejoin="round"
              strokeLinecap="round"
              points={totals.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
            />
            {/* One marker, on the month under the cursor. Six permanent dots turned a thin
                line into a beaded one, which is the opposite of what this design is. */}
            {hoverIdx !== null && (
              <circle cx={x(hoverIdx)} cy={y(totals[hoverIdx])} r="3.5" fill={LINE} stroke="#ffffff" strokeWidth="2" />
            )}

            {/* One hit band per month, full plot height — a 2px line is impossible to
                land on, and the band is what makes the crosshair usable. */}
            {data.months.map((k, i) => (
              <rect
                key={k}
                x={x(i) - plotW / Math.max(1, data.months.length - 1) / 2}
                y={PAD_T}
                width={plotW / Math.max(1, data.months.length - 1)}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx(null)}
              />
            ))}
          </svg>
        </div>

        {/* The hovered month in text, because a tooltip should enhance rather than be the
            only way to read a value. */}
        <div className="mt-2 min-h-[20px] text-[11px] text-slate-500">
          {hoverIdx !== null && (
            <span>
              <span className="font-semibold text-slate-700">{monthLabel(data.months[hoverIdx])} {data.months[hoverIdx].slice(0, 4)}</span>
              {" · "}
              <b className="text-slate-700">{readout(totals[hoverIdx])}</b> {metric.label.toLowerCase()}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

/** Change against the preceding window. Silent rather than "0%" when there is nothing to
 *  compare against — an unknown and a flat period are different things, and printing 0%
 *  for the first is the kind of number people act on. */
const Delta = ({ now, before, loading, available, inverted = false }) => {
  // On the selected card the ground is solid slate, where the muted greys this normally
  // uses fall below readable contrast. `inverted` lifts them onto the dark instead.
  const muted = inverted ? "text-white/70" : "text-slate-400";
  if (!available) return <p className={`mt-1 text-[11px] ${muted}`}>All time · no prior period</p>;
  if (loading) return <p className={`mt-1 text-[11px] ${inverted ? "text-white/50" : "text-slate-300"}`}>Comparing…</p>;
  if (before == null) return <p className={`mt-1 text-[11px] ${muted}`}>No prior period</p>;
  if (!before) {
    // Growth from zero has no percentage — any increase is infinite. Say what happened.
    return <p className={`mt-1 text-[11px] ${muted}`}>{now ? "New this period" : "None either period"}</p>;
  }
  const pct = ((now - before) / before) * 100;
  const flat = Math.abs(pct) < 0.05;
  const Icon = flat ? Minus : pct > 0 ? TrendingUp : TrendingDown;
  const tone = inverted
    ? (flat ? "text-white/70" : pct > 0 ? "text-emerald-300" : "text-rose-300")
    : (flat ? "text-slate-400" : pct > 0 ? "text-emerald-600" : "text-rose-600");
  return (
    <p className={`mt-1 flex items-center gap-1 text-[11px] font-semibold ${tone}`}>
      <Icon className="h-3 w-3 shrink-0" />
      {flat ? "0%" : `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`}
      <span className={`font-normal ${muted}`}>vs prior period</span>
    </p>
  );
};

// Greyscale, darkest first — the reference design's own scheme. Branch identity rests on
// the legend and the hover readout rather than on hue, which is what makes a monochrome
// ramp safe here: four greys are not reliably tellable apart on their own.
const BRANCH_INKS = ["#18181b", "#52525b", "#a1a1aa", "#d4d4d8", "#71717a", "#3f3f46"];

/**
 * The same six months split by branch — "which branch is moving", where the chart below
 * answers "which way are we going overall".
 *
 * Draws whichever metric is selected on the cards above, so the pair never shows two
 * different things at once.
 */
const BranchGrowthTrend = ({ metric, highlightBranch }) => {
  const { data, loading } = useTrendData();
  const [hoverIdx, setHoverIdx] = useState(null);
  const [wrapRef, W] = useMeasuredWidth();

  if (loading) return <Card><CardContent className="p-5"><p className="py-10 text-center text-sm text-slate-400">Loading growth…</p></CardContent></Card>;
  if (!data || !data.months?.length) return null;

  // A selected branch is highlighted here rather than filtered to. Filtering would leave
  // this chart drawing the single line the one below already draws, and lose the very
  // thing it is for — where that branch sits against the others.
  const series = (data.branches || []).map((b, i) => ({
    ...b,
    color: BRANCH_INKS[i % BRANCH_INKS.length],
    points: branchSeries(b, metric.key),
    faded: !!highlightBranch && b.branch_id !== highlightBranch,
  }));
  if (!series.length) return null;

  const { axisMax } = axisFor(Math.max(0, ...series.flatMap((s) => s.points)));

  const H = 300;
  const PAD_L = 18;
  const PAD_R = 18;
  // Headroom at the top and a little under the baseline, because a curve bows past its
  // own points — without it the highest peak clips against the frame.
  const PAD_T = 24;
  const PAD_B = 34;
  const plotW = Math.max(1, W - PAD_L - PAD_R);
  const plotH = H - PAD_T - PAD_B;
  const x = (i) => PAD_L + (data.months.length === 1 ? plotW / 2 : (i / (data.months.length - 1)) * plotW);
  const y = (v) => PAD_T + plotH - (v / axisMax) * plotH;

  const readout = (v) => (metric.currency ? fmtValue("revenue", v) : v.toLocaleString("en-IN"));

  return (
    <Card data-testid="dashboard-branch-growth">
      <CardContent className="p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-bold text-slate-800">OverAll Growth</p>
          <p className="text-[11px] text-slate-400">{metric.label} by branch · last 6 months</p>
        </div>

        {/* Legend always. Four greys cannot be told apart by eye, so identity rests here
            and in the readout — the swatch only ties a name to a line already labelled. */}
        <div className="mb-2 flex flex-wrap justify-center gap-x-8 gap-y-2">
          {series.map((s) => (
            <span key={s.branch_id} className={`flex items-center gap-2 text-xs font-bold uppercase tracking-wide ${s.faded ? "text-slate-400" : "text-slate-700"}`}>
              <span className="h-3 w-3 shrink-0 rounded-[2px]" style={{ background: s.color, opacity: s.faded ? 0.35 : 1 }} />
              {s.branch_name}
            </span>
          ))}
        </div>

        {/* No bands and no gridlines — a single hairline baseline, as the design has it.
            Nothing is left on the chart to read a value off, which is what the permanent
            markers and the readout below are for. */}
        <div ref={wrapRef}>
          <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${metric.label} per branch over the last six months`}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(0)} y2={y(0)} stroke="#e4e4e7" strokeWidth="1" />

            {data.months.map((k, i) => (
              <text key={k} x={x(i)} y={H - 12} textAnchor="middle" className="fill-slate-400" style={{ fontSize: 11 }}>
                {monthLabel(k)}
              </text>
            ))}

            {hoverIdx !== null && (
              <line x1={x(hoverIdx)} x2={x(hoverIdx)} y1={PAD_T} y2={y(0)} stroke="#e4e4e7" strokeWidth="1" />
            )}

            {/* Faded lines first, so the highlighted one is drawn over them rather than
                under whichever branch happens to come later in the payload. */}
            {[...series].sort((a, b) => Number(b.faded) - Number(a.faded)).map((s) => (
              <path
                key={s.branch_id}
                fill="none"
                stroke={s.color}
                strokeWidth={s.faded ? 1.5 : 2.25}
                strokeOpacity={s.faded ? 0.25 : 1}
                strokeLinejoin="round"
                strokeLinecap="round"
                d={smoothPath(s.points.map((v, i) => [x(i), y(v || 0)]))}
              />
            ))}

            {/* Every reading marked, always. The curve between them is interpolation; these
                are the only places on the chart where the ink is a measurement. */}
            {[...series].sort((a, b) => Number(b.faded) - Number(a.faded)).map((s) => (
              s.points.map((v, i) => (
                <circle
                  key={`${s.branch_id}-${i}`}
                  cx={x(i)}
                  cy={y(v || 0)}
                  r={hoverIdx === i && !s.faded ? 5 : 3.5}
                  fill={s.color}
                  fillOpacity={s.faded ? 0.25 : 1}
                />
              ))
            ))}

            {data.months.map((k, i) => (
              <rect
                key={k}
                x={x(i) - plotW / Math.max(1, data.months.length - 1) / 2}
                y={PAD_T}
                width={plotW / Math.max(1, data.months.length - 1)}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx(null)}
              />
            ))}
          </svg>
        </div>

        <div className="mt-2 min-h-[20px] text-[11px] text-slate-500">
          {hoverIdx !== null && (
            <span className="flex flex-wrap gap-x-3 gap-y-1">
              <span className="font-semibold text-slate-700">{monthLabel(data.months[hoverIdx])} {data.months[hoverIdx].slice(0, 4)}</span>
              {series.map((s) => (
                <span key={s.branch_id}>
                  <span className="inline-block h-2 w-2 rounded-sm align-middle" style={{ background: s.color }} />{" "}
                  {s.branch_name} <b className="text-slate-700">{readout(s.points[hoverIdx] || 0)}</b>
                </span>
              ))}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
};


const money = (n) => `₹${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const amt = (v) => Number(v) || 0;

/** Still owed on a Partial Payment plan. A row already collected is history; counting it
    would make this a total of the plan rather than of what is still to come. */
export const unpaidSchedule = (schedule = []) => schedule.filter((s) => s.status !== "paid");

/**
 * Clients with nothing left owing, rolled up from their own transactions — the same cut
 * Accountant Manage's Payment Paid makes.
 *
 * Store sales are excluded outright rather than merely carrying no lead: a counter sale
 * that ever gained one would otherwise be credited to whoever it landed beside.
 */
export const paidByLead = (transactions = [], outstanding = []) => {
  const owing = new Set(outstanding.map((o) => o.lead_id));
  const out = {};
  transactions.forEach((t) => {
    if (t.source === "store" || !t.lead_id || owing.has(t.lead_id)) return;
    out[t.lead_id] = (out[t.lead_id] || 0) + amt(t.gross);
  });
  return out;
};

/** Billed, and nothing collected at all — what separates this from Outstanding Amount's
    part-payers, who have paid something and still owe the rest. */
export const fullyUnpaid = (outstanding = []) =>
  outstanding.filter((o) => amt(o.paid_amount) <= 0 && amt(o.balance) > 0);

/**
 * One branch's money, opened from its card on the Revenue tab.
 *
 * Every figure comes from /finance/revenue-overview scoped to this branch — the same
 * payload Accountant Manage reads — so a branch's numbers here and on that board cannot
 * disagree. Derived the same way too: Payment Paid and Payment Unpaid are the roll-ups
 * that board performs, not second definitions written for this screen.
 *
 * What used to open here was the lead breakdown: who booked, which physio saw them. That
 * is the Pre Sales and BRANCHS question, and on a tab named Revenue it answered one
 * nobody had asked.
 */
const BranchRevenueCards = ({ branch, dateFilter, onClose }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = { branch_id: branch.branch_id };
    if (dateFilter?.from && dateFilter?.to) {
      params.start_date = toIso(dateFilter.from);
      params.end_date = toIso(dateFilter.to);
    }
    getRevenueOverview(params)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [branch.branch_id, dateFilter]);

  const b = data?.breakdown || {};
  const transactions = data?.transactions || [];
  const outstanding = data?.outstanding_clients || [];
  const schedule = data?.payment_schedule || [];

  const outstandingTotal = outstanding.reduce((s, c) => s + amt(c.balance), 0);

  const scheduleUnpaid = unpaidSchedule(schedule);
  const scheduleTotal = scheduleUnpaid.reduce((s, r) => s + amt(r.amount), 0);

  const paid = paidByLead(transactions, outstanding);
  const paidTotal = Object.values(paid).reduce((s, v) => s + v, 0);

  const unpaidClients = fullyUnpaid(outstanding);
  const unpaidTotal = unpaidClients.reduce((s, c) => s + amt(c.balance), 0);

  const cards = [
    { key: "total", label: "Total Revenue", value: money(data?.kpis?.total_collected), sub: `${transactions.length} transactions`, tone: "border-emerald-200 bg-emerald-50/60 text-emerald-700" },
    { key: "consultation", label: "Consultations Revenue", value: money(b.consultation_revenue), sub: `${b.consultation_pct || 0}% of total`, tone: "border-sky-200 bg-sky-50/60 text-sky-700" },
    { key: "session", label: "Sessions Revenue", value: money(b.session_revenue), sub: `${b.session_pct || 0}% of total`, tone: "border-violet-200 bg-violet-50/60 text-violet-700" },
    { key: "diet", label: "Diet Collections", value: money(b.diet_revenue), sub: `${b.diet_pct || 0}% of total`, tone: "border-orange-200 bg-orange-50/60 text-orange-700" },
    { key: "store", label: "Store Payment", value: money(b.store_revenue), sub: `${transactions.filter((t) => t.source === "store").length} sales`, tone: "border-teal-200 bg-teal-50/60 text-teal-700" },
    { key: "outstanding", label: "Outstanding Amount", value: money(outstandingTotal), sub: `${outstanding.length} ${outstanding.length === 1 ? "client" : "clients"}`, tone: "border-amber-200 bg-amber-50/60 text-amber-700" },
    { key: "schedules", label: "Payment Schedules", value: money(scheduleTotal), sub: `${scheduleUnpaid.length} still due`, tone: "border-indigo-200 bg-indigo-50/60 text-indigo-700" },
    { key: "paid", label: "Payment Paid", value: money(paidTotal), sub: `${Object.keys(paid).length} settled`, tone: "border-emerald-200 bg-emerald-50/60 text-emerald-700" },
    { key: "unpaid", label: "Payment Unpaid", value: money(unpaidTotal), sub: `${unpaidClients.length} ${unpaidClients.length === 1 ? "client" : "clients"}`, tone: "border-rose-200 bg-rose-50/60 text-rose-700" },
  ];

  return (
    <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50/40 p-4" data-testid="branch-revenue-cards">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-bold text-sky-700">
          {branch.branch_name} <span className="font-normal text-slate-400">{dateFilter?.label || "All"}</span>
        </p>
        <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-white" data-testid="branch-revenue-close">
          <X className="h-4 w-4" />
        </button>
      </div>

      {loading ? (
        <p className="py-8 text-center text-sm text-slate-400">Loading...</p>
      ) : !data ? (
        <p className="py-8 text-center text-sm text-slate-400">Couldn't load this branch's transactions.</p>
      ) : (
        // Horizontal, wrapping. A fixed grid would leave the last row's cards stretched
        // across columns they don't fill; flowing them keeps every card the same size
        // whatever the screen does with the row.
        <div className="flex flex-wrap gap-3">
          {cards.map((c) => (
            <div
              key={c.key}
              className={`min-w-[150px] flex-1 rounded-xl border p-3 sm:min-w-[170px] sm:max-w-[220px] ${c.tone}`}
              data-testid={`branch-revenue-${c.key}`}
            >
              <p className="truncate text-[10px] font-bold uppercase tracking-wider opacity-80">{c.label}</p>
              <p className="mt-1 truncate text-xl font-bold">{c.value}</p>
              <p className="mt-0.5 truncate text-[10px] opacity-60">{c.sub}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
