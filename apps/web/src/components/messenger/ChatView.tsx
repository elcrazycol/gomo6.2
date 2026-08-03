import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useDrag } from "@use-gesture/react";
import { ArrowLeft, ChevronDown, MessageCircle, Pin, Gift } from "lucide-react";
import { PentagramLoader } from "@/components/PentagramLoader";
import { UserBadge } from "@/components/UserBadge";
import { storageUrl } from "@/utils/storage";
import { useMessengerStore, selectSelectedConversation, queueMarkDelivered, queueMarkRead } from "@/stores/messengerStore";
import { formatPresence, getInitials, getUserColorClass } from "./utils";
import { MessageBubble } from "./MessageBubble";
import { MessageComposer } from "./MessageComposer";
import { UserInfoPanel } from "./UserInfoPanel";
import { parseGiftContent, GiftDetailDialog } from "./MessageContent";
import type { Attachment, MessageView, ReceiptRow } from "./types";
import { estimatePrependedHeight } from "./scrollUtils";

function estimateMessageHeight(msg: MessageView): number {
  const lines = Math.max(1, (msg.content.match(/\n/g)?.length ?? 0) + 1);
  let height = 48 + lines * 20;
  if (msg.parent_message_id) height += 36;
  if (msg.attachments && msg.attachments.length > 0) {
    height += msg.attachments.reduce((total, attachment) => {
      if (attachment.type === "image" || attachment.type === "video") return total + 184;
      if (attachment.type === "audio") return total + 48;
      return total + 52;
    }, 0);
  }
  return Math.min(height, 500);
}

interface Props {
  onBack: () => void;
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
  endRef: React.RefObject<HTMLDivElement | null>;
  typingUsername?: string | null;
  onTyping: (isTyping: boolean) => void;
}

