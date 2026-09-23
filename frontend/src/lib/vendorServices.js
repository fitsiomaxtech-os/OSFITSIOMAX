/**
 * What a vendor supplies — the chips the Vendor form offers, mirrored from
 * VENDOR_SERVICE_CATEGORIES in backend/constants.py.
 *
 * A vendor is anyone the branch pays for something that arrives: the water can supplier,
 * the broadband provider, the AC man, the housekeeping agency, the tablet distributor.
 * The names match the branch expense categories in ./expenseCategories.js wherever the
 * two mean the same thing, so a vendor's category is the category the payment to them is
 * filed under.
 *
 * Unlike the expense list this one is open — a branch can type its own, and the server
 * keeps it. These are the ones worth offering, not the only ones allowed.
 */
export const VENDOR_SERVICE_CATEGORIES = [
  "Medicines & Supplements",
  "Equipment",
  "Water",
  "Internet & Phone",
  "Maintenance",
  "Housekeeping",
  "Consumables",
  "Marketing",
  "Travel",
  "Staff Welfare",
  "Other",
];

/** Matches VENDOR_SERVICE_MAX_LEN / _MAX_COUNT on the server, so the form says no first. */
export const VENDOR_SERVICE_MAX_LEN = 40;
export const VENDOR_SERVICE_MAX_COUNT = 8;
