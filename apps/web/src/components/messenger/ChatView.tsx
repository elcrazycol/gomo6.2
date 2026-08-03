import { memo, useCallback, useEffect, useRef, useState } from "react";
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
import { MessageList, type MessageListHandle } from "./MessageList";
import type { Attachment, MessageView } from "./types";

interface Props {
  onBack: () => void;
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
  typingUsername?: string | null;
  onTyping: (isTyping: boolean) => void;
}

export const ChatView = memo(function ChatView({
  onBack,
  composerRef,
  typingUsername,
  onTyping,
}: Props) {
  const conversation = useMessengerStore(selectSelectedConversation);
  const messages = useMessengerStore((s) => s.messages);
  const isLoading = useMessengerStore((s) => s.isMessagesLoading);
  const isSending = useMessengerStore((s) => s.isSending);
  const me = useMessengerStore((s) => s.me);
  const receipts = useMessengerStore((s) => s.receipts);
  const error = useMessengerStore((s) => s.error);
  const setError = useMessengerStore((s) => s.setError);

  const sendMessage = useMessengerStore((s) => s.sendMessage);
  const editMessage = useMessengerStore((s) => s.editMessage);
  const deleteMessage = useMessengerStore((s) => s.deleteMessage);
  const togglePin = useMessengerStore((s) => s.togglePin);

  const messageListRef = useRef<MessageListHandle>(null);

  const [draft, setDraft] = useState("");
  const [pinnedText, setPinnedText] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState<string>("");
  const [showUserInfo, setShowUserInfo] = useState(false);
  const [giftDetailId, setGiftDetailId] = useState<string | null>(null);
  const [giftDetailRecipientId, setGiftDetailRecipientId] = useState<string | null>(null);
  const [replyToMessage, setReplyToMessage] = useState<MessageView | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);

  const latestMessageId = messages[messages.length - 1]?.id;
  const latestMessageSentAt = messages[messages.length - 1]?.sent_at;

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
    sendMessage(
      draft.trim() || " ",
      clientId,
      replyToMessage?.id ?? undefined,
      pendingAttachments.length > 0 ? pendingAttachments : undefined,
    );
    setDraft("");
    setReplyToMessage(null);
    setPendingAttachments([]);
    // Always bring the author back to the bottom so their message is visible,
    // even when they were reading history. When already at the bottom,
    // followOutput covers the scroll and this call is a no-op.
    requestAnimationFrame(() => messageListRef.current?.scrollToBottom());
  }, [draft, isSending, sendMessage, replyToMessage, pendingAttachments]);

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

  const scrollToPinned = useCallback(() => {
    const pid = conversation?.pinned_message_id;
    if (!pid) return;
    messageListRef.current?.scrollToMessage(pid);
  }, [conversation?.pinned_message_id]);

  const renderMessage = useCallback(
    (
      msg: MessageView,
      prev: MessageView | null,
      extras: { dateLabel: string | null; isConsecutive: boolean; isNew: boolean },
    ) => {
      if (!conversation || !me) return null;
      const { dateLabel, isConsecutive: isGrouped, isNew } = extras;
      const convReceipts = receipts.get(conversation.id) ?? [];
      const peerReceipt = convReceipts.find((r) => r.message_id === msg.id && r.user_id !== me.id) ?? null;
      const quoted = msg.parent_message_id
        ? (messages.find((m) => m.id === msg.parent_message_id) ?? null)
        : null;
      const giftData = parseGiftContent(msg.content);

      if (giftData) {
        const imgSrc = giftData.imageUrl ? storageUrl("post-images", giftData.imageUrl) || giftData.imageUrl : null;
        return (
          <div data-message-id={msg.id}>
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
                      msg.sender_user_id === me.id ? conversation.other_user_id : me.id,
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
        <div data-message-id={msg.id}>
          {dateLabel && <div className="date-separator"><span>{dateLabel}</span></div>}
          {conversation.is_group && !isGrouped && msg.sender_user_id !== me.id && msg.sender_username && (
            <div className={`msg-sender-name ${getUserColorClass(msg.sender_user_id)}`} style={{ fontSize: 12, fontWeight: 600, marginBottom: 2, marginLeft: 4, paddingLeft: 4 }}>
              {msg.sender_username}
            </div>
          )}
          <MessageBubble
            message={msg}
            isMine={msg.sender_user_id === me.id}
            isConsecutive={isGrouped}
            isPinned={conversation.pinned_message_id === msg.id}
            isGroup={conversation.is_group}
            isNew={isNew}
            onEdit={handleStartEdit}
            onDelete={deleteMessage}
            onTogglePin={togglePin}
            onRetry={(m) => sendMessage(m.content, m.client_id)}
            onReply={handleReply}
            onCopy={handleCopy}
            quotedMessage={quoted}
            peerReadAt={peerReceipt?.read_at ?? null}
            peerDeliveredAt={peerReceipt?.delivered_at ?? null}
          />
        </div>
      );
    },
    [conversation, me, messages, receipts, handleStartEdit, deleteMessage, togglePin, sendMessage, handleReply, handleCopy],
  );

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
      <div className="chat-messages-area">
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
          <MessageList
            key={conversation.id}
            ref={messageListRef}
            onBack={onBack}
            renderMessage={renderMessage}
          />
        )}
      </div>

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
