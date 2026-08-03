import {
  memo,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DOMAttributes,
  type HTMLAttributes,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
} from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { useDrag } from "@use-gesture/react";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { useMessengerStore } from "@/stores/messengerStore";
import type { MessageView } from "./types";
import { isConsecutive, getDateSeparator } from "./messageListUtils";

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
  onBack: () => void;
  renderMessage: (message: MessageView, prev: MessageView | null, extras: MessageRenderExtras) => ReactNode;
}

type ScrollerHandlers = Record<string, unknown>;

/**
 * Owns the react-virtuoso instance and all scroll-position bookkeeping for the
 * open conversation:
 * - stick-to-bottom only when the user is already near the bottom (followOutput),
 * - history prepend via firstItemIndex (keeps virtual indices stable),
 * - unread-boundary initial positioning,
 * - "N new messages" pill + entrance animation,
 * - mobile swipe-back gesture.
 *
 * It is mounted per conversation (`key={conversation.id}` in ChatView), so all
 * refs/state below reset naturally when switching chats.
 */
export const MessageList = memo(
  forwardRef<MessageListHandle, MessageListProps>(function MessageList({ onBack, renderMessage }, ref) {
    const conversationId = useMessengerStore((s) => s.selectedConversationId);
    const messages = useMessengerStore((s) => s.messages);
    const openingUnreadCount = useMessengerStore((s) => s.openingUnreadCount);
    const hasMoreMessages = useMessengerStore((s) => s.hasMoreMessages);
    const isLoadingMore = useMessengerStore((s) => s.isLoadingMore);
    const loadMoreMessages = useMessengerStore((s) => s.loadMoreMessages);

    const virtuosoRef = useRef<VirtuosoHandle>(null);
    const scrollerElRef = useRef<HTMLDivElement | null>(null);

    const [firstItemIndex, setFirstItemIndex] = useState(0);
    const [isScrolledUp, setIsScrolledUp] = useState(false);
    const [newMessageCount, setNewMessageCount] = useState(0);
    const [newMessageIds, setNewMessageIds] = useState<Set<string>>(() => new Set());
    const [swipeBackOffset, setSwipeBackOffset] = useState(0);

    const shouldAutoScrollRef = useRef(true);
    const isScrolledUpRef = useRef(false);
    const touchStartXRef = useRef(0);
    const loadingMoreRef = useRef(false);
    const firstItemIndexRef = useRef(0);
    const prevFirstIdRef = useRef<string | null>(null);
    const prevLastIdRef = useRef<string | null>(null);

    const isTouchDevice =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches;

    // ── Imperative API (send-scroll, pinned-message jump) ──────────────
    const scrollToBottom = useCallback(() => {
      shouldAutoScrollRef.current = true;
      const length = useMessengerStore.getState().messages.length;
      if (length === 0) return;
      virtuosoRef.current?.scrollToIndex({
        index: firstItemIndexRef.current + length - 1,
        align: "end",
        behavior: "smooth",
      });
      isScrolledUpRef.current = false;
      setIsScrolledUp(false);
      setNewMessageCount(0);
    }, []);

    const scrollToMessage = useCallback((messageId: string) => {
      const index = useMessengerStore.getState().messages.findIndex((m) => m.id === messageId);
      if (index < 0) return;
      virtuosoRef.current?.scrollToIndex({
        index: firstItemIndexRef.current + index,
        align: "center",
        behavior: "smooth",
      });
    }, []);

    useImperativeHandle(ref, () => ({ scrollToBottom, scrollToMessage }), [scrollToBottom, scrollToMessage]);

    // ── Stick to the bottom only when the user is already there ────────
    // The ref tracks the same 32px threshold the old implementation used.
    const followOutput = useCallback(() => (shouldAutoScrollRef.current ? ("smooth" as const) : false), []);

    // ── Load older history when reaching the top ───────────────────────
    const handleStartReached = useCallback(() => {
      if (!hasMoreMessages || isLoadingMore || loadingMoreRef.current || !conversationId) return;
      loadingMoreRef.current = true;
      loadMoreMessages(conversationId).finally(() => {
        loadingMoreRef.current = false;
      });
    }, [hasMoreMessages, isLoadingMore, conversationId, loadMoreMessages]);

    // ── "Scrolled up" / "at bottom" thresholds (mirror old 32/128px rules) ──
    const handleScroll = useCallback(() => {
      const el = scrollerElRef.current;
      if (!el) return;
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      shouldAutoScrollRef.current = distance <= 32;
      const nowScrolledUp = distance > 128;
      if (nowScrolledUp !== isScrolledUpRef.current) {
        isScrolledUpRef.current = nowScrolledUp;
        setIsScrolledUp(nowScrolledUp);
      }
      if (distance <= 32) setNewMessageCount(0);
    }, []);

    // ── Keep virtual indices stable when older messages are prepended ──
    // Covers both the "load history" path and the cache → network replace
    // (the cached first message usually survives inside the network snapshot,
    // so anchoring on it keeps the unread boundary exactly in place).
    useEffect(() => {
      if (messages.length === 0) return;
      const previousFirst = prevFirstIdRef.current;
      if (previousFirst !== null) {
        const index = messages.findIndex((m) => m.id === previousFirst);
        if (index > 0) firstItemIndexRef.current -= index;
      }
      prevFirstIdRef.current = messages[0]?.id ?? null;
      setFirstItemIndex(firstItemIndexRef.current);
    }, [messages]);

    // ── Detect realtime appends → "N new messages" pill + animation ────
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
            if (isScrolledUpRef.current) {
              // Own optimistic messages are about to be scrolled into view by
              // handleSend; don't count them in the "N new messages" pill.
              const incoming = appended.filter((m) => m.localStatus !== "sending").length;
              if (incoming > 0) setNewMessageCount((count) => count + incoming);
            }
          }
        }
      }
      prevLastIdRef.current = lastId;
    }, [messages]);

    // ── Reset auto-scroll when the mobile keyboard opens/closes ────────
    useEffect(() => {
      const vv = window.visualViewport;
      if (!vv) return;
      let keyboardTimer: ReturnType<typeof setTimeout>;
      const onResize = () => {
        clearTimeout(keyboardTimer);
        keyboardTimer = setTimeout(() => {
          if (isScrolledUpRef.current) return;
          shouldAutoScrollRef.current = true;
        }, 150);
      };
      vv.addEventListener("resize", onResize);
      return () => {
        vv.removeEventListener("resize", onResize);
        clearTimeout(keyboardTimer);
      };
    }, []);

    // ── Swipe-back gesture (mobile only) ───────────────────────────────
    const swipeBackBind = useDrag(
      ({ movement: [mx], last, active }) => {
        if (!isTouchDevice) return;
        if (touchStartXRef.current > 30) return;
        const el = scrollerElRef.current;
        if (el && el.scrollTop > 5) return;
        if (active) {
          setSwipeBackOffset(Math.max(0, Math.min(200, mx)));
        } else if (last) {
          if (mx > 100) {
            if (navigator.vibrate) navigator.vibrate(5);
            onBack();
          }
          setSwipeBackOffset(0);
        } else {
          setSwipeBackOffset(0);
        }
      },
      { axis: "x", filterTaps: true, from: () => [0, 0], threshold: 10 },
    );

    // Handlers are injected into the scroller via a stable custom component
    // (Virtuoso does not forward extra props to its Scroller, and an inline
    // component would remount the scroller and lose the scroll position).
    const scrollerHandlersRef = useRef<ScrollerHandlers>({});
    scrollerHandlersRef.current = {
      onScroll: handleScroll,
      ...(isTouchDevice
        ? {
            ...swipeBackBind(),
            onTouchStart: (event: ReactTouchEvent<HTMLDivElement>) => {
              touchStartXRef.current = event.touches[0]?.clientX ?? 0;
            },
          }
        : {}),
    };

    const CustomScroller = useMemo(
      () =>
        forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function CustomScroller(props, scrollerRef) {
          const gesture = scrollerHandlersRef.current;
          const gestureStyle = (gesture.style as CSSProperties | undefined) ?? {};
          const { style: _ignoredGestureStyle, ...gestureHandlers } = gesture;
          return (
            <div
              ref={scrollerRef}
              {...(gestureHandlers as unknown as DOMAttributes<HTMLDivElement>)}
              {...props}
              className="message-scroll"
              style={{ ...gestureStyle, ...props.style }}
              role="log"
              aria-label="Сообщения"
              aria-live="polite"
            />
          );
        }),
      [],
    );
    // Keep the components object stable so Virtuoso does not redo internal
    // subscriptions on every state change (isScrolledUp, messages, ...).
    // CustomScroller itself is memoized above, so it never changes identity.
    const listComponents = useMemo(() => ({ Scroller: CustomScroller }), [CustomScroller]);

    if (messages.length === 0) return null;

    const initialTopMostIndex =
      openingUnreadCount > 0
        ? { index: Math.max(0, messages.length - openingUnreadCount), align: "start" as const }
        : { index: Math.max(0, messages.length - 1), align: "end" as const };

    return (
      <>
        <div
          className="message-scroll-wrap"
          style={swipeBackOffset > 0 ? { transform: `translateX(${swipeBackOffset}px)`, transition: "none" } : undefined}
        >
          {swipeBackOffset > 20 && (
            <div className="swipe-back-indicator" style={{ opacity: Math.min(1, swipeBackOffset / 100) }}>
              <ArrowLeft size={18} />
            </div>
          )}
          <Virtuoso
            ref={virtuosoRef}
            scrollerRef={(el) => {
              scrollerElRef.current = (el as unknown as HTMLDivElement | null) ?? null;
            }}
            totalCount={messages.length}
            firstItemIndex={firstItemIndex}
            initialTopMostItemIndex={initialTopMostIndex}
            alignToBottom={openingUnreadCount === 0}
            computeItemKey={(index) => {
              const message = messages[index - firstItemIndex];
              return message ? (message.client_id ?? message.id) : index;
            }}
            followOutput={followOutput}
            startReached={handleStartReached}
            increaseViewportBy={{ top: 300, bottom: 0 }}
            defaultItemHeight={64}
            components={listComponents}
            style={{ height: "100%" }}
            itemContent={(index) => {
              const dataIndex = index - firstItemIndex;
              const message = messages[dataIndex];
              if (!message) return null;
              const prev = dataIndex > 0 ? messages[dataIndex - 1] : null;
              return renderMessage(message, prev, {
                dateLabel: getDateSeparator(prev, message),
                isConsecutive: isConsecutive(prev, message),
                isNew: newMessageIds.has(message.id),
              });
            }}
          />
        </div>

        {isScrolledUp && newMessageCount > 0 && (
          <div className="new-messages-bar-container">
            <button type="button" className="new-messages-bar" onClick={scrollToBottom}>
              {newMessageCount} нов{newMessageCount === 1 ? "ое" : "ых"} сообщен{newMessageCount === 1 ? "ие" : "ий"}
            </button>
          </div>
        )}

        {isScrolledUp && (
          <button type="button" className="scroll-to-bottom-btn" onClick={scrollToBottom} aria-label="Прокрутить вниз">
            <ChevronDown size={20} />
          </button>
        )}
      </>
    );
  }),
);
