import i18n from "@/i18n";
import { getDateLocale, getIntlLanguage } from "@/i18n/dateLocale";
import { formatDistanceToNow } from "date-fns";

export const formatTime = (dateStr: string | null): string => {
  if (!dateStr) return "";
  return new Intl.DateTimeFormat(getIntlLanguage(), { hour: "2-digit", minute: "2-digit" }).format(new Date(dateStr));
};

/**
 * When a message was read: «Сегодня в 14:32», «Вчера в 23:10» or
 * «12.08 в 10:15». Used by the message action panel.
 */
export const formatReadAt = (dateStr: string | null): string => {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  const time = formatTime(dateStr);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return i18n.t("time.todayAt", { time });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return i18n.t("time.yesterdayAt", { time });
  const date = new Intl.DateTimeFormat(getIntlLanguage(), { day: "2-digit", month: "2-digit" }).format(d);
  return i18n.t("time.dateAt", { date, time });
};

export const formatConversationDate = (dateStr: string | null): string => {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

  if (diffDays === 0) return formatTime(dateStr);
  if (diffDays === 1) return i18n.t("time.yesterdayTitle");
  if (diffDays < 7) return i18n.t("time.daysShortNoSuffix", { count: diffDays });
  return new Intl.DateTimeFormat(getIntlLanguage(), { day: "2-digit", month: "2-digit" }).format(d);
};

// A user who went offline within the last minute reads as «был(а) только что»
// instead of «был(а) в сети 1 минуту назад» — same rule as the profile's
// OnlineStatus (date-fns rounds 30–90 s up to a full minute, which looks wrong
// the moment the status flips to offline).
const JUST_NOW_MS = 60_000;

export const formatPresence = (isOnline: boolean | null, lastSeenAt: string | null): string => {
  if (isOnline) return i18n.t("time.online");
  if (!lastSeenAt) return i18n.t("time.offline");
  const d = new Date(lastSeenAt);
  if (Number.isNaN(d.getTime())) return i18n.t("time.offline");
  if (Date.now() - d.getTime() <= JUST_NOW_MS) return i18n.t("time.wasOnlineJustNow");
  const time = formatDistanceToNow(d, { addSuffix: true, locale: getDateLocale() });
  return i18n.t("time.wasOnline", { time });
};

export const getInitials = (username: string): string => username.slice(0, 2).toUpperCase();

const USER_COLORS = [
  "text-red-500",
  "text-blue-500",
  "text-green-500",
  "text-yellow-500",
  "text-purple-500",
  "text-pink-500",
  "text-indigo-500",
  "text-teal-500",
];

export const getUserColorClass = (userId: string): string => {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length];
};
