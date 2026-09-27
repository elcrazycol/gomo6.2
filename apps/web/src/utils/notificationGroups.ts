// Day grouping for the notifications page: «Сегодня» / «Вчера» / «20 октября»
// (plus the year for older dates). Kept out of the page so the rules are
// testable without mounting the whole inbox.

import type { Notification } from "@/integrations/api/client";
import { safeDate } from "@/utils/safeDate";

export interface NotifWithSlug extends Notification {
  thread_slug?: string;
}

export interface NotifGroup {
  /** Stable section key, e.g. "2026-9-20". */
  key: string;
  /** Human label, already localised. */
  label: string;
  items: NotifWithSlug[];
}

const DAY_MS = 86_400_000;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** «Сегодня» / «Вчера» / «20 октября», with the year when it is not the current one. */
export const dayLabel = (
  date: Date,
  now: Date,
  t: (key: string) => string,
  locale: string,
): string => {
  const days = Math.round((startOfDay(now).getTime() - startOfDay(date).getTime()) / DAY_MS);
  if (days <= 0) return t("notif.today");
  if (days === 1) return t("notif.yesterday");
  return date.toLocaleDateString(locale, {
    day: "numeric",
    month: "long",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
};

/** Split a newest-first list into day sections. */
export const groupByDay = (
  notifs: NotifWithSlug[],
  now: Date,
  t: (key: string) => string,
  locale: string,
): NotifGroup[] => {
  const groups: NotifGroup[] = [];
  for (const notif of notifs) {
    const date = safeDate(notif.created_at);
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(notif);
    else groups.push({ key, label: dayLabel(date, now, t, locale), items: [notif] });
  }
  return groups;
};
