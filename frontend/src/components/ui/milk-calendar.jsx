import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, X } from "lucide-react";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const pad = (n) => String(n).padStart(2, "0");
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const todayIso = () => {
  const d = new Date();
  return iso(d.getFullYear(), d.getMonth(), d.getDate());
};

// Shared by the date and time pickers so a popup carries one colour through both.
const TONES = {
  amber: { on: "bg-amber-500 text-white shadow-sm", today: "border border-amber-300 text-amber-700", link: "text-amber-700 hover:bg-amber-100" },
  teal: { on: "bg-teal-600 text-white shadow-sm", today: "border border-teal-300 text-teal-700", link: "text-teal-700 hover:bg-teal-100" },
  sky: { on: "bg-sky-600 text-white shadow-sm", today: "border border-sky-300 text-sky-700", link: "text-sky-700 hover:bg-sky-100" },
};

const minutesOf = (hhmm) => {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  return Number.isFinite(h) ? h * 60 + (m || 0) : null;
};

/** "14:30" → "2:30 PM". Values stay 24h `HH:MM` on the wire; only the label is 12h. */
export const formatSlotLabel = (hhmm) => {
  const mins = minutesOf(hhmm);
  if (mins == null) return "";
  const h = Math.floor(mins / 60);
  return `${h % 12 === 0 ? 12 : h % 12}:${pad(mins % 60)} ${h >= 12 ? "PM" : "AM"}`;
};

/**
 * An always-open month picker in the OS's own palette, for popups where the native
 * `<input type="date">` picker looked like a browser dialog dropped onto the page — its
 * chrome, its blue, its typography, none of which can be styled.
 *
 * Milk white rather than pure white so it reads as a distinct surface against the white
 * popup behind it without needing a heavy border. `accent` lets a popup carry its own
 * colour through the picker: amber for Follow Up, teal elsewhere.
 */
