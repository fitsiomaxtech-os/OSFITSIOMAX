import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const pad = (n) => String(n).padStart(2, "0");
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const todayIso = () => {
  const d = new Date();
  return iso(d.getFullYear(), d.getMonth(), d.getDate());
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

  const TONE = {
    amber: { on: "bg-amber-500 text-white shadow-sm", today: "border border-amber-300 text-amber-700", link: "text-amber-700 hover:bg-amber-100" },
    teal: { on: "bg-teal-600 text-white shadow-sm", today: "border border-teal-300 text-teal-700", link: "text-teal-700 hover:bg-teal-100" },
    sky: { on: "bg-sky-600 text-white shadow-sm", today: "border border-sky-300 text-sky-700", link: "text-sky-700 hover:bg-sky-100" },
  }[accent] || {};

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
  placeholder = "Select date", ...rest
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const label = value
    ? new Date(`${value}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    : placeholder;

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
      {open && (
        // Right-aligned and above/below by container flow; w-max keeps the grid from being
        // squeezed by a narrow field.
        <div className="absolute left-0 z-50 mt-1 w-max">
          <MilkCalendar
            value={value}
            min={min}
            max={max}
            accent={accent}
            onChange={(d) => { onChange?.({ target: { value: d } }); setOpen(false); }}
          />
        </div>
      )}
    </div>
  );
};
