import { useMemo, useState } from "react";
import { Calendar as CalendarIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";

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

export const DateFilterPopover = ({ value, onChange, testid = "date-filter" }) => {
  const [open, setOpen] = useState(false);
  const [showRange, setShowRange] = useState(false);
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
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
    setRangeFrom(value?.key === "range" ? toInputValue(value.from) : "");
    setRangeTo(value?.key === "range" ? toInputValue(value.to) : "");
    setShowRange(true);
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

  const activeLabel = value?.label || "Date Filter";
  const isActive = !!value;

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
                  <Input type="date" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} data-testid={`${testid}-range-from`} />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500">To</label>
                  <Input type="date" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} min={rangeFrom || undefined} data-testid={`${testid}-range-to`} />
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
