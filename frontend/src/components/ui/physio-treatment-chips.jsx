import { Activity } from "lucide-react";

/**
 * What a finished day was treated with, read back — the tags a physio ticks off Services
 * and Products > Physiotherapy Treatment when they sign a day off.
 *
 * Renders nothing at all when there is nothing to show, rather than a heading over an
 * empty row: a day completed before this field existed, and a day the physio chose not to
 * tag, are both real days and neither should read as a record with a hole in it.
 *
 * Lives here rather than in PhysioBoard because the Consultant's review popup reads the
 * same tags back on the same days — one shape for one fact, so the two boards cannot
 * drift into printing a treatment list two different ways.
 */
export function PhysioTreatmentChips({ names, testid }) {
  const list = (names || []).filter(Boolean);
  if (list.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1" data-testid={testid}>
      {list.map((n) => (
        <span key={n} className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700">
          <Activity className="h-2.5 w-2.5" /> {n}
        </span>
      ))}
    </div>
  );
}

export default PhysioTreatmentChips;
