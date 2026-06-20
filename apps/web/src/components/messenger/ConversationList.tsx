import { memo, useCallback } from "react";
import { MessageCircle, UserPlus, X } from "lucide-react";
import { PentagramLoader } from "@/components/PentagramLoader";
import { UserBadge } from "@/components/UserBadge";
import { storageUrl } from "@/utils/storage";
import { useMessengerStore } from "@/stores/messengerStore";
import { formatConversationDate, formatPresence, getInitials } from "./utils";
import type { ConversationView } from "./types";

interface Props {
  onStartChat?: (userId: string) => void;
  onSelectConversation?: (id: string) => void;
  startingChat?: boolean;
  targetUserId?: string | null;
}

const ConversationCard = memo(function ConversationCard({
  conversation,
  isSelected,
  onSelect,
}: {
  conversation: ConversationView;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const isOnline = conversation.other_is_online;
  const unread = conversation.unread_count ?? 0;

  return (
    <button
      type="button"
      className={`conversation-card${isSelected ? " is-active" : ""}${unread > 0 ? " has-unread" : ""}`}
      onClick={onSelect}
    >
      <div className="avatar-wrapper">
        <div className="avatar">
          {conversation.other_avatar_url ? (
            <img
              src={storageUrl("post-images", conversation.other_avatar_url) || undefined}
              alt={conversation.other_username}
            />
          ) : (
            <span>{getInitials(conversation.other_username)}</span>
          )}
        </div>
        {isOnline && <span className="online-dot" title="Онлайн" />}
      </div>
      <div className="conversation-copy">
        <div className="conversation-head">
          <div className="conversation-user-badge">
            <UserBadge
              userId={conversation.other_user_id}
              username={conversation.other_username}
              displayName={conversation.other_display_name}
              showOutline={false}
              disableLink
              disableHoverCard
            />
          </div>
          <span className="conversation-time">
            {formatConversationDate(conversation.last_message_at)}
          </span>
        </div>
        <div className="conversation-meta">
          {conversation.last_message_preview ? (
            <span className="conversation-preview">{conversation.last_message_preview}</span>
          ) : (
            <span className="conversation-preview muted">Нет сообщений</span>
          )}
          {unread > 0 && <span className="count-badge">{unread > 99 ? "99+" : unread}</span>}
        </div>
      </div>
    </button>
  );
});

export const ConversationList = memo(function ConversationList({
  onStartChat,
  onSelectConversation,
  startingChat,
  targetUserId,
}: Props) {
  const conversations = useMessengerStore((s) => s.conversations);
  const selectedId = useMessengerStore((s) => s.selectedConversationId);
  const selectConversation = useMessengerStore((s) => s.selectConversation);
  const error = useMessengerStore((s) => s.error);
  const setError = useMessengerStore((s) => s.setError);
  const initLoading = useMessengerStore((s) => s.isInitialLoading);
  const totalUnread = useMessengerStore((s) => s.totalUnread);

  const unread = totalUnread();

  const handleStartChat = useCallback(() => {
    if (onStartChat && targetUserId) onStartChat(targetUserId);
  }, [onStartChat, targetUserId]);

  const handleSelect = useCallback((id: string) => {
    if (onSelectConversation) {
      onSelectConversation(id);
    } else {
      selectConversation(id);
    }
  }, [onSelectConversation, selectConversation]);

  return (
    <>
      <div className="sidebar-top">
        <div className="sidebar-top-row">
        <h1>Сообщения</h1>
        {unread > 0 && (
          <span className="header-unread-badge" title={`${unread} непрочитанных`}>
            {unread > 99 ? "99+" : unread}
          </span>
        )}
        </div>
      </div>

      {error && (
        <div className="error-banner">
          <span>{error}</span>
          <button type="button" className="error-dismiss" onClick={() => setError(null)} aria-label="Закрыть">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="conversation-list">
        {initLoading && conversations.length === 0 && (
          <div className="panel-loader-overlay sidebar-loader">
            <PentagramLoader size="md" />
          </div>
        )}

        {conversations.length === 0 && !initLoading && (
          <div className="empty-card">
            <MessageCircle size={18} />
            <p>Диалогов пока нет.</p>
            {targetUserId && onStartChat && (
              <button
                type="button"
                className="cta-button"
                onClick={handleStartChat}
                disabled={startingChat}
              >
                {startingChat ? <PentagramLoader size="sm" /> : (
                  <>
                    <UserPlus size={14} /> Открыть диалог
                  </>
                )}
              </button>
            )}
          </div>
        )}

        {conversations.map((conv) => (
          <ConversationCard
            key={conv.id}
            conversation={conv}
            isSelected={conv.id === selectedId}
            onSelect={() => handleSelect(conv.id)}
          />
        ))}
      </div>
    </>
  );
});
