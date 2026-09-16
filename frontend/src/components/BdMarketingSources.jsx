import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronRight, FileSpreadsheet, Layers } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/components/ui/sonner";
import { getMarketingSources } from "@/lib/api";
// The reader that turns the toolbar's All/Offline/Online + branch pick into the ids an
// endpoint takes. DashboardBoard's own -- imported rather than rebuilt so this table is
// scoped by exactly the control the cards it replaced were scoped by, and a branch means
// the same thing on both.
import { resolveBranchIds } from "@/components/DashboardBoard";
// The leads behind whichever row gets clicked.
import { BdMarketingList } from "@/components/BdMarketingList";

/* ─── Grouping ─── */

// The two tabs this table draws, and the three groupings each offers. Keys match
// BREAKDOWN_GROUPINGS in backend/routers/v3_dashboard.py; the server does the grouping,
// this only names it.
//
// Marketing opens on Source because that is the marketing question -- a sheet is a thing
// somebody set up and can go and fix. Sales opens on Stage, which is the funnel as a
// table. Branch is either of them read from the other end. The pairing comes last in both
// because it is the longest -- roughly rows x branches -- and it answers a question you
// only ask once the first two have raised it.
export const BREAKDOWN_MODES = {
  marketing: {
    groupings: [
      { key: "source", label: "Source", hint: "One row per sheet or form" },
      { key: "branch", label: "Branch", hint: "One row per branch, whatever fed it" },
      { key: "source_branch", label: "Source × Branch", hint: "What each sheet did for each branch" },
    ],
    heads: { source: "Source", branch: "Branch", source_branch: "Source" },
    subHeads: { source: "Branch", branch: "Fed by", source_branch: "Branch" },
    units: { source: "sources", branch: "branches", source_branch: "pairings" },
    icon: FileSpreadsheet,
    failed: "Failed to load Marketing",
  },
  sales: {
    groupings: [
      { key: "stage", label: "Stage", hint: "One row per pre-sales stage" },
      { key: "branch", label: "Branch", hint: "One row per branch, whatever stage its leads sit on" },
      { key: "stage_branch", label: "Stage × Branch", hint: "Where each branch's leads are stuck" },
    ],
    heads: { stage: "Stage", branch: "Branch", stage_branch: "Stage" },
    subHeads: { stage: "Branch", branch: "Mostly from", stage_branch: "Branch" },
    units: { stage: "stages", branch: "branches", stage_branch: "pairings" },
    icon: Layers,
    failed: "Failed to load Sales",
  },
};

/* ─── Cells ─── */

const pct = (n) => `${(n ?? 0).toFixed(1)}%`;
const num = (n) => (n ?? 0).toLocaleString("en-IN");

/** "16 Sep" — the day a row last carried anything, in the form a date is read on a line
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

/* ─── The table ─── */

/**
 * Business Development > Dashboard > Marketing and Sales — every source (or stage, or
 * branch) in the range as a row, with the leads behind any one of them a click away.
 *
 * Both tabs used to be Super Admin's: a row of StatTiles counting leads per channel or per
 * stage, capped at six with the rest folded into one "Other" tile. Two problems with that,
 * and this table is the answer to both. The cap meant the rows a desk most needs to check
 * on — the small and the newly broken — were precisely the ones with no name on screen.
 * And a count on its own ranks by a size the desk already knows; what it cannot see from a
 * tile is that 1,387 leads produced nine bookings.
 *
 * Every scoping control lives on the board's one toolbar row, not in here: the range, the
 * All/Offline/Online split, the branch and the grouping all arrive as props. This owns the
 * fetch, the table, and which row is open — nothing that another control on that row could
 * disagree with.
 *
 * Only this desk's two tabs change. Super Admin's own Dashboard > Marketing and > Sales
 * still draw the tiles, out of the same unchanged DashboardTabPanel.
 *
 * @param mode       "marketing" or "sales" — which of BREAKDOWN_MODES to draw
 * @param branches   every branch, from useDashboardData
 * @param dateParams the board's date range, in the two params the BD endpoints take
 * @param group      the toolbar's All/Offline/Online pick
 * @param branchId   the toolbar's branch pick, or "" for the whole group
 * @param groupBy    which of this mode's three groupings is pressed
 * @param search     the toolbar's search box, applied here over the rows on screen
 * @param rangeLabel the range in words, for the caption over the table
 * @param onOpenLead opens a lead in Sales View's own popup, from the drill-down list
 */
