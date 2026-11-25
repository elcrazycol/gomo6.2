import {
  Suspense,
  forwardRef,
  lazy,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChevronDown } from "lucide-react";
import { queueMarkRead, useMessengerStore } from "@/stores/messengerStore";
import { hasScrollAnchoring } from "@/lib/scrollAnchoring";
import { hapticTick } from "@/lib/haptics";
import type { MessageView, ReceiptRow } from "./types";
import { getDateSeparator, isConsecutive } from "./messageListUtils";
import { indexById, messageKey, sentAtMs } from "./core/messageModel";
import {
  clearMessageScrollAnchor,
  readMessageScrollAnchor,
  writeMessageScrollAnchor,
  type MessageScrollAnchor,
} from "./core/messageScrollAnchors";
import {
  ANCHOR_AFTER,
  ANCHOR_BEFORE,
  INITIAL_WINDOW,
  MAX_DOM_MESSAGES,
  RESET_WINDOW,
  WINDOW_STEP,
  buildKeyIndex,
  resolveKeyWindow,
  sameKeyWindow,
  tailKeyWindow,
  tailSlice,
  type KeyWindow,
  type MessageSlice,
} from "./core/slicing";
import {
  animateScroll,
  cancelScrollAnimation,
  isAnimatingScroll,
  restartCurrentScrollAnimation,
  type ScrollDirection,
  type ScrollPosition,
} from "./core/animateScroll";
import {
  forceMeasure,
  requestForcedReflow,
  requestMeasure,
  requestMutation,
} from "./core/fasterdom";
import {
  PERF_COMMIT_READ,
  PERF_COMMIT_START,
  PERF_SCROLL_PASS_START,
  logCommitTiming,
  perfMark,
  perfMeasure,
} from "./core/perfMarks";
import {
  isScrollDiagnosticsEnabled,
  noteCommitDuration,
  noteGestureEnd,
  noteGestureStart,
  noteMountedRows,
  notePageRequest,
  noteScrollTopWrite,
} from "./core/scrollDiagnostics";

import {
  AT_BOTTOM_THRESHOLD,
  BOTTOM_SNAP_CLASS,
  getOffsetToContainer,
  pinToBottom,
  readContainerScrollTop,
  setScrollTop,
} from "./core/scrollGeometry";

// ── Behaviour constants ────────────────────────────────────────────────────

/**
 * Distance from the newest message that still counts as "the reader is following
 * the conversation": arrivals keep gliding in, the unread badge stays hidden.
 */
const FOLLOW_SLACK = 100;
/**
 * The band around the bottom trigger in which native scroll snapping is armed
 * (Telegram's `BOTTOM_SNAP_THRESHOLD`). Outside it the reader is exploring
 * history and snapping must not pull them back.
 */
const BOTTOM_SNAP_THRESHOLD = 7;
/** How close to the mounted top/bottom a new page is mounted (Telegram: 750). */
const HISTORY_TRIGGER_MARGIN = 750;
/**
 * Where the *request* for the next page starts. Much earlier than the mount
 * trigger: a request touches no DOM, so it is safe mid-fling and it takes the
 * network out of the wait when the reader reaches the mounted top. A phone row
 * is ~50-90px, so this keeps several pages ahead of a fast fling (the store
 * buffers two, the rest are cheap no-ops).
 */
const PREFETCH_PX = 12000;
/** Minimum gap between two older-history requests (burst guard). */
const LOAD_COOLDOWN_MS = 400;
/**
 * How long the scroller must be quiet before the work that needs a verified
 * rest: reading the read line, and — on an engine without native scroll
 * anchoring — mounting rows above the viewport. A quiet event stream is not
 * proof of a rest on iOS, so the rest is verified from the position itself: the
 * position must be unchanged since the last observation, whatever the timer says.
 *
 * This is the delay between "the reader stopped" and "the page is mounted" on
 * WebKit, so it is kept at Telegram Web's debounce scale (~100ms) rather than
 * generous: the verification, not the timer, is what makes the rest safe.
 */
const REST_MS = 80;
/**
 * The gap a focused message keeps from the viewport edge (Telegram Web's
 * `FOCUS_MARGIN` / `BOTTOM_FOCUS_MARGIN`, both in rem there).
 */
const FOCUS_MARGIN = 20;
/**
 * How much of a jump to the bottom is *animated*. The rest is covered at once:
 * gliding through thousands of pixels reads as a hang. Telegram Web's
 * `BOTTOM_FOCUS_OFFSET`, used when the viewport was replaced under the glide
 * (which is exactly a jump-to-bottom or a jump-to-message here).
 */
const BOTTOM_FOCUS_DISTANCE = 500;
/**
 * Telegram's `body.is-scrolling-messages`: set while the reader is scrolling and
 * removed a beat after they stop. The floating date is gated on it in CSS, so at
 * rest the date steps aside instead of hanging over the list (their rule, their
 * delay — 1s of `runDebounced`).
 */
const SCROLLING_CLASS = "is-scrolling-messages";
const SCROLLING_FLAG_MS = 900;
/** Distance the unread divider keeps from the top when a chat opens on it. */
const UNREAD_DIVIDER_TOP = 12;
/**
 * How long an arrival keeps the "the reader is following" state pinned
 * (Telegram Web's `TOOLS_FREEZE_TIMEOUT`): while a tall incoming message is being
 * brought in, the position is momentarily further from the bottom than the slack,
 * and without the freeze the "to the newest message" button would flash on and off.
 */
const FOLLOWING_FREEZE_MS = 350;
/** Redisplays a jumped-to message for this long. */
const FLASH_MS = 1400;
/** How many pages `scrollToMessage` may fetch while looking for its target. */
const MAX_JUMP_PAGES = 20;

// ── Public API ─────────────────────────────────────────────────────────────

export interface MessageRenderExtras {
  dateLabel: string | null;
  isConsecutive: boolean;
  /**
   * The reply target, resolved against the FULL loaded history (a reply can
   * quote a message that is outside the mounted window). Passed through the
   * renderer so a message item's memo comparator can see a changed quote.
   */
  quoted: MessageView | null;
  /** The other side's receipt row for this message, or null. */
  peerReceipt: ReceiptRow | null;
}

export interface MessageListHandle {
  /** Jump to the newest message (send / FAB). */
  scrollToBottom: () => void;
  /** Centre a message, paging older history until it is loaded. */
  scrollToMessage: (messageId: string) => void;
}

interface MessageListProps {
  renderMessage: (message: MessageView, prev: MessageView | null, extras: MessageRenderExtras) => ReactNode;
  /**
   * Identity of the *ambient* render inputs (receipts map, pinned id, group /
   * notes flags). The list compares it to decide whether mounted rows must be
   * re-rendered even though their own message did not change.
   */
  renderVersion?: unknown;
  /** Notes self-chat: a filtered view of the store messages (folder filter).
   *  When omitted the full store list is used. */
  messagesOverride?: MessageView[];
  /**
   * The timestamp the conversation is known to be read up to, captured when the
   * chat was opened (`getConversationReadThrough`). Read on mount ONLY: the marker
   * of where the reader left off must not move while they are reading it — it is
   * recomputed on the next open, exactly like Telegram Web's
   * `memoUnreadDividerBeforeIdRef`.
   */
  unreadBoundaryAt?: string | null;
}

type RenderMessage = MessageListProps["renderMessage"];

/**
 * The dev counters overlay is loaded on demand and never in a production build:
 * `import.meta.env.DEV` folds to `false`, so the dynamic import is dropped
 * entirely instead of shipping dead bytes (a top-level `memo(...)` call in the
 * overlay module is enough for a bundler to keep it otherwise).
 */
const DevScrollOverlay = import.meta.env.DEV
  ? lazy(async () => ({ default: (await import("./ScrollDebugOverlay")).ScrollDebugOverlay }))
  : null;

