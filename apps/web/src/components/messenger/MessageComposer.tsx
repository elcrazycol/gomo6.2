import { memo, useCallback, useEffect, useRef, type KeyboardEvent, type RefObject } from "react";
import { SendHorizontal, X, Pencil, CornerDownRight, Paperclip, Image as ImageIcon, FileText, Mic } from "lucide-react";
import type { Attachment, MessageView } from "./types";
import { messengerApi } from "@/services/messengerApi";
import { storageUrl } from "@/utils/storage";

const MAX_LENGTH = 4000;
const TYPING_DEBOUNCE_MS = 500;

interface Props {
  draft: string;
  setDraft: (value: string) => void;
  isSending: boolean;
  onSend: () => void;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  onTyping?: (isTyping: boolean) => void;
  editingMessageId?: string | null;
  editingContent?: string;
  onCancelEdit?: () => void;
  onSaveEdit?: (messageId: string, content: string) => void;
  replyToMessage?: MessageView | null;
  replySenderLabel?: string;
  onCancelReply?: () => void;
  pendingAttachments?: Attachment[];
  onAttachmentsChange?: (attachments: Attachment[]) => void;
}

function getAttachmentIcon(type: Attachment["type"]) {
  switch (type) {
    case "image": return <ImageIcon size={16} />;
    case "audio": return <Mic size={16} />;
    default: return <FileText size={16} />;
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const MessageComposer = memo(function MessageComposer({
  draft,
  setDraft,
  isSending,
  onSend,
  composerRef,
  onTyping,
  editingMessageId,
  editingContent,
  onCancelEdit,
  onSaveEdit,
  replyToMessage,
  replySenderLabel,
  onCancelReply,
  pendingAttachments = [],
  onAttachmentsChange,
}: Props) {
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isEditing = editingMessageId != null;

  useEffect(() => {
    if (isEditing) {
      composerRef.current?.focus();
      const el = composerRef.current;
      if (el) {
        el.setSelectionRange(el.value.length, el.value.length);
      }
    }
  }, [isEditing, composerRef]);

  useEffect(() => {
    return () => {
      if (typingTimer.current) clearTimeout(typingTimer.current);
    };
  }, []);

  const stopTyping = useCallback(() => {
    if (isTypingRef.current) {
      isTypingRef.current = false;
      onTyping?.(false);
    }
    if (typingTimer.current) {
      clearTimeout(typingTimer.current);
      typingTimer.current = null;
    }
  }, [onTyping]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      if (value.length <= MAX_LENGTH) setDraft(value);

      if (!CSS.supports('field-sizing', 'content')) {
        const ta = e.target;
        ta.style.height = 'auto';
        ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
      }

      if (!value) {
        e.target.style.height = '';
      }

      if (onTyping && value.length > 0) {
        if (!isTypingRef.current) {
          isTypingRef.current = true;
          onTyping(true);
        }
        if (typingTimer.current) clearTimeout(typingTimer.current);
        typingTimer.current = setTimeout(() => {
          isTypingRef.current = false;
          onTyping(false);
          typingTimer.current = null;
        }, TYPING_DEBOUNCE_MS);
      } else if (onTyping) {
        stopTyping();
      }
    },
    [setDraft, onTyping],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent?.isComposing) {
        e.preventDefault();
        if (isEditing) {
          const trimmed = draft.trim();
          if (trimmed && trimmed !== editingContent && editingMessageId) {
            onSaveEdit?.(editingMessageId, trimmed);
          } else {
            onCancelEdit?.();
          }
        } else {
          stopTyping();
          onSend();
        }
      }
      if (e.key === "Escape" && isEditing) {
        e.preventDefault();
        onCancelEdit?.();
      }
    },
    [onSend, stopTyping, isEditing, draft, editingContent, editingMessageId, onSaveEdit, onCancelEdit],
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (isEditing) {
        const trimmed = draft.trim();
        if (trimmed && trimmed !== editingContent && editingMessageId) {
          onSaveEdit?.(editingMessageId, trimmed);
        } else {
          onCancelEdit?.();
        }
      } else {
        if (!isSending && (draft.trim() || pendingAttachments.length > 0)) {
          stopTyping();
          onSend();
        }
      }
    },
    [onSend, isSending, draft, stopTyping, isEditing, editingContent, editingMessageId, onSaveEdit, onCancelEdit, pendingAttachments],
  );

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newAttachments: Attachment[] = [];
    for (const file of Array.from(files)) {
      try {
        const { path } = await messengerApi.uploadFile(file);
        const type: Attachment["type"] = file.type.startsWith("image/") ? "image"
          : file.type.startsWith("video/") ? "video"
          : file.type.startsWith("audio/") ? "audio"
          : "file";

        newAttachments.push({
          url: path,
          type,
          name: file.name,
          size: file.size,
          mime: file.type || "application/octet-stream",
        });
      } catch (err) {
        console.error("Upload failed:", err);
      }
    }

    if (newAttachments.length > 0 && onAttachmentsChange) {
      onAttachmentsChange([...pendingAttachments, ...newAttachments]);
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [pendingAttachments, onAttachmentsChange]);

  const handleRemoveAttachment = useCallback((index: number) => {
    if (onAttachmentsChange) {
      onAttachmentsChange(pendingAttachments.filter((_, i) => i !== index));
    }
  }, [pendingAttachments, onAttachmentsChange]);

  const remaining = MAX_LENGTH - draft.length;
  const canSend = isEditing
    ? draft.trim().length > 0
    : !isSending && (draft.trim().length > 0 || pendingAttachments.length > 0);

  return (
    <form className={`composer${isSending ? " is-sending" : ""}`} onSubmit={handleSubmit}>
      {replyToMessage && (
        <div className="composer-reply-banner">
          <CornerDownRight size={14} style={{ color: "hsl(var(--primary))", flexShrink: 0 }} />
          <span className="reply-label">{replySenderLabel}</span>
          <span className="reply-text">
            {replyToMessage.is_deleted ? "Удалено" : replyToMessage.content.slice(0, 120)}
          </span>
          <button type="button" className="composer-reply-cancel" onClick={onCancelReply} aria-label="Отменить ответ">
            <X size={14} />
          </button>
        </div>
      )}
      {isEditing && (
        <div className="composer-edit-banner">
          <Pencil size={13} />
          <span>Редактирование</span>
          <button type="button" className="composer-edit-cancel" onClick={onCancelEdit} aria-label="Отменить">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Pending attachments preview */}
      {pendingAttachments.length > 0 && (
        <div className="composer-attachments-preview">
          {pendingAttachments.map((att, i) => (
            <div key={i} className="composer-attachment-chip">
              {att.type === "image" && att.url ? (
                <img src={storageUrl("uploads", att.url) || undefined} alt={att.name} className="composer-attachment-thumb" />
              ) : (
                <span className="composer-attachment-icon">{getAttachmentIcon(att.type)}</span>
              )}
              <span className="composer-attachment-name">{att.name}</span>
              <span className="composer-attachment-size">{formatFileSize(att.size)}</span>
              <button type="button" className="composer-attachment-remove" onClick={() => handleRemoveAttachment(i)} aria-label="Удалить">
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="composer-attach-btn-wrap">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,video/*,audio/*,.pdf,.txt,.md"
          onChange={handleFileSelect}
          style={{ display: "none" }}
        />
        <button
          type="button"
          className="composer-attach-btn"
          onClick={() => fileInputRef.current?.click()}
          aria-label="Прикрепить файл"
        >
          <Paperclip size={18} />
        </button>
      </div>

      <div className="composer-input-wrap">
        <textarea
          ref={composerRef}
          value={draft}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={isEditing ? "" : "Напиши сообщение..."}
          aria-label={isEditing ? "Редактировать сообщение" : "Написать сообщение"}
          maxLength={MAX_LENGTH}
          rows={1}
          className={isEditing ? "composer-edit-input" : ""}
        />
        {remaining < 100 && draft.length > 0 && (
          <span className={`composer-counter ${remaining < 20 ? "is-critical" : ""}`}>
            {remaining}
          </span>
        )}
      </div>
      <button type="submit" className={`send-button${isEditing ? " is-edit" : ""}`} disabled={!canSend} aria-label={isEditing ? "Сохранить" : "Отправить"} onMouseDown={(e) => e.preventDefault()}>
        {isEditing ? <Pencil size={16} /> : <SendHorizontal size={16} />}
      </button>
    </form>
  );
});
