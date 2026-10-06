// Cookie consent, stored in localStorage under a versioned key so a future
// policy change can re-prompt everyone by bumping CONSENT_VERSION.
//
// Categories:
//   necessary — auth session, CSRF protection, UI preferences. Always on; the
//               app cannot function without them, so there is no toggle.
//   analytics — anonymous error + performance reporting (Sentry). Opt-in.
//
// There are no advertising/marketing cookies, so there is no third category.

export const CONSENT_VERSION = 1;

const CONSENT_KEY = "gomo6:cookie-consent";
/** The old one-click flag; migrated once so returning visitors aren't re-asked. */
const LEGACY_KEY = "cookies-accepted";

/** Fired on window whenever the stored consent changes (detail = CookieConsent | null). */
export const CONSENT_EVENT = "gomo6:cookie-consent-changed";
/** Fired on window to re-open the banner in its settings view (e.g. footer link). */
export const OPEN_SETTINGS_EVENT = "gomo6:open-cookie-settings";

export interface CookieConsent {
  version: number;
  necessary: true;
  analytics: boolean;
  /** When the choice was made (epoch ms). */
  ts: number;
}

export type CookieCategory = "necessary" | "analytics";

const read = (): CookieConsent | null => {
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CookieConsent>;
    if (parsed?.version !== CONSENT_VERSION) return null;
    return {
      version: CONSENT_VERSION,
      necessary: true,
      analytics: Boolean(parsed.analytics),
      ts: Number(parsed.ts) || 0,
    };
  } catch {
    return null;
  }
};

const migrateLegacy = (): CookieConsent | null => {
  try {
    if (localStorage.getItem(LEGACY_KEY) !== "true") return null;
    const consent: CookieConsent = {
      version: CONSENT_VERSION,
      necessary: true,
      analytics: true,
      ts: Date.now(),
    };
    localStorage.setItem(CONSENT_KEY, JSON.stringify(consent));
    localStorage.removeItem(LEGACY_KEY);
    return consent;
  } catch {
    return null;
  }
};

/** The stored choice, migrating the legacy flag on first read. Null = not decided. */
export const getConsent = (): CookieConsent | null => read() ?? migrateLegacy();

/** True once the visitor has made a choice (accept, reject or custom). */
export const hasDecided = (): boolean => getConsent() !== null;

/** Whether the analytics category was granted. Safe to call before React mounts. */
export const analyticsAllowed = (): boolean => getConsent()?.analytics === true;

export const saveConsent = (choice: { analytics: boolean }): CookieConsent => {
  const consent: CookieConsent = {
    version: CONSENT_VERSION,
    necessary: true,
    analytics: choice.analytics,
    ts: Date.now(),
  };
  try {
    localStorage.setItem(CONSENT_KEY, JSON.stringify(consent));
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // Storage unavailable (private mode) — the choice lives for this page only.
  }
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: consent }));
  return consent;
};

/** Forget the choice so the banner shows again (Settings → «Изменить решение»). */
export const clearConsent = (): void => {
  try {
    localStorage.removeItem(CONSENT_KEY);
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: null }));
};

/** Ask the banner to open in its settings view. */
export const openCookieSettings = (): void => {
  window.dispatchEvent(new Event(OPEN_SETTINGS_EVENT));
};
