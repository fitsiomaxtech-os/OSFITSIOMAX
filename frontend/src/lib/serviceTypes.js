/**
 * How a service type (a branch's "vertical") is named and coloured wherever it is shown.
 *
 * Kept in one place because it is shown in two: the Service Type manager, where the list is
 * maintained, and the Vertical picker on the branch form, where one is chosen. Those two
 * screens are opened within a click of each other from the same toolbar, so a type that is
 * blue on one and pink on the other reads as two different things.
 */

// The OS's chip palette — blue, green, amber, violet, rose, cyan.
export const SERVICE_TYPE_COLORS = ["#2563eb", "#059669", "#d97706", "#7c3aed", "#e11d48", "#0891b2"];

/**
 * The colour for a service type, from its own name.
 *
 * Off the name rather than its position in the list, which is what this replaced. A branch
 * form's Vertical picker shows only the types matching Online or Offline, so the same type
 * sits at a different index there than in the full list on the Service Type screen — and an
 * index-coloured chip changed colour between the two, or when a type was added above it.
 *
 * The hash only has to be stable and spread, not unguessable.
 */
export const serviceTypeColor = (name) => {
  const s = String(name || "");
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 100000;
  return SERVICE_TYPE_COLORS[h % SERVICE_TYPE_COLORS.length];
};

/**
 * "offline_physiotherapy" -> "offline physiotherapy". Only the underscores go: the casing is
 * left to CSS so the chips can carry the OS's small-caps treatment, and what gets read back
 * for a match is still the stored name.
 */
export const serviceTypeLabel = (name) => String(name || "").replace(/_/g, " ");

/** The tile styles a chip wears, so the manager and the picker cannot drift apart. */
export const serviceTypeChipStyle = (color) => ({
  tile: { backgroundColor: `${color}0f`, borderColor: `${color}33` },
  glyph: { backgroundColor: `${color}24` },
  icon: { color },
});
