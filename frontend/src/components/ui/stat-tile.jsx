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
      className={`relative w-full overflow-hidden rounded-xl border bg-white p-4 text-left shadow-sm transition ${
        active ? "border-transparent" : `border-slate-200 ${onClick ? "hover:shadow-md" : ""}`
      }`}
      style={active ? { boxShadow: `0 0 0 2px ${color}` } : undefined}
      data-testid={testid}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full"
        style={{ background: `linear-gradient(135deg, ${color}2E, ${color}0D)` }}
      />
      {Icon && <Icon aria-hidden className="absolute right-3.5 top-3.5 h-4 w-4" style={{ color }} />}
      {/* pr-9 keeps a long label out from under the icon; the figure shrinks on a phone
          because two cards to a row leaves about 130px and "Rs.4,32,704" does not fit at
          text-2xl with nowhere to wrap. */}
      <p className="pr-9 text-[11px] font-bold uppercase leading-tight tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-extrabold sm:text-2xl" style={{ color }}>{value}</p>
      {sub && <p className="mt-0.5 text-[10px] text-slate-400">{sub}</p>}
    </Tag>
  );
};

export default StatTile;
