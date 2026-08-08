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
  type UIEvent as ReactUIEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { useDrag } from "@use-gesture/react";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { useMessengerStore } from "@/stores/messengerStore";
import type { MessageView } from "./types";
import { isConsecutive, getDateSeparator } from "./messageListUtils";
import { getMaxScrollTop, isNearScrollBottom } from "./scrollUtils";

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
    const isSettlingToBottomRef = useRef(false);
    const settleCleanupRef = useRef<(() => void) | null>(null);

    const cancelBottomSettle = useCallback(() => {
      isSettlingToBottomRef.current = false;
      const cleanup = settleCleanupRef.current;
      settleCleanupRef.current = null;
      cleanup?.();
    }, []);

    const isTouchDevice =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches;

    // ── Bottom-settle machinery ─────────────────────────────────────────
    // scrollToIndex/Virtuoso's follow align the last *item*; with dynamic media
    // heights and scroller padding that can still leave a few pixels above the
    // real bottom (and images can finish loading well after the list grew).
    // scheduleBottomSettle keeps the view attached to the container's actual
    // max scrollTop until everything settles.
    //
    // force=true  — explicit "go bottom" (FAB / send): always clamp, and lock
    //               isSettlingToBottomRef so the smooth animation is not
    //               interrupted by scroll events mid-flight.
    // force=false — append-follow: clamp only while the user is still at the
    //               bottom. Never yank someone who scrolled away while media
    //               was loading.
    const scheduleBottomSettle = useCallback(
      (options: { force: boolean; initialBehavior: "smooth" | "auto" }) => {
        const { force, initialBehavior } = options;
        cancelBottomSettle();
        if (force) isSettlingToBottomRef.current = true;
        let settleFrames = 0;
        let settleObserver: ResizeObserver | null = null;
        let firstSettle = true;
        let cancelled = false;
        let rafId: number | null = null;
        const timeoutIds: number[] = [];
        const scroller = scrollerElRef.current;
        let cleanupSettle: () => void = () => undefined;
        const settleAtBottom = () => {
          if (cancelled) return;
          if (force) {
            if (!isSettlingToBottomRef.current) return;
          } else if (!shouldAutoScrollRef.current || isScrolledUpRef.current) {
            cleanupSettle();
            return;
          }
          const el = scrollerElRef.current;
          if (!el) return;
          const top = getMaxScrollTop(el.scrollHeight, el.clientHeight);
          if (!isNearScrollBottom(el.scrollTop, el.scrollHeight, el.clientHeight, 2)) {
            el.scrollTo({ top, behavior: firstSettle ? initialBehavior : "auto" });
          }
          firstSettle = false;
          settleFrames += 1;
          if (settleFrames >= 8) cleanupSettle();
        };
        const settleOnMediaLoad = () => settleAtBottom();
        if (scroller) {
          scroller.addEventListener("load", settleOnMediaLoad, true);
          scroller.addEventListener("loadedmetadata", settleOnMediaLoad, true);
        }
        if (typeof ResizeObserver !== "undefined" && scroller) {
          settleObserver = new ResizeObserver(settleAtBottom);
          settleObserver.observe(scroller);
        }
        cleanupSettle = () => {
          if (cancelled) return;
          cancelled = true;
          if (rafId !== null) window.cancelAnimationFrame(rafId);
          for (const timeoutId of timeoutIds) window.clearTimeout(timeoutId);
          settleObserver?.disconnect();
          scroller?.removeEventListener("load", settleOnMediaLoad, true);
          scroller?.removeEventListener("loadedmetadata", settleOnMediaLoad, true);
          if (settleCleanupRef.current === cleanupSettle) settleCleanupRef.current = null;
          isSettlingToBottomRef.current = false;
        };
        settleCleanupRef.current = cleanupSettle;
        const settleNextFrame = () => {
          settleAtBottom();
          if (!cancelled && settleFrames < 8) rafId = window.requestAnimationFrame(settleNextFrame);
        };
        rafId = window.requestAnimationFrame(settleNextFrame);
        // Protected blob URLs may finish well after the initial frames. These
        // checkpoints keep the settle attached to the real bottom without
        // affecting ordinary user scrolling. Append-follows keep listening
        // longer — remote images can load a couple of seconds after the
        // message appears.
        const checkpoints = force ? [100, 250, 500, 900] : [100, 250, 500, 900, 1500, 2500];
        for (const delay of checkpoints) {
          timeoutIds.push(window.setTimeout(settleAtBottom, delay));
        }
        timeoutIds.push(window.setTimeout(cleanupSettle, force ? 1200 : 3000));
      },
      [cancelBottomSettle],
    );

    // ── Imperative API (send-scroll, pinned-message jump) ──────────────
    const scrollToBottom = useCallback(() => {
      const length = useMessengerStore.getState().messages.length;
      if (length === 0) {
        cancelBottomSettle();
        return;
      }
      shouldAutoScrollRef.current = true;
      scheduleBottomSettle({ force: true, initialBehavior: "smooth" });
      const lastIndex = firstItemIndexRef.current + length - 1;
      virtuosoRef.current?.scrollToIndex({
        index: lastIndex,
        align: "end",
        behavior: "smooth",
      });
      isScrolledUpRef.current = false;
      setIsScrolledUp(false);
      setNewMessageCount(0);
    }, [cancelBottomSettle, scheduleBottomSettle]);

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

    useEffect(() => () => cancelBottomSettle(), [cancelBottomSettle]);

    // ── Stick to the bottom only when the user is already there ────────
    // The ref tracks the same 32px threshold the old implementation used.
    // "auto" (instant) instead of "smooth": a smooth follow animation takes
    // hundreds of ms, and while it runs every scroll event recomputes
    // shouldAutoScrollRef from a position that is temporarily far from the new
    // bottom — flipping it off so the NEXT append silently stops following and
    // the view is left stuck mid-way (and the FAB flickers during the
    // animation). Instant follow keeps the flag stable across rapid appends;
    // late-loading media is handled by the append-follow settle below.
    const followOutput = useCallback(() => (shouldAutoScrollRef.current ? ("auto" as const) : false), []);

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
      if (isSettlingToBottomRef.current) {
        shouldAutoScrollRef.current = true;
        return;
      }
      shouldAutoScrollRef.current = isNearScrollBottom(el.scrollTop, el.scrollHeight, el.clientHeight, 32);
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
            } else if (shouldAutoScrollRef.current) {
              // At the bottom: followOutput already scrolled the new message
              // into view, but images can finish loading after the list grew
              // and push the newest message below the fold. Clamp back to the
              // true bottom while the user stays there, so the message is
              // always fully visible (never half-cropped).
              scheduleBottomSettle({ force: false, initialBehavior: "auto" });
            }
          }
        }
      }
      prevLastIdRef.current = lastId;
    }, [messages, scheduleBottomSettle]);

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
      onWheel: (_event: ReactWheelEvent<HTMLDivElement>) => cancelBottomSettle(),
      ...(isTouchDevice
        ? {
            ...swipeBackBind(),
            onTouchStart: (event: ReactTouchEvent<HTMLDivElement>) => {
              cancelBottomSettle();
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
          const propsOnScroll = props.onScroll;
          const gestureOnScroll = gestureHandlers.onScroll as ((event: ReactUIEvent<HTMLDivElement>) => void) | undefined;
          const propsOnTouchStart = props.onTouchStart;
          const gestureOnTouchStart = gestureHandlers.onTouchStart as ((event: ReactTouchEvent<HTMLDivElement>) => void) | undefined;
          const propsOnWheel = props.onWheel;
          const gestureOnWheel = gestureHandlers.onWheel as ((event: ReactWheelEvent<HTMLDivElement>) => void) | undefined;
          const mergedOnScroll = (event: ReactUIEvent<HTMLDivElement>) => {
            gestureOnScroll?.(event);
            propsOnScroll?.(event);
          };
          const mergedOnTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
            gestureOnTouchStart?.(event);
            propsOnTouchStart?.(event);
          };
          const mergedOnWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
            gestureOnWheel?.(event);
            propsOnWheel?.(event);
          };
          return (
            <div
              ref={scrollerRef}
              {...(gestureHandlers as unknown as DOMAttributes<HTMLDivElement>)}
              {...props}
              onScroll={mergedOnScroll}
              onTouchStart={mergedOnTouchStart}
              onWheel={mergedOnWheel}
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
    const CustomList = useMemo(
      () =>
        forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function CustomList({ style, children, ...props }, listRef) {
          return (
            <div
              ref={listRef}
              {...props}
              className={`message-virtuoso-list${props.className ? ` ${props.className}` : ""}`}
              style={{
                ...style,
                boxSizing: "border-box",
                width: "100%",
                minWidth: 0,
                maxWidth: "100%",
              }}
            >
              {children}
            </div>
          );
        }),
      [],
    );
    const listComponents = useMemo(
      () => ({ Scroller: CustomScroller, List: CustomList }),
      [CustomScroller, CustomList],
    );

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
            // Pre-render a buffer below the viewport too, so an appended media
            // message is already measured when followOutput/scrollToIndex runs
            // and the scroll lands precisely instead of guessing from
            // defaultItemHeight.
            increaseViewportBy={{ top: 300, bottom: 300 }}
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

        {isScrolledUp && (
          <button
            type="button"
            className="scroll-to-bottom-btn"
            onClick={scrollToBottom}
            aria-label={
              newMessageCount > 0
                ? `Прокрутить вниз (${newMessageCount} новых сообщени${newMessageCount === 1 ? "е" : "й"})`
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
