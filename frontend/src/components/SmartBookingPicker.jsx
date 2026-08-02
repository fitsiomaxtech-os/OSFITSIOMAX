import { useEffect, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, User } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { getDaySlots, getDoctors, getExpertCalendar } from "@/lib/api";
import { MilkDateInput } from "@/components/ui/milk-calendar";

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}
function getFirstDayOfMonth(year, month) {
  return new Date(year, month, 1).getDay();
}

const MODES = [
  { key: "date", label: "Date & Time First" },
  { key: "doctor", label: "Doctor First" },
];

export const SmartBookingPicker = ({ branchId, value, onChange }) => {
  // value = { appointment_date, appointment_time, physio_id }
  const [mode, setMode] = useState("date");

  const switchMode = (next) => {
    if (next === mode) return;
    setMode(next);
    onChange({ appointment_date: "", appointment_time: "", physio_id: "" });
  };

  return (
    <div className="space-y-3" data-testid="smart-booking-picker">
      <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1" data-testid="smart-booking-mode-tabs">
        {MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => switchMode(m.key)}
            className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition ${mode === m.key ? "bg-white text-teal-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
            data-testid={`smart-booking-mode-${m.key}`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === "date" ? (
        <DateFirstPicker branchId={branchId} value={value} onChange={onChange} />
      ) : (
        <DoctorFirstPicker branchId={branchId} value={value} onChange={onChange} />
      )}
    </div>
  );
};

const DateFirstPicker = ({ branchId, value, onChange }) => {
  const [daySlots, setDaySlots] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!branchId || !value?.appointment_date) { setDaySlots(null); return; }
    let cancelled = false;
    setLoading(true);
    getDaySlots(branchId, value.appointment_date)
      .then((res) => { if (!cancelled) setDaySlots(res); })
      .catch(() => { if (!cancelled) { setDaySlots(null); toast.error("Failed to load slots"); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [branchId, value?.appointment_date]);

  const onPickDate = (date) => {
    onChange({ ...(value || {}), appointment_date: date, appointment_time: "", physio_id: "" });
  };
  const onPickTime = (time) => {
    onChange({ ...(value || {}), appointment_time: time, physio_id: "" });
  };
  const onPickExpert = (eid) => {
    onChange({ ...(value || {}), physio_id: eid });
  };

  const availableSlots = (daySlots?.slots || []).filter((s) => s.available_count > 0);
  const activeSlot = daySlots?.slots?.find((s) => s.time === value?.appointment_time);
  const availableExperts = activeSlot?.available_experts || [];

  return (
    <div className="space-y-3" data-testid="date-first-picker">
      <p className="flex items-center gap-1.5 text-[11px] text-slate-500" data-testid="smart-slot-type-hint">
        <CalendarDays className="h-3 w-3 text-teal-500" />
        Showing <b className="text-teal-700">Initial Consultation</b> slots only (defined on Head Physio Calendar).
      </p>

      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600">Date</label>
        <MilkDateInput
          
          min={todayStr()}
          value={value?.appointment_date || ""}
          onChange={(e) => onPickDate(e.target.value)}
          className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
          data-testid="smart-date-input"
        />
      </div>

      {value?.appointment_date && (
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600">Time</label>
          {loading ? (
            <p className="text-xs text-slate-400">Loading slots…</p>
          ) : (
            <select
              value={value?.appointment_time || ""}
              onChange={(e) => onPickTime(e.target.value)}
              className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
              data-testid="smart-time-select"
            >
              <option value="">-- select a time --</option>
              {availableSlots.map((s) => (
                <option key={s.time} value={s.time}>{s.time} ({s.available_count} available)</option>
              ))}
            </select>
          )}
          {!loading && availableSlots.length === 0 && (
            <p className="mt-1 text-xs text-slate-400">No slots available on this date.</p>
          )}
        </div>
      )}

      {value?.appointment_time && (
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600">Expert</label>
          <select
            value={value?.physio_id || ""}
            onChange={(e) => onPickExpert(e.target.value)}
            className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
            data-testid="smart-expert-select"
          >
            <option value="">-- select an expert --</option>
            {availableExperts.map((e) => (
              <option key={e.id} value={e.id}>{e.full_name}{e.profile_type === "head_physio" ? " · Head" : ""}</option>
            ))}
          </select>
          {availableExperts.length === 0 && (
            <p className="mt-1 text-xs text-slate-400">No experts available at this time.</p>
          )}
        </div>
      )}
    </div>
  );
};

const DoctorFirstPicker = ({ branchId, value, onChange }) => {
  const [experts, setExperts] = useState([]);
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [expertCalendar, setExpertCalendar] = useState(null);
  const [calLoading, setCalLoading] = useState(false);

  useEffect(() => {
    if (!branchId) return;
    getDoctors({ branch_id: branchId }).then(setExperts).catch(() => setExperts([]));
  }, [branchId]);

  useEffect(() => {
    if (!value?.physio_id) { setExpertCalendar(null); return; }
    let cancelled = false;
    setCalLoading(true);
    const monthStr = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}`;
    getExpertCalendar(value.physio_id, monthStr)
      .then((res) => { if (!cancelled) setExpertCalendar(res); })
      .catch(() => { if (!cancelled) { setExpertCalendar(null); toast.error("Failed to load expert's calendar"); } })
      .finally(() => { if (!cancelled) setCalLoading(false); });
    return () => { cancelled = true; };
  }, [value?.physio_id, currentMonth, currentYear]);

  const onPickExpert = (eid) => {
    onChange({ ...(value || {}), physio_id: eid, appointment_date: "", appointment_time: "" });
  };
  const onPickDate = (date) => {
    onChange({ ...(value || {}), appointment_date: date, appointment_time: "" });
  };
  const onPickTime = (time) => {
    onChange({ ...(value || {}), appointment_time: time });
  };

  const prevMonth = () => {
    if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear((y) => y - 1); }
    else setCurrentMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear((y) => y + 1); }
    else setCurrentMonth((m) => m + 1);
  };

  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const firstDay = getFirstDayOfMonth(currentYear, currentMonth);
  const dateStr = (day) => `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const dayInfo = (date) => expertCalendar?.days?.[date];
  const selectedExpert = experts.find((e) => e.id === value?.physio_id);
  const timesForSelectedDate = value?.appointment_date ? (dayInfo(value.appointment_date)?.available_slots || []) : [];

  return (
    <div className="space-y-3" data-testid="doctor-first-picker">
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600">Doctor</label>
        <select
          value={value?.physio_id || ""}
          onChange={(e) => onPickExpert(e.target.value)}
          className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
          data-testid="doctor-first-expert-select"
        >
          <option value="">-- select a doctor --</option>
          {experts.map((e) => (
            <option key={e.id} value={e.id}>{e.full_name}{e.profile_type === "head_physio" ? " · Head Physio" : ""}</option>
          ))}
        </select>
        {experts.length === 0 && <p className="mt-1 text-xs text-slate-400">No doctors set up for this branch yet.</p>}
      </div>

      {value?.physio_id && (
        <div className="rounded-md border border-slate-200 p-3" data-testid="doctor-first-month">
          <div className="mb-2 flex items-center justify-between">
            <button type="button" onClick={prevMonth} className="p-1 rounded hover:bg-slate-100" data-testid="doctor-first-prev-month"><ChevronLeft className="h-4 w-4 text-slate-500" /></button>
            <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
              <User className="h-3.5 w-3.5 text-teal-500" />{selectedExpert?.full_name || "…"} · {monthNames[currentMonth]} {currentYear}
            </p>
            <button type="button" onClick={nextMonth} className="p-1 rounded hover:bg-slate-100" data-testid="doctor-first-next-month"><ChevronRight className="h-4 w-4 text-slate-500" /></button>
          </div>

          {calLoading ? (
            <p className="py-4 text-center text-xs text-slate-400">Loading calendar…</p>
          ) : (
            <>
              <div className="grid grid-cols-7 gap-0.5 mb-1">
                {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                  <div key={d} className="text-center text-[9px] font-semibold text-slate-400 py-1">{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-0.5">
                {Array.from({ length: firstDay }, (_, i) => <div key={`e-${i}`} className="h-8" />)}
                {Array.from({ length: daysInMonth }, (_, i) => {
                  const day = i + 1;
                  const d = dateStr(day);
                  const info = dayInfo(d);
                  const isPast = d < todayStr();
                  const hasSlots = !isPast && (info?.available_slots?.length || 0) > 0;
                  const isSelected = value?.appointment_date === d;
                  return (
                    <button
                      key={day}
                      type="button"
                      disabled={isPast || !info || !hasSlots}
                      onClick={() => onPickDate(d)}
                      className={`h-8 rounded-md text-[11px] font-medium relative transition-all ${
                        isSelected
                          ? "bg-teal-600 text-white"
                          : hasSlots
                          ? "text-teal-700 hover:bg-teal-50"
                          : "text-slate-300 cursor-not-allowed"
                      }`}
                      data-testid={`doctor-first-day-${day}`}
                    >
                      {day}
                      {hasSlots && !isSelected && <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-teal-400" />}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {value?.appointment_date && (
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600">Time</label>
          <div className="grid grid-cols-3 gap-1.5" data-testid="doctor-first-time-grid">
            {timesForSelectedDate.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onPickTime(t)}
                className={`rounded-md border px-2 py-1.5 text-[11px] font-medium ${value?.appointment_time === t ? "border-teal-500 bg-teal-100 text-teal-800" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
                data-testid={`doctor-first-time-${t}`}
              >
                {t}
              </button>
            ))}
          </div>
          {timesForSelectedDate.length === 0 && <p className="mt-1 text-xs text-slate-400">No free slots on this date.</p>}
        </div>
      )}
    </div>
  );
};

export default SmartBookingPicker;
