// Some stage names are long-form internal labels; shorten them for on-screen display
// only — the underlying stage value (used for filtering/API calls) stays unchanged.
const STAGE_DISPLAY_LABELS = { "Appointment Date & Time": "Appointment" };
export const stageDisplayLabel = (name) => STAGE_DISPLAY_LABELS[name] || name;

// Sticky segmented pill tab used to filter a leads list by stage — shared between
// Branch Admin's Branch Leads pipeline and Consultations boards.
//
// `gridded` sizes the pill to fill a grid cell instead of holding a fixed width inside
// a scrolling row. It's opt-in because the fixed width is what makes the scrolling
// variant work — dropping it there would collapse the pills to nothing. Bars that lay
// their own pills out (Physio Review, Branch Review, Pre-Sales) get the scrolling
// sizing untouched.
//
// `plain` drops the per-stage colour: each stage is a white card of its own, separated by
// the grey strip showing through rather than by an outline, with only the selected one
// picked out. Opt-in rather than the default because this bar is shared: Branch Leads
// asked for blank cards, while the Consultations and Pre-Sales bars still read by
// colour, and changing it here would have restyled all three at once.
export const StageTab = ({ label, count, active, onClick, color, testid, gridded = false, plain = false }) => {
  const tint = color || "#0ea5e9";
  return (
    <button
      onClick={onClick}
      data-testid={testid}
      type="button"
      className={`relative flex flex-col items-center justify-center rounded-lg text-center transition-all hover:shadow-sm sm:min-w-0 sm:flex-1 sm:shrink sm:px-3 sm:py-2.5 ${
        gridded
          ? "w-full min-w-0 px-1 py-2"
          : "min-w-[86px] shrink-0 px-3 py-2.5"
      } ${
        plain
          ? (active
            ? "bg-sky-50 text-sky-700 shadow-sm"
            : "bg-white text-slate-600 shadow-sm hover:bg-slate-50")
          : ""
      }`}
      style={
        plain
          ? undefined
          : active
            ? { background: tint, color: "#ffffff", boxShadow: `0 2px 8px ${tint}40` }
            : { background: `${tint}14`, color: tint, border: `1px solid ${tint}33` }
      }
    >
      {/* Title case, as the stage is actually named — "Consultation Completed", not
          CONSULTATION COMPLETED. The wide tracking went with the caps; it was there to
          space shouted letters out and only loosens ordinary words.

          In a grid cell the type is tighter still, so a long name wraps inside its
          column rather than widening it. */}
      <span className={`font-semibold sm:text-[11px] sm:leading-tight ${
        gridded
          ? "text-[9px] leading-[1.2] [hyphens:auto]"
          : "text-[11px] leading-tight"
      }`}>{label}</span>
      <span className={`mt-0.5 font-bold leading-none sm:text-lg ${gridded ? "text-base" : "text-lg"}`}>{count}</span>
    </button>
  );
};

// `hideAllStages` drops the leading "All Stages" pill (stage pills still toggle
// off on a second click, so the filter can always be cleared).
export const StageTabBar = ({ stages, stageFilter, setStageFilter, counts, totalCount, testid, hideAllStages = false, plain = false }) => (
  <div
    // The offset has to clear the sticky page header, which is two different heights:
    // 61px on a phone (py-3 + a 36px logo + border) and 89px from sm up (py-4 + 56px).
    // A flat 88px left a white band under the header on a phone once scrolled.
    className={`sticky top-[61px] z-10 -mx-1 rounded-xl border border-slate-200 p-1 shadow-sm backdrop-blur sm:top-[88px] ${
      // A plain card is white and borderless, so it can only read as its own card if what
      // lies between the cards is not also white — hence the grey strip under them.
      plain
        ? "bg-slate-100/95 supports-[backdrop-filter]:bg-slate-100/80"
        : "bg-white/95 supports-[backdrop-filter]:bg-white/80"
    }`}
    data-testid={testid}
  >
    {/* Five to a row on a phone, so nine stages land as 5 + 4 and the whole bar is
        visible at once — it used to be a horizontal scroll, which hid the later stages
        behind a swipe nobody knew to make. Back to a single flex row from sm up. */}
    <div className={`grid grid-cols-5 sm:flex sm:flex-nowrap sm:overflow-visible ${plain ? "gap-2" : "gap-1"}`}>
      {!hideAllStages && (
        <StageTab
          label="All Stages"
          count={totalCount}
          active={stageFilter === null}
          onClick={() => setStageFilter(null)}
          color="#0ea5e9"
          testid={`${testid}-total`}
          gridded
          plain={plain}
        />
      )}
      {stages.map((s) => (
        <StageTab
          key={s.id}
          label={stageDisplayLabel(s.name)}
          count={counts?.[s.name] || 0}
          active={stageFilter === s.name}
          onClick={() => setStageFilter(stageFilter === s.name ? null : s.name)}
          color={s.color || "#64748b"}
          testid={`${testid}-${s.name}`}
          gridded
          plain={plain}
        />
      ))}
    </div>
  </div>
);
