import { useCallback, useEffect, useMemo, useState } from "react";
import { Table2, BarChart3 as ChartIcon } from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { getLeadsAnalytics } from "@/lib/api";

/**
 * Marketing Head's leads dashboard — the same leads read four ways.
 *
 * Leads only: no revenue, no session or treatment counts. What a marketing desk asks is
 * how many arrived, where from, and how far they got; putting money on the same screen
 * invites reading a source's worth off charts that never priced anything.
 *
 * Every panel plots one series, so none carries a legend — the panel's own title says what
 * is plotted, and a one-swatch legend would only restate it. Values ride the bar tips
 * where they fit; the line leaves them to the axis and the tooltip. "Numbers" swaps the
 * whole board for tables, so no value is reachable only by hovering.
 */

/* Ink and chrome. Text never wears a series colour — the coloured mark beside it carries
   identity, and these hues are too light to read as type on white. */
const INK = { secondary: "#52514e", muted: "#898781", grid: "#e1e0d9", axis: "#c3c2b7" };

/* Categorical slot 1. One series per chart means one colour per chart — colouring nominal
   bars darker-where-bigger would double-encode the length the bar already shows. */
const SERIES = "#2a78d6";

/* The blue ordinal ramp, light→dark, for the funnel: its stages are an ordered scale, so
   the ramp is the one place a value-ordered colour belongs. Starts at step 250 — nothing
   lighter clears 2:1 against white. Validated for four stages at
   #86b6ef,#5598e7,#2a78d6,#1c5cab (monotone L, visible step gaps, light end 2.11:1). */
const BLUE_STEPS = ["#86b6ef", "#6da7ec", "#5598e7", "#3987e5", "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#104281"];
const ordinalRamp = (n) => {
  if (n <= 1) return [SERIES];
  const step = (BLUE_STEPS.length - 1) / (n - 1);
  return Array.from({ length: n }, (_v, i) => BLUE_STEPS[Math.round(i * step)]);
};

/** "2026-08-17" -> "17 Aug"; "2026-08" -> "Aug 26". Axis ticks, so kept short. */
const shortPeriod = (p) => {
  const parts = String(p || "").split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const m = months[Number(parts[1]) - 1] || "";
  if (parts.length === 3) return `${Number(parts[2])} ${m}`;
  return `${m} ${String(parts[0]).slice(2)}`;
};

const VizTooltip = ({ active, payload, label, labelFormat }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
      <p className="font-semibold text-slate-800">{labelFormat ? labelFormat(label) : label}</p>
      <p className="mt-0.5 text-slate-600">
        {Number(payload[0].value || 0).toLocaleString("en-IN")} lead{payload[0].value === 1 ? "" : "s"}
      </p>
    </div>
  );
};

