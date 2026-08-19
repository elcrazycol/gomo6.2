import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import ru from "./locales/ru";
import en from "./locales/en";
import { DEFAULT_LANGUAGE } from "./languages";

// Flat map of bundled base locales. Community translations (from the DB) are
// overlaid at runtime on top of these via addResourceBundle, so the bundled
// set stays the authoritative fallback for every shipped language.
const BASE_RESOURCES = {
  ru: { translation: ru },
  en: { translation: en },
} as const;

const LANG_STORAGE_KEY = "gomo6_lang";

export function getStoredLanguage(): string {
  try {
    const stored = localStorage.getItem(LANG_STORAGE_KEY);
    return stored || DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

export function getActiveLanguage(): string {
  return i18n.resolvedLanguage || i18n.language || DEFAULT_LANGUAGE;
}

/**
 * Apply a language immediately and persist the choice for guests. Signed-in
 * users persist their choice server-side separately (profile_customization),
 * but we still mirror it locally so the first paint after reload is correct
 * before the profile language arrives.
 */
export async function setLanguage(code: string): Promise<void> {
  await i18n.changeLanguage(code);
  try {
    localStorage.setItem(LANG_STORAGE_KEY, code);
  } catch {
    // ignore storage failures (private mode)
  }
  document.documentElement.lang = code;
  document.documentElement.dir = isRtl(code) ? "rtl" : "ltr";
}

export function isRtl(code: string): boolean {
  return code === "ar" || code === "he";
}

/**
 * Overlay a flat dotted-key map (e.g. `{ "common.save": "Сохранить" }`) onto a
 * namespace. Keys not present in the bundled base are still accepted — the
 * community can add new keys through the editor — but only under `translation`.
 */
export function applyTranslationOverrides(code: string, flat: Record<string, string>): void {
  // Everything lives under the single "translation" namespace for now to keep
  // the editor and API simple: dotted keys become namespace.key nesting.
  const target: Record<string, Record<string, string>> = {};
  for (const [key, value] of Object.entries(flat)) {
    if (!key || typeof value !== "string") continue;
    const nsIndex = key.indexOf(".");
    const ns = nsIndex === -1 ? "common" : key.slice(0, nsIndex);
    const leaf = nsIndex === -1 ? key : key.slice(nsIndex + 1);
    (target[ns] ??= {})[leaf] = value;
  }
  i18n.addResourceBundle(code, "translation", target, true, true);
}

/**
 * Fetch community translations for a locale from the backend and overlay them.
 * Safe to call repeatedly; failures are ignored (bundled locales still work).
 */
export async function loadCommunityTranslations(code: string): Promise<void> {
  if (code === DEFAULT_LANGUAGE) return; // ru is the bundled source
  try {
    const res = await fetch(`/api/v1/translations?locale=${encodeURIComponent(code)}`, {
      credentials: "include",
    });
    if (!res.ok) return;
    const json = await res.json().catch(() => null);
    const rows: Array<Record<string, unknown>> = Array.isArray(json?.data) ? json.data : [];
    // Highest-voted value per key wins.
    const best = new Map<string, string>();
    for (const row of rows) {
      const key = row.key as string | undefined;
      const value = row.value as string | undefined;
      if (!key || typeof value !== "string") continue;
      if (!best.has(key)) best.set(key, value);
    }
    applyTranslationOverrides(code, Object.fromEntries(best));
  } catch {
    // network/5xx — keep bundled locale
  }
}

void i18n.use(initReactI18next).init({
  resources: BASE_RESOURCES,
  lng: getStoredLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: Object.keys(BASE_RESOURCES),
  nonExplicitSupportedLngs: true,
  load: "currentOnly",
  ns: ["translation"],
  defaultNS: "translation",
  interpolation: { escapeValue: false }, // React already escapes
  returnNull: false,
  returnEmptyString: false,
});

// Keep <html lang>/dir in sync with the initial language.
document.documentElement.lang = getStoredLanguage();
document.documentElement.dir = isRtl(getStoredLanguage()) ? "rtl" : "ltr";

export default i18n;
