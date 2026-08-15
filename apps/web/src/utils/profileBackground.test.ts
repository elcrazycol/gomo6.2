import { describe, it, expect } from "vitest";
import {
  DEFAULT_PROFILE_BACKGROUND_VARIANT,
  PROFILE_BACKGROUND_VARIANTS,
  normalizeProfileBackgroundVariant,
} from "./profileBackground";

describe("profileBackground", () => {
  it("exposes exactly 4 display variants", () => {
    expect(PROFILE_BACKGROUND_VARIANTS.map((v) => v.id)).toEqual([
      "banner",
      "card",
      "page",
      "page_dim",
    ]);
  });

  it("normalizes unknown values to the banner default", () => {
    expect(normalizeProfileBackgroundVariant(undefined)).toBe(DEFAULT_PROFILE_BACKGROUND_VARIANT);
    expect(normalizeProfileBackgroundVariant(null)).toBe("banner");
    expect(normalizeProfileBackgroundVariant("tiled")).toBe("banner");
    expect(normalizeProfileBackgroundVariant(42)).toBe("banner");
    expect(normalizeProfileBackgroundVariant("")).toBe("banner");
  });

  it("passes through every valid variant", () => {
    for (const v of PROFILE_BACKGROUND_VARIANTS) {
      expect(normalizeProfileBackgroundVariant(v.id)).toBe(v.id);
    }
  });
});
