import {
  memo,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown } from "lucide-react";
import { useMessengerStore, queueMarkRead } from "@/stores/messengerStore";
import type { MessageView } from "./types";
import { isConsecutive, getDateSeparator } from "./messageListUtils";
import { getAttachmentAspectRatio } from "./attachmentMedia";
import {
  HISTORY_HEADER_HEIGHT,
  captureAnchor,
  virtualContentHeight,
  type ScrollAnchor,
} from "./core/scrollEngine";
import { isScrollDebugEnabled, scrollDebugNote, startScrollDebug } from "./core/scrollDebug";
import {
  clearScrollPosition,
  getScrollPosition,
  saveScrollPosition,
  type SavedScrollPosition,
} from "./scrollPosition";

// ── List-local constants ──────────────────────────────────────────────────
// Layout geometry lives in ./core/scrollEngine; the scroll physics (bottom pin,
// live anchor, prepend stability) live in @tanstack/react-virtual's chat mode.
const TOP_LOAD_ZONE = 300;        // px from the top that arms the history loader
const LOAD_MORE_COOLDOWN_MS = 800; // min gap between history loads (a load shifts scrollTop)
const OVERSCAN = 12;              // items rendered beyond the viewport (ТЗ: 8–15)
const NEW_MESSAGE_ANIMATION_MS = 1200; // how long an incoming message may play its entrance
// How close to the bottom still counts as "at the bottom" for the pin and the
// "N new messages" pill (Telegram-ish: a message or two of slack).
const SCROLL_END_THRESHOLD = 80;

// Extra heights (kept in sync with messenger.css) that sit INSIDE a virtual
// item but are invisible to a content-only estimate. Without them every
// message with a date separator / sender name / quote / link preview is
// underestimated and gets corrected by measureElement while the user scrolls,
// which shifts the layout mid-gesture.
const DATE_SEPARATOR_HEIGHT = 34;  // .date-separator — margin 12/6 + line
const SENDER_NAME_HEIGHT = 18;     // .msg-sender-name — group chats, first of author
const QUOTED_MESSAGE_HEIGHT = 34;  // .quoted-message — padding 6/6 + line + mb
const LINK_PREVIEW_HEIGHT = 60;    // .msg-link-panel — loading (40) to loaded (~90)
const ROW_GAP_HEIGHT = 8;          // .bubble-row padding-bottom — gap between messages

export interface MessageRenderExtras {
  dateLabel: string | null;
  isConsecutive: boolean;
  isNew: boolean;
}

export interface MessageListHandle {
  scrollToBottom: () => void;
  scrollToMessage: (messageId: string) => void;
}

interface MessageListProps {
  renderMessage: (message: MessageView, prev: MessageView | null, extras: MessageRenderExtras) => ReactNode;
  /** Notes self-chat: a filtered view of the store messages (folder filter).
   *  When omitted the full store list is used. */
  messagesOverride?: MessageView[];
}

/** The scroll anchor shape (top-most visible message + its offset above the
 *  viewport top) lives in ./core/scrollEngine and is re-used here. */

/**
 * Estimate the rendered height of a message BEFORE it is measured, so virtual
 * offsets don't drift when items are prepended or scrolled into view.
 *  - Media bubbles: the reserved box size is derived from the attachment
 *    aspect ratio (same math as getAttachmentDisplayStyle), so the estimate
 *    matches the real height almost exactly — images never reflow the list.
 *  - Text bubbles: one line ≈ 21px + bubble chrome; a rough char-per-line
 *    count keeps the estimate within a line or two of the measured height.
 */
/**
 * Estimate how many wrapped lines a message's text occupies: each explicit
 * newline starts a new line, and each segment wraps at ~55 chars. Ignoring
 * newlines (the old chars/55 estimate) badly under-estimated multi-line
 * messages, and every under-estimate is a visible correction when history is
 * prepended.
 */
function estimateTextLines(text: string): number {
  if (!text) return 1;
  return text
    .split("\n")
    .reduce((count, segment) => count + Math.max(1, Math.ceil(segment.length / 55)), 0);
}

