/**
 * Server sync for appearance settings. localStorage stays the fast cache the
 * pre-boot script reads; when a user is logged in this layer keeps the server
 * row (source of truth) in step: pull on login, push (debounced) on change.
 */
import { APPEARANCE_CHANGED_EVENT, applyTheme, getStoredPrefs, setStoredPrefs, type ThemeModePref } from "./apply";
import { THEME_COLLECTIONS_EVENT, getFavorites, getTimeAuto, setFavorites, setTimeAuto } from "./preferences";
import { FONT_CHANGED_EVENT, getStoredCustomFont, storeCustomFont } from "@/lib/customFont";
import { apiClient } from "@/integrations/api/client";

export interface ServerAppearance {
  theme_id: string;
  theme_mode: string;
  time_auto: boolean;
  custom_font: string;
  favorite_theme_ids: string[];
}

const ENDPOINT = "/api/v1/user/settings";

const isModePref = (value: unknown): value is ThemeModePref =>
  value === "light" || value === "dark" || value === "system";

/** The full appearance state the client owns, in server shape. */
export const readLocalAppearance = (): ServerAppearance => {
  const prefs = getStoredPrefs();
  return {
    theme_id: prefs.theme,
    theme_mode: prefs.mode,
    time_auto: getTimeAuto(),
    custom_font: getStoredCustomFont(),
    favorite_theme_ids: getFavorites(),
  };
};

/** Apply server state locally (theme/mode/font/timeAuto/favourites). */
export const applyServerAppearance = (state: ServerAppearance): void => {
  if (state.theme_id) {
    const updated = setStoredPrefs({
      theme: state.theme_id,
      ...(isModePref(state.theme_mode) ? { mode: state.theme_mode } : {}),
    });
    applyTheme(updated.theme, updated.mode);
  }
  setTimeAuto(Boolean(state.time_auto));
  if (typeof state.custom_font === "string") storeCustomFont(state.custom_font);
  if (Array.isArray(state.favorite_theme_ids)) setFavorites(state.favorite_theme_ids);
};

export const fetchServerAppearance = async (): Promise<ServerAppearance | null> => {
  const res = await fetch(ENDPOINT, { credentials: "include", headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`GET ${ENDPOINT} → ${res.status}`);
  const json = (await res.json()) as { data?: ServerAppearance | null };
  return json.data ?? null;
};

export const pushServerAppearance = async (state?: ServerAppearance): Promise<void> => {
  const body = state ?? readLocalAppearance();
  const csrf = apiClient.getCSRFToken();
  const res = await fetch(ENDPOINT, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(csrf ? { "X-CSRF-Token": csrf } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${ENDPOINT} → ${res.status}`);
};

// Applying server state fires the change events; ignore them briefly so the
// pull doesn't immediately bounce back as a push.
let suppressUntil = 0;
export const suppressAppearancePush = (ms = 1500): void => {
  suppressUntil = Date.now() + ms;
};

/**
 * Pull on login. If the server has never seen this user, push the local state
 * up (migration of an existing account).
 */
export const syncAppearanceWithServer = async (): Promise<void> => {
  const server = await fetchServerAppearance();
  if (!server) {
    await pushServerAppearance();
    return;
  }
  suppressAppearancePush();
  applyServerAppearance(server);
};

/** Push (debounced) whenever the local appearance changes. */
export const startAppearanceAutoPush = (delayMs = 800): (() => void) => {
  let timer: number | undefined;
  const schedule = () => {
    if (Date.now() < suppressUntil) return;
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      void pushServerAppearance().catch(() => undefined);
    }, delayMs);
  };
  window.addEventListener(APPEARANCE_CHANGED_EVENT, schedule);
  window.addEventListener(THEME_COLLECTIONS_EVENT, schedule);
  window.addEventListener(FONT_CHANGED_EVENT, schedule);
  return () => {
    if (timer) window.clearTimeout(timer);
    window.removeEventListener(APPEARANCE_CHANGED_EVENT, schedule);
    window.removeEventListener(THEME_COLLECTIONS_EVENT, schedule);
    window.removeEventListener(FONT_CHANGED_EVENT, schedule);
  };
};
