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
  return DATE_LOCALES[code || getActiveLanguage()] ?? ru;
}

/**
 * Reactively resolve the date-fns locale for the active language. Components
 * should use this instead of importing a fixed locale so relative/absolute
 * dates re-render when the user switches language.
 */
export function useDateLocale(): Locale {
  const { i18n } = useTranslation();
  return useMemo(
    () => DATE_LOCALES[i18n.resolvedLanguage || i18n.language] ?? ru,
    [i18n.resolvedLanguage, i18n.language]
  );
}
