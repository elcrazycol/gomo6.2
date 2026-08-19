// Language registry for the translation system.
// `code` is a BCP-47 tag used by i18next; `flag` is a decorative emoji shown
// next to the language in the picker. `rtl` marks right-to-left scripts.

export interface LanguageInfo {
  code: string;
  /** English name (stable, used for sorting and as a fallback label). */
  name: string;
  /** Native name, e.g. "Русский". */
  nativeName: string;
  flag: string;
  rtl?: boolean;
}

// Base catalog of languages users can pick from. The community can extend this
// set from the translation editor — this list only seeds the picker.
export const LANGUAGES: LanguageInfo[] = [
  { code: "ru", name: "Russian", nativeName: "Русский", flag: "🇷🇺" },
  { code: "en", name: "English", nativeName: "English", flag: "🇬🇧" },
  { code: "uk", name: "Ukrainian", nativeName: "Українська", flag: "🇺🇦" },
  { code: "be", name: "Belarusian", nativeName: "Беларуская", flag: "🇧🇾" },
  { code: "de", name: "German", nativeName: "Deutsch", flag: "🇩🇪" },
  { code: "fr", name: "French", nativeName: "Français", flag: "🇫🇷" },
  { code: "es", name: "Spanish", nativeName: "Español", flag: "🇪🇸" },
  { code: "it", name: "Italian", nativeName: "Italiano", flag: "🇮🇹" },
  { code: "pt", name: "Portuguese", nativeName: "Português", flag: "🇵🇹" },
  { code: "pl", name: "Polish", nativeName: "Polski", flag: "🇵🇱" },
  { code: "cs", name: "Czech", nativeName: "Čeština", flag: "🇨🇿" },
  { code: "tr", name: "Turkish", nativeName: "Türkçe", flag: "🇹🇷" },
  { code: "ja", name: "Japanese", nativeName: "日本語", flag: "🇯🇵" },
  { code: "ko", name: "Korean", nativeName: "한국어", flag: "🇰🇷" },
  { code: "zh", name: "Chinese", nativeName: "中文", flag: "🇨🇳" },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी", flag: "🇮🇳" },
  { code: "ar", name: "Arabic", nativeName: "العربية", flag: "🇸🇦", rtl: true },
  { code: "he", name: "Hebrew", nativeName: "עברית", flag: "🇮🇱", rtl: true },
  { code: "kk", name: "Kazakh", nativeName: "Қазақша", flag: "🇰🇿" },
  { code: "uz", name: "Uzbek", nativeName: "Oʻzbekcha", flag: "🇺🇿" },
];

export const DEFAULT_LANGUAGE = "ru";

const byCode = new Map(LANGUAGES.map((l) => [l.code, l]));

export function getLanguageInfo(code: string): LanguageInfo | undefined {
  return byCode.get(code);
}

export function normalizeLanguage(code: string): string {
  const base = code.trim().toLowerCase().split("-")[0];
  return byCode.has(base) ? base : DEFAULT_LANGUAGE;
}

export function languageName(code: string): string {
  return getLanguageInfo(normalizeLanguage(code))?.nativeName ?? code;
}
