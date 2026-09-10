import { useEffect, useState } from "react";
import { CalendarDays, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MilkCalendar } from "@/components/ui/milk-calendar";
import { maskDayMonthYear, manualToIso, isoToManual } from "@/components/DateFilterPopover";
import { DATE_PRESET_LABELS, DATE_PRESET_SHORT } from "@/lib/dateRange";

/**
 * Every window the finance book is read through, in the order they are reached for: the
 * whole book, then today, then the ranges that widen out from it, then an arbitrary one.
 *
 * "All" is first and is every board's default. A finance page that opened scoped to Today
 * would hide every collection and every expense older than this morning behind a filter
 * nobody set.
 *
 * A board that wants fewer passes its own list of keys — Approvals leaves Yesterday off,
 * because that desk signs off a batch rather than reads one evening back. The words and
 * the days behind them still come from lib/dateRange, so a board can drop a window but
 * cannot quietly mean something different by one it keeps.
 */
export const FINANCE_DATE_PRESETS = ["all", "today", "this_week", "yesterday", "last_month", "this_month", "custom"];

/**
 * The dialog behind Custom Range. Two typed dates and one calendar, centred over the board
 * rather than hanging off the button that opened it: a panel anchored to a chip in a
 * toolbar opens across the very figures it is about to filter, and gets clipped by
 * whatever scrolls underneath it.
 *
 * Typed and picked at once, because a range is two dates and people usually arrive knowing
 * which two. Keying 04082026 is quicker than navigating a grid twice; the grid is there
 * for the times you are reading a calendar to decide. Whichever is used the other follows,
 * because they are one value shown two ways rather than two controls to reconcile.
 */
