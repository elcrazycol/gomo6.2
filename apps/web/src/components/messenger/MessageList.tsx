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
import { useMobileKeyboard } from "@/hooks/useMobileKeyboard";
import type { MessageView } from "./types";
import { isConsecutive, getDateSeparator } from "./messageListUtils";
import { getAttachmentAspectRatio } from "./attachmentMedia";
import {
  getScrollPosition,
  saveScrollPosition,
  clearScrollPosition,
} from "./scrollPosition";

// ── Layout constants (kept in sync with messenger.css) ────────────────────
const HISTORY_HEADER_HEIGHT = 34; // .msg-history-header — fixed in every state
const BOTTOM_GAP_HEIGHT = 12;     // .message-list-footer — gap under the last message
const AT_BOTTOM_SLACK = 80;       // px of trailing space still treated as "at the bottom"
const TOP_LOAD_ZONE = 300;        // px from the top that arms the history loader
const OVERSCAN = 12;              // items rendered beyond the viewport (ТЗ: 8–15)
const NEW_MESSAGE_ANIMATION_MS = 1200; // how long an incoming message may play its entrance
const ANCHOR_REALIGN_EPSILON = 2; // px of drift considered "already aligned"

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

/** The anchor for a given scroll position: the top-most visible message and
 *  how far its top has been scrolled past the viewport top (positive = above). */
interface ScrollAnchor {
  messageId: string;
  offset: number;
}

/**
 * Estimate the rendered height of a message BEFORE it is measured, so virtual
 * offsets don't drift when items are prepended or scrolled into view.
 *  - Media bubbles: the reserved box size is derived from the attachment
 *    aspect ratio (same math as getAttachmentDisplayStyle), so the estimate
 *    matches the real height almost exactly — images never reflow the list.
 *  - Text bubbles: one line ≈ 21px + bubble chrome; a rough char-per-line
 *    count keeps the estimate within a line or two of the measured height.
 */
function estimateMessageHeight(message: MessageView | undefined): number {
  if (!message) return 72;
  // Shared-post cards (__SHARE__ token) have a deterministic layout: clamped
  // text lines + a fixed 16:9 thumbnail block. Estimate the full-card height
  // upfront so the virtualizer never reflows when the entity resolves; the
  // measured height matches within a few px (or the anchor correction absorbs
  // the difference when the post has no image).
  if (message.content?.startsWith("__SHARE__")) return 430;
  const visual = message.attachments?.filter((a) => a.type === "image" || a.type === "video") ?? [];
  const onlyMedia = visual.length > 0 && (message.attachments?.length ?? 0) === visual.length;
  if (onlyMedia) {
    const ratio = getAttachmentAspectRatio(visual[0]);
    if (Number.isFinite(ratio) && ratio > 0) {
      // getAttachmentDisplayStyle: boxWidth = min(420, 480 * ratio).
      const boxWidth = Math.min(420, 480 * ratio);
      const boxHeight = Math.round(boxWidth / ratio);
      const captionLines = message.content?.trim()
        ? Math.max(1, Math.ceil(message.content.length / 55))
        : 0;
      return 14 + boxHeight + captionLines * 21;
    }
  }
  const chars = message.content?.length ?? 0;
  const lines = chars === 0 ? 1 : Math.max(1, Math.ceil(chars / 55));
  return 18 + lines * 21;
}

/**
 * Capture the top-most visible message and how far its top is above the
 * viewport top. Derived from the virtualizer's measured/estimated offsets, not
 * DOM rects — this is exact for both rendered and not-yet-rendered items and
 * keeps the logic testable in jsdom (no layout engine needed).
 */
function captureAnchor(
  virtualizer: ReturnType<typeof useVirtualizer>,
  messages: MessageView[],
  scrollTop: number,
  clientHeight: number,
): ScrollAnchor | null {
  const items = virtualizer.getVirtualItems();
  for (const item of items) {
    const itemTop = HISTORY_HEADER_HEIGHT + item.start;
    const itemBottom = HISTORY_HEADER_HEIGHT + item.end;
    // Items above the viewport are skipped; the first item whose bottom is at
    // or below the top edge is the top-most visible one.
    if (itemBottom <= scrollTop) continue;
    const message = messages[item.index];
    if (!message) continue;
    return { messageId: message.id, offset: scrollTop - itemTop };
  }
  return null;
}

