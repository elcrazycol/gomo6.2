import { memo, useCallback, useEffect, useState, useMemo, useRef } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Gift, Link2, MessageCircle, NotebookPen, Search, UserPlus, X } from "lucide-react";
import { PentagramLoader } from "@/components/PentagramLoader";
import { UserBadge } from "@/components/UserBadge";
import { UserAvatar } from "@/components/UserAvatar";
import { useMessengerStore } from "@/stores/messengerStore";
import { useLanguageStore } from "@/stores/languageStore";
import { ConversationListSkeleton } from "@/components/skeletons/ContentSkeletons";
import { whisperRowVariants } from "@/lib/motion";
import { formatConversationDate, formatPresence, getGroupInitials, getInitials } from "./utils";
import { messengerConversationPreview } from "./messengerRichTextUtils";
import { NewChatDialog } from "./NewChatDialog";
import type { ConversationView } from "./types";

interface Props {
  onStartChat?: (userId: string) => void;
  onSelectConversation?: (id: string) => void;
  startingChat?: boolean;
  targetUserId?: string | null;
  isCollapsed?: boolean;
  animateEntrance?: boolean;
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
  const prefetchConversation = useMessengerStore((s) => s.prefetchConversation);
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
      // Warm the last snapshot of this chat while the pointer travels to it, so
      // the click can paint the messages in the same frame (no skeleton).
      onPointerEnter={() => { if (!isSelected) void prefetchConversation(conversation.id); }}
      onFocus={() => { if (!isSelected) void prefetchConversation(conversation.id); }}
      title={isCollapsed ? (conversation.is_group ? conversation.group_name || "Группа" : conversation.other_username || "Диалог") : undefined}
      aria-label={isCollapsed ? (conversation.is_group ? conversation.group_name || "Группа" : conversation.other_username || "Диалог") : undefined}
    >
      <div className="avatar-wrapper">
        <div className="avatar">
          {conversation.is_group ? (
            <span>{getGroupInitials(conversation.group_name)}</span>
          ) : conversation.other_avatar_url ? (
            <UserAvatar
              src={conversation.other_avatar_url}
              userId={conversation.other_user_id}
              alt={conversation.other_username || ""}
              className="w-full h-full"
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
            <span className="conversation-preview notes-preview">
              {messengerConversationPreview(notes.last_message_preview)}
            </span>
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

/**
 * The conversation rows.
 *
 * Deliberately NOT virtualized: a sidebar list of a few hundred rows is cheap
 * once every row carries the native `content-visibility` contract
 * (`.chat-native-row`) — the browser skips the layout/paint of the rows that
 * are outside the scrollport, which is all a virtualizer did here. The list
 * itself (`.conversation-list`) owns the scrolling.
 */
interface EntranceRowProps {
  /** One-shot entrance (the initial cascade only — later updates arrive as plain renders). */
  animate: boolean;
  /** Cascade slot: 0 = the pinned Notes card, conversation rows start at 1. */
  index?: number;
  /** Layout height hint for the scroll system's rows (px). */
  intrinsicHeight?: number;
  /** Scroll-system row classes (`.chat-native-row` contract in index.css). */
  rowClass?: boolean;
  children: React.ReactNode;
}

/**
 * A whisper-quiet, self-driven entrance row: opacity plus a tiny lift, no
 * scale. Self-driven (`initial`/`animate` claimed by the row itself) is the
 * point — the old inherited variant tree froze at its hidden state whenever a
 * re-render (selection change, ws update) landed while the cascade ran, which
 * left every conversation invisible after exiting a chat.
 *
 * The animate/index decision is captured on first mount and frozen: the list
 * flips its cascade gate constant, so rows already playing keep stable props
 * and rows mounted later render plain forever, with no element-type flip.
 */
const EntranceRow = ({ animate, index = 0, intrinsicHeight, rowClass, children }: EntranceRowProps) => {
  const frozen = useRef<{ animate: boolean; index: number } | null>(null);
  if (!frozen.current) frozen.current = { animate, index };
  const { animate: once, index: slot } = frozen.current;
  const style = intrinsicHeight ? { containIntrinsicSize: `auto ${intrinsicHeight}px` } : undefined;
  const className = rowClass ? "conversation-native-row chat-native-row" : undefined;

  if (!once) {
    return (
      <div className={className} style={style}>
        {children}
      </div>
    );
  }
  return (
    <motion.div
      className={className}
      style={style}
      initial="hidden"
      animate="show"
      variants={whisperRowVariants(slot)}
    >
      {children}
    </motion.div>
  );
};

const ConversationRows = memo(function ConversationRows({
  conversations,
  selectedId,
  onSelect,
  isCollapsed,
  myUserId,
  motionEnabled,
}: {
  conversations: ConversationView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  isCollapsed: boolean;
  myUserId: string | null;
  motionEnabled: boolean;
}) {
  return (
    <>
      {conversations.map((conv, index) => (
        <EntranceRow key={conv.id} animate={motionEnabled} index={index + 1} intrinsicHeight={72} rowClass>
          <ConversationCard
            conversation={conv}
            isSelected={conv.id === selectedId}
            onSelect={() => onSelect(conv.id)}
            isCollapsed={isCollapsed}
            myUserId={myUserId}
          />
        </EntranceRow>
      ))}
    </>
  );
});

export const ConversationList = memo(function ConversationList({
  onStartChat,
  onSelectConversation,
  startingChat,
  targetUserId,
  isCollapsed = false,
  animateEntrance = true,
}: Props) {
  const conversations = useMessengerStore((s) => s.conversations);
  const myUserId = useMessengerStore((s) => s.me?.id ?? null);
  const selectedId = useMessengerStore((s) => s.selectedConversationId);
  const selectConversation = useMessengerStore((s) => s.selectConversation);
  const error = useMessengerStore((s) => s.error);
  const setError = useMessengerStore((s) => s.setError);
  const initLoading = useMessengerStore((s) => s.isInitialLoading);
  const prefersReducedMotion = useReducedMotion();
  const listRef = useRef<HTMLDivElement | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showNewChat, setShowNewChat] = useState(false);
  const [notesCreating, setNotesCreating] = useState(false);

  // Only run the entrance cascade the first time real conversations land.
  // Subsequent updates (new messages, reorder, search) must not re-cascade.
  // State, not a ref: the gate must become false through a render so the latch
  // is observable; rows that already mounted have frozen their decision inside
  // EntranceRow, so flipping the gate is prop-stable for them.
  const [cascadeDone, setCascadeDone] = useState(false);
  const runInitialCascade =
    animateEntrance &&
    !prefersReducedMotion &&
    conversations.length > 0 &&
    !initLoading &&
    !cascadeDone;

  // Latch the cascade off after one pass (~9 slots × 25ms + the spring tail).
  useEffect(() => {
    if (!runInitialCascade) return;
    const timer = setTimeout(() => setCascadeDone(true), 900);
    return () => clearTimeout(timer);
  }, [runInitialCascade]);

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

      {initLoading && conversations.length === 0 ? (
        <ConversationListSkeleton isCollapsed={isCollapsed} />
      ) : (
        // Plain container on purpose: every row below animates self-driven, so
        // this list can no longer freeze at a half-played cascade (the old
        // inherited variant tree froze rows at opacity 0 whenever a
        // render landed mid-cascade — "exited the chat, the list vanished").
        <div
          ref={listRef}
          className="conversation-list"
          role="navigation"
          aria-label="Диалоги"
          data-testid="conversation-list"
        >
          <EntranceRow animate={runInitialCascade}>
            <NotesCard
              notes={notesConversation}
              isSelected={Boolean(notesConversation && selectedId === notesConversation.id)}
              isCollapsed={isCollapsed}
              creating={notesCreating}
              myUserId={myUserId}
              onOpen={handleOpenNotes}
            />
          </EntranceRow>

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

          <ConversationRows
            conversations={filteredConversations}
            selectedId={selectedId}
            onSelect={handleSelect}
            isCollapsed={isCollapsed}
            myUserId={myUserId}
            motionEnabled={runInitialCascade}
          />
        </div>
      )}
    </>
  );
});
