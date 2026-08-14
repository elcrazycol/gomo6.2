/**
 * Recently-used emojis, persisted per device (localStorage).
 *
 * The "Недавние" (history) section of the emoji panel is built from this
 * store. It is intentionally global — emojis you pick in any composer (wall,
 * thread, messenger) show up everywhere, because "recently used" is a
 * property of the user, not of a single text field.
 *
 * Pickers are kept in sync across mounts through a window CustomEvent, so a
 * second picker already open updates the moment another one records an emoji.
 */
export interface RecentEmoji {
  emojiId: string;
  packId: string;
  url: string;
  name: string;
}

const STORAGE_KEY = "gomo6-recent-emojis:v1";
/** How many emojis the history keeps (FIFO, most recent first). */
const MAX_RECENT = 24;
const CHANGE_EVENT = "gomo6:recent-emojis-changed";

export function getRecentEmojis(): RecentEmoji[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is RecentEmoji =>
          !!item &&
          typeof item.emojiId === "string" &&
          typeof item.packId === "string" &&
          typeof item.url === "string" &&
          typeof item.name === "string"
      )
      .slice(0, MAX_RECENT);
  } catch {
    // Corrupted storage (bad JSON) — treat as empty rather than crash.
    return [];
  }
}

/** Records a pick: prepends, dedupes by emojiId and caps the list size. */
export function addRecentEmoji(emoji: RecentEmoji): void {
  const next = [emoji, ...getRecentEmojis().filter((e) => e.emojiId !== emoji.emojiId)].slice(
    0,
    MAX_RECENT
  );
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage full / private mode — the panel still works for this session.
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

/** Subscribes to history changes (e.g. another picker recorded an emoji). */
export function subscribeRecentEmojis(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}
