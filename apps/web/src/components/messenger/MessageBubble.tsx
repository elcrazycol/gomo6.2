import { memo, useCallback, useEffect, useLayoutEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useDrag } from "@use-gesture/react";
import { Pencil, Trash2, Pin, PinOff, RefreshCw, CornerDownRight, Reply, Copy, Folder, Tag, Tags, CheckCheck } from "lucide-react";
import { formatTime, formatReadAt } from "./utils";
import { MessageContent } from "./MessageContent";
import { messengerPlainPreview } from "./messengerRichTextUtils";
import { MessageActionOverlay } from "./MessageActionOverlay";
import type { MessageView } from "./types";
import { useLanguageStore } from "@/stores/languageStore";
import { hapticTick, hapticSuccess } from "@/lib/haptics";

const LONG_PRESS_DELAY = 400;
/** Max horizontal pull of the swipe reply, in px (leftwards) — 40% shorter
 *  than the original 120px, so the reply arms before the bubble travels far. */
const SWIPE_MAX_X = -72;
/** The reply arms at 70% of the max pull: reply badge + haptic + the reply
 *  banner in the composer appear together and stay until the finger lifts. */
const SWIPE_ARM_X = Math.round(Math.abs(SWIPE_MAX_X) * 0.7);
/** Half the reply badge's width (32px from messenger.css) — the badge is
 *  centred on the message's right edge, so half of it overlaps the bubble. */
const REPLY_BADGE_HALF = 16;
/** Acceptance cone for the swipe START direction: the thumb may drift up to
 *  40° off the horizontal (tan 40° ≈ 0.84) and the gesture still counts as a
 *  reply swipe — a slightly diagonal start is the native path for a thumb.
 *  Beyond 40° the movement is treated as a scroll and handed to the browser. */
const SWIPE_MAX_ANGLE_TAN = Math.tan((40 * Math.PI) / 180);
/** The finger must travel at least this far before the scroll-vs-swipe
 *  direction is locked — small enough to beat the browser's own scroll slop,
 *  large enough to ignore idle finger wiggles. */
