import { memo, useCallback } from "react";
import { MessageCircle, X } from "lucide-react";
import { PentagramLoader } from "@/components/PentagramLoader";
import { UserBadge } from "@/components/UserBadge";
import { OnlineStatus } from "@/components/OnlineStatus";
import { storageUrl } from "@/utils/storage";
import { formatDate, getInitials } from "./utils";
import type { ConversationView, ProfileSummary } from "./types";

interface ConversationListProps {
  conversations: ConversationView[];
  selectedConversationId: string | null;
  openConversation: (conversation: ConversationView) => void;
  conversationsLoading: boolean;
  errorMessage: string | null;
  startingConversation: boolean;
  targetUserId: string | null;
  ensureConversation: (userId: string, targetId: string) => Promise<string | null>;
  loadConversations: (userId: string) => Promise<ConversationView[]>;
  me: ProfileSummary;
  totalUnread: number;
  onDismissError: () => void;
}

const ConversationCard = memo(function ConversationCard({
  conversation,
  isSelected,
  onOpen,
}: {
  conversation: ConversationView;
  isSelected: boolean;
  onOpen: () => void;
}) {
  return (      <button
      type="button"
      className={`conversation-card${isSelected ? " is-active" : ""}${conversation.unreadCount > 0 ? " has-unread" : ""}`}
      onClick={onOpen}
    >
      <div className="avatar">
        {conversation.otherUser.avatar_url ? (
          <img
            src={storageUrl("post-images", conversation.otherUser.avatar_url) || undefined}
            alt={conversation.otherUser.username}
          />
        ) : (
          <span>{getInitials(conversation.otherUser.username)}</span>
        )}
      </div>
      <div className="conversation-copy">
        <div className="conversation-head">
          <div className="conversation-user-badge">
            <UserBadge
              userId={conversation.otherUser.id}
              username={conversation.otherUser.username}
              showOutline={false}
              disableLink
              disableHoverCard
            />
          </div>
        </div>
        <div className="conversation-meta">
          <span>{formatDate(conversation.lastMessageAt)}</span>
          <span>#{conversation.otherUser.account_number ?? "?"}</span>
          {conversation.otherUser.is_online ? (
            <span className="online-dot" title="Онлайн" />
          ) : (
            <OnlineStatus
              userId={conversation.otherUser.id}
              isOnline={conversation.otherUser.is_online}
              lastSeen={conversation.otherUser.last_seen_at}
              showText={false}
            />
          )}
          {conversation.unreadCount > 0 ? <span className="count-badge">{conversation.unreadCount}</span> : null}
        </div>
      </div>
    </button>
  );
});

export const ConversationList = memo(function ConversationList({
  conversations,
  selectedConversationId,
  openConversation,
  conversationsLoading,
  errorMessage,
  startingConversation,
  targetUserId,
  ensureConversation,
  loadConversations,
  me,
  totalUnread,
  onDismissError,
}: ConversationListProps) {
  const handleEnsureConversation = useCallback(() => {
    void ensureConversation(me.id, targetUserId!).then(() => loadConversations(me.id));
  }, [ensureConversation, loadConversations, me.id, targetUserId]);

  return (
    <>
      <div className="sidebar-top">
        <div>
          <h1>Сообщения</h1>
        </div>
        {totalUnread > 0 ? (
          <span className="header-unread-badge" title={`${totalUnread} непрочитанных`}>
            {totalUnread > 99 ? "99+" : totalUnread}
          </span>
        ) : null}
      </div>

      {errorMessage ? (
        <div className="error-banner">
          <span>{errorMessage}</span>
          <button type="button" className="error-dismiss" onClick={onDismissError} aria-label="Закрыть">
            <X size={14} />
          </button>
        </div>
      ) : null}

      <div className="conversation-list">
        {conversationsLoading && conversations.length === 0 ? (
          <div className="panel-loader-overlay sidebar-loader">
            <PentagramLoader size="md" />
          </div>
        ) : null}

        {conversations.length === 0 ? (
          <div className="empty-card">
            <MessageCircle size={18} />
            <p>Диалогов пока нет.</p>
            {targetUserId ? (
              <button
                type="button"
                className="cta-button"
                onClick={handleEnsureConversation}
                disabled={startingConversation}
              >
                {startingConversation ? <PentagramLoader size="sm" /> : "Открыть диалог"}
              </button>
            ) : null}
          </div>
        ) : (
          conversations.map((conversation) => (
            <ConversationCard
              key={conversation.id}
              conversation={conversation}
              isSelected={conversation.id === selectedConversationId}
              onOpen={() => openConversation(conversation)}
            />
          ))
        )}
      </div>
    </>
  );
});
