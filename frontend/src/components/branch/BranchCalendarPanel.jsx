import { useCallback, useEffect, useMemo, useState } from "react";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Clock, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getBranches, getBranchBoard } from "@/lib/api";

// weekly_hours is keyed mon..sun; JS getDay() is 0=Sun..6=Sat.
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Monday that starts the week containing `date`.
const mondayOf = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay(); // 0 Sun..6 Sat
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
  return d;
};

// The branch Calendar reflects the working hours + holidays configured by Super Admin
// in Branch Management, and overlays this branch's booked appointments on top.
export const BranchCalendarPanel = ({ branchId }) => {
  const [branch, setBranch] = useState(null);
  const [leads, setLeads] = useState([]);
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [loading, setLoading] = useState(false);
  const [subTab, setSubTab] = useState("schedule");

  const load = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    try {
      const [branches, board] = await Promise.all([getBranches(), getBranchBoard(branchId)]);
      setBranch((branches || []).find((b) => b.id === branchId) || null);
      setLeads(board?.leads || []);
    } catch { /* silent — panel just shows empty schedule */ }
    setLoading(false);
  }, [branchId]);

  useEffect(() => { load(); }, [load]);

  const weekly = branch?.weekly_hours || {};
  const holidays = branch?.holidays || [];

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return d; }),
    [weekStart],
  );

  const apptsByDate = useMemo(() => {
    const map = {};
    (leads || []).forEach((l) => {
      if (!l.appointment_date) return;
      (map[l.appointment_date] = map[l.appointment_date] || []).push(l);
    });
    Object.values(map).forEach((arr) => arr.sort((a, b) => (a.appointment_time || "").localeCompare(b.appointment_time || "")));
    return map;
  }, [leads]);

  // Upcoming = appointments dated today or later, grouped by date (ascending).
  const upcomingGroups = useMemo(() => {
    const today = iso(new Date());
    const map = {};
    (leads || []).forEach((l) => {
      if (!l.appointment_date || l.appointment_date < today) return;
      (map[l.appointment_date] = map[l.appointment_date] || []).push(l);
    });
    const dates = Object.keys(map).sort();
    dates.forEach((d) => map[d].sort((a, b) => (a.appointment_time || "").localeCompare(b.appointment_time || "")));
    return dates.map((d) => ({ date: d, items: map[d] }));
  }, [leads]);

  const todayIso = iso(new Date());
  const shiftWeek = (delta) => { const d = new Date(weekStart); d.setDate(d.getDate() + delta * 7); setWeekStart(d); };
  const rangeLabel = `${MONTHS[days[0].getMonth()]} ${days[0].getDate()} – ${MONTHS[days[6].getMonth()]} ${days[6].getDate()}, ${days[6].getFullYear()}`;

  return (
    <div className="space-y-4" data-testid="branch-calendar-panel">
      <div>
        <h2 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><CalendarIcon className="h-6 w-6 text-sky-600" /> Calendar</h2>
        <p className="text-sm text-slate-500">Weekly schedule from the Super Admin → Branch Management setup, with appointments overlaid.</p>
      </div>

      {/* Sub-tabs */}
      <div className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-1" data-testid="cal-subtabs">
        <button type="button" onClick={() => setSubTab("schedule")} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${subTab === "schedule" ? "bg-sky-50 text-sky-600" : "text-slate-600 hover:bg-slate-50"}`} data-testid="cal-subtab-schedule">
          <CalendarIcon className="h-4 w-4" />Schedule
        </button>
        <button type="button" onClick={() => setSubTab("upcoming")} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${subTab === "upcoming" ? "bg-sky-50 text-sky-600" : "text-slate-600 hover:bg-slate-50"}`} data-testid="cal-subtab-upcoming">
          <Clock className="h-4 w-4" />Upcoming Appointments
        </button>
      </div>

      {subTab === "schedule" ? (
      <>
      <div className="flex items-center justify-end gap-2">
        <Button size="sm" variant="outline" onClick={() => shiftWeek(-1)} data-testid="cal-prev-week"><ChevronLeft className="h-4 w-4" /></Button>
        <Button size="sm" variant="outline" onClick={() => setWeekStart(mondayOf(new Date()))} data-testid="cal-this-week">This Week</Button>
        <Button size="sm" variant="outline" onClick={() => shiftWeek(1)} data-testid="cal-next-week"><ChevronRight className="h-4 w-4" /></Button>
      </div>

      <p className="text-sm font-semibold text-slate-600" data-testid="cal-range-label">{rangeLabel}</p>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-7" data-testid="cal-week-grid">
        {days.map((d) => {
          const dateStr = iso(d);
          const dowIdx = d.getDay();
          const cfg = weekly[DAY_KEYS[dowIdx]];
          const isHoliday = holidays.includes(dateStr);
          const isOpen = cfg ? cfg.is_open !== false : true;
          const isToday = dateStr === todayIso;
          const appts = apptsByDate[dateStr] || [];
          return (
            <div
              key={dateStr}
              className={`flex min-h-[160px] flex-col overflow-hidden rounded-lg border ${isToday ? "border-sky-400 ring-1 ring-sky-200" : "border-slate-200"} bg-white`}
              data-testid={`cal-day-${dateStr}`}
            >
              <div className={`px-2 py-1.5 text-center ${isHoliday ? "bg-rose-50" : isOpen ? "bg-slate-50" : "bg-slate-100"}`}>
                <p className="text-[11px] font-semibold uppercase text-slate-500">{DAY_LABELS[dowIdx]}</p>
                <p className={`text-sm font-bold ${isToday ? "text-sky-700" : "text-slate-700"}`}>{d.getDate()}</p>
              </div>
              <div className="flex-1 space-y-1.5 p-1.5">
                {isHoliday ? (
                  <p className="rounded-md bg-rose-50 px-2 py-1 text-center text-[11px] font-semibold text-rose-500">Holiday</p>
                ) : !isOpen ? (
                  <p className="rounded-md bg-slate-50 px-2 py-1 text-center text-[11px] font-medium text-slate-400">Closed</p>
                ) : (
                  <>
                    <p className="flex items-center justify-center gap-1 text-[10px] text-slate-400">
                      <Clock className="h-3 w-3" />{cfg?.open || "09:00"}–{cfg?.close || "20:00"}
                    </p>
                    {appts.length === 0 ? (
                      <p className="pt-2 text-center text-[10px] text-slate-300">No appointments</p>
                    ) : (
                      appts.map((a) => (
                        <div key={a.id} className="rounded-md border border-sky-200 bg-sky-50 px-2 py-1" data-testid={`cal-appt-${a.id}`}>
                          <p className="text-[11px] font-bold text-sky-700">{a.appointment_time || "--:--"}</p>
                          <p className="truncate text-[11px] font-medium text-slate-700" title={a.name}>{a.name || "—"}</p>
                          {a.assigned_physio_name && (
                            <p className="flex items-center gap-0.5 truncate text-[10px] text-slate-400">
                              <User className="h-2.5 w-2.5" />{a.assigned_physio_name}
                            </p>
                          )}
                        </div>
                      ))
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      </>
      ) : (
      <div className="space-y-4" data-testid="cal-upcoming-list">
        {upcomingGroups.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 px-3 py-8 text-center text-sm text-slate-400">No upcoming appointments.</p>
        ) : (
          upcomingGroups.map((g) => (
            <div key={g.date} data-testid={`cal-upcoming-${g.date}`}>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                {new Date(g.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" })}
              </p>
              <div className="space-y-1.5">
                {g.items.map((a) => (
                  <div key={a.id} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2" data-testid={`cal-upcoming-appt-${a.id}`}>
                    <div className="flex w-16 shrink-0 flex-col items-center rounded-md bg-sky-50 py-1">
                      <Clock className="h-3 w-3 text-sky-500" />
                      <span className="text-xs font-bold text-sky-700">{a.appointment_time || "--:--"}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-800" title={a.name}>{a.name || "—"}</p>
                      {a.assigned_physio_name && (
                        <p className="flex items-center gap-1 truncate text-xs text-slate-500"><User className="h-3 w-3" />{a.assigned_physio_name}</p>
                      )}
                    </div>
                    {a.branch_stage && <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">{a.branch_stage}</span>}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
      )}

      {loading && <p className="text-center text-xs text-slate-400">Loading…</p>}
      {!loading && !branch && (
        <p className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-sm text-slate-400">
          No branch schedule found. Ask a Super Admin to set working hours &amp; holidays in Branch Management.
        </p>
      )}
    </div>
  );
};
