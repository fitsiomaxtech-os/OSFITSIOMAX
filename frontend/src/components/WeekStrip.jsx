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
 * The day picker every Head Physio list sits under: today's date spelled out, then the
 * seven days of that week. Defaults to today, so the board opens on the work actually
 * happening now rather than on everything ever booked. Sunday-first, to match the
 * S M T W T F S the clinic reads.
 *
 * Deliberately one compact line that sizes to its contents rather than stretching: it
 * sits above every list on the board, so the space it takes is space the day's work
 * doesn't get, and the room it leaves beside it is deliberately kept free.
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
    <div
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 ${bare ? "" : "rounded-xl border border-slate-200 bg-white px-3 py-2"}`}
      data-testid={testid}
    >
      <p className="min-w-0 truncate text-[13px] font-bold text-slate-800 sm:text-sm" data-testid={`${testid}-label`}>
        {longLabel(selected)}
        {selected === today && <span className="ml-2 rounded bg-teal-100 px-1.5 py-0.5 text-[10px] font-bold text-teal-700">TODAY</span>}
      </p>

      <div className="flex w-full items-center justify-between gap-1 sm:w-auto sm:justify-start">
        {days.map((iso, i) => {
          const active = iso === selected;
          const isToday = iso === today;
          const n = counts[iso] || 0;
          return (
            <button
              key={iso}
              type="button"
              onClick={() => onChange(iso)}
              className={`flex w-9 flex-col items-center rounded-md py-1 leading-tight transition sm:w-10 ${
                active
                  ? "bg-teal-600 text-white shadow-sm"
                  : isToday
                  ? "border border-teal-300 bg-teal-50 text-teal-700 hover:bg-teal-100"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
              title={longLabel(iso)}
              data-testid={`${testid}-day-${iso}`}
            >
              <span className={`text-[9px] font-bold uppercase ${active ? "text-white/80" : "text-slate-400"}`}>{DOW[i]}</span>
              <span className="text-sm font-bold">{Number(iso.slice(8, 10))}</span>
              {n > 0 && (
                <span className={`rounded-full px-1 text-[8px] font-bold ${active ? "bg-white/25 text-white" : "bg-slate-200 text-slate-600"}`}>{n}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Wider gaps on a phone only. At gap-1 the two chevrons are 4px apart and read as
          one control, and they are thumb targets there rather than pointer targets — the
          group wraps onto its own line at that width, so the room costs nothing. Desktop
          keeps the tight spacing it had. */}
      <div className="flex shrink-0 items-center gap-2.5 sm:gap-1">
        {selected !== today && (
          <button
            type="button"
            onClick={() => onChange(today)}
            className="rounded-md border border-teal-200 bg-teal-50 px-2 py-1 text-[11px] font-bold text-teal-700 hover:bg-teal-100"
            data-testid={`${testid}-today`}
          >
            Today
          </button>
        )}
        <button type="button" onClick={() => shiftWeek(-1)} className="rounded-md border border-slate-200 p-1 text-slate-500 hover:bg-slate-50" aria-label="Previous week" data-testid={`${testid}-prev`}>
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={() => shiftWeek(1)} className="rounded-md border border-slate-200 p-1 text-slate-500 hover:bg-slate-50" aria-label="Next week" data-testid={`${testid}-next`}>
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
};

export default WeekStrip;
