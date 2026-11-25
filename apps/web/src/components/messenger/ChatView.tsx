import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Folder, Lock, MessageCircle, NotebookPen, Pin, Gift, FileUp } from "lucide-react";
import { toast } from "sonner";
import { PentagramLoader } from "@/components/PentagramLoader";
import { UserBadge } from "@/components/UserBadge";
import { isAnimatedAvatarUrl, UserAvatar } from "@/components/UserAvatar";
import { giftImageUrl, storageUrl } from "@/utils/storage";
import { toViewportRect } from "@/utils/domRect";
import {
  getConversationReadThrough,
  isMessageDeleted,
  queueMarkDelivered,
  selectSelectedConversation,
  useDeletedMessagesVersion,
  useMessengerStore,
} from "@/stores/messengerStore";
import { useLanguageStore } from "@/stores/languageStore";
import { formatPresence, formatTime, getGroupInitials, getInitials, getUserColorClass } from "./utils";
import { MessageBubble } from "./MessageBubble";
import { MessageComposer } from "./MessageComposer";
import { UserInfoPanel } from "./UserInfoPanel";
import { parseGiftContent, GiftDetailDialog } from "./MessageContent";
import { isVoiceUnheard } from "./voice";
import { MessageList, type MessageListHandle, type MessageRenderExtras } from "./MessageList";
import { NotesSettingsDialog } from "./NotesSettingsDialog";
import { NotesOrganizeDialog } from "./NotesOrganizeDialog";
import { NotesPinnedBanner } from "./NotesPinnedBanner";
import { messengerApi } from "@/services/messengerApi";
import { useMessengerConnection } from "@/hooks/useMessengerConnection";
import { hasNotesKey } from "@/utils/notesCrypto";
import { chunkAttachments } from "./attachmentAlbum";
import { uploadFilesAsAttachments } from "./attachmentUpload";
import { useFileDrop } from "@/hooks/useFileDrop";
import type { GomoRichEditorHandle } from "@/components/GomoRichEditor";
import { isMessengerTextEmpty, messengerPlainPreview, messengerTextToCopy } from "./messengerRichTextUtils";
import type { Attachment, MessageView, UploadingFile } from "./types";
import { indexById } from "./core/messageModel";
import { flushDrafts, readDraft, writeDraft } from "./core/drafts";

interface Props {
  onBack: () => void;
  composerRef: React.RefObject<GomoRichEditorHandle | null>;
  typingUsername?: string | null;
  onTyping: (isTyping: boolean) => void;
}

