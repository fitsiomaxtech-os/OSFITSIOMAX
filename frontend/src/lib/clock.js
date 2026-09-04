/**
 * Reading a clocked day: a time, and how long something took.
 *
 * Two screens show the same day and neither owns it — the header, where a person clocks
 * themselves (components/ClockWidget.jsx), and HR's register, which is where those times
 * land (components/hr/HROpsTabs.jsx). One copy, so an hour and a half is not "1h 30m" on
 * one of them and "90m" on the other.
 *
 * Formatting only. What the day means is the server's — see backend/routers/v3_clock.py.
 */

/** "09:00" → "9:00 AM". Blank in, blank out — a missing time reads as a dash at the call
 *  site rather than as "NaN:undefined". 24-hour is what is stored; this is for reading. */
export const prettyTime = (hhmm) => {
  const [h, m] = String(hhmm || "").split(":");
  if (h === undefined || m === undefined) return "";
  const hour = Number(h);
  if (Number.isNaN(hour)) return "";
  return `${((hour + 11) % 12) + 1}:${m} ${hour < 12 ? "AM" : "PM"}`;
};

/** 465 → "7h 45m". Under an hour drops the hours rather than printing "0h 45m", which
 *  reads as a rounding error rather than as three quarters of one. */
export const duration = (mins) => {
  const n = Math.max(Math.round(Number(mins) || 0), 0);
  return n >= 60 ? `${Math.floor(n / 60)}h ${String(n % 60).padStart(2, "0")}m` : `${n}m`;
};

/** 465 → "7.8h". The same minutes as `duration`, in the form a column of them can be
 *  compared down: "7h 45m" against "7h 05m" is two numbers to read per row, and a table
 *  of hours worked is scanned rather than read. Zero is a dash — nobody worked no hours,
 *  they did not work, and "0.0h" states it as a measurement. */
export const hours = (mins) => {
  const n = Math.max(Math.round(Number(mins) || 0), 0);
  return n === 0 ? "—" : `${(n / 60).toFixed(1)}h`;
};
