import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  AA_PAIRS,
  buildCustomTokens,
  customToThemeDef,
  getCustomThemes,
  parseCustomThemeJson,
  saveCustomTheme,
  deleteCustomTheme,
  newCustomId,
  getFavorites,
  toggleFavorite,
  getTimeAuto,
  setTimeAuto,
  resolveTimeMode,
  getTimeAuto as _getTimeAuto,
  wcagContrast,
  parseOklch,
  type CustomThemeDef,
} from "./index";

const seedDef = (over: Partial<CustomThemeDef> = {}): CustomThemeDef => ({
  id: newCustomId(),
  name: "Test",
  seed: { L: 0.62, C: 0.15, H: 265 },
  style: "soft",
  radius: "0.5rem",
  supports: ["light", "dark"],
  ...over,
});

describe("buildCustomTokens", () => {
  it("emits every token as valid OKLCH", () => {
    const tokens = buildCustomTokens({ L: 0.6, C: 0.14, H: 200 }, "dark", "soft");
    expect(Object.keys(tokens).length).toBeGreaterThanOrEqual(32);
    for (const [key, value] of Object.entries(tokens)) {
      expect(parseOklch(value), `${key}=${value}`).not.toBeNull();
    }
  });

  it("passes WCAG AA for every text/surface pair", () => {
    for (const style of ["soft", "pastel", "mono"] as const) {
      for (const mode of ["light", "dark"] as const) {
        const tokens = buildCustomTokens({ L: 0.6, C: 0.14, H: 30 }, mode, style);
        for (const [textKey, surfaceKey] of AA_PAIRS) {
          const a = parseOklch(tokens[textKey]);
          const b = parseOklch(tokens[surfaceKey]);
          if (!a || !b) continue;
          expect(wcagContrast(a, b), `${style}/${mode} ${textKey} on ${surfaceKey}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
});

describe("custom theme storage", () => {
  beforeEach(() => localStorage.clear());

  it("compiles a stored definition into a ThemeDef", () => {
    const theme = customToThemeDef(seedDef());
    expect(theme.custom).toBe(true);
    expect(theme.group).toBe("custom");
    expect(theme.supports).toEqual(["light", "dark"]);
    expect(theme.accent.dark).toMatch(/^oklch\(/);
    expect(Object.keys(theme.tokens.light ?? {}).length).toBeGreaterThanOrEqual(32);
  });

  it("saves, updates and deletes", () => {
    const def = seedDef();
    saveCustomTheme(def);
    expect(getCustomThemes().map((d) => d.id)).toContain(def.id);
    saveCustomTheme({ ...def, name: "Renamed" });
    expect(getCustomThemes().find((d) => d.id === def.id)?.name).toBe("Renamed");
    deleteCustomTheme(def.id);
    expect(getCustomThemes().map((d) => d.id)).not.toContain(def.id);
  });

  it("parses and clamps imported JSON", () => {
    const parsed = parseCustomThemeJson(JSON.stringify({ name: "X", seed: { L: 1.4, C: -1, H: 720 }, style: "pastel" }));
    expect(parsed).not.toBeNull();
    expect(parsed!.seed.L).toBe(1);
    expect(parsed!.seed.C).toBe(0);
    expect(parsed!.seed.H).toBe(0);
    expect(parsed!.style).toBe("pastel");
    expect(parseCustomThemeJson("not json")).toBeNull();
  });
});

describe("theme collections", () => {
  beforeEach(() => localStorage.clear());

  it("toggles favourites", () => {
    expect(getFavorites()).toEqual([]);
    toggleFavorite("graphite");
    expect(getFavorites()).toEqual(["graphite"]);
    toggleFavorite("graphite");
    expect(getFavorites()).toEqual([]);
  });
});

describe("time-of-day schedule", () => {
  beforeEach(() => localStorage.clear());

  it("is light during the day and dark at night", () => {
    expect(resolveTimeMode(new Date("2026-09-28T10:00:00"))).toBe("light");
    expect(resolveTimeMode(new Date("2026-09-28T22:00:00"))).toBe("dark");
    expect(resolveTimeMode(new Date("2026-09-28T03:00:00"))).toBe("dark");
  });

  it("round-trips the flag", () => {
    expect(getTimeAuto()).toBe(false);
    setTimeAuto(true);
    expect(getTimeAuto()).toBe(true);
    void _getTimeAuto;
  });
});

void vi;
