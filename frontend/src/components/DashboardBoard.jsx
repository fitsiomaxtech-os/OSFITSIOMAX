import { useEffect, useMemo, useState } from "react";
import { Calendar as CalendarIcon, Users, CalendarCheck, Activity, IndianRupee } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { toast } from "@/components/ui/sonner";
import { getDashboardOverview } from "@/lib/api";

const DASH_TABS = [
  { key: "leads", label: "Leads", icon: Users },
  { key: "appointments", label: "Appointments", icon: CalendarCheck },
  { key: "treatments", label: "Treatments", icon: Activity },
  { key: "revenue", label: "Revenue", icon: IndianRupee },
];

const startOfDay = (d) => { const n = new Date(d); n.setHours(0, 0, 0, 0); return n; };
const toIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtShort = (d) => d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });

// A real Monday→Sunday calendar week, not a rolling last-7-days window.
const mondayOf = (d) => {
  const n = startOfDay(d);
  const day = n.getDay(); // 0 = Sun .. 6 = Sat
  n.setDate(n.getDate() + (day === 0 ? -6 : 1 - day));
  return n;
};
const sundayOf = (d) => { const m = mondayOf(d); const n = new Date(m); n.setDate(n.getDate() + 6); return n; };

const DATE_PRESETS = [
  { key: "today", label: "Today", range: () => { const t = startOfDay(new Date()); return { from: t, to: t }; } },
  { key: "week", label: "Week (Mon-Sun)", range: () => ({ from: mondayOf(new Date()), to: sundayOf(new Date()) }) },
  { key: "month", label: "Month", range: () => { const t = new Date(); return { from: new Date(t.getFullYear(), t.getMonth(), 1), to: new Date(t.getFullYear(), t.getMonth() + 1, 0) }; } },
];

const fmtValue = (tabKey, value) => (tabKey === "revenue" ? `₹${(value || 0).toLocaleString("en-IN")}` : value);

// Super Admin's new default landing page — Leads / Appointments / Treatments / Revenue,
// each scoped to a date range and split into the Physiotherapy branches (2x2) plus one
// card per other vertical (Offline Fitness, Online Physiotherapy, Online Fitness).
export const DashboardBoard = () => {
  const [preset, setPreset] = useState("today");
  const [customRange, setCustomRange] = useState(null); // { from, to } | null
  const [customOpen, setCustomOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("leads");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const range = useMemo(() => {
    if (preset === "custom" && customRange?.from) {
      return { from: startOfDay(customRange.from), to: startOfDay(customRange.to || customRange.from) };
    }
    return (DATE_PRESETS.find((p) => p.key === preset) || DATE_PRESETS[0]).range();
  }, [preset, customRange]);

  useEffect(() => {
    setLoading(true);
    getDashboardOverview({ start_date: toIso(range.from), end_date: toIso(range.to) })
      .then(setData)
      .catch(() => toast.error("Failed to load dashboard"))
      .finally(() => setLoading(false));
  }, [range]);

  const activeData = data?.[activeTab];
  const customLabel = preset === "custom" && customRange?.from
    ? (customRange.to && toIso(customRange.to) !== toIso(customRange.from) ? `${fmtShort(range.from)} - ${fmtShort(range.to)}` : fmtShort(range.from))
    : null;

  return (
    <div className="space-y-4" data-testid="dashboard-board">
      <div className="hidden md:block">
        <h2 className="text-2xl font-bold text-slate-900">Dashboard</h2>
        <p className="text-sm text-slate-500">Leads, appointments, treatments and revenue across every branch and vertical.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2" data-testid="dashboard-date-filter">
        {DATE_PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPreset(p.key)}
            className={`rounded-md px-3 py-2 text-sm font-medium transition ${preset === p.key ? "bg-sky-600 text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
            data-testid={`dashboard-preset-${p.key}`}
          >
            {p.label}
          </button>
        ))}
        <Popover open={customOpen} onOpenChange={setCustomOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              onClick={() => setPreset("custom")}
              title="Custom date range"
              aria-label="Custom date range"
              className={`flex h-9 w-9 items-center justify-center rounded-md border transition ${preset === "custom" ? "border-sky-300 bg-sky-50 text-sky-600" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}
              data-testid="dashboard-preset-custom"
            >
              <CalendarIcon className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start" data-testid="dashboard-custom-panel">
            <Calendar
              mode="range"
              selected={customRange || undefined}
              onSelect={(r) => { setCustomRange(r); if (r?.from && r?.to) setCustomOpen(false); }}
              initialFocus
              data-testid="dashboard-custom-calendar"
            />
          </PopoverContent>
        </Popover>
        {customLabel && (
          <span className="rounded-md bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-700">{customLabel}</span>
        )}
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

      {loading || !activeData ? (
        <p className="py-16 text-center text-sm text-slate-400">{loading ? "Loading..." : "No data."}</p>
      ) : (
        <div className="space-y-4">
          {activeTab === "revenue" && (
            <Card className="border-emerald-200 bg-emerald-50/60" data-testid="dashboard-total-revenue">
              <CardContent className="p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">Total Revenue</p>
                <p className="mt-1 text-3xl font-bold text-emerald-700">{fmtValue("revenue", activeData.total)}</p>
              </CardContent>
            </Card>
          )}

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Physiotherapy Branches</p>
            <div className="grid grid-cols-2 gap-3">
              {activeData.physio_branches.map((b) => (
                <Card key={b.branch_id} data-testid={`dashboard-physio-${b.branch_id}`}>
                  <CardContent className="p-4">
                    <p className="truncate text-sm font-semibold text-slate-700">{b.branch_name}</p>
                    <p className="mt-1 text-2xl font-bold text-sky-600">{fmtValue(activeTab, b.value)}</p>
                  </CardContent>
                </Card>
              ))}
              {activeData.physio_branches.length === 0 && (
                <p className="col-span-2 rounded-xl border border-dashed border-slate-200 py-6 text-center text-sm text-slate-400">
                  No Physiotherapy branches yet.
                </p>
              )}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Other Verticals</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {activeData.verticals.map((v) => (
                <Card key={v.vertical} data-testid={`dashboard-vertical-${v.vertical}`}>
                  <CardContent className="p-4">
                    <p className="truncate text-sm font-semibold text-slate-700">{v.label}</p>
                    <p className="mt-1 text-2xl font-bold text-indigo-600">{fmtValue(activeTab, v.value)}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