export const ChatView = memo(function ChatView({
  onBack,
  composerRef,
  endRef,
  typingUsername,
  onTyping,
}: Props) {
  const conversation = useMessengerStore(selectSelectedConversation);
  const openingUnreadCount = useMessengerStore((s) => s.openingUnreadCount);
  const messages = useMessengerStore((s) => s.messages);
  const isLoading = useMessengerStore((s) => s.isMessagesLoading);
  const isLoadingMore = useMessengerStore((s) => s.isLoadingMore);
  const hasMoreMessages = useMessengerStore((s) => s.hasMoreMessages);
  const isSending = useMessengerStore((s) => s.isSending);
  const me = useMessengerStore((s) => s.me);
  const receipts = useMessengerStore((s) => s.receipts);
  const error = useMessengerStore((s) => s.error);
  const setError = useMessengerStore((s) => s.setError);

  const sendMessage = useMessengerStore((s) => s.sendMessage);
  const editMessage = useMessengerStore((s) => s.editMessage);
  const deleteMessage = useMessengerStore((s) => s.deleteMessage);
  const togglePin = useMessengerStore((s) => s.togglePin);
  const loadMoreMessages = useMessengerStore((s) => s.loadMoreMessages);

  const [draft, setDraft] = useState("");
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [pinnedText, setPinnedText] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState<string>("");
  const [showUserInfo, setShowUserInfo] = useState(false);
  const [giftDetailId, setGiftDetailId] = useState<string | null>(null);
  const [giftDetailRecipientId, setGiftDetailRecipientId] = useState<string | null>(null);
  const [replyToMessage, setReplyToMessage] = useState<MessageView | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [newMessageIds, setNewMessageIds] = useState<Set<string>>(new Set());
  const [swipeBackOffset, setSwipeBackOffset] = useState(0);
  const [isInitialPositioning, setIsInitialPositioning] = useState(false);
  const shouldAutoScroll = useRef(true);
  const isScrolledUpRef = useRef(false);
  const touchStartXRef = useRef(0);

  const convReceipts = receipts.get(conversation?.id ?? "") ?? [];
  const latestMessageId = messages[messages.length - 1]?.id;
  const latestMessageSentAt = messages[messages.length - 1]?.sent_at;

  // Swipe-back gesture (mobile only)
  const isTouchDevice = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;

  const swipeBackBind = useDrag(
    ({ movement: [mx], last, active }) => {
      if (!isTouchDevice) return;
      // Only activate for edge swipes from left side
      if (touchStartXRef.current > 30) return;
      const el = scrollContainerRef.current;
      if (el && el.scrollTop > 5) return;

      if (active) {
        const offset = Math.max(0, Math.min(200, mx));
        setSwipeBackOffset(offset);
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
    {
      axis: "x",
      filterTaps: true,
      from: () => [0, 0],
      threshold: 10,
    },
  );

  // Virtual scroll
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isLoadingMoreRef = useRef(false);
  const loadMoreRequestRef = useRef(0);
  const initializedConversationRef = useRef<string | null>(null);
  const initialPositionedConversationRef = useRef<string | null>(null);
  const initialPositioningPendingRef = useRef(false);
  const initialUnreadCountRef = useRef(0);
  const previousMessageBoundaryRef = useRef<{
    conversationId: string;
    firstId: string;
    lastId: string;
    count: number;
  } | null>(null);
  const prependAnchorRef = useRef<{
    conversationId: string;
    boundaryMessageId: string;
    estimatedDeltaApplied: boolean;
  } | null>(null);
  const applyingScrollRef = useRef(false);
  const scrollOperationRef = useRef(0);
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: (index) => estimateMessageHeight(messages[index]),
    getItemKey: (index) => messages[index]?.id ?? index,
    // Keep resize notifications on animation frames so media/link previews
    // are measured in one browser frame instead of several competing layouts.
    // TanStack remains responsible for correcting measured-size differences.
    useAnimationFrameWithResizeObserver: true,
    overscan: 5,
  });


  // Auto-scroll to bottom — direct DOM for reliability
  const pinToBottom = useCallback(() => {
    const operation = ++scrollOperationRef.current;
    requestAnimationFrame(() => {
      const el = scrollContainerRef.current;
      if (!el || operation !== scrollOperationRef.current) return;
      applyingScrollRef.current = true;
      el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
      requestAnimationFrame(() => {
        if (operation === scrollOperationRef.current) applyingScrollRef.current = false;
      });
    });
  }, []);

  const smoothScrollToBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const operation = ++scrollOperationRef.current;
    const target = el.scrollHeight - el.clientHeight;
    if (target <= el.scrollTop) return;
    const start = el.scrollTop;
    const distance = target - start;
    const duration = 250;
    let startTime: number | null = null;
    const step = (ts: number) => {
      if (!startTime) startTime = ts;
      const progress = Math.min((ts - startTime) / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3);
      if (operation !== scrollOperationRef.current || !scrollContainerRef.current) return;
      el.scrollTop = start + distance * ease;
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, []);

  // Position a conversation exactly once, after its first message snapshot is
  // available. The unread count is captured on conversation switch because it
  // is reset synchronously as soon as the chat is opened.
  useLayoutEffect(() => {
    if (!conversation?.id) {
      initializedConversationRef.current = null;
      scrollOperationRef.current += 1;
      initialPositionedConversationRef.current = null;
      initialPositioningPendingRef.current = false;
      setIsInitialPositioning(false);
      initialUnreadCountRef.current = 0;
      previousMessageBoundaryRef.current = null;
      prependAnchorRef.current = null;
      isLoadingMoreRef.current = false;
      loadMoreRequestRef.current += 1;
      return;
    }

    if (initializedConversationRef.current !== conversation.id) {
      initializedConversationRef.current = conversation.id;
      scrollOperationRef.current += 1;
      initialPositionedConversationRef.current = null;
      initialPositioningPendingRef.current = false;
      setIsInitialPositioning(true);
      initialUnreadCountRef.current = openingUnreadCount;
      previousMessageBoundaryRef.current = null;
      prependAnchorRef.current = null;
      isLoadingMoreRef.current = false;
      loadMoreRequestRef.current += 1;
      shouldAutoScroll.current = true;
      isScrolledUpRef.current = false;
      setIsScrolledUp(false);
      setNewMessageCount(0);
      setNewMessageIds(new Set());
    }

    // Cached rows are intentionally kept invisible until the authoritative
    // request completes. This prevents a cache -> network replacement from
    // exposing an intermediate scroll position for one or two frames.
    if (messages.length === 0 || isLoading) {
      if (messages.length === 0 && !isLoading) setIsInitialPositioning(false);
      return;
    }
    if (initialPositionedConversationRef.current === conversation.id) return;

    initialPositionedConversationRef.current = conversation.id;
    initialPositioningPendingRef.current = true;
    const unreadCount = initialUnreadCountRef.current;
    const positioningConversationId = conversation.id;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (
          initializedConversationRef.current !== positioningConversationId
          || initialPositionedConversationRef.current !== positioningConversationId
          || useMessengerStore.getState().selectedConversationId !== positioningConversationId
        ) return;

        const currentMessages = useMessengerStore.getState().messages;
        if (unreadCount > 0 && currentMessages.length > 0) {
          const idx = Math.max(0, currentMessages.length - unreadCount);
          virtualizer.scrollToIndex(idx, { align: "start", behavior: "auto" });
        } else {
          pinToBottom();
        }
        // Do not let a cache-to-network replacement be interpreted as an
        // append while the initial viewport is being established.
        initialPositioningPendingRef.current = false;
        setIsInitialPositioning(false);
      });
    });
    composerRef.current?.focus();
  }, [conversation?.id, openingUnreadCount, messages.length, isLoading, pinToBottom, virtualizer, composerRef]);

  // Sync ref with state for stable callback
  useEffect(() => { isScrolledUpRef.current = isScrolledUp; }, [isScrolledUp]);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    if (!applyingScrollRef.current) scrollOperationRef.current += 1;

    // Never rewrite the current scroll position from a stale request callback.
    // The prepend layout effect below always applies its delta to this latest
    // value, so a fast drag remains under the user's control.

    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldAutoScroll.current = dist <= 32;
    const nowScrolledUp = dist > 128;
    if (nowScrolledUp !== isScrolledUpRef.current) {
      setIsScrolledUp(nowScrolledUp);
    }
    if (dist <= 32) {
      setNewMessageCount(0);
    }

    if (el.scrollTop < 50 && hasMoreMessages && !isLoadingMore && !isLoadingMoreRef.current && conversation?.id) {
      isLoadingMoreRef.current = true;
      const loadRequestId = ++loadMoreRequestRef.current;
      const loadConversationId = conversation.id;
      const anchorBoundaryId = messages[0]?.id ?? "";
      prependAnchorRef.current = {
        conversationId: loadConversationId,
        boundaryMessageId: messages[0]?.id ?? "",
        estimatedDeltaApplied: false,
      };
      loadMoreMessages(loadConversationId).then(() => {
        if (loadMoreRequestRef.current !== loadRequestId || initializedConversationRef.current !== loadConversationId) return;
        requestAnimationFrame(() => {
          if (loadMoreRequestRef.current !== loadRequestId || initializedConversationRef.current !== loadConversationId) return;
          // The layout effect applies the prepend estimate and clears the
          // anchor after that one correction. Measured-size corrections are
          // handled by TanStack itself.
          isLoadingMoreRef.current = false;
          if (useMessengerStore.getState().messages[0]?.id === anchorBoundaryId) {
            prependAnchorRef.current = null;
          }
        });
      }).catch(() => {
        if (loadMoreRequestRef.current !== loadRequestId || initializedConversationRef.current !== loadConversationId) return;
        isLoadingMoreRef.current = false;
        prependAnchorRef.current = null;
      });
    }
  }, [hasMoreMessages, isLoadingMore, conversation?.id, loadMoreMessages, messages]);

  // Keep the current viewport stable when older rows are inserted. We apply
  // only the estimate for rows actually added before the old boundary; later
  // image/text measurement differences are left to TanStack's normal adjustment
  // path, avoiding a second competing manual correction.
  useLayoutEffect(() => {
    const anchor = prependAnchorRef.current;
    const el = scrollContainerRef.current;
    if (!anchor || !el || anchor.conversationId !== conversation?.id || anchor.estimatedDeltaApplied) return;

    const estimatedDelta = estimatePrependedHeight(messages, anchor.boundaryMessageId, estimateMessageHeight);
    if (estimatedDelta <= 0) {
      // The boundary can remain first while a realtime append arrives during
      // the pending history request. Keep the anchor armed until the request
      // callback confirms either a prepend or an empty response.
      return;
    }
    applyingScrollRef.current = true;
    el.scrollTop = Math.max(0, el.scrollTop + estimatedDelta);
    anchor.estimatedDeltaApplied = true;
    prependAnchorRef.current = null;
    requestAnimationFrame(() => { applyingScrollRef.current = false; });
  }, [conversation?.id, messages]);

  // Distinguish a prepend (history) from an append (new message). Treating
  // prepended history as new messages was another source of jumps and false
  // "new messages" counters.
  useEffect(() => {
    if (!conversation?.id || messages.length === 0) {
      if (!conversation?.id) previousMessageBoundaryRef.current = null;
      return;
    }

    const previous = previousMessageBoundaryRef.current;
    const firstId = messages[0].id;
    const lastId = messages[messages.length - 1].id;

    if (!initialPositioningPendingRef.current && previous && previous.conversationId === conversation.id && messages.length > previous.count) {
      const isPrepend = firstId !== previous.firstId && lastId === previous.lastId;
      if (!isPrepend) {
        const appended = messages.slice(previous.count);
        const newIds = appended.map((message) => message.id);
        if (newIds.length > 0) {
          setNewMessageIds((prev) => {
            const next = new Set(prev);
            for (const id of newIds) next.add(id);
            return next;
          });
        }
        if (shouldAutoScroll.current) {
          requestAnimationFrame(() => {
            virtualizer.scrollToIndex(messages.length - 1, { align: "end", behavior: "auto" });
          });
        } else if (isScrolledUpRef.current) {
          setNewMessageCount((count) => count + appended.length);
        }
      }
    }

    previousMessageBoundaryRef.current = {
      conversationId: conversation.id,
      firstId,
      lastId,
      count: messages.length,
    };
  }, [conversation?.id, messages, virtualizer]);

  // Reset auto-scroll when viewport changes (keyboard open/close)
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let keyboardTimer: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(keyboardTimer);
      keyboardTimer = setTimeout(() => {
        if (isScrolledUpRef.current) return;
        shouldAutoScroll.current = true;
      }, 150);
    };
    vv.addEventListener("resize", onResize);
    return () => {
      vv.removeEventListener("resize", onResize);
      clearTimeout(keyboardTimer);
    };
  }, []);

  // Escape key to go back to conversation list
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !editingMessageId) {
        onBack();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onBack, editingMessageId]);

  // Mark last message delivered + read when new messages arrive (batched)
  useEffect(() => {
    if (!me?.id || !conversation || messages.length === 0) return;
    const lastOther = [...messages].reverse().find(
      (m) => m.sender_user_id !== me.id && !m.is_deleted && !m.localStatus,
    );
    if (lastOther) {
      queueMarkDelivered(conversation.id, lastOther.id, lastOther.sent_at);
      queueMarkRead(conversation.id, lastOther.id, lastOther.sent_at);
    }
  }, [messages.length, latestMessageId, latestMessageSentAt, conversation?.id]);

  // Pinned message fetch
  useEffect(() => {
    const pid = conversation?.pinned_message_id;
    if (!pid) { setPinnedText(null); return; }
    const found = messages.find((m) => m.id === pid);
    if (found) {
      setPinnedText(found.is_deleted ? "[Удалено]" : found.content.slice(0, 100));
    } else {
      setPinnedText("[Нажмите чтобы открыть]");
    }
  }, [conversation?.pinned_message_id, messages]);

  const handleReply = useCallback((msg: MessageView) => {
    setReplyToMessage(msg);
    setTimeout(() => composerRef.current?.focus(), 50);
  }, [composerRef]);

  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text).catch(() => {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    });
  }, []);

  const handleCancelReply = useCallback(() => setReplyToMessage(null), []);

  const handleSend = useCallback(() => {
    if ((!draft.trim() && pendingAttachments.length === 0) || isSending) return;
    const wasAtBottom = shouldAutoScroll.current;
    const clientId = `c${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    sendMessage(draft.trim() || " ", clientId, replyToMessage?.id ?? undefined, pendingAttachments.length > 0 ? pendingAttachments : undefined);
    setDraft("");
    setReplyToMessage(null);
    setPendingAttachments([]);
    // Sending from a scrolled-up position must not yank the reader away from
    // history. Only follow the optimistic message when already at the bottom.
    if (wasAtBottom) setTimeout(smoothScrollToBottom, 100);
  }, [draft, isSending, sendMessage, smoothScrollToBottom, replyToMessage, pendingAttachments]);

  const handleStartEdit = useCallback((msgId: string, content: string) => {
    setEditingMessageId(msgId);
    setEditingContent(content);
    setDraft(content);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingMessageId(null);
    setEditingContent("");
    setDraft("");
  }, []);

  const handleSaveEdit = useCallback((msgId: string, content: string) => {
    if (content.trim() && content.trim() !== editingContent) {
      editMessage(msgId, content.trim());
    }
    setEditingMessageId(null);
    setEditingContent("");
    setDraft("");
  }, [editMessage, editingContent]);

  const scrollToBottom = useCallback(() => {
    shouldAutoScroll.current = true;
    pinToBottom();
    setIsScrolledUp(false);
    setNewMessageCount(0);
  }, [pinToBottom]);

  const scrollToPinned = useCallback(() => {
    const pid = conversation?.pinned_message_id;
    if (!pid) return;
    const idx = messages.findIndex((m) => m.id === pid);
    if (idx >= 0) {
      virtualizer.scrollToIndex(idx, { align: "center", behavior: "smooth" });
    }
  }, [conversation?.pinned_message_id, messages, virtualizer]);

  const getPeerReceipt = (msgId: string): ReceiptRow | undefined => {
    return convReceipts.find((r) => r.message_id === msgId && r.user_id !== me?.id);
  };

  const getQuotedMessage = (parentId: string | null): MessageView | null => {
    if (!parentId) return null;
    return messages.find((m) => m.id === parentId) ?? null;
  };

  const getDateSeparator = (prev: MessageView | null, curr: MessageView): string | null => {
    const currDate = new Date(curr.sent_at).toDateString();
    if (prev && new Date(prev.sent_at).toDateString() === currDate) return null;

    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();

    if (currDate === today) return "сегодня";
    if (currDate === yesterday) return "вчера";
    return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(new Date(curr.sent_at));
  };

  if (!conversation || !me) {
    return (
      <div className="empty-thread hero chat-empty-state">
        <MessageCircle size={18} />
        <h2>Выбери диалог</h2>
        <p>Открой переписку слева или начни разговор из профиля любого пользователя.</p>
      </div>
    );
  }

  return (
    <>
      {/* Header group: topbar + pinned banner — one grid row */}
      <div className="chat-header-group">
        <div className="chat-topbar" onClick={() => setShowUserInfo(true)}>
          <div className="chat-topbar-main">
            <button type="button" className="mobile-only messenger-back-button" onClick={(e) => { e.stopPropagation(); onBack(); }} aria-label="Назад">
              <ArrowLeft size={16} />
            </button>
            <div className="avatar small">
              {conversation.is_group ? (
                <span>{conversation.group_name ? conversation.group_name.slice(0, 2).toUpperCase() : "ГР"}</span>
              ) : conversation.other_avatar_url ? (
                <img src={storageUrl("post-images", conversation.other_avatar_url) || undefined} alt={conversation.other_username || ""} />
              ) : (
                <span>{getInitials(conversation.other_username || "")}</span>
              )}
            </div>
            <div className="chat-topbar-info">
              <div className="chat-topbar-username flex items-center gap-1">
                {conversation.is_group ? (
                  <span className="font-bold text-sm">{conversation.group_name || "Группа"}</span>
                ) : (
                  <UserBadge userId={conversation.other_user_id || ""} username={conversation.other_username || ""} displayName={conversation.other_display_name} showOutline={false} disableLink />
                )}
              </div>
              <p className="presence-copy">
                {typingUsername
                  ? <em>{conversation.is_group ? "печатают..." : "печатает..."}</em>
                  : conversation.is_group
                    ? `${conversation.member_count} участник${conversation.member_count === 1 ? "" : conversation.member_count < 5 ? "а" : "ов"}`
                    : formatPresence(conversation.other_is_online, conversation.other_last_seen_at)
                }
              </p>
            </div>
          </div>
        </div>

        {/* Pinned message banner — below topbar, above messages */}
        {conversation.pinned_message_id && pinnedText && (
          <div className="pinned-message-banner" onClick={scrollToPinned}>
            <div className="pinned-message-icon"><Pin size={12} /></div>
            <div className="pinned-message-content">
              <p className="pinned-message-text">{pinnedText}</p>
            </div>
            <button type="button" className="pinned-message-jump" title="Перейти">
              <ChevronDown size={14} />
            </button>
          </div>
        )}

      </div>

      {/* Messages */}
      <div
        ref={scrollContainerRef}
        className={`message-scroll${isInitialPositioning && messages.length > 0 ? " is-initial-positioning" : ""}`}
        onScroll={handleScroll}
        onTouchStart={(e) => { touchStartXRef.current = e.touches[0].clientX; }}
        {...(isTouchDevice ? swipeBackBind() : {})}
        style={swipeBackOffset > 0 ? { transform: `translateX(${swipeBackOffset}px)`, transition: "none" } : undefined}
        role="log"
        aria-label="Сообщения"
        aria-live="polite"
      >
        {swipeBackOffset > 20 && (
          <div className="swipe-back-indicator" style={{ opacity: Math.min(1, swipeBackOffset / 100) }}>
            <ArrowLeft size={18} />
          </div>
        )}
        {error && (
          <div className="error-banner chat-error-banner">
            <span>{error}</span>
            <button type="button" className="error-dismiss" onClick={() => setError(null)}>×</button>
          </div>
        )}

        {isLoading && messages.length === 0 ? (
          <div className="inline-loader"><PentagramLoader size="md" /></div>
        ) : messages.length === 0 ? (
          <div className="empty-thread hero">
            <MessageCircle size={18} />
            <h2>Диалог готов</h2>
            <p>Напиши первое сообщение, и переписка начнётся сразу.</p>
          </div>
        ) : (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const msg = messages[virtualRow.index];
              const prev = virtualRow.index > 0 ? messages[virtualRow.index - 1] : null;
              const isConsecutive =
                prev != null &&
                prev.sender_user_id === msg.sender_user_id &&
                new Date(msg.sent_at).getTime() - new Date(prev.sent_at).getTime() < 120_000;
              const dateLabel = getDateSeparator(prev, msg);
              const peerReceipt = getPeerReceipt(msg.id);
              const quoted = getQuotedMessage(msg.parent_message_id);
              const giftData = parseGiftContent(msg.content);

              if (giftData) {
                const imgSrc = giftData.imageUrl ? storageUrl("post-images", giftData.imageUrl) || giftData.imageUrl : null;
                return (
                  <div
                    key={msg.id}
                    data-index={virtualRow.index}
                    data-message-id={msg.id}
                    ref={virtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    {dateLabel && <div className="date-separator"><span>{dateLabel}</span></div>}
                    <div className="msg-gift-standalone">
                      <div className="msg-gift-standalone-card">
                        <div className="msg-gift-standalone-img">
                          {imgSrc ? (
                            <img src={imgSrc} alt={giftData.giftName} />
                          ) : (
                            <Gift size={28} />
                          )}
                        </div>
                        <div className="msg-gift-standalone-name">{giftData.giftName}</div>
                        <button
                          type="button"
                          className="msg-gift-standalone-btn"
                          onClick={() => {
                            setGiftDetailId(giftData.giftId);
                            setGiftDetailRecipientId(
                              msg.sender_user_id === me.id ? conversation.other_user_id : me.id
                            );
                          }}
                        >
                          Подробнее
                        </button>
                      </div>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={msg.id}
                  data-index={virtualRow.index}
                  data-message-id={msg.id}
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  {dateLabel && <div className="date-separator"><span>{dateLabel}</span></div>}
                  {conversation.is_group && !isConsecutive && msg.sender_user_id !== me.id && msg.sender_username && (
                    <div className={`msg-sender-name ${getUserColorClass(msg.sender_user_id)}`} style={{ fontSize: 12, fontWeight: 600, marginBottom: 2, marginLeft: 4, paddingLeft: 4 }}>
                      {msg.sender_username}
                    </div>
                  )}
                  <MessageBubble
                    message={msg}
                    isMine={msg.sender_user_id === me.id}
                    isConsecutive={isConsecutive}
                    isPinned={conversation.pinned_message_id === msg.id}
                    isGroup={conversation.is_group}
                    isNew={newMessageIds.has(msg.id)}
                    onEdit={(id, content) => handleStartEdit(id, content)}
                    onDelete={deleteMessage}
                    onTogglePin={(id) => togglePin(id)}
                    onRetry={(m) => sendMessage(m.content, m.client_id)}
                    onReply={handleReply}
                    onCopy={handleCopy}
                    quotedMessage={quoted}
                    peerReadAt={peerReceipt?.read_at ?? null}
                    peerDeliveredAt={peerReceipt?.delivered_at ?? null}
                  />
                </div>
              );
            })}
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* New messages bar */}
      {isScrolledUp && newMessageCount > 0 && (
        <div className="new-messages-bar-container">
          <button type="button" className="new-messages-bar" onClick={scrollToBottom}>
            {newMessageCount} нов{newMessageCount === 1 ? "ое" : "ых"} сообщен{newMessageCount === 1 ? "ие" : "ий"}
          </button>
        </div>
      )}

      {/* Composer */}
      <MessageComposer
        draft={draft}
        setDraft={setDraft}
        isSending={isSending}
        onSend={handleSend}
        composerRef={composerRef}
        onTyping={onTyping}
        editingMessageId={editingMessageId}
        editingContent={editingContent}
        onCancelEdit={handleCancelEdit}
        onSaveEdit={handleSaveEdit}
        replyToMessage={replyToMessage}
        replySenderLabel={replyToMessage ? (replyToMessage.sender_user_id === me?.id ? "Вы" : "Собеседник") : undefined}
        onCancelReply={handleCancelReply}
        pendingAttachments={pendingAttachments}
        onAttachmentsChange={setPendingAttachments}
      />

      {/* Scroll to bottom button */}
      {isScrolledUp && (
        <button type="button" className="scroll-to-bottom-btn" onClick={scrollToBottom} aria-label="Прокрутить вниз">
          <ChevronDown size={20} />
        </button>
      )}

      {/* User info panel */}
      <UserInfoPanel
        open={showUserInfo}
        onClose={() => setShowUserInfo(false)}
        conversationId={conversation.id}
        userId={conversation.other_user_id || undefined}
        username={conversation.other_username || undefined}
        displayName={conversation.other_display_name}
        avatarUrl={conversation.other_avatar_url}
        isOnline={conversation.other_is_online}
        lastSeenAt={conversation.other_last_seen_at}
        isGroup={conversation.is_group}
        groupName={conversation.group_name}
        groupAvatarUrl={conversation.group_avatar_url}
        memberCount={conversation.member_count}
      />

      {/* Gift detail dialog */}
      {giftDetailId && (
        <GiftDetailDialog
          giftId={giftDetailId}
          recipientId={giftDetailRecipientId ?? me.id}
          open={true}
          onOpenChange={(v) => { if (!v) { setGiftDetailId(null); setGiftDetailRecipientId(null); } }}
        />
      )}
    </>
  );
});
