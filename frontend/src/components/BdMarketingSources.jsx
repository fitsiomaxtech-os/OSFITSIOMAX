import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronRight, FileSpreadsheet, Search, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { getMarketingSources } from "@/lib/api";
// The All / Offline / Online + branch filter every Dashboard tab opens with, and the
// reader that turns whichever of the two is picked into the ids an endpoint takes. Both
// are DashboardBoard's own -- imported rather than rebuilt so this table is scoped by
// exactly the control the cards it replaced were scoped by, and a branch means the same
// thing on both.
import { ModeBranchFilter, resolveBranchIds } from "@/components/DashboardBoard";
// The leads behind whichever row gets clicked.
import { BdMarketingList } from "@/components/BdMarketingList";

/* ─── Grouping ─── */

// The three readings of one set of leads. Keys match MARKETING_GROUPINGS in
// backend/routers/v3_dashboard.py; the server does the grouping, this only names it.
//
// Source first because it is the marketing question and a sheet is a thing somebody set
// up and can go and fix. Branch second, the same table from the other end. The pairing
// last because it is the longest — on this estate it is roughly sources x branches rows —
// and it answers a question you only ask once the first two have raised it.
const GROUPINGS = [
  { key: "source", label: "Source", hint: "One row per sheet or form" },
  { key: "branch", label: "Branch", hint: "One row per branch, whatever fed it" },
  { key: "source_branch", label: "Source × Branch", hint: "What each sheet did for each branch" },
];

/* ─── Cells ─── */

const pct = (n) => `${(n ?? 0).toFixed(1)}%`;
const num = (n) => (n ?? 0).toLocaleString("en-IN");

/** "16 Sep" — the day a source last carried anything, in the form a date is read on a row
 *  rather than the stamp it is stored as. The year is dropped: every range this board
 *  offers ends today, so a row is being read against a span of weeks or months, and the
 *  year would be the same four characters on every line. */
const shortDay = (iso) => {
  const d = new Date(iso || "");
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
};

// A rate is only worth colouring once there is enough behind it to mean something. Four
// leads and one booking is 25%, which would paint the best row in the table green on the
// strength of a single appointment. Below the floor the figure still shows, in the
// ordinary ink -- it is a fact, it is just not yet a verdict.
const RATE_FLOOR = 25;

const rateTone = (row) => {
  if (row.leads < RATE_FLOOR) return "text-slate-500";
  if (row.conversion_rate >= 2) return "text-emerald-600";
  if (row.conversion_rate > 0) return "text-slate-700";
  return "text-rose-600";
};

/** The share bar under a row's lead count. Widths are against the biggest row rather than
 *  against the total: the largest source here is a third of everything, so a bar drawn as
 *  a share of the whole would leave every other row a sliver and the column would rank
 *  nothing. This is a ranking device, and it says so by being relative. */
const ShareBar = ({ value, max }) => (
  <span className="mt-1 block h-1.5 w-full max-w-[120px] overflow-hidden rounded-full bg-slate-100">
    <span
      className="block h-full rounded-full bg-sky-500"
      style={{ width: `${max ? Math.max(2, (value / max) * 100) : 0}%` }}
    />
  </span>
);

/* ─── The table ─── */

/**
 * Business Development > Dashboard > Marketing — every lead source in the range as a row,
 * with the leads behind any one of them a click away.
 *
 * This desk's Marketing tab used to be Super Admin's: a row of StatTiles counting leads
 * per channel, capped at six with the remaining nine sheets folded into one "Other" tile.
 * Two problems with that, and this table is the answer to both. The cap meant the sheets
 * a desk most needs to check on — the small and the newly broken — were precisely the ones
 * with no name on screen. And a count on its own ranks channels by size, which the desk
 * already knows; what it cannot see from a tile is that 1,387 leads produced nine
 * bookings.
 *
 * So: every source named, with Booked and Conversion beside the count, and Last Lead to
 * catch a sheet that has quietly stopped syncing. A row opens the leads behind it.
 *
 * Only this desk's tab changes. Super Admin's own Dashboard > Marketing still draws the
 * tiles, out of the same unchanged DashboardTabPanel — see BusinessLeadsDashboard.jsx.
 *
 * @param branches   every branch, from useDashboardData — the roster the filter picks from
 * @param dateParams the board's date range, in the two params the BD endpoints take
 * @param rangeLabel that range in words, for the caption over the table
 * @param onOpenLead opens a lead in Sales View's own popup, from the drill-down list
 */