const SWIPE_LOCK_SLOP = 5;

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
  /** Sets the reply. `focus: false` arms it mid-swipe (banner only — the
   *  keyboard must NOT pop up under the moving finger); the default focuses
   *  the composer (menu / double-click / swipe lift). */
  onReply: (message: MessageView, opts?: { focus?: boolean }) => void;
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
  // Message bubbles are memoized; subscribe explicitly so their timestamps
  // refresh when the language changes even if message props stay identical.
  const language = useLanguageStore((state) => state.language);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartPos = useRef({ x: 0, y: 0 });
  const [isLongPressing, setIsLongPressing] = useState(false);
  const [isCompact, setIsCompact] = useState(false);
  const [hasMeasuredLines, setHasMeasuredLines] = useState(false);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const messageBubbleRef = useRef<HTMLDivElement | null>(null);
  const rowInnerRef = useRef<HTMLDivElement | null>(null);
  const [isSwiping, setIsSwiping] = useState(false);
  // The reply-badge "armed" state: appears (with haptic + composer banner) at
  // 70% of the pull and stays until the finger lifts — even if the user pulls
  // back. Ref mirror so the drag handler never races a stale closure.
  const [replyArmed, setReplyArmed] = useState(false);
  const replyArmedRef = useRef(false);
  const [replyBadgeStyle, setReplyBadgeStyle] = useState<React.CSSProperties | undefined>(undefined);
  // Scroll-vs-swipe direction lock, decided natively (see the effect below):
  // once the finger has entered the reply cone the touchmove is
  // preventDefault'ed, so the browser can never steal the gesture by latching
  // onto its vertical component — a diagonal start keeps working all the way.
  const swipeModeRef = useRef<"swipe" | null>(null);
  const swipeAnchorRef = useRef({ x: 0, y: 0 });

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    setIsLongPressing(false);
  }, []);

  // The press-and-hold / right-click actions panel, anchored BELOW the
  // message with a small gap. Local state + a ref mirror so the native touch
  // handlers (which fire outside React's synthetic pipeline) never race a
  // stale closure.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuOpenRef = useRef(false);
  const actionPanelRef = useRef<HTMLDivElement | null>(null);

  const openMenu = useCallback(() => {
    menuOpenRef.current = true;
    setMenuOpen(true);
  }, []);

  const dismissMenu = useCallback(() => {
    if (!menuOpenRef.current) return;
    menuOpenRef.current = false;
    clearLongPress();
    setMenuOpen(false);
  }, [clearLongPress]);

  const isTouchDevice = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;

  // Anchor the reply badge so it STRADDLES the message's right edge: exactly
  // half of the badge sits on the bubble, half sticks out to its right —
  // the same for every message. For own bubbles (flush with the row's right
  // edge) the protruding half lands in the list gutter, which is at least
  // as wide as the badge's half (gutter ≥16px), so nothing clips it.
  // The bubble is measured at arm time; the row's own translation affects
  // row and bubble equally, so the offset stays valid for the whole gesture.
  const computeReplyBadgeStyle = useCallback((): React.CSSProperties | undefined => {
    const bubbleEl = messageBubbleRef.current;
    const rowEl = rowInnerRef.current;
    if (!bubbleEl || !rowEl) return undefined;
    const rowRect = rowEl.getBoundingClientRect();
    const bubbleRect = bubbleEl.getBoundingClientRect();
    const bubbleRight = Math.round(bubbleRect.right - rowRect.left);
    return { left: bubbleRight - REPLY_BADGE_HALF };
  }, []);

  const bind = useDrag(
    ({ movement: [mx], last, active }) => {
      if (!isTouchDevice || menuOpenRef.current) return;

      if (active) {
        const offsetX = Math.max(SWIPE_MAX_X, Math.min(0, mx));
        setSwipeOffset(offsetX);
        setIsSwiping(true);
        // At 70% of the max pull the reply "arms": the badge pops in on the
        // right of the message, the haptic fires and the reply banner appears
        // in the composer — all at once. It stays armed (sticky) until the
        // finger lifts, so pulling back never loses the preview.
        if (!replyArmedRef.current && Math.abs(offsetX) >= SWIPE_ARM_X) {
          replyArmedRef.current = true;
          setReplyArmed(true);
          setReplyBadgeStyle(computeReplyBadgeStyle());
          hapticSuccess();
          // focus: false → banner only; the keyboard must not rise under the
          // moving finger (it is summoned on lift below).
          onReply(message, { focus: false });
        }
      } else if (last) {
        if (replyArmedRef.current) {
          // Finger up — the reply (already in the composer) is committed; now
          // focus the composer so the soft keyboard opens for the answer.
          onReply(message, { focus: true });
        }
        replyArmedRef.current = false;
        setReplyArmed(false);
        setReplyBadgeStyle(undefined);
        setSwipeOffset(0);
        setIsSwiping(false);
      } else {
        setSwipeOffset(0);
        setIsSwiping(false);
      }
    },
    {
      // NO axis lock: the gesture stays free — a thumb swipe that starts up
      // to 40° off the horizontal (up or down) is recognised from the very
      // first pixels. The bubble itself still moves only horizontally
      // (translateX above): the vertical part of the finger path is ignored
      // visually. touchAction: pan-y keeps vertical scrolling on the message
      // list intact; the direction lock lives in the native listener below.
      filterTaps: true,
      from: () => [0, 0],
      threshold: 5,
    },
  );

  // Native (non-passive) scroll-vs-swipe arbitration. With `touch-action:
  // pan-y` alone, the BROWSER decides the dominant direction at its own slop
  // (~8px), so a swipe that starts slightly diagonal can be stolen as a
  // scroll before the drag even begins. Here the element decides instead:
  // once the finger has moved past SWIPE_LOCK_SLOP px inside the ±40° reply
  // cone, EVERY subsequent touchmove is preventDefault'ed — the browser
  // cannot scroll, the pointer stream never cancels, and the reply swipe
  // plays out even if the thumb keeps drifting vertically mid-gesture.
  // Movements outside the cone are left untouched: they scroll the list.
  useEffect(() => {
    const el = rowInnerRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      swipeModeRef.current = null;
      const t = e.touches[0];
      if (t) swipeAnchorRef.current = { x: t.clientX, y: t.clientY };
    };

    const onTouchMove = (e: TouchEvent) => {
      if (swipeModeRef.current === "swipe") {
        e.preventDefault();
        return;
      }
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - swipeAnchorRef.current.x;
      const dy = t.clientY - swipeAnchorRef.current.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_LOCK_SLOP) return;
      // Inside the cone (|angle from horizontal| ≤ 40°) → commit to the swipe
      // and secure it; outside → stay passive and let the browser scroll.
      if (Math.abs(dy) <= Math.abs(dx) * SWIPE_MAX_ANGLE_TAN) {
        swipeModeRef.current = "swipe";
        e.preventDefault();
      }
    };

    const onTouchEnd = () => {
      swipeModeRef.current = null;
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    // While the panel is open the gesture budget belongs to it — no new
    // long-press timers from the selected message.
    if (isSwiping || menuOpenRef.current) return;
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
      hapticTick(10);
      openMenu();
    }, LONG_PRESS_DELAY);

    const cleanup = () => {
      scrollContainer?.removeEventListener("scroll", handleScrollOrCancel);
      el.removeEventListener("touchend", cleanup);
      el.removeEventListener("touchcancel", cleanup);
    };
    el.addEventListener("touchend", cleanup);
    el.addEventListener("touchcancel", cleanup);
  }, [clearLongPress, isSwiping, openMenu]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    if (Math.abs(t.clientX - touchStartPos.current.x) > 10 || Math.abs(t.clientY - touchStartPos.current.y) > 10) {
      clearLongPress();
    }
  }, [clearLongPress]);

  const handleTouchEnd = useCallback(() => clearLongPress(), [clearLongPress]);
  const handleTouchCancel = useCallback(() => clearLongPress(), [clearLongPress]);

  // While the panel is open: the .chat-panel::before scrim blurs and dims
  // every other surface, this row ("is-menu-host") and its panel paint above
  // it and stay crisp, touch scrolling is frozen, and the panel dismisses on
  // scroll / outside tap / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const rowEl = rowInnerRef.current;
    const chatEl = rowEl?.closest(".chat-panel");
    const hostEl = rowEl?.closest(".message-virtual-item") ?? rowEl?.closest(".notes-pinned-item") ?? null;
    const scroller = rowEl?.closest(".message-scroll");
    chatEl?.classList.add("has-message-menu");
    hostEl?.classList.add("is-menu-host");

    const onPointerDown = (e: PointerEvent) => {
      if (actionPanelRef.current?.contains(e.target as Node)) return;
      dismissMenu();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismissMenu();
    };
    const onScroll = () => {
      // Scrolling takes the message away from the panel (and the row can even
      // be virtualized out of the window) — close instead of leaving an
      // orphaned floating panel. Nothing scrolls programmatically while the
      // menu is open, so every scroll event here is genuinely user-driven.
      dismissMenu();
    };
    chatEl?.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    scroller?.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      chatEl?.classList.remove("has-message-menu");
      hostEl?.classList.remove("is-menu-host");
      chatEl?.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      scroller?.removeEventListener("scroll", onScroll);
    };
  }, [menuOpen, dismissMenu]);

  const getStatusIcon = () => {
    if (message.localStatus === "sending") return <span className="status-dot status-pending" />;
    if (message.localStatus === "failed") return null;
    if (peerReadAt) return <span className="status-double-check is-read">✓✓</span>;
    if (peerDeliveredAt) return <span className="status-double-check">✓✓</span>;
    return <span className="status-check">✓</span>;
  };

  void language;

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

  // The floated action layer renders into the same chat surface the blur
  // lives on; both refs are guaranteed set by the time a user gesture opens
  // the menu (the bubble has already been committed to the DOM).
  const chatPanelEl = menuOpen ? (rowInnerRef.current?.closest(".chat-panel") as HTMLElement | null) ?? null : null;
  const hostBubbleEl = menuOpen ? messageBubbleRef.current : null;

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
        ref={rowInnerRef}
        className={`bubble-row-inner${isLongPressing ? " is-long-press" : ""}${isSwiping ? " is-swiping" : ""}`}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        {...bind()}
        style={{ transform: `translateX(${swipeOffset}px)`, touchAction: "pan-y" }}
      >
        {/* Reply badge — straddles the message's right edge (half on the bubble,
            half sticking out) when the swipe reaches 70% of its travel
            (armed); pulses subtly and stays until the finger lifts. */}
        {replyArmed && (
          <div className="swipe-reply-indicator" style={replyBadgeStyle}>
            <Reply size={18} />
          </div>
        )}

        {/* The message bubble — right-click opens the same action panel. While
            the panel is open the bubble itself is hidden in place (the chat
            keeps its layout) and a pixel-identical copy floats above the blur
            in the overlay below. */}
        <div
          ref={messageBubbleRef}
          className={`message-bubble${isMine ? " is-mine" : ""}${isPinned ? " is-pinned" : ""}${message.localStatus === "failed" ? " is-stuck" : ""}${isNew ? " is-new" : ""}${isMediaBubble ? " is-media-bubble" : ""}${isMediaBubble && message.content.trim() ? " has-caption" : ""}${isCompact ? " is-compact" : ""}${hasMeasuredLines && !isCompact && !isMediaBubble ? " is-multiline" : ""}${menuOpen ? " is-menu-hidden" : ""}`}
          data-message-id={message.id}
          onContextMenu={(e) => { e.preventDefault(); openMenu(); }}
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

      {/* The floated layer: a pixel-identical copy of the message plus its
          action panel, rendered above the blurred chat. If the panel would
          not fit, the MessageActionOverlay glides the whole group up — the
          chat itself never scrolls, the other messages never move. */}
      {chatPanelEl && hostBubbleEl && createPortal(
        <MessageActionOverlay hostEl={hostBubbleEl} portalEl={chatPanelEl} isMine={isMine}>
          <div
            ref={actionPanelRef}
            className="msg-action-panel"
            role="menu"
            tabIndex={-1}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <button type="button" role="menuitem" className="msg-action-item" onClick={() => { dismissMenu(); onReply(message); }}>
              <Reply size={15} /><span>Ответить</span>
            </button>
            <button type="button" role="menuitem" className="msg-action-item" onClick={() => { dismissMenu(); onCopy(message.content); }}>
              <Copy size={15} /><span>Копировать</span>
            </button>
            <div className="msg-action-sep" role="separator" />
            {isMine && !message.is_deleted && (
              <>
                <button type="button" role="menuitem" className="msg-action-item" onClick={() => { dismissMenu(); onEdit(message.id, message.content); }}>
                  <Pencil size={15} /><span>Редактировать</span>
                </button>
                <button type="button" role="menuitem" className="msg-action-item msg-action-item-danger" onClick={() => { dismissMenu(); onDelete(message.id); }}>
                  <Trash2 size={15} /><span>Удалить</span>
                </button>
                <div className="msg-action-sep" role="separator" />
              </>
            )}
            <button type="button" role="menuitem" className="msg-action-item" onClick={() => { dismissMenu(); onTogglePin(message.id); }}>
              {isPinned ? <PinOff size={15} /> : <Pin size={15} />}
              <span>{isPinned ? "Открепить" : "Закрепить"}</span>
            </button>
            {notesControls && (
              <>
                <div className="msg-action-sep" role="separator" />
                <button type="button" role="menuitem" className="msg-action-item" onClick={() => { dismissMenu(); onNotesOrganize?.(message); }}>
                  <Tags size={15} /><span>Папка и теги…</span>
                </button>
              </>
            )}
            {/* When the interlocutor read this message — an informational row,
                separate from the actions, with the exact time. */}
            {isMine && peerReadAt && (
              <>
                <div className="msg-action-sep" role="separator" />
                <div className="msg-action-item msg-action-item-read" aria-disabled="true">
                  <CheckCheck size={15} /><span>Прочитано: {formatReadAt(peerReadAt)}</span>
                </div>
              </>
            )}
          </div>
        </MessageActionOverlay>,
        chatPanelEl,
      )}
    </div>
  );
});
