/**
 * Layout geometry shared by the message list.
 *
 * The scroll *physics* — the bottom pin, the live anchor, prepend stability and
 * the late-measurement settle — now live in `@tanstack/react-virtual`'s chat
 * mode (`anchorTo: 'end'` + `followOnAppend`), so this module only keeps the
 * fixed layout constants and the two tiny helpers the list still needs.
 *
 * Rows are in scroll-element coordinates: the virtualizer is configured with
 * `scrollMargin: HISTORY_HEADER_HEIGHT`, so a row's `start` already includes the
 * fixed history header above the messages.
 */

/** `.msg-history-header` — fixed in every state (messenger.css). */
export const HISTORY_HEADER_HEIGHT = 34;
/** Gap under the last message (mirrors `.message-list-footer`). */
export const BOTTOM_GAP_HEIGHT = 12;

/** The minimal virtual-row shape (a `@tanstack/react-virtual` item satisfies it). */
export interface VirtualRow {
  index: number;
  start: number;
  end: number;
}

/** The anchor for a scroll position: the top-most visible message and how far
 *  its top has been scrolled past the viewport top (positive = above). */
export interface ScrollAnchor {
  messageId: string;
  /** Pixels between the top of the anchor message and the viewport top. */
  offset: number;
}

/** The full virtual content height the spacer must reserve. */
export function virtualContentHeight(virtualTotal: number): number {
  return HISTORY_HEADER_HEIGHT + virtualTotal + BOTTOM_GAP_HEIGHT;
}

/**
 * The top-most visible message and how far its top is above the viewport top.
 * Derived from the virtualizer's measured/estimated offsets, not DOM rects —
 * exact for both rendered and not-yet-rendered rows.
 */
export function captureAnchor(
  rows: readonly VirtualRow[],
  scrollTop: number,
  messageIdAt: (index: number) => string | undefined,
): ScrollAnchor | null {
  for (const row of rows) {
    // Rows fully above the viewport are skipped; the first row whose bottom is
    // at or below the top edge is the top-most visible one.
    if (row.end <= scrollTop) continue;
    const messageId = messageIdAt(row.index);
    if (!messageId) continue;
    return { messageId, offset: scrollTop - row.start };
  }
  return null;
}
