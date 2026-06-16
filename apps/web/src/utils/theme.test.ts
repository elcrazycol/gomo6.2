import { describe, it, expect, vi, beforeEach } from "vitest";
import { getStoredTheme, applyTheme, THEME_IDS, DEFAULT_THEME } from "./theme";

describe("getStoredTheme", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns defaults when localStorage is empty", () => {
    const result = getStoredTheme();
    expect(result.colorTheme).toBe(DEFAULT_THEME);
    expect(result.isDarkMode).toBe(true);
  });

  it("reads stored color theme", () => {
    localStorage.setItem("color-theme", "pink");
    const result = getStoredTheme();
    expect(result.colorTheme).toBe("pink");
  });

  it("reads stored dark mode", () => {
    localStorage.setItem("dark-mode", "false");
    const result = getStoredTheme();
    expect(result.isDarkMode).toBe(false);
  });

  it("falls back to default for invalid theme", () => {
    localStorage.setItem("color-theme", "invalid_theme");
    const result = getStoredTheme();
    expect(result.colorTheme).toBe(DEFAULT_THEME);
  });

  it("falls back to default for invalid dark-mode value", () => {
    localStorage.setItem("dark-mode", "invalid");
    const result = getStoredTheme();
    expect(result.isDarkMode).toBe(false);
  });

  it("returns all 12 valid theme IDs", () => {
    expect(THEME_IDS).toHaveLength(12);
    expect(THEME_IDS).toContain("cannabis");
    expect(THEME_IDS).toContain("void");
  });
});

describe("applyTheme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
  });

  it("sets theme class for dark mode", () => {
    applyTheme("cannabis", true);
    expect(document.documentElement.classList.contains("theme-cannabis-dark")).toBe(true);
  });

  it("sets theme class for light mode", () => {
    applyTheme("cannabis", false);
    expect(document.documentElement.classList.contains("theme-cannabis")).toBe(true);
    expect(document.documentElement.classList.contains("theme-cannabis-dark")).toBe(false);
  });

  it("sets CSS variables on document root", () => {
    applyTheme("cannabis", true);
    const primary = document.documentElement.style.getPropertyValue("--primary");
    expect(primary).toBeTruthy();
  });

  it("sets data-theme and data-mode attributes", () => {
    applyTheme("pink", false);
    expect(document.documentElement.dataset.theme).toBe("pink");
    expect(document.documentElement.dataset.mode).toBe("light");
  });

  it("sets dark mode attributes", () => {
    applyTheme("pink", true);
    expect(document.documentElement.dataset.mode).toBe("dark");
  });

  it("applies all 12 themes without errors", () => {
    for (const theme of THEME_IDS) {
      expect(() => applyTheme(theme, true)).not.toThrow();
      expect(() => applyTheme(theme, false)).not.toThrow();
    }
  });
});
