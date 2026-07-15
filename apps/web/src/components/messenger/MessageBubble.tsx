import { memo, useCallback, useState, useRef } from "react";
import { useDrag } from "@use-gesture/react";
import { Pencil, Trash2, Pin, PinOff, RefreshCw, CornerDownRight, Reply, Copy, Lock } from "lucide-react";
import { formatTime } from "./utils";
import { MessageContent } from "./MessageContent";
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu";
import type { MessageView } from "./types";

const LONG_PRESS_DELAY = 400;
const SWIPE_THRESHOLD = 80;

interface Props {
  message: MessageView;
  isMine: boolean;
  isConsecutive: boolean;
  isPinned: boolean;
  isGroup?: boolean;
  senderName?: string;
  onEdit: (id: string, content: string) => void;
  onDelete: (id: string) => void;
  onTogglePin: (id: string) => void;
  onRetry: (message: MessageView) => void;
  onReply: (message: MessageView) => void;
  onCopy: (text: string) => void;
  quotedMessage?: MessageView | null;
  peerReadAt?: string | null;
  peerDeliveredAt?: string | null;
}

export const MessageBubble = memo(function MessageBubble({
  message,
  isMine,
  isConsecutive,
  isPinned,
  isGroup,
  senderName,
  onEdit,
  onDelete,
  onTogglePin,
  onRetry,
  onReply,
  onCopy,
  quotedMessage,
  peerReadAt,
  peerDeliveredAt,
}: Props) {
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartPos = useRef({ x: 0, y: 0 });
  const [isLongPressing, setIsLongPressing] = useState(false);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    setIsLongPressing(false);
  }, []);

  const isTouchDevice = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;

  const bind = useDrag(
    ({ movement: [mx], last, active }) => {
      if (!isTouchDevice) return;

      if (active) {
        const offsetX = Math.max(-120, Math.min(0, mx));
        setSwipeOffset(offsetX);
        setIsSwiping(true);
      } else if (last) {
        const finalOffset = Math.max(-120, Math.min(0, mx));
        if (Math.abs(finalOffset) > SWIPE_THRESHOLD) {
          if (navigator.vibrate) navigator.vibrate(5);
          onReply(message);
        }
        setSwipeOffset(0);
        setIsSwiping(false);
      } else {
        setSwipeOffset(0);
        setIsSwiping(false);
      }
    },
    {
      axis: "x",
      filterTaps: true,
      from: () => [0, 0],
      threshold: 5,
    },
  );

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (isSwiping) return;
    const el = e.currentTarget;
    const touch = e.touches[0];
    touchStartPos.current = { x: touch.clientX, y: touch.clientY };

    const scrollContainer = el.closest(".message-scroll");

    const handleScrollOrCancel = () => {
      clearLongPress();
      scrollContainer?.removeEventListener("scroll", handleScrollOrCancel);
    };

    scrollContainer?.addEventListener("scroll", handleScrollOrCancel, { passive: true });

    longPressTimer.current = setTimeout(() => {
      scrollContainer?.removeEventListener("scroll", handleScrollOrCancel);
      setIsLongPressing(true);
      if (navigator.vibrate) navigator.vibrate(10);
      el.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true, cancelable: true,
        clientX: touch.clientX, clientY: touch.clientY, view: window,
      }));
    }, LONG_PRESS_DELAY);

    const cleanup = () => {
      scrollContainer?.removeEventListener("scroll", handleScrollOrCancel);
      el.removeEventListener("touchend", cleanup);
      el.removeEventListener("touchcancel", cleanup);
    };
    el.addEventListener("touchend", cleanup);
    el.addEventListener("touchcancel", cleanup);
  }, [clearLongPress, isSwiping]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    if (Math.abs(t.clientX - touchStartPos.current.x) > 10 || Math.abs(t.clientY - touchStartPos.current.y) > 10) {
      clearLongPress();
    }
  }, [clearLongPress]);

  const handleTouchEnd = useCallback(() => clearLongPress(), [clearLongPress]);
  const handleTouchCancel = useCallback(() => clearLongPress(), [clearLongPress]);

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
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={`bubble-row-inner${isLongPressing ? " is-long-press" : ""}${isSwiping ? " is-swiping" : ""}`}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchCancel}
            {...bind()}
            style={{ transform: `translateX(${swipeOffset}px)`, touchAction: "pan-y" }}
          >
            {/* Swipe reply indicator */}
            {swipeOffset < -20 && (
              <div className="swipe-reply-indicator" style={{ opacity: Math.min(1, Math.abs(swipeOffset) / SWIPE_THRESHOLD) }}>
                <Reply size={18} />
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

              <MessageContent content={message.content} attachments={message.attachments} />

              <div className="message-meta">
                {message.ciphertexts && message.ciphertexts.length > 0 && (
                  <span title="E2E зашифровано"><Lock className="w-2.5 h-2.5 text-green-500/70 mr-0.5" /></span>
                )}
                <span className="message-time">{formatTime(message.sent_at)}</span>
                {message.is_edited && <span className="edited-label">изм.</span>}
                {isMine && (
                  <span className="message-status">{getStatusIcon()}</span>
                )}
              </div>
            </div>
          </div>
        </ContextMenuTrigger>

        <ContextMenuContent className="msg-context-menu">
          <ContextMenuItem onClick={() => onReply(message)}>
            <Reply size={14} /><span>Ответить</span>
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onCopy(message.content)}>
            <Copy size={14} /><span>Копировать</span>
          </ContextMenuItem>
          <ContextMenuSeparator />
          {isMine && !message.is_deleted && (
            <>
              <ContextMenuItem onClick={() => onEdit(message.id, message.content)}>
                <Pencil size={14} /><span>Редактировать</span>
              </ContextMenuItem>
              <ContextMenuItem className="msg-context-item-danger" onClick={() => onDelete(message.id)}>
                <Trash2 size={14} /><span>Удалить</span>
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          <ContextMenuItem onClick={() => onTogglePin(message.id)}>
            {isPinned ? <PinOff size={14} /> : <Pin size={14} />}
            <span>{isPinned ? "Открепить" : "Закрепить"}</span>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
});