export const ChatView = memo(function ChatView({
  onBack,
  composerRef,
  typingUsername,
  onTyping,
}: Props) {
  const language = useLanguageStore((state) => state.language);
  const navigate = useNavigate();
  const conversation = useMessengerStore(selectSelectedConversation);
  const messages = useMessengerStore((s) => s.messages);
  // O(1) lookups by server id for quoted replies and the pinned message —
  // renderMessage used to scan the whole array per quoted bubble.
  const messageById = useMemo(() => indexById(messages), [messages]);
  const isLoading = useMessengerStore((s) => s.isMessagesLoading);
  const isSending = useMessengerStore((s) => s.isSending);
  const me = useMessengerStore((s) => s.me);
  const connection = useMessengerConnection();

  const sendMessage = useMessengerStore((s) => s.sendMessage);
  const editMessage = useMessengerStore((s) => s.editMessage);
  const deleteMessage = useMessengerStore((s) => s.deleteMessage);
  const togglePin = useMessengerStore((s) => s.togglePin);
  const toggleReaction = useMessengerStore((s) => s.toggleReaction);
  const markVoiceListened = useMessengerStore((s) => s.markVoiceListened);
  const toggleNotesPin = useMessengerStore((s) => s.toggleNotesPin);
  const setConversationBlockedByMe = useMessengerStore((s) => s.setConversationBlockedByMe);
  const loadConversations = useMessengerStore((s) => s.loadConversations);

  const [pinnedText, setPinnedText] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState<string>("");
  // Erasures are journaled outside React state; this tick re-runs the banner
  // cleanup below the moment one lands.
  const deletedMessagesVersion = useDeletedMessagesVersion();

  // The draft belongs to the open conversation, and the state says WHICH
  // conversation it belongs to. That is what makes a switch a single consistent
  // render: `ChatView` is not remounted when the reader switches chats, so a bare
  // piece of state would show the previous chat's text for one render — long
  // enough for the (keyed) composer to mount with it and for its editor to emit
  // it back into the *new* chat. Deriving the text during render removes that
  // window entirely.
  const activeConversationId = conversation?.id ?? null;
  const [draftState, setDraftState] = useState(() => ({
    conversationId: conversation?.id ?? null,
    text: conversation ? readDraft(conversation.id) : "",
  }));
  const draft = draftState.conversationId === activeConversationId
    ? draftState.text
    : activeConversationId
      ? readDraft(activeConversationId)
      : "";

  /**
   * Put text in the composer. `persist: false` is for text that is NOT the
   * reader's draft — the body of a message being edited, which would otherwise
   * overwrite the draft and be lost on cancel (the same for the restore below).
   */
  const applyDraft = useCallback((next: string, persist = true) => {
    setDraftState({ conversationId: activeConversationId, text: next });
    if (!persist || !activeConversationId) return;
    writeDraft(activeConversationId, next);
  }, [activeConversationId]);

  // While editing, the composer's text is the message's body: it must never
  // reach storage as a draft.
  const setDraft = useCallback((next: string) => {
    applyDraft(next, editingMessageId === null);
  }, [applyDraft, editingMessageId]);
  const [showUserInfo, setShowUserInfo] = useState(false);
  const [showNotesInfo, setShowNotesInfo] = useState(false);
  const [giftDetailId, setGiftDetailId] = useState<string | null>(null);
  const [giftDetailRecipientId, setGiftDetailRecipientId] = useState<string | null>(null);
  const [unblocking, setUnblocking] = useState(false);
  const [replyToMessage, setReplyToMessage] = useState<MessageView | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  // Released on the next render: a same-tick double click must not send the
  // same draft twice, but a NEW message never waits for the previous one.
  const sendLockRef = useRef(false);
  useEffect(() => {
    sendLockRef.current = false;
  }, [draft, pendingAttachments]);
  // Message-list handle: send-time follow and the pinned-message jump.
  const messageListRef = useRef<MessageListHandle>(null);
  // Notes self-chat organization
  const [notesFolderFilter, setNotesFolderFilter] = useState<string | null>(null);
  const [organizeMessage, setOrganizeMessage] = useState<MessageView | null>(null);

  const latestMessageId = messages[messages.length - 1]?.id;
  const latestMessageSentAt = messages[messages.length - 1]?.sent_at;
  const isNotesChat = Boolean(conversation?.is_notes);

  const openConversationProfile = useCallback((element: HTMLElement) => {
    if (!conversation?.other_user_id || conversation.is_group || conversation.is_notes) return;

    const from = toViewportRect(element.getBoundingClientRect());
    const rawAvatar = conversation.other_avatar_url;
    const avatarSrc = rawAvatar ? storageUrl("post-images", rawAvatar) || rawAvatar : null;
    const profileAvatarOrigin = from && avatarSrc && !isAnimatedAvatarUrl(avatarSrc)
      ? { from, src: avatarSrc }
      : undefined;

    navigate(`/profile/${conversation.other_user_id}`, {
      state: profileAvatarOrigin
        ? { originAvatarRect: profileAvatarOrigin.from, originAvatarSrc: profileAvatarOrigin.src }
        : undefined,
    });
  }, [conversation, navigate]);

  // Folder chips for the notes chat (decrypted client-side).
  const noteFolders = useMemo(() => {
    if (!isNotesChat) return [] as string[];
    const set = new Set<string>();
    for (const m of messages) if (m.notesFolder) set.add(m.notesFolder);
    return [...set].sort((a, b) => a.localeCompare(b, "ru"));
  }, [isNotesChat, messages]);

  // Pinned notes are shown in a dedicated section on top of the chat. Notes
  // load page by page like any chat, so an older pinned note is hydrated by id
  // into `pinnedNotesById` (one bounded request) instead of forcing the whole
  // history to load. Deleted notes never stay in the curated pinned area.
  const pinnedNotesById = useMessengerStore((s) => s.pinnedNotes ?? []);
  const pinnedNotes = useMemo(() => {
    if (!isNotesChat) return [] as MessageView[];
    const byId = new Map<string, MessageView>();
    for (const message of messages) {
      if (message.notesPinned && !message.is_deleted) byId.set(message.id, message);
    }
    for (const message of pinnedNotesById) {
      if (!message.is_deleted) byId.set(message.id, message);
    }
    return [...byId.values()].sort(
      (left, right) => Date.parse(left.sent_at) - Date.parse(right.sent_at),
    );
  }, [isNotesChat, messages, pinnedNotesById]);

  // Notes are a normal chronological list — pinned notes included, exactly like
  // Telegram keeps a pinned message in its place in the history. The compact
  // banner above the list is only a shortcut. The folder chip filters the list.
  const visibleMessages = useMemo(() => {
    if (!isNotesChat) return messages;
    if (notesFolderFilter === null) return messages;
    if (notesFolderFilter === "none") return messages.filter((m) => !m.notesFolder);
    return messages.filter((m) => m.notesFolder === notesFolderFilter);
  }, [isNotesChat, messages, notesFolderFilter]);

  // Reset notes organization UI when switching chats.
  useEffect(() => {
    setNotesFolderFilter(null);
    setOrganizeMessage(null);
  }, [conversation?.id]);

  // The unread boundary is captured when the conversation is opened: while the
  // reader reads, their own read line advances and would take the marker away
  // under them. The next open recomputes it (Telegram does the same).
  //
  // Gated on the unread count the conversation had when it was selected: the
  // boundary alone cannot tell "nothing is known to be read" (a chat the reader
  // never opened — a marker belongs at its top) from "the server never recorded a
  // read" (a chat that has none — no marker at all).
  const openingUnreadCount = useMessengerStore((s) => s.openingUnreadCount);
  const unreadBoundaryRef = useRef<{ id: string; at: string | null | undefined } | null>(null);
  if (conversation && unreadBoundaryRef.current?.id !== conversation.id) {
    unreadBoundaryRef.current = {
      id: conversation.id,
      // No unread ⇒ no marker at all (`undefined` = "the caller says nothing"),
      // which is different from `null` = "nothing is known to be read" — the
      // latter is what a chat the reader never opened looks like, and where the
      // marker belongs at the top.
      at: openingUnreadCount > 0 ? getConversationReadThrough(conversation.id) : undefined,
    };
  }
  // Switching chats swaps the composer's per-chat state: the draft comes back
  // for the chat being opened, and the reply/edit/attachment staging of the one
  // being left must not follow the reader. A layout effect, so the staging is
  // gone before the frame paints (the draft itself is already right — it is
  // derived during render).
  useLayoutEffect(() => {
    if (!activeConversationId) return;
    flushDrafts();
    setDraftState((current) => (
      current.conversationId === activeConversationId
        ? current
        : { conversationId: activeConversationId, text: readDraft(activeConversationId) }
    ));
    setReplyToMessage(null);
    setEditingMessageId(null);
    setEditingContent("");
    setPendingAttachments([]);
  }, [activeConversationId]);

  // A message that disappears (deleted here or on another device) must not stay
  // quoted in the composer or open in the editor: the banner would point at
  // something that no longer exists. The journal is the authority — a message
  // missing from `messages` merely because it is outside the loaded window is
  // still a valid reply target.
  useEffect(() => {
    if (replyToMessage && isMessageDeleted(replyToMessage.id)) {
      setReplyToMessage(null);
    }
    if (editingMessageId && isMessageDeleted(editingMessageId)) {
      setEditingMessageId(null);
      setEditingContent("");
    }
  }, [deletedMessagesVersion, replyToMessage, editingMessageId]);

  // Mark the last received message delivered when new messages arrive. Read
  // marking is handled by MessageList's visibility tracking (a message is read
  // only while it is actually on screen).
  useEffect(() => {
    if (!me?.id || !conversation || messages.length === 0) return;
    const lastOther = [...messages].reverse().find(
      (m) => m.sender_user_id !== me.id && !m.is_deleted && !m.deleting && !m.localStatus,
    );
    if (lastOther) {
      queueMarkDelivered(conversation.id, lastOther.id, lastOther.sent_at);
    }
  }, [messages.length, latestMessageId, latestMessageSentAt, conversation?.id]);

  // Pinned message fetch
  useEffect(() => {
    const pid = conversation?.pinned_message_id;
    if (!pid) { setPinnedText(null); return; }
    // A deleted pin has no text to show: hide the bar instead of a placeholder
    // (the server clears pinned_message_id on its side; this covers the frame
    // before the refreshed conversation lands).
    if (isMessageDeleted(pid)) { setPinnedText(null); return; }
    const found = messageById.get(pid);
    if (found) {
      setPinnedText(messengerPlainPreview(found.content));
    } else {
      setPinnedText("[Нажмите чтобы открыть]");
    }
  }, [conversation?.pinned_message_id, messageById, deletedMessagesVersion]);

  // Jump to the pinned message. The list pages older history on demand, so a
  // pin outside the loaded window still resolves.
  /** Tap on a quote: jump to the quoted message (the list flashes it). */
  const handleJumpToMessage = useCallback((messageId: string) => {
    messageListRef.current?.scrollToMessage(messageId);
  }, []);

  // A pinned note may live outside the active folder filter (the bar is
  // independent of it): clear the filter first, then scroll on the next frame
  // so the list already contains the target.
  const handleJumpToPinnedNote = useCallback((messageId: string) => {
    setNotesFolderFilter(null);
    requestAnimationFrame(() => messageListRef.current?.scrollToMessage(messageId));
  }, []);

  // Telegram's unblock panel replaces the composer while I block the peer.
  // Unblocking restores the composer and refreshes the list so the real
  // presence comes back (the server hid it for both sides while blocked).
  const handleUnblock = useCallback(async () => {
    if (unblocking) return;
    const peerId = conversation?.other_user_id;
    if (!peerId) return;
    setUnblocking(true);
    try {
      await messengerApi.unblockUser(peerId);
      setConversationBlockedByMe(conversation.id, false);
      toast.success("Пользователь разблокирован");
      void loadConversations({ force: true });
    } catch {
      toast.error("Не удалось разблокировать");
    } finally {
      setUnblocking(false);
    }
  }, [unblocking, conversation, setConversationBlockedByMe, loadConversations]);

  const handleJumpToPinned = useCallback(() => {
    const pid = conversation?.pinned_message_id;
    if (pid) messageListRef.current?.scrollToMessage(pid);
  }, [conversation?.pinned_message_id]);

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
    composerRef.current?.focus();
  }, [handleAttachFiles, composerRef]);

  const { isDragging: isDraggingFiles, dragHandlers } = useFileDrop(handleDropFiles);

  const handleReply = useCallback((msg: MessageView, opts?: { focus?: boolean }) => {
    setReplyToMessage(msg);
    // The swipe path arms the reply banner MID-DRAG with { focus: false } —
    // focusing there would pop the soft keyboard under the moving finger. The
    // keyboard is summoned on the gesture lift ({ focus: true }) instead.
    // Menu / double-click call without opts and focus right away.
    //
    // The focus must land SYNCHRONOUSLY inside the triggering gesture (menu
    // click / double click / swipe lift are all user gestures): iOS Safari
    // raises the soft keyboard only for a focus in the same event tick, so a
    // deferred (setTimeout) focus silently does nothing there.
    if (opts?.focus !== false) {
      composerRef.current?.focus();
    }
  }, [composerRef]);

  const handleCopy = useCallback((text: string) => {
    // Strip BBCode formatting tags but keep [e:…] tokens — pasting the text
    // back into the messenger re-renders the emojis.
    navigator.clipboard.writeText(messengerTextToCopy(text)).catch(() => {
      const ta = document.createElement("textarea");
      ta.value = messengerTextToCopy(text);
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    });
  }, []);

  const handleCancelReply = useCallback(() => setReplyToMessage(null), []);

    // Avoice note is already uploaded by the recorder; this only sends the
  // message that carries it (same path as an attachment, no caption).
  const handleSendVoice = useCallback(async (attachment: Attachment) => {
    const clientId = `c${Date.now().toString(36)}_v${Math.random().toString(36).slice(2, 8)}`;
    const sentId = await sendMessage("", clientId, replyToMessage?.id ?? undefined, [attachment]);
    if (sentId) setReplyToMessage(null);
  }, [sendMessage, replyToMessage]);

  const handleSend = useCallback(() => {
    // Files still uploading must block send — otherwise Enter would send the
    // message without them and leave the finished attachments as orphans.
    if ((isMessengerTextEmpty(draft) && pendingAttachments.length === 0) || uploadingFiles.length > 0) return;
    if (sendLockRef.current) return;
    // The wire format (BBCode tags, [e:…] tokens) inflates the payload — the
    // server enforces 4000 runes, so a fully-formatted near-limit message
    // could be rejected. Block it with a clear error instead of a silent drop.
    if (draft.length > 4000) {
      toast.error("Сообщение слишком длинное — уберите часть форматирования");
      return;
    }
    sendLockRef.current = true;

    const attachmentsToSend = [...pendingAttachments];
    const batches = attachmentsToSend.length > 0
      ? chunkAttachments(attachmentsToSend)
      : [[] as Attachment[]];
    const caption = draft.trim();
    const replyTo = replyToMessage?.id ?? undefined;

    // Telegram's model: the composer empties at once and the message lives in
    // the chat with a clock while the outbox delivers it. Waiting for the
    // server here is exactly what used to block the next message.
    setDraft("");
    setReplyToMessage(null);
    setPendingAttachments([]);
    // Sending is an explicit "I am here" gesture: follow the message we just
    // wrote, even if the user had scrolled up to read history.
    requestAnimationFrame(() => messageListRef.current?.scrollToBottom());

    // One selected batch becomes one message. A batch is capped at six so the
    // renderer can always present it as a complete mosaic. Keep the caption
    // only on the final batch; otherwise a 7+ photo send duplicates the text.
    // The store serializes deliveries per chat, so batches cannot overtake
    // each other even though they are fired without awaiting.
    batches.forEach((batch, index) => {
      const clientId = `c${Date.now().toString(36)}_${index}_${Math.random().toString(36).slice(2, 8)}`;
      // `Promise.resolve` keeps this safe for a stubbed store in tests, and a
      // rejection must never escape as an unhandled one.
      void Promise.resolve(
        sendMessage(
          index === batches.length - 1 ? caption : "",
          clientId,
          index === 0 ? replyTo : undefined,
          batch.length > 0 ? batch : undefined,
        ),
      ).catch(() => "");
    });
  }, [draft, sendMessage, replyToMessage, pendingAttachments, uploadingFiles, setDraft]);

  const handleStartEdit = useCallback((msgId: string, content: string) => {
    setEditingMessageId(msgId);
    setEditingContent(content);
    // The message body, not a draft.
    applyDraft(content, false);
    // Same synchronous-focus rule as reply: iOS raises the soft keyboard only
    // for a focus that lands in the same event tick as the user gesture (the
    // action-panel click), so a deferred focus silently does nothing there.
    // The editor re-seeds from the new draft on the next commit (resetKey
    // bump) without losing focus — GomoRichEditor keeps the instance.
    composerRef.current?.focus();
  }, [composerRef, applyDraft]);

  const handleCancelEdit = useCallback(() => {
    setEditingMessageId(null);
    setEditingContent("");
    // Cancelling an edit brings back whatever the reader was writing.
    applyDraft(activeConversationId ? readDraft(activeConversationId) : "");
  }, [activeConversationId, applyDraft]);

  const handleSaveEdit = useCallback((msgId: string, content: string) => {
    if (content.trim() && content.trim() !== editingContent) {
      editMessage(msgId, content.trim());
    }
    setEditingMessageId(null);
    setEditingContent("");
    // Same as cancel: the draft the reader had before the edit is still theirs.
    applyDraft(activeConversationId ? readDraft(activeConversationId) : "");
  }, [activeConversationId, editMessage, editingContent, applyDraft]);

  const renderMessage = useCallback(
    (
      msg: MessageView,
      prev: MessageView | null,
      extras: MessageRenderExtras,
    ) => {
      void language;
      if (!conversation || !me) return null;
      // The reply target and the peer's receipt arrive resolved from the list
      // (it owns the full history + the receipts map), so this renderer's
      // identity does not change on every arrival and message rows can be
      // memoized. `renderVersion` below covers the ambient inputs.
      const { dateLabel, isConsecutive: isGrouped, quoted, peerReceipt } = extras;
      const giftData = parseGiftContent(msg.content, msg.payload);

      if (giftData) {
        const imgSrc = giftImageUrl(giftData.imageUrl);
        // A gift is a message, not a centered banner: it sits in the stream on
        // the sender's side, in a bubble, with its own timestamp.
        return (
          <div
            data-message-id={msg.id}
            className={`bubble-row msg-gift-row${msg.sender_user_id === me.id ? " is-mine" : ""}`}
          >
            {dateLabel && <div className="date-separator"><span>{dateLabel}</span></div>}
            <div className="bubble-row-inner">
              {conversation.is_group && !isGrouped && msg.sender_user_id !== me.id && msg.sender_username && (
                <div className={`msg-sender-name ${getUserColorClass(msg.sender_user_id)}`} style={{ fontSize: 12, fontWeight: 600, marginBottom: 2, marginLeft: 4 }}>
                  {msg.sender_username}
                </div>
              )}
              <div className="message-bubble">
                <button
                  type="button"
                  className="msg-gift-card"
                  onClick={() => {
                    setGiftDetailId(giftData.giftId);
                    setGiftDetailRecipientId(
                      msg.sender_user_id === me.id ? conversation.other_user_id : me.id,
                    );
                  }}
                >
                  <span className="msg-gift-card-media">
                    {imgSrc ? <img src={imgSrc} alt={giftData.giftName} /> : <Gift size={26} />}
                  </span>
                  <span className="msg-gift-card-copy">
                    <span className="msg-gift-card-eyebrow">Подарок</span>
                    <span className="msg-gift-card-name">{giftData.giftName}</span>
                    <span className="msg-gift-card-link">Посмотреть детали</span>
                  </span>
                </button>
                <div className="message-meta">
                  <span className="message-time">{formatTime(msg.sent_at)}</span>
                </div>
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
            notesControls={Boolean(conversation.is_notes)}
            onNotesOrganize={conversation.is_notes ? (m) => setOrganizeMessage(m) : undefined}
            onEdit={handleStartEdit}
            onDelete={deleteMessage}
            onTogglePin={conversation.is_notes ? toggleNotesPin : togglePin}
            onToggleReaction={conversation.is_notes ? undefined : toggleReaction}
            onVoiceListen={msg.sender_user_id === me.id ? undefined : () => void markVoiceListened(msg.id)}
            voiceUnheard={isVoiceUnheard(msg, {
              viewerId: me.id,
              otherUserId: conversation.other_user_id,
              isGroup: conversation.is_group,
              isNotes: conversation.is_notes,
            })}
            viewerId={me.id}
            onRetry={(m) => sendMessage(m.content, m.client_id, m.parent_message_id ?? undefined, m.attachments)}
            onReply={handleReply}
            onCopy={handleCopy}
            onJumpToMessage={handleJumpToMessage}
            quotedMessage={quoted}
            peerReadAt={peerReceipt?.read_at ?? null}
            peerDeliveredAt={peerReceipt?.delivered_at ?? null}
          />
        </div>
      );
    },
    [
      conversation,
      me,
      language,
      handleStartEdit,
      deleteMessage,
      togglePin,
      toggleNotesPin,
      sendMessage,
      handleReply,
      handleCopy,
      handleJumpToMessage,
      toggleReaction,
      markVoiceListened,
    ],
  );

  // Identity of the ambient render inputs: pinned id, group/notes flags, the
  // reader's own id. Message rows compare it to know whether they must
  // re-render even though their own message object did not change.
  const renderVersion = useMemo(
    () => ({
      pinned: conversation?.pinned_message_id ?? null,
      group: conversation?.is_group ?? false,
      notes: conversation?.is_notes ?? false,
      me: me?.id ?? null,
    }),
    [conversation?.pinned_message_id, conversation?.is_group, conversation?.is_notes, me?.id],
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
            {conversation.other_user_id && !conversation.is_group && !conversation.is_notes ? (
              <button
                type="button"
                className="chat-topbar-profile-trigger"
                aria-label="Открыть профиль"
                onClick={(event) => {
                  event.stopPropagation();
                  openConversationProfile(event.currentTarget);
                }}
              >
                <div className="avatar small">
                  {conversation.other_avatar_url ? (
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
              </button>
            ) : (
              <div className="avatar small">
                {conversation.is_notes ? (
                <div className="avatar notes-avatar">
                  <span className="notes-avatar-icon"><NotebookPen size={18} /></span>
                </div>
                ) : (
                  <span>{getGroupInitials(conversation.group_name)}</span>
                )}
              </div>
            )}
            <div className="chat-topbar-info">
              <div className="chat-topbar-username flex items-center gap-1">
                {conversation.is_notes ? (
                  <span className="font-bold text-sm">Заметки</span>
                ) : conversation.is_group ? (
                  <span className="font-bold text-sm">{conversation.group_name || "Группа"}</span>
                ) : (
                  <UserBadge userId={conversation.other_user_id || ""} username={conversation.other_username || ""} displayName={conversation.other_display_name} emojiId={conversation.other_nickname_emoji_id} disableLink />
                )}
              </div>
              <p className="presence-copy">
                {connection !== "connected" && !conversation.is_notes ? (
                  <span className={`presence-connection is-${connection}`}>
                    <span className="presence-connection-dot" aria-hidden="true" />
                    {connection === "offline" ? "Нет сети" : "Соединение…"}
                  </span>
                ) : conversation.is_notes
                  ? "Шифрование на устройстве"
                  : conversation.encryption_mode === "e2e"
                    ? "🔒 Сквозное шифрование"
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
          <button
            type="button"
            className="pinned-message-banner"
            onClick={handleJumpToPinned}
            title="Перейти к закреплённому сообщению"
          >
            <div className="pinned-message-icon"><Pin size={12} /></div>
            <div className="pinned-message-content">
              <p className="pinned-message-text">{pinnedText}</p>
            </div>
          </button>
        )}

        {/* Pinned notes: ONE compact row (Telegram's pinned bar), never a
            section that pushes the conversation down. */}
        {conversation.is_notes && pinnedNotes.length > 0 && (
          <NotesPinnedBanner notes={pinnedNotes} onJump={handleJumpToPinnedNote} />
        )}
      </div>

      {/* Messages */}
      <div className="chat-messages-area">
        {conversation.is_notes && !hasNotesKey() && (messages.length > 0 || Boolean(conversation.last_message_at)) && (
          <div className="notes-key-banner">
            <Lock size={13} />
            <span>Ключ шифрования недоступен на этом устройстве</span>
            <button type="button" className="notes-key-banner-action" onClick={() => setShowNotesInfo(true)}>
              Ключ
            </button>
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
                <span>В этой папке пока нет заметок</span>
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
            renderMessage={renderMessage}
            renderVersion={renderVersion}
            messagesOverride={visibleMessages}
            unreadBoundaryAt={unreadBoundaryRef.current?.at}
          />
        )}
      </div>

      {/* Composer — or Telegram's unblock panel while I blocked the peer. */}
      {conversation.blocked_by_me ? (
        <div className="chat-blocked-panel">
          <span className="chat-blocked-copy">
            <strong>
              Вы заблокировали {conversation.other_display_name
                || (conversation.other_username ? `@${conversation.other_username}` : "этого пользователя")}
            </strong>
            <span>Сообщения и звонки недоступны, пока пользователь заблокирован.</span>
          </span>
          <button
            type="button"
            className="chat-blocked-unblock"
            onClick={() => void handleUnblock()}
            disabled={unblocking}
          >
            {unblocking ? "Разблокируем…" : "Разблокировать"}
          </button>
        </div>
      ) : (
      <MessageComposer
        // Keyed by conversation: the composer owns an editor instance, an emoji
        // sheet, a full-mode flag — state that must not survive into another
        // chat. Remounting is what guarantees it (the editor seeds from the
        // draft it is mounted with, so the right chat's text is in the box).
        key={conversation.id}
        draft={draft}
        setDraft={setDraft}
        isSending={isSending}
        onSend={handleSend}
        onSendVoice={handleSendVoice}
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
      )}

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
          isMuted={conversation.is_muted}
          onJumpToMessage={handleJumpToMessage}
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
