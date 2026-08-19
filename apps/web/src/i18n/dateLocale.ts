import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Locale } from "date-fns";
import {
  ar,
  be,
  cs,
  de,
  enUS,
  es,
  fr,
  he,
  hi,
  it,
  ja,
  kk,
  ko,
  pl,
  pt,
  ru,
  tr,
  uk,
  uz,
  zhCN,
} from "date-fns/locale";
import { getActiveLanguage } from "./index";
import { normalizeLanguage } from "./languages";

// BCP-47 language code → date-fns locale, mirroring the seeded language
// picker. Anything unknown falls back to Russian (the source language).
const DATE_LOCALES: Record<string, Locale> = {
  ru,
  en: enUS,
  uk,
  be,
  de,
  fr,
  es,
  it,
  pt,
  pl,
  cs,
  tr,
  ja,
  ko,
  zh: zhCN,
  hi,
  ar,
  he,
  kk,
  uz,
};

/** Resolve a date-fns locale for a language code (defaults to the active language). */
export function getDateLocale(code?: string): Locale {
  return DATE_LOCALES[normalizeLanguage(code || getActiveLanguage())] ?? ru;
}

/** Resolve a BCP-47 locale for Intl date/number formatting. */
export function getIntlLanguage(code?: string): string {
  const language = normalizeLanguage(code || getActiveLanguage());
  return language === "zh" ? "zh-CN" : language;
}

/**
 * Reactively resolve the date-fns locale for the active language. Components
 * should use this instead of importing a fixed locale so relative/absolute
 * dates re-render when the user switches language.
 */
export function useDateLocale(): Locale {
  // Use the same i18next language event as useTranslation. Reading the
  // Zustand store here creates a one-render split: setLanguage changes
  // i18next first (which rerenders text) and the store second (which rerenders
  // dates). Keeping one source makes the UI and date-fns switch together.
  const { i18n } = useTranslation();
  const language = normalizeLanguage(i18n.resolvedLanguage || i18n.language);
  return useMemo(() => getDateLocale(language), [language]);
}
