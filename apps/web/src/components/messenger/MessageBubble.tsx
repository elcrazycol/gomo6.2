import { memo, useCallback, useLayoutEffect, useState, useRef } from "react";
import { useDrag } from "@use-gesture/react";
import { Pencil, Trash2, Pin, PinOff, RefreshCw, CornerDownRight, Reply, Copy, Folder, Tag, Tags, CheckCheck } from "lucide-react";
import { formatTime, formatReadAt } from "./utils";
import { MessageContent } from "./MessageContent";
import { messengerPlainPreview } from "./messengerRichTextUtils";
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
  isNew?: boolean;
  /** Notes self-chat: show quick pin button + folder/tag chips. */
  notesControls?: boolean;
  /** Notes self-chat: open the organize dialog for this note. */
  onNotesOrganize?: (message: MessageView) => void;
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
  isNew,
  notesControls,
  onNotesOrganize,
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
  const [isCompact, setIsCompact] = useState(false);
  const [hasMeasuredLines, setHasMeasuredLines] = useState(false);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const messageBubbleRef = useRef<HTMLDivElement | null>(null);
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

  const handleRowDoubleClick = useCallback(() => {
    if (!isTouchDevice) onReply(message);
  }, [isTouchDevice, onReply, message]);

  const hasVisualAttachments = message.attachments?.some(
    (attachment) => attachment.type === "image" || attachment.type === "video",
  ) ?? false;
  const isMediaBubble = !quotedMessage
    && message.localStatus !== "failed"
    && hasVisualAttachments
    && message.attachments?.every((attachment) => attachment.type === "image" || attachment.type === "video");

  // Measure the actual rendered line count so every one-line message gets the
  // compact inline timestamp, regardless of its character length.
  const canUseInlineMeta = !isMediaBubble
    && !message.attachments?.length
    && message.localStatus !== "failed";

  useLayoutEffect(() => {
    const bubble = messageBubbleRef.current;
    if (!bubble || !canUseInlineMeta) {
      setIsCompact(false);
      setHasMeasuredLines(false);
      return;
    }

    // Plain-text messages render a `.message-content-text` <p>; emoji / rich-text
    // messages render a `.message-content-stack` <div>. Both carry the shared
    // `.message-content` class, so measuring that one class covers every
    // single-line case and keeps the time/status pill from overlapping the
    // last emoji (or link) the way it used to.
    const content = bubble.querySelector<HTMLElement>(".message-content");
    if (!content) {
      setIsCompact(false);
      setHasMeasuredLines(false);
      return;
    }

    const measureLines = () => {
      // Measure the text without the metadata/spacer affecting its wrapping.
      bubble.classList.add("is-measuring");
      void bubble.offsetWidth;
      const range = document.createRange();

      try {
        range.selectNodeContents(content);
        if (typeof range.getClientRects !== "function") {
          // JSDOM has no layout engine; keep the safe multiline layout there.
          setIsCompact((previous) => previous ? false : previous);
          setHasMeasuredLines((previous) => previous ? previous : true);
          return;
        }

        const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
        const lineTops = new Set(rects.map((rect) => Math.round(rect.top)));
        const nextIsCompact = rects.length > 0 && lineTops.size <= 1;
        setIsCompact((previous) => previous === nextIsCompact ? previous : nextIsCompact);
        setHasMeasuredLines((previous) => previous ? previous : true);
      } finally {
        range.detach?.();
        bubble.classList.remove("is-measuring");
      }
    };

    measureLines();
    const resizeObserver = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(measureLines)
      : null;
    resizeObserver?.observe(bubble);
    resizeObserver?.observe(content);

    return () => resizeObserver?.disconnect();
  }, [canUseInlineMeta, message.content, message.attachments?.length, message.is_edited, peerReadAt, peerDeliveredAt, isMine]);

  if (message.is_deleted) {
    return (
      <div
        className={`bubble-row${isMine ? " is-mine" : ""}${isConsecutive ? " is-consecutive" : ""}`}
        onDoubleClick={handleRowDoubleClick}
      >
        <div className="message-bubble deleted-bubble">
          <em>Сообщение удалено</em>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`bubble-row${isMine ? " is-mine" : ""}${isConsecutive ? " is-consecutive" : ""}`}
      onDoubleClick={handleRowDoubleClick}
    >
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

        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              ref={messageBubbleRef}
              className={`message-bubble${isMine ? " is-mine" : ""}${isPinned ? " is-pinned" : ""}${message.localStatus === "failed" ? " is-stuck" : ""}${isNew ? " is-new" : ""}${isMediaBubble ? " is-media-bubble" : ""}${isMediaBubble && message.content.trim() ? " has-caption" : ""}${isCompact ? " is-compact" : ""}${hasMeasuredLines && !isCompact && !isMediaBubble ? " is-multiline" : ""}`}
              data-message-id={message.id}
            >
              {quotedMessage && (
                <div className="quoted-message">
                  <CornerDownRight size={12} />
                  <span className="quoted-author">
                    {quotedMessage.sender_user_id === message.sender_user_id ? "Вы" : "Собеседник"}
                  </span>
                  <span className="quoted-text">
                    {quotedMessage.is_deleted ? "Сообщение удалено" : messengerPlainPreview(quotedMessage.content)}
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

              <MessageContent
                content={message.content}
                attachments={message.attachments}
                hasQuotedMessage={Boolean(quotedMessage)}
              />

              <div className="message-meta">
                <span className="message-time">{formatTime(message.sent_at)}</span>
                {message.is_edited && <span className="edited-label">изм.</span>}
                {isMine && (
                  <span className="message-status">{getStatusIcon()}</span>
                )}
              </div>

              {notesControls && (message.notesFolder || (message.notesTags?.length ?? 0) > 0) && (
                <div className="notes-bubble-chips">
                  {message.notesFolder && (
                    <button
                      type="button"
                      className="notes-chip notes-folder-chip"
                      onClick={() => onNotesOrganize?.(message)}
                      title="Папка — нажми, чтобы изменить"
                    >
                      <Folder size={10} />
                      <span>{message.notesFolder}</span>
                    </button>
                  )}
                  {message.notesTags?.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      className="notes-chip notes-tag-chip"
                      onClick={() => onNotesOrganize?.(message)}
                      title="Тег — нажми, чтобы изменить"
                    >
                      <Tag size={10} />
                      <span>{tag}</span>
                    </button>
                  ))}
                </div>
              )}

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
            {notesControls && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={() => onNotesOrganize?.(message)}>
                  <Tags size={14} /><span>Папка и теги…</span>
                </ContextMenuItem>
              </>
            )}
            {/* When the interlocutor read this message — an informational
                item, separate from the actions, with the exact time. */}
            {isMine && peerReadAt && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem
                  disabled
                  className="msg-context-item-read cursor-default data-[disabled]:opacity-100"
                >
                  <CheckCheck size={14} /><span>Прочитано: {formatReadAt(peerReadAt)}</span>
                </ContextMenuItem>
              </>
            )}
          </ContextMenuContent>
        </ContextMenu>

        {/* Notes quick pin — sibling of the bubble so media bubbles' overflow
            cannot clip it; notes are a self-chat, so the bubble always sits at
            the row's right edge and the button lands on its corner. */}
        {notesControls && (
          <button
            type="button"
            className={`notes-quick-pin${message.notesPinned ? " is-pinned" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin(message.id);
            }}
            aria-label={message.notesPinned ? "Открепить заметку" : "Закрепить заметку"}
            title={message.notesPinned ? "Открепить заметку" : "Закрепить заметку"}
          >
            {message.notesPinned ? <PinOff size={13} /> : <Pin size={13} />}
          </button>
        )}
      </div>
    </div>
  );
});
