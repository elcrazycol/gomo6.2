import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  buildThemeTokens,
  isValidThemeTokens,
  applyProfileThemeTokens,
  collectPixelStats,
  deriveVariantsFromStats,
  normalizeTokenValue,
  rgbToHsl,
} from "./profileTheme";
import { parseOklch } from "@/theme/color";

/** Build an RGBA buffer filled with a single color repeated n times. */
const solidBuffer = (r: number, g: number, b: number, n = 64): Uint8ClampedArray => {
  const buf = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    buf[i * 4] = r;
    buf[i * 4 + 1] = g;
    buf[i * 4 + 2] = b;
    buf[i * 4 + 3] = 255;
  }
  return buf;
};

describe("rgbToHsl", () => {
  it("converts pure red", () => {
    const c = rgbToHsl(255, 0, 0);
    expect(c.h).toBeCloseTo(0);
    expect(c.s).toBeCloseTo(100);
  });
  it("converts gray to zero saturation", () => {
    const c = rgbToHsl(128, 128, 128);
    expect(c.s).toBeCloseTo(0);
  });
});

describe("collectPixelStats", () => {
  it("treats a solid green image as fully colored with hue ~120", () => {
    const stats = collectPixelStats(solidBuffer(0, 200, 0));
    expect(stats.total).toBe(64);
    expect(stats.grayShare).toBe(0);
    // 0,200,0 → hue 120
    const dominant = deriveVariantsFromStats(stats)[0];
    expect(dominant.color.h).toBeGreaterThan(110);
    expect(dominant.color.h).toBeLessThan(130);
  });

  it("treats a solid gray image as fully gray (grayShare = 1)", () => {
    const stats = collectPixelStats(solidBuffer(128, 128, 128));
    expect(stats.grayShare).toBe(1);
  });

  it("mixed gray + colored pixels reports a partial gray share", () => {
    const buf = new Uint8ClampedArray(64 * 4);
    // 48 gray pixels, 16 red pixels
    for (let i = 0; i < 64; i++) {
      const isGray = i < 48;
      buf[i * 4] = isGray ? 128 : 255;
      buf[i * 4 + 1] = isGray ? 128 : 0;
      buf[i * 4 + 2] = isGray ? 128 : 0;
      buf[i * 4 + 3] = 255;
    }
    const stats = collectPixelStats(buf);
    expect(stats.grayShare).toBeCloseTo(0.75);
  });
});

describe("deriveVariantsFromStats", () => {
  it("produces 5 variants for a colored image, dominant hue preserved", () => {
    const stats = collectPixelStats(solidBuffer(0, 200, 0));
    const variants = deriveVariantsFromStats(stats);
    expect(variants.map((v) => v.id)).toEqual(["dominant", "vibrant", "light", "dark", "neutral"]);
    const dominant = variants[0];
    const primary = parseOklch(dominant.tokens["--primary"]);
    expect(primary).not.toBeNull();
    expect(primary!.H).toBeGreaterThan(110);
    expect(primary!.H).toBeLessThan(160);
  });

  it("gray-dominant image yields a LOW-saturation theme (not a random hue)", () => {
    // 90% gray + 10% red: dominant color is still gray → neutral palette.
    const buf = new Uint8ClampedArray(100 * 4);
    for (let i = 0; i < 100; i++) {
      const isGray = i < 90;
      buf[i * 4] = isGray ? 140 : 255;
      buf[i * 4 + 1] = isGray ? 140 : 0;
      buf[i * 4 + 2] = isGray ? 140 : 0;
      buf[i * 4 + 3] = 255;
    }
    const stats = collectPixelStats(buf);
    expect(stats.grayShare).toBeGreaterThan(0.75);
    const variants = deriveVariantsFromStats(stats);
    const dominant = variants[0];
    // Neutral theme: saturation floor is low, so --primary chroma stays tiny.
    const sat = parseOklch(dominant.tokens["--primary"])?.C ?? 1;
    expect(sat).toBeLessThan(0.05);
  });

  it("colored-dominant image keeps a saturated theme", () => {
    const stats = collectPixelStats(solidBuffer(0, 200, 0));
    const variants = deriveVariantsFromStats(stats);
    const sat = parseOklch(variants[0].tokens["--primary"])?.C ?? 0;
    expect(sat).toBeGreaterThanOrEqual(0.06);
  });

  it("every variant emits all tokens", () => {
    const stats = collectPixelStats(solidBuffer(0, 120, 255));
    const required = [
      "--background", "--foreground", "--card", "--card-foreground",
      "--popover", "--popover-foreground", "--primary", "--primary-foreground",
      "--secondary", "--secondary-foreground", "--muted", "--muted-foreground",
      "--accent", "--accent-foreground", "--border", "--input", "--ring",
      "--board-header", "--board-header-foreground", "--thread-hover",
      "--post-header", "--quote-text", "--link-text", "--link",
    ];
    for (const v of deriveVariantsFromStats(stats)) {
      for (const key of required) expect(v.tokens[key], `${v.id}.${key}`).toBeTruthy();
    }
  });
});

