/**
 * What a branch may record spending against — a fixed list, mirrored from
 * BRANCH_EXPENSE_CATEGORIES in backend/constants.py (which is where it is enforced).
 *
 * Rent, Salary and Electricity ("EB") are deliberately absent: they are large, fixed and
 * paid centrally by the accountant against an invoice, not settled by a branch from the
 * drawer. The server refuses them from a branch whatever the form sends.
 */
export const BRANCH_EXPENSE_CATEGORIES = [
  "Water",
  "Internet & Phone",
  "Maintenance",
  "Equipment",
  "Consumables",
  "Housekeeping",
  "Marketing",
  "Travel",
  "Staff Welfare",
  "Other",
];
