/**
 * The figure card the money boards share: a label, the number, a line saying what the
 * number counts, and the card's colour carried by a disc bleeding out of the top-right
 * corner with an icon in it.
 *
 * The colour is a disc rather than a filled tile because these arrive four and seven to a
 * row — seven filled tiles is seven things shouting and none of them is the figure. The
 * icon says which card at a glance, which matters most on a phone where the labels
 * truncate before the numbers do.
 *
 * Every colour is an inline style off one hex per card. Tailwind reads class names out of
 * the source, so a `bg-${tone}-100` built at runtime compiles to nothing and the disc
 * would come out invisible — and a hex means a new card needs no class map kept in step.
 *
 * Renders a button when given an onClick (the collections boards use their tiles as the
 * table's filter) and a plain div otherwise, so a card that does nothing is not announced
 * to a screen reader as something to press.
 */
export const StatTile = ({
  label, value, sub, icon: Icon, color = "#0284c7", active = false, onClick, testid,
}) => {
  const Tag = onClick ? "button" : "div";
  const tagProps = onClick ? { type: "button", onClick } : {};
  return (
    <Tag
      {...tagProps}
      className={`relative w-full overflow-hidden rounded-xl border bg-white p-3 text-left shadow-sm transition sm:p-4 ${
        active ? "border-transparent" : `border-slate-200 ${onClick ? "hover:shadow-md" : ""}`
      }`}
      style={active ? { boxShadow: `0 0 0 2px ${color}` } : undefined}
      data-testid={testid}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute -right-5 -top-5 h-16 w-16 rounded-full sm:-right-6 sm:-top-6 sm:h-20 sm:w-20"
        style={{ background: `linear-gradient(135deg, ${color}2E, ${color}0D)` }}
      />
      {Icon && <Icon aria-hidden className="absolute right-2.5 top-2.5 h-3.5 w-3.5 sm:right-3.5 sm:top-3.5 sm:h-4 sm:w-4" style={{ color }} />}
      {/* The right padding keeps a long label out from under the icon; the figure shrinks
          on a phone because two cards to a row leaves about 130px and "Rs.4,32,704" does
          not fit at text-2xl with nowhere to wrap.
          Everything steps down below sm because these also arrive three to a row on the
          Physio board, which leaves ~110px. At the old fixed p-4/pr-9 that is about 40px
          of text column, and "COMPLETED" is one word that cannot wrap — it would have been
          clipped by the overflow-hidden above rather than shortened. break-words is the
          floor: a label with nowhere left to go breaks instead of disappearing. */}
      <p className="break-words pr-7 text-[10px] font-bold uppercase leading-tight tracking-wider text-slate-500 sm:pr-9 sm:text-[11px]">{label}</p>
      <p className="mt-1 text-xl font-extrabold sm:text-2xl" style={{ color }}>{value}</p>
      {sub && <p className="mt-0.5 text-[10px] leading-tight text-slate-400">{sub}</p>}
    </Tag>
  );
};

export default StatTile;
