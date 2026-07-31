// Times are stored and sent as 24-hour "HH:MM" (and slots as "YYYY-MM-DDTHH:MM").
// The OS displays them in 12-hour form everywhere — these helpers are display-only and
// must never be used to build a value that goes back to the API.

/** "09:30" -> "9:30 AM" · "21:30" -> "9:30 PM" */
export const to12h = (time) => {
  if (!time || typeof time !== "string" || !time.includes(":")) return time || "—";
  const [rawH, rawM] = time.split(":");
  const h = parseInt(rawH, 10);
  const m = (rawM || "").slice(0, 2);
  if (Number.isNaN(h)) return time;
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${suffix}`;
};

/** "2026-08-09T09:30" -> "9:30 AM" (accepts a bare "HH:MM" too) */
export const slotTo12h = (slotTime) => {
  if (!slotTime || typeof slotTime !== "string") return "—";
  return to12h(slotTime.includes("T") ? slotTime.split("T")[1] : slotTime);
};

/** "09:30" + 30 -> "10:00 AM" — the end of a slot, for "9:30 AM – 10:00 AM" ranges. */
export const endTime12h = (time, minutes) => {
  if (!time || !time.includes(":")) return time || "—";
  const [h, m] = time.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return time;
  const total = h * 60 + m + (minutes || 0);
  const eh = Math.floor(total / 60) % 24;
  const em = total % 60;
  return to12h(`${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}`);
};
