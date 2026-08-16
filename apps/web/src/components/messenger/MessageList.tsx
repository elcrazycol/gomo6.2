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
import { useMessengerStore } from "@/stores/messengerStore";
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
const ANCHOR_RESTORE_MAX_CORRECTIONS = 100; // safety cap while measurements settle
const ANCHOR_RESTORE_MAX_PAGES = 20;       // pages to auto-load while hunting a saved anchor
const ANCHOR_USER_SCROLL_THRESHOLD = 8;    // px of user scroll that releases the anchor

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
 * Owns the virtualized message list for the open conversation (@tanstack/react-virtual).
 *
 * The list is plain top-anchored content: index 0 = oldest message at the top,
 * the newest message at the bottom. All chat behavior is explicit and
 * deterministic — nothing fights the scroller:
 *  - the view opens and re-pins at the bottom while the user is there (layout
 *    effect on total size: covers appends, image loads, measurement changes),
 *  - older history prepends at the top and scrollTop is compensated by the
 *    scrollHeight delta in the same frame, so visible messages never shift,
 *  - the loader fires near the top (scroll zone + in-flight guard + cooldown),
 *  - returning to a chat restores the saved scroll anchor (message id + viewport
 *    offset from the session map), auto-loading history until the anchor is
 *    present; the anchor releases as soon as the user scrolls,
 *  - live arrivals animate only while the user is at the bottom; scrolled up
 *    they count toward the "N new messages" pill instead.
 *
 * It is mounted per conversation (`key={conversation.id}` in ChatView), so all
 * refs/state below reset naturally when switching chats — the scroll anchor is
 * the only thing that survives (the session-scoped scrollPosition module).
 */

/**
 * Save the current scroll anchor for a conversation. Queries the DOM directly
 * (not the virtualizer's item list): the virtualizer re-renders asynchronously
 * after a scroll event, so its getVirtualItems() can still describe the
 * previous scroll position when the handler runs — which produced garbage
 * anchors (a message far below the viewport with a negative offset). The DOM
 * reflects the committed layout, so rects are always truthful.
 */
function recordScrollPosition(scroller: HTMLElement, conversationId: string): void {
  const scrollerRect = scroller.getBoundingClientRect();
  let anchorEl: HTMLElement | null = null;
  for (const itemEl of scroller.querySelectorAll<HTMLElement>(".message-virtual-item")) {
    if (itemEl.getBoundingClientRect().top <= scrollerRect.top + 1) anchorEl = itemEl;
    else break; // items are in DOM order, top → bottom
  }
  if (!anchorEl) {
    // Nothing rendered at/above the viewport top yet (still settling) — anchor
    // to the first rendered item; a negative offset restores it correctly.
    anchorEl = scroller.querySelector<HTMLElement>(".message-virtual-item");
    if (!anchorEl) return;
  }
  const messageEl = anchorEl.querySelector<HTMLElement>("[data-message-id]");
  const messageId = messageEl?.getAttribute("data-message-id");
  if (!messageId) return;
  saveScrollPosition(conversationId, {
    messageId,
    offset: scrollerRect.top - anchorEl.getBoundingClientRect().top,
  });
}

