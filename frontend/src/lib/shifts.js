// A working window, as the two screens that publish against it read it.
//
// A shift used to be one stretch of the clock, and for most people it still is. But a split
// day is ordinary on this floor: the consultant who takes 8:00 AM – 1:00 PM, goes home, and
// is back 5:00 PM – 9:00 PM works two windows and not one long one. Rostered as a single
// 8-to-9 shift, every afternoon hour they are not there gets published and offered to a
// patient — which is the one thing a calendar must never do.
//
// So the backend answers with `segments`: the halves of the day, already merged where they
// overlap and sorted by the clock. `start_time` / `end_time` are still sent as the outer
// edges of it, for the callers that only want to say roughly when — never for building a
// grid, which is exactly the mistake these helpers exist to make hard.

import { to12h } from "@/lib/time";

/** "07:30" -> 450 minutes past midnight, or null if it isn't a 24-hour HH:MM. */
export const minutesOfTime = (hhmm) => {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  return Number.isNaN(h) || Number.isNaN(m) ? null : h * 60 + m;
};

/**
 * The halves of a window, oldest shape included: a reply from before split days existed
 * carries no `segments` and is read as the one window it describes.
 */
export const segmentsOf = (window) => {
  if (!window) return [];
  const segs = Array.isArray(window.segments) ? window.segments.filter((s) => s?.start_time && s?.end_time) : [];
  if (segs.length > 0) return segs;
  return window.start_time && window.end_time
    ? [{ shift_id: window.shift_id, shift_name: window.shift_name, start_time: window.start_time, end_time: window.end_time }]
    : [];
};

/** "8:00 AM – 1:00 PM" · both halves when there are two, so nobody reads 8 AM to 9 PM. */
export const hoursLabel = (window) =>
  segmentsOf(window).map((s) => `${to12h(s.start_time)} – ${to12h(s.end_time)}`).join(" · ");

/** "Morning + Evening · 8:00 AM – 1:00 PM · 5:00 PM – 9:00 PM" — the window said in full. */
export const windowLabel = (window) => {
  const hours = hoursLabel(window);
  if (!hours) return "";
  return window?.shift_name ? `${window.shift_name} · ${hours}` : hours;
};

/**
 * Every slot start a window opens, across all of its halves.
 *
 * Each segment is filled on its own so the gap between a morning and an evening is never
 * offered, and every slot finishes inside the half it started in — a 45-minute slot is not
 * published at 12:30 on a morning that ends at 1:00.
 */
export const gridTimesFor = (window, step, fallback = { start_time: "08:00", end_time: "22:00" }) => {
  const size = step || 30;
  const segs = segmentsOf(window);
  const use = segs.length > 0 ? segs : segmentsOf(fallback);
  const times = [];
  use.forEach((seg) => {
    const from = minutesOfTime(seg.start_time);
    const to = minutesOfTime(seg.end_time);
    if (from === null || to === null) return;
    for (let m = from; m + size <= to; m += size) {
      times.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
    }
  });
  // De-duplicated and sorted: two halves that were merged server-side cannot collide, but a
  // window assembled in the browser mid-save can, and a grid must never list an hour twice.
  return [...new Set(times)].sort();
};

/** The shifts an expert is on, whichever shape the row came back in. */
export const shiftIdsOf = (expertOrWindow) => {
  const ids = expertOrWindow?.shift_ids;
  if (Array.isArray(ids) && ids.length > 0) return ids.filter(Boolean);
  return expertOrWindow?.shift_id ? [expertOrWindow.shift_id] : [];
};
