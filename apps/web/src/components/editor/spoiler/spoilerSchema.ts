// Spoiler block: a "click to reveal" container for text and media, distinct
// from the inline `spoiler` mark (which only blurs a run of text). The label is
// the text shown on the collapsed header.

export const SPOILER_BLOCK_NODE = "spoilerBlock";

/** Matches the server's caption limit headroom; keeps the header on one line. */
export const MAX_SPOILER_LABEL_RUNES = 120;
export const DEFAULT_SPOILER_LABEL = "Спойлер";

/** Collapse whitespace and cap the length of a spoiler label. */
export const clampSpoilerLabel = (raw: unknown): string => {
  if (typeof raw !== "string") return "";
  const trimmed = raw.replace(/\s+/g, " ").trim();
  return Array.from(trimmed).slice(0, MAX_SPOILER_LABEL_RUNES).join("");
};

/** Label to render on the header — falls back to a sensible default. */
export const spoilerLabel = (raw: unknown): string => clampSpoilerLabel(raw) || DEFAULT_SPOILER_LABEL;
