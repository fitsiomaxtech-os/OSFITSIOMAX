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
 * `tabs` is [{ key, label, icon? }]. Items share the row equally, shrink before they wrap,
 * and truncate before they overflow — a bar that wraps to two rows pushes the first card
 * below the fold on a phone.
 */
export const SegmentedTabs = ({ tabs, value, onChange, testid = "segmented-tabs", size = "md" }) => {
  const pad = size === "sm" ? "px-2 py-1.5 text-[11px] sm:text-xs" : "px-2 py-2 text-[11px] sm:px-3 sm:text-sm";
  return (
    <div className={`flex gap-1 rounded-xl bg-slate-100 p-1 ${size === "sm" ? "" : "sm:gap-1.5"}`} data-testid={testid}>
      {tabs.map((t) => {
        const Icon = t.icon;
        const active = value === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            aria-current={active ? "page" : undefined}
            className={`flex min-w-0 flex-1 items-center justify-center gap-1 rounded-lg font-semibold transition sm:gap-1.5 ${pad} ${
              active
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-800"
            }`}
            data-testid={`${testid}-${t.key}`}
          >
            {Icon && <Icon className={`h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4 ${active ? "text-sky-600" : ""}`} />}
            <span className="truncate">{t.label}</span>
          </button>
        );
      })}
    </div>
  );
};

export default SegmentedTabs;
