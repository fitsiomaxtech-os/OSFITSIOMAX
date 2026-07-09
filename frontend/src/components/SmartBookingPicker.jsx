import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { getDaySlots } from "@/lib/api";

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const SmartBookingPicker = ({ branchId, value, onChange }) => {
  // value = { appointment_date, appointment_time, physio_id }
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
    <div className="space-y-3" data-testid="smart-booking-picker">
      <p className="flex items-center gap-1.5 text-[11px] text-slate-500" data-testid="smart-slot-type-hint">
        <CalendarDays className="h-3 w-3 text-teal-500" />
        Showing <b className="text-teal-700">Initial Consultation</b> slots only (defined on Head Physio Calendar).
      </p>

      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600">Date</label>
        <input
          type="date"
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

export default SmartBookingPicker;
