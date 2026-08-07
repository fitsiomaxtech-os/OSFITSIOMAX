import { useMemo, useState } from "react";
import { Calendar as CalendarIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { MilkCalendar, MilkDateInput } from "@/components/ui/milk-calendar";

/**
 * DateFilterPopover
 *
 * Controlled date filter with:
 *  - Left rail of quick presets (Today, Yesterday, Last Month, This Month, Custom Range).
 *  - Right side: single-month calendar to pick an exact date.
 *  - An exit (close) button top-right of the popup, and no explicit "All Leads" preset —
 *    clearing back to the unfiltered default is done via the small x on the active chip.
 *
 * Props:
 *  - value: { type: "single" | "range" | null, from: Date|null, to: Date|null, label: string }
 *  - onChange: (next) => void
 *  - testid: string (optional)
 */

const startOfDay = (d) => { const n = new Date(d); n.setHours(0, 0, 0, 0); return n; };
const endOfDay = (d) => { const n = new Date(d); n.setHours(23, 59, 59, 999); return n; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfMonth = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), 1); return startOfDay(x); };
const endOfMonth = (d) => endOfDay(new Date(d.getFullYear(), d.getMonth() + 1, 0));
const startOfPrevMonth = (d) => startOfMonth(new Date(d.getFullYear(), d.getMonth() - 1, 1));
const endOfPrevMonth = (d) => endOfDay(new Date(d.getFullYear(), d.getMonth(), 0));

const fmtShort = (d) => d ? d.toLocaleDateString(undefined, { day: "2-digit", month: "short" }) : "";

const presets = (today) => ([
  { key: "today",      label: "Today",      from: startOfDay(today),           to: endOfDay(today) },
  { key: "yesterday",  label: "Yesterday",  from: startOfDay(addDays(today, -1)), to: endOfDay(addDays(today, -1)) },
  { key: "last_month", label: "Last Month", from: startOfPrevMonth(today),     to: endOfPrevMonth(today) },
  { key: "this_month", label: "This Month", from: startOfMonth(today),         to: endOfMonth(today) },
]);

const toInputValue = (d) => d ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : "";

/** "2026-08-04" -> "04-08-2026", for showing an already-set range back in a typed field. */
const isoToManual = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
};

/** "04-08-2026" -> "2026-08-04", or "" if it isn't a real date.
 *
 *  Accepts - / and . as separators and a single-digit day or month, because that is what
 *  people type. Rejects 31-02 rather than letting the Date constructor roll it forward to
 *  the 3rd of March, which would silently filter on a day nobody asked for. */
const manualToIso = (text) => {
  const m = /^\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{4})\s*$/.exec(text || "");
  if (!m) return "";
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const d = new Date(`${iso}T00:00:00`);
  const real = d.getFullYear() === year && d.getMonth() + 1 === month && d.getDate() === day;
  return real ? iso : "";
};

