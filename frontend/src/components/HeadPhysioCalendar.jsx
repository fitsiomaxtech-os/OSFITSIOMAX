import { useCallback, useEffect, useState } from "react";
import {
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Stethoscope,
  Trash2,
  Users,
  Video,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import {
  addCalendarSlots,
  getDoctorCalendar,
  getDoctors,
  listShifts,
  listStoreItems,
  removeCalendarSlots,
  setDoctorDayShift,
  setDoctorShift,
  setDoctorSlotCapacity,
  getPhysioTypes,
  setDoctorService,
  setDoctorMeetLink,
} from "@/lib/api";
import { to12h } from "@/lib/time";
import { CenteredPicker } from "@/components/ui/milk-calendar";

const CONSULTATION_TYPES = [
  { value: "initial", label: "Initial Consultation", color: "bg-blue-100 text-blue-700 border-blue-300" },
  { value: "follow_up", label: "Follow-up", color: "bg-amber-100 text-amber-700 border-amber-300" },
  { value: "review", label: "Review", color: "bg-emerald-100 text-emerald-700 border-emerald-300" },
];

const SESSION_TYPES = [
  { value: "session", label: "Treatment Session", color: "bg-sky-100 text-sky-700 border-sky-300" },
];

// Slot length comes from FITSIO STORE — the Consultation Duration on the consultation
// item for the Head Physio calendar, and on the session item for the Physio calendar.
// Only used if the store hasn't been configured yet.
const FALLBACK_SLOT_MINUTES = 30;

/** "2026-08-18" -> "18 Aug", for naming a day in a toast without the year taking the line. */
const shortDate = (iso) => {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

/** "07:30" -> 450 minutes past midnight. null for anything that isn't a 24-hour HH:MM. */
const minutesOf = (hhmm) => {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  return Number.isNaN(h) || Number.isNaN(m) ? null : h * 60 + m;
};

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year, month) {
  return new Date(year, month, 1).getDay();
}

// Three distinct scheduling workflows share this shell, and they are NOT interchangeable:
//
//   profileType "head_physio"      ->  HEAD PHYSIO CALENDAR — consultations only. Booked
//                                      from Branch Leads -> Appointment, one per lead, and
//                                      the day is cut at the store's Consultation Duration.
//   profileType "physio"           ->  PHYSIO CALENDAR      — treatment sessions only.
//                                      Booked against a patient's session package (many per
//                                      lead), cut at the session item's duration.
//   profileType "rehab"            ->  REHAB CALENDAR       — rehab programme days, booked
//                                      against a patient's rehab course. Same shape as the
//                                      physio's; the course is the thing being delivered.
//   profileType "nutrition_coach"  ->  DIET CALENDAR        — diet check-in days, booked
//                                      against a patient's diet plan. Same shape as the
//                                      physio's, against diet_sessions rather than sessions.
//
// What varies with it: which experts are listed, where slot length comes from, and the
// language throughout. Publishing availability is the one step all three genuinely share.
export const HeadPhysioCalendar = ({ branchId, profileType = "head_physio" }) => {
  const isPhysio = profileType === "physio";
  const isCoach = profileType === "nutrition_coach";
  const isRehab = profileType === "rehab";
  // Both the physio and the coach book repeat visits against a plan, so they share the
  // slot-type vocabulary and the per-slot capacity control; only the Head Physio's
  // one-per-lead consultation flow differs.
  const isRecurring = isPhysio || isCoach || isRehab;
  // Physiotherapist, not Physio: the tab above this panel says Physiotherapist Calendar,
  // and the shorthand only ever came from the slug.
  const roleLabel = isCoach ? "Nutritionist" : isRehab ? "Rehab Therapist" : isPhysio ? "Physiotherapist" : "CONSULTANT";
  const roleLabelPlural = isCoach ? "Nutritionists" : isRehab ? "Rehab Therapists" : isPhysio ? "Physiotherapists" : "CONSULTANTS";
  // An empty consultant list is a narrowing, not an absence: consultants are org-wide, so
  // the ones missing here are the ones who work the other arm. Saying "none created yet"
  // sends the reader to HR to create somebody who is already there.
  const emptyLine =
    isCoach || isPhysio
      ? `No ${roleLabelPlural} assigned to this branch yet — ask HR Admin to add one.`
      : isRehab
      ? `No ${roleLabelPlural} created yet — ask HR Admin to add one.`
      : `No ${roleLabelPlural} work this branch's side yet — ask HR Admin for the matching designation, online or in the room.`;
  const SLOT_TYPES = isRecurring ? SESSION_TYPES : CONSULTATION_TYPES;
  // The three calendars schedule different things and must not be read as interchangeable:
  // a Head Physio's day holds consultations (booked from Branch Leads → Appointment);
  // a Physio's day holds treatment sessions; a Coach's day holds diet check-ins.
  const purpose = isCoach ? "Diet Check-ins" : isRehab ? "Rehab Sessions" : isPhysio ? "Treatment Sessions" : "Consultations";
  const purposeLine = isCoach
    ? "Diet check-in days only — booked against a patient's diet plan."
    : isRehab
    ? "Rehab sessions only — booked against a patient's rehab course."
    : isPhysio
    ? "Treatment sessions only — booked against a patient's session package."
    : "Consultations only — booked from Branch Leads → Appointment.";

  const [doctors, setDoctors] = useState([]);
  const [selectedDoctor, setSelectedDoctor] = useState(null);
  // The services Super Admin offers, from Services and Products. Loaded once rather than
  // per expert: it is one short list and it does not change while a day is being opened.
  const [services, setServices] = useState([]);
  const [savingService, setSavingService] = useState(false);
  const [calendarData, setCalendarData] = useState(null);

  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  // Several days can be opened in one go. `selectedDates` is every day picked; the last
  // one clicked is the "focused" day whose slot grid is shown on the right, so a single
  // day out of the batch can still be fine-tuned before saving.
  const [selectedDates, setSelectedDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);

  const [slotDuration, setSlotDuration] = useState(FALLBACK_SLOT_MINUTES);
  const slotType = SLOT_TYPES[0].value;
  const [pendingSlots, setPendingSlots] = useState([]);
  const [saving, setSaving] = useState(false);
  const [unsaving, setUnsaving] = useState(false);

  // Keep the calendar honest against FITSIO STORE: a Consultation Duration of 45 mins
  // there must produce 45-minute slots here, not a hardcoded 30.
  useEffect(() => {
    let cancelled = false;
    // A diet check-in is a repeat visit against a plan, so it takes its length from the
    // same store item a treatment session does until Diet gets its own.
    listStoreItems(undefined, isRecurring ? "session" : "consultation")
      .then((items) => {
        const configured = (items || []).map((i) => i.duration_minutes).find((d) => Number(d) > 0);
        if (!cancelled && configured) setSlotDuration(Number(configured));
      })
      .catch(() => { /* keep the fallback */ });
    return () => { cancelled = true; };
  }, [isRecurring]);

  // Head Physios are common to every branch — they're created once in HR Admin and take
  // consultations wherever they're needed, so this lists all of them rather than only the
  // ones carrying this branch's id. Physios are not: they deliver treatment at the branch
  // they belong to, so PHYSIO CALENDAR stays branch-scoped.
  //
  // Listing them by user account also collapses the duplicate doctors records the
  // multi-branch model leaves behind — one Head Physio appears once, and the record with
  // their published slots is the one kept.
  const loadDoctors = useCallback(async () => {
    if (!branchId) return;
    try {
      // The branch is named for consultants too now. It does not narrow them to that
      // branch — they are org-wide and the endpoint keeps them regardless — but it is what
      // tells the server which vertical this calendar is, so an online branch is offered
      // the consultants who take video appointments and an offline one those who take them
      // in the room. Before this every branch was offered all of them.
      const all = await getDoctors({ branch_id: branchId });
      const mine = (all || []).filter((d) => d.profile_type === profileType);
      // One row per person, not per record. An expert covering several branches holds one
      // doctors record per branch by design, and several paths can add one — so the raw
      // list repeats the same person once per record they have ever been given. This
      // collapsed the Head Physio list from the day it was written; every other calendar
      // listed the records raw, which is how two Nutritionists came to fill a column with
      // twenty-one identical rows.
      //
      // The record kept is the one with slots on it, so collapsing never hides the
      // calendar somebody has actually published.
      const best = new Map();
      mine.forEach((d) => {
        const key = d.user_id || d.employee_id || d.full_name || d.id;
        const seen = best.get(key);
        if (!seen || (d.slots || []).length > (seen.slots || []).length) best.set(key, d);
      });
      setDoctors([...best.values()].sort((a, b) => (a.full_name || "").localeCompare(b.full_name || "")));
    } catch { /* silent */ }
  }, [branchId, profileType]);

  useEffect(() => { loadDoctors(); }, [loadDoctors]);

  // Only the treatment calendar asks: a consultation and a diet check-in are the service,
  // where a physio's day could be any of several the clinic sells.
  useEffect(() => {
    if (!isPhysio) return;
    getPhysioTypes().then(setServices).catch(() => setServices([]));
  }, [isPhysio]);

  const changeService = async (name) => {
    if (!selectedDoctor) return;
    setSavingService(true);
    try {
      await setDoctorService(selectedDoctor.id, name);
      // Patched on both copies: the card in the list and the header above the grid read
      // from different objects, and reloading the whole board to move one word would
      // close the day that is mid-publish.
      setSelectedDoctor((d) => (d ? { ...d, service_type: name } : d));
      setDoctors((all) => all.map((d) => (d.id === selectedDoctor.id ? { ...d, service_type: name } : d)));
      toast.success(name ? `Offered under ${name}` : "Service cleared");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not set the service");
    }
    setSavingService(false);
  };

  const loadCalendar = useCallback(async () => {
    if (!selectedDoctor) { setCalendarData(null); return; }
    try {
      const data = await getDoctorCalendar(selectedDoctor.id);
      setCalendarData(data);
    } catch { /* silent */ }
  }, [selectedDoctor]);

  useEffect(() => { loadCalendar(); }, [loadCalendar]);

  // The branch's shifts, so the working window can be set from the calendar itself rather
  // than only from TIME MANAGEMENT — the moment you notice a physio's day is opening at
  // the wrong hours is while you are publishing it. Same list, same effect, one screen
  // closer. Silent on failure: the picker just doesn't appear.
  const [shifts, setShifts] = useState([]);
  const [savingShift, setSavingShift] = useState(false);
  // The shift picker, opened as the calendar's own dialog rather than dropped from the
  // control. A native list here is unstyleable and reads as a browser widget beside a
  // calendar that is anything but.
  const [shiftPicker, setShiftPicker] = useState(false);
  const [savingDayShift, setSavingDayShift] = useState(false);

  const loadShifts = useCallback(async () => {
    if (!branchId) return;
    try {
      const data = await listShifts(branchId);
      setShifts(data?.shifts || []);
    } catch { setShifts([]); }
  }, [branchId]);

  useEffect(() => { loadShifts(); }, [loadShifts]);

  const [savingCapacity, setSavingCapacity] = useState(false);

  // Lowering this never evicts anyone. Slots already over the new number stay booked and
  // simply stop accepting more — cancelling a patient's treatment day as a side effect of
  // a settings change is not something a dropdown should be able to do.
  const saveCapacity = async (n) => {
    if (!selectedDoctor) return;
    setSavingCapacity(true);
    try {
      await setDoctorSlotCapacity(selectedDoctor.id, n);
      toast.success(`${selectedDoctor.full_name} now takes ${n} patient${n > 1 ? "s" : ""} per slot`);
      await loadCalendar();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not change the slot capacity");
    }
    setSavingCapacity(false);
  };

  // The shift window and the day grid it cuts, above the handlers that reach for them.
  // These were written two hundred lines lower, which is where a const starts existing —
  // so saveDayShift was restaging a day against bindings that did not exist yet.
  //
  // The working window a day is opened across. It comes from the shift this expert is on
  // (MANAGEMENT → TIME MANAGEMENT): a Morning physio's day is cut 7:00 AM – 2:00 PM, an
  // Evening one's 3:00 PM – 7:00 PM. Nobody rostered falls back to the fixed 8:00 AM –
  // 10:00 PM this calendar used before shifts existed, so an unassigned expert behaves
  // exactly as they always did.
  //
  // Every generated slot finishes inside the window — a 45-minute slot is not offered at
  // 1:30 PM on a day that ends at 2:00.
  const shift = calendarData?.shift || null;
  // Days this expert worked something other than their usual shift, keyed by date. A shift
  // is a pattern, not a contract — a Morning physio who comes in full-time on Tuesday is
  // normal, and the roster has to be able to say so without moving them off Morning.
  const dayShifts = calendarData?.day_shifts || {};

  /** The window one date is opened across: its own one-off, else the usual, else the default. */
  const windowFor = (date) => (date && dayShifts[date]) || shift || null;
  const labelOf = (w) => (w?.shift_name ? `${w.shift_name} · ${to12h(w.start_time)} – ${to12h(w.end_time)}` : "");

  const gridTimes = (w) => {
    const slots = [];
    const step = slotDuration || 30;
    const from = minutesOf(w?.start_time) ?? 8 * 60;
    const to = minutesOf(w?.end_time) ?? 22 * 60;
    for (let m = from; m + step <= to; m += step) {
      slots.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
    }
    return slots;
  };

  // Every free slot of a day, staged as an addition. Anything already published for that
  // date, and anything booked, is skipped so this never duplicates or disturbs a booking.
  // `windowOverride` is for the moment a day's shift is changed: the new window is known
  // from the response before calendarData has been reloaded, so the day re-cuts straight
  // away instead of one render behind.
  const stagedSlotsForDay = (d, windowOverride) => {
    const alreadyOpen = new Set((calendarData?.slots || []).filter((s) => s.startsWith(`${d}T`)));
    return gridTimes(windowOverride || windowFor(d))
      .filter((time) => {
        const full = `${d}T${time}`;
        return !alreadyOpen.has(full) && !calendarData?.booked?.[full];
      })
      .map((time) => ({ slot_time: `${d}T${time}`, duration: slotDuration, consultation_type: slotType }));
  };

  // Staged days are dropped with it: they were filled in across the old window, and half a
  // morning shift plus half an evening one is not a day anyone meant to publish.
  const saveShift = async (shiftId) => {
    if (!selectedDoctor) return;
    setSavingShift(true);
    try {
      const updated = await setDoctorShift(selectedDoctor.id, shiftId);
      toast.success(
        shiftId
          ? `${selectedDoctor.full_name} works ${updated.shift_name} · ${to12h(updated.shift_start)} – ${to12h(updated.shift_end)}`
          : `${selectedDoctor.full_name} taken off their shift — full day again`,
      );
      setPendingSlots([]);
      setSelectedDates([]);
      setSelectedDate(null);
      await loadCalendar();
      await loadDoctors();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not set the shift");
    }
    setSavingShift(false);
  };

  // The exception to the usual shift: these particular days run on a different one. The
  // expert stays on their own shift — this is "Akshya is on Morning and came in full-time
  // on the 18th", not a change of roster, so nothing on the left panel moves.
  //
  // Applies to every day currently selected, because picking three Saturdays and calling
  // them evenings is one decision rather than three.
  const saveDayShift = async (shiftId) => {
    const dates = selectedDates.length > 0 ? selectedDates : selectedDate ? [selectedDate] : [];
    if (!selectedDoctor || dates.length === 0) return;
    setSavingDayShift(true);
    try {
      const res = await setDoctorDayShift(selectedDoctor.id, dates, shiftId);
      const nextDayShifts = res?.day_shifts || {};
      // Merged in rather than waiting on a reload, so the grid re-cuts on the same click.
      setCalendarData((prev) => (prev ? { ...prev, day_shifts: nextDayShifts } : prev));
      // Restage the affected days across their new window. Anything staged under the old
      // one is dropped: half a morning plus half an evening is not a day anyone meant.
      setPendingSlots((prev) => [
        ...prev.filter((s) => !dates.some((d) => s.slot_time.startsWith(`${d}T`))),
        ...dates.flatMap((d) => stagedSlotsForDay(d, nextDayShifts[d] || shift)),
      ]);
      const dayLabel = dates.length === 1 ? shortDate(dates[0]) : `${dates.length} days`;
      toast.success(
        shiftId
          ? `${dayLabel}: ${labelOf(nextDayShifts[dates[0]]) || "shift set"}`
          : `${dayLabel} back on ${shift?.shift_name || "the usual day"}`,
      );
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not change the day's shift");
    }
    setSavingDayShift(false);
  };

  // The video room this expert meets patients in, as typed. Held apart from the record so
  // the field can be edited without every keystroke claiming to be saved, and so Save has
  // something to compare against.
  //
  // Above selectDoctor, which sets it, for the reason the shift window above is: a const
  // starts existing where it is written, and a handler reaching back up the file is the
  // one arrangement that always works.
  const [meetDraft, setMeetDraft] = useState("");
  const [savingMeet, setSavingMeet] = useState(false);
  const meetSaved = (selectedDoctor?.meet_link || "").trim();
  const meetDirty = meetDraft.trim() !== meetSaved;

  const selectDoctor = (doc) => {
    setSelectedDoctor(doc);
    setSelectedDate(null);
    setSelectedDates([]);
    setPendingSlots([]);
    // Their own room, not the last one that was typed. The field below is one input reused
    // by everybody in the list, so without this it would open on the previous expert's
    // link — which then reads as this expert's, and saves as theirs on the next click.
    setMeetDraft(doc?.meet_link || "");
  };

  const saveMeetLink = async () => {
    if (!selectedDoctor) return;
    setSavingMeet(true);
    try {
      const res = await setDoctorMeetLink(selectedDoctor.id, meetDraft.trim());
      // What the server made of it, not what was typed: a link entered without a scheme
      // comes back with https on the front, and the field has to show the address that was
      // actually stored rather than leave the reader believing they saved the other one.
      const saved = res?.meet_link ?? meetDraft.trim();
      setMeetDraft(saved);
      // Both copies, the same way changeService patches them: the list card and the header
      // read different objects, and reloading the board would close a day mid-publish.
      // Every record of this person was written, so every row of theirs is patched.
      const samePerson = (d) =>
        d.id === selectedDoctor.id
        || (selectedDoctor.user_id && d.user_id === selectedDoctor.user_id)
        || (selectedDoctor.employee_id && d.employee_id === selectedDoctor.employee_id);
      setSelectedDoctor((d) => (d ? { ...d, meet_link: saved } : d));
      setDoctors((all) => all.map((d) => (samePerson(d) ? { ...d, meet_link: saved } : d)));
      toast.success(saved ? `${selectedDoctor.full_name} meets at this link` : "Meeting link cleared");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save the meeting link");
    }
    setSavingMeet(false);
  };

  // If the store's duration arrives (or is changed) after a day was already filled in,
  // those staged slots were built on the old length — drop them rather than saving a
  // day that's half 30-minute and half 45-minute.
  useEffect(() => {
    setSelectedDate(null);
    setSelectedDates([]);
    setPendingSlots([]);
  }, [slotDuration]);


  // Picking a date IS the availability confirmation — the whole working day fills in
  // straight away rather than making the Branch Admin click every slot by hand. Clicking
  // it again deselects that day and drops its staged slots. Everything lands staged, not
  // saved, so the Save / Unsave pair still governs what actually reaches the calendar.
  const toggleDate = (d) => {
    const already = selectedDates.includes(d);
    if (already) {
      setSelectedDates((prev) => prev.filter((x) => x !== d));
      setPendingSlots((prev) => prev.filter((s) => !s.slot_time.startsWith(`${d}T`)));
      setSelectedDate((curr) => (curr === d ? selectedDates.filter((x) => x !== d).slice(-1)[0] || null : curr));
      return;
    }
    setSelectedDates((prev) => [...prev, d]);
    setSelectedDate(d);
    setPendingSlots((prev) => [...prev.filter((s) => !s.slot_time.startsWith(`${d}T`)), ...stagedSlotsForDay(d)]);
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

  const shiftLabel = labelOf(shift);
  // What the focused day actually runs, and whether that differs from the usual.
  const dayWindow = windowFor(selectedDate);
  const dayShiftLabel = labelOf(dayWindow);
  const isOverridden = !!(selectedDate && dayShifts[selectedDate]);


  const generateTimeGrid = (date) => gridTimes(windowFor(date));

  // What the day actually renders: the shift's grid, plus any time already published or
  // booked outside it. A shift narrowed after slots were published would otherwise hide
  // them — still on the calendar, still bookable, but with no way left to see or remove
  // them. Shown means Unsave can reach them.
  const displayTimeGrid = () => {
    const grid = generateTimeGrid(selectedDate);
    if (!selectedDate) return grid;
    const outside = new Set();
    const collect = (slotTime) => {
      if (slotTime.startsWith(`${selectedDate}T`)) outside.add(slotTime.slice(11, 16));
    };
    (calendarData?.slots || []).forEach(collect);
    Object.keys(calendarData?.booked || {}).forEach(collect);
    return [...new Set([...grid, ...outside])].sort();
  };

  const dayTimes = displayTimeGrid();

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

  // Closes the selected days back down: every published slot on them is removed. Booked
  // slots are deliberately left alone — the backend refuses to drop them anyway, and a
  // patient's appointment shouldn't disappear because the day was closed.
  const unsaveDays = async () => {
    if (!selectedDoctor || selectedDates.length === 0) return;
    const published = (calendarData?.slots || []).filter((s) => selectedDates.some((d) => s.startsWith(`${d}T`)));
    const bookedCount = published.filter((s) => calendarData?.booked?.[s]).length;
    const removable = published.filter((s) => !calendarData?.booked?.[s]);

    if (removable.length === 0) {
      toast.info(bookedCount > 0 ? "Only booked slots remain — those can't be removed" : "Nothing published on these days yet");
      return;
    }
    const dayLabel = selectedDates.length === 1 ? "this day" : `these ${selectedDates.length} days`;
    if (!window.confirm(`Remove ${removable.length} open slot${removable.length > 1 ? "s" : ""} from ${dayLabel}?`)) return;

    setUnsaving(true);
    try {
      await removeCalendarSlots(selectedDoctor.id, { slot_times: removable });
      toast.success(
        `Removed ${removable.length} slot${removable.length > 1 ? "s" : ""}`
        + (bookedCount > 0 ? ` · ${bookedCount} booked slot${bookedCount > 1 ? "s" : ""} kept` : ""),
      );
      setPendingSlots([]);
      setSelectedDates([]);
      setSelectedDate(null);
      await loadCalendar();
      await loadDoctors();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to remove slots");
    }
    setUnsaving(false);
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
    <div className="flex flex-col gap-3 sm:gap-4 lg:h-[calc(100vh-220px)] lg:flex-row" data-testid="head-physio-calendar-root">
      {/* LEFT PANEL — Doctor List */}
      <div className="flex w-full flex-shrink-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white lg:h-full lg:w-72" data-testid="doctor-list-panel">
        <div className="p-4 border-b border-slate-100 bg-slate-50/60">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
              <Stethoscope className="h-4 w-4 text-violet-500" /> {roleLabelPlural}
            </h3>
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700">{doctors.length}</span>
          </div>
          <p className="mt-1 text-[10px] font-medium text-violet-500">{purposeLine}</p>
          <p className="mt-0.5 text-[10px] text-slate-400">Managed by HR Admin</p>
        </div>

        <div className="flex gap-1.5 overflow-x-auto p-2 lg:flex-1 lg:flex-col lg:overflow-y-auto lg:overflow-x-visible" data-testid="doctor-list">
          {doctors.length === 0 && (
            <p className="text-xs text-slate-400 text-center py-6">
              {emptyLine}
            </p>
          )}
          {doctors.map((doc) => {
            const isActive = selectedDoctor?.id === doc.id;
            const slotCount = (doc.slots || []).length;
            return (
              <button
                key={doc.id}
                type="button"
                onClick={() => selectDoctor(doc)}
                className={`flex w-56 shrink-0 items-center gap-2.5 rounded-lg border p-2.5 text-left transition-all sm:w-64 lg:w-full lg:shrink lg:gap-3 lg:p-3 ${
                  isActive
                    ? "border-violet-400 bg-violet-50 shadow-sm"
                    : "border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50"
                }`}
                data-testid={`doctor-card-${doc.id}`}
              >
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${isActive ? "bg-violet-200 text-violet-800" : "bg-slate-100 text-slate-600"}`}>
                  {doc.full_name?.charAt(0)?.toUpperCase() || "D"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{doc.full_name}</p>
                  {/* Their shift, not their qualification, once they are on one: which
                      hours this person works is what decides the day about to be opened
                      for them, and it is the thing to check before clicking a date. */}
                  <p className="truncate text-[10px] text-slate-400">
                    {doc.shift_name
                      ? `${doc.shift_name} · ${to12h(doc.shift_start)} – ${to12h(doc.shift_end)}`
                      : doc.service_type || doc.specialization || roleLabel}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end">
                  <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[9px] font-semibold ${slotCount > 0 ? "bg-emerald-50 text-emerald-600" : "bg-slate-50 text-slate-400"}`}>
                    {slotCount} slots
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* The expert's own video room, under the list that picked them and before the day
            being opened on the right — the address a booking made out of that day will
            carry, so it belongs to the person rather than to any one date.

            One field for the list rather than one per row: it is per expert, but only the
            selected expert's is ever being answered, and a column of eleven URL inputs is a
            column nobody can read a name out of. Nothing at all until somebody is picked,
            for the same reason the calendar beside it is empty until then. */}
        {selectedDoctor && (
          <div className="border-t border-slate-100 bg-slate-50/60 p-3" data-testid="doctor-meet-link-panel">
            <label
              htmlFor="doctor-meet-link"
              className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400"
            >
              <Video className="h-3.5 w-3.5 text-violet-500" /> Google Meet link
            </label>
            <p className="mt-0.5 text-[10px] text-slate-400">
              {selectedDoctor.full_name}&apos;s own room. Sent to the patient when a slot here is booked.
            </p>
            <div className="mt-2 flex items-center gap-1.5">
              <input
                id="doctor-meet-link"
                // text, not url: a room is as often pasted in as "meet.google.com/abc-defg-hij"
                // as with the scheme on the front, and type="url" marks that invalid while
                // the server accepts it and puts the https on. inputMode still asks a phone
                // keyboard for the URL layout.
                type="text"
                inputMode="url"
                value={meetDraft}
                onChange={(e) => setMeetDraft(e.target.value)}
                // Enter saves, because this is one field with one button and reaching for
                // the mouse to commit a line you have just finished typing is a step that
                // exists only because nobody wired the key.
                onKeyDown={(e) => { if (e.key === "Enter" && meetDirty && !savingMeet) saveMeetLink(); }}
                placeholder="meet.google.com/abc-defg-hij"
                disabled={savingMeet}
                className="h-8 min-w-0 flex-1 rounded-md border border-slate-200 px-2 text-[11px] text-slate-700 outline-none focus:border-violet-400 disabled:opacity-60"
                data-testid="doctor-meet-link-input"
              />
              <Button
                size="sm"
                onClick={saveMeetLink}
                disabled={savingMeet || !meetDirty}
                className="h-8 shrink-0 bg-violet-600 px-2.5 text-[11px] hover:bg-violet-700"
                data-testid="doctor-meet-link-save"
              >
                {savingMeet ? "..." : "Save"}
              </Button>
            </div>
            {/* The saved room, openable, so whoever typed it can check it goes where they
                meant before a patient is sent it. Only once it is saved and the field is
                back in agreement with it — offering to open a half-typed line would open
                the wrong room. */}
            {meetSaved && !meetDirty && (
              <a
                href={meetSaved}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1.5 block truncate text-[10px] font-medium text-violet-600 hover:underline"
                data-testid="doctor-meet-link-open"
              >
                Open {meetSaved.replace(/^https?:\/\//, "")}
              </a>
            )}
          </div>
        )}
      </div>

      {/* RIGHT PANEL — Calendar */}
      <div className="flex flex-1 flex-col overflow-visible rounded-xl border border-slate-200 bg-white lg:overflow-hidden" data-testid="calendar-panel">
        {!selectedDoctor ? (
          <div className="flex-1 flex items-center justify-center" data-testid="calendar-empty-state">
            <div className="text-center">
              <CalendarIcon className="h-12 w-12 text-slate-200 mx-auto mb-3" />
              <p className="text-sm text-slate-400">Select a {roleLabel} to open their {purpose.toLowerCase()} calendar</p>
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
                  <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-800">
                    {selectedDoctor.full_name}
                    {/* The shift is stated on the header rather than left to be inferred
                        from where the grid below starts — the day is being published
                        against it, so it has to be visible while publishing. */}
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${shiftLabel ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-400"}`}
                      title={shiftLabel ? "Set in MANAGEMENT → TIME MANAGEMENT" : "No shift set — the full working day is offered"}
                      data-testid="calendar-shift-chip"
                    >
                      {shiftLabel || "No shift · full day"}
                    </span>
                    {/* Which of the clinic's services this expert's day is being opened
                        under. Beside the shift because the two are the same kind of fact —
                        what is being published, and when — and both have to be right
                        before a date is clicked. A select rather than a chip: the answer
                        is set here, on the screen that asks the question. */}
                    {isPhysio && (
                      <select
                        value={selectedDoctor.service_type || ""}
                        onChange={(e) => changeService(e.target.value)}
                        disabled={savingService}
                        className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600 outline-none disabled:opacity-60"
                        title="The service this expert is offered under — from Services and Products"
                        data-testid="calendar-service-select"
                      >
                        <option value="">No service</option>
                        {services.map((sv) => (
                          <option key={sv.id} value={sv.name}>{sv.name}</option>
                        ))}
                      </select>
                    )}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    {purpose} · {slotDuration} min · {(calendarData?.slots || []).length} slots open
                    {isPhysio && ` · ${calendarData?.slot_capacity ?? 3} per slot`}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {/* Which shift this expert works. The one control on this header that
                    changes what the grid below contains rather than what a slot holds, so
                    it sits first. The list is the branch's own — edit the hours themselves
                    in MANAGEMENT → TIME MANAGEMENT. */}
                {shifts.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShiftPicker(true)}
                    disabled={savingShift}
                    className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 hover:bg-slate-50 disabled:opacity-60"
                    title="The working window this expert's day is opened across"
                    data-testid="doctor-shift-select"
                  >
                    <Clock className="h-3.5 w-3.5 text-slate-400" />
                    <span className="text-[11px] font-medium text-slate-500">Shift</span>
                    <span className="max-w-[13rem] truncate text-xs font-semibold text-slate-700">
                      {shiftLabel || "No shift — full day"}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  </button>
                )}
                {/* A physio runs a floor — two or three patients in the same hour. Set
                    here rather than assumed, because it varies by physio and by room.
                    Head Physio has no control: a consultation is one-to-one and the
                    backend pins them to 1 whatever is sent. */}
                {isPhysio && (
                  <label className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1" title="Patients this physio treats in the same slot">
                    <Users className="h-3.5 w-3.5 text-slate-400" />
                    <span className="text-[11px] font-medium text-slate-500">Per slot</span>
                    <select
                      value={calendarData?.slot_capacity ?? 3}
                      onChange={(e) => saveCapacity(Number(e.target.value))}
                      disabled={savingCapacity}
                      className="rounded border border-slate-200 bg-white px-1 py-0.5 text-xs font-semibold text-slate-700"
                      data-testid="physio-slot-capacity"
                    >
                      {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                )}
                {selectedDates.length > 0 && (
                  <span className="text-xs font-medium text-slate-500" data-testid="selected-days-count">
                    {selectedDates.length} day{selectedDates.length > 1 ? "s" : ""} selected
                  </span>
                )}
                {pendingSlots.length > 0 && (
                  <span className="text-xs text-amber-600 font-medium">{pendingSlots.length} unsaved</span>
                )}
                {pendingSlots.length > 0 && (
                  <Button size="sm" variant="outline" onClick={() => setPendingSlots([])} className="text-xs" data-testid="discard-changes-btn">Discard</Button>
                )}
                {selectedDates.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={unsaveDays}
                    disabled={unsaving}
                    className="border-rose-200 text-rose-600 hover:bg-rose-50 text-xs"
                    data-testid="unsave-slots-btn"
                  >
                    {unsaving ? "Removing..." : "Unsave"}
                  </Button>
                )}
                {pendingSlots.length > 0 && (
                  <Button size="sm" onClick={saveChanges} disabled={saving} className="bg-violet-600 hover:bg-violet-700 text-white text-xs" data-testid="save-slots-btn">
                    {saving ? "Saving..." : "Save Changes"}
                  </Button>
                )}
              </div>
            </div>

            <div className="flex flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
              {/* Month Calendar — scrolls on its own, otherwise the controls below it
                  (duration, type, Mark Whole Day Available, Repeat) get clipped by the
                  row's lg:overflow-hidden with no way to reach them. */}
              <div className="flex w-full flex-shrink-0 flex-col border-b border-slate-100 p-3 sm:p-5 lg:w-[26rem] lg:border-b-0 lg:border-r lg:overflow-y-auto">
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
                    const isPicked = selectedDates.includes(d);
                    const isFocused = selectedDate === d;
                    const isToday = d === todayStr;
                    const slotCount = countSlotsForDay(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => toggleDate(d)}
                        // A day that already has slots published is filled dark green
                        // rather than flagged with a dot — at a glance the month should
                        // show which days are open, and a 4px dot doesn't carry that far.
                        // Violet still wins for days picked in this editing session, since
                        // that is what Save Changes is about to act on.
                        className={`h-11 rounded-lg text-sm font-medium relative transition-all ${
                          isPicked
                            ? `bg-violet-600 text-white shadow-sm${isFocused ? " ring-2 ring-violet-300 ring-offset-1" : ""}`
                            : slotCount > 0
                            ? `bg-green-800 text-white shadow-sm hover:bg-green-900${isToday ? " ring-2 ring-green-300 ring-offset-1" : ""}`
                            : isToday
                            ? "bg-violet-50 text-violet-700 border border-violet-200"
                            : "text-slate-600 hover:bg-slate-100"
                        }`}
                        title={
                          dayShifts[d] ? `Works ${labelOf(dayShifts[d])} on this day`
                            : isPicked ? "Click again to deselect"
                            : slotCount > 0 ? `${slotCount} slot${slotCount === 1 ? "" : "s"} open`
                            : undefined
                        }
                        data-testid={`cal-day-${day}`}
                      >
                        {day}
                        {/* A day running something other than the usual shift. Amber, and
                            a corner dot rather than a fill, because the fill already means
                            "published" / "picked" and both remain true of this day. */}
                        {dayShifts[d] && (
                          <span
                            className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-400 ring-1 ring-white"
                            data-testid={`cal-day-override-${day}`}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>

                {selectedDate && (
                  <p className="mt-4 border-t border-slate-100 pt-3 text-[11px] text-slate-400" data-testid="calendar-day-hint">
                    {dayShiftLabel
                      ? <>Opened across <b>{dayShiftLabel}</b>{isOverridden ? " — set for this day only" : ""} at {slotDuration}-minute slots, per FITSIO STORE. </>
                      : <>Whole day opened at {slotDuration}-minute slots, per FITSIO STORE. Put them on a shift in <b>TIME MANAGEMENT</b> to cut the day to their working hours. </>}
                    Pick more dates to open several at once, or click a date again to deselect it.
                    {" "}<b>Save Changes</b> publishes them; <b>Unsave</b> closes the selected days back down.
                  </p>
                )}
              </div>

              {/* Time Slots Grid */}
              <div className="w-full flex-shrink-0 p-4 sm:p-5 lg:flex-1 lg:overflow-y-auto">
                {!selectedDate ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center">
                      <Clock className="h-8 w-8 text-slate-200 mx-auto mb-2" />
                      <p className="text-xs text-slate-400">Pick a date to open the day for {purpose.toLowerCase()}</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                      <h4 className="text-sm font-semibold text-slate-700" data-testid="selected-date-title">
                        {new Date(selectedDate + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                        {dayShiftLabel && (
                          <span className={`ml-2 text-[11px] font-medium ${isOverridden ? "text-amber-600" : "text-violet-500"}`}>
                            {dayShiftLabel}{isOverridden ? " · just this day" : ""}
                          </span>
                        )}
                      </h4>
                      <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-400">
                        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-400 inline-block" /> Available</span>
                        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-violet-400 inline-block" /> Adding</span>
                        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-red-300 inline-block" /> Removing</span>
                        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-amber-400 inline-block" /> Booked</span>
                      </div>
                    </div>
                    {/* Working a different shift on this day only. The expert stays on their
                        usual one — this is where "she's on Morning but comes in full-time
                        some days" gets said, and it has to be sayable at the moment the day
                        is being opened, not as a trip to a settings tab and back. */}
                    {shifts.length > 0 && (
                      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/70 p-2.5" data-testid="day-shift-row">
                        <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span className="text-[11px] font-medium text-slate-500">
                          {selectedDates.length > 1 ? `These ${selectedDates.length} days work` : "This day works"}
                        </span>
                        <select
                          value={(selectedDate && dayShifts[selectedDate]?.shift_id) || ""}
                          onChange={(e) => saveDayShift(e.target.value)}
                          disabled={savingDayShift}
                          className="min-w-0 max-w-full rounded border border-slate-200 bg-white px-1.5 py-1 text-xs font-semibold text-slate-700"
                          data-testid="day-shift-select"
                        >
                          <option value="">
                            {shift?.shift_name ? `${shift.shift_name} — as usual` : "The usual working day"}
                          </option>
                          {shifts.map((s) => (
                            <option key={s.id} value={s.id}>{s.name} · {to12h(s.start_time)} – {to12h(s.end_time)}</option>
                          ))}
                        </select>
                        <span className="text-[10px] text-slate-400">
                          {isOverridden
                            ? `One-off — ${selectedDoctor.full_name} stays on ${shift?.shift_name || "their usual day"}.`
                            : "Changes this day only, not their shift."}
                        </span>
                      </div>
                    )}
                    {/* A shift can be edited down to less than one slot — 7:00 to 7:20 with
                        45-minute consultations fits nothing. Said plainly, because an empty
                        grid on its own reads as the calendar being broken. */}
                    {dayTimes.length === 0 && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-center" data-testid="shift-too-short">
                        <p className="text-xs font-medium text-amber-800">
                          {dayShiftLabel || "This working window"} is shorter than one {slotDuration}-minute {isRecurring ? "session" : "consultation"}.
                        </p>
                        <p className="mt-1 text-[11px] text-amber-600">
                          Widen the shift in MANAGEMENT → TIME MANAGEMENT, or shorten the duration in FITSIO STORE.
                        </p>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="time-slots-grid">
                      {dayTimes.map((time) => {
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
                          // An open slot carries no label — only a booked one is annotated.
                          borderColor = "border-emerald-300";
                          bgColor = "bg-emerald-50";
                          textColor = "text-emerald-800";
                        } else if (state === "adding") {
                          borderColor = "border-violet-300";
                          bgColor = "bg-violet-50";
                          textColor = "text-violet-800";
                          badge = <span className="text-[9px] bg-violet-100 text-violet-600 rounded px-1.5 py-0.5">+ Adding</span>;
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

      {/* The shift, picked in the calendar's own dialog. Its clothes come from the date
          picker beside it rather than a copy of them, so the two cannot drift apart.

          A dialog and not a dropdown: this control sits in a header above a grid, inside a
          card, and a native list opening over the calendar reads as a browser widget in
          the middle of something that is anything but. */}
      {shiftPicker && (
        <CenteredPicker
          title={`Shift for ${selectedDoctor?.full_name || "this expert"}`}
          onClose={() => setShiftPicker(false)}
          testid="doctor-shift-modal"
        >
          <div className="space-y-1">
            {[
              { id: "", label: "No shift — full day", hint: "The whole working day is offered" },
              ...shifts.map((sh) => ({
                id: sh.id,
                label: sh.name,
                hint: `${to12h(sh.start_time)} – ${to12h(sh.end_time)}`,
              })),
              // A CONSULTANT is org-wide, so the shift on them can be one another branch
              // defined. Offered as it stands rather than leaving the control naming
              // something the list cannot show.
              ...(shift?.shift_id && !shifts.some((sh) => sh.id === shift.shift_id)
                ? [{
                    id: shift.shift_id,
                    label: `${shift.shift_name} (another branch)`,
                    hint: `${to12h(shift.start_time)} – ${to12h(shift.end_time)}`,
                  }]
                : []),
            ].map((opt) => {
              const on = (shift?.shift_id || "") === opt.id;
              return (
                <button
                  key={opt.id || "none"}
                  type="button"
                  disabled={savingShift}
                  onClick={() => { setShiftPicker(false); if (!on) saveShift(opt.id); }}
                  className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition disabled:opacity-60 ${
                    on ? "bg-[#F3EFE6]" : "hover:bg-[#F3EFE6]"
                  }`}
                  data-testid={`doctor-shift-option-${opt.id || "none"}`}
                >
                  <span className="min-w-0">
                    <span className={`block truncate text-sm ${on ? "font-bold text-slate-900" : "text-slate-700"}`}>{opt.label}</span>
                    <span className="block truncate text-[11px] text-slate-500">{opt.hint}</span>
                  </span>
                  {on && <CheckCircle2 className="h-4 w-4 shrink-0 text-amber-600" />}
                </button>
              );
            })}
          </div>
        </CenteredPicker>
      )}
    </div>
  );
};
