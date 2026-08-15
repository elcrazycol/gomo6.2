import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildThemeTokens, isValidThemeTokens, applyProfileThemeTokens } from "./profileTheme";

describe("buildThemeTokens", () => {
  it("produces a light palette for a bright dominant color", () => {
    const tokens = buildThemeTokens({ h: 120, s: 60, l: 60 });
    expect(tokens["--background"]).toBe("120 22% 95%");
    expect(tokens["--foreground"]).toBe("120 15% 15%");
    expect(tokens["--primary"]).toMatch(/^120 \d+% \d+%$/);
    expect(tokens["--primary-foreground"]).toBe("0 0% 100%");
  });

  it("produces a dark palette for a dark dominant color", () => {
    const tokens = buildThemeTokens({ h: 200, s: 50, l: 20 });
    expect(tokens["--background"]).toBe("200 20% 9%");
    expect(tokens["--foreground"]).toBe("200 12% 90%");
  });

  it("always emits every token the theme system expects", () => {
    const tokens = buildThemeTokens({ h: 30, s: 40, l: 50 });
    const required = [
      "--background", "--foreground", "--card", "--card-foreground",
      "--popover", "--popover-foreground", "--primary", "--primary-foreground",
      "--secondary", "--secondary-foreground", "--muted", "--muted-foreground",
      "--accent", "--accent-foreground", "--border", "--input", "--ring",
      "--board-header", "--board-header-foreground", "--thread-hover",
      "--post-header", "--quote-text", "--link-text", "--link",
    ];
    for (const key of required) {
      expect(tokens[key], key).toBeTruthy();
    }
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
    expect(document.documentElement.style.getPropertyValue("--background")).toBe("120 20% 95%");
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
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("1 2% 3%");
    cleanup();
  });
});

// extractPaletteFromImage needs a real canvas + image decode — covered
// implicitly by the Profile e2e flow; keep the pure helpers tested here.
void vi;