export const BdMarketingSources = ({
  mode = "marketing", branches, dateParams, group, branchId, groupBy, search = "", rangeLabel, onOpenLead,
}) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  // Which row is open, or null for the table. Held as the whole row rather than as its
  // key: the drill-down needs the labels and all three filters, and looking them back up
  // out of a list that may have been re-fetched since is how a header ends up naming a
  // different sheet from the one the rows came from.
  const [drill, setDrill] = useState(null);

  const spec = BREAKDOWN_MODES[mode] || BREAKDOWN_MODES.marketing;
  const RowIcon = spec.icon;

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
      .catch(() => { if (!cancelled) { toast.error(spec.failed); setData(null); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [dateParams, branchParam, groupBy, spec.failed]);

  // Changing the scope closes the open row. Those leads were asked for under the filters
  // in force when the row was clicked, and leaving the list up under a new range would
  // have it headed by a figure that no longer counts what it is sitting over.
  useEffect(() => { setDrill(null); }, [dateParams, branchParam, groupBy]);

  const sent = useMemo(() => data?.rows || [], [data]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sent;
    return sent.filter((r) => [r.label, r.sub_label, r.source_type]
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

  // What the open row hands the lead list: the same scope the row was counted under. The
  // server cleared whichever of source/stage/branch the row spans several of, so passing
  // them straight through cannot over-narrow -- a row headed "9 sources" carries no source
  // to filter by, which is exactly the bug that guards against.
  const drillParams = useMemo(() => {
    if (!drill) return null;
    const out = { ...branchParam };
    if (drill.branch_id) out.branch_id = drill.branch_id;
    if (drill.source) out.source_tab = drill.source;
    if (drill.stage) out.stage = drill.stage;
    return out;
  }, [drill, branchParam]);

  if (drill) {
    return (
      <BdMarketingList
        branches={branches}
        dateParams={dateParams}
        params={drillParams}
        search={search}
        title={drill.label}
        subtitle={`${drill.sub_label} · ${num(drill.leads)} leads · ${num(drill.booked)} booked`}
        onBack={() => setDrill(null)}
        onOpenLead={onOpenLead}
      />
    );
  }

  const unit = spec.units[groupBy] || "rows";

  return (
    <Card data-testid={`bd-breakdown-${mode}`}>
      <CardContent className="p-0">
        {/* The range in words, over the table it scopes. Said once here rather than as a
            column on every row: every row spans the same window, and the one date that
            differs per row has a column of its own. */}
        <p className="border-b border-slate-100 px-3 py-2 text-xs text-slate-500" data-testid="bd-breakdown-caption">
          {rangeLabel}
          {totals && ` · ${num(totals.rows)} ${unit} · ${num(totals.leads)} leads`}
        </p>

        {loading ? (
          <p className="px-3 py-16 text-center text-sm text-slate-400" data-testid="bd-breakdown-loading">Loading...</p>
        ) : rows.length === 0 ? (
          <p className="px-3 py-16 text-center text-sm text-slate-400" data-testid="bd-breakdown-empty">
            {sent.length === 0 ? "No leads in this range." : "Nothing here matches the search."}
          </p>
        ) : (
          <>
            {/* Phone: the same row stacked. Eight columns on a 360px screen is a table
                nobody reads, but the four figures are short enough to sit as a strip
                under the name. */}
            <div className="space-y-2 p-3 md:hidden" data-testid="bd-breakdown-mobile">
              {totals && (
                <div className="rounded-xl border-2 border-slate-200 bg-slate-50 p-3" data-testid="bd-breakdown-total-mobile">
                  <p className="text-sm font-bold text-slate-800">Total</p>
                  <p className="text-xs text-slate-500">{num(totals.rows)} {unit}</p>
                  {/* Three, not the rows' four: a "last lead" across every row is the
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
                  data-testid={`bd-breakdown-card-${r.key}`}
                >
                  <div className="flex items-start gap-2">
                    <RowIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-slate-800">{r.label}</p>
                      <p className="truncate text-xs text-slate-500">{r.sub_label}</p>
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
                    <th className="px-4 py-3">{spec.heads[groupBy]}</th>
                    <th className="px-4 py-3">{spec.subHeads[groupBy]}</th>
                    <th className="px-4 py-3 text-right">Leads</th>
                    {/* Its own column, not a bar tucked under the count. Stacked, the two
                        read as one cell whose number had a decoration, and the bar could
                        not be scanned down the table without the figures interrupting it.
                        Apart, Leads is a column of numbers to compare and Share is a column
                        of lengths to rank -- which is the one thing a bar is good at. */}
                    <th className="px-4 py-3">Share</th>
                    <th className="px-4 py-3 text-right">Booked</th>
                    <th className="px-4 py-3 text-right">Conv %</th>
                    <th className="px-4 py-3">Last Lead</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {/* The total, over the rows rather than under them. It is the figure the
                      desk checks first -- "is this table counting all 3,982?" -- and at
                      fifteen rows the foot of the table was a scroll away from the
                      question. Inside the body rather than a second <thead> row so the
                      column headings stay the only thing in the head, and marked off by a
                      heavier rule below it instead of above. */}
                  {totals && (
                    <tr className="border-b-2 border-slate-200 bg-slate-50 font-bold text-slate-800" data-testid="bd-breakdown-total">
                      <td className="px-4 py-3">Total</td>
                      <td className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                        {num(totals.rows)} {unit}
                      </td>
                      <td className="px-4 py-3 text-right">{num(totals.leads)}</td>
                      <td className="px-4 py-3" />
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
                      data-testid={`bd-breakdown-row-${r.key}`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <RowIcon className="h-4 w-4 shrink-0 text-slate-400" />
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-slate-800">{r.label}</p>
                            {r.source_type && <p className="truncate text-xs text-slate-500">{r.source_type}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        <span className="truncate">{r.sub_label}</span>
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-slate-800">{num(r.leads)}</td>
                      {/* Lengths against the biggest row, not against the total: the
                          largest source here is a third of everything, so bars drawn as a
                          share of the whole would leave every other row a sliver and the
                          column would rank nothing. The percentage beside it IS of the
                          total, because that is the figure somebody would quote. */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="block h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-slate-100 lg:w-24">
                            <span
                              className="block h-full rounded-full bg-sky-500"
                              style={{ width: `${max ? Math.max(2, (r.leads / max) * 100) : 0}%` }}
                            />
                          </span>
                          <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-500">
                            {totals?.leads ? pct((r.leads / totals.leads) * 100) : "—"}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-slate-800">{num(r.booked)}</td>
                      <td className={`px-4 py-3 text-right font-bold ${rateTone(r)}`}>{pct(r.conversion_rate)}</td>
                      {/* A source that was arriving daily and has been silent a week is
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
  );
};
