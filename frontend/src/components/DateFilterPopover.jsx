import { useMemo, useState } from "react";
import { Calendar as CalendarIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";

/**
 * DateFilterPopover
 *
 * Controlled date filter with:
 *  - Left rail of quick presets (Today, Tomorrow, This Week, Next 7 Days, This Month, Last 30 Days, Clear, All Leads).
 *  - Right side: single-month calendar to pick an exact date.
 *
 * Props:
 *  - value: { type: "single" | "range" | null, from: Date|null, to: Date|null, label: string }
 *  - onChange: (next) => void
 *  - testid: string (optional)
 */

const startOfDay = (d) => { const n = new Date(d); n.setHours(0, 0, 0, 0); return n; };
const endOfDay = (d) => { const n = new Date(d); n.setHours(23, 59, 59, 999); return n; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfWeek = (d) => { const x = startOfDay(d); x.setDate(x.getDate() - x.getDay()); return x; };
const endOfWeek = (d) => endOfDay(addDays(startOfWeek(d), 6));
const startOfMonth = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), 1); return startOfDay(x); };
const endOfMonth = (d) => endOfDay(new Date(d.getFullYear(), d.getMonth() + 1, 0));

const fmtShort = (d) => d ? d.toLocaleDateString(undefined, { day: "2-digit", month: "short" }) : "";

const presets = (today) => ([
  { key: "today",     label: "Today",        from: startOfDay(today),                    to: endOfDay(today) },
  { key: "tomorrow",  label: "Tomorrow",     from: startOfDay(addDays(today, 1)),        to: endOfDay(addDays(today, 1)) },
  { key: "this_week", label: "This Week",    from: startOfWeek(today),                   to: endOfWeek(today) },
  { key: "next_7",    label: "Next 7 Days",  from: startOfDay(today),                    to: endOfDay(addDays(today, 6)) },
  { key: "this_month",label: "This Month",   from: startOfMonth(today),                  to: endOfMonth(today) },
  { key: "last_30",   label: "Last 30 Days", from: startOfDay(addDays(today, -29)),      to: endOfDay(today) },
]);

export const DateFilterPopover = ({ value, onChange, testid = "date-filter" }) => {
  const [open, setOpen] = useState(false);
  const today = useMemo(() => new Date(), []);
  const list = useMemo(() => presets(today), [today]);

  const apply = (p) => {
    onChange({ key: p.key, label: p.label, from: p.from, to: p.to });
    setOpen(false);
  };

  const applyExact = (d) => {
    if (!d) return;
    onChange({ key: "exact", label: fmtShort(d), from: startOfDay(d), to: endOfDay(d) });
    setOpen(false);
  };

  const clear = () => { onChange(null); setOpen(false); };

  const showAll = () => { onChange(null); setOpen(false); };

  const activeLabel = value?.label || "Date Filter";
  const isActive = !!value;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={`h-10 ${isActive ? "border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100" : ""}`}
          data-testid={`${testid}-btn`}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {activeLabel}
          {isActive && (
            <X
              role="button"
              className="ml-2 h-3.5 w-3.5 rounded-full hover:bg-sky-200"
              onClick={(e) => { e.stopPropagation(); clear(); }}
              data-testid={`${testid}-clear-x`}
            />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start" data-testid={`${testid}-panel`}>
        <div className="flex">
          {/* Left rail */}
          <div className="flex w-40 flex-col gap-0.5 border-r border-slate-200 bg-slate-50/40 p-2" data-testid={`${testid}-presets`}>
            {list.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => apply(p)}
                className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${value?.key === p.key ? "bg-sky-100 font-semibold text-sky-700" : "text-slate-700 hover:bg-slate-100"}`}
                data-testid={`${testid}-preset-${p.key}`}
              >
                {p.label}
              </button>
            ))}
            <div className="my-1 border-t border-slate-200" />
            <button
              type="button"
              onClick={clear}
              className="w-full rounded-md px-3 py-2 text-left text-sm font-medium text-rose-600 transition-colors hover:bg-rose-50"
              data-testid={`${testid}-preset-clear`}
            >
              Clear
            </button>
            <button
              type="button"
              onClick={showAll}
              className="w-full rounded-md px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-100"
              data-testid={`${testid}-preset-all`}
            >
              All Leads
            </button>
          </div>

          {/* Calendar */}
          <div className="p-2">
            <Calendar
              mode="single"
              selected={value?.key === "exact" ? value.from : undefined}
              onSelect={applyExact}
              initialFocus
              data-testid={`${testid}-calendar`}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};
