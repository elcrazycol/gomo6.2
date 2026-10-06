/**
 * Short relative time for dense surfaces (the feed card): a single compact
 * unit instead of date-fns' verbose "5 минут назад" — "сейчас", "5м", "3ч",
 * "2д", "1нед", "4мес", "2г".
 *
 * Russian and English abbreviations only; every other language falls back to
 * the Russian ones (the app's source language). Add a table entry if a locale
 * needs its own abbreviations.
 */
import { normalizeLanguage } from "@/i18n/languages";

type Units = {
  now: string;
  min: string;
  hour: string;
  day: string;
  week: string;
  month: string;
  year: string;
};

const UNITS: Record<"ru" | "en", Units> = {
  ru: { now: "сейчас", min: "м", hour: "ч", day: "д", week: "нед", month: "мес", year: "г" },
  en: { now: "now", min: "m", hour: "h", day: "d", week: "w", month: "mo", year: "y" },
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/** Under this the post just says "сейчас" — exact seconds are noise. */
const JUST_NOW_MS = 45_000;

export const formatShortRelativeTime = (
  input: Date | string | number,
  languageCode?: string,
): string => {
  const lang = normalizeLanguage(languageCode ?? "") === "en" ? "en" : "ru";
  const units = UNITS[lang];

  const date = input instanceof Date ? input : new Date(input);
  const timestamp = date.getTime();
  if (Number.isNaN(timestamp)) return "";

  // Negative (a clock skew into the future) lands in the "just now" branch.
  const diff = Date.now() - timestamp;

  if (diff < JUST_NOW_MS) return units.now;
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}${units.min}`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}${units.hour}`;
  if (diff < WEEK) return `${Math.floor(diff / DAY)}${units.day}`;
  if (diff < MONTH) return `${Math.floor(diff / WEEK)}${units.week}`;
  if (diff < YEAR) return `${Math.floor(diff / MONTH)}${units.month}`;
  return `${Math.floor(diff / YEAR)}${units.year}`;
};
