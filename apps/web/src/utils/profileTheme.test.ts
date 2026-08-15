import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  buildThemeTokens,
  isValidThemeTokens,
  applyProfileThemeTokens,
  collectPixelStats,
  deriveVariantsFromStats,
  rgbToHsl,
} from "./profileTheme";

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
    expect(dominant.tokens["--primary"]).toMatch(/^1[0-2][0-9] \d+% \d+%$/);
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
    // Neutral theme: saturation floor is low (6), so --primary sat < 15%.
    const primary = dominant.tokens["--primary"];
    const sat = Number(primary.split(" ")[1].replace("%", ""));
    expect(sat).toBeLessThan(15);
  });

  it("colored-dominant image keeps a saturated theme", () => {
    const stats = collectPixelStats(solidBuffer(0, 200, 0));
    const variants = deriveVariantsFromStats(stats);
    const primary = variants[0].tokens["--primary"];
    const sat = Number(primary.split(" ")[1].replace("%", ""));
    expect(sat).toBeGreaterThanOrEqual(35);
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
    expect(tokens["--background"]).toBe("120 22% 95%");
    expect(tokens["--primary"]).toMatch(/^120 \d+% \d+%$/);
    expect(tokens["--primary-foreground"]).toBe("0 0% 100%");
  });

  it("produces a dark palette for a dark dominant color", () => {
    const tokens = buildThemeTokens({ h: 200, s: 50, l: 20 });
    expect(tokens["--background"]).toBe("200 20% 9%");
    expect(tokens["--foreground"]).toBe("200 8% 90%");
  });

  it("neutral mode keeps surfaces almost desaturated (gray stays gray)", () => {
    const tokens = buildThemeTokens({ h: 220, s: 4, l: 50 }, "neutral");
    // Surfaces must be nearly gray — sat ~2-3% — so a gray photo gives a
    // gray theme, not a brownish/blueish tint.
    const bgSat = Number(tokens["--background"].split(" ")[1].replace("%", ""));
    const cardSat = Number(tokens["--card"].split(" ")[1].replace("%", ""));
    expect(bgSat).toBeLessThanOrEqual(3);
    expect(cardSat).toBeLessThanOrEqual(2);
    const primarySat = Number(tokens["--primary"].split(" ")[1].replace("%", ""));
    expect(primarySat).toBeLessThanOrEqual(6);
  });

  it("neutral mode desaturates accents too — no blue links/quote text", () => {
    const tokens = buildThemeTokens({ h: 220, s: 4, l: 50 }, "neutral");
    for (const key of ["--link", "--link-text", "--quote-text", "--ring", "--board-header"]) {
      const sat = Number(tokens[key].split(" ")[1].replace("%", ""));
      expect(sat, key).toBeLessThanOrEqual(6);
    }
  });

  it("color mode keeps accents saturated", () => {
    const tokens = buildThemeTokens({ h: 220, s: 60, l: 50 }, "color");
    const linkSat = Number(tokens["--link"].split(" ")[1].replace("%", ""));
    const quoteSat = Number(tokens["--quote-text"].split(" ")[1].replace("%", ""));
    expect(linkSat).toBeGreaterThanOrEqual(35);
    expect(quoteSat).toBeGreaterThanOrEqual(90);
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
    const cleanup = applyProfileThemeTokens({ "--primary": "120 60% 35%", "--background": "120 20% 95%" });
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("120 60% 35%");
    expect(document.body.style.getPropertyValue("--primary")).toBe("120 60% 35%");
    cleanup();
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("");
    expect(document.body.style.getPropertyValue("--primary")).toBe("");
  });

  it("restores previously set inline values on both elements", () => {
    document.documentElement.style.setProperty("--primary", "330 70% 50%");
    document.body.style.setProperty("--primary", "330 70% 50%");
    const cleanup = applyProfileThemeTokens({ "--primary": "120 60% 35%" });
    expect(document.body.style.getPropertyValue("--primary")).toBe("120 60% 35%");
    cleanup();
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("330 70% 50%");
    expect(document.body.style.getPropertyValue("--primary")).toBe("330 70% 50%");
  });

  it("ignores unknown keys", () => {
    const cleanup = applyProfileThemeTokens({ "--nope": "1px solid red", "--primary": "1 2% 3%" });
    expect(document.documentElement.style.getPropertyValue("--nope")).toBe("");
    expect(document.body.style.getPropertyValue("--nope")).toBe("");
    cleanup();
  });
});
