import { useEffect, useState } from "react";
import { Users, CalendarCheck, Activity, IndianRupee } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { DateFilterPopover } from "@/components/DateFilterPopover";
import { toast } from "@/components/ui/sonner";
import { getDashboardOverview } from "@/lib/api";

const DASH_TABS = [
  { key: "leads", label: "Leads", icon: Users },
  { key: "appointments", label: "Appointments", icon: CalendarCheck },
  { key: "treatments", label: "Treatments", icon: Activity },
  { key: "revenue", label: "Revenue", icon: IndianRupee },
];

const startOfDay = (d) => { const n = new Date(d); n.setHours(0, 0, 0, 0); return n; };
const endOfDay = (d) => { const n = new Date(d); n.setHours(23, 59, 59, 999); return n; };
const toIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// The Dashboard always reports over some range — the overview endpoint takes a start and
// an end, and there is no "all time" to fall back to. So the shared filter's cleared
// state (null) resolves back to Today rather than leaving the board with no range and
// the cards reading from whatever was last fetched.
const todayFilter = () => {
  const t = new Date();
  return { key: "today", label: "Today", from: startOfDay(t), to: endOfDay(t) };
};

const fmtValue = (tabKey, value) => (tabKey === "revenue" ? `₹${(value || 0).toLocaleString("en-IN")}` : value);

// Super Admin's new default landing page — Leads / Appointments / Treatments / Revenue,
// each scoped to a date range and split into the Physiotherapy branches (2x2) plus one
// card per other vertical (Offline Fitness, Online Physiotherapy, Online Fitness).
export const DashboardBoard = () => {
  const [dateFilter, setDateFilter] = useState(todayFilter);
  const [activeTab, setActiveTab] = useState("leads");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    getDashboardOverview({ start_date: toIso(dateFilter.from), end_date: toIso(dateFilter.to) })
      .then(setData)
      .catch(() => toast.error("Failed to load dashboard"))
      .finally(() => setLoading(false));
  }, [dateFilter]);

  const activeData = data?.[activeTab];

  return (
    <div className="space-y-4" data-testid="dashboard-board">
      <div className="hidden md:block">
        <h2 className="text-2xl font-bold text-slate-900">Dashboard</h2>
        <p className="text-sm text-slate-500">Leads, appointments, treatments and revenue across every branch and vertical.</p>
      </div>

      {/* The same Date Filter every other board carries, rather than this board's own
          preset buttons plus a raw react-day-picker popup — the one calendar in the OS
          that still looked like the library's default. Its presets differ slightly from
          the buttons they replace: Today and This Month carry over, Week (Mon-Sun) has
          no equivalent and is picked through Custom Range instead. */}
      <div className="flex flex-wrap items-center gap-2" data-testid="dashboard-date-filter">
        <DateFilterPopover
          value={dateFilter}
          onChange={(next) => setDateFilter(next || todayFilter())}
          testid="dashboard-date-filter-popover"
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
