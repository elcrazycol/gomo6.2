import { memo, useCallback, useState, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Gift, Link2, MessageCircle, NotebookPen, Search, UserPlus, X } from "lucide-react";
import { PentagramLoader } from "@/components/PentagramLoader";
import { UserBadge } from "@/components/UserBadge";
import { storageUrl } from "@/utils/storage";
import { useMessengerStore } from "@/stores/messengerStore";
import { useLanguageStore } from "@/stores/languageStore";
import { formatConversationDate, formatPresence, getInitials } from "./utils";
import { messengerConversationPreview } from "./messengerRichTextUtils";
import { NewChatDialog } from "./NewChatDialog";
import type { ConversationView } from "./types";

interface Props {
  onStartChat?: (userId: string) => void;
  onSelectConversation?: (id: string) => void;
  startingChat?: boolean;
  targetUserId?: string | null;
  isCollapsed?: boolean;
}

const ConversationCard = memo(function ConversationCard({
  conversation,
  isSelected,
  onSelect,
  isCollapsed,
  myUserId,
}: {
  conversation: ConversationView;
  isSelected: boolean;
  onSelect: () => void;
  isCollapsed: boolean;
  myUserId: string | null;
}) {
  const language = useLanguageStore((state) => state.language);
  void language;
  const isOnline = !conversation.is_group && conversation.other_is_online;
  const unread = conversation.unread_count ?? 0;
  const lastMessageIsMine = Boolean(myUserId && conversation.last_message_sender_id === myUserId);

  // Real read status for the LAST message (1:1 only): the peer's read line
  // (backend chat_members.other_last_read_at) versus the message time.
  const lastMessageAt = conversation.last_message_at;
  const peerReadLine = !conversation.is_group && !conversation.is_notes ? conversation.other_last_read_at ?? null : null;
  const peerRead = Boolean(peerReadLine && lastMessageAt && Date.parse(peerReadLine) >= Date.parse(lastMessageAt));
  const peerDelivered = !peerRead && Boolean(peerReadLine);

  const rawPreview = conversation.last_message_preview;
  const previewIsGift = Boolean(rawPreview?.startsWith("__GIFT__"));
  const previewIsShare = Boolean(rawPreview?.startsWith("__SHARE__"));

  return (
    <button
      type="button"
      className={`conversation-card${isSelected ? " is-active" : ""}${unread > 0 ? " has-unread" : ""}`}
      onClick={onSelect}
      title={isCollapsed ? (conversation.is_group ? conversation.group_name || "Группа" : conversation.other_username || "Диалог") : undefined}
      aria-label={isCollapsed ? (conversation.is_group ? conversation.group_name || "Группа" : conversation.other_username || "Диалог") : undefined}
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
            <div className="conversation-name">
              {conversation.is_group ? (
                <span className="conversation-title">{conversation.group_name || "Группа"}</span>
              ) : (
                <UserBadge
                  userId={conversation.other_user_id || ""}
                  username={conversation.other_username || ""}
                  displayName={conversation.other_display_name}
                  emojiId={conversation.other_nickname_emoji_id}
                  showOutline={false}
                  disableLink
                  disableHoverCard
                />
              )}
            </div>
          </div>
          <div className="conversation-last-meta" aria-label={`Последнее сообщение: ${formatConversationDate(conversation.last_message_at)}`}>
            {lastMessageIsMine && !conversation.is_notes && (
              <span
                className={`conversation-status ${peerRead ? "status-double-check is-read" : peerDelivered ? "status-double-check" : "status-check"}`}
                aria-label={peerRead ? "Прочитано" : peerDelivered ? "Доставлено" : "Отправлено"}
              >
                {peerRead || peerDelivered ? "✓✓" : "✓"}
              </span>
            )}
            <span className="conversation-time">
              {formatConversationDate(conversation.last_message_at)}
            </span>
          </div>
        </div>
        <div className="conversation-meta">
          {/* 1:1 chats now preview the last message too; gifts and shared
              posts render as decorated labels instead of raw tokens. */}
          {rawPreview ? (
            <span className="conversation-preview">
              {previewIsGift && <Gift size={13} className="conversation-preview-icon" aria-hidden="true" />}
              {previewIsShare && <Link2 size={13} className="conversation-preview-icon" aria-hidden="true" />}
              {messengerConversationPreview(rawPreview)}
            </span>
          ) : !conversation.is_group && (conversation.other_is_online || conversation.other_last_seen_at) ? (
            <span className="conversation-preview muted">
              {formatPresence(conversation.other_is_online, conversation.other_last_seen_at)}
            </span>
          ) : (
            <span className="conversation-preview muted">Нет сообщений</span>
          )}
          {unread > 0 && <span className="count-badge">{unread > 99 ? "99+" : unread}</span>}
        </div>
      </div>
    </button>
  );
});

