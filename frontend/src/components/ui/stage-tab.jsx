// Sticky segmented pill tab used to filter a leads list by stage — shared between
// Branch Admin's Branch Leads pipeline and Consultations boards.
export const StageTab = ({ label, count, active, onClick, color, testid }) => {
  const tint = color || "#0ea5e9";
  return (
    <button
      onClick={onClick}
      data-testid={testid}
      type="button"
      className="relative flex min-w-0 flex-1 flex-col items-center justify-center rounded-lg px-3 py-2.5 text-center transition-all hover:shadow-sm"
      style={
        active
          ? { background: tint, color: "#ffffff", boxShadow: `0 2px 8px ${tint}40` }
          : { background: `${tint}14`, color: tint, border: `1px solid ${tint}33` }
      }
    >
      <span className="text-[11px] font-semibold uppercase tracking-wider leading-tight">{label}</span>
      <span className="mt-0.5 text-lg font-bold leading-none">{count}</span>
    </button>
  );
};

// `hideAllStages` drops the leading "All Stages" pill (stage pills still toggle
// off on a second click, so the filter can always be cleared).
export const StageTabBar = ({ stages, stageFilter, setStageFilter, counts, totalCount, testid, hideAllStages = false }) => (
  <div
    className="sticky top-[88px] z-10 -mx-1 rounded-xl border border-slate-200 bg-white/95 p-1 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/80"
    data-testid={testid}
  >
    <div className="flex flex-nowrap gap-1">
      {!hideAllStages && (
        <StageTab
          label="All Stages"
          count={totalCount}
          active={stageFilter === null}
          onClick={() => setStageFilter(null)}
          color="#0ea5e9"
          testid={`${testid}-total`}
        />
      )}
      {stages.map((s) => (
        <StageTab
          key={s.id}
          label={s.name}
          count={counts?.[s.name] || 0}
          active={stageFilter === s.name}
          onClick={() => setStageFilter(stageFilter === s.name ? null : s.name)}
          color={s.color || "#64748b"}
          testid={`${testid}-${s.name}`}
        />
      ))}
    </div>
  </div>
);
