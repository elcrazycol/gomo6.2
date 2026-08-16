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

// ── Layout constants (kept in sync with messenger.css) ────────────────────
const HISTORY_HEADER_HEIGHT = 34; // .msg-history-header — fixed in every state
const BOTTOM_GAP_HEIGHT = 12;     // .message-list-footer — gap under the last message
const AT_BOTTOM_SLACK = 80;       // px of trailing space still treated as "at the bottom"
const TOP_LOAD_ZONE = 300;        // px from the top that arms the history loader
const OVERSCAN = 12;              // items rendered beyond the viewport (ТЗ: 8–15)

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
 *  - "N new messages" pill + entrance animation only when scrolled up.
 *
 * It is mounted per conversation (`key={conversation.id}` in ChatView), so all
 * refs/state below reset naturally when switching chats.
 */
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
    }, [hasMoreMessages, isLoadingMore, conversationId, loadMoreMessages]);

    // ── Pin to the bottom while the user is at the bottom ───────────────
    // Re-anchors on every total-size change (appends, image loads, measured
    // corrections) in the same frame, so the bottom never visibly slides.
    const totalSize = virtualizer.getTotalSize();
    useLayoutEffect(() => {
      if (!isAtBottomRef.current) return;
      const el = scrollerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }, [totalSize]);

    // ── Compensate prepends (older history / cache → network replace) ───
    // When messages are added at the TOP, every visible message shifts down by
    // the prepended height. The scrollHeight delta compensation restores the
    // view in the same frame — no jump, no flicker.
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

    // ── Realtime appends → "N new messages" pill + entrance animation ───
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
            setNewMessageIds((previous) => {
              const next = new Set(previous);
              for (const message of appended) next.add(message.id);
              return next;
            });
            if (!isAtBottomRef.current) {
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
    }, []);

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