// ─── Notes (Заметки) card — pinned at the top of the list ───────────────────
// The personal self-chat. When the backend conversation does not exist yet
// (first visit), a lightweight placeholder card is shown and the conversation
// is created lazily on click.

const NotesCard = memo(function NotesCard({
  notes,
  isSelected,
  isCollapsed,
  creating,
  myUserId,
  onOpen,
}: {
  notes: ConversationView | null;
  isSelected: boolean;
  isCollapsed: boolean;
  creating: boolean;
  myUserId: string | null;
  onOpen: () => void;
}) {
  const unread = notes?.unread_count ?? 0;
  const lastMessageIsMine = Boolean(myUserId && notes && notes.last_message_sender_id === myUserId);

  return (
    <button
      type="button"
      className={`conversation-card notes-card${isSelected ? " is-active" : ""}${creating ? " is-creating" : ""}${unread > 0 ? " has-unread" : ""}`}
      onClick={onOpen}
      title={isCollapsed ? "Заметки" : undefined}
      aria-label="Заметки — личный зашифрованный чат"
    >
      <div className="avatar-wrapper">
        <div className="avatar notes-avatar">
          <span className="notes-avatar-icon"><NotebookPen size={16} /></span>
        </div>
      </div>
      <div className="conversation-copy">
        <div className="conversation-head">
          <div className="conversation-user-badge">
            <div className="conversation-name">
              <span className="conversation-title notes-title">Заметки</span>
            </div>
          </div>
          <div className="conversation-last-meta" aria-label={`Последнее сообщение: ${formatConversationDate(notes?.last_message_at)}`}>
            {lastMessageIsMine && <span className="conversation-status" aria-label="Отправлено">✓</span>}
            <span className="conversation-time">
              {formatConversationDate(notes?.last_message_at)}
            </span>
          </div>
        </div>
        <div className="conversation-meta">
          {notes?.last_message_preview ? (
            <span className="conversation-preview notes-preview">{notes.last_message_preview}</span>
          ) : creating ? (
            <span className="conversation-preview muted">Создаём чат...</span>
          ) : (
            <span className="conversation-preview muted notes-subtitle">Только для тебя · E2E</span>
          )}
          {unread > 0 && <span className="count-badge">{unread > 99 ? "99+" : unread}</span>}
        </div>
      </div>
    </button>
  );
});

const ConversationVirtualList = memo(function ConversationVirtualList({
  conversations,
  selectedId,
  onSelect,
  isCollapsed,
  myUserId,
}: {
  conversations: ConversationView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  isCollapsed: boolean;
  myUserId: string | null;
}) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: conversations.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72,
    overscan: 5,
  });

  if (conversations.length <= 20) {
    return (
      <>
        {conversations.map((conv) => (
          <ConversationCard
            key={conv.id}
            conversation={conv}
            isSelected={conv.id === selectedId}
            onSelect={() => onSelect(conv.id)}
            isCollapsed={isCollapsed}
            myUserId={myUserId}
          />
        ))}
      </>
    );
  }

  return (
    <div ref={parentRef} style={{ overflow: 'auto', flex: 1 }}>
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const conv = conversations[virtualRow.index];
          return (
            <div
              key={conv.id}
              ref={virtualizer.measureElement}
              data-index={virtualRow.index}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <ConversationCard
                conversation={conv}
                isSelected={conv.id === selectedId}
                onSelect={() => onSelect(conv.id)}
                isCollapsed={isCollapsed}
                myUserId={myUserId}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
});

