import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, MessageCircle, Pin } from "lucide-react";
import { PentagramLoader } from "@/components/PentagramLoader";
import { UserBadge } from "@/components/UserBadge";
import { storageUrl } from "@/utils/storage";
import { formatPresence, getInitials } from "./utils";
import { MessageBubble } from "./MessageBubble";
import { MessageComposer } from "./MessageComposer";
import type { ConversationView, MessageView, ProfileSummary, PinnedMessageInfo } from "./types";

interface ChatViewProps {
  selectedConversation: ConversationView;
  messages: MessageView[];
  messagesLoading: boolean;
  hasMoreMessages: boolean;
  loadingMore: boolean;
  loadOlderMessages: () => void;
  onRetryMessage: (message: MessageView) => void;
  me: ProfileSummary;
  draft: string;
  setDraft: (value: string) => void;
  sending: boolean;
  sendMessage: () => void;
  pinnedMessageInfo: PinnedMessageInfo;
  onTogglePin: (message: MessageView) => void;
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
  messageScrollRef: React.RefObject<HTMLDivElement | null>;
  endRef: React.RefObject<HTMLDivElement | null>;
  onBack: () => void;
  errorMessage: string | null;
  onDismissError: () => void;
}

export const ChatView = memo(function ChatView({
  selectedConversation,
  messages,
  messagesLoading,
  hasMoreMessages,
  loadingMore,
  loadOlderMessages,
  onRetryMessage,
  me,
  draft,
  setDraft,
  sending,
  sendMessage,
  pinnedMessageInfo,
  onTogglePin,
  composerRef,
  messageScrollRef,
  endRef,
  onBack,
  errorMessage,
  onDismissError,
}: ChatViewProps) {
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const prevMessagesLength = useRef(messages.length);

  const handleScroll = useCallback(() => {
    const container = messageScrollRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const scrolledUp = distanceFromBottom > 128;

    if (scrolledUp !== isScrolledUp) {
      setIsScrolledUp(scrolledUp);
    }

    // If manually scrolled down, reset new message count
    if (!scrolledUp && newMessageCount > 0) {
      setNewMessageCount(0);
    }
  }, [isScrolledUp, newMessageCount, messageScrollRef]);

  // Track new messages while scrolled up
  useEffect(() => {
    if (isScrolledUp && messages.length > prevMessagesLength.current) {
      setNewMessageCount((prev) => prev + (messages.length - prevMessagesLength.current));
    }
    prevMessagesLength.current = messages.length;
  }, [messages.length, isScrolledUp]);

  const scrollToPinned = useCallback(() => {
    if (!pinnedMessageInfo) return;
    const container = messageScrollRef.current;
    if (!container) return;
    const el = container.querySelector(`[data-message-id="${pinnedMessageInfo.id}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [pinnedMessageInfo, messageScrollRef]);

  const formatDateSeparator = useCallback((prevSentAt: string | null, sentAt: string): string | null => {
    const curr = new Date(sentAt);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const currDay = curr.toDateString();

    // Same day as previous — no separator
    if (prevSentAt != null) {
      const prev = new Date(prevSentAt);
      if (prev.toDateString() === currDay) return null;
    }

    // Different day — add a label
    const todayDay = today.toDateString();
    const yesterdayDay = yesterday.toDateString();

    if (currDay === todayDay) return "сегодня";
    if (currDay === yesterdayDay) return "вчера";
    return curr.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  }, []);

  const scrollToBottom = useCallback(() => {
    const container = messageScrollRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    setIsScrolledUp(false);
    setNewMessageCount(0);
  }, [messageScrollRef, endRef]);

  return (
    <>
      <div className="chat-topbar">
        <div className="chat-topbar-main">
          <button
            type="button"
            className="icon-button mobile-only messenger-back-button"
            onClick={onBack}
            aria-label="Назад к диалогам"
          >
            <ArrowLeft size={16} />
          </button>
          <div className="avatar small">
            {selectedConversation.otherUser.avatar_url ? (
              <img
                src={storageUrl("post-images", selectedConversation.otherUser.avatar_url) || undefined}
                alt={selectedConversation.otherUser.username}
              />
            ) : (
              <span>{getInitials(selectedConversation.otherUser.username)}</span>
            )}
          </div>
          <div>
            <div className="chat-user-badge">
              <UserBadge
                userId={selectedConversation.otherUser.id}
                username={selectedConversation.otherUser.username}
                showOutline={false}
              />
            </div>
            <p className="presence-copy">
              {formatPresence(selectedConversation.otherUser.is_online, selectedConversation.otherUser.last_seen_at)}
            </p>
          </div>
        </div>
      </div>

      <div ref={messageScrollRef} className="message-scroll" onScroll={handleScroll}>
        {pinnedMessageInfo ? (
          <div className="pinned-message-banner">
            <div className="pinned-message-icon">
              <Pin size={12} />
            </div>
            <div className="pinned-message-content">
              <p className="pinned-message-text">
                {pinnedMessageInfo.sender_username}: {pinnedMessageInfo.plainText}
              </p>
            </div>
            <button
              type="button"
              className="pinned-message-jump"
              onClick={scrollToPinned}
              title="Перейти к сообщению"
            >
              <ChevronDown size={14} />
            </button>
          </div>
        ) : null}


        {errorMessage ? (
          <div className="error-banner chat-error-banner">
            <span>{errorMessage}</span>
            <button type="button" className="error-dismiss" onClick={onDismissError} aria-label="Закрыть">
              &times;
            </button>
          </div>
        ) : null}

        {messagesLoading && messages.length === 0 ? (
          <div className="inline-loader">
            <PentagramLoader size="md" />
          </div>
        ) : messages.length === 0 ? (
          <div className="empty-thread hero">
            <MessageCircle size={18} />
            <h2>Диалог готов</h2>
            <p>Напиши первое сообщение, и переписка начнётся сразу.</p>
          </div>
        ) : (
          <>
            {messagesLoading ? (
              <div className="inline-loader subtle">
                <PentagramLoader size="sm" />
              </div>
            ) : null}
            {hasMoreMessages ? (
              <div className="load-more-container">
                {loadingMore ? (
                  <PentagramLoader size="sm" />
                ) : (
                  <button
                    type="button"
                    className="load-more-button"
                    onClick={loadOlderMessages}
                  >
                    Загрузить предыдущие сообщения
                  </button>
                )}
              </div>
            ) : null}
            {messages.map((message, index) => {
              const prev = index > 0 ? messages[index - 1] : null;
              const isConsecutive =
                prev != null &&
                prev.sender_user_id === message.sender_user_id &&
                new Date(message.sent_at).getTime() - new Date(prev.sent_at).getTime() < 120_000;

              const dateLabel = formatDateSeparator(
                index > 0 ? messages[index - 1].sent_at : null,
                message.sent_at,
              );

              return (
                <React.Fragment key={message.id}>
                  {dateLabel ? (
                    <div className="date-separator"><span>{dateLabel}</span></div>
                  ) : null}
                  <MessageBubble
                    message={message}
                    isMine={message.sender_user_id === me.id}
                    onRetry={onRetryMessage}
                    onTogglePin={onTogglePin}
                    isPinned={pinnedMessageInfo?.id === message.id}
                    isConsecutive={isConsecutive}
                  />
                </React.Fragment>
              );
            })}
          </>
        )}
        <div ref={endRef} />
      </div>

      {isScrolledUp && newMessageCount > 0 ? (
        <div className="new-messages-bar-container">
          <button type="button" className="new-messages-bar" onClick={scrollToBottom}>
            {newMessageCount} нов{newMessageCount === 1 ? "ое" : "ых"} сообщен{newMessageCount === 1 ? "ие" : "ий"}
          </button>
        </div>
      ) : null}

      <MessageComposer
        draft={draft}
        setDraft={setDraft}
        sending={sending}
        sendMessage={sendMessage}
        composerRef={composerRef}
      />

      {isScrolledUp ? (
        <button
          type="button"
          className="scroll-to-bottom-btn"
          onClick={scrollToBottom}
          aria-label="Прокрутить вниз"
        >
          <ChevronDown size={20} />
        </button>
      ) : null}
    </>
  );
});
