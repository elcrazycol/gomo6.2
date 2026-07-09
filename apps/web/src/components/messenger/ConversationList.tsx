import { memo, useCallback, useState, useMemo } from "react";
import { MessageCircle, UserPlus, X, Plus } from "lucide-react";
import { PentagramLoader } from "@/components/PentagramLoader";
import { UserBadge } from "@/components/UserBadge";
import { storageUrl } from "@/utils/storage";
import { useMessengerStore } from "@/stores/messengerStore";
import { formatConversationDate, formatPresence, getInitials } from "./utils";
import { CreateGroupDialog } from "./CreateGroupDialog";
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
  const isOnline = !conversation.is_group && conversation.other_is_online;
  const unread = conversation.unread_count ?? 0;

  return (
    <button
      type="button"
      className={`conversation-card${isSelected ? " is-active" : ""}${unread > 0 ? " has-unread" : ""}`}
      onClick={onSelect}
    >
      <div className="avatar-wrapper">
        <div className="avatar">
          {conversation.is_group ? (
            <span>{conversation.group_name ? conversation.group_name.slice(0, 2).toUpperCase() : "ГР"}</span>
          ) : conversation.other_avatar_url ? (
            <img
              src={storageUrl("post-images", conversation.other_avatar_url) || undefined}
              alt={conversation.other_username || ""}
            />
          ) : (
            <span>{getInitials(conversation.other_username || "")}</span>
          )}
        </div>
        {isOnline && <span className="online-dot" title="Онлайн" />}
      </div>
      <div className="conversation-copy">
        <div className="conversation-head">
          <div className="conversation-user-badge">
            {conversation.is_group ? (
              <span className="font-bold text-xs sm:text-sm">{conversation.group_name || "Группа"}</span>
            ) : (
              <UserBadge
                userId={conversation.other_user_id || ""}
                username={conversation.other_username || ""}
                displayName={conversation.other_display_name}
                showOutline={false}
                disableLink
                disableHoverCard
              />
            )}
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
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateGroup, setShowCreateGroup] = useState(false);

  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const q = searchQuery.toLowerCase();
    return conversations.filter(
      (c) =>
        c.other_username.toLowerCase().includes(q) ||
        (c.other_display_name?.toLowerCase().includes(q) ?? false),
    );
  }, [conversations, searchQuery]);

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
        <button
          type="button"
          className="icon-button"
          onClick={() => setShowCreateGroup(true)}
          title="Новый чат"
          aria-label="Новый чат"
        >
          <Plus size={16} />
        </button>
      </div>

      <CreateGroupDialog open={showCreateGroup} onClose={() => setShowCreateGroup(false)} />

      {error && (
        <div className="error-banner">
          <span>{error}</span>
          <button type="button" className="error-dismiss" onClick={() => setError(null)} aria-label="Закрыть">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="conversation-list">
        {conversations.length > 3 && (
          <div style={{ padding: "0 0 4px" }}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Поиск..."
              style={{
                width: "100%",
                padding: "7px 10px",
                borderRadius: "8px",
                border: "1px solid hsl(var(--input))",
                background: "hsl(var(--background))",
                color: "hsl(var(--foreground))",
                fontSize: "13px",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>
        )}

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

        {filteredConversations.map((conv) => (
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
