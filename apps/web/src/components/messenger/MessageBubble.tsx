import { memo, useCallback, useState, useRef, useEffect } from "react";
import { Pencil, Trash2, Pin, PinOff, RefreshCw, CornerDownRight } from "lucide-react";
import { formatTime } from "./utils";
import type { MessageView } from "./types";

interface Props {
  message: MessageView;
  isMine: boolean;
  isConsecutive: boolean;
  isPinned: boolean;
  onEdit: (id: string, content: string) => void;
  onDelete: (id: string) => void;
  onTogglePin: (id: string) => void;
  onRetry: (message: MessageView) => void;
  quotedMessage?: MessageView | null;
  peerReadAt?: string | null;
  peerDeliveredAt?: string | null;
}

export const MessageBubble = memo(function MessageBubble({
  message,
  isMine,
  isConsecutive,
  isPinned,
  onEdit,
  onDelete,
  onTogglePin,
  onRetry,
  quotedMessage,
  peerReadAt,
  peerDeliveredAt,
}: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(message.content);
  const [showActions, setShowActions] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) editInputRef.current?.focus();
  }, [isEditing]);

  const handleSaveEdit = useCallback(() => {
    const trimmed = editText.trim();
    if (trimmed && trimmed !== message.content) {
      onEdit(message.id, trimmed);
    }
    setIsEditing(false);
  }, [editText, message.content, message.id, onEdit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSaveEdit();
      }
      if (e.key === "Escape") {
        setIsEditing(false);
        setEditText(message.content);
      }
    },
    [handleSaveEdit, message.content],
  );

  const getStatusIcon = () => {
    if (message.localStatus === "sending") return <span className="status-dot status-pending" />;
    if (message.localStatus === "failed") return null;
    if (peerReadAt) return <span className="status-double-check is-read">✓✓</span>;
    if (peerDeliveredAt) return <span className="status-double-check">✓✓</span>;
    return <span className="status-check">✓</span>;
  };

  if (message.is_deleted) {
    return (
      <div className={`bubble-row${isMine ? " is-mine" : ""}${isConsecutive ? " is-consecutive" : ""}`}>
        <div className="message-bubble deleted-bubble">
          <em>Сообщение удалено</em>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`bubble-row${isMine ? " is-mine" : ""}${isConsecutive ? " is-consecutive" : ""}`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <div
        className={`message-bubble${isMine ? " is-mine" : ""}${isPinned ? " is-pinned" : ""}${message.localStatus === "failed" ? " is-stuck" : ""}`}
        data-message-id={message.id}
      >
        {/* Quoted message */}
        {quotedMessage && (
          <div className="quoted-message">
            <CornerDownRight size={12} />
            <span className="quoted-author">
              {quotedMessage.sender_user_id === message.sender_user_id ? "Вы" : "Собеседник"}
            </span>
            <span className="quoted-text">
              {quotedMessage.is_deleted ? "Сообщение удалено" : quotedMessage.content.slice(0, 100)}
            </span>
          </div>
        )}

        {/* Failed message header */}
        {message.localStatus === "failed" && (
          <div className="message-error-header">
            <RefreshCw size={11} />
            <span>Не отправлено</span>
            <button type="button" className="retry-button" onClick={() => onRetry(message)} title="Повторить">
              Повторить
            </button>
          </div>
        )}

        {/* Content */}
        {isEditing ? (
          <div className="edit-mode">
            <input
              ref={editInputRef}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleSaveEdit}
              className="edit-input"
              maxLength={4000}
            />
            <span className="edit-hint">Enter — сохранить, Esc — отмена</span>
          </div>
        ) : (
          <p>{message.content}</p>
        )}

        {/* Meta: time + status + actions */}
        <div className="message-meta">
          <span className="message-time">{formatTime(message.sent_at)}</span>
          {message.is_edited && <span className="edited-label">изм.</span>}
          {isMine && (
            <span className="message-status">{getStatusIcon()}</span>
          )}
        </div>

        {/* Hover actions */}
        {showActions && !isEditing && (
          <div className="message-actions">
            {isMine && !message.is_deleted && (
              <>
                <button type="button" onClick={() => { setIsEditing(true); setEditText(message.content); }} title="Редактировать">
                  <Pencil size={12} />
                </button>
                <button type="button" onClick={() => onDelete(message.id)} title="Удалить">
                  <Trash2 size={12} />
                </button>
              </>
            )}
            <button type="button" onClick={() => onTogglePin(message.id)} title={isPinned ? "Открепить" : "Закрепить"}>
              {isPinned ? <PinOff size={12} /> : <Pin size={12} />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
});
