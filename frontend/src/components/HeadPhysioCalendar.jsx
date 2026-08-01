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
import { to12h } from "@/lib/time";

const CONSULTATION_TYPES = [
  { value: "initial", label: "Initial Consultation", color: "bg-blue-100 text-blue-700 border-blue-300" },
  { value: "follow_up", label: "Follow-up", color: "bg-amber-100 text-amber-700 border-amber-300" },
  { value: "review", label: "Review", color: "bg-emerald-100 text-emerald-700 border-emerald-300" },
];

const SESSION_TYPES = [
  { value: "session", label: "Treatment Session", color: "bg-sky-100 text-sky-700 border-sky-300" },
];

// Every consultation slot is 30 minutes. Picking a date opens the whole working day at
// this length, so there's no per-day duration choice to make.
const SLOT_MINUTES = 30;

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year, month) {
  return new Date(year, month, 1).getDay();
}

// `profileType`: "head_physio" (default) manages Head Physios' consultation calendars;
// "physio" manages regular Physios' treatment-session calendars. Same UI and backend
// endpoints either way — only the doctor filter, labels, and slot-type options differ.
export const HeadPhysioCalendar = ({ branchId, profileType = "head_physio" }) => {
  const isPhysio = profileType === "physio";
  const roleLabel = isPhysio ? "Physio" : "Head Physio";
  const roleLabelPlural = isPhysio ? "Physios" : "Head Physios";
  const SLOT_TYPES = isPhysio ? SESSION_TYPES : CONSULTATION_TYPES;

  const [doctors, setDoctors] = useState([]);
  const [selectedDoctor, setSelectedDoctor] = useState(null);
  const [calendarData, setCalendarData] = useState(null);

  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [selectedDate, setSelectedDate] = useState(null);

  const slotDuration = SLOT_MINUTES;
  const slotType = SLOT_TYPES[0].value;
  const [pendingSlots, setPendingSlots] = useState([]);
  const [saving, setSaving] = useState(false);

  const loadDoctors = useCallback(async () => {
    if (!branchId) return;
    try {
      const all = await getDoctors({ branch_id: branchId });
      setDoctors(all.filter((d) => d.profile_type === profileType));
    } catch { /* silent */ }
  }, [branchId, profileType]);

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

  // Picking a date IS the availability confirmation — the whole working day fills in
  // straight away rather than making the Branch Admin click 28 slots by hand. They land
  // as staged additions (not saved), so an accidental date click costs nothing and the
  // existing Save Changes / Discard pair still governs what actually gets published.
  // Slots already published for that date, and anything booked, are left untouched.
  const selectDate = (d) => {
    setSelectedDate(d);
    const alreadyOpen = new Set((calendarData?.slots || []).filter((s) => s.startsWith(`${d}T`)));
    setPendingSlots(
      generateTimeGrid()
        .filter((time) => {
          const full = `${d}T${time}`;
          return !alreadyOpen.has(full) && !calendarData?.booked?.[full];
        })
        .map((time) => ({ slot_time: `${d}T${time}`, duration: slotDuration, consultation_type: slotType })),
    );
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

  const getSimpleSlotsForDate = (date) => {
    if (!calendarData) return [];
    return (calendarData.slots || []).filter((s) => s.startsWith(date));
  };

  const isBooked = (slotTime) => {
    return calendarData?.booked?.[slotTime];
  };

  // The working window a day is opened across: 8:00 AM to 10:00 PM, in 30-minute steps,
  // giving 8:00 AM … 9:30 PM — every generated slot finishes by 10:00 PM.
  const DAY_START_MIN = 8 * 60;
  const DAY_END_MIN = 22 * 60;

  const generateTimeGrid = () => {
    const slots = [];
    const step = slotDuration || 30;
    for (let m = DAY_START_MIN; m + step <= DAY_END_MIN; m += step) {
      slots.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
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
    <div className="flex flex-col gap-4 lg:h-[calc(100vh-220px)] lg:flex-row" data-testid="head-physio-calendar-root">
      {/* LEFT PANEL — Doctor List */}
      <div className="flex max-h-64 w-full flex-shrink-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white lg:h-full lg:max-h-none lg:w-72" data-testid="doctor-list-panel">
        <div className="p-4 border-b border-slate-100 bg-slate-50/60">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
              <Stethoscope className="h-4 w-4 text-violet-500" /> {roleLabelPlural}
            </h3>
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700">{doctors.length}</span>
          </div>
          <p className="mt-1 text-[10px] text-slate-400">Managed by HR Admin</p>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1.5" data-testid="doctor-list">
          {doctors.length === 0 && (
            <p className="text-xs text-slate-400 text-center py-6">No {roleLabelPlural} assigned to this branch yet — ask HR Admin to add one.</p>
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
      <div className="flex flex-1 flex-col overflow-visible rounded-xl border border-slate-200 bg-white lg:overflow-hidden" data-testid="calendar-panel">
        {!selectedDoctor ? (
          <div className="flex-1 flex items-center justify-center" data-testid="calendar-empty-state">
            <div className="text-center">
              <CalendarIcon className="h-12 w-12 text-slate-200 mx-auto mb-3" />
              <p className="text-sm text-slate-400">Select a {roleLabel} to manage their calendar</p>
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

            <div className="flex flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
              {/* Month Calendar — scrolls on its own, otherwise the controls below it
                  (duration, type, Mark Whole Day Available, Repeat) get clipped by the
                  row's lg:overflow-hidden with no way to reach them. */}
              <div className="w-full flex-shrink-0 border-b border-slate-100 p-5 flex flex-col lg:w-[26rem] lg:border-b-0 lg:border-r lg:overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                  <button type="button" onClick={prevMonth} className="p-1 rounded hover:bg-slate-100" data-testid="cal-prev-month">
                    <ChevronLeft className="h-4 w-4 text-slate-500" />
                  </button>
                  <h4 className="text-sm font-semibold text-slate-700" data-testid="cal-month-title">{monthNames[currentMonth]} {currentYear}</h4>
                  <button type="button" onClick={nextMonth} className="p-1 rounded hover:bg-slate-100" data-testid="cal-next-month">
                    <ChevronRight className="h-4 w-4 text-slate-500" />
                  </button>
                </div>

                <div className="grid grid-cols-7 gap-1 mb-1">
                  {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                    <div key={d} className="text-center text-[11px] font-semibold text-slate-400 py-1.5">{d}</div>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-1">
                  {Array.from({ length: firstDay }, (_, i) => (
                    <div key={`empty-${i}`} className="h-11" />
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
                        onClick={() => selectDate(d)}
                        className={`h-11 rounded-lg text-sm font-medium relative transition-all ${
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

                {selectedDate && (
                  <p className="mt-4 border-t border-slate-100 pt-3 text-[11px] text-slate-400" data-testid="calendar-day-hint">
                    Whole day opened at {SLOT_MINUTES}-minute slots. Click any slot to drop it,
                    then Save Changes.
                  </p>
                )}
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
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                      <h4 className="text-sm font-semibold text-slate-700" data-testid="selected-date-title">
                        {new Date(selectedDate + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                      </h4>
                      <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-400">
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
                          const ct = SLOT_TYPES.find((c) => c.value === detail?.consultation_type);
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
                              <span className={`text-sm font-semibold ${textColor}`}>{to12h(time)}</span>
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
