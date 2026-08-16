/**
 * Session-scoped scroll anchors for the messenger conversation list.
 *
 * The MessageList remounts per conversation (and the store refetches messages
 * on every switch or reload), so a raw pixel offset cannot survive — instead
 * we remember the message id at the top of the viewport plus how far it has
 * been scrolled past, and restore that exact spot when the user returns to
 * the chat.
 *
 * The map is mirrored to sessionStorage: it survives page reloads (the
 * original use case is returning to a chat, but a reload mid-conversation
 * should also land where the user left off) and dies with the tab, so stale
 * anchors never accumulate. Conversation ids are unique per account, so a
 * different user in the same tab simply has no matching keys.
 */

const STORAGE_KEY = "gomo6:messenger-scroll-positions";

export interface SavedScrollPosition {
  messageId: string;
  /** Pixels between the top of the anchor message and the viewport top. */
  offset: number;
}

const savedScrollPositions = new Map<string, SavedScrollPosition>();

function hydrate(): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const entries = JSON.parse(raw) as [string, SavedScrollPosition][];
    for (const [conversationId, position] of entries) {
      if (
        typeof conversationId === "string" &&
        typeof position?.messageId === "string" &&
        Number.isFinite(position.offset)
      ) {
        savedScrollPositions.set(conversationId, position);
      }
    }
  } catch {
    // Storage unavailable or corrupted — the in-memory map is fine on its own.
  }
}

function persist(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...savedScrollPositions.entries()]));
  } catch {
    // Storage can be unavailable (private browsing / quota) — non-fatal.
  }
}

hydrate();

export function saveScrollPosition(conversationId: string, position: SavedScrollPosition): void {
  const existing = savedScrollPositions.get(conversationId);
  // Skip redundant writes: scroll recording fires up to once per frame, so
  // only persist when the anchor actually changed.
  if (
    existing &&
    existing.messageId === position.messageId &&
    Math.abs(existing.offset - position.offset) < 2
  ) {
    return;
  }
  savedScrollPositions.set(conversationId, position);
  persist();
}

export function getScrollPosition(conversationId: string): SavedScrollPosition | undefined {
  return savedScrollPositions.get(conversationId);
}

export function clearScrollPosition(conversationId: string): void {
  if (!savedScrollPositions.delete(conversationId)) return;
  persist();
}

/** Test helper: reset the whole map (and its storage mirror) between tests. */
export function clearAllScrollPositions(): void {
  savedScrollPositions.clear();
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}