// ── Message item ───────────────────────────────────────────────────────────
// A plain, normal-flow row: no position, no transform, no spacer, and no
// `content-visibility`. Every mounted row IS laid out — a row whose height the
// engine does not know is a row that moves everything below it the moment it is
// rendered, which is the stutter this list used to have on WebKit.

interface MessageItemProps {
  message: MessageView;
  prev: MessageView | null;
  extras: MessageRenderExtras;
  flash: boolean;
  renderVersion: unknown;
  render: RenderMessage;
}

const MessageItem = memo(
  function MessageItem({ message, prev, extras, flash, render }: MessageItemProps) {
    return (
      <div
        // `.message-row` is kept for the existing long-press/menu host hooks.
        className={`message-item message-row chat-native-row${flash ? " is-flash" : ""}`}
        data-message-id={message.id}
        data-message-key={messageKey(message)}
      >
        {render(message, prev, extras)}
      </div>
    );
  },
  (a, b) =>
    a.message === b.message &&
    a.prev === b.prev &&
    a.flash === b.flash &&
    a.extras.dateLabel === b.extras.dateLabel &&
    a.extras.isConsecutive === b.extras.isConsecutive &&
    a.extras.quoted === b.extras.quoted &&
    a.extras.peerReceipt === b.extras.peerReceipt &&
    Object.is(a.renderVersion, b.renderVersion),
);

// ── DOM helpers ────────────────────────────────────────────────────────────

/** Every mounted row, in document order (row offsets are monotonic). */
function collectRows(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(".message-item[data-message-key]"));
}

function findRowByKey(rows: HTMLElement[], key: string): HTMLElement | null {
  for (const row of rows) {
    if (row.dataset.messageKey === key) return row;
  }
  return null;
}

function findRowById(rows: HTMLElement[], id: string): HTMLElement | null {
  for (const row of rows) {
    if (row.dataset.messageId === id) return row;
  }
  return null;
}

/** The message behind a row, or undefined when it is no longer loaded. */
function messageAt(
  row: HTMLElement,
  index: ReadonlyMap<string, number>,
  messages: readonly MessageView[],
): MessageView | undefined {
  const key = row.dataset.messageKey;
  if (key === undefined) return undefined;
  const at = index.get(key);
  return at === undefined ? undefined : messages[at];
}