export const MilkCalendar = ({ value, onChange, min, accent = "amber", testid = "milk-calendar" }) => {
  const today = todayIso();
  const [cursor, setCursor] = useState(() => {
    const base = value || today;
    const [y, m] = base.split("-").map(Number);
    return { y, m: (m || 1) - 1 };
  });

  const firstDow = new Date(cursor.y, cursor.m, 1).getDay();
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const step = (delta) => setCursor(({ y, m }) => {
    const d = new Date(y, m + delta, 1);
    return { y: d.getFullYear(), m: d.getMonth() };
  });

  const TONE = TONES[accent] || TONES.amber;

  return (
    <div className="rounded-xl border border-[#EFEAE0] bg-[#FDFCF8] p-3 shadow-sm" data-testid={testid}>
      <div className="mb-2 flex items-center justify-between">
        <button type="button" onClick={() => step(-1)} className="rounded-lg p-1.5 text-slate-500 hover:bg-[#F3EFE6]" aria-label="Previous month" data-testid={`${testid}-prev`}>
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="text-sm font-bold text-slate-800" data-testid={`${testid}-month`}>{MONTHS[cursor.m]} {cursor.y}</p>
        <button type="button" onClick={() => step(1)} className="rounded-lg p-1.5 text-slate-500 hover:bg-[#F3EFE6]" aria-label="Next month" data-testid={`${testid}-next`}>
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {DOW.map((d) => (
          <div key={d} className="py-1 text-center text-[10px] font-bold uppercase tracking-wide text-slate-400">{d}</div>
        ))}
        {Array.from({ length: firstDow }, (_, i) => <div key={`pad-${i}`} className="h-8" />)}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const d = iso(cursor.y, cursor.m, day);
          const disabled = min ? d < min : false;
          const selected = d === value;
          const isToday = d === today;
          return (
            <button
              key={day}
              type="button"
              disabled={disabled}
              onClick={() => onChange(d)}
              className={`h-8 rounded-lg text-[13px] font-semibold transition ${
                selected ? TONE.on
                  : disabled ? "cursor-not-allowed text-slate-300"
                  : isToday ? TONE.today
                  : "text-slate-600 hover:bg-[#F3EFE6]"
              }`}
              data-testid={`${testid}-day-${day}`}
            >
              {day}
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex items-center justify-between border-t border-[#EFEAE0] pt-2">
        <button
          type="button"
          onClick={() => { setCursor({ y: new Date().getFullYear(), m: new Date().getMonth() }); onChange(today); }}
          className={`rounded-md px-2 py-1 text-[11px] font-bold ${TONE.link}`}
          data-testid={`${testid}-today`}
        >
          Today
        </button>
        <p className="text-[11px] font-medium text-slate-500" data-testid={`${testid}-selected`}>
          {value
            ? new Date(`${value}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
            : "No date picked"}
        </p>
      </div>
    </div>
  );
};

export default MilkCalendar;


/**
 * The shell both fields use in `centered` mode: an ordinary dialog over the popup that
 * opened it. A panel anchored to the field is clipped by the `overflow-hidden` on a modal
 * card, which swallows the last week of the month and the Today link.
 */
const CenteredPicker = ({ title, onClose, testid, children }) => (
  <div
    className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-3 backdrop-blur-sm sm:p-4"
    onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    data-testid={testid}
  >
    <div className="max-h-[90vh] w-full max-w-xs overflow-y-auto rounded-2xl border border-[#EFEAE0] bg-[#FDFCF8] p-3 shadow-2xl sm:max-w-sm">
      <div className="mb-2 flex items-center justify-between px-1">
        <p className="text-sm font-bold text-slate-800">{title}</p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-1.5 text-slate-400 hover:bg-[#F3EFE6] hover:text-slate-600"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {children}
    </div>
  </div>
);


/**
 * A date field that opens the calendar above in a popover, instead of whatever picker the
 * browser would show. Chrome's desktop dialog and the Android/iOS wheel are both
 * unstyleable and neither looks like the rest of the OS — on a phone especially, tapping a
 * date threw up a full-screen system control mid-form.
 *
 * Drop-in for `<Input type="date">`: onChange receives an event-shaped
 * `{ target: { value } }`, so existing `(e) => ...e.target.value` handlers keep working.
 */
export const MilkDateInput = ({
  value, onChange, min, max, disabled, className = "", accent = "amber",
  placeholder = "Select date", centered = false, title = "Select Date", ...rest
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    // A centred dialog is dismissed by its own backdrop; a document listener here would
    // also fire for clicks inside it.
    if (!open || centered) return undefined;
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open, centered]);

  const label = value
    ? new Date(`${value}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    : placeholder;

  const pick = (d) => { onChange?.({ target: { value: d } }); setOpen(false); };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-left text-sm shadow-sm disabled:cursor-not-allowed disabled:opacity-50 ${value ? "text-slate-800" : "text-muted-foreground"} ${className}`}
        {...rest}
      >
        <span className="truncate">{label}</span>
        <CalendarDays className="h-4 w-4 shrink-0 text-slate-400" />
      </button>

      {/* `centered` opens the calendar as a normal dialog in the middle of the screen
          instead of a panel hanging off the field. Anchored is right for a plain page form,
          where the calendar sits under the input it fills; it is wrong in a toolbar above a
          table, where the panel opens over the rows and gets clipped by whatever scrolls,
          and wrong inside a popup, where the card's own clipping cuts the grid off. */}
      {open && (centered ? (
        <CenteredPicker title={title} onClose={() => setOpen(false)} testid={`${rest["data-testid"] || "milk-date"}-modal`}>
          <MilkCalendar value={value} min={min} max={max} accent={accent} onChange={pick} />
        </CenteredPicker>
      ) : (
        // Right-aligned and above/below by container flow; w-max keeps the grid from being
        // squeezed by a narrow field.
        <div className="absolute left-0 z-50 mt-1 w-max">
          <MilkCalendar value={value} min={min} max={max} accent={accent} onChange={pick} />
        </div>
      ))}
    </div>
  );
};


/** Clinic hours. Appointments are taken between these, in half-hour slots. */
export const SLOT_DAY_START = "10:00";
export const SLOT_DAY_END = "22:00";

/**
 * The bookable half-hours of a day as chips, in the OS's palette.
 *
 * A free-text clock let anyone type 03:17, or 4am — times no branch is open for. Slots
 * make the answer a pick from what the clinic actually offers, and the grid reads at a
 * glance in a way a stepper never does.
 *
 * A `value` outside the range still shows, as its own chip ahead of the grid: older
 * bookings and branch hours predate these limits and must not be silently rewritten by
 * merely opening the picker.
 */
export const MilkTimeSlots = ({
  value, onChange, from = SLOT_DAY_START, to = SLOT_DAY_END, step = 30,
  accent = "amber", testid = "milk-time",
}) => {
  const TONE = TONES[accent] || TONES.amber;
  const slots = useMemo(() => {
    const start = minutesOf(from) ?? 600;
    const end = minutesOf(to) ?? 1320;
    const out = [];
    for (let t = start; t <= end; t += step) out.push(`${pad(Math.floor(t / 60))}:${pad(t % 60)}`);
    return out;
  }, [from, to, step]);

  const offGrid = value && !slots.includes(value) ? value : null;

  return (
    <div className="rounded-xl border border-[#EFEAE0] bg-[#FDFCF8] p-3 shadow-sm" data-testid={testid}>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-bold text-slate-800">Pick a Slot</p>
        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
          {formatSlotLabel(slots[0])} – {formatSlotLabel(slots[slots.length - 1])}
        </p>
      </div>

      {offGrid && (
        <button
          type="button"
          onClick={() => onChange(offGrid)}
          className={`mb-2 w-full rounded-lg px-2 py-1.5 text-[12px] font-semibold ${TONE.on}`}
          data-testid={`${testid}-offgrid`}
        >
          {formatSlotLabel(offGrid)} <span className="font-medium opacity-80">· outside clinic hours</span>
        </button>
      )}

      <div className="grid max-h-[240px] grid-cols-3 gap-1 overflow-y-auto sm:grid-cols-4" data-testid={`${testid}-grid`}>
        {slots.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onChange(s)}
            className={`h-8 rounded-lg px-1 text-[12px] font-semibold transition ${
              s === value ? TONE.on : "text-slate-600 hover:bg-[#F3EFE6]"
            }`}
            data-testid={`${testid}-slot-${s}`}
          >
            {formatSlotLabel(s)}
          </button>
        ))}
      </div>

      <div className="mt-2 flex items-center justify-between border-t border-[#EFEAE0] pt-2">
        <p className="text-[11px] font-bold text-slate-400">{slots.length} slots</p>
        <p className="text-[11px] font-medium text-slate-500" data-testid={`${testid}-selected`}>
          {value ? formatSlotLabel(value) : "No time picked"}
        </p>
      </div>
    </div>
  );
};

/**
 * A time field that opens the slot grid above, replacing `<input type="time">` — whose
 * picker is the browser's spinner column, unstyleable and happy to accept any minute of
 * the night.
 *
 * Drop-in: the value stays 24h `HH:MM` and onChange receives `{ target: { value } }`, so
 * existing handlers and everything downstream are untouched.
 */
export const MilkTimeInput = ({
  value, onChange, disabled, className = "", accent = "amber",
  from = SLOT_DAY_START, to = SLOT_DAY_END, step = 30,
  placeholder = "Select time", centered = false, title = "Select Time", ...rest
}) => {
  const [open, setOpen] = useState(false);
  const [drop, setDrop] = useState("down");
  const ref = useRef(null);

  useEffect(() => {
    // As on the date field: a centred dialog closes on its own backdrop, so a document
    // listener here would also catch clicks on the slots inside it.
    if (!open || centered) return undefined;
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open, centered]);

  // These sit low in tall popups (Follow Up puts Time under a full month grid), where a
  // downward panel would open past the bottom of the screen.
  const toggle = () => {
    if (!open && !centered && ref.current) {
      const box = ref.current.getBoundingClientRect();
      setDrop(window.innerHeight - box.bottom < 340 && box.top > 340 ? "up" : "down");
    }
    setOpen((o) => !o);
  };

  const pick = (t) => { onChange?.({ target: { value: t } }); setOpen(false); };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={toggle}
        className={`flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-left text-sm shadow-sm disabled:cursor-not-allowed disabled:opacity-50 ${value ? "text-slate-800" : "text-muted-foreground"} ${className}`}
        {...rest}
      >
        <span className="truncate">{value ? formatSlotLabel(value) : placeholder}</span>
        <Clock className="h-4 w-4 shrink-0 text-slate-400" />
      </button>
      {open && (centered ? (
        <CenteredPicker title={title} onClose={() => setOpen(false)} testid={`${rest["data-testid"] || "milk-time"}-modal`}>
          <MilkTimeSlots value={value} from={from} to={to} step={step} accent={accent} onChange={pick} />
        </CenteredPicker>
      ) : (
        <div className={`absolute left-0 z-50 w-max min-w-full ${drop === "up" ? "bottom-full mb-1" : "mt-1"}`}>
          <MilkTimeSlots value={value} from={from} to={to} step={step} accent={accent} onChange={pick} />
        </div>
      ))}
    </div>
  );
};
