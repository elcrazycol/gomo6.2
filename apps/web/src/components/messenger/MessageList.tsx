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
import { useMobileKeyboard } from "@/hooks/useMobileKeyboard";
import type { MessageView } from "./types";
import { isConsecutive, getDateSeparator } from "./messageListUtils";
import { getMaxScrollTop, isNearScrollBottom } from "./scrollUtils";

// firstItemIndex counts down as older messages are prepended (history loads).
// It must never go negative — Virtuoso warns and anchoring misbehaves — so it
// starts at a large value and decreases from there (the "very high value"
// pattern from the Virtuoso docs).
const INITIAL_FIRST_INDEX = 1_000_000;

// Small scrollTop decreases are tolerated before cancelling a follow-settle:
// Virtuoso re-measures a freshly appended item against its height estimate and
// the browser can clamp scrollTop down by a few pixels. Treating that as user
// intent would tear down the late-media settle window. Real user scroll-up is
// still cancelled immediately — wheel and touch already cancel unconditionally.
const SETTLE_CANCEL_TOLERANCE = 8;

// The append-follow holds its first scroll until the freshly appended item has
// been measured. Virtuoso renders it at the default-height estimate first and
// swaps in the real height a frame or two later, which changes the list
// height. Scrolling before that measurement lands short and then visibly
// corrects itself — the twitch / "not quite at the bottom" gap. The settle
// waits for two consecutive frames with the same height (or a hard cap) so the
// view scrolls exactly once, to the true bottom.
const SETTLE_STABLE_FRAMES = 2; // consecutive frames with the same scrollHeight
const SETTLE_MAX_WAIT_FRAMES = 6; // hard cap on the wait phase (~100ms)
const SETTLE_MAX_FRAMES = 24; // total rAF chain length (~400ms); checkpoints take over after

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
  /** Notes self-chat: a filtered view of the store messages (folder filter).
   *  When omitted the full store list is used. */
  messagesOverride?: MessageView[];
}

type ScrollerHandlers = Record<string, unknown>;

/**
 * Owns the react-virtuoso instance and all scroll-position bookkeeping for the
 * open conversation:
 * - stick-to-bottom only when the user is already near the bottom (followOutput),
 * - history prepend via firstItemIndex (keeps virtual indices stable),
 * - always lands on the newest message when the conversation opens,
 * - "N new messages" pill + entrance animation,
 * - mobile swipe-back gesture.
 *
 * It is mounted per conversation (`key={conversation.id}` in ChatView), so all
 * refs/state below reset naturally when switching chats.
 */
