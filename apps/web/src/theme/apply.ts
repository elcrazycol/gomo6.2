/**
 * Applying a theme: preference storage, "system" resolution and writing the
 * attributes the generated theme.css keys off. No token values are written
 * inline here — the base theme is pure CSS, which is what makes the pre-boot
 * script (index.html) able to paint the right theme before React loads.
 */
import { DEFAULT_THEME, getTheme, tokensFor, type ThemeDef, type ThemeFont, type ThemeMode, type ThemeTexture } from "./registry";
import { getTimeAuto, resolveTimeMode } from "./preferences";
import { THEME_TOKEN_NAMES } from "./tokens";

export type ThemeModePref = "light" | "dark" | "system";

export const DEFAULT_MODE_PREF: ThemeModePref = "system";

/** Fired whenever the applied theme/mode changes (used by the server sync). */
export const APPEARANCE_CHANGED_EVENT = "gomo6:appearance-changed";

const THEME_KEY = "color-theme";
const MODE_KEY = "theme-mode";
const LEGACY_DARK_KEY = "dark-mode";
const FONT_KEY = "custom_font";

const MODE_PREFS: ThemeModePref[] = ["light", "dark", "system"];

export interface AppearancePrefs {
  theme: string;
  mode: ThemeModePref;
}

const safeStorage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const isModePref = (value: unknown): value is ThemeModePref =>
  typeof value === "string" && (MODE_PREFS as string[]).includes(value);

/** Fold the legacy boolean `dark-mode` key into the new `theme-mode` key. */
const migrateLegacyMode = (storage: Storage): void => {
  if (storage.getItem(MODE_KEY) != null) return;
  const legacy = storage.getItem(LEGACY_DARK_KEY);
  if (legacy == null) return;
  storage.setItem(MODE_KEY, legacy === "true" ? "dark" : "light");
};

export const getStoredPrefs = (): AppearancePrefs => {
  const storage = safeStorage();
  if (!storage) return { theme: DEFAULT_THEME, mode: DEFAULT_MODE_PREF };
  migrateLegacyMode(storage);
  const theme = getTheme(storage.getItem(THEME_KEY)).id;
  const rawMode = storage.getItem(MODE_KEY);
  const mode = isModePref(rawMode) ? rawMode : DEFAULT_MODE_PREF;
  return { theme, mode };
};

export const setStoredPrefs = (prefs: Partial<AppearancePrefs>): AppearancePrefs => {
  const current = getStoredPrefs();
  const next: AppearancePrefs = { ...current, ...prefs };
  const storage = safeStorage();
  storage?.setItem(THEME_KEY, next.theme);
  storage?.setItem(MODE_KEY, next.mode);
  return next;
};

export const prefersDarkSystem = (): boolean => {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
};

/** Resolve the raw preference into the concrete mode the theme will render. */
export const resolveMode = (theme: ThemeDef, pref: ThemeModePref, timeAuto = false): ThemeMode => {
  if (theme.supports.length === 1) return theme.supports[0];
  if (timeAuto) return resolveTimeMode();
  if (pref === "system") return prefersDarkSystem() ? "dark" : "light";
  if (theme.supports.includes(pref)) return pref;
  return theme.supports[0];
};

/** Subscribe to OS colour-scheme changes; returns an unsubscribe function. */
export const watchSystemMode = (listener: () => void): (() => void) => {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
};

const syncCookies = (theme: string, pref: ThemeModePref, mode: ThemeMode): void => {
  const customFont = (() => {
    try {
      return window.localStorage.getItem(FONT_KEY) || "";
    } catch {
      return "";
    }
  })();
  const maxAge = 60 * 60 * 24 * 365;
  const host = window.location.hostname;
  const domainAttr = host === "gomo6.wtf" || host.endsWith(".gomo6.wtf") ? "; domain=.gomo6.wtf" : "";
  document.cookie = `gomo6_color_theme=${encodeURIComponent(theme)}; path=/${domainAttr}; max-age=${maxAge}; samesite=lax`;
  document.cookie = `gomo6_theme_mode=${encodeURIComponent(pref)}; path=/${domainAttr}; max-age=${maxAge}; samesite=lax`;
  document.cookie = `gomo6_dark_mode=${mode === "dark"}; path=/${domainAttr}; max-age=${maxAge}; samesite=lax`;
  document.cookie = `gomo6_custom_font=${encodeURIComponent(customFont)}; path=/${domainAttr}; max-age=${maxAge}; samesite=lax`;
};

/** Back-compat alias — the profile editor and older callers use this name. */
export const syncSharedAppearanceCookies = (): void => {
  const { theme, mode } = getStoredPrefs();
  syncCookies(theme, mode, resolveMode(getTheme(theme), mode));
};

/** Write a full token set + character inline on <html>. */
export const applyInlineThemeTokens = (
  tokens: Record<string, string>,
  character: { radius: string; font?: ThemeFont; texture?: ThemeTexture },
): void => {
  const root = document.documentElement;
  for (const name of THEME_TOKEN_NAMES) {
    const value = tokens[name];
    if (value) root.style.setProperty(name, value);
    else root.style.removeProperty(name);
  }
  root.style.setProperty("--radius", character.radius);
  if (character.font) root.dataset.font = character.font;
  else delete root.dataset.font;
  if (character.texture && character.texture !== "none") root.dataset.texture = character.texture;
  else delete root.dataset.texture;
};

/** Remove any inline theme tokens, falling back to the CSS theme rules. */
export const clearInlineThemeTokens = (): void => {
  const root = document.documentElement;
  for (const name of THEME_TOKEN_NAMES) root.style.removeProperty(name);
  root.style.removeProperty("--radius");
  delete root.dataset.font;
  delete root.dataset.texture;
};

export interface AppliedTheme {
  theme: ThemeDef;
  mode: ThemeMode;
  pref: ThemeModePref;
}

/**
 * Write the theme onto <html>:
 *  - `.dark` so Tailwind's `dark:` variant works (it never did before),
 *  - `data-theme` / `data-mode` / `data-theme-group` / `data-theme-pref`,
 *  - `--radius` from the theme's character.
 */
export const applyTheme = (themeId: string, pref: ThemeModePref): AppliedTheme => {
  const root = document.documentElement;
  const theme = getTheme(themeId);
  const mode = resolveMode(theme, pref, getTimeAuto());

  root.classList.toggle("dark", mode === "dark");
  root.dataset.theme = theme.id;
  root.dataset.mode = mode;
  root.dataset.themeGroup = theme.group;
  root.dataset.themePref = pref;

  // Built-in themes are pure CSS keyed on data-theme (radius/font/texture
  // included), which the pre-boot script can paint. Custom themes have no CSS
  // rule, so their tokens and character are written inline instead.
  if (theme.custom) {
    applyInlineThemeTokens(tokensFor(theme, mode), {
      radius: theme.radius,
      font: theme.font,
      texture: theme.texture,
    });
  } else {
    clearInlineThemeTokens();
  }

  syncCookies(theme.id, pref, mode);
  window.dispatchEvent(new CustomEvent(APPEARANCE_CHANGED_EVENT));
  return { theme, mode, pref };
};