/** The scrollTop that places `anchor` back where it was captured. */
function anchorTarget(
  virtualizer: ReturnType<typeof useVirtualizer>,
  messages: MessageView[],
  anchor: ScrollAnchor,
): number | null {
  const index = messages.findIndex((m) => m.id === anchor.messageId);
  if (index < 0) return null;
  const offset = virtualizer.getOffsetForIndex(index);
  if (!offset) return null;
  return HISTORY_HEADER_HEIGHT + offset[0] + anchor.offset;
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
    const hasMoreMessages = useMessengerStore((s) => s.hasMoreMessages);
    const isLoadingMore = useMessengerStore((s) => s.isLoadingMore);
    const loadMoreMessages = useMessengerStore((s) => s.loadMoreMessages);
    // The mobile keyboard resizes the scroller via --app-vh; subscribing here
    // (and using the inset as a layout-effect dep) re-applies the correct
    // position when the viewport shrinks/grows — no scroll "jump" while the
    // keyboard slides in or out.
    const { keyboardInset } = useMobileKeyboard();

    const scrollerRef = useRef<HTMLDivElement | null>(null);

    const [isAtBottom, setIsAtBottom] = useState(true);
    const [newMessageCount, setNewMessageCount] = useState(0);
    const [newMessageIds, setNewMessageIds] = useState<Set<string>>(() => new Set());

    const isAtBottomRef = useRef(true);
    // The live anchor: the message at the top edge of the viewport + offset.
    // null while the user is at the bottom (the pin owns the position then).
    const anchorRef = useRef<ScrollAnchor | null>(null);
    // The session-saved anchor, captured once at mount and hunted until found.
    const restoreAnchorRef = useRef<ScrollAnchor | null>(null);
    const loadingMoreRef = useRef(false);
    const lastLoadAtRef = useRef(0);
    const prevLastIdRef = useRef<string | null>(null);

    // Identity key matches the store's dedup key (id || client_id), so a temp
    // message later replaced by its server twin keeps its virtual slot.
    const messageKey = useCallback((m: MessageView) => m.client_id ?? m.id, []);

    const virtualizer = useVirtualizer({
      count: messages.length,
      getScrollElement: () => scrollerRef.current,
      estimateSize: (index) => estimateMessageHeight(messages[index]),
      overscan: OVERSCAN,
      getItemKey: (index) => messageKey(messages[index]),
    });

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
        const itemBottom = HISTORY_HEADER_HEIGHT + item.end;
        if (itemBottom <= viewportBottom) {
          readLine = message;
        } else {
          // Everything newer is even lower — stop scanning.
          break;
        }
      }
      if (readLine) queueMarkRead(conversationId, readLine.id, readLine.sent_at);
    }, [conversationId, meId, messages, virtualizer]);

    // ── Scroll: at-bottom tracking + anchor capture + history loader ─────
    const handleScroll = useCallback(() => {
      const el = scrollerRef.current;
      if (!el) return;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM_SLACK;
      if (atBottom !== isAtBottomRef.current) {
        isAtBottomRef.current = atBottom;
        setIsAtBottom(atBottom);
        if (atBottom) setNewMessageCount(0);
      }

      if (atBottom) {
        anchorRef.current = null;
        if (conversationId) clearScrollPosition(conversationId);
      } else {
        const anchor = captureAnchor(virtualizer, messages, el.scrollTop, el.clientHeight);
        anchorRef.current = anchor;
        if (conversationId && anchor) saveScrollPosition(conversationId, anchor);
      }

      // A real user scroll releases the restore anchor — programmatic
      // corrections land exactly on the target, so they never release it.
      const restore = restoreAnchorRef.current;
      if (restore) {
        const target = anchorTarget(virtualizer, messages, restore);
        if (target !== null && Math.abs(el.scrollTop - target) > 8) {
          restoreAnchorRef.current = null;
        }
      }

      reportVisibleReads();

      const now = Date.now();
      if (
        el.scrollTop <= TOP_LOAD_ZONE &&
        hasMoreMessages &&
        !isLoadingMore &&
        !loadingMoreRef.current &&
        conversationId &&
        now - lastLoadAtRef.current > 500
      ) {
        lastLoadAtRef.current = now;
        loadingMoreRef.current = true;
        loadMoreMessages(conversationId).finally(() => {
          loadingMoreRef.current = false;
        });
      }
    }, [hasMoreMessages, isLoadingMore, conversationId, loadMoreMessages, messages, virtualizer, reportVisibleReads]);

    // ── Capture the saved position on (re)mount BEFORE the pin effect below —
    // a passive effect would run after this layout effect and the anchor would
    // never be applied on the very first messages render.
    useLayoutEffect(() => {
      if (restoreAnchorRef.current === null && conversationId) {
        const saved = getScrollPosition(conversationId);
        if (saved) restoreAnchorRef.current = { ...saved };
      }
    }, [conversationId]);

    // ── Bottom pin / anchor stabilization ────────────────────────────────
    // Re-runs whenever the list content or the viewport actually changes:
    // prepends/appends (messages), measurement corrections (totalSize), and
    // keyboard/URL-bar resizes (keyboardInset). Three mutually exclusive modes:
    //   1. session restore (jump to the saved anchor, then hand off),
    //   2. bottom pin (at the bottom → clamp to the real bottom),
    //   3. anchor re-align (scrolled up → keep the anchor message frozen).
    const totalSize = virtualizer.getTotalSize();
    useLayoutEffect(() => {
      const el = scrollerRef.current;
      if (!el) return;

      const restore = restoreAnchorRef.current;
      if (restore) {
        const target = anchorTarget(virtualizer, messages, restore);
        if (target !== null) {
          if (Math.abs(el.scrollTop - target) > 2) el.scrollTop = target;
          // Hand off to the live anchor so subsequent measurement changes keep
          // this exact message frozen instead of drifting.
          anchorRef.current = { messageId: restore.messageId, offset: restore.offset };
          restoreAnchorRef.current = null;
          if (isAtBottomRef.current) {
            isAtBottomRef.current = false;
            setIsAtBottom(false);
          }
          return;
        }
        // The anchor is not loaded yet — history is being hunted in the
        // background, so behave like a normal open (stay at the bottom) until
        // the anchor arrives and this effect jumps to it.
      }

      if (isAtBottomRef.current) {
        const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
        if (Math.abs(el.scrollTop - maxScrollTop) > 1) el.scrollTop = maxScrollTop;
        return;
      }

      const anchor = anchorRef.current;
      if (!anchor) return;
      const target = anchorTarget(virtualizer, messages, anchor);
      if (target === null) return;
      if (Math.abs(el.scrollTop - target) > ANCHOR_REALIGN_EPSILON) el.scrollTop = target;
    }, [totalSize, messages, keyboardInset, virtualizer]);

    // ── Report read receipts after the scroll position has settled ───────
    // Runs after the pin/anchor effect above so the viewport is final when the
    // visible items are computed. handleScroll also reports on scroll events.
    useLayoutEffect(() => {
      reportVisibleReads();
    }, [totalSize, messages, keyboardInset, reportVisibleReads]);

    // ── Auto-load history until the saved anchor message is present ──────
    // Returning to a chat deep in history: keep prepending older pages until
    // the anchor arrives, then the layout effect above jumps to it. Capped to
    // avoid hammering.
    useEffect(() => {
      const anchor = restoreAnchorRef.current;
      if (!anchor || !conversationId) return;
      if (messages.some((m) => m.id === anchor.messageId)) return;
      if (!hasMoreMessages || loadingMoreRef.current) {
        // The anchor is unreachable (deleted / too deep) — fall back to the
        // default bottom-open behavior.
        restoreAnchorRef.current = null;
        return;
      }
      loadingMoreRef.current = true;
      loadMoreMessages(conversationId).finally(() => {
        loadingMoreRef.current = false;
      });
    }, [messages, hasMoreMessages, conversationId, loadMoreMessages]);

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
              window.setTimeout(() => {
                setNewMessageIds((previous) => {
                  const next = new Set(previous);
                  for (const id of ids) next.delete(id);
                  return next;
                });
              }, NEW_MESSAGE_ANIMATION_MS);
            } else {
              // Own optimistic messages are not counted in the pill.
              const incoming = appended.filter((m) => m.localStatus !== "sending").length;
              if (incoming > 0) setNewMessageCount((count) => count + incoming);
            }
          }
        }
      }
      prevLastIdRef.current = lastId;
    }, [messages]);

    // ── Imperative API (send-scroll, pinned-message jump) ───────────────
    const scrollToBottom = useCallback(() => {
      // Explicitly returning to the bottom cancels any saved position.
      restoreAnchorRef.current = null;
      anchorRef.current = null;
      if (conversationId) clearScrollPosition(conversationId);
      const el = scrollerRef.current;
      if (el) {
        const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
        if (typeof el.scrollTo === "function") {
          el.scrollTo({ top: maxScrollTop, behavior: "smooth" });
        } else {
          el.scrollTop = maxScrollTop;
        }
      }
      isAtBottomRef.current = true;
      setIsAtBottom(true);
      setNewMessageCount(0);
    }, [conversationId]);

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
    const contentHeight = HISTORY_HEADER_HEIGHT + totalSize + BOTTOM_GAP_HEIGHT;

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
                    style={{ position: "absolute", top: HISTORY_HEADER_HEIGHT + row.start, left: 0, right: 0 }}
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
