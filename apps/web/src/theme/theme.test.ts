import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  THEMES,
  THEME_IDS,
  THEME_TOKEN_NAMES,
  DEFAULT_THEME,
  DEFAULT_MODE_PREF,
  getTheme,
  resolveMode,
  getStoredPrefs,
  setStoredPrefs,
  applyTheme,
  apcaContrast,
  parseOklch,
  wcagContrast,
  AA_NORMAL,
} from "./index";

/** The text-on-surface pairs that must clear WCAG AA (mirrors the generator). */
const AA_PAIRS: Array<[string, string]> = [
  ["--foreground", "--background"],
  ["--card-foreground", "--card"],
  ["--popover-foreground", "--popover"],
  ["--primary-foreground", "--primary"],
  ["--secondary-foreground", "--secondary"],
  ["--accent-foreground", "--accent"],
  ["--muted-foreground", "--background"],
  ["--destructive-foreground", "--destructive"],
  ["--success-foreground", "--success"],
  ["--warning-foreground", "--warning"],
  ["--info-foreground", "--info"],
  ["--board-header-foreground", "--board-header"],
  ["--link", "--background"],
  ["--link-text", "--background"],
  ["--quote-text", "--background"],
];

describe("theme registry", () => {
  it("ships the expected themes and default", () => {
    expect(THEME_IDS).toContain(DEFAULT_THEME);
    expect(THEME_IDS.length).toBeGreaterThanOrEqual(12);
    expect(getTheme("does-not-exist").id).toBe(DEFAULT_THEME);
  });

  it("every theme declares every token in every supported mode as valid OKLCH", () => {
    for (const theme of THEMES) {
      expect(theme.supports.length, `${theme.id} supports`).toBeGreaterThan(0);
      for (const mode of theme.supports) {
        for (const token of THEME_TOKEN_NAMES) {
          const value = theme.tokens[mode]?.[token];
          expect(value, `${theme.id}/${mode} ${token}`).toBeTruthy();
          expect(parseOklch(value as string), `${theme.id}/${mode} ${token}=${value}`).not.toBeNull();
        }
      }
    }
  });

  it("exposes an accent per supported mode", () => {
    for (const theme of THEMES) {
      for (const mode of theme.supports) {
        expect(theme.accent[mode], `${theme.id}/${mode}`).toMatch(/^oklch\(/);
      }
    }
  });

  it("every theme declares a radius and only ships modes it has tokens for", () => {
    for (const theme of THEMES) {
      expect(theme.radius, `${theme.id} radius`).toBeTruthy();
      expect(theme.supports.length).toBeGreaterThan(0);
    }
    // The catalogue deliberately mixes both-mode and single-mode themes.
    expect(THEMES.some((theme) => theme.supports.length === 1)).toBe(true);
    expect(THEMES.some((theme) => theme.supports.length === 2)).toBe(true);
  });

  it("ships the calm / neutral / mineral / neon / retro / a11y groups", () => {
    const groups = new Set(THEMES.map((theme) => theme.group));
    for (const group of ["calm", "neutral", "mineral", "neon", "retro", "a11y"]) {
      expect(groups.has(group as never), group).toBe(true);
    }
  });
});

describe("WCAG AA across every theme and mode", () => {
  it("every required text/surface pair clears 4.5:1", () => {
    const failures: string[] = [];
    for (const theme of THEMES) {
      for (const mode of theme.supports) {
        const tokens = theme.tokens[mode]!;
        for (const [text, surface] of AA_PAIRS) {
          const a = parseOklch(tokens[text as keyof typeof tokens] as string);
          const b = parseOklch(tokens[surface as keyof typeof tokens] as string);
          if (!a || !b) continue;
          const ratio = wcagContrast(a, b);
          if (ratio < AA_NORMAL) failures.push(`${theme.id}/${mode} ${text} on ${surface} = ${ratio.toFixed(2)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("body text keeps a healthy APCA Lc (informational)", () => {
    for (const theme of THEMES) {
      for (const mode of theme.supports) {
        const tokens = theme.tokens[mode]!;
        const fg = parseOklch(tokens["--foreground"])!;
        const bg = parseOklch(tokens["--background"])!;
        expect(Math.abs(apcaContrast(fg, bg)), `${theme.id}/${mode}`).toBeGreaterThan(60);
      }
    }
  });
});

describe("mode resolution", () => {
  const stubMatchMedia = (dark: boolean) => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: dark,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
  };

  it("follows the OS scheme for the 'system' preference", () => {
    stubMatchMedia(true);
    expect(resolveMode(getTheme(DEFAULT_THEME), "system")).toBe("dark");
    stubMatchMedia(false);
    expect(resolveMode(getTheme(DEFAULT_THEME), "system")).toBe("light");
    vi.unstubAllGlobals();
  });

  it("honors an explicit preference", () => {
    expect(resolveMode(getTheme(DEFAULT_THEME), "light")).toBe("light");
    expect(resolveMode(getTheme(DEFAULT_THEME), "dark")).toBe("dark");
  });
});

describe("preference storage", () => {
  beforeEach(() => localStorage.clear());

  it("migrates the legacy dark-mode boolean", () => {
    localStorage.setItem("dark-mode", "false");
    expect(getStoredPrefs()).toEqual({ theme: DEFAULT_THEME, mode: "light" });
    localStorage.setItem("dark-mode", "true");
    localStorage.removeItem("theme-mode");
    expect(getStoredPrefs().mode).toBe("dark");
  });

  it("round-trips prefs", () => {
    setStoredPrefs({ theme: "mint", mode: "system" });
    expect(getStoredPrefs()).toEqual({ theme: "mint", mode: "system" });
  });

  it("falls back to the default for an unknown theme", () => {
    localStorage.setItem("color-theme", "nope");
    expect(getStoredPrefs().theme).toBe(DEFAULT_THEME);
  });
});

describe("applyTheme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-mode");
  });

  it("sets the attributes and the .dark class", () => {
    const applied = applyTheme("graphite", "dark");
    expect(applied.mode).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("graphite");
    expect(document.documentElement.dataset.mode).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("removes the .dark class in light mode", () => {
    applyTheme("graphite", "dark");
    applyTheme("graphite", "light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.dataset.mode).toBe("light");
  });
});

describe("pre-boot script", () => {
  it("knows the same theme ids as the registry", () => {
    const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
    const match = html.match(/var THEMES = \[([^\]]+)\]/);
    expect(match, "THEMES array in index.html").not.toBeNull();
    const ids = match![1].split(",").map((part) => part.trim().replace(/^"|"$/g, "")).filter(Boolean);
    expect(ids.sort()).toEqual([...THEME_IDS].sort());
  });

  it("defaults to the registry theme and mode preferences", () => {
    const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
    expect(html).toContain(`if (THEMES.indexOf(theme) === -1) theme = "${DEFAULT_THEME}";`);
    expect(html).toContain(`legacy === null ? "${DEFAULT_MODE_PREF}"`);
  });

  it("knows every single-mode theme and its mode", () => {
    const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
    const match = html.match(/var SINGLE = \{([^}]*)\}/);
    expect(match, "SINGLE map in index.html").not.toBeNull();
    const entries = match![1]
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => part.split(":") as [string, string]);
    const map = Object.fromEntries(entries.map(([k, v]) => [k.trim().replace(/^"|"$/g, ""), v.trim().replace(/^"|"$/g, "")]));
    const single = THEMES.filter((theme) => theme.supports.length === 1);
    expect(Object.keys(map).sort()).toEqual(single.map((theme) => theme.id).sort());
    for (const theme of single) {
      expect(map[theme.id], theme.id).toBe(theme.supports[0]);
    }
  });

  it("generates a surface profile for every theme", () => {
    const css = readFileSync(resolve(process.cwd(), "src/theme/theme.css"), "utf8");
    for (const theme of THEMES) {
      const block = css.match(new RegExp(`\\[data-theme="${theme.id}"\\] \\{[^}]*\\}`));
      expect(block, `${theme.id} surface block`).not.toBeNull();
      expect(block![0]).toContain("--surface-blur:");
      expect(block![0]).toContain("--surface-tint:");
      expect(block![0]).toContain("--bg-image:");
    }
  });
});
