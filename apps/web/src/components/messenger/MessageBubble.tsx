import { memo, useCallback, useState, useRef, useEffect } from "react";
import { Pencil, Trash2, Pin, PinOff, RefreshCw, CornerDownRight } from "lucide-react";
import { createPortal } from "react-dom";
import { formatTime } from "./utils";
import { MessageContent } from "./MessageContent";
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

const LONG_PRESS_MS = 500;
const MOVE_CANCEL_PX = 12;

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
  const [menuOpen, setMenuOpen] = useState(false);
  const [showDots, setShowDots] = useState(false);
  const [floatPos, setFloatPos] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const isTouch = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    setFloatPos(null);
  }, []);

  // Close on outside tap
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: PointerEvent | MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [menuOpen, closeMenu]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  const handleAction = useCallback((fn: () => void) => {
    fn();
    closeMenu();
  }, [closeMenu]);

  // Pointer-based long-press (works on touch + mouse)
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    isTouch.current = e.pointerType === "touch";
    if (!isTouch.current) return; // mouse uses hover dots
    originRef.current = { x: e.clientX, y: e.clientY };

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const scrollEl = (e.currentTarget as HTMLElement).closest(".message-scroll");
      const scrollRect = scrollEl?.getBoundingClientRect();
      let x = e.clientX;
      let y = e.clientY;
      if (scrollRect) {
        x = Math.max(scrollRect.left + 8, Math.min(x, scrollRect.right - 8));
        y = Math.max(scrollRect.top + 8, Math.min(y, scrollRect.bottom - 8));
      }
      setFloatPos({ x, y });
      setMenuOpen(true);
      if (navigator.vibrate) navigator.vibrate(15);
    }, LONG_PRESS_MS);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const origin = originRef.current;
    if (!origin || !timerRef.current) return;
    const dx = Math.abs(e.clientX - origin.x);
    const dy = Math.abs(e.clientY - origin.y);
    if (dx > MOVE_CANCEL_PX || dy > MOVE_CANCEL_PX) {
      clearTimer();
    }
  }, [clearTimer]);

  const onPointerUp = useCallback(() => {
    clearTimer();
    originRef.current = null;
  }, [clearTimer]);

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
    <>
      <div
        className={`bubble-row${isMine ? " is-mine" : ""}${isConsecutive ? " is-consecutive" : ""}`}
        onMouseEnter={() => setShowDots(true)}
        onMouseLeave={() => { setShowDots(false); }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
      >
        {!isTouch.current && showDots && (
          <div className={`msg-actions-wrap ${isMine ? "is-mine" : "is-other"}`} ref={menuRef}>
            <button
              type="button"
              className="msg-actions-dots"
              onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
              aria-label="Действия"
            >
              <span className="msg-actions-dots-icon">···</span>
            </button>
            {menuOpen && (
              <div className="msg-actions-dropdown">
                {isMine && !message.is_deleted && (
                  <>
                    <button type="button" className="msg-actions-item" onClick={() => handleAction(() => onEdit(message.id, message.content))}>
                      <Pencil size={14} /><span>Редактировать</span>
                    </button>
                    <button type="button" className="msg-actions-item msg-actions-item-danger" onClick={() => handleAction(() => onDelete(message.id))}>
                      <Trash2 size={14} /><span>Удалить</span>
                    </button>
                  </>
                )}
                <button type="button" className="msg-actions-item" onClick={() => handleAction(() => onTogglePin(message.id))}>
                  {isPinned ? <PinOff size={14} /> : <Pin size={14} />}
                  <span>{isPinned ? "Открепить" : "Закрепить"}</span>
                </button>
              </div>
            )}
          </div>
        )}

        <div
          className={`message-bubble${isMine ? " is-mine" : ""}${isPinned ? " is-pinned" : ""}${message.localStatus === "failed" ? " is-stuck" : ""}`}
          data-message-id={message.id}
        >
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

          {message.localStatus === "failed" && (
            <div className="message-error-header">
              <RefreshCw size={11} />
              <span>Не отправлено</span>
              <button type="button" className="retry-button" onClick={() => onRetry(message)} title="Повторить">
                Повторить
              </button>
            </div>
          )}

          <MessageContent content={message.content} />

          <div className="message-meta">
            <span className="message-time">{formatTime(message.sent_at)}</span>
            {message.is_edited && <span className="edited-label">изм.</span>}
            {isMine && (
              <span className="message-status">{getStatusIcon()}</span>
            )}
          </div>
        </div>
      </div>

      {menuOpen && floatPos && createPortal(
        <div className="msg-actions-float-backdrop" onPointerDown={closeMenu}>
          <div
            ref={menuRef}
            className="msg-actions-float"
            style={{ left: floatPos.x, top: floatPos.y }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {isMine && !message.is_deleted && (
              <>
                <button type="button" className="msg-actions-item" onClick={() => handleAction(() => onEdit(message.id, message.content))}>
                  <Pencil size={14} /><span>Редактировать</span>
                </button>
                <button type="button" className="msg-actions-item msg-actions-item-danger" onClick={() => handleAction(() => onDelete(message.id))}>
                  <Trash2 size={14} /><span>Удалить</span>
                </button>
              </>
            )}
            <button type="button" className="msg-actions-item" onClick={() => handleAction(() => onTogglePin(message.id))}>
              {isPinned ? <PinOff size={14} /> : <Pin size={14} />}
              <span>{isPinned ? "Открепить" : "Закрепить"}</span>
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
});