export const MessageList = memo(
  forwardRef<MessageListHandle, MessageListProps>(function MessageList({ onBack, renderMessage, messagesOverride }, ref) {
    const conversationId = useMessengerStore((s) => s.selectedConversationId);
    const storeMessages = useMessengerStore((s) => s.messages);
    // Notes self-chat passes a folder-filtered view; regular chats use the full list.
    const messages = messagesOverride ?? storeMessages;
    const openingUnreadCount = useMessengerStore((s) => s.openingUnreadCount);
    const isMessagesLoading = useMessengerStore((s) => s.isMessagesLoading);
    const hasMoreMessages = useMessengerStore((s) => s.hasMoreMessages);
    const isLoadingMore = useMessengerStore((s) => s.isLoadingMore);
    const loadMoreMessages = useMessengerStore((s) => s.loadMoreMessages);

    const virtuosoRef = useRef<VirtuosoHandle>(null);
    const scrollerElRef = useRef<HTMLDivElement | null>(null);

    const [firstItemIndex, setFirstItemIndex] = useState(INITIAL_FIRST_INDEX);
    const [isScrolledUp, setIsScrolledUp] = useState(false);
    const [newMessageCount, setNewMessageCount] = useState(0);
    const [newMessageIds, setNewMessageIds] = useState<Set<string>>(() => new Set());
    const [swipeBackOffset, setSwipeBackOffset] = useState(0);

    const shouldAutoScrollRef = useRef(true);
    const isScrolledUpRef = useRef(false);
    const initialSettleDoneRef = useRef(false);
    const boundaryPositionedRef = useRef(false);
    const touchStartXRef = useRef(0);
    const loadingMoreRef = useRef(false);
    const lastScrollTopRef = useRef(0);
    const [prevFirstId, setPrevFirstId] = useState<string | null>(null);
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
      (options: { force: boolean; initialBehavior: "smooth" | "auto"; ignoreScrolledUp?: boolean }) => {
        const { force, initialBehavior, ignoreScrolledUp = false } = options;
        cancelBottomSettle();
        if (force) isSettlingToBottomRef.current = true;
        let settleFrames = 0;
        let totalFrames = 0;
        let ready = force; // force settles clamp immediately
        let stableChecks = 0;
        let lastSeenHeight = -1;
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
          } else if (!ignoreScrolledUp && !shouldAutoScrollRef.current) {
            // The user left the bottom zone (more than 32px above the bottom)
            // while media was still settling — stop following them. Never
            // yank a scrolled-away user back down: that per-frame fight was
            // the jitter / yank-down / skip regression. The mount settle
            // (ignoreScrolledUp) skips this entirely — Virtuoso's estimate
            // position and its re-measurements fire scroll events that look
            // like a scroll-up while the user never touched anything. Wheel /
            // touch and the scrollTop-decrease check in handleScroll are the
            // only signals that reliably separate real input from
            // re-measurement, and they cancel every settle regardless.
            cleanupSettle();
            return;
          }
          const el = scrollerElRef.current;
          if (!el) return;
          if (!ready) {
            // Hold the first scroll until the list height stops changing (the
            // appended item was just measured). Scrolling during the estimate
            // phase lands short and then visibly corrects itself.
            if (el.scrollHeight === lastSeenHeight) {
              stableChecks += 1;
              if (stableChecks >= SETTLE_STABLE_FRAMES) ready = true;
            } else {
              lastSeenHeight = el.scrollHeight;
              stableChecks = 1;
            }
            return;
          }
          const top = getMaxScrollTop(el.scrollHeight, el.clientHeight);
          if (!isNearScrollBottom(el.scrollTop, el.scrollHeight, el.clientHeight, 2)) {
            el.scrollTo({ top, behavior: firstSettle ? initialBehavior : "auto" });
          }
          // This settle owns the bottom now — clear the transient "scrolled
          // up" flag set by Virtuoso's estimate position, so the next frame
          // (before the browser fires the scroll event for this clamp) does
          // not mistake it for user intent and cancel. Safe even when no
          // scroll happened: that means the view is already at the true
          // bottom, so the flag is stale by definition.
          isScrolledUpRef.current = false;
          setIsScrolledUp(false);
          firstSettle = false;
          // Force settles (FAB / send) stay short-lived: their direct
          // scrollTo already landed exactly, and ending early keeps them from
          // fighting a user who scrolls away right after (the
          // isSettlingToBottomRef lock makes force settles ignore wheel and
          // scroll events). Sent attachments are still covered: when the
          // server replaces the optimistic temp id, the append-effect
          // fallback starts a fresh settle. Non-force settles survive past
          // the first clamps — late media (blob previews decoded with
          // retries) grows the list well after the open/append, and the
          // checkpoints below re-clamp to the true bottom; the scrolled-up
          // gate above already stops them from yanking a user who scrolled
          // away, so a long life cannot fight anyone.
          if (force) {
            settleFrames += 1;
            if (settleFrames >= 8) cleanupSettle();
          }
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
          totalFrames += 1;
          if (!ready && totalFrames >= SETTLE_MAX_WAIT_FRAMES) ready = true;
          if (!cancelled && totalFrames < SETTLE_MAX_FRAMES) rafId = window.requestAnimationFrame(settleNextFrame);
        };
        rafId = window.requestAnimationFrame(settleNextFrame);
        // Protected blob URLs may finish well after the initial frames. These
        // checkpoints keep the settle attached to the real bottom without
        // affecting ordinary user scrolling. Append-follows keep listening
        // longer — remote images can load a few seconds after the message
        // appears, and the ResizeObserver/load listeners catch the growth.
        const checkpoints = force ? [100, 250, 500, 900] : [100, 250, 500, 900, 1500, 2500, 4000];
        for (const delay of checkpoints) {
          timeoutIds.push(window.setTimeout(settleAtBottom, delay));
        }
        timeoutIds.push(window.setTimeout(cleanupSettle, force ? 1200 : 5000));
      },
      [cancelBottomSettle],
    );

    // ── Imperative API (send-scroll, pinned-message jump) ──────────────
    const scrollToBottom = useCallback(() => {
      const scroller = scrollerElRef.current;
      const length = useMessengerStore.getState().messages.length;
      if (length === 0 || !scroller) {
        cancelBottomSettle();
        return;
      }
      shouldAutoScrollRef.current = true;
      scheduleBottomSettle({ force: true, initialBehavior: "smooth" });
      // Exact target from the scroller's real scrollHeight. Virtuoso's
      // scrollToIndex derives the target from default-height estimates
      // (index × defaultItemHeight, clamped to the data range) and can land
      // far from the true bottom — with the large firstItemIndex used for
      // history prepends that estimate is off by orders of magnitude and
      // Firefox animates the view upward while the target is clamped.
      scroller.scrollTo({
        top: getMaxScrollTop(scroller.scrollHeight, scroller.clientHeight),
        behavior: "smooth",
      });
      isScrolledUpRef.current = false;
      setIsScrolledUp(false);
      setNewMessageCount(0);
    }, [cancelBottomSettle, scheduleBottomSettle]);

    const scrollToMessage = useCallback((messageId: string) => {
      const index = useMessengerStore.getState().messages.findIndex((m) => m.id === messageId);
      if (index < 0) return;
      // Virtuoso's scrollToIndex clamps the index to the data range
      // [0, totalCount-1], so pass the DATA index, not the virtual one
      // (data + firstItemIndex). With the large firstItemIndex start the
      // virtual index would always clamp to the last item and pinned jumps
      // would land at the bottom.
      virtuosoRef.current?.scrollToIndex({
        index,
        align: "center",
        behavior: "smooth",
      });
    }, []);

    useImperativeHandle(ref, () => ({ scrollToBottom, scrollToMessage }), [scrollToBottom, scrollToMessage]);

    useEffect(() => () => cancelBottomSettle(), [cancelBottomSettle]);

    // ── Land exactly on the true bottom when a conversation opens ──────
    // Virtuoso's initial align-end is computed from default-height estimates
    // (64px), so with tall content (images) it stops ABOVE the real bottom.
    // One settle per open pins the view to maxScrollTop and keeps re-clamping
    // while late media (blob previews decoded with retries) grows the list —
    // the checkpoints survive past the first clamps, so the view ends exactly
    // at the bottom, matching the FAB. The settle ignores the "scrolled up"
    // indicators entirely: Virtuoso's estimate position and its
    // re-measurements fire scroll events that look like scroll-up while the
    // user never touched anything. Wheel/touch and a real scrollTop decrease
    // (handleScroll, >8px) still cancel it, so a genuine scroll-up can never
    // fight it. Opening on an unread boundary is positioned by the boundary
    // effect instead.
    useEffect(() => {
      if (openingUnreadCount > 0 || messages.length === 0 || initialSettleDoneRef.current) return;
      initialSettleDoneRef.current = true;
      scheduleBottomSettle({ force: false, initialBehavior: "auto", ignoreScrolledUp: true });
    }, [openingUnreadCount, messages.length, scheduleBottomSettle]);

    // ── Unread boundary: position from the authoritative network data ──
    // At mount the message array is the IndexedDB cache, which on the first
    // open after a reload lags the network by the newest messages. A boundary
    // computed from it (`length - unread`) would land above the real first
    // unread and hide the newest messages below the fold. Position only after
    // the network load finishes (isMessagesLoading flips false), so the index
    // is computed against the network snapshot.
    useEffect(() => {
      if (openingUnreadCount <= 0 || boundaryPositionedRef.current) return;
      if (isMessagesLoading || messages.length === 0) return;
      boundaryPositionedRef.current = true;
      virtuosoRef.current?.scrollToIndex({
        index: Math.max(0, messages.length - openingUnreadCount),
        align: "start",
        behavior: "auto",
      });
    }, [isMessagesLoading, messages.length, openingUnreadCount]);

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
      // A user scrolling up must cancel any active follow-settle immediately.
      // Otherwise the clamp keeps pulling the view back down — visible as
      // jitter in the lower part of the list while reading history. (Our own
      // clamps only ever increase scrollTop, so a decrease means the user.)
      // The tolerance keeps tiny re-measurement clamps from killing the
      // settle; real intent is covered by wheel/touch cancels too.
      if (el.scrollTop < lastScrollTopRef.current - SETTLE_CANCEL_TOLERANCE) {
        cancelBottomSettle();
      }
      lastScrollTopRef.current = el.scrollTop;
      shouldAutoScrollRef.current = isNearScrollBottom(el.scrollTop, el.scrollHeight, el.clientHeight, 32);
      const nowScrolledUp = distance > 128;
      if (nowScrolledUp !== isScrolledUpRef.current) {
        isScrolledUpRef.current = nowScrolledUp;
        setIsScrolledUp(nowScrolledUp);
      }
      if (distance <= 32) setNewMessageCount(0);
    }, [cancelBottomSettle]);


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
              // The transient "scrolled up" flag from Virtuoso's estimate
              // position can land here on the first open after a reload too —
              // no settle is scheduled, which is safe: the mount settle
              // (ignoreScrolledUp) is still alive and clamps to the true
              // bottom itself.
              const incoming = appended.filter((m) => m.localStatus !== "sending").length;
              if (incoming > 0) setNewMessageCount((count) => count + incoming);
            } else if (shouldAutoScrollRef.current) {
              // At the bottom: do NOT scroll right away — the freshly appended
              // item renders at its default-height estimate first and Virtuoso
              // measures the real height a frame or two later (which changes
              // the list height). Scrolling before that measurement lands
              // short and then visibly corrects itself — the twitch / gap.
              // The settle holds the first scroll until the height is stable
              // and then clamps exactly once, to the true bottom.
              scheduleBottomSettle({ force: false, initialBehavior: "auto" });
            }
          }
        } else if (!isScrolledUpRef.current && shouldAutoScrollRef.current) {
          // The snapshot replaced the whole tail — the cached last message is
          // gone (cache → network replace after a reload, or the tail changed
          // wholesale). The conversation was just opened at the stale bottom:
          // pin to the new bottom so the newest messages stay visible. The
          // appended count is unknown here, so no pill — just the follow.
          scheduleBottomSettle({ force: false, initialBehavior: "auto" });
        }
      }
      prevLastIdRef.current = lastId;
    }, [messages, scheduleBottomSettle]);

    // ── Reset auto-scroll when the mobile keyboard opens/closes ────────
    // Any visual-viewport change (URL bar collapse, keyboard) shrinks the
    // list; if the user is at the bottom, keep them pinned there.
    const keyboardOpen = useMobileKeyboard().isOpen;
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

    // The keyboard opening shrinks the visible area (the messenger is sized
    // to --app-vh): re-settle to the true bottom so the newest messages stay
    // above the keyboard. Never yank a user who scrolled up.
    useEffect(() => {
      if (!keyboardOpen) return;
      const timer = window.setTimeout(() => {
        if (isScrolledUpRef.current) return;
        shouldAutoScrollRef.current = true;
        scheduleBottomSettle({ force: false, initialBehavior: "auto" });
      }, 180);
      return () => window.clearTimeout(timer);
    }, [keyboardOpen, scheduleBottomSettle]);

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
      onWheel: (_event: ReactWheelEvent<HTMLDivElement>) => {
        // Never break a force settle (FAB smooth scroll) mid-flight — a stray
        // wheel tick must not drop the isSettlingToBottomRef lock.
        if (!isSettlingToBottomRef.current) cancelBottomSettle();
      },
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
    // Real bottom gap between the last message and the composer. This must be
    // a list element, not scroller padding: Virtuoso aligns items to the
    // viewport bottom and would keep scroller padding below the fold (the
    // "no spacing" bug). The footer is measured and included in the scroll
    // math, so the gap is always visible at the bottom — on open, after a
    // send, and when new messages arrive.
    const MessageListFooter = useMemo(
      () =>
        function MessageListFooter() {
          return <div className="message-list-footer" aria-hidden="true" />;
        },
      [],
    );
    // Top spinner while older history is fetched (startReached → load more).
    // It reads the store directly so the components object stays stable — a
    // changing components identity would make Virtuoso redo internal
    // subscriptions. Only this header re-renders when the flag flips.
    const HistoryLoaderHeader = useMemo(
      () =>
        function HistoryLoaderHeader() {
          const isLoadingMore = useMessengerStore((s) => s.isLoadingMore);
          if (!isLoadingMore) return null;
          return (
            <div className="msg-history-loader" role="status" aria-live="polite">
              <span className="msg-history-loader-spinner" aria-hidden="true" />
              <span>Загружаем историю…</span>
            </div>
          );
        },
      [],
    );
    const listComponents = useMemo(
      () => ({
        Scroller: CustomScroller,
        List: CustomList,
        Header: HistoryLoaderHeader,
        Footer: MessageListFooter,
      }),
      [CustomScroller, CustomList, HistoryLoaderHeader, MessageListFooter],
    );

    // ── Keep virtual indices stable when older messages are prepended ──
    // This must happen in the SAME render as the messages change (render-phase
    // update — React re-renders before the browser paints). Adjusting
    // firstItemIndex in a passive effect paints one frame where every item
    // window is shifted by the prepend count — the visible flicker every time
    // older history loads. Covers both the "load history" path and the
    // cache → network replace (the cached first message usually survives
    // inside the network snapshot, so anchoring on it keeps the position).
    if (messages.length > 0) {
      // Identity key matches the store's dedup key (id || client_id), so a
      // temp message later replaced by its server twin counts as the same
      // anchor and never triggers a spurious index shift.
      const currentFirst = messages[0].id || messages[0].client_id;
      if (prevFirstId !== null && currentFirst !== prevFirstId) {
        const index = messages.findIndex((m) => (m.id || m.client_id) === prevFirstId);
        if (index > 0) setFirstItemIndex((f) => f - index);
        setPrevFirstId(currentFirst);
      } else if (prevFirstId === null) {
        setPrevFirstId(currentFirst);
      }
    }

    if (messages.length === 0) return null;

    // First paint: the unread boundary when the conversation has unread
    // (computed from the array in hand — the IndexedDB cache at mount),
    // otherwise the very bottom. The boundary is re-anchored to the
    // authoritative network snapshot once the load finishes (boundary effect
    // below), and the mount settle pins unread-free conversations to the
    // exact bottom.
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
            // followOutput is disabled on purpose: Virtuoso's built-in follow
            // scrolls to the last *item* using height estimates and can land
            // short of the true bottom (visible as a jump up / stuck history).
            // The append effect drives the follow manually with the
            // container's real scrollHeight, which is exact.
            followOutput={false}
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

        {isScrolledUp && (
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
