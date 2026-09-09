/**
 * How full one published slot is, as a row of dots — one dot per seat the physio takes,
 * filled for every seat already gone.
 *
 * A gauge rather than a warning: dots are drawn on every slot, not only part-filled ones,
 * because they say how many seats a slot *has* as much as how many are used, and a slot
 * that showed nothing when empty made the row look like an alert. Colour is inherited from
 * the text around it (`bg-current`), so the tile it sits in decides the tone — amber when
 * the slot is full, emerald while it is still open — with nothing to keep in step here.
 *
 * slot_capacity is configurable per physio calendar, so it is not always three. Past
 * DOT_MAX the row would outgrow a box a third of a phone wide and the dots stop being
 * countable at a glance anyway, so it falls back to the number it replaced.
 */
const DOT_MAX = 8;

export const SeatDots = ({ taken, capacity }) => {
  const cap = Number(capacity) || 0;
  const used = Math.min(Number(taken) || 0, cap);
  if (cap < 1) return null;
  if (cap > DOT_MAX) return <span>{used}/{cap}</span>;
  return (
    <span className="inline-flex shrink-0 items-center gap-1" aria-label={`${used} of ${cap} booked`}>
      {Array.from({ length: cap }, (_, i) => (
        <span
          key={i}
          className={`h-2.5 w-2.5 rounded-full border border-current ${i < used ? "bg-current" : "bg-transparent opacity-45"}`}
        />
      ))}
    </span>
  );
};

export default SeatDots;