describe("buildThemeTokens", () => {
  it("produces a light palette for a bright dominant color", () => {
    const tokens = buildThemeTokens({ h: 120, s: 60, l: 60 });
    const bg = parseOklch(tokens["--background"]);
    expect(bg).not.toBeNull();
    expect(bg!.L).toBeGreaterThan(0.9);
    const primary = parseOklch(tokens["--primary"]);
    expect(primary).not.toBeNull();
    expect(primary!.H).toBeGreaterThan(120);
    expect(primary!.H).toBeLessThan(170);
    expect(parseOklch(tokens["--primary-foreground"])!.L).toBeGreaterThan(0.9);
  });

  it("produces a dark palette for a dark dominant color", () => {
    const tokens = buildThemeTokens({ h: 200, s: 50, l: 20 });
    expect(parseOklch(tokens["--background"])!.L).toBeLessThan(0.3);
    expect(parseOklch(tokens["--foreground"])!.L).toBeGreaterThan(0.8);
  });

  it("neutral mode keeps surfaces almost desaturated (gray stays gray)", () => {
    const tokens = buildThemeTokens({ h: 220, s: 4, l: 50 }, "neutral");
    // Surfaces must be nearly gray — chroma near zero — so a gray photo gives a
    // gray theme, not a brownish/blueish tint.
    expect(parseOklch(tokens["--background"])!.C).toBeLessThanOrEqual(0.01);
    expect(parseOklch(tokens["--card"])!.C).toBeLessThanOrEqual(0.01);
    expect(parseOklch(tokens["--primary"])!.C).toBeLessThanOrEqual(0.02);
  });

  it("neutral mode desaturates accents too — no blue links/quote text", () => {
    const tokens = buildThemeTokens({ h: 220, s: 4, l: 50 }, "neutral");
    for (const key of ["--link", "--link-text", "--quote-text", "--ring", "--board-header"]) {
      expect(parseOklch(tokens[key])!.C, key).toBeLessThanOrEqual(0.02);
    }
  });

  it("color mode keeps accents saturated", () => {
    const tokens = buildThemeTokens({ h: 220, s: 60, l: 50 }, "color");
    expect(parseOklch(tokens["--link"])!.C).toBeGreaterThanOrEqual(0.06);
    expect(parseOklch(tokens["--quote-text"])!.C).toBeGreaterThanOrEqual(0.14);
  });

  it("gray-dominant image: dominant variant is graphite, not the colored patch hue", () => {
    // 90% gray + 10% brown (hue ~30): gray share > 0.75 → dominant hue is
    // graphite (220), not brown.
    const buf = new Uint8ClampedArray(100 * 4);
    for (let i = 0; i < 100; i++) {
      const isGray = i < 90;
      // gray #8c8c8c, brown #a0522d (hue ~30)
      const [r, g, b] = isGray ? [140, 140, 140] : [160, 82, 45];
      buf[i * 4] = r;
      buf[i * 4 + 1] = g;
      buf[i * 4 + 2] = b;
      buf[i * 4 + 3] = 255;
    }
    const stats = collectPixelStats(buf);
    expect(stats.grayShare).toBeGreaterThan(0.75);
    const dominant = deriveVariantsFromStats(stats)[0];
    expect(dominant.id).toBe("dominant");
    expect(dominant.color.h).toBeGreaterThan(200); // graphite, not brown ~30
    expect(dominant.color.h).toBeLessThan(240);
  });
});

describe("isValidThemeTokens", () => {
  it("accepts a partial token map", () => {
    expect(isValidThemeTokens({ "--primary": "0.569 0.1717 142.9" })).toBe(true);
    // Legacy HSL payloads are still considered valid (normalized on apply).
    expect(isValidThemeTokens({ "--primary": "120 60% 35%" })).toBe(true);
  });

  it("rejects empty objects, arrays and junk", () => {
    expect(isValidThemeTokens({})).toBe(false);
    expect(isValidThemeTokens(null)).toBe(false);
    expect(isValidThemeTokens("nope")).toBe(false);
    expect(isValidThemeTokens([])).toBe(false);
    expect(isValidThemeTokens({ "--position": "fixed" })).toBe(false);
  });
});

describe("applyProfileThemeTokens", () => {
  beforeEach(() => {
    document.documentElement.style.cssText = "";
    document.body.style.cssText = "";
  });
  afterEach(() => {
    document.documentElement.style.cssText = "";
    document.body.style.cssText = "";
  });

  it("applies tokens to html AND body (body shadows html) and restores on cleanup", () => {
    const tokens = { "--primary": "0.569 0.1717 142.9", "--background": "0.9649 0.0108 145.5" };
    const cleanup = applyProfileThemeTokens(tokens);
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe(tokens["--primary"]);
    expect(document.body.style.getPropertyValue("--primary")).toBe(tokens["--primary"]);
    cleanup();
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("");
    expect(document.body.style.getPropertyValue("--primary")).toBe("");
  });

  it("normalizes legacy HSL tokens to OKLCH when applying", () => {
    const expected = normalizeTokenValue("120 60% 35%");
    const cleanup = applyProfileThemeTokens({ "--primary": "120 60% 35%" });
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe(expected);
    expect(document.body.style.getPropertyValue("--primary")).toBe(expected);
    cleanup();
  });

  it("restores previously set inline values on both elements", () => {
    document.documentElement.style.setProperty("--primary", "330 70% 50%");
    document.body.style.setProperty("--primary", "330 70% 50%");
    const normalized = normalizeTokenValue("120 60% 35%");
    const cleanup = applyProfileThemeTokens({ "--primary": "120 60% 35%" });
    expect(document.body.style.getPropertyValue("--primary")).toBe(normalized);
    cleanup();
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("330 70% 50%");
    expect(document.body.style.getPropertyValue("--primary")).toBe("330 70% 50%");
  });

  it("ignores unknown keys", () => {
    const cleanup = applyProfileThemeTokens({ "--nope": "1px solid red", "--primary": "0.5 0.1 120" });
    expect(document.documentElement.style.getPropertyValue("--nope")).toBe("");
    expect(document.body.style.getPropertyValue("--nope")).toBe("");
    cleanup();
  });
});