const Panel = ({ title, sub, children, testid }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-4" data-testid={testid}>
    <p className="text-sm font-semibold text-slate-800">{title}</p>
    {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    <div className="mt-3">{children}</div>
  </div>
);

const EmptyPanel = ({ children }) => (
  <p className="py-10 text-center text-sm text-slate-400">{children}</p>
);

/** The table twin. Every chart has one, so a value is never gated behind a hover. */
const ValueTable = ({ rows, firstHeading, labelFormat }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-sm">
      <thead className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
        <tr>
          <th className="py-1.5 pr-3">{firstHeading}</th>
          <th className="py-1.5 text-right">Leads</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((r) => (
          <tr key={r.name || r.period}>
            <td className="py-1.5 pr-3 text-slate-700">{labelFormat ? labelFormat(r.period) : r.name}</td>
            <td className="py-1.5 text-right font-medium tabular-nums text-slate-800">
              {Number(r.value ?? r.leads ?? 0).toLocaleString("en-IN")}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

/** Horizontal bars: one colour unless an ordinal ramp is passed for an ordered scale. */
const RankedBars = ({ rows, ramp, testid }) => (
  // Height grows with the rows rather than being fixed, so the axis band is never the
  // thing that gets cut off and left in a nested scrollbar.
  <ResponsiveContainer width="100%" height={Math.max(140, rows.length * 34 + 24)}>
    <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 44, bottom: 4, left: 4 }}>
      <CartesianGrid stroke={INK.grid} strokeWidth={1} horizontal={false} />
      <XAxis type="number" hide />
      <YAxis
        type="category"
        dataKey="name"
        width={132}
        tick={{ fill: INK.secondary, fontSize: 11 }}
        tickLine={false}
        axisLine={{ stroke: INK.axis }}
      />
      <Tooltip content={<VizTooltip />} cursor={{ fill: "rgba(11,11,11,0.04)" }} />
      {/* 4px round on the data end, square at the baseline; capped so a wide card leaves
          air in the band instead of one fat block. */}
      <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={false}>
        {rows.map((r, i) => (
          <Cell key={r.name} fill={ramp ? ramp[i] : SERIES} />
        ))}
        {/* At the tip, outside the bar — a short bar has no room inside, and a clipped
            label is worse than none. */}
        <LabelList
          dataKey="value"
          position="right"
          offset={8}
          className="fill-slate-600"
          style={{ fontSize: 11, fontWeight: 600 }}
          formatter={(v) => Number(v || 0).toLocaleString("en-IN")}
        />
      </Bar>
    </BarChart>
  </ResponsiveContainer>
);

export const LeadsAnalyticsDashboard = ({ startDate, endDate, branchIds }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [asTable, setAsTable] = useState(false);

  const branchKey = (branchIds || []).join(",");

  const load = useCallback(() => {
    setLoading(true);
    const params = {};
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;
    if (branchKey) params.branch_ids = branchKey;
    getLeadsAnalytics(params)
      .then((rows) => { setData(rows); setFailed(false); })
      .catch(() => { setData(null); setFailed(true); })
      .finally(() => setLoading(false));
  }, [startDate, endDate, branchKey]);

  useEffect(() => { load(); }, [load]);

  const stageRamp = useMemo(() => ordinalRamp((data?.by_stage || []).length), [data]);

  if (loading && !data) return <p className="py-10 text-center text-sm text-slate-400">Loading…</p>;
  if (failed) {
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-6 text-center text-sm text-amber-800" data-testid="leads-analytics-failed">
        This dashboard could not be loaded. Refresh to try again — if it keeps happening, this account may not have access to the org-wide numbers.
      </p>
    );
  }

  const trend = data?.trend || [];
  const byStage = data?.by_stage || [];
  const bySource = data?.by_source || [];
  const byBranch = data?.by_branch || [];
  const grainLabel = data?.grain === "month" ? "by month" : "by day";

  return (
    // Held at reduced opacity while refetching rather than swapped for a skeleton: the
    // layout stays put and the previous answer stays readable.
    <div className={`space-y-4 transition-opacity ${loading ? "opacity-60" : ""}`} data-testid="leads-analytics-dashboard">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          <span className="font-semibold text-slate-800">{Number(data?.total || 0).toLocaleString("en-IN")}</span>
          {" "}leads in this range
        </p>
        <button
          type="button"
          onClick={() => setAsTable((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
          data-testid="leads-analytics-toggle-table"
        >
          {asTable ? <><ChartIcon className="h-3.5 w-3.5" />Charts</> : <><Table2 className="h-3.5 w-3.5" />Numbers</>}
        </button>
      </div>

      <Panel title="Leads over time" sub={`When they arrived, ${grainLabel}`} testid="leads-analytics-trend">
        {trend.length === 0 ? (
          <EmptyPanel>No leads arrived in this range.</EmptyPanel>
        ) : asTable ? (
          <ValueTable rows={trend} firstHeading={data?.grain === "month" ? "Month" : "Day"} labelFormat={shortPeriod} />
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={trend} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
              <CartesianGrid stroke={INK.grid} strokeWidth={1} vertical={false} />
              <XAxis
                dataKey="period"
                tickFormatter={shortPeriod}
                tick={{ fill: INK.muted, fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: INK.axis }}
                minTickGap={24}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fill: INK.muted, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={40}
              />
              <Tooltip content={<VizTooltip labelFormat={shortPeriod} />} />
              {/* 2px, no dot per point — a marker on every day is noise at this density;
                  the active dot carries the hover instead. */}
              <Line
                type="monotone"
                dataKey="leads"
                stroke={SERIES}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={false}
                activeDot={{ r: 4, fill: SERIES, stroke: "#ffffff", strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Pipeline stages" sub="Where those leads stand now" testid="leads-analytics-stages">
          {byStage.length === 0 ? (
            <EmptyPanel>No stages configured.</EmptyPanel>
          ) : asTable ? (
            <ValueTable rows={byStage} firstHeading="Stage" />
          ) : (
            // Drawn in pipeline order, not by size — a funnel sorted by count stops being
            // a funnel, and an empty stage has to hold its place or the shape misreports
            // where leads are dropping.
            <RankedBars rows={byStage} ramp={stageRamp} testid="leads-analytics-stages-chart" />
          )}
        </Panel>

        <Panel title="Where leads came from" sub="Top sources; the tail is grouped as Other" testid="leads-analytics-sources">
          {bySource.length === 0 ? (
            <EmptyPanel>No sources recorded in this range.</EmptyPanel>
          ) : asTable ? (
            <ValueTable rows={bySource} firstHeading="Source" />
          ) : (
            <RankedBars rows={bySource} testid="leads-analytics-sources-chart" />
          )}
        </Panel>
      </div>

      <Panel title="Leads by branch" sub="Including any not yet assigned to one" testid="leads-analytics-branches">
        {byBranch.length === 0 ? (
          <EmptyPanel>No leads to split by branch.</EmptyPanel>
        ) : asTable ? (
          <ValueTable rows={byBranch} firstHeading="Branch" />
        ) : (
          <RankedBars rows={byBranch} testid="leads-analytics-branches-chart" />
        )}
      </Panel>
    </div>
  );
};

export default LeadsAnalyticsDashboard;
