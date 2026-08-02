import { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

const DOW = ["S", "M", "T", "W", "T", "F", "S"];
const pad = (n) => String(n).padStart(2, "0");
export const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayIso = () => isoDay(new Date());

/** "2026-08-02" -> "Sunday, 02 - 08 - 2026" */
const longLabel = (iso) => {
  const d = new Date(`${iso}T00:00:00`);
  const [y, m, day] = iso.split("-");
  return `${d.toLocaleDateString("en-US", { weekday: "long" })}, ${day} - ${m} - ${y}`;
};

/**
 * The day picker every Head Physio tab sits under: today's date spelled out, then the
 * seven days of that week. Defaults to today, so the board opens on the work that is
 * actually happening now rather than on everything ever booked.
 *
 * Sunday-first to match the S M T W T F S the clinic reads.
 */
export const WeekStrip = ({ value, onChange, counts = {}, testid = "week-strip", bare = false }) => {
  const today = todayIso();
  const selected = value || today;

  const days = useMemo(() => {
    const d = new Date(`${selected}T00:00:00`);
    const sunday = new Date(d);
    sunday.setDate(d.getDate() - d.getDay());
    return Array.from({ length: 7 }, (_, i) => {
      const day = new Date(sunday);
      day.setDate(sunday.getDate() + i);
      return isoDay(day);
    });
  }, [selected]);

  const shiftWeek = (delta) => {
    const d = new Date(`${selected}T00:00:00`);
    d.setDate(d.getDate() + delta * 7);
    onChange(isoDay(d));
  };

  return (
    // `bare` drops the card chrome so this can sit inside a row the parent already owns.
    <div className={bare ? "" : "rounded-xl border border-slate-200 bg-white p-3 sm:p-4"} data-testid={testid}>
      <div className={`flex items-center justify-between gap-2 ${bare ? "mb-1.5" : "mb-3"}`}>
        <p className={`min-w-0 truncate font-bold text-slate-800 ${bare ? "text-xs sm:text-[13px]" : "text-[13px] sm:text-base"}`} data-testid={`${testid}-label`}>
          {longLabel(selected)}
          {selected === today && <span className="ml-2 rounded-md bg-teal-100 px-2 py-0.5 text-[11px] font-bold text-teal-700">TODAY</span>}
        </p>
        <div className="flex shrink-0 items-center gap-1.5">
          {selected !== today && (
            <button
              type="button"
              onClick={() => onChange(today)}
              className="rounded-md border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-bold text-teal-700 hover:bg-teal-100"
              data-testid={`${testid}-today`}
            >
              Today
            </button>
          )}
          <button type="button" onClick={() => shiftWeek(-1)} className="rounded-md border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50" aria-label="Previous week" data-testid={`${testid}-prev`}>
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => shiftWeek(1)} className="rounded-md border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50" aria-label="Next week" data-testid={`${testid}-next`}>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className={`grid grid-cols-7 ${bare ? "gap-1" : "gap-1 sm:gap-2"}`}>
        {days.map((iso, i) => {
          const active = iso === selected;
          const isToday = iso === today;
          const n = counts[iso] || 0;
          return (
            <button
              key={iso}
              type="button"
              onClick={() => onChange(iso)}
              className={`relative flex flex-col items-center rounded-lg transition ${bare ? "px-2 py-1.5" : "py-2 sm:py-2.5"} ${
                active
                  ? "bg-teal-600 text-white shadow-sm"
                  : isToday
                  ? "border border-teal-300 bg-teal-50 text-teal-700 hover:bg-teal-100"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
              data-testid={`${testid}-day-${iso}`}
            >
              <span className={`font-bold uppercase ${bare ? "text-[9px]" : "text-[10px] sm:text-[11px]"} ${active ? "text-white/80" : "text-slate-400"}`}>{DOW[i]}</span>
              <span className={`font-bold ${bare ? "text-sm" : "text-base sm:text-lg"}`}>{Number(iso.slice(8, 10))}</span>
              {n > 0 && (
                <span className={`mt-0.5 rounded-full px-1.5 text-[9px] font-bold sm:text-[10px] ${active ? "bg-white/25 text-white" : "bg-slate-200 text-slate-600"}`}>
                  {n}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default WeekStrip;