export const MessageList = memo(
  forwardRef<MessageListHandle, MessageListProps>(function MessageList({ renderMessage, messagesOverride }, ref) {
    const conversationId = useMessengerStore((s) => s.selectedConversationId);
    const storeMessages = useMessengerStore((s) => s.messages);
    // Notes self-chat passes a folder-filtered view; regular chats use the full list.
    const messages = messagesOverride ?? storeMessages;
    const hasMoreMessages = useMessengerStore((s) => s.hasMoreMessages);
    const isLoadingMore = useMessengerStore((s) => s.isLoadingMore);
    const loadMoreMessages = useMessengerStore((s) => s.loadMoreMessages);

    const scrollerRef = useRef<HTMLDivElement | null>(null);

    const [isAtBottom, setIsAtBottom] = useState(true);
    const [newMessageCount, setNewMessageCount] = useState(0);
    const [newMessageIds, setNewMessageIds] = useState<Set<string>>(() => new Set());

    const isAtBottomRef = useRef(true);
    const loadingMoreRef = useRef(false);
    const lastLoadAtRef = useRef(0);
    const prevFirstKeyRef = useRef<{ key: string | null; scrollHeight: number }>({ key: null, scrollHeight: 0 });
    const prevLastIdRef = useRef<string | null>(null);

    // ── Position restore (return to a chat where the user left off) ──────
    // The anchor is captured once at mount from the session map; while it is
    // active it overrides the bottom pin, and history is auto-loaded until the
    // anchor message is in the list. Released as soon as the user scrolls.
    const restoreAnchorRef = useRef<{ messageId: string; offset: number } | null>(null);
    const anchorLoadPagesRef = useRef(0);
    const anchorLoadingRef = useRef(false);
    const anchorCorrectionsRef = useRef(0);
    const positionRafRef = useRef(0);

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

    // ── Scroll: at-bottom tracking + history loader near the top ────────
    const handleScroll = useCallback(() => {
      const el = scrollerRef.current;
      if (!el) return;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM_SLACK;
      if (atBottom !== isAtBottomRef.current) {
        isAtBottomRef.current = atBottom;
        setIsAtBottom(atBottom);
        if (atBottom) setNewMessageCount(0);
      }

      // Position memory: at the bottom the default open state is enough (and
      // any stale anchor is dropped); anywhere else remember the message at
      // the top of the viewport and how far it has been scrolled past.
      // Deferred to the next frame: the virtualizer rebuilds its item list
      // asynchronously after a scroll event, so DOM rects are read when the
      // layout for this scroll position is already committed.
      if (atBottom) {
        if (conversationId) clearScrollPosition(conversationId);
      } else if (conversationId && !positionRafRef.current) {
        positionRafRef.current = requestAnimationFrame(() => {
          positionRafRef.current = 0;
          recordScrollPosition(el, conversationId);
        });
      }

      // A real user scroll releases the restore anchor — programmatic
      // corrections land exactly on the target, so they never release it.
      const anchor = restoreAnchorRef.current;
      if (anchor && conversationId) {
        const index = messages.findIndex((m) => m.id === anchor.messageId);
        if (index >= 0) {
          const offset = virtualizer.getOffsetForIndex(index);
          if (offset) {
            const target = HISTORY_HEADER_HEIGHT + offset[0] + anchor.offset;
            if (Math.abs(el.scrollTop - target) > ANCHOR_USER_SCROLL_THRESHOLD) {
              restoreAnchorRef.current = null;
            }
          }
        }
      }

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
    }, [hasMoreMessages, isLoadingMore, conversationId, loadMoreMessages, messages, virtualizer]);

    // ── Compensate prepends (older history / cache → network replace) ───
    // When messages are added at the TOP, every visible message shifts down by
    // the prepended height. The scrollHeight delta compensation restores the
    // view in the same frame — no jump, no flicker. Declared before the pin
    // effect so an active restore anchor (which computes its own exact target)
    // always wins: compensation runs first, then the pin re-applies the anchor.
    useLayoutEffect(() => {
      const el = scrollerRef.current;
      const scrollHeight = el?.scrollHeight ?? 0;
      if (messages.length === 0) {
        prevFirstKeyRef.current = { key: null, scrollHeight };
        return;
      }
      const firstKey = messageKey(messages[0]);
      const prev = prevFirstKeyRef.current;
      if (prev.key !== null && prev.key !== firstKey) {
        const delta = scrollHeight - prev.scrollHeight;
        if (el && delta !== 0) el.scrollTop += delta;
      }
      prevFirstKeyRef.current = { key: firstKey, scrollHeight };
    });

    // ── Pin to the bottom (or to the saved anchor) ───────────────────────
    // Re-anchors on every total-size change (appends, image loads, measured
    // corrections) in the same frame, so the pinned position never slides.
    // While a restore anchor is active it takes precedence: each measurement
    // change re-applies the exact viewport offset of the anchor message.
    const totalSize = virtualizer.getTotalSize();
    // Capture the saved position on (re)mount BEFORE the pin effect below — a
    // passive effect would run after this layout effect and the anchor would
    // never be applied on the very first messages render.
    useLayoutEffect(() => {
      if (restoreAnchorRef.current === null && conversationId) {
        const saved = getScrollPosition(conversationId);
        if (saved) restoreAnchorRef.current = { ...saved };
      }
    }, [conversationId]);
    useLayoutEffect(() => {
      const el = scrollerRef.current;
      if (!el) return;
      const anchor = restoreAnchorRef.current;
      if (anchor) {
        const index = messages.findIndex((m) => m.id === anchor.messageId);
        if (index >= 0) {
          const offset = virtualizer.getOffsetForIndex(index);
          if (offset) {
            const target = HISTORY_HEADER_HEIGHT + offset[0] + anchor.offset;
            if (Math.abs(el.scrollTop - target) > 2) el.scrollTop = target;
            if (isAtBottomRef.current) {
              isAtBottomRef.current = false;
              setIsAtBottom(false);
            }
            // Safety: if measurements keep oscillating, stop correcting.
            anchorCorrectionsRef.current += 1;
            if (anchorCorrectionsRef.current > ANCHOR_RESTORE_MAX_CORRECTIONS) {
              restoreAnchorRef.current = null;
            }
          }
          return;
        }
        // The anchor is not loaded yet — history is being hunted in the
        // background, so behave like a normal open (stay at the bottom) until
        // the anchor arrives and the effect above jumps to it.
      }
      if (isAtBottomRef.current) el.scrollTop = el.scrollHeight;
      // totalSize changes whenever messages prepend/append/measure — exactly
      // when re-anchoring is needed; messages/virtualizer come from this
      // render's fresh closure.
    }, [totalSize]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Auto-load history until the saved anchor message is present ──────
    // Returning to a chat deep in history: keep prepending older pages (the
    // same loadMoreMessages the scroll loader uses) until the anchor arrives,
    // then the layout effect above jumps to it. Capped to avoid hammering.
    useEffect(() => {
      const anchor = restoreAnchorRef.current;
      if (!anchor || !conversationId) return;
      if (messages.some((m) => m.id === anchor.messageId)) return;
      if (!hasMoreMessages || anchorLoadingRef.current || anchorLoadPagesRef.current >= ANCHOR_RESTORE_MAX_PAGES) {
        // The anchor is unreachable (deleted / too deep) — fall back to the
        // default bottom-open behavior.
        restoreAnchorRef.current = null;
        return;
      }
      anchorLoadPagesRef.current += 1;
      anchorLoadingRef.current = true;
      loadMoreMessages(conversationId).finally(() => {
        anchorLoadingRef.current = false;
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
      if (conversationId) clearScrollPosition(conversationId);
      const el = scrollerRef.current;
      if (el) {
        if (typeof el.scrollTo === "function") {
          el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
        } else {
          el.scrollTop = el.scrollHeight;
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
