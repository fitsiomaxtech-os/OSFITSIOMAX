/**
 * The OS's dashboard tab bar: a recessed grey track with the selected tab raised out of it
 * as a white pill.
 *
 * Selection is carried by elevation — a lifted white pill against a sunken track — rather
 * than by a block of brand colour. A filled tab competes with the figures underneath it,
 * which are the thing the tab exists to show; on a board that is mostly numbers, the
 * navigation should be the quietest part of the screen.
 *
 * Shared so every dashboard's bar is literally the same component. These bars sit one
 * screen apart and drifted before: one was sky-filled, another orange-tinted, a third
 * underlined.
 *
 * `tabs` is [{ key, label, short?, icon? }]. Items share the row equally and truncate
 * before they overflow.
 *
 * `short` is the phone label. A truncated tab is not a tab — "Exec…", "App…", "Trea…" —
 * so anything that won't survive a sixth of a phone's width gets a shorter name rather
 * than an ellipsis. The full label returns from sm up.
 *
 * `mobileCols` wraps the bar into that many columns on a phone. Past four tabs a single
 * row leaves each one too narrow to read even abbreviated; two rows of three costs less
 * than a bar nobody can use. Desktop is always one row.
 */
// Written out rather than built from mobileCols: Tailwind reads the source for class
// names, so `grid-cols-${n}` compiles to nothing and the bar silently falls back to one
// unstyled column.
const MOBILE_LAYOUTS = {
  2: "grid grid-cols-2 sm:flex",
  3: "grid grid-cols-3 sm:flex",
  4: "grid grid-cols-4 sm:flex",
};

export const SegmentedTabs = ({ tabs, value, onChange, testid = "segmented-tabs", size = "md", mobileCols = 0 }) => {
  const pad = size === "sm" ? "px-2 py-1.5 text-[11px] sm:text-xs" : "px-2 py-2 text-[11px] sm:px-3 sm:text-sm";
  const layout = MOBILE_LAYOUTS[mobileCols] || "flex";
  return (
    <div className={`${layout} gap-1 rounded-xl bg-slate-100 p-1 ${size === "sm" ? "" : "sm:gap-1.5"}`} data-testid={testid}>
      {tabs.map((t) => {
        const Icon = t.icon;
        const active = value === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            aria-current={active ? "page" : undefined}
            className={`flex min-w-0 items-center justify-center gap-1 rounded-lg font-semibold transition sm:flex-1 sm:gap-1.5 ${mobileCols ? "" : "flex-1"} ${pad} ${
              active
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-800"
            }`}
            data-testid={`${testid}-${t.key}`}
          >
            {Icon && <Icon className={`h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4 ${active ? "text-sky-600" : ""}`} />}
            {t.short ? (
              <>
                <span className="truncate sm:hidden">{t.short}</span>
                <span className="hidden truncate sm:inline">{t.label}</span>
              </>
            ) : (
              <span className="truncate">{t.label}</span>
            )}
          </button>
        );
      })}
    </div>
  );
};

export default SegmentedTabs;
