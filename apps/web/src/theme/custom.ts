/**
 * User-built themes ("своя тема"): a compact definition (anchor colour +
 * character) is stored in localStorage and compiled to full OKLCH tokens at
 * runtime with the same maths the registry uses.
 */
import { buildCustomTokens, type SeedStyle } from "./derive";
import { setCustomThemes, type ThemeDef, type ThemeFont, type ThemeMode, type ThemeTexture } from "./registry";
import type { ThemeTokens } from "./tokens";

export interface CustomSeed {
  L: number;
  C: number;
  H: number;
}

export interface CustomThemeDef {
  id: string;
  name: string;
  seed: CustomSeed;
  style: SeedStyle;
  radius: string;
  font?: ThemeFont;
  texture?: ThemeTexture;
  supports: ThemeMode[];
}

const STORAGE_KEY = "theme-custom";
export const CUSTOM_THEMES_EVENT = "gomo6:custom-themes";
export const CUSTOM_GROUP = "custom";

export const CUSTOM_ID_PREFIX = "custom:";

const isCustomTheme = (value: unknown): value is CustomThemeDef => {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<CustomThemeDef>;
  return typeof v.id === "string" && v.id.startsWith(CUSTOM_ID_PREFIX) && typeof v.name === "string" && !!v.seed;
};

const read = (): CustomThemeDef[] => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isCustomTheme) : [];
  } catch {
    return [];
  }
};

const write = (list: CustomThemeDef[]): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new CustomEvent(CUSTOM_THEMES_EVENT));
};

export const getCustomThemes = (): CustomThemeDef[] => read();

export const saveCustomTheme = (def: CustomThemeDef): CustomThemeDef[] => {
  const list = read();
  const index = list.findIndex((item) => item.id === def.id);
  if (index >= 0) list[index] = def;
  else list.push(def);
  write(list);
  return list;
};

export const deleteCustomTheme = (id: string): CustomThemeDef[] => {
  const list = read().filter((item) => item.id !== id);
  write(list);
  return list;
};

export const newCustomId = (): string =>
  `${CUSTOM_ID_PREFIX}${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;

/** Compile a stored definition into a runtime ThemeDef. */
export const customToThemeDef = (def: CustomThemeDef): ThemeDef => {
  const supports = def.supports.length ? def.supports : (["light", "dark"] as ThemeMode[]);
  const tokens: ThemeDef["tokens"] = {};
  const accent: ThemeDef["accent"] = {};
  for (const mode of supports) {
    tokens[mode] = buildCustomTokens(def.seed, mode, def.style) as ThemeTokens;
    if (tokens[mode]!["--primary"]) accent[mode] = `oklch(${tokens[mode]!["--primary"]})`;
  }
  return {
    id: def.id,
    group: CUSTOM_GROUP as ThemeDef["group"],
    nameKey: "",
    supports,
    accent,
    radius: def.radius,
    font: def.font,
    texture: def.texture,
    tokens,
    custom: true,
  };
};

/** Validate an imported JSON payload. */
export const parseCustomThemeJson = (text: string): CustomThemeDef | null => {
  try {
    const parsed = JSON.parse(text) as Partial<CustomThemeDef>;
    if (!parsed || typeof parsed !== "object" || !parsed.seed) return null;
    const seed = parsed.seed as CustomSeed;
    if (![seed.L, seed.C, seed.H].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
    return {
      id: typeof parsed.id === "string" && parsed.id.startsWith(CUSTOM_ID_PREFIX) ? parsed.id : newCustomId(),
      name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim().slice(0, 40) : "Своя тема",
      seed: { L: Math.min(1, Math.max(0, seed.L)), C: Math.min(0.4, Math.max(0, seed.C)), H: ((seed.H % 360) + 360) % 360 },
      style: parsed.style === "pastel" || parsed.style === "mono" ? parsed.style : "soft",
      radius: typeof parsed.radius === "string" ? parsed.radius : "0.5rem",
      font: parsed.font,
      texture: parsed.texture,
      supports: Array.isArray(parsed.supports) && parsed.supports.length ? (parsed.supports as ThemeMode[]) : ["light", "dark"],
    };
  } catch {
    return null;
  }
};

/**
 * Register stored custom themes with the registry and keep them in sync.
 * Must run before the first theme preference is read (main.tsx calls it).
 */
export const initCustomThemes = (): (() => void) => {
  const sync = () => setCustomThemes(getCustomThemes().map(customToThemeDef));
  sync();
  const handler = () => sync();
  window.addEventListener(CUSTOM_THEMES_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(CUSTOM_THEMES_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
};
