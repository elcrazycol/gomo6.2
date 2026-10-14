import {
  memo,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Virtuoso, type ListRange, type VirtuosoHandle } from "react-virtuoso";
import { ChevronDown } from "lucide-react";
import { useMessengerStore, queueMarkRead } from "@/stores/messengerStore";
import type { MessageView } from "./types";
import { isConsecutive, getDateSeparator } from "./messageListUtils";
import {
  clearScrollPosition,
  getScrollPosition,
  saveScrollPosition,
  type SavedScrollPosition,
} from "./scrollPosition";
import { isScrollDebugEnabled, startScrollDebug } from "./core/scrollDebug";

// ── Tuning ────────────────────────────────────────────────────────────────
const NEW_MESSAGE_ANIMATION_MS = 1200; // how long an incoming message may play its entrance
const START_REACHED_COOLDOWN_MS = 800; // min gap between history loads
const AT_BOTTOM_THRESHOLD = 100;       // px from the bottom that counts as "at the bottom"
// Pre-measure guess for a text bubble. Real bubble heights measured in the
// harness are ~75–150px (median ~95); a too-low value makes the layout lag as
// items mount (each mount then corrects the total height — the iOS momentum
// "snap"), so this is deliberately near the real average.
const DEFAULT_ITEM_HEIGHT = 96;
// Render this far outside the viewport. Critical on mobile: the compositor
// thread scrolls while the main thread is busy, and without a buffer a fast
// swipe shows blank space. It also gets items MEASURED before they reach the
// viewport, so the momentum deceleration has no pending size correction left to
// apply when it stops (the iOS "teleport").
const INCREASE_VIEWPORT_BY = { top: 1200, bottom: 900 };
// Start loading the next page this many messages before the top, so the older
// history is already there by the time the user scrolls up to it — no seam.
const PRELOAD_ITEMS = 25;

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

// ── History header (Virtuoso `components.Header`) ─────────────────────────
// A fixed-height box in all states, so it never shifts the rows below it when
// a page is prepended.
const HistoryHeader = memo(function HistoryHeader() {
  const isLoadingMore = useMessengerStore((s) => s.isLoadingMore);
  const hasMoreMessages = useMessengerStore((s) => s.hasMoreMessages);
  return (
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
  );
});

// Stable references so Virtuoso does not re-mount the header / re-read options.
const VIRTUOSO_COMPONENTS = { Header: HistoryHeader };

/**
 * The virtualized message list, built on react-virtuoso.
 *
 * react-virtuoso owns the whole scroll contract, so this component carries no
 * hand-rolled scroll math:
 *  - `firstItemIndex` (decremented by the store on every prepend) keeps the
 *    indices of already-rendered messages stable, so older history appears
 *    above the fold with no jump;
 *  - `startReached` loads older history when the user reaches the top;
 *  - `followOutput` pins the view to the bottom only when the user is there (or
 *    just sent a message);
 *  - `atBottomStateChange` drives the "↓ N new" pill;
 *  - `initialTopMostItemIndex` opens at the saved position (or the last message).
 *
 * It is mounted per conversation (`key={conversation.id}` in ChatView), so all
 * refs/state reset naturally when switching chats; the session scroll anchor
 * survives in the module-scoped scrollPosition map.
 */
