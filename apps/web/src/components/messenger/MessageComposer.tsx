import { memo, useCallback, useEffect, useRef, type KeyboardEvent, type RefObject } from "react";
import { SendHorizontal, X, Pencil, CornerDownRight, Paperclip, Image as ImageIcon, FileText, Mic } from "lucide-react";
import type { Attachment, MessageView, UploadingFile } from "./types";

const MAX_LENGTH = 4000;
const TYPING_DEBOUNCE_MS = 1000;

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
  /** In-flight uploads shown as progress chips (uploadingFiles=[] hides the row). */
  uploadingFiles?: UploadingFile[];
  /** Starts uploading files; progress is reported back via `uploadingFiles`. */
  onAttachFiles?: (files: File[]) => void;
  placeholder?: string;
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

/**
 * Extract files pasted via Ctrl+V. clipboardData.items is the source of truth
 * (a pasted screenshot appears in both `files` and `items` — using items first
 * avoids attaching the same image twice); `files` is the fallback for browsers
 * that only populate it (e.g. Firefox for files copied from disk).
 */
function getPastedFiles(e: React.ClipboardEvent<HTMLTextAreaElement>): File[] {
  const items = e.clipboardData?.items;
  if (items && items.length > 0) {
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) return files;
  }
  return Array.from(e.clipboardData?.files ?? []);
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
  uploadingFiles = [],
  onAttachFiles,
  placeholder,
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
        if (!isSending && uploadingFiles.length === 0 && (draft.trim() || pendingAttachments.length > 0)) {
          stopTyping();
          onSend();
        }
      }
    },
    [onSend, isSending, draft, stopTyping, isEditing, editingContent, editingMessageId, onSaveEdit, onCancelEdit, pendingAttachments, uploadingFiles],
  );

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    onAttachFiles?.(Array.from(files));
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [onAttachFiles]);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = getPastedFiles(e);
    if (files.length === 0) return; // plain text — let the default paste through
    e.preventDefault();
    onAttachFiles?.(files);
  }, [onAttachFiles]);

  const handleRemoveAttachment = useCallback((index: number) => {
    if (onAttachmentsChange) {
      onAttachmentsChange(pendingAttachments.filter((_, i) => i !== index));
    }
  }, [pendingAttachments, onAttachmentsChange]);

  const remaining = MAX_LENGTH - draft.length;
  const canSend = isEditing
    ? draft.trim().length > 0
    : !isSending && uploadingFiles.length === 0 && (draft.trim().length > 0 || pendingAttachments.length > 0);

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

      {/* Uploading files progress */}
      {uploadingFiles.length > 0 && (
        <div className="composer-attachments-preview">
          {uploadingFiles.map((file) => (
            <div key={file.id} className="composer-uploading-chip">
              <span className="composer-attachment-icon">{getAttachmentIcon(file.type)}</span>
              <span className="composer-uploading-info">
                <span className="composer-attachment-name">{file.name}</span>
                <span className="composer-uploading-bar">
                  <span className="composer-uploading-bar-fill" style={{ width: `${file.percent}%` }} />
                </span>
              </span>
              <span className="composer-uploading-pct">{file.percent}%</span>
            </div>
          ))}
        </div>
      )}

      {/* Pending attachments preview */}
      {pendingAttachments.length > 0 && (
        <div className="composer-attachments-preview">
          {pendingAttachments.map((att, i) => (
            <div key={i} className="composer-attachment-chip">
              <span className="composer-attachment-icon">{getAttachmentIcon(att.type)}</span>
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
          onPaste={handlePaste}
          placeholder={isEditing ? "" : placeholder ?? "Напиши сообщение..."}
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