function estimateMessageHeight(
  message: MessageView | undefined,
  prev: MessageView | null = null,
  isGroup = false,
): number {
  if (!message) return 72 + ROW_GAP_HEIGHT;
  // Shared-post cards (__SHARE__ token) have a deterministic layout: clamped
  // text lines + a fixed 16:9 thumbnail block. Estimate the full-card height
  // upfront so the virtualizer never reflows when the entity resolves; the
  // measured height matches within a few px (or the anchor correction absorbs
  // the difference when the post has no image).
  if (message.content?.startsWith("__SHARE__")) return 430 + ROW_GAP_HEIGHT;
  // Gift cards render a fixed standalone card.
  if (message.content?.startsWith("__GIFT__")) return 190 + ROW_GAP_HEIGHT;

  // Elements above the bubble that the content estimate cannot see. Kept in
  // sync with renderMessage: the date separator shows on the first message of
  // a day (and the very first of the list), the group sender name on the first
  // message of each author, the quote strip whenever parent_message_id is set.
  let extra = 0;
  if (prev == null || new Date(prev.sent_at).toDateString() !== new Date(message.sent_at).toDateString()) {
    extra += DATE_SEPARATOR_HEIGHT;
  }
  if (isGroup && (prev == null || prev.sender_user_id !== message.sender_user_id)) {
    extra += SENDER_NAME_HEIGHT;
  }
  if (message.parent_message_id) extra += QUOTED_MESSAGE_HEIGHT;
  if (/https?:\/\//.test(message.content ?? "")) extra += LINK_PREVIEW_HEIGHT;

  const visual = message.attachments?.filter((a) => a.type === "image" || a.type === "video") ?? [];
  const onlyMedia = visual.length > 0 && (message.attachments?.length ?? 0) === visual.length;
  if (onlyMedia) {
    const ratio = getAttachmentAspectRatio(visual[0]);
    if (Number.isFinite(ratio) && ratio > 0) {
      // getAttachmentDisplayStyle: boxWidth = min(420, 480 * ratio).
      const boxWidth = Math.min(420, 480 * ratio);
      const boxHeight = Math.round(boxWidth / ratio);
      const captionLines = message.content?.trim() ? estimateTextLines(message.content) : 0;
      return extra + 14 + boxHeight + captionLines * 21 + ROW_GAP_HEIGHT;
    }
  }
  const lines = estimateTextLines(message.content ?? "");
  return extra + 18 + lines * 21 + ROW_GAP_HEIGHT;
}

/**
 * Owns the virtualized message list for the open conversation (@tanstack/react-virtual).
 *
 * The list is plain top-anchored content: index 0 = oldest message at the top,
 * the newest message at the bottom. All chat behavior is explicit and
 * deterministic — nothing fights the scroller:
 *
 *  - **Bottom pin** — while the user is at the bottom, every layout change
 *    (append, image load, measurement correction, keyboard open/close)
 *    re-clamps scrollTop to the real bottom in the same frame.
 *
 *  - **Anchor stabilization** — the instant the user scrolls up, the message
 *    at the top of the viewport (plus its pixel offset) is captured as the
 *    "anchor". From then on every layout change re-derives the scrollTop that
 *    keeps that exact message at that exact offset. Prepending older history,
 *    estimate→measured corrections, image loads — none of them move the
 *    visible content, because the anchor is restored in the same frame before
 *    paint. This is what makes history loading feel native: you keep reading,
 *    messages appear *above* the fold, nothing twitches.
 *
 *  - **History loader** — a scroll zone near the top + an in-flight guard +
 *    a cooldown fire `loadMoreMessages`.
 *
 *  - **Session restore** — returning to a chat restores the saved anchor
 *    (message id + viewport offset), auto-loading history until the anchor is
 *    present; the anchor releases as soon as the user scrolls away from it.
 *
 *  - **Live arrivals** — animate only while the user is at the bottom; scrolled
 *    up they count toward the "N new messages" pill instead.
 *
 * It is mounted per conversation (`key={conversation.id}` in ChatView), so all
 * refs/state below reset naturally when switching chats — the scroll anchor is
 * the only thing that survives (the session-scoped scrollPosition module).
 */
export const MessageList = memo(
  forwardRef<MessageListHandle, MessageListProps>(function MessageList({ renderMessage, messagesOverride }, ref) {
    const conversationId = useMessengerStore((s) => s.selectedConversationId);
    const meId = useMessengerStore((s) => s.me?.id);
    const storeMessages = useMessengerStore((s) => s.messages);
    // Notes self-chat passes a folder-filtered view; regular chats use the full list.
    const messages = messagesOverride ?? storeMessages;
    const isGroupConversation = useMessengerStore(
      (s) => s.conversations.find((c) => c.id === s.selectedConversationId)?.is_group ?? false,
    );
    const hasMoreMessages = useMessengerStore((s) => s.hasMoreMessages);
    const isLoadingMore = useMessengerStore((s) => s.isLoadingMore);
    const loadMoreMessages = useMessengerStore((s) => s.loadMoreMessages);
    // Keeping the composer visible over the soft keyboard is the shell's job
    // (messenger.css): two platforms, two mechanisms —
    //  • iOS (Safari)     — the layout never resizes; the message area +
    //    composer are lifted by a compositor-only `translate` (--kb-inset), so
    //    clientHeight stays put and the bottom pin below is a no-op.
    //  • Layout-resizing (Chrome/Firefox Android with interactive-widget=
    //    resizes-content, Firefox on iOS) — the layout viewport really shrinks
    //    with the keyboard: the fixed panel rises natively (composer clears
    //    the keyboard without any translate), but the scroller's clientHeight
    //    drops while scrollTop is left untouched (the scroll range grew, so
    //    there is no browser clamp) — the newest messages fall below the
    //    composer. The bottom pin re-runs on the SCROLLER'S real resize:
    //    the virtualizer's ResizeObserver updates `scrollRect` (reactive,
    //    `maybeNotify()` → re-render), so `scrollRect.height` is the dep that
    //    re-pins the list to the new bottom. It fires from the layout itself —
    //    no visual-viewport heuristics, no platform sniffing.
    const scrollerRef = useRef<HTMLDivElement | null>(null);

    const [isAtBottom, setIsAtBottom] = useState(true);
    const [newMessageCount, setNewMessageCount] = useState(0);
    const [newMessageIds, setNewMessageIds] = useState<Set<string>>(() => new Set());

    const isAtBottomRef = useRef(true);
    const loadingMoreRef = useRef(false);
    const lastLoadAtRef = useRef(0);
    const prevLastIdRef = useRef<string | null>(null);
    // Handles for the pending entrance-animation clear timers, so unmount
    // cancels them (a late setState after React is gone would throw).
    const entranceTimersRef = useRef<Set<number>>(new Set());
    // Session restore: the position saved when the user last left this chat.
    // MessageList is keyed per conversation, so it is captured once at mount.
    const restoreAnchorRef = useRef<SavedScrollPosition | null>(
      conversationId ? getScrollPosition(conversationId) ?? null : null,
    );
    // Whether a restore was pending when the chat opened — the restore effect
    // clears restoreAnchorRef, so the open-at-bottom effect needs its own flag.
    const hadRestoreAtMountRef = useRef(restoreAnchorRef.current !== null);
    // The live anchor (top-most visible message + its offset above the viewport
    // top), kept fresh so a prepend can be compensated in the SAME commit.
    const anchorRef = useRef<ScrollAnchor | null>(null);
    // The first message's identity at the previous commit — a change means
    // older history was prepended (appends keep the first message).
    const prevFirstKeyRef = useRef<string | null>(null);

    // DEV-only on-device scroll diagnostics (opt-in via localStorage, see
    // core/scrollDebug.ts). No-op in production builds.
    useEffect(() => {
      if (!isScrollDebugEnabled()) return;
      const el = scrollerRef.current;
      if (!el) return;
      return startScrollDebug(el);
    }, []);

    // Identity key matches the store's dedup key (client_id || id), so a temp
    // message later replaced by its server twin keeps its virtual slot.
    const messageKey = useCallback((m: MessageView) => m.client_id ?? m.id, []);

    // The virtualizer only WINDOWS the list; ALL scroll position is owned by
    // this component (one mechanism, no fighting):
    //   - prepends are compensated synchronously in a layout effect (below);
    //   - the bottom is pinned by this component while the user is there;
    //   - the library's own `anchorTo: 'end'` is deliberately NOT used: its
    //     correction runs on a later commit and, on iOS, defers while a
    //     finger/momentum is active — together with our correction the two
    //     fought and produced full-page jumps (measured 2909px).
    // `scrollMargin` is the fixed history header above the rows, so the
    // virtualizer's offsets match the DOM (rows are positioned at `row.start`).
    const virtualizer = useVirtualizer({
      count: messages.length,
      getScrollElement: () => scrollerRef.current,
      estimateSize: (index) =>
        estimateMessageHeight(messages[index], messages[index - 1] ?? null, isGroupConversation),
      overscan: OVERSCAN,
      getItemKey: (index) => messageKey(messages[index]),
      scrollEndThreshold: SCROLL_END_THRESHOLD,
      scrollMargin: HISTORY_HEADER_HEIGHT,
    });

    // Apply the estimate→measured size correction for any item ABOVE the
    // viewport, in the same frame as the measurement. Two deviations from the
    // library default, both measured in the local browser harness (dev-only
    // scroll probe, see docs/wiki/MESSENGER_SCROLL_KEYBOARD_REFERENCE.md):
    //  1. the default skips corrections while scrolling backward ("items jump
    //     while scrolling up"), but that is exactly when older history is being
    //     prepended — skipping it left a visible jump (113px measured);
    //  2. the default compares `item.start` to the virtualizer's cached
    //     `scrollOffset`, which lags the DOM during a load burst and is offset
    //     by `scrollMargin` — reading the live DOM `scrollTop` and adding the
    //     margin removed the remaining drift (anchor drift 42px → 0px).
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) => {
      const offset = instance.scrollElement?.scrollTop ?? 0;
      return item.start < offset + (instance.options.scrollMargin ?? 0);
    };

    // ── Synchronous prepend compensation ─────────────────────────────────
    // The library's own end-anchoring adjusts scrollTop on a later commit and,
    // on iOS, DEFERS the write while a finger/momentum is active
    // (`applyScrollAdjustment` → `_iosDeferredAdjustment`). On the device log a
    // prepended page therefore shifted the content by its full height —
    // scrollTop jumped ~2.3–2.9k a frame after the DOM update (a visible
    // "teleport"). Compensate HERE instead: a layout effect runs in the same
    // commit as the new messages, before paint, so the shift is never shown.
    useLayoutEffect(() => {
      const el = scrollerRef.current;
      if (!el) return;
      const firstKey = messages.length > 0 ? messageKey(messages[0]) : null;
      const prevFirstKey = prevFirstKeyRef.current;
      prevFirstKeyRef.current = firstKey;

      // A changed first message (with the view scrolled up) means older history
      // was prepended. Put the anchored message back where it was.
      if (prevFirstKey !== null && firstKey !== prevFirstKey && !isAtBottomRef.current) {
        const anchor = anchorRef.current;
        // Read the anchor's position from the DOM, not the virtualizer: its
        // cached measurements lag this commit, which made the computed target
        // equal the current scrollTop (a no-op) and the shift appear a frame
        // later as a full-page jump (measured 2909px).
        const anchorEl = anchor
          ? el.querySelector<HTMLElement>(`[data-message-id="${anchor.messageId}"]`)
          : null;
        if (anchor && anchorEl) {
          const itemTop =
            anchorEl.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
          const target = itemTop - anchor.offset;
          scrollDebugNote(
            `prepend compensate itemTop=${Math.round(itemTop)} target=${Math.round(target)} st=${Math.round(el.scrollTop)}`,
          );
          if (Math.abs(el.scrollTop - target) > 1) el.scrollTop = target;
        } else {
          scrollDebugNote(`prepend NOT compensated anchor=${anchor?.messageId ?? "null"}`);
        }
      }

      // Refresh the anchor for the NEXT commit (this commit's final position).
      anchorRef.current = isAtBottomRef.current
        ? null
        : captureAnchor(virtualizer.getVirtualItems(), el.scrollTop, (index) => messages[index]?.id);
    }, [messages, virtualizer, messageKey]);

    // ── Read receipts: the "read line" (Telegram-style) ────────────────
    // The UI reports exactly ONE message per pass: the newest message fully
    // visible on screen. Everything above it was read; everything below the
    // fold stays unread. The store debounces and the backend marks the whole
    // prefix up to that message, so a scroll burst costs a single request
    // instead of one per message (per-message marking exhausted the
    // rate-limit budget and 429'd the whole app).
    const reportVisibleReads = useCallback(() => {
      const el = scrollerRef.current;
      if (!el || !conversationId || !meId) return;
      const viewportBottom = el.scrollTop + el.clientHeight;
      // Virtual items are ordered oldest → newest; the last one whose bottom
      // edge is at or above the viewport bottom is the read line.
      let readLine: MessageView | null = null;
      for (const item of virtualizer.getVirtualItems()) {
        const message = messages[item.index];
        if (!message) continue;
        if (message.sender_user_id === meId || message.is_deleted) continue;
        // `item.end` is already in scroll-element coordinates (scrollMargin).
        if (item.end <= viewportBottom) {
          readLine = message;
        } else {
          // Everything newer is even lower — stop scanning.
          break;
        }
      }
      if (readLine) queueMarkRead(conversationId, readLine.id, readLine.sent_at);
    }, [conversationId, meId, messages, virtualizer]);

    // ── Scroll: at-bottom tracking + read line + history loader ──────────
    // The scroll physics are the virtualizer's job now; here we keep only the
    // list concerns that ride on a scroll event.
    const handleScroll = useCallback(() => {
      const el = scrollerRef.current;
      if (!el) return;

      // The virtualizer reads the real DOM scroll metrics, so `isAtEnd()` is
      // the honest "the user is at the bottom" (with a little slack).
      const atBottom = virtualizer.isAtEnd();
      if (atBottom !== isAtBottomRef.current) {
        isAtBottomRef.current = atBottom;
        setIsAtBottom(atBottom);
        if (atBottom) setNewMessageCount(0);
      }

      // Keep the live anchor fresh for the synchronous prepend compensation,
      // and persist / clear the session anchor for a later return to this chat.
      const anchor = atBottom
        ? null
        : captureAnchor(virtualizer.getVirtualItems(), el.scrollTop, (index) => messages[index]?.id);
      anchorRef.current = anchor;
      if (conversationId) {
        if (atBottom) clearScrollPosition(conversationId);
        else if (anchor) saveScrollPosition(conversationId, anchor);
      }

      reportVisibleReads();

      // History loader. Never fire during iOS overscroll (negative scrollTop,
      // the log showed `loadMore start st=-52`) — that loaded a page while the
      // user was rubber-banding at the very top and shifted the content.
      const now = Date.now();
      if (
        el.scrollTop > 0 &&
        el.scrollTop <= TOP_LOAD_ZONE &&
        hasMoreMessages &&
        !isLoadingMore &&
        !loadingMoreRef.current &&
        conversationId &&
        now - lastLoadAtRef.current > LOAD_MORE_COOLDOWN_MS
      ) {
        lastLoadAtRef.current = now;
        loadingMoreRef.current = true;
        scrollDebugNote(`loadMore start st=${Math.round(el.scrollTop)}`);
        loadMoreMessages(conversationId).finally(() => {
          loadingMoreRef.current = false;
          scrollDebugNote("loadMore done");
        });
      }
    }, [
      virtualizer,
      conversationId,
      messages,
      reportVisibleReads,
      scrollerRef,
      hasMoreMessages,
      isLoadingMore,
      loadMoreMessages,
    ]);

    const totalSize = virtualizer.getTotalSize();

    // ── Bottom pin ───────────────────────────────────────────────────────
    // While the user is at the bottom, keep the newest message at the bottom
    // across appends and late measurements. This is the component's job now
    // that the library's `anchorTo: 'end'` is off.
    useLayoutEffect(() => {
      const el = scrollerRef.current;
      if (!el || !isAtBottomRef.current) return;
      const max = el.scrollHeight - el.clientHeight;
      if (Math.abs(el.scrollTop - max) > 1) el.scrollTop = max;
    }, [messages, totalSize, virtualizer.scrollRect?.height, scrollerRef]);

    // ── Report read receipts after the scroll position has settled ───────
    // handleScroll also reports on scroll events.
    useLayoutEffect(() => {
      reportVisibleReads();
    }, [totalSize, messages, virtualizer.scrollRect?.height, reportVisibleReads]);

    // ── Session restore ──────────────────────────────────────────────────
    // Returning to a chat deep in history: jump to the saved anchor once the
    // message is loaded; meanwhile keep prepending older pages (capped by
    // hasMoreMessages). Runs before the open-at-bottom effect below.
    useLayoutEffect(() => {
      const anchor = restoreAnchorRef.current;
      if (!anchor || !conversationId) return;
      const index = messages.findIndex((m) => m.id === anchor.messageId);
      if (index >= 0) {
        // Jump to the saved message. Re-apply over the next two frames: the
        // first pass can land while the spacer is still short (the virtualizer
        // has not laid the rows out yet), so scrollTop clamps to 0 and the
        // jump is lost.
        const applyRestore = () => {
          const el = scrollerRef.current;
          if (!el) return;
          const info = virtualizer.getOffsetForIndex(index, "start");
          if (info && Math.abs(el.scrollTop - info[0]) > 2) el.scrollTop = info[0];
        };
        scrollDebugNote(`restore jump index=${index} offset=${Math.round(anchor.offset)}`);
        virtualizer.scrollToIndex(index, { align: "start" });
        requestAnimationFrame(() => {
          applyRestore();
          requestAnimationFrame(applyRestore);
        });
        restoreAnchorRef.current = null;
        isAtBottomRef.current = false;
        setIsAtBottom(false);
        return;
      }
      // The anchor is not loaded yet: keep prepending older history WITHOUT
      // moving the view. Scrolling to the end here made a returning chat flash
      // the bottom before the jump (the "teleports to the bottom" bug).
      if (!hasMoreMessages) {
        // Unreachable (deleted / too deep) — give up and open at the bottom.
        restoreAnchorRef.current = null;
        virtualizer.scrollToEnd();
        return;
      }
      // A load is already in flight (this effect re-runs on every messages
      // change, and dev StrictMode double-invokes it) — wait for it instead of
      // treating it as "unreachable" and giving up.
      if (loadingMoreRef.current) return;
      loadingMoreRef.current = true;
      loadMoreMessages(conversationId).finally(() => {
        loadingMoreRef.current = false;
      });
    }, [messages, hasMoreMessages, conversationId, loadMoreMessages, virtualizer]);

    // ── Open at the bottom ───────────────────────────────────────────────
    // MessageList is keyed per conversation, so this runs once per open. A
    // pending session restore takes over instead (its effect runs first).
    useLayoutEffect(() => {
      if (hadRestoreAtMountRef.current) return;
      virtualizer.scrollToEnd();
    }, [virtualizer]);

    // ── Realtime appends → "N new messages" pill + entrance animation ───
    // Messages that arrive while the user is at the bottom are visible, so
    // they play a one-shot entrance animation; the flag is cleared shortly
    // after so scrolling away and back never replays it. While scrolled up
    // they only count toward the pill and appear without animation when the
    // user scrolls down to them (like Telegram).
    useEffect(() => {
      if (messages.length === 0) {
        prevLastIdRef.current = null;
        return;
      }
      const lastId = messages[messages.length - 1].id;
      const previousLast = prevLastIdRef.current;
      if (previousLast !== null && lastId !== previousLast) {
        const previousLastIndex = messages.findIndex((m) => m.id === previousLast);
        if (previousLastIndex >= 0) {
          const appended = messages.slice(previousLastIndex + 1);
          if (appended.length > 0) {
            if (isAtBottomRef.current) {
              const ids = appended.map((m) => m.id);
              setNewMessageIds((previous) => {
                const next = new Set(previous);
                for (const id of ids) next.add(id);
                return next;
              });
              const timerId = window.setTimeout(() => {
                entranceTimersRef.current.delete(timerId);
                setNewMessageIds((previous) => {
                  const next = new Set(previous);
                  for (const id of ids) next.delete(id);
                  return next;
                });
              }, NEW_MESSAGE_ANIMATION_MS);
              entranceTimersRef.current.add(timerId);
            } else {
              // Own optimistic messages are not counted in the pill.
              const incoming = appended.filter((m) => m.localStatus !== "sending").length;
              if (incoming > 0) setNewMessageCount((count) => count + incoming);
            }
          }
        }
      }
      prevLastIdRef.current = lastId;
    }, [messages, isAtBottomRef]);

    // Cancel any still-pending animation timers on unmount. Without this a
    // message arriving right before teardown leaves a timer that fires into a
    // torn-down environment (jsdom: window is gone) — an unhandled error that
    // fails the test run.
    useEffect(() => {
      const timers = entranceTimersRef.current;
      return () => {
        for (const id of timers) window.clearTimeout(id);
        timers.clear();
      };
    }, []);

    // ── Imperative API (send-scroll, pinned-message jump) ───────────────
    const scrollToBottom = useCallback(() => {
      // Explicitly returning to the bottom cancels any saved position.
      restoreAnchorRef.current = null;
      if (conversationId) clearScrollPosition(conversationId);
      virtualizer.scrollToEnd();
      isAtBottomRef.current = true;
      setIsAtBottom(true);
      setNewMessageCount(0);
    }, [conversationId, virtualizer]);

    const scrollToMessage = useCallback(
      (messageId: string) => {
        const index = messages.findIndex((m) => m.id === messageId);
        if (index < 0) return;
        virtualizer.scrollToIndex(index, { align: "center" });
      },
      [messages, virtualizer],
    );

    useImperativeHandle(ref, () => ({ scrollToBottom, scrollToMessage }), [scrollToBottom, scrollToMessage]);

    if (messages.length === 0) return null;

    const virtualItems = virtualizer.getVirtualItems();
    const contentHeight = virtualContentHeight(totalSize);

    return (
      <>
        <div className="message-scroll-wrap">
          <div
            ref={scrollerRef}
            className="message-scroll"
            role="log"
            aria-label="Сообщения"
            aria-live="polite"
            onScroll={handleScroll}
          >
            <div className="message-virtual-list" style={{ height: contentHeight }}>
              {/* Fixed-height box in all states (loading / idle / end) so the
                  header never shifts the items below it during prepends. */}
              <div className={`msg-history-header${isLoadingMore ? " is-loading" : ""}${hasMoreMessages ? "" : " is-end"}`}>
                {isLoadingMore ? (
                  <span className="msg-history-loader" role="status" aria-live="polite">
                    <span className="msg-history-loader-spinner" aria-hidden="true" />
                    <span>Загружаем историю…</span>
                  </span>
                ) : hasMoreMessages ? (
                  <span className="msg-history-spacer" aria-hidden="true" />
                ) : (
                  <span className="msg-history-end-label">Начало переписки</span>
                )}
              </div>

              {virtualItems.map((row) => {
                const message = messages[row.index];
                if (!message) return null;
                const prev = row.index > 0 ? messages[row.index - 1] : null;
                return (
                  <div
                    key={row.key}
                    data-index={row.index}
                    data-message-id={message.id}
                    ref={virtualizer.measureElement}
                    className="message-virtual-item"
                    // `row.start` already includes the history header (scrollMargin).
                    style={{ position: "absolute", top: row.start, left: 0, right: 0 }}
                  >
                    {renderMessage(message, prev, {
                      dateLabel: getDateSeparator(prev, message),
                      isConsecutive: isConsecutive(prev, message),
                      isNew: newMessageIds.has(message.id),
                    })}
                  </div>
                );
              })}

              {/* Real bottom gap — a list element so it participates in the
                  scroll math (scroller padding would sit below the fold). */}
              <div
                className="message-list-footer"
                aria-hidden="true"
                style={{ position: "absolute", top: HISTORY_HEADER_HEIGHT + totalSize, left: 0, right: 0 }}
              />
            </div>
          </div>
        </div>

        {!isAtBottom && (
          <button
            type="button"
            className="scroll-to-bottom-btn"
            onClick={scrollToBottom}
            aria-label={
              newMessageCount > 0
                ? `Прокрутить вниз (${newMessageCount} ${newMessageCount === 1 ? "новое" : "новых"} сообщени${newMessageCount === 1 ? "е" : "й"})`
                : "Прокрутить вниз"
            }
          >
            <ChevronDown size={20} />
            {newMessageCount > 0 && (
              <span className="scroll-to-bottom-badge">{newMessageCount > 99 ? "99+" : newMessageCount}</span>
            )}
          </button>
        )}
      </>
    );
  }),
);
