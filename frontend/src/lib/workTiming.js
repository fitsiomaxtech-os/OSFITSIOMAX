/**
 * The clock a login is expected to keep, on the browser's side.
 *
 * Four times, set per account in Super Admin → Credentials: on at LOGIN, away from BREAK
 * IN until BREAK OUT, off at LOGOUT. "Break in" starts the break and "break out" ends it —
 * the same reading as login and logout, where "in" is the beginning of the thing named.
 *
 * Its own module because two screens share them and neither owns them: Credentials writes
 * the roster (HRBoard.jsx) and Attendance reads it (HROpsTabs.jsx). A register that
 * disagreed with the roster it was drawn from would be worse than either screen being
 * wrong on its own.
 *
 * Mirrors backend/work_timing.py, which is the authority: the figure the register stores is
 * always the server's. These exist so the screen can answer while somebody is still typing
 * — a "late by 14m" that only appears after a save is a save made to find something out.
 */

export const WORK_TIMING_FIELDS = ["login_time", "logout_time", "break_in_time", "break_out_time"];

// Mirrors LATE_GRACE_MINUTES in backend/work_timing.py. Only a fallback for a reply that
// has not landed yet — the register sends its own down as `late_grace_minutes`.
export const LATE_GRACE_MINUTES = 10;

const DAY_MINUTES = 24 * 60;

/** The four times off a user row or a register row — always all four, blank where unset.
 *  Reads `work_timing` if the row carries it and the flat fields otherwise, so an account
 *  and a register row can both be passed in without the caller unpacking either. */
export const workTiming = (row) => {
  const t = (row && (row.work_timing || row.shift)) || row || {};
  return WORK_TIMING_FIELDS.reduce((out, f) => ({ ...out, [f]: t[f] || "" }), {});
};

/** Whether anybody has set hours here at all. An empty roster is not a 00:00 start. */
export const isRostered = (timing) => WORK_TIMING_FIELDS.some((f) => (timing || {})[f]);

/** "09:00" → "9:00 AM". Blank in, blank out — a missing time reads as a dash at the call
 *  site rather than as "NaN:undefined". 24-hour is what is stored and what the time inputs
 *  speak; this is only for reading a roster at a glance. */
export const prettyTime = (hhmm) => {
  const [h, m] = String(hhmm || "").split(":");
  if (h === undefined || m === undefined) return "";
  const hour = Number(h);
  if (Number.isNaN(hour)) return "";
  return `${((hour + 11) % 12) + 1}:${m} ${hour < 12 ? "AM" : "PM"}`;
};

const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm || "").split(":");
  const hour = Number(h), min = Number(m);
  if (!Number.isInteger(hour) || !Number.isInteger(min)) return null;
  if (hour < 0 || hour > 23 || min < 0 || min > 59) return null;
  return hour * 60 + min;
};

/** Minutes a check-in ran past the rostered login. 0 for early, unset or unrostered.
 *
 *  The same arithmetic as late_by in backend/work_timing.py. Both times are clock faces
 *  with no date on them, so the gap is read as the nearer of the two directions — which is
 *  what makes 08:50 on a 09:00 start ten minutes early rather than most of a day late.
 *  Half a comparison is not a late arrival: an unrostered person, or a mark with no time
 *  typed on it, comes back 0. */
export const lateBy = (timing, checkIn) => {
  const start = toMinutes((timing || {}).login_time), actual = toMinutes(checkIn);
  if (start === null || actual === null) return 0;
  const diff = ((actual - start + DAY_MINUTES / 2) % DAY_MINUTES + DAY_MINUTES) % DAY_MINUTES - DAY_MINUTES / 2;
  return diff > 0 ? diff : 0;
};

/** How far past, in words: "14m", or "1h 05m" once it runs to an hour. */
export const lateLabel = (mins) => (mins >= 60 ? `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m` : `${mins}m`);
