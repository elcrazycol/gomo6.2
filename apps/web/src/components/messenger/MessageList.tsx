import {
  memo,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { ChevronDown } from "lucide-react";
import { useMessengerStore } from "@/stores/messengerStore";
import { useMobileKeyboard } from "@/hooks/useMobileKeyboard";
import type { MessageView } from "./types";
import { isConsecutive, getDateSeparator } from "./messageListUtils";

// firstItemIndex counts down as older messages are prepended (history loads).
// It must never go negative — Virtuoso warns and anchoring misbehaves — so it
// starts at a large value and decreases from there (the "very high value"
// pattern from the Virtuoso docs).
const INITIAL_FIRST_INDEX = 1_000_000;

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
 * Owns the react-virtuoso instance for the open conversation:
 *  - opens on the unread boundary or the very bottom (initialTopMostItemIndex),
 *  - stick-to-bottom follows via Virtuoso's native followOutput (only while
 *    the user is at the bottom — never yanks someone reading history),
 *  - older history is loaded at the top (startReached) and prepended via
 *    firstItemIndex, keeping virtual indices stable so the view never jumps,
 *  - "N new messages" pill + entrance animation for realtime appends,
 *  - the mobile keyboard / URL-bar resize keeps the bottom pinned while the
 *    layout shrinks.
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
    const openingUnreadCount = useMessengerStore((s) => s.openingUnreadCount);
    const isMessagesLoading = useMessengerStore((s) => s.isMessagesLoading);
    const hasMoreMessages = useMessengerStore((s) => s.hasMoreMessages);
    const isLoadingMore = useMessengerStore((s) => s.isLoadingMore);
    const loadMoreMessages = useMessengerStore((s) => s.loadMoreMessages);

    const virtuosoRef = useRef<VirtuosoHandle>(null);

    const [firstItemIndex, setFirstItemIndex] = useState(INITIAL_FIRST_INDEX);
    const [isAtBottom, setIsAtBottom] = useState(true);
    const [newMessageCount, setNewMessageCount] = useState(0);
    const [newMessageIds, setNewMessageIds] = useState<Set<string>>(() => new Set());

    const isAtBottomRef = useRef(true);
    const loadingMoreRef = useRef(false);
    const boundaryPositionedRef = useRef(false);
    const [prevFirstId, setPrevFirstId] = useState<string | null>(null);
    const prevLastIdRef = useRef<string | null>(null);

    const handleAtBottomChange = useCallback((atBottom: boolean) => {
      isAtBottomRef.current = atBottom;
      setIsAtBottom(atBottom);
      if (atBottom) setNewMessageCount(0);
    }, []);

    // ── Imperative API (send-scroll, pinned-message jump) ──────────────
    const scrollToBottom = useCallback(() => {
      const length = useMessengerStore.getState().messages.length;
      if (length === 0) return;
      virtuosoRef.current?.scrollToIndex({
        index: length - 1,
        align: "end",
        behavior: "smooth",
      });
      isAtBottomRef.current = true;
      setIsAtBottom(true);
      setNewMessageCount(0);
    }, []);

    const scrollToMessage = useCallback((messageId: string) => {
      const index = useMessengerStore.getState().messages.findIndex((m) => m.id === messageId);
      if (index < 0) return;
      // Virtuoso's scrollToIndex takes the DATA index (0-based); with the
      // large firstItemIndex used for history prepends the virtual index
      // would clamp to the data range and pinned jumps would land at the
      // bottom.
      virtuosoRef.current?.scrollToIndex({
        index,
        align: "center",
        behavior: "smooth",
      });
    }, []);

    useImperativeHandle(ref, () => ({ scrollToBottom, scrollToMessage }), [scrollToBottom, scrollToMessage]);

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

    // ── Detect realtime appends → "N new messages" pill + animation ────
    // Scrolling to the bottom on append is left to Virtuoso's native
    // followOutput (see below), which only follows while the user is at the
    // bottom — no custom scroll code, no fights with user scrolling.
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

    // ── Keyboard / visual-viewport resize: keep the bottom pinned ──────
    // Opening the soft keyboard (or collapsing the URL bar) shrinks the
    // visible area; if the user is at the bottom, stay pinned there through
    // the resize instead of leaving the newest messages under the fold.
    const keyboardOpen = useMobileKeyboard().isOpen;
    useEffect(() => {
      const vv = window.visualViewport;
      if (!vv) return;
      let timer: ReturnType<typeof setTimeout>;
      const onResize = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (!isAtBottomRef.current) return;
          const length = useMessengerStore.getState().messages.length;
          if (length === 0) return;
          virtuosoRef.current?.scrollToIndex({ index: length - 1, align: "end", behavior: "auto" });
        }, 60);
      };
      vv.addEventListener("resize", onResize);
      vv.addEventListener("scroll", onResize);
      return () => {
        vv.removeEventListener("resize", onResize);
        vv.removeEventListener("scroll", onResize);
        clearTimeout(timer);
      };
      // Re-arm when the keyboard toggles: the previous timer may have fired
      // while the layout was still mid-transition.
    }, [keyboardOpen]);

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

    // First paint: the unread boundary when the conversation has unread,
    // otherwise the very bottom. Align-to-bottom keeps the newest message
    // pinned above the composer; followOutput (callback form) follows new
    // appends only while the user is at the bottom — reading history is never
    // interrupted.
    const initialTopMostItemIndex =
      openingUnreadCount > 0
        ? { index: Math.max(0, messages.length - openingUnreadCount), align: "start" as const }
        : { index: Math.max(0, messages.length - 1), align: "end" as const };

    // The scroller carries the chat scroll classes + a11y role. The Footer
    // renders the real bottom gap (list element, not padding, so it is
    // included in the scroll math). The Header shows the history loader while
    // older messages are fetched; it reads the store directly so the
    // components object stays stable (a changing identity would make Virtuoso
    // redo its internal subscriptions).
    const CustomScroller = useMemo(
      () =>
        forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function CustomScroller({ className, ...props }, scrollerRef) {
          return (
            <div
              ref={scrollerRef}
              {...props}
              className={`message-scroll${className ? ` ${className}` : ""}`}
              role="log"
              aria-label="Сообщения"
              aria-live="polite"
            />
          );
        }),
      [],
    );
    const CustomList = useMemo(
      () =>
        forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function CustomList({ className, style, children, ...props }, listRef) {
          return (
            <div
              ref={listRef}
              {...props}
              className={`message-virtuoso-list${className ? ` ${className}` : ""}`}
              style={{ ...style, boxSizing: "border-box", width: "100%", minWidth: 0, maxWidth: "100%" }}
            >
              {children}
            </div>
          );
        }),
      [],
    );
    const MessageListFooter = useMemo(
      () =>
        function MessageListFooter() {
          return <div className="message-list-footer" aria-hidden="true" />;
        },
      [],
    );
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
      () => ({ Scroller: CustomScroller, List: CustomList, Header: HistoryLoaderHeader, Footer: MessageListFooter }),
      [CustomScroller, CustomList, HistoryLoaderHeader, MessageListFooter],
    );

    if (messages.length === 0) return null;

    return (
      <>
        <div className="message-scroll-wrap">
          <Virtuoso
            ref={virtuosoRef}
            totalCount={messages.length}
            firstItemIndex={firstItemIndex}
            initialTopMostItemIndex={initialTopMostItemIndex}
            alignToBottom={openingUnreadCount === 0}
            followOutput={(atBottom) => (atBottom ? "smooth" : false)}
            atBottomStateChange={handleAtBottomChange}
            computeItemKey={(index) => {
              const message = messages[index - firstItemIndex];
              return message ? (message.client_id ?? message.id) : index;
            }}
            startReached={handleStartReached}
            increaseViewportBy={{ top: 300, bottom: 200 }}
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
