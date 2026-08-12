export const formatTime = (dateStr: string | null): string => {
  if (!dateStr) return "";
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date(dateStr));
};

export const formatConversationDate = (dateStr: string | null): string => {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

  if (diffDays === 0) return formatTime(dateStr);
  if (diffDays === 1) return "Вчера";
  if (diffDays < 7) return `${diffDays} дн.`;
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit" }).format(d);
};

import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";

// A user who went offline within the last minute reads as «был(а) только что»
// instead of «был(а) в сети 1 минуту назад» — same rule as the profile's
// OnlineStatus (date-fns rounds 30–90 s up to a full minute, which looks wrong
// the moment the status flips to offline).
const JUST_NOW_MS = 60_000;

export const formatPresence = (isOnline: boolean | null, lastSeenAt: string | null): string => {
  if (isOnline) return "онлайн";
  if (!lastSeenAt) return "не в сети";
  const d = new Date(lastSeenAt);
  if (Number.isNaN(d.getTime())) return "не в сети";
  if (Date.now() - d.getTime() <= JUST_NOW_MS) return "был(а) только что";
  return `был(а) в сети ${formatDistanceToNow(d, { addSuffix: true, locale: ru })}`;
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
