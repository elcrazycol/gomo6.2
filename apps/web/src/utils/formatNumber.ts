/**
 * Compact counter formatting with Russian suffixes ("1,2К" instead of "1243").
 *
 * Rules:
 *   < 1 000             → raw number (956)
 *   < 1 000 000         → "К" with up to one decimal, trailing zeros stripped (1К, 1,2К, 25К)
 *   < 1 000 000 000     → "М" (1,5М, 12М)
 *   < 1 000 000 000 000 → "Б" (1,5Б)
 *   else                → "Т" (1,5Т)
 *
 * Rounding rollovers are normalized: 999 999 → "1М", 999 999 999 → "1Б" —
 * never "1000К". Rollover is computed DIRECTLY (no recursion): recursing on
 * the same band's boundary (e.g. 999 950 000 → 999 950 000) would loop
 * forever.
 */
export const formatCompactNumber = (value: number): string => {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";

  let scaled: number;
  let suffix: string;
  if (abs < 1_000) {
    return `${sign}${abs}`;
  }
  if (abs < 1_000_000) {
    scaled = abs / 1_000;
    suffix = "К";
  } else if (abs < 1_000_000_000) {
    scaled = abs / 1_000_000;
    suffix = "М";
  } else if (abs < 1_000_000_000_000) {
    scaled = abs / 1_000_000_000;
    suffix = "Б";
  } else {
    scaled = abs / 1_000_000_000_000;
    suffix = "Т";
  }

  // Round to one decimal so the badge stays compact; maximumFractionDigits
  // strips trailing zeros ("1" for 1.0, "1,2" for 1.24).
  const rounded = Math.round(scaled * 10) / 10;
  if (rounded >= 1000) {
    // Rollover artifact (e.g. 999 999 / 1 000 → "1000К"): render as 1 of the
    // next unit instead. The top band (≥ 10^15) is capped at "1000Т" — far
    // beyond anything a real counter reaches, but it terminates.
    if (suffix === "К") return `${sign}1М`;
    if (suffix === "М") return `${sign}1Б`;
    if (suffix === "Б") return `${sign}1Т`;
    return `${sign}1000Т`;
  }

  const text = rounded.toLocaleString("ru-RU", { maximumFractionDigits: 1 });
  return `${sign}${text}${suffix}`;
};