/** The first row that intersects the viewport (its bottom is below the fold). */
function findTopVisibleRowIndex(rows: HTMLElement[], scrollTop: number): number {
  let low = 0;
  let high = rows.length - 1;
  let candidate = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (rows[mid].offsetTop + rows[mid].offsetHeight > scrollTop) {
      candidate = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return candidate;
}

/**
 * The newest row that INTERSECTS the viewport (even partially), or -1.
 *
 * Deliberately not "the newest row that is fully visible": a message taller than
 * the viewport is never fully visible, so a read line built on that rule stalls
 * one message short of the newest one — and the chat then stays unread no matter
 * how often the reader scrolls to the bottom. Telegram marks read on
 * intersection (`useMessageObservers` → `markMessageListRead({ maxId })`).
 */
function findNewestIntersectingRowIndex(
  rows: HTMLElement[],
  scrollTop: number,
  fold: number,
): number {
  let low = 0;
  let high = rows.length - 1;
  let candidate = -1;

  // The last row whose top is above the fold…
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (rows[mid].offsetTop < fold) {
      candidate = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  // …walking back over the ones that are entirely above the viewport's top edge.
  while (candidate >= 0 && rows[candidate].offsetTop + rows[candidate].offsetHeight <= scrollTop) {
    candidate -= 1;
  }

  return candidate;
}

/**
 * The first loaded message the reader has not read: everything newer than the
 * read-through boundary, skipping their own.
 *
 * `undefined` means the caller said nothing about the boundary (no divider);
 * `null` means "nothing is known to be read", i.e. everything not the reader's
 * own is unread — which is what a chat the reader has never opened looks like.
 */
function findFirstUnreadKey(
  messages: readonly MessageView[],
  boundaryAt: string | null | undefined,
  ownId: string | undefined,
): string | null {
  if (boundaryAt === undefined) return null;

  const boundary = boundaryAt ? Date.parse(boundaryAt) : Number.NEGATIVE_INFINITY;

  for (const message of messages) {
    if (message.is_deleted || message.deleting) continue;
    if (ownId && message.sender_user_id === ownId) continue;
    if (sentAtMs(message) > boundary) return messageKey(message);
  }

  return null;
}

// ── Window math ────────────────────────────────────────────────────────────

/** A key window for an explicit `[start, end)` slice. */
function windowFromSlice(
  messages: readonly MessageView[],
  start: number,
  end: number,
  followTail: boolean,
): KeyWindow {
  const first = messages[start];
  const last = messages[end - 1];
  return {
    first: first ? messageKey(first) : null,
    last: followTail ? null : last ? messageKey(last) : null,
  };
}

/**
 * The mounted message window for the open conversation.
 *
 * ## The model (ported from Telegram Web)
 *
 * The DOM is **never virtualized** within the mounted slice: no spacers, no
 * absolute rows, no `content-visibility`. What is bounded is the *slice of
 * history that is mounted* ({@link MAX_DOM_MESSAGES} rows), and it slides like a
 * page of a book: rows are added on the side the reader is moving toward and
 * dropped on the opposite side, which is off screen by construction. Dropping
 * rows off the far end and adding rows above it therefore never move what the
 * reader is looking at — and where the engine has scroll anchoring, adding rows
 * above does not either.
 *
 * ## One writer
 *
 * Exactly one `useLayoutEffect` decides the scroll position and writes it in a
 * single DOM mutation pass (`core/fasterdom`). Its decision tree, in order:
 *
 *  1. **First placement** — the restored session anchor, else the newest row.
 *  2. **A pending jump** — glide to the target and flash it.
 *  3. **A new tail while following** — glide the arrival in (the "message rises"
 *     feel of a send).
 *  4. **The reader was at the bottom** — pin with the sentinel. This single
 *     write keeps a growing list glued: it clamps to the new maximum whatever
 *     grew, above or below.
 *  5. **Otherwise** — compensate the layout change above the reader's anchor,
 *     plus any movement of the scroller's own top edge (the pinned banner
 *     appearing above the messages pushes the content down).
 *
 * There is no other `scrollTop` writer here. Nothing is written on scroll: every
 * position change happens in a commit, which is the only moment the DOM changes.
 *
 * ## Arrivals while the reader is up in history
 *
 * The window freezes (`last` materializes), the arrival is not mounted, nothing
 * moves, and the badge counts it. Telegram's contract.
 */
export const MessageList = memo(
  forwardRef<MessageListHandle, MessageListProps>(function MessageList(
    { renderMessage, renderVersion, messagesOverride, unreadBoundaryAt },
    ref,
  ) {
    const conversationId = useMessengerStore((s) => s.selectedConversationId);
    const meId = useMessengerStore((s) => s.me?.id);
    const storeMessages = useMessengerStore((s) => s.messages);
    // Notes self-chat passes a folder-filtered view; regular chats use the full list.
    const messages = messagesOverride ?? storeMessages;
    const receipts = useMessengerStore((s) => s.receipts);
    const hasMoreMessages = useMessengerStore((s) => s.hasMoreMessages);
    const isLoadingMore = useMessengerStore((s) => s.isLoadingMore);
    const loadMoreMessages = useMessengerStore((s) => s.loadMoreMessages);
    const flushPendingOlderMessages = useMessengerStore((s) => s.flushPendingOlderMessages);

    const scrollerRef = useRef<HTMLDivElement | null>(null);
    const topSentinelRef = useRef<HTMLDivElement | null>(null);
    const bottomSentinelRef = useRef<HTMLDivElement | null>(null);
    const bottomTriggerRef = useRef<HTMLDivElement | null>(null);
    /** The floating date (Telegram's sticky date): written straight to the DOM. */
    const stickyDateRef = useRef<HTMLDivElement | null>(null);

    // ── Window state ───────────────────────────────────────────────────
    // Seeded once per mount (the list is keyed by conversation in ChatView):
    // the saved session anchor when its message is still loaded, the tail
    // otherwise. The unread marker is frozen here too — it belongs to the moment
    // the chat was opened, not to the reader's progress through it.
    const [initial] = useState(() => {
      const unreadKey = findFirstUnreadKey(messages, unreadBoundaryAt, meId);
      const saved = conversationId ? readMessageScrollAnchor(conversationId) : undefined;
      if (saved) {
        const at = messages.findIndex((message) => messageKey(message) === saved.key);
        if (at >= 0) {
          return {
            window: {
              first: messageKey(messages[Math.max(0, at - ANCHOR_BEFORE)]),
              last: messageKey(messages[Math.min(messages.length - 1, at + ANCHOR_AFTER)]),
            } satisfies KeyWindow,
            restore: saved as MessageScrollAnchor | null,
            unreadKey,
          };
        }
      }
      if (unreadKey) {
        const at = messages.findIndex((message) => messageKey(message) === unreadKey);
        if (at >= 0) {
          return {
            window: windowFromSlice(
              messages,
              at,
              Math.min(messages.length, at + INITIAL_WINDOW),
              false,
            ),
            restore: null as MessageScrollAnchor | null,
            unreadKey,
          };
        }
      }

      return {
        window: tailKeyWindow(messages),
        restore: null as MessageScrollAnchor | null,
        unreadKey,
      };
    });

    const [window, setWindow] = useState<KeyWindow>(initial.window);
    const windowRef = useRef(window);
    windowRef.current = window;

    const followingRef = useRef(initial.restore === null);
    const [following, setFollowing] = useState(initial.restore === null);
    const [unread, setUnread] = useState(0);
    const [flashId, setFlashId] = useState<string | null>(null);
    const [jumpNonce, setJumpNonce] = useState(0);

    // ── Derived slice ──────────────────────────────────────────────────
    const indexByKey = useMemo(() => buildKeyIndex(messages), [messages]);
    const indexByKeyRef = useRef(indexByKey);
    indexByKeyRef.current = indexByKey;

    const messagesRef = useRef(messages);
    messagesRef.current = messages;

    const unreadIndex = useMemo(() => {
      if (!initial.unreadKey) return -1;
      return indexByKey.get(initial.unreadKey) ?? -1;
    }, [indexByKey, initial.unreadKey]);

    const resolved = resolveKeyWindow(window, indexByKey, messages.length);
    const windowResolvable = resolved !== null;
    const derived = resolved ?? tailSlice(messages.length);
    const derivedRef = useRef<MessageSlice>(derived);
    derivedRef.current = derived;

    // A full reload (or a notes folder change) invalidates the keys: re-seed to
    // the tail window.
    useLayoutEffect(() => {
      if (windowResolvable) return;
      const next = tailKeyWindow(messagesRef.current);
      setWindow((current) => (sameKeyWindow(current, next) ? current : next));
    }, [windowResolvable, messages]);

    // ── Latest store values, readable from event handlers ──────────────
    const hasMoreRef = useRef(hasMoreMessages);
    hasMoreRef.current = hasMoreMessages;
    const loadingMoreRef = useRef(isLoadingMore);
    loadingMoreRef.current = isLoadingMore;
    const conversationIdRef = useRef(conversationId);
    conversationIdRef.current = conversationId;
    const rowsRef = useRef<HTMLElement[]>([]);

    /**
     * What the last commit left behind. A commit is the only moment the DOM
     * changes, so this is the reader's position as the DOM knew it — including
     * the anchor's *scroll coordinate*, which survives the reader scrolling and
     * only moves when the layout above the anchor changes.
     */
    const prevCommitRef = useRef<{
      anchorKey: string | null;
      anchorCoord: number;
      containerTop: number;
      clientHeight: number;
      /** Distance from the top to the bottom of the content, after the write. */
      bottomOffset: number;
      tailKey: string | null;
      /** The mounted window this commit left behind (for the dev counters). */
      sliceStart: number;
      sliceEnd: number;
    } | null>(null);

    const didInitialPositionRef = useRef(false);
    const pendingJumpRef = useRef<{ id: string; attempts: number } | null>(null);
    /** A "take me to the newest message" request the commit has to serve. */
    const pendingBottomGlideRef = useRef(false);
    const pendingTopMountRef = useRef(false);
    const pinnedTailRef = useRef<string | null>(null);
    /** While `Date.now()` is below this, an arrival is settling (see the freeze). */
    const followingFreezeUntilRef = useRef(0);
    const lastReadKeyRef = useRef<string | null>(null);
    const lastStickyDateRef = useRef<string | null>(null);
    const scrollingFlagTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastRequestAtRef = useRef(0);
    const olderBusyRef = useRef(false);
    /** A pointer is on the list: nothing may move content under it (WebKit). */
    const pointerDownRef = useRef(false);
    /** The position moved and has not been verified at rest yet. */
    const coastingRef = useRef(false);
    /**
     * The next scroll event is the echo of our own `scrollTop` write, not the
     * reader scrolling (Telegram Web: `isScrollTopJustUpdatedRef`). Treating it
     * as the reader would re-arm the rest pass, which on WebKit defers the next
     * page mount by another rest window — the wall the reader feels.
     */
    const justWrotePositionRef = useRef(false);
    /**
     * A programmatic position replace is in flight. Safari delivers stale
     * `IntersectionObserver` entries between the DOM mutation and the scroll
     * restore, and acting on one would mount a page from a position that no
     * longer exists (Telegram Web: `isReplacingHistoryRef`).
     */
    const replacingHistoryRef = useRef(false);
    const bestPositionRef = useRef(0);
    const restTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const scrollRafRef = useRef<number | null>(null);

    // ── Rendering inputs ───────────────────────────────────────────────
    const messageById = useMemo(() => indexById(messages), [messages]);
    const peerReceiptByMessage = useMemo(() => {
      const map = new Map<string, ReceiptRow>();
      for (const receipt of receipts.get(conversationId ?? "") ?? []) {
        if (receipt.user_id === meId) continue;
        map.set(receipt.message_id, receipt);
      }
      return map;
    }, [receipts, conversationId, meId]);

    // ── Flash a jumped-to message ──────────────────────────────────────
    const flashMessage = useCallback((id: string) => {
      setFlashId(id);
      if (flashTimerRef.current !== null) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => {
        flashTimerRef.current = null;
        setFlashId(null);
      }, FLASH_MS);
    }, []);

    /**
     * Is it safe to add rows ABOVE the viewport right now? With native scroll
     * anchoring the engine moves the position for us, so it always is. Without
     * it (WebKit) the added rows would shift the reader's content, and the write
     * that compensates is dropped while a gesture or a coast is live — which is
     * exactly the observed "it teleports me twice". So there: a verified rest.
     */
    const canMountAboveNow = useCallback(
      () => hasScrollAnchoring() || (!coastingRef.current && !pointerDownRef.current),
      [],
    );

    // ── Mounted window: slide it like a page ───────────────────────────
    /**
     * Extend the mounted window toward one side, dropping the far side when it
     * goes over the ceiling. The reader is moving *away* from the far side, so
     * the dropped rows are off screen.
     */
    const enlargeWindow = useCallback((side: "top" | "bottom") => {
      const { start, end } = derivedRef.current;
      const messages = messagesRef.current;
      const current = windowRef.current;
      let nextStart = start;
      let nextEnd = end;

      if (side === "top") nextStart = Math.max(0, start - WINDOW_STEP);
      else nextEnd = Math.min(messages.length, end + WINDOW_STEP);

      if (nextStart === start && nextEnd === end) return false;

      // A window that still follows the tail owns the newest rows and must never
      // lose them; a frozen one (the reader is in history) may drop the bottom.
      const overflow = nextEnd - nextStart - MAX_DOM_MESSAGES;
      if (overflow > 0) {
        if (side === "top" && current.last !== null) nextEnd -= overflow;
        else if (side === "bottom" && current.first !== null) nextStart += overflow;
      }

      // A frozen window stays frozen: "the window ends at the array end" is not
      // the same as "the window follows the tail" (the reader may have scrolled
      // up to the newest mounted row, which is the array end).
      const next = windowFromSlice(messages, nextStart, nextEnd, current.last === null);
      setWindow((prev) => (sameKeyWindow(prev, next) ? prev : next));
      return true;
    }, []);

    // ── Older history ──────────────────────────────────────────────────
    /** Mount the page the store buffered, if there is one. */
    const flushBufferedPage = useCallback(() => {
      const id = conversationIdRef.current;
      if (!id) return false;
      pendingTopMountRef.current = false;
      if (!flushPendingOlderMessages(id)) return false;
      const next = useMessengerStore.getState().messages;
      if (next.length === 0) return true;
      setWindow((current) => {
        const index = buildKeyIndex(next);
        const resolvedLast =
          current.last === null ? next.length : (index.get(current.last) ?? next.length - 1) + 1;
        const end = Math.max(1, Math.min(next.length, resolvedLast));
        const start = Math.max(0, end - MAX_DOM_MESSAGES);
        return windowFromSlice(next, start, end, current.last === null);
      });
      return true;
    }, [flushPendingOlderMessages]);

    /**
     * Fetch the previous page into the store's buffer. `postpone` keeps the
     * *request* away from the DOM: it runs mid-fling, so the network round trip
     * is not part of the wait when the reader reaches the mounted top.
     */
    const requestOlderPage = useCallback(async () => {
      const id = conversationIdRef.current;
      if (!id || !hasMoreRef.current || loadingMoreRef.current || olderBusyRef.current) return false;
      const now = Date.now();
      if (now - lastRequestAtRef.current < LOAD_COOLDOWN_MS) return false;
      lastRequestAtRef.current = now;
      olderBusyRef.current = true;
      notePageRequest();
      try {
        await loadMoreMessages(id, { postpone: true });
      } finally {
        olderBusyRef.current = false;
      }
      if (canMountAboveNow()) flushBufferedPage();
      else pendingTopMountRef.current = true;
      return true;    }, [loadMoreMessages, flushBufferedPage, canMountAboveNow]);

    /** One older step: already-mounted rows first, then a page, then a request. */
    const expandOlderNow = useCallback(() => {
      if (followingRef.current) return;
      if (!canMountAboveNow()) {
        pendingTopMountRef.current = true;
        return;
      }
      if (enlargeWindow("top")) return;
      if (flushBufferedPage()) return;
      void requestOlderPage();
    }, [canMountAboveNow, enlargeWindow, flushBufferedPage, requestOlderPage]);

    /** Keep the next page buffered while the reader is anywhere near the top. */
    const prefetchOlder = useCallback(() => {
      if (followingRef.current) return;
      const scroller = scrollerRef.current;
      if (!scroller || readContainerScrollTop(scroller) > PREFETCH_PX) return;
      void requestOlderPage();
    }, [requestOlderPage]);

    // ── Read line: the read receipts the reader generates ──────────────
    /**
     * Reports exactly ONE message per pass: the newest message that is fully
     * visible and was not sent by the reader. Everything above it was read.
     * Runs only at a verified rest, and only when the answer changed.
     */
    const reportVisibleReads = useCallback(() => {
      const id = conversationIdRef.current;
      const scroller = scrollerRef.current;
      if (!id || !scroller) return;

      const rows = rowsRef.current;
      if (rows.length === 0) return;

      const scrollTop = readContainerScrollTop(scroller);
      const fold = scrollTop + scroller.clientHeight;
      // At the bottom of the list everything on screen has been seen — including
      // a message taller than the viewport, and including the reader's own (which
      // is what lets the read marker reach the newest message at all).
      const atBottom = scroller.scrollHeight - scrollTop - scroller.clientHeight <= AT_BOTTOM_THRESHOLD;
      let at = atBottom ? rows.length - 1 : findNewestIntersectingRowIndex(rows, scrollTop, fold);

      while (at >= 0) {
        const key = rows[at].dataset.messageKey;
        const index = key === undefined ? undefined : indexByKeyRef.current.get(key);
        const message = index === undefined ? undefined : messagesRef.current[index];
        // A deleted (or currently leaving) message cannot carry a read marker;
        // the prefix rule covers it.
        if (message && !message.is_deleted && !message.deleting) {
          if (key != null && key !== lastReadKeyRef.current) {
            lastReadKeyRef.current = key;
            queueMarkRead(id, message.id, message.sent_at);
          }
          return;
        }
        at -= 1;
      }
    }, []);

    /**
     * Remember where the reader is, for the next open of this conversation — and,
     * because the anchor also goes to `sessionStorage`, for the next *load* of the
     * app (core/messageScrollAnchors). Written at rest, never on scroll: the row
     * offsets it reads are only meaningful once the layout has settled.
     */
    const persistAnchor = useCallback(() => {
      const id = conversationIdRef.current;
      const scroller = scrollerRef.current;
      if (!id || !scroller) return;
      if (followingRef.current) {
        // At the newest message there is nothing to remember — and a stale
        // mid-history anchor must not survive into the next load.
        clearMessageScrollAnchor(id);
        return;
      }

      const scrollTop = readContainerScrollTop(scroller);
      for (const row of rowsRef.current) {
        if (row.offsetTop + row.offsetHeight <= scrollTop + 1) continue;
        const key = row.dataset.messageKey;
        if (!key) return;
        writeMessageScrollAnchor(id, { key, offset: Math.max(0, row.offsetTop - scrollTop) });
        return;
      }
    }, []);

    // ── The verified rest ──────────────────────────────────────────────
    /**
     * Everything that must not run under a live gesture or a coast. A quiet
     * event stream is not proof of a rest (iOS), so the rest is verified from
     * the position itself: if it moved since the last observation, re-arm
     * instead of touching the DOM.
     */
    const handleRest = useCallback(
      function handleRest() {
        if (pointerDownRef.current) return;
        const scroller = scrollerRef.current;
        if (!scroller) return;

        const scrollTop = readContainerScrollTop(scroller);
        if (Math.abs(scrollTop - bestPositionRef.current) > 1) {
          bestPositionRef.current = scrollTop;
          if (restTimerRef.current !== null) clearTimeout(restTimerRef.current);
          restTimerRef.current = setTimeout(() => {
            restTimerRef.current = null;
            handleRest();
          }, REST_MS);
          return;
        }

        coastingRef.current = false;
        restTimerRef.current = null;
        noteGestureEnd();

        // Work the gate deferred: a page that was fetched mid-coast is mounted
        // now — otherwise the window slides into rows that are already loaded.
        if (pendingTopMountRef.current) {
          pendingTopMountRef.current = false;
          if (!flushBufferedPage()) expandOlderNow();
        }
        // A layout read (the binary search over row offsets) belongs in a
        // measure pass, not in an arbitrary timer task.
        requestMeasure(() => {
          reportVisibleReads();
          persistAnchor();
        });
      },
      [flushBufferedPage, expandOlderNow, reportVisibleReads, persistAnchor],
    );
    const restRef = useRef(handleRest);
    restRef.current = handleRest;

    const armRest = useCallback(() => {
      if (restTimerRef.current !== null) clearTimeout(restTimerRef.current);
      restTimerRef.current = setTimeout(() => {
        restTimerRef.current = null;
        restRef.current();
      }, REST_MS);
    }, []);

    // ── Bottom stickiness ──────────────────────────────────────────────
    /**
     * Arms native scroll snapping while the reader is within the band around the
     * bottom trigger, and disarms it the moment they leave. Snapping is what
     * makes "at the bottom" survive a growing list without a single `scrollTop`
     * write; disarming it is what lets the reader leave.
     */
    const syncBottomSnap = useCallback(() => {
      const scroller = scrollerRef.current;
      const trigger = bottomTriggerRef.current;
      if (!scroller || !trigger) return;

      const isArmed = scroller.classList.contains(BOTTOM_SNAP_CLASS);
      if (isAnimatingScroll(scroller)) {
        if (isArmed) scroller.classList.remove(BOTTOM_SNAP_CLASS);
        return;
      }

      const viewportBottom = readContainerScrollTop(scroller) + scroller.clientHeight;
      const triggerBottom = getOffsetToContainer(trigger, scroller) + trigger.offsetHeight;
      const shouldArm =
        triggerBottom - BOTTOM_SNAP_THRESHOLD <= viewportBottom &&
        viewportBottom <= triggerBottom + BOTTOM_SNAP_THRESHOLD * 2;

      if (shouldArm === isArmed) return;
      scroller.classList.toggle(BOTTOM_SNAP_CLASS, shouldArm);
    }, []);

    /**
     * Re-evaluates "the reader is following the conversation" from the element's
     * own geometry. Only the transition is applied, so an ordinary scroll pass
     * costs one read pair and no React work.
     */
    const updateFollowing = useCallback(() => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      const isFollowing =
        scroller.scrollHeight - readContainerScrollTop(scroller) - scroller.clientHeight <= FOLLOW_SLACK;
      if (isFollowing === followingRef.current) return;
      // An arrival in flight: the reader is following, the position is briefly
      // further from the bottom than the slack. Leaving the follow state here is
      // what makes the button flash.
      if (!isFollowing && Date.now() < followingFreezeUntilRef.current) return;

      if (isFollowing) {
        followingRef.current = true;
        setFollowing(true);
        setUnread(0);
        // Back at the newest message: re-seed the window to the tail. Every row
        // that leaves is above the viewport, so nothing the reader sees moves.
        const next = tailKeyWindow(messagesRef.current);
        setWindow((current) => (sameKeyWindow(current, next) ? current : next));
      } else {
        followingRef.current = false;
        setFollowing(false);
        // Freeze the window on the mounted rows: an arrival must not pull the
        // reader down, it only raises the badge.
        const { start, end } = derivedRef.current;
        const list = messagesRef.current;
        const first = list[start];
        const newest = list[end - 1];
        setWindow((current) => ({
          first: current.first ?? (first ? messageKey(first) : null),
          last: newest ? messageKey(newest) : current.last,
        }));
      }
    }, []);

    /**
     * The reader is scrolling: publishes Telegram's `is-scrolling-messages` on
     * `<body>` and takes it back a beat after the last scroll event.
     */
    const markScrolling = useCallback(() => {
      document.body.classList.add(SCROLLING_CLASS);
      if (scrollingFlagTimerRef.current !== null) clearTimeout(scrollingFlagTimerRef.current);
      scrollingFlagTimerRef.current = setTimeout(() => {
        scrollingFlagTimerRef.current = null;
        document.body.classList.remove(SCROLLING_CLASS);
      }, SCROLLING_FLAG_MS);
    }, []);

    /**
     * The floating date. Telegram keeps a date pinned to the top while the
     * separator it belongs to has scrolled out of view (`useStickyDates`); this is
     * the same idea, computed from the mounted rows instead of a `sticky` element
     * (our separators live *inside* a row, so they cannot stick).
     *
     * Shown only when the topmost visible message is not the first of its date
     * group — i.e. exactly when the group's own separator is above the fold, so
     * the reader never sees the same date twice.
     */
    const updateStickyDate = useCallback(() => {
      const pill = stickyDateRef.current;
      const scroller = scrollerRef.current;
      if (!pill || !scroller) return;

      const rows = rowsRef.current;
      const messages = messagesRef.current;
      const index = indexByKeyRef.current;
      const scrollTop = readContainerScrollTop(scroller);
      const at = findTopVisibleRowIndex(rows, scrollTop);

      let label: string | null = null;
      let isInsideGroup = false;

      if (at >= 0) {
        const message = messageAt(rows[at], index, messages);
        if (message) {
          label = getDateSeparator(null, message);
          // Walk back over the rows of the same day: if there are any, this date
          // group's own separator is already above the viewport.
          for (let back = at - 1; back >= 0; back -= 1) {
            const previous = messageAt(rows[back], index, messages);
            if (!previous) break;
            if (getDateSeparator(previous, message) !== null) break;
            isInsideGroup = true;
            break;
          }
        }
      }

      const shouldShow = Boolean(label) && isInsideGroup;
      if (label && label !== lastStickyDateRef.current) {
        lastStickyDateRef.current = label;
        pill.textContent = label;
      }
      if (shouldShow !== pill.classList.contains("is-visible")) {
        pill.classList.toggle("is-visible", shouldShow);
      }
    }, []);

    // ── Scroll pass ────────────────────────────────────────────────────
    const handleScroll = useCallback(() => {
      if (justWrotePositionRef.current) {
        justWrotePositionRef.current = false;
        return;
      }
      const scroller = scrollerRef.current;
      // A glide owns the position for its duration; its per-frame writes are no
      // more "the reader scrolling" than the echo above.
      if (scroller && isAnimatingScroll(scroller)) return;

      coastingRef.current = true;
      noteGestureStart();
      armRest();
      if (scrollRafRef.current !== null) return;
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = null;
        perfMark(PERF_SCROLL_PASS_START);
        const scroller = scrollerRef.current;
        if (!scroller) return;
        bestPositionRef.current = readContainerScrollTop(scroller);
        updateFollowing();
        syncBottomSnap();
        markScrolling();
        updateStickyDate();
        prefetchOlder();
        perfMeasure("gomo6:scroll-pass-ms", PERF_SCROLL_PASS_START);
      });
    }, [armRest, updateFollowing, syncBottomSnap, markScrolling, updateStickyDate, prefetchOlder]);

    // ── Pointer/touch gate ─────────────────────────────────────────────
    // A release can happen outside the list (a flick that ends off-screen), so
    // the clearing listeners live on the window. Lifting the finger also arms
    // the rest, so the work the gate deferred happens right away.
    const markPointerDown = useCallback(() => {
      // Only the mount gate: a finger on the list is not yet a scroll gesture,
      // and a tap on the "to the newest message" button must not be counted as
      // one (its glide writes on purpose, see the counters' contract).
      pointerDownRef.current = true;
      // Telegram cancels a glide a new focus supersedes; the reader touching the
      // list is the strongest version of that — the position is theirs again.
      const scroller = scrollerRef.current;
      if (scroller) cancelScrollAnimation(scroller);
    }, []);
    const clearPointerDown = useCallback(() => {
      if (!pointerDownRef.current) return;
      pointerDownRef.current = false;
      armRest();
    }, [armRest]);

    useEffect(() => {
      // `window` is the mounted-window state in this component, so the global is
      // addressed explicitly.
      const target = globalThis;
      target.addEventListener("pointerup", clearPointerDown, true);
      target.addEventListener("pointercancel", clearPointerDown, true);
      target.addEventListener("touchend", clearPointerDown, true);
      target.addEventListener("touchcancel", clearPointerDown, true);
      return () => {
        target.removeEventListener("pointerup", clearPointerDown, true);
        target.removeEventListener("pointercancel", clearPointerDown, true);
        target.removeEventListener("touchend", clearPointerDown, true);
        target.removeEventListener("touchcancel", clearPointerDown, true);
      };
    }, [clearPointerDown]);

    // ── History triggers ───────────────────────────────────────────────
    // Two 1px sentinels arm the slide into a new page. They only *request*: the
    // mount happens in a commit (or at a verified rest), so a trigger firing
    // mid-coast can never move the reader.
    const hasMessages = messages.length > 0;
    useEffect(() => {
      const scroller = scrollerRef.current;
      const top = topSentinelRef.current;
      const bottom = bottomSentinelRef.current;
      if (!scroller || typeof IntersectionObserver === "undefined" || (!top && !bottom)) return;

      const topObserver = top
        ? new IntersectionObserver(
            (entries) => {
              if (replacingHistoryRef.current) return;
              if (!entries.some((entry) => entry.isIntersecting)) return;
              expandOlderNow();
            },
            { root: scroller, rootMargin: `${HISTORY_TRIGGER_MARGIN}px 0px 0px 0px` },
          )
        : null;
      const bottomObserver = bottom
        ? new IntersectionObserver(
            (entries) => {
              if (replacingHistoryRef.current) return;
              if (!entries.some((entry) => entry.isIntersecting)) return;
              if (followingRef.current) return;
              enlargeWindow("bottom");
            },
            { root: scroller, rootMargin: `0px 0px ${HISTORY_TRIGGER_MARGIN}px 0px` },
          )
        : null;

      if (topObserver && top) topObserver.observe(top);
      if (bottomObserver && bottom) bottomObserver.observe(bottom);
      return () => {
        topObserver?.disconnect();
        bottomObserver?.disconnect();
      };
    }, [expandOlderNow, enlargeWindow, hasMessages]);

    // ── Unread counter for arrivals below a frozen window ──────────────
    const tail = messages.length > 0 ? messages[messages.length - 1] : null;
    const tailKey = tail ? messageKey(tail) : null;
    const prevLenRef = useRef(messages.length);
    const prevTailKeyRef = useRef<string | null>(tailKey);
    useEffect(() => {
      const prevLen = prevLenRef.current;
      const prevTail = prevTailKeyRef.current;
      prevLenRef.current = messages.length;
      prevTailKeyRef.current = tailKey;
      // Only a NEW TAIL counts: a prepended page also grows the array but the
      // tail key is untouched. The delta is captured eagerly — a lazy updater
      // would read the ref after it has already been advanced.
      if (prevTail !== null && tailKey !== prevTail && messages.length > prevLen && !followingRef.current) {
        setUnread((count) => count + (messages.length - prevLen));
      }
    }, [messages, tailKey]);

    // ── The single writer ──────────────────────────────────────────────
    // One commit, one decision, one `scrollTop` write — inside one forced reflow
    // so the read and the write never interleave with anything else.
    useLayoutEffect(() => {
      const scroller = scrollerRef.current;
      if (!scroller) return;

      const rows = collectRows(scroller);
      rowsRef.current = rows;
      const previous = prevCommitRef.current;
      const isFirstCommit = !didInitialPositionRef.current;
      const pendingJump = pendingJumpRef.current;
      const restore = initial.restore;
      // Consumed unconditionally: an explicit "to the bottom" from the same
      // commit as a new arrival is served by the arrival glide below.
      const pendingBottomGlide = pendingBottomGlideRef.current;
      pendingBottomGlideRef.current = false;

      const commitStartedAt = performance.now();
      perfMark(PERF_COMMIT_START);

      requestForcedReflow(() => {
        perfMark(PERF_COMMIT_READ);
        const scrollTop = readContainerScrollTop(scroller);
        const scrollHeight = scroller.scrollHeight;
        const clientHeight = scroller.clientHeight;
        const containerTop = scroller.getBoundingClientRect().top;
        const bottomOffset = scrollHeight - scrollTop;

        // `scrollHeight - scrollTop` grew by exactly what was added below while
        // the reader did not move, so comparing it against the PREVIOUS viewport
        // height judges the reader's position as it was before this commit —
        // with no stored `scrollTop`, and therefore never stale after the reader
        // scrolled in between.
        const wasAtBottom = previous !== null
          && bottomOffset - previous.clientHeight <= AT_BOTTOM_THRESHOLD;
        const isAtBottomNow = bottomOffset - clientHeight <= AT_BOTTOM_THRESHOLD;
        const tailMoved = previous !== null && tailKey !== previous.tailKey;

        // The reader's anchor: a row whose scroll coordinate (content offset of
        // its top) is invariant under scrolling, so the delta it moved by IS the
        // layout change above the reader's place.
        //
        // Deliberately NOT the very first visible row: that one may change
        // height when older messages are mounted (a date separator moves to an
        // older message, a grouped bubble loses its header). Anchoring one row
        // lower keeps the reader immune to that — the same reason Telegram Web
        // anchors on `preservedItemElements[1]`.
        let firstVisible = -1;
        for (let at = 0; at < rows.length; at += 1) {
          if (rows[at].offsetTop + rows[at].offsetHeight > scrollTop + 1) {
            firstVisible = at;
            break;
          }
        }
        const anchorRow = firstVisible >= 0 ? rows[Math.min(firstVisible + 1, rows.length - 1)] : null;
        const anchorKey = anchorRow?.dataset.messageKey ?? null;
        const anchor = anchorKey
          ? { key: anchorKey, coord: anchorRow.getBoundingClientRect().top - containerTop + scrollTop }
          : null;

        const nextCommit = {
          anchorKey: anchor?.key ?? null,
          anchorCoord: anchor?.coord ?? 0,
          containerTop,
          clientHeight,
          tailKey,
          sliceStart: derived.start,
          sliceEnd: derived.end,
        };

        let nextScrollTop: number | null = null;
        let pin = false;
        let glideTarget: HTMLElement | null = null;
        let glidePosition: ScrollPosition = "end";
        let glideMargin = 0;
        let glideMaxDistance: number | undefined;
        let glideDirection: ScrollDirection | undefined;

        if (isFirstCommit) {
          didInitialPositionRef.current = true;
          const row = restore ? findRowByKey(rows, restore.key) : null;
          if (row && restore) {
            nextScrollTop = Math.max(0, row.offsetTop - restore.offset);
            // Not at the newest message: the state has to agree with the ref, or
            // the "to the newest" button would not be offered until the reader
            // scrolls (which is exactly the state they are already in).
            followingRef.current = false;
            setFollowing(false);
          } else {
            // Where the unread messages begin is a better place to open than the
            // bottom: the reader sees what is new, and the newest messages are
            // one FAB press away (Telegram opens at the first unread).
            const divider = scroller.querySelector<HTMLElement>(".chat-unread-divider");
            if (divider) {
              nextScrollTop = Math.max(0, divider.offsetTop - UNREAD_DIVIDER_TOP);
              followingRef.current = false;
              setFollowing(false);
            } else {
              pin = true;
            }
          }
        } else if (pendingJump) {
          const row = findRowById(rows, pendingJump.id);
          if (row) {
            pendingJumpRef.current = null;
            if (isAtBottomNow && row === rows[rows.length - 1]) pin = true;
            else {
              // `centerOrTop`: centre a target that fits the viewport, align a
              // taller one to the top — Telegram Web's default for a focus.
              glideTarget = row;
              glidePosition = "centerOrTop";
              glideMargin = FOCUS_MARGIN;
            }
            flashMessage(pendingJump.id);
          }
        } else if (isAnimatingScroll(scroller)) {
          // A glide owns the position for its duration. A commit that lands in
          // the middle of it (a message arrived, a row resized) must not fight
          // it for the position — it retargets it, so the glide still lands
          // where it was aiming (Telegram Web: `restartCurrentScrollAnimation`).
          restartCurrentScrollAnimation(scroller);
        } else if (tailMoved && followingRef.current) {
          // The reader is following the tail and it moved: glide the arrival in.
          // The trigger after the content is the target, so the glide lands on
          // the real bottom (the row's own end leaves the sentinels below it).
          if (pinnedTailRef.current !== tailKey) {
            pinnedTailRef.current = tailKey;
            glideTarget = bottomTriggerRef.current ?? (rows.length > 0 ? rows[rows.length - 1] : null);
          }
          followingFreezeUntilRef.current = Date.now() + FOLLOWING_FREEZE_MS;
          // …and mark what actually arrived, so CSS can bring it in. Only the
          // rows appended since the previous commit: rows mounted by a window
          // slide are not new messages and must not animate (Telegram's
          // `is-just-added` vs a plain mount).
          if (previous?.tailKey) {
            const from = indexByKeyRef.current.get(previous.tailKey);
            if (from !== undefined) {
              for (let at = from + 1; at < messages.length; at += 1) {
                const row = findRowByKey(rows, messageKey(messages[at]));
                row?.setAttribute("data-just-added", "true");
              }
              // Cleared on the next mutation pass: the attribute belongs to this
              // arrival only, and a row must be able to animate again if it is
              // ever re-mounted.
              requestMutation(() => {
                scroller
                  .querySelectorAll('[data-just-added="true"]')
                  .forEach((node) => node.removeAttribute("data-just-added"));
              });
            }
          }
        } else if (pendingBottomGlide) {
          // Telegram Web's scroll-to-bottom button: cover everything the reader
          // cannot see at once, then glide the last stretch down.
          if (bottomTriggerRef.current) {
            glideTarget = bottomTriggerRef.current;
            glideMaxDistance = BOTTOM_FOCUS_DISTANCE;
            glideDirection = "down";
            glideMargin = 0;
          } else {
            pin = true;
          }
        } else if (wasAtBottom) {
          if (!isAtBottomNow || tailMoved) pin = true;
        } else if (previous?.anchorKey && anchor) {
          const previousRow = findRowByKey(rows, previous.anchorKey);
          if (previousRow) {
            const coord = previousRow.getBoundingClientRect().top - containerTop + scrollTop;
            const growth = coord - previous.anchorCoord;
            const topDelta = containerTop - previous.containerTop;

            // Where the engine anchors scroll for us, content inserted or grown
            // ABOVE the viewport already moved `scrollTop` by exactly `growth`,
            // and writing it again would throw the reader a full growth further
            // down. (With anchoring: the anchor's rect stays put while
            // `scrollTop` grows by the inserted height, so the coordinate delta
            // IS the growth — measured, not assumed.) Without anchoring the
            // write is the compensation. A container whose top edge moved is
            // never the engine's business, so that part is always ours.
            const contentCompensation = hasScrollAnchoring() ? 0 : growth;
            const target = scrollTop + contentCompensation - topDelta;
            if (Math.abs(target - scrollTop) > 0.5) nextScrollTop = target;
          }
        }

        const mutation = glideTarget
          ? animateScroll({
              container: scroller,
              element: glideTarget,
              position: glidePosition,
              margin: glideMargin,
              maxDistance: glideMaxDistance,
              forceDirection: glideDirection,
              shouldReturnMutationFn: true,
            }) ?? null
          : null;

        const wrotePosition = Boolean(mutation) || pin || nextScrollTop !== null;

        return () => {
          if (mutation) {
            noteScrollTopWrite("glide");
            mutation();
          } else if (pin) {
            noteScrollTopWrite("pin");
            pinToBottom(scroller);
          } else if (nextScrollTop !== null) {
            noteScrollTopWrite(isFirstCommit ? "initial" : "anchor");
            setScrollTop(scroller, nextScrollTop);
          }
          if (wrotePosition) {
            justWrotePositionRef.current = true;
            requestMeasure(() => {
              justWrotePositionRef.current = false;
            });
          }
          // The chrome (snap state, floating date, the position bookkeeping) has
          // to *read* the geometry it decides from, and this is the mutation
          // phase — so the reads are declared. Without this the strict pass
          // reports them, and rightly so: an undeclared read here forces the
          // synchronous reflow the batched pass exists to avoid.
          forceMeasure(() => {
            // "Is the reader at the bottom" is a property of the new position.
            syncBottomSnap();
            // The date is part of the chrome too: a commit can move the reader
            // (a jump, a send) without a scroll event to recompute it.
            updateStickyDate();
            bestPositionRef.current = readContainerScrollTop(scroller);
            prevCommitRef.current = {
              ...nextCommit,
              bottomOffset: scroller.scrollHeight - bestPositionRef.current,
            };
          });
          // The restore has landed; triggers may fire again.
          requestMeasure(() => {
            replacingHistoryRef.current = false;
          });
          if (previous) {
            noteMountedRows(
              Math.max(0, previous.sliceStart - derived.start) + Math.max(0, derived.end - previous.sliceEnd),
              Math.max(0, derived.start - previous.sliceStart) + Math.max(0, previous.sliceEnd - derived.end),
              derived.end - derived.start,
            );
          } else {
            noteMountedRows(derived.end - derived.start, 0, derived.end - derived.start);
          }
          noteCommitDuration(performance.now() - commitStartedAt);
          logCommitTiming(
            perfMeasure("gomo6:commit:read-ms", PERF_COMMIT_START),
            perfMeasure("gomo6:commit:write-ms", PERF_COMMIT_READ),
          );
        };
      });

      // Read receipts and the mounts a gesture deferred land at the verified
      // rest, never during the commit itself.
      armRest();
    }, [
      messages,
      derived.start,
      derived.end,
      tailKey,
      following,
      initial.restore,
      flashMessage,
      syncBottomSnap,
      updateStickyDate,
      armRest,
    ]);

    // ── Jump to a message (pinned banner, quoted reply) ────────────────
    useLayoutEffect(() => {
      const pending = pendingJumpRef.current;
      if (!pending) return;
      const list = messagesRef.current;
      const at = list.findIndex((message) => message.id === pending.id);

      if (at < 0) {
        if (
          hasMoreRef.current &&
          !loadingMoreRef.current &&
          pending.attempts < MAX_JUMP_PAGES &&
          conversationIdRef.current
        ) {
          pending.attempts += 1;
          void loadMoreMessages(conversationIdRef.current);
          return;
        }
        pendingJumpRef.current = null;
        return;
      }

      // Mount the target before the glide: the writer above can only glide to a
      // row that is in the DOM. A window that already covers it is left alone.
      if (at >= derived.start && at < derived.end) return;
      const next: KeyWindow = {
        first: messageKey(list[Math.max(0, at - ANCHOR_BEFORE)]),
        last: messageKey(list[Math.min(list.length - 1, at + ANCHOR_AFTER)]),
      };
      setWindow((current) => (sameKeyWindow(current, next) ? current : next));
      setJumpNonce((nonce) => nonce + 1);
    }, [jumpNonce, messages, derived.start, derived.end, loadMoreMessages]);

    // ── Chrome: a size change no commit covers ─────────────────────────
    /**
     * The scroller's own box can change without a single message changing: the
     * pinned banner appears above the messages (pushing the content down), the
     * composer grows a line, the mobile keyboard opens, the window is resized.
     * None of those produce a commit *in this component*, so the writer above
     * never sees them — and the browser keeps `scrollTop` on its own, which
     * moves the reader.
     *
     * This is the only second writer, and it is deliberately narrow: it runs on
     * a `ResizeObserver` of the scroller, uses the same "the reader was glued"
     * derivation as the commit path, and records what it did in `prevCommitRef`
     * so the next commit's arithmetic stays coherent. Telegram Web has the same
     * split (the panes/player hooks compensate the top reserve).
     */
    const syncChrome = useCallback(() => {
      const scroller = scrollerRef.current;
      const previous = prevCommitRef.current;
      if (!scroller || !previous) return;

      const clientHeight = scroller.clientHeight;
      const containerTop = scroller.getBoundingClientRect().top;
      const scrollTop = readContainerScrollTop(scroller);
      const wasGlued = previous.bottomOffset - previous.clientHeight <= AT_BOTTOM_THRESHOLD;

      let wrote = false;
      if (followingRef.current && wasGlued) {
        noteScrollTopWrite("chrome:pin");
        pinToBottom(scroller);
        wrote = true;
      } else {
        // A container that grew downward does not move the content; one whose
        // top edge moved down (a banner) does — by exactly that delta.
        const topDelta = containerTop - previous.containerTop;
        if (Math.abs(topDelta) > 0.5) {
          noteScrollTopWrite("chrome:top");
          setScrollTop(scroller, scrollTop - topDelta);
          wrote = true;
        }
      }

      prevCommitRef.current = {
        ...previous,
        clientHeight,
        containerTop,
        bottomOffset: scroller.scrollHeight - readContainerScrollTop(scroller),
      };
      if (wrote) {
        justWrotePositionRef.current = true;
        requestMeasure(() => {
          justWrotePositionRef.current = false;
        });
      }
      requestMeasure(() => syncBottomSnap());
    }, [syncBottomSnap]);

    useEffect(() => {
      const scroller = scrollerRef.current;
      if (!scroller || typeof ResizeObserver === "undefined") return;
      const observer = new ResizeObserver(() => syncChrome());
      observer.observe(scroller);
      return () => observer.disconnect();
    }, [hasMessages, syncChrome]);

    // ── Session anchor: persist the reader's place on unmount ──────────
    useEffect(() => {
      // Captured at mount: by the time the cleanup runs React may have already
      // detached the refs it owns.
      const scroller = scrollerRef.current;
      return () => {
        if (!conversationId || !scroller) return;
        if (followingRef.current) {
          clearMessageScrollAnchor(conversationId);
          return;
        }
        const scrollTop = readContainerScrollTop(scroller);
        for (const row of rowsRef.current) {
          if (row.offsetTop + row.offsetHeight <= scrollTop + 1) continue;
          const key = row.dataset.messageKey;
          if (!key) continue;
          writeMessageScrollAnchor(conversationId, { key, offset: Math.max(0, row.offsetTop - scrollTop) });
          return;
        }
      };
    }, [conversationId]);

    // ── Timer/listener cleanup ─────────────────────────────────────────
    useEffect(() => {
      return () => {
        if (restTimerRef.current !== null) clearTimeout(restTimerRef.current);
        if (flashTimerRef.current !== null) clearTimeout(flashTimerRef.current);
        if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
        if (scrollingFlagTimerRef.current !== null) clearTimeout(scrollingFlagTimerRef.current);
        document.body.classList.remove(SCROLLING_CLASS);
      };
    }, []);

    // ── Imperative API (ChatView) ──────────────────────────────────────
    const jumpToLatest = useCallback(() => {
      const list = messagesRef.current;
      if (list.length === 0) return;
      // A deliberate jump deserves the same confirmation as a tap on a button.
      hapticTick(10);
      followingRef.current = true;
      setFollowing(true);
      setUnread(0);
      pendingJumpRef.current = null;
      pinnedTailRef.current = null;
      pendingBottomGlideRef.current = true;
      // A glide across thousands of pixels reads as a hang: the window is
      // re-seeded to the newest rows and the position lands in one frame.
      setWindow(tailKeyWindow(list, RESET_WINDOW));
    }, []);

    const jumpToMessage = useCallback((messageId: string) => {
      const list = messagesRef.current;
      followingRef.current = false;
      setFollowing(false);
      pinnedTailRef.current = null;
      const at = list.findIndex((message) => message.id === messageId);
      if (at >= 0) {
        const next: KeyWindow = {
          first: messageKey(list[Math.max(0, at - ANCHOR_BEFORE)]),
          last: messageKey(list[Math.min(list.length - 1, at + ANCHOR_AFTER)]),
        };
        setWindow((current) => (sameKeyWindow(current, next) ? current : next));
        pendingJumpRef.current = { id: messageId, attempts: 0 };
      } else if (conversationIdRef.current) {
        pendingJumpRef.current = { id: messageId, attempts: 1 };
        void loadMoreMessages(conversationIdRef.current);
      }
      setJumpNonce((nonce) => nonce + 1);
    }, [loadMoreMessages]);

    useImperativeHandle(
      ref,
      () => ({ scrollToBottom: jumpToLatest, scrollToMessage: jumpToMessage }),
      [jumpToLatest, jumpToMessage],
    );

    // ── Render ─────────────────────────────────────────────────────────
    const rows: ReactNode[] = [];
    for (let at = derived.start; at < derived.end; at += 1) {
      const message = messages[at];
      if (!message) continue;

      if (at === unreadIndex) {
        // Not a `.message-item`: the anchor and the read-line search must never
        // treat this marker as a message row.
        rows.push(
          <div key="unread-divider" className="chat-unread-divider" aria-hidden="true">
            <span>Непрочитанные сообщения</span>
          </div>,
        );
      }
      const prev = at > 0 ? messages[at - 1] : null;
      rows.push(
        <MessageItem
          key={messageKey(message)}
          message={message}
          prev={prev}
          flash={flashId === message.id}
          renderVersion={renderVersion}
          render={renderMessage}
          extras={{
            dateLabel: getDateSeparator(prev, message),
            isConsecutive: isConsecutive(prev, message),
            quoted:
              message.parent_message_id != null
                ? messageById.get(message.parent_message_id) ?? null
                : null,
            peerReceipt: peerReceiptByMessage.get(message.id) ?? null,
          }}
        />,
      );
    }

    if (messages.length === 0) return null;

    return (
      // The pointer handlers are passive observers that open/close the "a
      // finger is on the list" gate — they never take over the gesture and the
      // wrapper is not an interactive control.
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions
      <div
        className="message-scroll-wrap"
        onPointerDown={markPointerDown}
        onTouchStart={markPointerDown}
        onMouseDown={markPointerDown}
      >
        {/* The date of the group the reader is inside, floating over the top of
            the list while the separator that carries it has scrolled past. Filled
            from the scroll pass with a direct DOM write: no React work per frame,
            and no part in the scroll math (absolute, outside the scroller). */}
        <div ref={stickyDateRef} className="chat-sticky-date" aria-hidden="true" />

        {/* Loader floats over the list — it must not take part in the scroll
            math, and it is explicitly excluded from scroll anchoring. */}
        {isLoadingMore && hasMoreMessages && (
          <div className="msg-history-loader" aria-hidden="true">
            <span className="msg-history-loader-spinner" />
            <span>Загружаем историю…</span>
          </div>
        )}

        <div
          ref={scrollerRef}
          className="message-scroll"
          role="log"
          aria-label="Сообщения"
          // role="log" implies a polite live region. Rows mount/unmount as the
          // window slides, which would make a screen reader re-read the whole
          // history; new messages are announced through the status region below.
          aria-live="off"
          onScroll={handleScroll}
        >
          <div className="message-list">
            {/* The sentinels arm the slide into a new page; the bottom trigger
                is the scroll-snap target "at the bottom" clings to. None of them
                may ever be picked as a scroll anchor. */}
            <div ref={topSentinelRef} className="chat-scroll-sentinel scroll-sentinel-top" aria-hidden="true" />
            {rows}
            <div ref={bottomSentinelRef} className="chat-scroll-sentinel scroll-sentinel-bottom" aria-hidden="true" />
            <div ref={bottomTriggerRef} className="fab-trigger" aria-hidden="true" />
          </div>
        </div>

        {!following && (
          <button
            type="button"
            className={`scroll-to-bottom-btn${unread > 0 ? " has-new" : ""}`}
            onClick={jumpToLatest}
            aria-label={
              unread > 0
                ? `Новые сообщения: ${unread}. Перейти к последним`
                : "Перейти к последним сообщениям"
            }
          >
            {unread > 0 && (
              <span className="scroll-to-bottom-badge" aria-hidden="true">{unread}</span>
            )}
            <ChevronDown size={16} aria-hidden="true" />
          </button>
        )}

        {DevScrollOverlay && isScrollDiagnosticsEnabled() && (
          <Suspense fallback={null}>
            <DevScrollOverlay />
          </Suspense>
        )}

        {/* Announcements are throttled to the pill's own state so scrolling
            never replays the history. */}
        <div className="sr-only" role="status" aria-live="polite">
          {!following && unread > 0
            ? `${unread} ${unread === 1 ? "новое сообщение" : "новых сообщений"}`
            : ""}
        </div>
      </div>
    );
  }),
);