export const ConversationList = memo(function ConversationList({
  onStartChat,
  onSelectConversation,
  startingChat,
  targetUserId,
  isCollapsed = false,
}: Props) {
  const conversations = useMessengerStore((s) => s.conversations);
  const myUserId = useMessengerStore((s) => s.me?.id ?? null);
  const selectedId = useMessengerStore((s) => s.selectedConversationId);
  const selectConversation = useMessengerStore((s) => s.selectConversation);
  const error = useMessengerStore((s) => s.error);
  const setError = useMessengerStore((s) => s.setError);
  const initLoading = useMessengerStore((s) => s.isInitialLoading);
  const [searchQuery, setSearchQuery] = useState("");
  const [showNewChat, setShowNewChat] = useState(false);
  const [notesCreating, setNotesCreating] = useState(false);

  const notesConversation = useMemo(() => conversations.find((c) => c.is_notes) ?? null, [conversations]);

  const filteredConversations = useMemo(() => {
    // The notes chat is rendered as its own pinned card on top.
    const regular = conversations.filter((c) => !c.is_notes);
    if (!searchQuery.trim()) return regular;
    const q = searchQuery.toLowerCase();
    return regular.filter(
      (c) =>
        c.other_username.toLowerCase().includes(q) ||
        (c.other_display_name?.toLowerCase().includes(q) ?? false) ||
        (c.is_group && c.group_name?.toLowerCase().includes(q)),
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

  const handleOpenNotes = useCallback(async () => {
    if (notesConversation) {
      handleSelect(notesConversation.id);
      return;
    }
    setNotesCreating(true);
    const convId = await useMessengerStore.getState().ensureNotesConversation();
    setNotesCreating(false);
    if (convId) handleSelect(convId);
  }, [notesConversation, handleSelect]);

  return (
    <>
      <div className="sidebar-top">
        <div className="sidebar-search-wrap">
          <Search className="sidebar-search-icon" size={17} aria-hidden="true" />
          <input
            id="conversation-search"
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search"
            aria-label="Поиск диалогов"
            className="sidebar-search"
          />
        </div>
        <button
          type="button"
          className="icon-button new-chat-button"
          onClick={() => setShowNewChat(true)}
          title="Новый чат"
          aria-label="Новый чат"
        >
          <span className="new-chat-plus" aria-hidden="true">+</span>
        </button>
      </div>

      <NewChatDialog open={showNewChat} onClose={() => setShowNewChat(false)} />

      {error && (
        <div className="error-banner">
          <span>{error}</span>
          <button type="button" className="error-dismiss" onClick={() => setError(null)} aria-label="Закрыть">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="conversation-list" role="navigation" aria-label="Диалоги">
        {initLoading && conversations.length === 0 && (
          <div className="panel-loader-overlay sidebar-loader">
            <PentagramLoader size="md" />
          </div>
        )}

        <NotesCard
          notes={notesConversation}
          isSelected={Boolean(notesConversation && selectedId === notesConversation.id)}
          isCollapsed={isCollapsed}
          creating={notesCreating}
          myUserId={myUserId}
          onOpen={handleOpenNotes}
        />

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

        <ConversationVirtualList
          conversations={filteredConversations}
          selectedId={selectedId}
          onSelect={handleSelect}
          isCollapsed={isCollapsed}
          myUserId={myUserId}
        />
      </div>
    </>
  );
});
