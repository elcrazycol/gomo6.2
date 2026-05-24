export const formatDate = (value: string | null): string => {
  if (!value) return "сейчас";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
};

export const formatTime = (value: string | null): string => {
  if (!value) return "сейчас";
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
};

export const formatPresence = (isOnline: boolean | null, lastSeenAt: string | null): string => {
  if (isOnline) return "онлайн";
  if (!lastSeenAt) return "не в сети";
  return `был(а) ${formatDate(lastSeenAt)}`;
};

export const getInitials = (username: string): string => username.slice(0, 2).toUpperCase();

/**
 * Group messages so consecutive messages from the same sender within `gapMinutes`
 * share a visual group (no avatar / sender label for subsequent messages).
 * Returns an array of booleans: `true` means "show sender info for this message".
 */
export const computeGroupFlags = (messages: Array<{ sender_user_id: string; sent_at: string }>, gapMinutes = 2): boolean[] => {
  if (messages.length === 0) return [];

  const gapMs = gapMinutes * 60 * 1000;
  const flags: boolean[] = [messages.length > 0]; // first message always shows sender

  for (let i = 1; i < messages.length; i++) {
    const prev = messages[i - 1];
    const curr = messages[i];

    const sameSender = curr.sender_user_id === prev.sender_user_id;
    const timeDiff = new Date(curr.sent_at).getTime() - new Date(prev.sent_at).getTime();

    // Show sender info if different sender OR time gap > gapMinutes
    flags.push(!sameSender || timeDiff > gapMs);
  }

  return flags;
};
