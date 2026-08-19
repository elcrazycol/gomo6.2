import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import ru from "./locales/ru";
import en from "./locales/en";
import { DEFAULT_LANGUAGE, LANGUAGES, normalizeLanguage } from "./languages";

// Russian and English are bundled. Every other supported language gets an
// explicit empty resource so i18next can make it the active language instead
// of resolving it to the Russian fallback before community values arrive.
const BASE_RESOURCES = {
  ru: { translation: ru },
  en: { translation: en },
} as const;

const INITIAL_RESOURCES: Record<string, { translation: Record<string, unknown> }> =
  Object.fromEntries(
    LANGUAGES.map(({ code }) => [
      code,
      BASE_RESOURCES[code as keyof typeof BASE_RESOURCES]
        ? { translation: BASE_RESOURCES[code as keyof typeof BASE_RESOURCES].translation as unknown as Record<string, unknown> }
        : { translation: {} },
    ])
  );

const LANG_STORAGE_KEY = "gomo6_lang";

export function getStoredLanguage(): string {
  try {
    return normalizeLanguage(localStorage.getItem(LANG_STORAGE_KEY) || DEFAULT_LANGUAGE);
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

/** Return the requested supported language, not i18next's fallback language. */
export function getActiveLanguage(): string {
  return normalizeLanguage(i18n.language || DEFAULT_LANGUAGE);
}

/**
 * Change i18next after the target catalog has been prepared. Catalog loading is
 * intentionally separate: this is the only helper that changes the active
 * language, which prevents an old fetch from switching the UI behind the
 * user's back.
 */
export async function setLanguage(code: string): Promise<void> {
  const language = normalizeLanguage(code);
  await i18n.changeLanguage(language);
  try {
    localStorage.setItem(LANG_STORAGE_KEY, language);
  } catch {
    // ignore storage failures (private mode)
  }
  document.documentElement.lang = language;
  document.documentElement.dir = isRtl(language) ? "rtl" : "ltr";
}

/** Re-emit i18next's language event after replacing an active catalog. */
export async function refreshLanguageResources(code: string): Promise<void> {
  const language = normalizeLanguage(code);
  if (getActiveLanguage() === language) {
    await i18n.changeLanguage(language);
  }
}

export function isRtl(code: string): boolean {
  const base = code.toLowerCase().split("-")[0];
  return base === "ar" || base === "he";
}

/**
 * Overlay a flat dotted-key map (for example
 * `{ "common.save": "Зберегти" }`) onto the single translation namespace.
 */
export function applyTranslationOverrides(code: string, flat: Record<string, string>): void {
  const target: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) {
    if (!key || typeof value !== "string") continue;
    const parts = key.split(".");
    const namespace = parts.shift();
    if (!namespace || parts.length === 0) continue;

    let node = (target[namespace] ??= {}) as Record<string, unknown>;
    for (let index = 0; index < parts.length - 1; index += 1) {
      node = (node[parts[index]] ??= {}) as Record<string, unknown>;
    }
    node[parts[parts.length - 1]] = value;
  }
  i18n.addResourceBundle(normalizeLanguage(code), "translation", target, true, true);
}

/** Rebuild a locale so deleted proposals cannot remain as stale overrides. */
function rebuildTranslationResources(code: string, flat: Record<string, string>): void {
  const language = normalizeLanguage(code);
  i18n.removeResourceBundle(language, "translation");
  const base = BASE_RESOURCES[language as keyof typeof BASE_RESOURCES];
  if (base) {
    i18n.addResourceBundle(language, "translation", base.translation, false, false);
  }
  applyTranslationOverrides(language, flat);
}

export interface CommunityTranslationLoadOptions {
  /** Prevent a stale request from installing a catalog after a newer choice. */
  isCurrent?: () => boolean;
}

/**
 * Fetch and apply the effective community catalog for a locale. The backend
 * returns proposals ranked by net votes; the client repeats that rule as a
 * safety net and keeps the first proposal per key. Ties prefer newer proposals.
 * This function never changes the active language by itself.
 */
export async function loadCommunityTranslations(
  code: string,
  options: CommunityTranslationLoadOptions = {}
): Promise<boolean> {
  const language = normalizeLanguage(code);
  if (language === DEFAULT_LANGUAGE) return true;

  try {
    const res = await fetch(`/api/v1/translations?locale=${encodeURIComponent(language)}`, {
      credentials: "include",
      cache: "no-store",
    });
    if (!res.ok) return false;

    const json = await res.json().catch(() => null) as { success?: boolean; data?: unknown } | null;
    if (!json || json.success === false || !Array.isArray(json.data)) return false;
    if (options.isCurrent && !options.isCurrent()) return false;

    const rows = (json.data as Array<Record<string, unknown>>).slice();
    rows.sort((a, b) => {
      const votes = Number(b.votes ?? 0) - Number(a.votes ?? 0);
      if (votes !== 0) return votes;
      return String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""));
    });

    const best = new Map<string, string>();
    for (const row of rows) {
      const key = typeof row.key === "string" ? row.key : "";
      const value = typeof row.value === "string" ? row.value : null;
      if (key && value !== null && !best.has(key)) best.set(key, value);
    }

    if (options.isCurrent && !options.isCurrent()) return false;
    rebuildTranslationResources(language, Object.fromEntries(best));
    return true;
  } catch {
    // Network/5xx: callers may still activate the language and use Russian
    // fallback, but a failed fetch must not replace a newer language choice.
    return false;
  }
}

void i18n.use(initReactI18next).init({
  resources: INITIAL_RESOURCES,
  lng: getStoredLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: LANGUAGES.map((language) => language.code),
  nonExplicitSupportedLngs: true,
  load: "currentOnly",
  ns: ["translation"],
  defaultNS: "translation",
  interpolation: { escapeValue: false }, // React already escapes
  returnNull: false,
  returnEmptyString: false,
});

const initialLanguage = getStoredLanguage();
document.documentElement.lang = initialLanguage;
document.documentElement.dir = isRtl(initialLanguage) ? "rtl" : "ltr";

export default i18n;
