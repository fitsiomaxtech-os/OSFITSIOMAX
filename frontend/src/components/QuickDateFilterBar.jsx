import { DateFilterPopover } from "@/components/DateFilterPopover";

/**
 * QuickDateFilterBar
 *
 * A horizontal row of one-tap date ranges — All, Today, This Week, This Month,
 * Last 90 Days — with the shared date popover on the end for everything else.
 *
 * This is a *second*, independent date control, added beside the existing
 * DateFilterPopover rather than replacing it. Nothing in DateFilterPopover.jsx is
 * changed by it: the Custom trigger here is that same component used as-is, so the
 * calendar, Yesterday/Last Month presets and typed custom range all come along
 * unaltered. The board owning both narrows by their intersection, so each control
 * keeps showing its own state and neither silently overrules the other.
 *
 * Props:
 *  - value: the same shape DateFilterPopover emits —
 *           { key, label, from: Date|null, to: Date|null } | null. null means All.
 *  - onChange: (next) => void. Emits null for All.
 *  - testid: string prefix for the row's test ids.
 */

const startOfDay = (d) => { const n = new Date(d); n.setHours(0, 0, 0, 0); return n; };
const endOfDay = (d) => { const n = new Date(d); n.setHours(23, 59, 59, 999); return n; };

// A real Monday→Sunday calendar week, not a rolling last-7-days window — same reading
// of "this week" the Dashboard's row uses, so the two boards agree on what the words mean.
const mondayOf = (d) => {
  const n = startOfDay(d);
  const day = n.getDay(); // 0 = Sun .. 6 = Sat
  n.setDate(n.getDate() + (day === 0 ? -6 : 1 - day));
  return n;
};
const sundayOf = (d) => { const m = mondayOf(d); const n = new Date(m); n.setDate(n.getDate() + 6); return n; };
const daysBack = (d, n) => { const x = startOfDay(d); x.setDate(x.getDate() - n); return x; };

/**
 * `short` is the phone label. Six full labels cannot share a phone's width, and the
 * alternatives are worse: truncating gives "Last 9…", wrapping costs a row, scrolling
 * hides the last two off the edge. `label` is what the filter state carries, so nothing
 * downstream ever sees the abbreviation.
 *
 * All carries no dates at all rather than a very wide range — it is the absence of a
 * narrowing, which is what lets the board treat it as "this control is not filtering".
 *
 * Last 90 Days counts today as one of the ninety, so it runs today-89 → today. Ninety
 * whole days ending yesterday would drop the morning's consultations, which is the one
 * thing somebody opening this board is most likely to be checking.
 */
export const QUICK_DATE_PRESETS = [
  { key: "all", label: "All", short: "All", range: () => ({ from: null, to: null }) },
  { key: "today", label: "Today", short: "Today", range: () => ({ from: startOfDay(new Date()), to: endOfDay(new Date()) }) },
  { key: "this_week", label: "This Week", short: "Week", range: () => ({ from: mondayOf(new Date()), to: endOfDay(sundayOf(new Date())) }) },
  { key: "this_month", label: "This Month", short: "Month", range: () => { const t = new Date(); return { from: startOfDay(new Date(t.getFullYear(), t.getMonth(), 1)), to: endOfDay(new Date(t.getFullYear(), t.getMonth() + 1, 0)) }; } },
  { key: "last_90", label: "Last 90 Days", short: "90d", range: () => ({ from: daysBack(new Date(), 89), to: endOfDay(new Date()) }) },
];

const quickFilter = (p) => (p.key === "all" ? null : { key: p.key, label: p.label, ...p.range() });

/**
 * Narrows one date filter by another, so two independent controls over the same list
 * combine instead of one quietly winning. The result is the overlap: the later of the two
 * starts, the earlier of the two ends. Either side being null (unset) leaves the other
 * standing, and both being null means no narrowing at all.
 *
 * Disjoint ranges give an empty list, which is the honest answer — and both controls stay
 * lit on screen saying which two ranges produced it.
 */
export const intersectDateFilters = (a, b) => {
  if (!a) return b || null;
  if (!b) return a;
  const from = [a.from, b.from].filter(Boolean).sort((x, y) => y - x)[0] || null;
  const to = [a.to, b.to].filter(Boolean).sort((x, y) => x - y)[0] || null;
  return { key: `${a.key}+${b.key}`, label: `${a.label} · ${b.label}`, from, to };
};

export const QuickDateFilterBar = ({ value, onChange, testid = "quick-date" }) => {
  // What lights up. All is the resting state, so a cleared filter lights All rather than
  // leaving the row with nothing selected and no way to tell it apart from a custom range.
  const activeKey = value?.key || "all";
  const onPreset = QUICK_DATE_PRESETS.some((p) => p.key === activeKey);

  return (
    /* One row at every width, six equal columns on a phone so nothing lands off screen —
       an overflow-x row here puts Last 90 Days half past the edge. Desktop keeps natural
       widths, since stretching six buttons across a 1400px board would be absurd. */
    <div className="flex items-center gap-1 sm:flex-wrap sm:gap-2" data-testid={testid}>
      {QUICK_DATE_PRESETS.map((p) => (
        <button
          key={p.key}
          type="button"
          onClick={() => onChange(quickFilter(p))}
          aria-pressed={activeKey === p.key}
          className={`h-10 min-w-0 flex-1 truncate rounded-md px-1 text-[11px] font-medium transition sm:flex-none sm:px-3 sm:text-sm ${
            activeKey === p.key
              ? "bg-sky-600 text-white"
              : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
          }`}
          data-testid={`${testid}-preset-${p.key}`}
        >
          <span className="sm:hidden">{p.short}</span>
          <span className="hidden sm:inline">{p.label}</span>
        </button>
      ))}
      {/* The trigger is a Button this component doesn't own, so its width, padding, text
          size and icon are pinned from out here rather than by adding breakpoint props to
          a control six other boards share.

          Handed null while a preset above is lit, so it reads "Custom" instead of naming
          the same range the lit button already names. */}
      <span className="min-w-0 flex-1 sm:flex-none [&_button]:h-10 [&_button]:w-full [&_button]:justify-center [&_button]:px-1 [&_button]:text-[11px] [&_svg]:hidden sm:[&_button]:w-auto sm:[&_button]:px-4 sm:[&_button]:text-sm sm:[&_svg]:inline-block">
        <DateFilterPopover
          value={onPreset ? null : value}
          onChange={(next) => onChange(next || null)}
          testid={`${testid}-custom`}
          placeholder="Custom"
          centered
        />
      </span>
    </div>
  );
};

export default QuickDateFilterBar;