export const DateFilterPopover = ({ value, onChange, testid = "date-filter", centered = false, placeholder = "Date Filter" }) => {
  const [open, setOpen] = useState(false);
  const [showRange, setShowRange] = useState(false);
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [rangeFromText, setRangeFromText] = useState("");
  const [rangeToText, setRangeToText] = useState("");
  const today = useMemo(() => new Date(), []);
  const list = useMemo(() => presets(today), [today]);

  const apply = (p) => {
    onChange({ key: p.key, label: p.label, from: p.from, to: p.to });
    setShowRange(false);
    setOpen(false);
  };

  const applyExact = (d) => {
    if (!d) return;
    onChange({ key: "exact", label: fmtShort(d), from: startOfDay(d), to: endOfDay(d) });
    setShowRange(false);
    setOpen(false);
  };

  const openRange = () => {
    const from = value?.key === "range" ? toInputValue(value.from) : "";
    const to = value?.key === "range" ? toInputValue(value.to) : "";
    setRangeFrom(from);
    setRangeTo(to);
    setRangeFromText(isoToManual(from));
    setRangeToText(isoToManual(to));
    setShowRange(true);
  };

  // Typed range, for the centred dialog. Kept apart from the ISO state the anchored
  // variant's pickers write, so the two can't half-overwrite each other.
  const rangeFromIso = manualToIso(rangeFromText);
  const rangeToIso = manualToIso(rangeToText);
  const manualOrderOk = !rangeFromIso || !rangeToIso || rangeFromIso <= rangeToIso;
  const manualReady = !!rangeFromIso && !!rangeToIso && manualOrderOk;

  const applyManualRange = () => {
    if (!manualReady) return;
    const from = startOfDay(new Date(`${rangeFromIso}T00:00:00`));
    const to = endOfDay(new Date(`${rangeToIso}T00:00:00`));
    onChange({ key: "range", label: `${fmtShort(from)} - ${fmtShort(to)}`, from, to });
    setShowRange(false);
    setOpen(false);
  };

  const applyRange = () => {
    if (!rangeFrom || !rangeTo) return;
    const from = startOfDay(new Date(`${rangeFrom}T00:00:00`));
    const to = endOfDay(new Date(`${rangeTo}T00:00:00`));
    onChange({ key: "range", label: `${fmtShort(from)} - ${fmtShort(to)}`, from, to });
    setShowRange(false);
    setOpen(false);
  };

  const clear = () => { onChange(null); setShowRange(false); setOpen(false); };

  // What the trigger reads when nothing is set. Defaulted, so the boards that call this
  // the plain way are unaffected; the Dashboard overrides it to "Custom" because there it
  // sits at the end of a row of preset buttons that already cover the common ranges.
  const activeLabel = value?.label || placeholder;
  const isActive = !!value;

  // `centered` swaps the anchored popover for a normal centred dialog in the OS's milk
  // white, and swaps react-day-picker for our own MilkCalendar. Same filter, same state —
  // only where it appears and what it is made of.
  //
  // Behind a prop because Branch Admin and Consultations anchor this to a toolbar inside a
  // dense board, where a full-screen overlay for picking a date would be a heavier gesture
  // than the job deserves.
  if (centered) {
    const railBtn = (on) => `w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
      on ? "bg-amber-100 font-semibold text-amber-800" : "text-slate-700 hover:bg-[#F3EFE6]"
    }`;
    return (
      <div className="inline-flex items-center">
        <Button
          variant="outline"
          onClick={() => setOpen(true)}
          className={`h-10 ${isActive ? "rounded-r-none border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100" : ""}`}
          data-testid={`${testid}-btn`}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {activeLabel}
        </Button>
        {isActive && (
          <button
            type="button"
            onClick={clear}
            className="flex h-10 items-center rounded-r-md border border-l-0 border-amber-300 bg-amber-50 px-2 text-amber-800 hover:bg-amber-100"
            title="Clear date filter"
            aria-label="Clear date filter"
            data-testid={`${testid}-clear-x`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}

        {open && (
          <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-3 backdrop-blur-sm sm:p-4"
            onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
            data-testid={`${testid}-modal`}
          >
            <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-[#EFEAE0] bg-[#FDFCF8] shadow-2xl sm:max-w-lg" data-testid={`${testid}-panel`}>
              <div className="flex items-center justify-between border-b border-[#EFEAE0] px-4 py-3">
                <p className="text-sm font-bold text-slate-800">Filter by Date</p>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-full p-1.5 text-slate-400 hover:bg-[#F3EFE6] hover:text-slate-600"
                  title="Close"
                  aria-label="Close"
                  data-testid={`${testid}-exit`}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Presets across the top on a phone, down the side from sm — the same two
                  halves either way, never a sideways scroll. */}
              <div className="flex flex-col sm:flex-row">
                {/* flex, not a one-column grid, from sm up: grid rows stretch to fill the
                    dialog's height, which spread five presets out over the whole calendar
                    beside them. Flex keeps them at their natural height, stacked at the
                    top. Two columns on a phone, where the rail sits above the calendar. */}
                <div className="grid grid-cols-2 gap-1 border-b border-[#EFEAE0] p-2 sm:flex sm:w-40 sm:shrink-0 sm:flex-col sm:gap-0.5 sm:border-b-0 sm:border-r" data-testid={`${testid}-presets`}>
                  {list.map((p) => (
                    <button key={p.key} type="button" onClick={() => apply(p)} className={railBtn(value?.key === p.key)} data-testid={`${testid}-preset-${p.key}`}>
                      {p.label}
                    </button>
                  ))}
                  <button type="button" onClick={openRange} className={railBtn(value?.key === "range" || showRange)} data-testid={`${testid}-preset-range`}>
                    Custom Range
                  </button>
                </div>

                <div className="min-w-0 flex-1 p-3">
                  {showRange ? (
                    /* Typed, not picked. A picker here opened a second calendar on top of
                       the one this dialog already is, and a range is two dates — quicker to
                       type than to navigate twice. */
                    <div className="space-y-3" data-testid={`${testid}-range-panel`}>
                      <p className="text-sm font-semibold text-slate-700">Custom Range</p>
                      <div>
                        <label className="text-xs font-medium text-slate-500">From</label>
                        <input
                          value={rangeFromText}
                          onChange={(e) => setRangeFromText(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") applyManualRange(); }}
                          inputMode="numeric"
                          placeholder="DD-MM-YYYY"
                          className={`h-9 w-full rounded-md border bg-white px-3 text-sm outline-none focus:ring-1 ${
                            rangeFromText && !rangeFromIso
                              ? "border-red-300 focus:border-red-400 focus:ring-red-400"
                              : "border-[#EFEAE0] focus:border-amber-400 focus:ring-amber-400"
                          }`}
                          data-testid={`${testid}-range-from`}
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-slate-500">To</label>
                        <input
                          value={rangeToText}
                          onChange={(e) => setRangeToText(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") applyManualRange(); }}
                          inputMode="numeric"
                          placeholder="DD-MM-YYYY"
                          className={`h-9 w-full rounded-md border bg-white px-3 text-sm outline-none focus:ring-1 ${
                            (rangeToText && !rangeToIso) || !manualOrderOk
                              ? "border-red-300 focus:border-red-400 focus:ring-red-400"
                              : "border-[#EFEAE0] focus:border-amber-400 focus:ring-amber-400"
                          }`}
                          data-testid={`${testid}-range-to`}
                        />
                      </div>
                      {/* Says which of the two is wrong, rather than only greying Apply out. */}
                      <p className="text-[11px] text-slate-400" data-testid={`${testid}-range-hint`}>
                        {!manualOrderOk
                          ? <span className="font-semibold text-red-500">From must not be after To.</span>
                          : (rangeFromText && !rangeFromIso) || (rangeToText && !rangeToIso)
                            ? <span className="font-semibold text-red-500">Use DD-MM-YYYY, e.g. 04-08-2026.</span>
                            : "Type both dates as DD-MM-YYYY, e.g. 04-08-2026."}
                      </p>
                      <Button className="w-full" onClick={applyManualRange} disabled={!manualReady} data-testid={`${testid}-range-apply`}>
                        Apply
                      </Button>
                    </div>
                  ) : (
                    <MilkCalendar
                      value={value?.key === "exact" ? toInputValue(value.from) : ""}
                      accent="amber"
                      onChange={(d) => applyExact(new Date(`${d}T00:00:00`))}
                      testid={`${testid}-calendar`}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="inline-flex items-center">
      <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={`h-10 ${isActive ? "rounded-r-none border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100" : ""}`}
          data-testid={`${testid}-btn`}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {activeLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="relative w-auto max-w-[calc(100vw-2rem)] p-0" align="start" data-testid={`${testid}-panel`}>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="absolute right-2 top-2 z-10 rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          title="Close"
          aria-label="Close"
          data-testid={`${testid}-exit`}
        >
          <X className="h-4 w-4" />
        </button>
        <div className="flex max-h-[80vh] flex-col overflow-y-auto sm:max-h-none sm:flex-row sm:overflow-visible">
          {/* Left rail */}
          <div className="flex w-full flex-row flex-wrap gap-1 border-b border-slate-200 bg-slate-50/40 p-2 pt-8 sm:w-40 sm:flex-col sm:flex-nowrap sm:gap-0.5 sm:border-b-0 sm:border-r" data-testid={`${testid}-presets`}>
            {list.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => apply(p)}
                className={`w-auto rounded-md px-3 py-2 text-left text-sm transition-colors sm:w-full ${value?.key === p.key ? "bg-sky-100 font-semibold text-sky-700" : "text-slate-700 hover:bg-slate-100"}`}
                data-testid={`${testid}-preset-${p.key}`}
              >
                {p.label}
              </button>
            ))}
            <button
              type="button"
              onClick={openRange}
              className={`w-auto rounded-md px-3 py-2 text-left text-sm transition-colors sm:w-full ${value?.key === "range" || showRange ? "bg-sky-100 font-semibold text-sky-700" : "text-slate-700 hover:bg-slate-100"}`}
              data-testid={`${testid}-preset-range`}
            >
              Custom Range
            </button>
          </div>

          {/* Calendar or Custom Range */}
          {showRange ? (
            <div className="w-full space-y-3 p-4 pt-8 sm:w-64" data-testid={`${testid}-range-panel`}>
              <p className="text-sm font-semibold text-slate-700">Custom Range</p>
              <div className="space-y-2">
                <div>
                  <label className="text-xs font-medium text-slate-500">From</label>
                  <MilkDateInput  value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} data-testid={`${testid}-range-from`} />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500">To</label>
                  <MilkDateInput  value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} min={rangeFrom || undefined} data-testid={`${testid}-range-to`} />
                </div>
              </div>
              <Button
                className="w-full"
                onClick={applyRange}
                disabled={!rangeFrom || !rangeTo}
                data-testid={`${testid}-range-apply`}
              >
                Apply
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto p-2 pt-8">
              <Calendar
                mode="single"
                selected={value?.key === "exact" ? value.from : undefined}
                onSelect={applyExact}
                initialFocus
                data-testid={`${testid}-calendar`}
              />
            </div>
          )}
        </div>
      </PopoverContent>
      </Popover>
      {isActive && (
        <button
          type="button"
          onClick={clear}
          className="flex h-10 items-center rounded-r-md border border-l-0 border-sky-300 bg-sky-50 px-2 text-sky-700 hover:bg-sky-100"
          title="Clear date filter"
          aria-label="Clear date filter"
          data-testid={`${testid}-clear-x`}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
};