export const BdMarketingSources = ({ branches, dateParams, rangeLabel, onOpenLead }) => {
  const [group, setGroup] = useState("all");
  const [branchId, setBranchId] = useState("");
  const [groupBy, setGroupBy] = useState("source");
  const [search, setSearch] = useState("");

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  // Which row is open, or null for the table. Held as the whole row rather than as its
  // key: the drill-down needs the source, the branch and both names, and looking all four
  // back up out of a list that may have been re-fetched since is how a header ends up
  // naming a different sheet from the one the rows came from.
  const [drill, setDrill] = useState(null);

  const branchParam = useMemo(() => {
    // resolveBranchIds answers with a single id for a named branch and a comma-joined set
    // for a group; `undefined` is All, which the endpoint reads as unfiltered. This one
    // takes only `branch_ids`, so a single id goes in the same param.
    const ids = resolveBranchIds(branches, group, branchId);
    return ids === undefined ? {} : { branch_ids: ids };
  }, [branches, group, branchId]);

  useEffect(() => {
    // Guarded: a branch pressed twice quickly leaves two requests in flight, and the
    // slower one must not land on top of the newer table.
    let cancelled = false;
    setLoading(true);
    getMarketingSources({ ...dateParams, ...branchParam, group_by: groupBy })
      .then((res) => { if (!cancelled) setData(res); })
      .catch(() => { if (!cancelled) { toast.error("Failed to load Marketing"); setData(null); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [dateParams, branchParam, groupBy]);

  // Changing the scope closes the open row. Those leads were asked for under the filters
  // in force when the row was clicked, and leaving the list up under a new range would
  // have it headed by a figure that no longer counts what it is sitting over.
  useEffect(() => { setDrill(null); }, [dateParams, branchParam, groupBy]);

  const sent = useMemo(() => data?.rows || [], [data]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sent;
    return sent.filter((r) => [r.source, r.source_type, r.branch_name]
      .some((v) => String(v || "").toLowerCase().includes(q)));
  }, [sent, search]);

  const max = useMemo(() => rows.reduce((m, r) => Math.max(m, r.leads), 0), [rows]);

  // The head of the table. The server's own totals when nothing is being searched for --
  // those count every lead in range, including any the row list does not carry -- and the
  // visible rows' own sums when it is, because a total that ignores the search would sit
  // over nine rows claiming the fifteen.
  const totals = useMemo(() => {
    if (!data) return null;
    if (rows.length === sent.length) return data.totals;
    const leads = rows.reduce((s, r) => s + r.leads, 0);
    const booked = rows.reduce((s, r) => s + r.booked, 0);
    return { leads, booked, conversion_rate: leads ? (booked / leads) * 100 : 0, rows: rows.length };
  }, [data, rows, sent]);

  // What the open row hands the lead list: the same scope the row was counted under.
  // `source_tab` only where the row names one source -- under Branch it names a count of
  // them, and passing that as a filter would ask for a sheet called "9 sources".
  const drillParams = useMemo(() => {
    if (!drill) return null;
    const out = { ...branchParam };
    if (drill.branch_id) out.branch_id = drill.branch_id;
    if (groupBy !== "branch" && drill.source) out.source_tab = drill.source;
    return out;
  }, [drill, branchParam, groupBy]);

  if (drill) {
    return (
      <BdMarketingList
        branches={branches}
        dateParams={dateParams}
        params={drillParams}
        title={groupBy === "branch" ? drill.branch_name : drill.source}
        subtitle={
          groupBy === "source" ? `${drill.branch_name} · ${num(drill.leads)} leads · ${num(drill.booked)} booked`
            : groupBy === "branch" ? `${drill.source} · ${num(drill.leads)} leads · ${num(drill.booked)} booked`
              : `${drill.branch_name} · ${num(drill.leads)} leads · ${num(drill.booked)} booked`
        }
        onBack={() => setDrill(null)}
        onOpenLead={onOpenLead}
      />
    );
  }

  const headBy = groupBy === "branch" ? "Branch" : "Source";
  const subBy = groupBy === "branch" ? "Fed by" : "Branch";

  return (
    <div className="space-y-4" data-testid="bd-marketing-sources-tab">
      <ModeBranchFilter
        branches={branches}
        group={group}
        onGroup={setGroup}
        branchId={branchId}
        onBranch={setBranchId}
        testid="bd-marketing-sources-filter"
      />

      <Card data-testid="bd-marketing-sources-card">
        <CardContent className="p-0">
          <div className="flex flex-col gap-2 border-b border-slate-100 p-3 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search a source or branch..."
                className="h-11 rounded-xl border-slate-200 pl-9 pr-9 text-sm"
                data-testid="bd-marketing-sources-search"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  aria-label="Clear the search"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Three pills rather than a dropdown. A dropdown would be a control to open
                before the control it opens, and these three are the whole question. */}
            <div className="flex shrink-0 items-center gap-1 rounded-xl border border-slate-200 p-1" data-testid="bd-marketing-group-by">
              {GROUPINGS.map((g) => (
                <button
                  key={g.key}
                  type="button"
                  onClick={() => setGroupBy(g.key)}
                  title={g.hint}
                  aria-pressed={groupBy === g.key}
                  className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold transition ${
                    groupBy === g.key ? "bg-sky-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-50"
                  }`}
                  data-testid={`bd-marketing-group-by-${g.key}`}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>

          {/* The range in words, over the table it scopes. Said once here rather than as a
              column on every row: every row spans the same window, and the one date that
              differs per row has a column of its own. */}
          <p className="border-b border-slate-100 px-3 py-2 text-xs text-slate-500" data-testid="bd-marketing-sources-caption">
            {rangeLabel}
            {totals && ` · ${num(totals.rows)} ${groupBy === "branch" ? "branches" : groupBy === "source" ? "sources" : "pairings"} · ${num(totals.leads)} leads`}
          </p>

          {loading ? (
            <p className="px-3 py-16 text-center text-sm text-slate-400" data-testid="bd-marketing-sources-loading">Loading...</p>
          ) : rows.length === 0 ? (
            <p className="px-3 py-16 text-center text-sm text-slate-400" data-testid="bd-marketing-sources-empty">
              {sent.length === 0 ? "No leads in this range." : "Nothing here matches the search."}
            </p>
          ) : (
            <>
              {/* Phone: the same row stacked. Six numeric columns on a 360px screen is a
                  table nobody reads, but the four figures are short enough to sit as a
                  strip under the name. */}
              <div className="space-y-2 p-3 md:hidden" data-testid="bd-marketing-sources-mobile">
                {totals && (
                  <div className="rounded-xl border-2 border-slate-200 bg-slate-50 p-3" data-testid="bd-marketing-sources-total-mobile">
                    <p className="text-sm font-bold text-slate-800">Total</p>
                    <p className="text-xs text-slate-500">
                      {num(totals.rows)} {groupBy === "branch" ? "branches" : groupBy === "source" ? "sources" : "pairings"}
                    </p>
                    {/* Three, not the rows' four: a "last lead" across every source is the
                        newest of them, which says nothing about whether any one has
                        stopped -- the only question that column is there to answer. */}
                    <dl className="mt-2 grid grid-cols-3 gap-2">
                      <div>
                        <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Leads</dt>
                        <dd className="text-sm font-bold text-slate-800">{num(totals.leads)}</dd>
                      </div>
                      <div>
                        <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Booked</dt>
                        <dd className="text-sm font-bold text-slate-800">{num(totals.booked)}</dd>
                      </div>
                      <div>
                        <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Conv</dt>
                        <dd className="text-sm font-bold text-slate-800">{pct(totals.conversion_rate)}</dd>
                      </div>
                    </dl>
                  </div>
                )}
                {rows.map((r) => (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => setDrill(r)}
                    className="block w-full rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-sky-300"
                    data-testid={`bd-marketing-sources-card-${r.key}`}
                  >
                    <div className="flex items-start gap-2">
                      <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-slate-800">
                          {groupBy === "branch" ? r.branch_name : r.source}
                        </p>
                        <p className="truncate text-xs text-slate-500">
                          {groupBy === "branch" ? r.source : r.branch_name}
                        </p>
                      </div>
                      <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
                    </div>
                    <dl className="mt-2 grid grid-cols-4 gap-2 pl-6">
                      <div>
                        <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Leads</dt>
                        <dd className="text-sm font-bold text-slate-800">{num(r.leads)}</dd>
                      </div>
                      <div>
                        <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Booked</dt>
                        <dd className="text-sm font-bold text-slate-800">{num(r.booked)}</dd>
                      </div>
                      <div>
                        <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Conv</dt>
                        <dd className={`text-sm font-bold ${rateTone(r)}`}>{pct(r.conversion_rate)}</dd>
                      </div>
                      <div>
                        <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Last</dt>
                        <dd className={`text-sm font-semibold ${r.is_quiet ? "text-amber-600" : "text-slate-700"}`}>
                          {shortDay(r.last_lead_at)}
                        </dd>
                      </div>
                    </dl>
                  </button>
                ))}
              </div>

              <div className="hidden overflow-x-auto md:block">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-4 py-3">{headBy}</th>
                      <th className="px-4 py-3">{subBy}</th>
                      <th className="px-4 py-3 text-right">Leads</th>
                      <th className="px-4 py-3 text-right">Booked</th>
                      <th className="px-4 py-3 text-right">Conv %</th>
                      <th className="px-4 py-3">Last Lead</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {/* The total, over the rows rather than under them. It is the figure
                        the desk checks first -- "is this table counting all 3,982?" -- and
                        at fifteen sources the foot of the table was a scroll away from the
                        question. Inside the body rather than a second <thead> row so the
                        column headings stay the only thing in the head, and marked off by
                        a heavier rule below it instead of above. */}
                    {totals && (
                      <tr className="border-b-2 border-slate-200 bg-slate-50 font-bold text-slate-800" data-testid="bd-marketing-sources-total">
                        <td className="px-4 py-3">Total</td>
                        <td className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                          {num(totals.rows)} {groupBy === "branch" ? "branches" : groupBy === "source" ? "sources" : "pairings"}
                        </td>
                        <td className="px-4 py-3 text-right">{num(totals.leads)}</td>
                        <td className="px-4 py-3 text-right">{num(totals.booked)}</td>
                        <td className="px-4 py-3 text-right">{pct(totals.conversion_rate)}</td>
                        <td className="px-4 py-3" />
                        <td className="px-4 py-3" />
                      </tr>
                    )}
                    {rows.map((r) => (
                      <tr
                        key={r.key}
                        onClick={() => setDrill(r)}
                        title="Open the leads behind this row"
                        className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                        data-testid={`bd-marketing-sources-row-${r.key}`}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <FileSpreadsheet className="h-4 w-4 shrink-0 text-slate-400" />
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-slate-800">
                                {groupBy === "branch" ? r.branch_name : r.source}
                              </p>
                              {r.source_type && <p className="truncate text-xs text-slate-500">{r.source_type}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          <span className="truncate">{groupBy === "branch" ? r.source : r.branch_name}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-bold text-slate-800">{num(r.leads)}</span>
                          <ShareBar value={r.leads} max={max} />
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-slate-800">{num(r.booked)}</td>
                        <td className={`px-4 py-3 text-right font-bold ${rateTone(r)}`}>{pct(r.conversion_rate)}</td>
                        {/* A sheet that was arriving daily and has been silent a week is
                            almost always a broken sync rather than a dead channel, so the
                            mark says how long rather than just that it is old. */}
                        <td className="px-4 py-3">
                          <span className={`flex items-center gap-1.5 ${r.is_quiet ? "font-semibold text-amber-600" : "text-slate-600"}`}>
                            {r.is_quiet && <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
                            {shortDay(r.last_lead_at)}
                            {r.is_quiet && <span className="text-xs font-normal">· quiet {r.quiet_days}d</span>}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <ChevronRight className="inline h-4 w-4 text-slate-300" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
