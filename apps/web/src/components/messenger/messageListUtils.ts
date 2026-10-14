import i18n from "@/i18n";
import { getIntlLanguage } from "@/i18n/dateLocale";
import type { MessageView } from "./types";

// Built once per locale — `Intl.DateTimeFormat` construction is expensive and
// this runs for the first message of every day.
let dayMonthFormatter: Intl.DateTimeFormat | null = null;
let dayMonthLocale = "";
function dayMonth(): Intl.DateTimeFormat {
  const locale = getIntlLanguage();
  if (!dayMonthFormatter || dayMonthLocale !== locale) {
    dayMonthFormatter = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long" });
    dayMonthLocale = locale;
  }
  return dayMonthFormatter;
}

/**
 * True when two messages from the same sender belong to the same visual group
 * (the second message arrives within 2 minutes of the first).
 */
export function isConsecutive(
  prev: Pick<MessageView, "sender_user_id" | "sent_at"> | null,
  curr: Pick<MessageView, "sender_user_id" | "sent_at">,
): boolean {
  return (
    prev != null &&
    prev.sender_user_id === curr.sender_user_id &&
    new Date(curr.sent_at).getTime() - new Date(prev.sent_at).getTime() < 120_000
  );
}

/**
 * Returns a human-readable "сегодня"/"вчера"/date label when a day boundary
 * was crossed between the previous and the current message, otherwise null.
 * The `now` parameter exists only for deterministic tests.
 */
export function getDateSeparator(
  prev: Pick<MessageView, "sent_at"> | null,
  curr: Pick<MessageView, "sent_at">,
  now: Date = new Date(),
): string | null {
  const currDate = new Date(curr.sent_at).toDateString();
  if (prev && new Date(prev.sent_at).toDateString() === currDate) return null;

  const today = now.toDateString();
  const yesterday = new Date(now.getTime() - 86400000).toDateString();

  if (currDate === today) return i18n.t("time.today");
  if (currDate === yesterday) return i18n.t("time.yesterday");
  return dayMonth().format(new Date(curr.sent_at));
}
