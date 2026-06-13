import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, CalendarDays, User, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { getCalendarAvailability, getDaySlots, getExpertCalendar, getDoctors } from "@/lib/api";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const WEEK = ["Su","Mo","Tu","We","Th","Fr","Sa"];

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

export const SmartBookingPicker = ({ branchId, value, onChange }) => {
  // value = { appointment_date, appointment_time, physio_id }
  const [mode, setMode] = useState("slot"); // "slot" | "expert"
  const [cursor, setCursor] = useState(() => new Date());
  const [calendar, setCalendar] = useState(null);
  const [daySlots, setDaySlots] = useState(null);
  const [experts, setExperts] = useState([]);
  const [pickedExpert, setPickedExpert] = useState(null);
  const [expertCal, setExpertCal] = useState(null);
  const [loading, setLoading] = useState(false);

  const monthStr = ym(cursor);

  const fetchCalendar = useCallback(async (b, ms) => {
    if (!b) return;
    setLoading(true);
    try { const res = await getCalendarAvailability(b, ms); setCalendar(res); }
    catch { toast.error("Failed to load calendar"); }
    finally { setLoading(false); }
  }, []);

  const fetchDaySlots = useCallback(async (b, d) => {
    if (!b || !d) { setDaySlots(null); return; }
    try { const res = await getDaySlots(b, d); setDaySlots(res); } catch { setDaySlots(null); }
  }, []);

  const fetchExperts = useCallback(async (b) => {
    try { const all = await getDoctors({ branch_id: b }); setExperts(all && all.length ? all : []); }
    catch { setExperts([]); }
  }, []);

  const fetchExpertCal = useCallback(async (eid, ms) => {
    if (!eid) { setExpertCal(null); return; }
    setLoading(true);
    try { const res = await getExpertCalendar(eid, ms); setExpertCal(res); }
    catch { toast.error("Failed to load expert calendar"); }
    finally { setLoading(false); }
  }, []);

  // ---- Find a Slot flow ----
  useEffect(() => {
    if (mode !== "slot" || !branchId) return;
    fetchCalendar(branchId, monthStr);
  }, [mode, branchId, monthStr, fetchCalendar]);

  useEffect(() => {
    if (mode !== "slot" || !branchId || !value?.appointment_date) { setDaySlots(null); return; }
    fetchDaySlots(branchId, value.appointment_date);
  }, [mode, branchId, value?.appointment_date, fetchDaySlots]);

  // ---- Find an Expert flow ----
  useEffect(() => {
    if (mode !== "expert" || !branchId) return;
    fetchExperts(branchId);
  }, [mode, branchId, fetchExperts]);

  useEffect(() => {
    if (mode !== "expert" || !pickedExpert) { setExpertCal(null); return; }
    fetchExpertCal(pickedExpert.id, monthStr);
  }, [mode, pickedExpert, monthStr, fetchExpertCal]);

  const grid = useMemo(() => buildMonthGrid(cursor), [cursor]);

  const onPickDate = (date) => {
    onChange({ ...(value || {}), appointment_date: date, appointment_time: "", physio_id: "" });
  };
  const onPickTime = (time, fallbackPhysio = "") => {
    onChange({ ...(value || {}), appointment_time: time, physio_id: fallbackPhysio });
  };
  const onPickExpert = (eid) => {
    onChange({ ...(value || {}), physio_id: eid });
  };

  return (
    <div className="space-y-3" data-testid="smart-booking-picker">
      {/* Top toggle */}
      <div className="flex items-center justify-between">
        <div className="flex flex-1 gap-2 rounded-lg bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => { setMode("slot"); setPickedExpert(null); }}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-semibold transition ${mode === "slot" ? "bg-white text-teal-600 shadow" : "text-slate-600"}`}
            data-testid="smart-mode-slot"
          >
            <CalendarDays className="mr-1 inline h-3.5 w-3.5" /> Find a Slot
          </button>
          <button
            type="button"
            onClick={() => { setMode("expert"); onChange({ appointment_date: "", appointment_time: "", physio_id: "" }); }}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-semibold transition ${mode === "expert" ? "bg-white text-teal-600 shadow" : "text-slate-600"}`}
            data-testid="smart-mode-expert"
          >
            <User className="mr-1 inline h-3.5 w-3.5" /> Find an Expert
          </button>
        </div>
      </div>
      <p className="-mt-1 flex items-center gap-1.5 text-[11px] text-slate-500" data-testid="smart-slot-type-hint">
        <CalendarDays className="h-3 w-3 text-teal-500" />
        Showing <b className="text-teal-700">Initial Consultation</b> slots only (defined on Head Physio Calendar).
      </p>

      {/* Month nav */}
      {(mode === "slot" || (mode === "expert" && pickedExpert)) && (
        <div className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-1.5">
          <button type="button" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} className="rounded p-1 hover:bg-slate-100" data-testid="smart-prev"><ChevronLeft className="h-4 w-4" /></button>
          <span className="text-sm font-semibold">{MONTHS[cursor.getMonth()]} {cursor.getFullYear()}</span>
          <button type="button" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} className="rounded p-1 hover:bg-slate-100" data-testid="smart-next"><ChevronRight className="h-4 w-4" /></button>
        </div>
      )}

      {/* --- Find a Slot --- */}
      {mode === "slot" && (
        <div className="grid gap-3 lg:grid-cols-2">
          <CalendarGrid
            grid={grid}
            cursor={cursor}
            days={calendar?.days}
            selectedDate={value?.appointment_date}
            onPick={onPickDate}
            loading={loading}
            mode="branch"
            testid="smart-calendar-branch"
          />
          <div className="rounded-md border border-slate-200 bg-white p-3" data-testid="smart-slot-panel">
            {!value?.appointment_date ? (
              <p className="flex h-full items-center justify-center text-center text-xs text-slate-400">
                Pick a date on the calendar to see available time slots.
              </p>
            ) : !daySlots ? (
              <p className="text-xs text-slate-400">Loading slots…</p>
            ) : (
              <div data-testid="smart-day-slots">
                <p className="mb-1 text-xs font-semibold text-slate-700">Time slots — {value.appointment_date}</p>
                <div className="grid max-h-56 grid-cols-3 gap-1.5 overflow-y-auto pr-1">
                  {daySlots.slots.map((s) => {
                    const free = s.available_count > 0;
                    const active = value.appointment_time === s.time;
                    return (
                      <button
                        key={s.time}
                        type="button"
                        disabled={!free}
                        onClick={() => onPickTime(s.time, value.physio_id && s.available_experts.find((e) => e.id === value.physio_id) ? value.physio_id : "")}
                        className={`rounded-md border px-2 py-1.5 text-xs font-semibold transition ${active ? "border-teal-500 bg-teal-500 text-white" : free ? "border-slate-200 bg-white text-slate-700 hover:border-teal-300" : "cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300 line-through"}`}
                        data-testid={`smart-slot-${s.time}`}
                      >
                        {s.time} <span className="ml-0.5 opacity-60">({s.available_count})</span>
                      </button>
                    );
                  })}
                  {daySlots.slots.length === 0 && <p className="col-span-full text-xs text-slate-400">No slots configured.</p>}
                </div>
                {value.appointment_time && (
                  <div className="mt-3 border-t border-slate-100 pt-2" data-testid="smart-slot-experts">
                    <p className="mb-1 text-xs font-semibold text-slate-700">Available at {value.appointment_time}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {(daySlots.slots.find((s) => s.time === value.appointment_time)?.available_experts || []).map((e) => (
                        <button
                          key={e.id}
                          type="button"
                          onClick={() => onPickExpert(e.id)}
                          className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${value.physio_id === e.id ? "border-teal-500 bg-teal-500 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-teal-300"}`}
                          data-testid={`smart-expert-${e.id}`}
                        >
                          {value.physio_id === e.id && <CheckCircle2 className="mr-1 inline h-3 w-3" />}
                          {e.full_name} {e.profile_type === "head_physio" ? "· Head" : ""}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* --- Find an Expert --- */}
      {mode === "expert" && !pickedExpert && (
        <div className="grid gap-1.5 sm:grid-cols-2" data-testid="smart-expert-list">
          {experts.length === 0 && <p className="col-span-full text-xs text-slate-400">No experts mapped to this branch.</p>}
          {experts.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => setPickedExpert(e)}
              className="flex flex-col items-start rounded-md border border-slate-200 bg-white px-3 py-2 text-left text-xs hover:border-teal-400"
              data-testid={`smart-pick-expert-${e.id}`}
            >
              <span className="font-semibold text-slate-800">{e.full_name}</span>
              <span className="text-slate-500">{e.profile_type} · {e.specialization || "—"}</span>
            </button>
          ))}
        </div>
      )}

      {mode === "expert" && pickedExpert && (
        <>
          <div className="flex items-center justify-between rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-xs text-teal-700">
            <span>Viewing: <b>{pickedExpert.full_name}</b> · {pickedExpert.specialization || "—"}</span>
            <button type="button" onClick={() => { setPickedExpert(null); onChange({ appointment_date: "", appointment_time: "", physio_id: "" }); }} className="font-semibold underline" data-testid="smart-change-expert">Change</button>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <CalendarGrid
              grid={grid}
              cursor={cursor}
              days={expertCal?.days}
              selectedDate={value?.appointment_date}
              onPick={(d) => onChange({ appointment_date: d, appointment_time: "", physio_id: pickedExpert.id })}
              loading={loading}
              mode="expert"
              testid="smart-calendar-expert"
            />
            <div className="rounded-md border border-slate-200 bg-white p-3" data-testid="smart-expert-day">
              {!value?.appointment_date ? (
                <p className="flex h-full items-center justify-center text-center text-xs text-slate-400">
                  Pick a date to see {pickedExpert.full_name}&rsquo;s free slots.
                </p>
              ) : (
                <>
                  <p className="mb-1 text-xs font-semibold text-slate-700">Free slots — {value.appointment_date}</p>
                  <div className="grid max-h-56 grid-cols-3 gap-1.5 overflow-y-auto pr-1">
                    {(expertCal?.days?.[value.appointment_date]?.available_slots || []).map((t) => {
                      const active = value.appointment_time === t;
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => onChange({ ...(value || {}), appointment_time: t, physio_id: pickedExpert.id })}
                          className={`rounded-md border px-2 py-1.5 text-xs font-semibold transition ${active ? "border-teal-500 bg-teal-500 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-teal-300"}`}
                          data-testid={`smart-expert-slot-${t}`}
                        >
                          {t}
                        </button>
                      );
                    })}
                    {(expertCal?.days?.[value.appointment_date]?.available_slots || []).length === 0 && (
                      <p className="col-span-full text-xs text-slate-400">No free slots that day.</p>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

const CalendarGrid = ({ grid, cursor, days, selectedDate, onPick, loading, mode, testid }) => {
  const today = ymd(new Date());
  return (
    <div className="rounded-md border border-slate-200 p-2" data-testid={testid}>
      <div className="mb-1 grid grid-cols-7 gap-0.5 text-center text-[10px] font-semibold uppercase text-slate-500">
        {WEEK.map((w) => <div key={w}>{w}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {grid.map((cell, i) => {
          if (!cell) return <div key={i} />;
          const date = ymd(new Date(cursor.getFullYear(), cursor.getMonth(), cell));
          const info = days?.[date];
          const isPast = date < today;
          const fully = info?.fully_booked === true;
          const noSlots = mode === "expert" && (info?.total_slots ?? 0) === 0;
          const disabled = isPast || fully || noSlots;
          const selected = selectedDate === date;
          const free = mode === "branch" ? info?.available_experts : info?.available_slots?.length;
          return (
            <button
              key={i}
              type="button"
              disabled={disabled || loading}
              onClick={() => onPick(date)}
              className={`flex h-12 flex-col items-center justify-center rounded text-[11px] font-semibold transition ${
                selected ? "bg-teal-500 text-white" :
                disabled ? "bg-slate-50 text-slate-300 line-through cursor-not-allowed" :
                "bg-white text-slate-700 hover:bg-teal-50"
              }`}
              data-testid={`smart-day-${date}`}
            >
              <span>{cell}</span>
              {!disabled && free !== undefined && <span className={`text-[9px] ${selected ? "text-white/80" : "text-emerald-600"}`}>{free}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
};

function buildMonthGrid(cursor) {
  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  const firstDay = new Date(y, m, 1).getDay();
  const daysIn = new Date(y, m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysIn; d++) cells.push(d);
  return cells;
}

export default SmartBookingPicker;
