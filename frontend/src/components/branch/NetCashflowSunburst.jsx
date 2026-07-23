import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Net Cashflow sunburst — Revenue by Category, redesigned as a two-hemisphere
 * multi-ring donut. Top half (teal/blue) is Inflow: Consultation Collections,
 * Session Collections, and Payment Schedules (its own upcoming/partial/overdue
 * breakdown in amber). Bottom half (soft violet/pink) is Outflow/Risk: the
 * Outstanding Amount split into not-yet-due ("Unpaid") and overdue ("Delayed").
 * Center shows Net Cashflow = Total Revenue − Outstanding Amount.
 *
 * Colors are the validated categorical palette (light: #2a78d6 / #1baf7a /
 * #eda100 / #4a3aa7 / #e87ba4 — dark-mode steps in DARK below), chosen to
 * avoid red per the brief. Pending Collections is a headcount, not currency,
 * so it's shown as its own badge rather than forced into the ring's angles.
 */

const LIGHT = {
  consultation: "#2a78d6",
  session: "#1baf7a",
  schedule: "#eda100",
  scheduleLight: "#fbe3ad",
  scheduleDark: "#c9860a",
  unpaid: "#4a3aa7",
  delayed: "#e87ba4",
};

const fmt = (n) => `Rs.${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const pct = (v, total) => (total > 0 ? Math.round((v / total) * 100) : 0);

const polar = (cx, cy, r, angleDeg) => {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
};

// Stroked arc (not a filled wedge) so `stroke-linecap="round"` gives naturally
// rounded segment ends — the donut ring is drawn as a thick circular stroke.
const arcPath = (cx, cy, r, startAngle, endAngle) => {
  const start = polar(cx, cy, r, startAngle);
  const end = polar(cx, cy, r, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
};

// Lay out segments within [rangeStart, rangeEnd] proportional to value, with a
// fixed angular gap between neighbors (the "2px surface gap" translated to arc
// space) — clamped so a tiny segment never inverts into a negative span.
const layoutSegments = (items, rangeStart, rangeEnd, gapDeg) => {
  const total = items.reduce((s, i) => s + i.value, 0);
  if (total <= 0) return items.map((i) => ({ ...i, start: rangeStart, end: rangeStart, pctOf: 0 }));
  const span = rangeEnd - rangeStart;
  let cursor = rangeStart;
  return items.map((item) => {
    const raw = (item.value / total) * span;
    const gap = Math.min(gapDeg, raw / 3);
    const start = cursor + gap / 2;
    const end = cursor + raw - gap / 2;
    cursor += raw;
    return { ...item, start: Math.min(start, end), end: Math.max(start, end), pctOf: pct(item.value, total) };
  });
};

const Segment = ({ cx, cy, r, width, seg, isSelected, onSelect, onHover }) => {
  if (seg.end <= seg.start) return null;
  const mid = (seg.start + seg.end) / 2;
  return (
    <path
      d={arcPath(cx, cy, r, seg.start, seg.end)}
      stroke={seg.color}
      strokeWidth={isSelected ? width + 6 : width}
      strokeLinecap="round"
      fill="none"
      style={{ cursor: "pointer", transition: "stroke-width 120ms ease" }}
      tabIndex={0}
      role="button"
      aria-label={`${seg.label}: ${fmt(seg.value)}, ${seg.pctOf}% of ${seg.groupLabel}`}
      onMouseEnter={() => onHover({ ...seg, mid, r })}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover({ ...seg, mid, r })}
      onBlur={() => onHover(null)}
      onClick={() => onSelect(seg.key)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSelect(seg.key); }}
      data-testid={`cashflow-segment-${seg.key}`}
    />
  );
};

export const NetCashflowSunburst = ({ data, onDrilldown }) => {
  const [hover, setHover] = useState(null);
  const [selected, setSelected] = useState(null);
  const [tableView, setTableView] = useState(false);

  const b = data?.breakdown || {};
  const k = data?.kpis || {};
  const transactions = data?.transactions || [];
  const outstandingClients = data?.outstanding_clients || [];
  const schedule = data?.payment_schedule || [];

  const consultationTotal = Number(b.consultation_revenue) || 0;
  const sessionTotal = Number(b.session_revenue) || 0;
  const scheduleUnpaid = schedule.filter((s) => s.status !== "paid");
  const scheduleTotal = scheduleUnpaid.reduce((s, r) => s + (r.amount || 0), 0);

  const unpaidClients = outstandingClients.filter((c) => c.status !== "overdue");
  const delayedClients = outstandingClients.filter((c) => c.status === "overdue");
  const unpaidTotal = unpaidClients.reduce((s, c) => s + (c.balance || 0), 0);
  const delayedTotal = delayedClients.reduce((s, c) => s + (c.balance || 0), 0);

  const totalRevenue = consultationTotal + sessionTotal;
  const outstandingTotal = unpaidTotal + delayedTotal;
  const netCashflow = totalRevenue - outstandingTotal;
  const pendingCount = k.pending_count || 0;

  const inflow = useMemo(() => layoutSegments(
    [
      { key: "consultation", label: "Consultation Collections", value: consultationTotal, color: LIGHT.consultation, groupLabel: "Inflow" },
      { key: "session", label: "Session Collections", value: sessionTotal, color: LIGHT.session, groupLabel: "Inflow" },
      { key: "schedule", label: "Payment Schedules", value: scheduleTotal, color: LIGHT.schedule, groupLabel: "Inflow" },
    ],
    -90, 90, 3,
  ), [consultationTotal, sessionTotal, scheduleTotal]);

  const outflow = useMemo(() => layoutSegments(
    [
      { key: "unpaid", label: "Unpaid", value: unpaidTotal, color: LIGHT.unpaid, groupLabel: "Outstanding Amount" },
      { key: "delayed", label: "Delayed", value: delayedTotal, color: LIGHT.delayed, groupLabel: "Outstanding Amount" },
    ],
    90, 270, 3,
  ), [unpaidTotal, delayedTotal]);

  // Payment Schedules' own upcoming/partial/overdue breakdown, laid out as a
  // nested micro-ring only spanning that one arc's angular range.
  const scheduleSub = useMemo(() => {
    const scheduleArc = inflow.find((s) => s.key === "schedule");
    if (!scheduleArc || scheduleArc.value <= 0) return [];
    const upcoming = scheduleUnpaid.filter((s) => s.status === "upcoming").reduce((s, r) => s + (r.amount || 0), 0);
    const partial = scheduleUnpaid.filter((s) => s.status === "due_today").reduce((s, r) => s + (r.amount || 0), 0);
    const overdue = scheduleUnpaid.filter((s) => s.status === "overdue").reduce((s, r) => s + (r.amount || 0), 0);
    return layoutSegments(
      [
        { key: "sched_upcoming", label: "Upcoming", value: upcoming, color: LIGHT.scheduleLight, groupLabel: "Payment Schedules" },
        { key: "sched_partial", label: "Partial / Due", value: partial, color: LIGHT.schedule, groupLabel: "Payment Schedules" },
        { key: "sched_overdue", label: "Overdue", value: overdue, color: LIGHT.scheduleDark, groupLabel: "Payment Schedules" },
      ],
      scheduleArc.start, scheduleArc.end, 1.5,
    );
  }, [inflow, scheduleUnpaid]);

  const allSegments = [...inflow, ...outflow];
  const legendGroups = [
    { title: "Inflow", items: inflow },
    { title: "Outstanding Amount (Outflow / Risk)", items: outflow },
  ];

  const drilldownRows = useMemo(() => {
    if (!selected) return null;
    if (selected === "consultation") return { title: "Consultation Collections", rows: transactions.filter((t) => t.source === "consultation").slice(0, 8), kind: "tx" };
    if (selected === "session") return { title: "Session Collections", rows: transactions.filter((t) => t.source === "session").slice(0, 8), kind: "tx" };
    if (selected === "schedule" || selected.startsWith("sched_")) return { title: "Payment Schedules", rows: scheduleUnpaid.slice(0, 8), kind: "schedule" };
    if (selected === "unpaid") return { title: "Outstanding — Unpaid", rows: unpaidClients.slice(0, 8), kind: "client" };
    if (selected === "delayed") return { title: "Outstanding — Delayed", rows: delayedClients.slice(0, 8), kind: "client" };
    return null;
  }, [selected, transactions, scheduleUnpaid, unpaidClients, delayedClients]);

  const cx = 160, cy = 160;
  const r1 = 76;   // inner "Inflow / Outflow" hemisphere ring
  const r2 = 116;  // outer category ring
  const w1 = 28, w2 = 26;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Revenue by Category — Net Cashflow</p>
          <div className="flex items-center gap-2">
            <span className="rounded-[5px] border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700" data-testid="cashflow-pending-badge">
              ⏳ {pendingCount} pending collection{pendingCount === 1 ? "" : "s"}
            </span>
            <button
              type="button"
              onClick={() => setTableView((v) => !v)}
              className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
              data-testid="cashflow-table-toggle"
            >
              {tableView ? "View as chart" : "View as table"}
            </button>
          </div>
        </div>

        {totalRevenue + outstandingTotal === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">No transactions in this range.</p>
        ) : tableView ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/80 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-right">% of group</th>
                </tr>
              </thead>
              <tbody>
                {allSegments.map((s) => (
                  <tr key={s.key} className="border-b border-slate-50">
                    <td className="flex items-center gap-2 px-3 py-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                      {s.label}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-slate-800">{fmt(s.value)}</td>
                    <td className="px-3 py-2 text-right text-slate-500">{s.pctOf}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 md:flex-row md:items-start">
            <div className="relative shrink-0" style={{ width: 320, height: 320 }}>
              <svg viewBox="0 0 320 320" width="100%" height="100%" role="img" aria-label="Net cashflow sunburst chart">
                {/* Inner hemisphere wash rings */}
                <path d={arcPath(cx, cy, r1, -89, 89)} stroke={LIGHT.consultation} strokeOpacity={0.14} strokeWidth={w1} strokeLinecap="round" fill="none" />
                <path d={arcPath(cx, cy, r1, 91, 269)} stroke={LIGHT.unpaid} strokeOpacity={0.14} strokeWidth={w1} strokeLinecap="round" fill="none" />

                {/* Outer category ring */}
                {inflow.map((seg) => (
                  <Segment key={seg.key} cx={cx} cy={cy} r={r2} width={w2} seg={seg} isSelected={selected === seg.key} onSelect={setSelected} onHover={setHover} />
                ))}
                {outflow.map((seg) => (
                  <Segment key={seg.key} cx={cx} cy={cy} r={r2} width={w2} seg={seg} isSelected={selected === seg.key} onSelect={setSelected} onHover={setHover} />
                ))}
                {/* Payment Schedules' own upcoming/partial/overdue micro-ring, one step further out */}
                {scheduleSub.map((seg) => (
                  <Segment key={seg.key} cx={cx} cy={cy} r={r2 + 18} width={12} seg={seg} isSelected={selected === seg.key} onSelect={setSelected} onHover={setHover} />
                ))}

                <text x={cx} y={cy - 44} textAnchor="middle" className="fill-slate-400" style={{ fontSize: 10, letterSpacing: "0.05em" }}>INFLOW</text>
                <text x={cx} y={cy + 52} textAnchor="middle" className="fill-slate-400" style={{ fontSize: 10, letterSpacing: "0.05em" }}>OUTFLOW / RISK</text>
              </svg>

              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Live Financial Status</p>
                <p className={`text-2xl font-bold ${netCashflow >= 0 ? "text-slate-800" : "text-amber-700"}`}>{fmt(netCashflow)}</p>
                <p className="text-[10px] text-slate-400">Net Cashflow</p>
              </div>

              {hover && (
                <div
                  className="pointer-events-none absolute z-10 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-md"
                  style={{
                    left: `${(polar(160, 160, hover.r + 30, hover.mid).x / 320) * 100}%`,
                    top: `${(polar(160, 160, hover.r + 30, hover.mid).y / 320) * 100}%`,
                    transform: "translate(-50%, -50%)",
                  }}
                  data-testid="cashflow-tooltip"
                >
                  <p className="font-semibold text-slate-800">{fmt(hover.value)}</p>
                  <p className="text-slate-500">{hover.label} · {hover.pctOf}%</p>
                </div>
              )}
            </div>

            <div className="flex-1 space-y-3">
              {legendGroups.map((g) => (
                <div key={g.title}>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{g.title}</p>
                  <div className="space-y-1">
                    {g.items.map((s) => (
                      <button
                        key={s.key}
                        type="button"
                        onClick={() => setSelected(s.key)}
                        className={`flex w-full items-center justify-between rounded-md px-2 py-1 text-xs transition ${selected === s.key ? "bg-slate-100" : "hover:bg-slate-50"}`}
                        data-testid={`cashflow-legend-${s.key}`}
                      >
                        <span className="flex items-center gap-2 text-slate-600">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                          {s.label}
                        </span>
                        <span className="font-semibold text-slate-800">{fmt(s.value)} <span className="font-normal text-slate-400">({s.pctOf}%)</span></span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}

              {drilldownRows && (
                <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                  <div className="mb-1.5 flex items-center justify-between">
                    <p className="text-xs font-semibold text-slate-700">{drilldownRows.title}</p>
                    <button type="button" onClick={() => setSelected(null)} className="text-[11px] text-slate-400 hover:text-slate-600">Close</button>
                  </div>
                  {drilldownRows.rows.length === 0 ? (
                    <p className="text-xs text-slate-400">Nothing in this range.</p>
                  ) : (
                    <div className="space-y-1">
                      {drilldownRows.rows.map((r, i) => (
                        <div key={r.id || r.lead_id || i} className="flex items-center justify-between text-xs">
                          <span className="text-slate-600">{r.client_name || "Unknown"}</span>
                          <span className="font-medium text-slate-700">{fmt(r.gross ?? r.amount ?? r.balance)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {onDrilldown && (
                    <button type="button" onClick={() => onDrilldown(selected)} className="mt-2 text-[11px] font-medium text-sky-600 hover:underline">
                      Open full report →
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default NetCashflowSunburst;
