/**
 * Theme collections and scheduling preferences: favourites, recents, and the
 * "theme by time of day" flag. Kept separate from apply.ts so the picker can
 * subscribe to changes without touching the core preference layer.
 */
import { resolveTheme } from "./registry";

const FAVORITES_KEY = "theme-favorites";
const TIME_AUTO_KEY = "theme-time-auto";

export const THEME_COLLECTIONS_EVENT = "gomo6:theme-collections";

const safeGet = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const safeSet = (key: string, value: string): void => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
};

const parseIds = (raw: string | null): string[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string" && resolveTheme(id).id === id) : [];
  } catch {
    return [];
  }
};

const emit = (): void => {
  window.dispatchEvent(new CustomEvent(THEME_COLLECTIONS_EVENT));
};

/* ── Favourites ──────────────────────────────────────────────────────────── */

export const getFavorites = (): string[] => parseIds(safeGet(FAVORITES_KEY));

export const isFavorite = (id: string): boolean => getFavorites().includes(id);

export const toggleFavorite = (id: string): string[] => {
  const current = getFavorites();
  const next = current.includes(id) ? current.filter((x) => x !== id) : [id, ...current];
  safeSet(FAVORITES_KEY, JSON.stringify(next));
  emit();
  return next;
};

/** Replace the favourites list wholesale (used by server sync). */
export const setFavorites = (ids: string[]): string[] => {
  const next = ids.filter((id) => resolveTheme(id).id === id);
  safeSet(FAVORITES_KEY, JSON.stringify(next));
  emit();
  return next;
};

/* ── Time-of-day schedule ────────────────────────────────────────────────── */

export const getTimeAuto = (): boolean => safeGet(TIME_AUTO_KEY) === "true";

export const setTimeAuto = (enabled: boolean): void => {
  safeSet(TIME_AUTO_KEY, String(enabled));
  emit();
};

/** Day (07:00–19:00 local) → light, otherwise dark. */
export const resolveTimeMode = (now: Date = new Date()): "light" | "dark" => {
  const hour = now.getHours();
  return hour >= 7 && hour < 19 ? "light" : "dark";
};
