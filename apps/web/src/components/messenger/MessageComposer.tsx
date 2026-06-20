import { memo, useCallback, useEffect, useRef, type KeyboardEvent, type RefObject } from "react";
import { SendHorizontal, X, Pencil, CornerDownRight } from "lucide-react";
import type { MessageView } from "./types";

const MAX_LENGTH = 4000;
const TYPING_DEBOUNCE_MS = 500;

interface Props {
  draft: string;
  setDraft: (value: string) => void;
  isSending: boolean;
  onSend: () => void;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  onTyping?: (isTyping: boolean) => void;
  // Edit mode (Telegram-style inline editing in composer)
  editingMessageId?: string | null;
  editingContent?: string;
  onCancelEdit?: () => void;
  onSaveEdit?: (messageId: string, content: string) => void;
  replyToMessage?: MessageView | null;
  replySenderLabel?: string;
  onCancelReply?: () => void;
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
}: Props) {
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const isEditing = editingMessageId != null;

  // Auto-focus composer when entering edit mode
  useEffect(() => {
    if (isEditing) {
      composerRef.current?.focus();
      // Place cursor at end
      const el = composerRef.current;
      if (el) {
        el.setSelectionRange(el.value.length, el.value.length);
      }
    }
  }, [isEditing, composerRef]);

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

      // JS fallback for auto-resize if field-sizing: content not supported
      if (!CSS.supports('field-sizing', 'content')) {
        const ta = e.target;
        ta.style.height = 'auto';
        ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
      }

      // Reset inline height when cleared (e.g. after send)
      if (!value) {
        e.target.style.height = '';
      }

      // Typing indicator — instant start via ref, debounced stop
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
        // Value is empty — stop typing immediately (e.g. backspaced all text)
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
        if (!isSending && draft.trim()) {
          stopTyping();
          onSend();
        }
      }
    },
    [onSend, isSending, draft, stopTyping, isEditing, editingContent, editingMessageId, onSaveEdit, onCancelEdit],
  );

  const remaining = MAX_LENGTH - draft.length;
  const canSend = isEditing ? draft.trim().length > 0 : !isSending && draft.trim().length > 0;

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
      <div className="composer-input-wrap">
        <textarea
          ref={composerRef}
          value={draft}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={isEditing ? "" : "Напиши сообщение..."}
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
      <button type="submit" className={`send-button${isEditing ? " is-edit" : ""}`} disabled={!canSend}>
        {isEditing ? <Pencil size={16} /> : <SendHorizontal size={16} />}
      </button>
    </form>
  );
});
