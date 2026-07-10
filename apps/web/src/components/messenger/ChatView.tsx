import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowLeft, ChevronDown, MessageCircle, Pin, Gift, Lock } from "lucide-react";
import { PentagramLoader } from "@/components/PentagramLoader";
import { UserBadge } from "@/components/UserBadge";
import { storageUrl } from "@/utils/storage";
import { useMessengerStore, queueMarkDelivered, queueMarkRead } from "@/stores/messengerStore";
import { formatPresence, getInitials, getUserColorClass } from "./utils";
import { MessageBubble } from "./MessageBubble";
import { MessageComposer } from "./MessageComposer";
import { UserInfoPanel } from "./UserInfoPanel";
import { E2EBanner } from "./E2EBanner";
import { parseGiftContent, GiftDetailDialog } from "./MessageContent";
import type { Attachment, MessageView, ReceiptRow } from "./types";

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
  const conversation = useMessengerStore((s) => s.selectedConversation());
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
  const shouldAutoScroll = useRef(true);
  const isScrolledUpRef = useRef(false);

  const convReceipts = receipts.get(conversation?.id ?? "") ?? [];

  // Virtual scroll
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const prevItemCountRef = useRef(0);
  const isLoadingMoreRef = useRef(false);
  const messagesLengthRef = useRef(0);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 56,
    overscan: 5,
  });

  // Keep ref in sync
  useEffect(() => { messagesLengthRef.current = messages.length; }, [messages.length]);

  // Auto-scroll to bottom — direct DOM for reliability
  const pinToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const el = scrollContainerRef.current;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    });
  }, []);

  // Auto-scroll only when conversation changes (initial load)
  useLayoutEffect(() => {
    shouldAutoScroll.current = true;
    prevItemCountRef.current = 0;
    requestAnimationFrame(() => pinToBottom());
  }, [conversation?.id, pinToBottom]);

  // Sync ref with state for stable callback
  useEffect(() => { isScrolledUpRef.current = isScrolledUp; }, [isScrolledUp]);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldAutoScroll.current = dist <= 32;
    const nowScrolledUp = dist > 128;
    if (nowScrolledUp !== isScrolledUpRef.current) {
      setIsScrolledUp(nowScrolledUp);
    }
    // Reset new message count when scrolled back to bottom
    if (dist <= 32) {
      setNewMessageCount(0);
    }
    // Load more when scrolled near top
    if (el.scrollTop < 50 && hasMoreMessages && !isLoadingMore && !isLoadingMoreRef.current && conversation?.id) {
      isLoadingMoreRef.current = true;
      const prevHeight = el.scrollHeight;
      const prevScrollTop = el.scrollTop;
      loadMoreMessages(conversation.id).then(() => {
        requestAnimationFrame(() => {
          if (el) {
            const newHeight = el.scrollHeight;
            el.scrollTop = prevScrollTop + (newHeight - prevHeight);
          }
          isLoadingMoreRef.current = false;
        });
      }).catch(() => {
        isLoadingMoreRef.current = false;
      });
    }
  }, [hasMoreMessages, isLoadingMore, conversation?.id, loadMoreMessages]);

  // Auto-scroll on new messages only if user is at bottom
  useEffect(() => {
    if (messages.length > prevItemCountRef.current && shouldAutoScroll.current) {
      // Double rAF to ensure DOM has updated
      requestAnimationFrame(() => requestAnimationFrame(() => pinToBottom()));
    }
    if (isScrolledUp && messages.length > prevItemCountRef.current) {
      setNewMessageCount((c) => c + (messages.length - prevItemCountRef.current));
    }
    prevItemCountRef.current = messages.length;
  }, [messages.length, isScrolledUp, pinToBottom]);

  // Reset auto-scroll when viewport changes (keyboard open/close)
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let keyboardTimer: ReturnType<typeof setTimeout>;
    const onResize = () => {
      shouldAutoScroll.current = true;
      clearTimeout(keyboardTimer);
      keyboardTimer = setTimeout(() => pinToBottom(), 150);
    };
    vv.addEventListener("resize", onResize);
    return () => {
      vv.removeEventListener("resize", onResize);
      clearTimeout(keyboardTimer);
    };
  }, [pinToBottom]);

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
      queueMarkDelivered(conversation.id, lastOther.id);
      queueMarkRead(conversation.id, lastOther.id);
    }
  }, [messages.length, conversation?.id]);

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
    const clientId = `c${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    sendMessage(draft.trim() || " ", clientId, replyToMessage?.id ?? undefined, pendingAttachments.length > 0 ? pendingAttachments : undefined);
    setDraft("");
    setReplyToMessage(null);
    setPendingAttachments([]);
    // Scroll after optimistic insert renders
    setTimeout(pinToBottom, 100);
  }, [draft, isSending, sendMessage, pinToBottom, replyToMessage, pendingAttachments]);

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
      <div className="empty-thread hero">
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
        <div className="chat-topbar">
          <div className="chat-topbar-main" onClick={() => setShowUserInfo(true)}>
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
              <div className="chat-topbar-username">
                {conversation.is_group ? (
                  <span className="font-bold text-sm">{conversation.group_name || "Группа"}</span>
                ) : (
                  <UserBadge userId={conversation.other_user_id || ""} username={conversation.other_username || ""} displayName={conversation.other_display_name} showOutline={false} />
                )}
                {conversation.is_e2e && <span title="E2E зашифрован"><Lock className="w-3 h-3 text-green-500 ml-1" /></span>}
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

        {/* E2E banner */}
        {conversation.is_e2e && (
          <E2EBanner
            conversationId={conversation.id}
            remoteUserId={conversation.other_user_id || undefined}
            remoteUsername={conversation.other_username || undefined}
          />
        )}
      </div>

      {/* Messages */}
      <div ref={scrollContainerRef} className="message-scroll" onScroll={handleScroll}>
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
                    key={virtualRow.key}
                    data-index={virtualRow.index}
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
                  key={virtualRow.key}
                  data-index={virtualRow.index}
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
