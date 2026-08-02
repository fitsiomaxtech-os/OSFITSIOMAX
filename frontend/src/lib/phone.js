// Phone helpers shared by the boards that offer Call and WhatsApp on a patient.
//
// This logic was copied into four boards before it lived anywhere; new callers import it
// from here instead of growing a fifth. The existing copies are identical and can be
// pointed at this file whenever those components are next touched.

/**
 * A stored phone in E.164 for wa.me and tel:, which take digits only — no +, spaces, or
 * the "p:" prefix some records carry.
 *
 * A bare 10-digit number is assumed Indian, matching every other number in the system;
 * anything already carrying a country code is left alone. Returns "" when there's
 * nothing dialable, so a caller can hide the button rather than offer a dead link.
 */
export const waNumber = (raw) => {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  return digits;
};
