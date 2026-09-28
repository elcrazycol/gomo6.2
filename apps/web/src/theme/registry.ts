/**
 * The single theme registry. Everything that needs to know about themes —
 * settings UI, the pre-boot script, tests, CI contrast checks — reads it here.
 * Token values live in the generated registry.data.ts; never hardcode a theme
 * name, colour or token list anywhere else.
 */
import { THEME_TOKENS, THEME_META, type ThemeModeTokens } from "./registry.data";
import { oklchCss, parseOklch } from "./color";
import type { ThemeTokens } from "./tokens";

export type ThemeMode = "light" | "dark";
export type ThemeGroup = "custom" | "calm" | "pastel" | "neutral" | "vivid" | "mineral" | "neon" | "retro" | "a11y" | "dark";
export type ThemeFont = "sans" | "serif" | "mono" | "rounded";
export type ThemeTexture = "none" | "scanlines" | "grid" | "dots";

export interface ThemeDef {
  id: string;
  /** Grouping used by the picker. */
  group: ThemeGroup;
  /** i18n key for the display name (see locales). */
  nameKey: string;
  /** i18n key for a one-line description, when present. */
  descriptionKey?: string;
  /** Modes this theme ships. Dark-only / light-only themes are allowed. */
  supports: ThemeMode[];
  /** Primary colour per mode, as a ready-to-use CSS `oklch(...)` string. */
  accent: Partial<Record<ThemeMode, string>>;
  /** Base corner radius contributed by the theme (character). */
  radius: string;
  /** Font stack contributed by the theme (user custom font still wins). */
  font?: ThemeFont;
  /** Optional surface overlay for extra character. */
  texture?: ThemeTexture;
  /** Runtime-only theme built in the app (tokens are applied inline). */
  custom?: boolean;
  /** Display name for custom themes (built-ins use i18n nameKey). */
  name?: string;
  tokens: Partial<Record<ThemeMode, ThemeTokens>>;
}

/** i18n key for a group's label, e.g. `settings2.themeGroupCalm`. */
export const THEME_GROUP_LABEL_KEYS: Record<ThemeGroup, string> = {
  custom: "settings2.themeGroupCustom",
  calm: "settings2.themeGroupCalm",
  pastel: "settings2.themeGroupPastel",
  neutral: "settings2.themeGroupNeutral",
  vivid: "settings2.themeGroupVivid",
  mineral: "settings2.themeGroupMineral",
  neon: "settings2.themeGroupNeon",
  retro: "settings2.themeGroupRetro",
  a11y: "settings2.themeGroupA11y",
  dark: "settings2.themeGroupDark",
};

export const THEME_GROUP_ORDER: ThemeGroup[] = ["custom", "calm", "pastel", "neutral", "vivid", "mineral", "neon", "retro", "a11y", "dark"];

const DEFAULT_RADIUS = "0.25rem";

const buildTheme = (id: string): ThemeDef => {
  const data = THEME_TOKENS[id] as ThemeModeTokens;
  const meta = THEME_META[id];
  const supports: ThemeMode[] = (["light", "dark"] as const).filter((m) => Boolean(data[m]));
  const accent: ThemeDef["accent"] = {};
  for (const mode of supports) {
    const primary = parseOklch(data[mode]["--primary"]);
    if (primary) accent[mode] = oklchCss(primary);
  }
  return {
    id,
    group: (meta?.group as ThemeGroup) ?? "calm",
    nameKey: meta?.nameKey ?? id,
    descriptionKey: `${meta?.nameKey ?? id}Description`,
    supports,
    accent,
    radius: meta?.radius ?? DEFAULT_RADIUS,
    font: meta?.font,
    texture: meta?.texture,
    tokens: data,
  };
};

export const THEMES: ThemeDef[] = Object.keys(THEME_TOKENS).map(buildTheme);

export const THEME_BY_ID: Record<string, ThemeDef> = Object.fromEntries(
  THEMES.map((theme) => [theme.id, theme]),
);

export const THEME_IDS = THEMES.map((theme) => theme.id);

export const DEFAULT_THEME = "graphite";
export const DEFAULT_RADIUS_FALLBACK = DEFAULT_RADIUS;

/* ── Runtime (custom) themes ─────────────────────────────────────────────── */

let customThemes: ThemeDef[] = [];
let customById: Record<string, ThemeDef> = {};

/** Register user-built themes. Called by the theme store on load/change. */
export const setCustomThemes = (themes: ThemeDef[]): void => {
  customThemes = themes;
  customById = Object.fromEntries(themes.map((theme) => [theme.id, theme]));
};

export const getCustomThemeDefs = (): ThemeDef[] => customThemes;

/** Built-ins first, then custom themes. */
export const getAllThemes = (): ThemeDef[] => [...THEMES, ...customThemes];

export const resolveTheme = (id: string | null | undefined): ThemeDef =>
  (id && (customById[id] ?? THEME_BY_ID[id])) || THEME_BY_ID[DEFAULT_THEME];

export const getTheme = resolveTheme;

export const themesByGroup = (group: ThemeGroup): ThemeDef[] =>
  getAllThemes().filter((theme) => theme.group === group);

/** Tokens for one theme+mode, with a sane fallback to a shipped mode. */
export const tokensFor = (theme: ThemeDef, mode: ThemeMode): ThemeTokens => {
  if (theme.tokens[mode]) return theme.tokens[mode] as ThemeTokens;
  const fallback = theme.supports[0];
  return (theme.tokens[fallback] ?? THEME_TOKENS[DEFAULT_THEME].light) as ThemeTokens;
};
