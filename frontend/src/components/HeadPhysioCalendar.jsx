import { useCallback, useEffect, useState } from "react";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  Stethoscope,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import {
  addCalendarSlots,
  getDoctorCalendar,
  getDoctors,
  removeCalendarSlots,
} from "@/lib/api";

const CONSULTATION_TYPES = [
  { value: "initial", label: "Initial Consultation", color: "bg-blue-100 text-blue-700 border-blue-300" },
  { value: "follow_up", label: "Follow-up", color: "bg-amber-100 text-amber-700 border-amber-300" },
  { value: "review", label: "Review", color: "bg-emerald-100 text-emerald-700 border-emerald-300" },
];

const DURATIONS = [15, 30, 45, 60];

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year, month) {
  return new Date(year, month, 1).getDay();
}

export const HeadPhysioCalendar = ({ branchId }) => {
  const [doctors, setDoctors] = useState([]);
  const [selectedDoctor, setSelectedDoctor] = useState(null);
  const [calendarData, setCalendarData] = useState(null);

  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [selectedDate, setSelectedDate] = useState(null);

  const [slotDuration, setSlotDuration] = useState(30);
  const [slotType, setSlotType] = useState("initial");
  const [pendingSlots, setPendingSlots] = useState([]);
  const [saving, setSaving] = useState(false);

  const loadDoctors = useCallback(async () => {
    if (!branchId) return;
    try {
      const all = await getDoctors({ branch_id: branchId });
      setDoctors(all.filter((d) => d.profile_type === "head_physio"));
    } catch { /* silent */ }
  }, [branchId]);

  useEffect(() => { loadDoctors(); }, [loadDoctors]);

  const loadCalendar = useCallback(async () => {
    if (!selectedDoctor) { setCalendarData(null); return; }
    try {
      const data = await getDoctorCalendar(selectedDoctor.id);
      setCalendarData(data);
    } catch { /* silent */ }
  }, [selectedDoctor]);

  useEffect(() => { loadCalendar(); }, [loadCalendar]);

  const selectDoctor = (doc) => {
    setSelectedDoctor(doc);
    setSelectedDate(null);
    setPendingSlots([]);
  };

  const prevMonth = () => {
    if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear(currentYear - 1); }
    else setCurrentMonth(currentMonth - 1);
  };
  const nextMonth = () => {
    if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear(currentYear + 1); }
    else setCurrentMonth(currentMonth + 1);
  };

  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const firstDay = getFirstDayOfMonth(currentYear, currentMonth);

  const dateStr = (day) => `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const getSlotsForDate = (date) => {
    if (!calendarData) return [];
    return (calendarData.slot_details || []).filter((s) => s.slot_time.startsWith(date));
  };

  const getSimpleSlotsForDate = (date) => {
    if (!calendarData) return [];
    return (calendarData.slots || []).filter((s) => s.startsWith(date));
  };

  const isBooked = (slotTime) => {
    return calendarData?.booked?.[slotTime];
  };

  const generateTimeGrid = () => {
    const slots = [];
    for (let h = 8; h <= 20; h++) {
      for (let m = 0; m < 60; m += 30) {
        if (h === 20 && m > 0) break;
        const time = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        slots.push(time);
      }
    }
    return slots;
  };

  const isSlotExisting = (time) => {
    if (!selectedDate || !calendarData) return false;
    const full = `${selectedDate}T${time}`;
    return (calendarData.slots || []).includes(full);
  };

  const isSlotPending = (time) => {
    const full = `${selectedDate}T${time}`;
    return pendingSlots.some((s) => s.slot_time === full);
  };

  const toggleSlot = (time) => {
    const full = `${selectedDate}T${time}`;
    if (isBooked(full)) { toast.error("This slot has a booked appointment"); return; }

    if (isSlotExisting(time) && !isSlotPending(time)) {
      setPendingSlots((prev) => [...prev, { slot_time: full, duration: slotDuration, consultation_type: slotType, _remove: true }]);
    } else if (isSlotPending(time)) {
      setPendingSlots((prev) => prev.filter((s) => s.slot_time !== full));
    } else {
      setPendingSlots((prev) => [...prev, { slot_time: full, duration: slotDuration, consultation_type: slotType }]);
    }
  };

  const getSlotState = (time) => {
    const full = `${selectedDate}T${time}`;
    const pending = pendingSlots.find((s) => s.slot_time === full);
    if (pending && pending._remove) return "removing";
    if (pending) return "adding";
    if (isSlotExisting(time)) return "existing";
    return "empty";
  };

  const getSlotDetail = (time) => {
    const full = `${selectedDate}T${time}`;
    const pending = pendingSlots.find((s) => s.slot_time === full);
    if (pending && !pending._remove) return pending;
    if (calendarData?.slot_details) {
      return calendarData.slot_details.find((s) => s.slot_time === full);
    }
    return null;
  };

  const saveChanges = async () => {
    if (!selectedDoctor || pendingSlots.length === 0) return;
    setSaving(true);
    try {
      const toAdd = pendingSlots.filter((s) => !s._remove);
      const toRemove = pendingSlots.filter((s) => s._remove);

      if (toRemove.length > 0) {
        await removeCalendarSlots(selectedDoctor.id, { slot_times: toRemove.map((s) => s.slot_time) });
      }
      if (toAdd.length > 0) {
        await addCalendarSlots(selectedDoctor.id, { slots: toAdd.map((s) => ({ slot_time: s.slot_time, duration: s.duration, consultation_type: s.consultation_type })) });
      }
      toast.success(`Saved ${toAdd.length} added, ${toRemove.length} removed`);
      setPendingSlots([]);
      await loadCalendar();
      await loadDoctors();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Save failed");
    }
    setSaving(false);
  };

  const countSlotsForDay = (day) => {
    const d = dateStr(day);
    return getSimpleSlotsForDate(d).length;
  };

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  return (
    <div className="flex gap-4 h-[calc(100vh-220px)]" data-testid="head-physio-calendar-root">
      {/* LEFT PANEL — Doctor List */}
      <div className="w-72 flex-shrink-0 flex flex-col border border-slate-200 rounded-xl bg-white overflow-hidden" data-testid="doctor-list-panel">
        <div className="p-4 border-b border-slate-100 bg-slate-50/60">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
              <Stethoscope className="h-4 w-4 text-violet-500" /> Head Physios
            </h3>
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700">{doctors.length}</span>
          </div>
          <p className="mt-1 text-[10px] text-slate-400">Managed by HR Admin</p>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1.5" data-testid="doctor-list">
          {doctors.length === 0 && (
            <p className="text-xs text-slate-400 text-center py-6">No Head Physios assigned to this branch yet — ask HR Admin to add one.</p>
          )}
          {doctors.map((doc) => {
            const isActive = selectedDoctor?.id === doc.id;
            const slotCount = (doc.slots || []).length;
            return (
              <button
                key={doc.id}
                type="button"
                onClick={() => selectDoctor(doc)}
                className={`w-full flex items-center gap-3 rounded-lg border p-3 text-left transition-all ${
                  isActive
                    ? "border-violet-400 bg-violet-50 shadow-sm"
                    : "border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50"
                }`}
                data-testid={`doctor-card-${doc.id}`}
              >
                <div className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ${isActive ? "bg-violet-200 text-violet-800" : "bg-slate-100 text-slate-600"}`}>
                  {doc.full_name?.charAt(0)?.toUpperCase() || "D"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{doc.full_name}</p>
                  <p className="text-[10px] text-slate-400">{doc.specialization || "Physiotherapist"}</p>
                </div>
                <div className="flex flex-col items-end">
                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${slotCount > 0 ? "bg-emerald-50 text-emerald-600" : "bg-slate-50 text-slate-400"}`}>
                    {slotCount} slots
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* RIGHT PANEL — Calendar */}
      <div className="flex-1 border border-slate-200 rounded-xl bg-white overflow-hidden flex flex-col" data-testid="calendar-panel">
        {!selectedDoctor ? (
          <div className="flex-1 flex items-center justify-center" data-testid="calendar-empty-state">
            <div className="text-center">
              <CalendarIcon className="h-12 w-12 text-slate-200 mx-auto mb-3" />
              <p className="text-sm text-slate-400">Select a Head Physio to manage their calendar</p>
            </div>
          </div>
        ) : (
          <>
            {/* Doctor Header */}
            <div className="p-4 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-100 text-sm font-bold text-violet-700">
                  {selectedDoctor.full_name?.charAt(0)?.toUpperCase()}
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">{selectedDoctor.full_name}</h3>
                  <p className="text-[11px] text-slate-400">{selectedDoctor.specialization || "Physiotherapist"} · {(calendarData?.slots || []).length} slots</p>
                </div>
              </div>
              {pendingSlots.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-amber-600 font-medium">{pendingSlots.length} unsaved changes</span>
                  <Button size="sm" variant="outline" onClick={() => setPendingSlots([])} className="text-xs" data-testid="discard-changes-btn">Discard</Button>
                  <Button size="sm" onClick={saveChanges} disabled={saving} className="bg-violet-600 hover:bg-violet-700 text-white text-xs" data-testid="save-slots-btn">
                    {saving ? "Saving..." : "Save Changes"}
                  </Button>
                </div>
              )}
            </div>

            <div className="flex-1 flex overflow-hidden">
              {/* Month Calendar */}
              <div className="w-80 flex-shrink-0 border-r border-slate-100 p-4 flex flex-col">
                <div className="flex items-center justify-between mb-4">
                  <button type="button" onClick={prevMonth} className="p-1 rounded hover:bg-slate-100" data-testid="cal-prev-month">
                    <ChevronLeft className="h-4 w-4 text-slate-500" />
                  </button>
                  <h4 className="text-sm font-semibold text-slate-700" data-testid="cal-month-title">{monthNames[currentMonth]} {currentYear}</h4>
                  <button type="button" onClick={nextMonth} className="p-1 rounded hover:bg-slate-100" data-testid="cal-next-month">
                    <ChevronRight className="h-4 w-4 text-slate-500" />
                  </button>
                </div>

                <div className="grid grid-cols-7 gap-0.5 mb-1">
                  {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                    <div key={d} className="text-center text-[10px] font-semibold text-slate-400 py-1">{d}</div>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-0.5">
                  {Array.from({ length: firstDay }, (_, i) => (
                    <div key={`empty-${i}`} className="h-9" />
                  ))}
                  {Array.from({ length: daysInMonth }, (_, i) => {
                    const day = i + 1;
                    const d = dateStr(day);
                    const isSelected = selectedDate === d;
                    const isToday = d === todayStr;
                    const slotCount = countSlotsForDay(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => { setSelectedDate(d); setPendingSlots([]); }}
                        className={`h-9 rounded-lg text-xs font-medium relative transition-all ${
                          isSelected
                            ? "bg-violet-600 text-white shadow-sm"
                            : isToday
                            ? "bg-violet-50 text-violet-700 border border-violet-200"
                            : "text-slate-600 hover:bg-slate-100"
                        }`}
                        data-testid={`cal-day-${day}`}
                      >
                        {day}
                        {slotCount > 0 && !isSelected && (
                          <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-emerald-400" />
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Slot Config */}
                <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
                  <div>
                    <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1 block">Duration</label>
                    <div className="flex gap-1.5" data-testid="duration-options">
                      {DURATIONS.map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setSlotDuration(d)}
                          className={`rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-all ${
                            slotDuration === d ? "border-violet-400 bg-violet-50 text-violet-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"
                          }`}
                          data-testid={`duration-${d}`}
                        >
                          {d}m
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1 block">Consultation Type</label>
                    <div className="space-y-1" data-testid="type-options">
                      {CONSULTATION_TYPES.map((ct) => (
                        <button
                          key={ct.value}
                          type="button"
                          onClick={() => setSlotType(ct.value)}
                          className={`w-full rounded-md border px-3 py-1.5 text-left text-[11px] font-medium transition-all ${
                            slotType === ct.value ? `${ct.color} border` : "border-slate-200 text-slate-500 hover:bg-slate-50"
                          }`}
                          data-testid={`type-${ct.value}`}
                        >
                          {ct.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Time Slots Grid */}
              <div className="flex-1 p-4 overflow-y-auto">
                {!selectedDate ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center">
                      <Clock className="h-8 w-8 text-slate-200 mx-auto mb-2" />
                      <p className="text-xs text-slate-400">Select a date to manage time slots</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-sm font-semibold text-slate-700" data-testid="selected-date-title">
                        {new Date(selectedDate + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                      </h4>
                      <div className="flex items-center gap-3 text-[10px] text-slate-400">
                        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-400 inline-block" /> Available</span>
                        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-violet-400 inline-block" /> Adding</span>
                        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-red-300 inline-block" /> Removing</span>
                        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-amber-400 inline-block" /> Booked</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-2" data-testid="time-slots-grid">
                      {generateTimeGrid().map((time) => {
                        const state = getSlotState(time);
                        const detail = getSlotDetail(time);
                        const fullSlot = `${selectedDate}T${time}`;
                        const booked = isBooked(fullSlot);

                        let borderColor = "border-slate-200";
                        let bgColor = "bg-white";
                        let textColor = "text-slate-600";
                        let badge = null;

                        if (booked) {
                          borderColor = "border-amber-300";
                          bgColor = "bg-amber-50";
                          textColor = "text-amber-800";
                          badge = <span className="text-[9px] bg-amber-100 text-amber-600 rounded px-1.5 py-0.5">Booked</span>;
                        } else if (state === "existing") {
                          borderColor = "border-emerald-300";
                          bgColor = "bg-emerald-50";
                          textColor = "text-emerald-800";
                          const ct = CONSULTATION_TYPES.find((c) => c.value === detail?.consultation_type);
                          badge = (
                            <div className="flex items-center gap-1">
                              <span className="text-[9px] bg-emerald-100 text-emerald-600 rounded px-1.5 py-0.5">{detail?.duration || 30}m</span>
                              {ct && <span className={`text-[9px] rounded px-1.5 py-0.5 ${ct.color}`}>{ct.label}</span>}
                            </div>
                          );
                        } else if (state === "adding") {
                          borderColor = "border-violet-300";
                          bgColor = "bg-violet-50";
                          textColor = "text-violet-800";
                          badge = <span className="text-[9px] bg-violet-100 text-violet-600 rounded px-1.5 py-0.5">+ Adding {detail?.duration}m</span>;
                        } else if (state === "removing") {
                          borderColor = "border-red-300";
                          bgColor = "bg-red-50";
                          textColor = "text-red-600 line-through";
                          badge = <span className="text-[9px] bg-red-100 text-red-500 rounded px-1.5 py-0.5">Removing</span>;
                        }

                        return (
                          <button
                            key={time}
                            type="button"
                            onClick={() => !booked && toggleSlot(time)}
                            disabled={!!booked}
                            className={`rounded-lg border ${borderColor} ${bgColor} p-3 text-left transition-all ${booked ? "cursor-not-allowed opacity-70" : "hover:shadow-sm cursor-pointer"}`}
                            data-testid={`slot-${time}`}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className={`text-sm font-semibold ${textColor}`}>{time}</span>
                              {state === "existing" && !booked && (
                                <Trash2 className="h-3 w-3 text-slate-300 hover:text-red-400 transition-colors" />
                              )}
                            </div>
                            {badge}
                            {booked && (
                              <p className="text-[10px] text-amber-600 mt-0.5">{booked.lead_name}</p>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>

    </div>
  );
};
