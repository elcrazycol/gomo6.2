export const formatTime = (dateStr: string | null): string => {
  if (!dateStr) return "";
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date(dateStr));
};

export const formatDate = (dateStr: string | null): string => {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return "Сегодня";
  if (d.toDateString() === yesterday.toDateString()) return "Вчера";

  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(d);
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

export const formatPresence = (isOnline: boolean | null, lastSeenAt: string | null): string => {
  if (isOnline) return "онлайн";
  if (!lastSeenAt) return "не в сети";
  return `был(а) ${formatDate(lastSeenAt)}`;
};

export const getInitials = (username: string): string => username.slice(0, 2).toUpperCase();
