/**
 * Session-scoped scroll anchors for the messenger conversation list.
 *
 * The MessageList remounts per conversation (and the store refetches messages
 * on every switch), so a raw pixel offset cannot survive — instead we remember
 * the message id at the top of the viewport plus how far it has been scrolled
 * past, and restore that exact spot when the user returns to the chat.
 *
 * The module sits outside the component (and outside the store, which is
 * cleared on conversation switch) so the position lives for the whole session.
 */
export interface SavedScrollPosition {
  messageId: string;
  /** Pixels between the top of the anchor message and the viewport top. */
  offset: number;
}

const savedScrollPositions = new Map<string, SavedScrollPosition>();

export function saveScrollPosition(conversationId: string, position: SavedScrollPosition): void {
  savedScrollPositions.set(conversationId, position);
}

export function getScrollPosition(conversationId: string): SavedScrollPosition | undefined {
  return savedScrollPositions.get(conversationId);
}

export function clearScrollPosition(conversationId: string): void {
  savedScrollPositions.delete(conversationId);
}

/** Test helper: reset the whole map between test cases. */
export function clearAllScrollPositions(): void {
  savedScrollPositions.clear();
}
