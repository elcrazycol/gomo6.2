import { describe, expect, it } from "vitest";

import { clampSpoilerLabel, spoilerLabel, MAX_SPOILER_LABEL_RUNES } from "./spoilerSchema";

describe("spoilerSchema", () => {
  it("collapses whitespace and trims", () => {
    expect(clampSpoilerLabel("  Спойлер\n  к   серии  ")).toBe("Спойлер к серии");
  });

  it("caps the label length", () => {
    expect(Array.from(clampSpoilerLabel("a".repeat(500))).length).toBe(MAX_SPOILER_LABEL_RUNES);
  });

  it("falls back to the default label", () => {
    expect(spoilerLabel("")).toBe("Спойлер");
    expect(spoilerLabel(null)).toBe("Спойлер");
    expect(spoilerLabel("   ")).toBe("Спойлер");
    expect(spoilerLabel("Мой спойлер")).toBe("Мой спойлер");
  });
});
