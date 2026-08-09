import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, Folder, Lock, MessageCircle, NotebookPen, Pin, Gift, FileUp } from "lucide-react";
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
import { NotesSettingsDialog } from "./NotesSettingsDialog";
import { NotesOrganizeDialog } from "./NotesOrganizeDialog";
import { hasNotesKey } from "@/utils/notesCrypto";
import { isConsecutive } from "./messageListUtils";
import { chunkAttachments, MAX_ALBUM_ATTACHMENTS } from "./attachmentAlbum";
import { uploadFilesAsAttachments } from "./attachmentUpload";
import { useFileDrop } from "@/hooks/useFileDrop";
import type { Attachment, MessageView, UploadingFile } from "./types";

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
  const toggleNotesPin = useMessengerStore((s) => s.toggleNotesPin);

  const messageListRef = useRef<MessageListHandle>(null);

  const [draft, setDraft] = useState("");
  const [pinnedText, setPinnedText] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState<string>("");
  const [showUserInfo, setShowUserInfo] = useState(false);
  const [showNotesInfo, setShowNotesInfo] = useState(false);
  const [giftDetailId, setGiftDetailId] = useState<string | null>(null);
  const [giftDetailRecipientId, setGiftDetailRecipientId] = useState<string | null>(null);
  const [replyToMessage, setReplyToMessage] = useState<MessageView | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  const [isBatchSending, setIsBatchSending] = useState(false);
  const batchSendingRef = useRef(false);
  // Notes self-chat organization
  const [notesFolderFilter, setNotesFolderFilter] = useState<string | null>(null);
  const [organizeMessage, setOrganizeMessage] = useState<MessageView | null>(null);

  const latestMessageId = messages[messages.length - 1]?.id;
  const latestMessageSentAt = messages[messages.length - 1]?.sent_at;
  const isNotesChat = Boolean(conversation?.is_notes);

  // Folder chips for the notes chat (decrypted client-side).
  const noteFolders = useMemo(() => {
    if (!isNotesChat) return [] as string[];
    const set = new Set<string>();
    for (const m of messages) if (m.notesFolder) set.add(m.notesFolder);
    return [...set].sort((a, b) => a.localeCompare(b, "ru"));
  }, [isNotesChat, messages]);

  // Pinned notes are shown in a dedicated section on top of the chat.
  // Deleted notes never stay in the curated pinned area.
  const pinnedNotes = useMemo(() => {
    if (!isNotesChat) return [] as MessageView[];
    return messages.filter((m) => m.notesPinned && !m.is_deleted);
  }, [isNotesChat, messages]);

  // The main list shows everything except pinned notes, optionally filtered by
  // the active folder chip.
  const visibleMessages = useMemo(() => {
    if (!isNotesChat) return messages;
    const unpinned = messages.filter((m) => !m.notesPinned);
    if (notesFolderFilter === null) return unpinned;
    if (notesFolderFilter === "none") return unpinned.filter((m) => !m.notesFolder);
    return unpinned.filter((m) => m.notesFolder === notesFolderFilter);
  }, [isNotesChat, messages, notesFolderFilter]);

  // Reset notes organization UI when switching chats.
  useEffect(() => {
    setNotesFolderFilter(null);
    setOrganizeMessage(null);
  }, [conversation?.id]);

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

  // Central upload path for the paperclip button, Ctrl+V and drag & drop.
  // Shows a per-file progress chip until the attachment lands in the composer.
  const handleAttachFiles = useCallback(async (files: File[]) => {
    const entries: UploadingFile[] = files.map((file, index) => ({
      id: `up_${Date.now().toString(36)}_${index}_${Math.random().toString(36).slice(2, 7)}`,
      name: file.name,
      percent: 0,
      type: file.type.startsWith("image/") ? "image"
        : file.type.startsWith("video/") ? "video"
        : file.type.startsWith("audio/") ? "audio"
        : "file",
    }));
    setUploadingFiles((prev) => [...prev, ...entries]);

    try {
      const newAttachments = await uploadFilesAsAttachments(files, (progress) => {
        setUploadingFiles((prev) => prev.map((u) =>
          u.id === entries[progress.index]?.id ? { ...u, percent: progress.percent } : u,
        ));
      });
      if (newAttachments.length > 0) {
        setPendingAttachments((prev) => [...prev, ...newAttachments]);
      }
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setUploadingFiles((prev) => prev.filter((u) => !entries.some((e) => e.id === u.id)));
    }
  }, []);

  const handleDropFiles = useCallback((files: File[]) => {
    void handleAttachFiles(files);
    setTimeout(() => composerRef.current?.focus(), 50);
  }, [handleAttachFiles, composerRef]);

  const { isDragging: isDraggingFiles, dragHandlers } = useFileDrop(handleDropFiles);

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

  const handleSend = useCallback(async () => {
    // Files still uploading must block send — otherwise Enter would send the
    // message without them and leave the finished attachments as orphans.
    if ((!draft.trim() && pendingAttachments.length === 0) || isSending || batchSendingRef.current || uploadingFiles.length > 0) return;

    const attachmentsToSend = [...pendingAttachments];
    const batches = attachmentsToSend.length > 0
      ? chunkAttachments(attachmentsToSend)
      : [[] as Attachment[]];
    const caption = draft.trim() || " ";
    let firstSent = true;

    // Keep the composer locked across every message in a 6 + 1 + ... send.
    // The store's isSending flag belongs to one request and can become false
    // between batches, so it is not sufficient as the batch-level mutex.
    batchSendingRef.current = true;
    setIsBatchSending(true);

    try {
      // One selected batch becomes one message. A batch is capped at six so the
      // renderer can always present it as a complete mosaic. Keep the caption
      // only on the final batch; otherwise a 7+ photo send duplicates the text.
      for (let index = 0; index < batches.length; index += 1) {
        const clientId = `c${Date.now().toString(36)}_${index}_${Math.random().toString(36).slice(2, 8)}`;
        let sentId = "";
        try {
          sentId = await sendMessage(
            index === batches.length - 1 ? caption : " ",
            clientId,
            firstSent ? replyToMessage?.id ?? undefined : undefined,
            batches[index].length > 0 ? batches[index] : undefined,
          );
        } catch {
          // sendMessage normally converts request failures into an empty id,
          // but keep the same retry-safe remainder if a lower layer throws.
        }
        if (!sentId) {
          // Keep only the failed batch and everything after it. Retrying now
          // cannot duplicate the batches that were already accepted.
          setPendingAttachments(attachmentsToSend.slice(index * MAX_ALBUM_ATTACHMENTS));
          // The reply target was consumed by the first successful batch. If
          // this is a retry of a later batch, do not attach it to the same
          // quoted message a second time.
          if (!firstSent) setReplyToMessage(null);
          return;
        }
        firstSent = false;
        setPendingAttachments(attachmentsToSend.slice((index + 1) * MAX_ALBUM_ATTACHMENTS));
      }

      setDraft("");
      setReplyToMessage(null);
      setPendingAttachments([]);
      // Always bring the author back to the bottom so their latest album part is
      // visible, even when they were reading history.
      requestAnimationFrame(() => messageListRef.current?.scrollToBottom());
    } finally {
      batchSendingRef.current = false;
      setIsBatchSending(false);
    }
  }, [draft, isSending, sendMessage, replyToMessage, pendingAttachments, uploadingFiles]);

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
            notesControls={Boolean(conversation.is_notes)}
            onNotesOrganize={conversation.is_notes ? (m) => setOrganizeMessage(m) : undefined}
            onEdit={handleStartEdit}
            onDelete={deleteMessage}
            onTogglePin={conversation.is_notes ? toggleNotesPin : togglePin}
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
    [conversation, me, messages, receipts, handleStartEdit, deleteMessage, togglePin, toggleNotesPin, sendMessage, handleReply, handleCopy],
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
    <div className="chat-view-dnd-root" {...dragHandlers}>
      {/* Header group: topbar + pinned banner — one grid row */}
      <div className="chat-header-group">
        <div
          className="chat-topbar"
          onClick={() => {
            if (conversation.is_notes) setShowNotesInfo(true);
            else setShowUserInfo(true);
          }}
        >
          <div className="chat-topbar-main">
            <button type="button" className="mobile-only messenger-back-button" onClick={(e) => { e.stopPropagation(); onBack(); }} aria-label="Назад">
              <ArrowLeft size={16} />
            </button>
            <div className="avatar small">
              {conversation.is_notes ? (
                <div className="avatar notes-avatar">
                  <span className="notes-avatar-icon"><NotebookPen size={18} /></span>
                </div>
              ) : conversation.is_group ? (
                <span>{conversation.group_name ? conversation.group_name.slice(0, 2).toUpperCase() : "ГР"}</span>
              ) : conversation.other_avatar_url ? (
                <img src={storageUrl("post-images", conversation.other_avatar_url) || undefined} alt={conversation.other_username || ""} />
              ) : (
                <span>{getInitials(conversation.other_username || "")}</span>
              )}
            </div>
            <div className="chat-topbar-info">
              <div className="chat-topbar-username flex items-center gap-1">
                {conversation.is_notes ? (
                  <span className="font-bold text-sm">Заметки</span>
                ) : conversation.is_group ? (
                  <span className="font-bold text-sm">{conversation.group_name || "Группа"}</span>
                ) : (
                  <UserBadge userId={conversation.other_user_id || ""} username={conversation.other_username || ""} displayName={conversation.other_display_name} showOutline={false} disableLink />
                )}
              </div>
              <p className="presence-copy">
                {conversation.is_notes
                  ? "Шифрование на устройстве"
                  : typingUsername
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
        {conversation.is_notes && !hasNotesKey() && (messages.length > 0 || Boolean(conversation.last_message_at)) && (
          <div className="notes-key-banner">
            <Lock size={14} />
            <span>Ключ шифрования не найден на этом устройстве. Заметки можно прочитать, только восстановив ключ из резервной копии.</span>
            <button type="button" className="notes-key-banner-action" onClick={() => setShowNotesInfo(true)}>
              Восстановить ключ
            </button>
          </div>
        )}
        {conversation.is_notes && pinnedNotes.length > 0 && (
          <div className="notes-pinned-section">
            <div className="notes-section-heading">
              <Pin size={12} />
              <span>Закреплённые</span>
              <span className="notes-section-count">{pinnedNotes.length}</span>
            </div>
            <div className="notes-pinned-list">
              {pinnedNotes.map((msg, index) => {
                const prev = index > 0 ? pinnedNotes[index - 1] : null;
                return (
                  <div key={msg.id} className="notes-pinned-item">
                    {renderMessage(msg, prev, {
                      dateLabel: null,
                      isConsecutive: isConsecutive(prev, msg),
                      isNew: false,
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {conversation.is_notes && noteFolders.length > 0 && (
          <div className="notes-filter-bar" role="tablist" aria-label="Фильтр заметок по папкам">
            <button
              type="button"
              className={notesFolderFilter === null ? "is-active" : ""}
              onClick={() => setNotesFolderFilter(null)}
            >
              Все
            </button>
            <button
              type="button"
              className={notesFolderFilter === "none" ? "is-active" : ""}
              onClick={() => setNotesFolderFilter("none")}
            >
              Без папки
            </button>
            {noteFolders.map((folder) => (
              <button
                key={folder}
                type="button"
                className={notesFolderFilter === folder ? "is-active" : ""}
                onClick={() => setNotesFolderFilter(folder)}
              >
                {folder}
              </button>
            ))}
          </div>
        )}
        {isLoading && messages.length === 0 ? (
          <div className="inline-loader"><PentagramLoader size="md" /></div>
        ) : visibleMessages.length === 0 ? (
          conversation.is_notes ? (
            messages.length === 0 ? (
              <div className="empty-thread hero notes-empty">
                <div className="notes-empty-icon"><NotebookPen size={22} /></div>
                <h2>Личные Заметки</h2>
                <p>Пиши сюда всё, что хочешь сохранить. Каждая заметка шифруется прямо на твоём устройстве — сервер хранит только шифротекст и не может его прочитать.</p>
              </div>
            ) : (
              <div className="notes-filter-empty">
                <Folder size={18} />
                <span>{notesFolderFilter !== null ? "В этой папке пока нет заметок" : "Все заметки закреплены"}</span>
              </div>
            )
          ) : (
            <div className="empty-thread hero">
              <MessageCircle size={18} />
              <h2>Диалог готов</h2>
              <p>Напиши первое сообщение, и переписка начнётся сразу.</p>
            </div>
          )
        ) : (
          <MessageList
            key={conversation.id}
            ref={messageListRef}
            onBack={onBack}
            renderMessage={renderMessage}
            messagesOverride={visibleMessages}
          />
        )}
      </div>

      {/* Composer */}
      <MessageComposer
        draft={draft}
        setDraft={setDraft}
        isSending={isSending || isBatchSending}
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
        uploadingFiles={uploadingFiles}
        onAttachFiles={handleAttachFiles}
        placeholder={conversation.is_notes ? "Запиши мысль..." : undefined}
      />

      {/* Notes security dialog (self-chat) */}
      <NotesSettingsDialog open={showNotesInfo} onOpenChange={setShowNotesInfo} conversationId={conversation.id} />

      {/* Notes organize dialog (pin/folder/tags) */}
      <NotesOrganizeDialog
        message={organizeMessage}
        open={Boolean(organizeMessage)}
        onOpenChange={(open) => { if (!open) setOrganizeMessage(null); }}
      />

      {/* User info panel */}
      {!conversation.is_notes && (
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
      )}

      {/* Gift detail dialog */}
      {giftDetailId && (
        <GiftDetailDialog
          giftId={giftDetailId}
          recipientId={giftDetailRecipientId ?? me.id}
          open={true}
          onOpenChange={(v) => { if (!v) { setGiftDetailId(null); setGiftDetailRecipientId(null); } }}
        />
      )}

      {/* Drag & drop attach overlay */}
      {isDraggingFiles && (
        <div className="chat-drop-overlay">
          <div className="chat-drop-card">
            <div className="chat-drop-card-icon"><FileUp size={30} /></div>
            <div className="chat-drop-card-title">Отпустите, чтобы прикрепить</div>
            <div className="chat-drop-card-sub">Файлы, фото и видео появятся в поле ввода</div>
          </div>
        </div>
      )}
    </div>
  );
});