const CustomRangeDialog = ({ from, to, onApply, onClose, testid }) => {
  const [fromText, setFromText] = useState(() => isoToManual(from));
  const [toText, setToText] = useState(() => isoToManual(to));
  // Which end the next tap on the grid fills. Starts on From and moves itself to To, so
  // picking a range is two taps rather than two taps and a switch between them.
  const [editing, setEditing] = useState("from");

  const fromIsoVal = manualToIso(fromText);
  const toIsoVal = manualToIso(toText);
  const orderOk = !fromIsoVal || !toIsoVal || fromIsoVal <= toIsoVal;
  const ready = !!fromIsoVal && !!toIsoVal && orderOk;

  // Esc closes it, the way every other dismissable thing on these boards does.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pickDay = (iso) => {
    if (editing === "from") {
      setFromText(isoToManual(iso));
      // A new start after the end that was already there leaves a range running backwards.
      // Dropping the end asks for it again rather than quietly applying a swapped one.
      if (toIsoVal && iso > toIsoVal) setToText("");
      setEditing("to");
    } else {
      setToText(isoToManual(iso));
    }
  };

  // The whole box selects its end, not just the eight characters inside it — the label and
  // the padding around it are the obvious thing to aim at when switching From to To.
  const field = (label, text, set, bad, tid) => (
    <div
      onClick={() => setEditing(tid)}
      className={`min-w-0 flex-1 cursor-text rounded-lg border px-2.5 py-1.5 transition ${
        editing === tid ? "border-sky-400 bg-white ring-1 ring-sky-200" : "border-[#EFEAE0] bg-white/70"
      }`}
    >
      <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      <input
        value={text}
        onChange={(e) => set(maskDayMonthYear(e.target.value, text))}
        onFocus={() => setEditing(tid)}
        onKeyDown={(e) => { if (e.key === "Enter" && ready) onApply(fromIsoVal, toIsoVal); }}
        inputMode="numeric"
        maxLength={10}
        placeholder="DD-MM-YYYY"
        className={`w-full bg-transparent text-sm outline-none ${bad ? "text-red-600" : "text-slate-800"}`}
        data-testid={`${testid}-${tid}`}
      />
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 p-3 backdrop-blur-sm sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      data-testid={`${testid}-modal`}
    >
      <div className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-2xl border border-[#EFEAE0] bg-[#FDFCF8] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#EFEAE0] px-4 py-3">
          <p className="text-sm font-bold text-slate-800">Filter by Date</p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-slate-400 hover:bg-[#F3EFE6] hover:text-slate-600"
            title="Close"
            aria-label="Close"
            data-testid={`${testid}-close`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-3">
          <div className="flex items-stretch gap-2">
            {field("From", fromText, setFromText, !!fromText && !fromIsoVal, "from")}
            {field("To", toText, setToText, (!!toText && !toIsoVal) || !orderOk, "to")}
          </div>

          {/* The grid keeps its own month as the end being filled changes, so picking a
              From in March leaves March open to pick the To from. */}
          <MilkCalendar
            value={editing === "from" ? fromIsoVal : toIsoVal}
            min={editing === "to" ? fromIsoVal || undefined : undefined}
            accent="sky"
            onChange={pickDay}
            testid={`${testid}-calendar`}
          />

          {/* Says which of the two is wrong, rather than only greying Apply out. */}
          <p className="text-[11px] text-slate-400" data-testid={`${testid}-hint`}>
            {!orderOk
              ? <span className="font-semibold text-red-500">From must not be after To.</span>
              : (fromText && !fromIsoVal) || (toText && !toIsoVal)
                ? <span className="font-semibold text-red-500">Use DD-MM-YYYY, e.g. 04-08-2026.</span>
                : `Type both dates, or tap the grid to set ${editing === "from" ? "From" : "To"}.`}
          </p>

          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} className="flex-1" data-testid={`${testid}-cancel`}>Cancel</Button>
            <Button
              onClick={() => onApply(fromIsoVal, toIsoVal)}
              disabled={!ready}
              className="flex-1 bg-sky-600 hover:bg-sky-700"
              data-testid={`${testid}-apply`}
            >
              Apply
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * The one date control every page of Finance is read through: the windows as a single
 * horizontal row of buttons, with an arbitrary range behind the last of them in a dialog.
 *
 * One row, never two. These windows are the first thing read on a finance page and the
 * thing most often changed, so they all stay on screen at once rather than folded into a
 * dropdown or stacked down the side of a popup. Where the width genuinely is not there, on
 * a phone, the row scrolls sideways instead of wrapping: a filter that reflows to two lines
 * pushes the figures it filters down the screen every time it is touched.
 *
 * The dates are held by the board rather than in here, so the range survives pressing Today
 * and coming back, and so the board reads the same [start, end] out of `rangeFor` that the
 * lit button is naming.
 *
 * Custom Range opens the dialog and lights nothing until Apply. Two date fields that appear
 * under one preset and vanish under the others — which is what these boards carried — move
 * everything below them up and down the page each time the window is changed, and stand
 * open saying nothing whenever some other preset is the one deciding it.
 *
 * @param preset      one of `presets`' keys.
 * @param customFrom  ISO start, meaningful only while preset is "custom".
 * @param customTo    ISO end, likewise.
 * @param onChange    (preset, from, to) => void. The two dates come back unchanged when a
 *                    preset is pressed, so the board keeps them for the next Custom Range.
 * @param presets     which windows this board offers, if not all of them.
 */
export const FinanceDateFilter = ({
  preset, customFrom = "", customTo = "", onChange,
  presets = FINANCE_DATE_PRESETS, testid = "finance-date",
}) => {
  const [open, setOpen] = useState(false);
  const hasRange = preset === "custom" && customFrom && customTo;

  return (
    <div className="flex min-w-0 items-center gap-1.5" data-testid={testid}>
      {/* flex-nowrap over a sideways scroll, not flex-wrap: see the note above on why this
          stays one row at every width. The bar itself is hidden where the browser allows
          it, since a scrollbar under seven buttons reads as a broken control. */}
      <div className="flex min-w-0 flex-nowrap items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {presets.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => (key === "custom" ? setOpen(true) : onChange(key, customFrom, customTo))}
            aria-pressed={preset === key}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
              preset === key
                ? "border-sky-600 bg-sky-600 text-white shadow-sm"
                : "border-slate-200 bg-white text-slate-600 hover:border-sky-300 hover:text-sky-600"
            }`}
            data-testid={`${testid}-preset-${key}`}
          >
            <span className="sm:hidden">{DATE_PRESET_SHORT[key]}</span>
            <span className="hidden sm:inline">{DATE_PRESET_LABELS[key]}</span>
          </button>
        ))}
      </div>

      {/* The range that is actually in force, and the way back into the dialog to change
          it. The figures are filtered by it, so it has to be readable without opening
          anything. */}
      {hasRange && (
        <span className="flex shrink-0 items-center" data-testid={`${testid}-chip`}>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex items-center gap-1.5 rounded-l-full border border-sky-200 bg-sky-50 py-1.5 pl-3 pr-2 text-xs font-medium text-sky-700 hover:bg-sky-100"
            data-testid={`${testid}-chip-edit`}
          >
            <CalendarDays className="h-3.5 w-3.5" />
            {isoToManual(customFrom)} to {isoToManual(customTo)}
          </button>
          <button
            type="button"
            onClick={() => onChange("all", "", "")}
            className="rounded-r-full border border-l-0 border-sky-200 bg-sky-50 py-1.5 pl-1 pr-2.5 text-sky-700 hover:bg-sky-100"
            title="Clear date filter"
            aria-label="Clear date filter"
            data-testid={`${testid}-chip-clear`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      )}

      {open && (
        <CustomRangeDialog
          from={customFrom}
          to={customTo}
          onClose={() => setOpen(false)}
          onApply={(f, t) => { onChange("custom", f, t); setOpen(false); }}
          testid={`${testid}-custom`}
        />
      )}
    </div>
  );
};

export default FinanceDateFilter;