export const MessageList = memo(
  forwardRef<MessageListHandle, MessageListProps>(function MessageList({ renderMessage, messagesOverride }, ref) {
    const conversationId = useMessengerStore((s) => s.selectedConversationId);
    const meId = useMessengerStore((s) => s.me?.id);
    const storeMessages = useMessengerStore((s) => s.messages);
    // Notes self-chat passes a folder-filtered view; regular chats use the full list.
    const messages = messagesOverride ?? storeMessages;
    const firstItemIndex = useMessengerStore((s) => s.firstItemIndex);
    const hasMoreMessages = useMessengerStore((s) => s.hasMoreMessages);
    const loadMoreMessages = useMessengerStore((s) => s.loadMoreMessages);

    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const virtuosoRef = useRef<VirtuosoHandle>(null);

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
    // The item to open on. If the saved message is already loaded, open there;
    // otherwise open at the bottom and let the hunt below scroll to it.
    const initialIndexRef = useRef<number | null>(null);
    if (initialIndexRef.current === null) {
      const anchor = restoreAnchorRef.current;
      const idx = anchor ? messages.findIndex((m) => m.id === anchor.messageId) : -1;
      initialIndexRef.current = idx >= 0 ? idx : Math.max(0, messages.length - 1);
    }
    // A saved anchor that was NOT in the first page — hunt older history for it.
    const pendingRestoreRef = useRef<SavedScrollPosition | null>(
      restoreAnchorRef.current && initialIndexRef.current !== null && messages[initialIndexRef.current]?.id !== restoreAnchorRef.current.messageId
        ? restoreAnchorRef.current
        : null,
    );

    // DEV-only on-device scroll diagnostics (opt-in via localStorage).
    useEffect(() => {
      if (!isScrollDebugEnabled()) return;
      const el = wrapperRef.current?.querySelector(".message-scroll");
      if (!el) return;
      return startScrollDebug(el as HTMLElement);
    }, []);

    // ── History loader ───────────────────────────────────────────────────
    const maybeLoadMore = useCallback(() => {
      if (!conversationId || !hasMoreMessages || loadingMoreRef.current) return;
      const now = Date.now();
      if (now - lastLoadAtRef.current < START_REACHED_COOLDOWN_MS) return;
      lastLoadAtRef.current = now;
      loadingMoreRef.current = true;
      loadMoreMessages(conversationId).finally(() => {
        loadingMoreRef.current = false;
      });
    }, [conversationId, hasMoreMessages, loadMoreMessages]);

    // ── Read line + session anchor (visible range) ───────────────────────
    const handleRangeChanged = useCallback(
      (range: ListRange) => {
        const start = range.startIndex - firstItemIndex;
        const end = range.endIndex - firstItemIndex;
        if (conversationId && start >= 0 && start < messages.length) {
          saveScrollPosition(conversationId, { messageId: messages[start].id, offset: 0 });
        }
        // Preload older history before the user actually reaches the top, so
        // the page is already rendered when they get there (seamless).
        if (start <= PRELOAD_ITEMS) maybeLoadMore();
        if (!conversationId || !meId) return;
        // The read line is the newest incoming message at or before the last
        // visible row; the store batches and the backend marks the whole prefix.
        for (let i = Math.min(end, messages.length - 1); i >= 0; i -= 1) {
          const message = messages[i];
          if (!message || message.is_deleted || message.sender_user_id === meId) continue;
          queueMarkRead(conversationId, message.id, message.sent_at);
          break;
        }
      },
      [conversationId, firstItemIndex, meId, messages, maybeLoadMore],
    );

    const handleAtBottom = useCallback((atBottom: boolean) => {
      isAtBottomRef.current = atBottom;
      setIsAtBottom(atBottom);
      if (atBottom) setNewMessageCount(0);
    }, []);

    // Follow appended output ONLY while the user is at the bottom. Do NOT add a
    // "the last message is mine" shortcut: Virtuoso calls this on every data
    // change, including a history PREPEND — with the last message being the
    // user's own (common), that shortcut scrolled the list smoothly back to the
    // bottom as soon as they approached the top. Sending already scrolls to the
    // bottom explicitly (ChatView), so the shortcut is not needed.
    const followOutput = useCallback((atBottom: boolean) => (atBottom ? ("smooth" as const) : false), []);

    // ── Session restore hunt ─────────────────────────────────────────────
    useEffect(() => {
      const pending = pendingRestoreRef.current;
      if (!pending || !conversationId) return;
      const index = messages.findIndex((m) => m.id === pending.messageId);
      if (index >= 0) {
        virtuosoRef.current?.scrollToIndex({ index, align: "start" });
        pendingRestoreRef.current = null;
        return;
      }
      if (!hasMoreMessages || loadingMoreRef.current) {
        pendingRestoreRef.current = null;
        return;
      }
      loadingMoreRef.current = true;
      loadMoreMessages(conversationId).finally(() => {
        loadingMoreRef.current = false;
      });
    }, [messages, hasMoreMessages, conversationId, loadMoreMessages]);

    // ── Realtime appends → "N new messages" pill + entrance animation ────
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
    }, [messages]);

    // Cancel any still-pending animation timers on unmount.
    useEffect(() => {
      const timers = entranceTimersRef.current;
      return () => {
        for (const id of timers) window.clearTimeout(id);
        timers.clear();
      };
    }, []);

    // ── Imperative API (send-scroll, pinned-message jump) ────────────────
    const scrollToBottom = useCallback(() => {
      virtuosoRef.current?.scrollToIndex({ index: messages.length - 1, align: "end", behavior: "smooth" });
      isAtBottomRef.current = true;
      setIsAtBottom(true);
      setNewMessageCount(0);
    }, [messages.length]);

    const scrollToMessage = useCallback(
      (messageId: string) => {
        const index = messages.findIndex((m) => m.id === messageId);
        if (index < 0) return;
        virtuosoRef.current?.scrollToIndex({ index, align: "center", behavior: "smooth" });
      },
      [messages],
    );

    useImperativeHandle(ref, () => ({ scrollToBottom, scrollToMessage }), [scrollToBottom, scrollToMessage]);

    if (messages.length === 0) return null;

    return (
      <>
        <div className="message-scroll-wrap" ref={wrapperRef}>
          <Virtuoso
            ref={virtuosoRef}
            className="message-scroll"
            data={messages}
            firstItemIndex={firstItemIndex}
            initialTopMostItemIndex={initialIndexRef.current ?? messages.length - 1}
            alignToBottom
            computeItemKey={(index, message) => message.client_id ?? message.id}
            defaultItemHeight={DEFAULT_ITEM_HEIGHT}
            increaseViewportBy={INCREASE_VIEWPORT_BY}
            // Undocumented but recommended for chat lists with dynamic heights:
            // reports item size changes synchronously instead of via rAF,
            // which is what makes reverse scrolling flicker/jump on iOS
            // (petyosi/react-virtuoso#1083, #1049). Benign console errors are
            // possible if an item resizes while being measured.
            skipAnimationFrameInResizeObserver
            startReached={maybeLoadMore}
            atBottomStateChange={handleAtBottom}
            atBottomThreshold={AT_BOTTOM_THRESHOLD}
            followOutput={followOutput}
            rangeChanged={handleRangeChanged}
            components={VIRTUOSO_COMPONENTS}
            itemContent={(index, message) => {
              const prev = index > 0 ? messages[index - 1] : null;
              return (
                <div className="message-virtual-item" data-message-id={message.id}>
                  {renderMessage(message, prev, {
                    dateLabel: getDateSeparator(prev, message),
                    isConsecutive: isConsecutive(prev, message),
                    isNew: newMessageIds.has(message.id),
                  })}
                </div>
              );
            }}
          />
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
