import { memo, useCallback, useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useDrag } from "@use-gesture/react";
import { Pencil, Trash2, Pin, PinOff, RefreshCw, CornerDownRight, Reply, Copy, Folder, Tag, Tags, CheckCheck, Clock } from "lucide-react";
import { runDeleteExit } from "./core/deleteAnimation";

/** The action panel's exit, mirrored in `msg-panel-out` (messenger.css). */
const MENU_EXIT_MS = 160;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatTime, formatReadAt } from "./utils";
import { MessageContent } from "./MessageContent";
import { MessageContentBoundary } from "./ErrorBoundary";
import { messengerPlainPreview } from "./messengerRichTextUtils";
import { MessageActionOverlay } from "./MessageActionOverlay";
import type { MessageView } from "./types";
import { useLanguageStore } from "@/stores/languageStore";
import { hapticTick, hapticSuccess } from "@/lib/haptics";
import { ReactionChips } from "./ReactionChips";
import { ReactionBar } from "./ReactionBar";
import { getQuickReaction } from "./reactions";
import { isVoiceAttachment } from "./voice";

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
/** Telegram's `useMultiClick` window, and how far a tap may wander to still be one. */
const DOUBLE_TAP_WINDOW_MS = 300;
const DOUBLE_TAP_SLOP = 12;

interface Props {
  message: MessageView;
  isMine: boolean;
  isConsecutive: boolean;
  isPinned: boolean;
  isGroup?: boolean;
  /** Notes self-chat: show quick pin button + folder/tag chips. */
  notesControls?: boolean;
  /** Notes self-chat: open the organize dialog for this note. */
  onNotesOrganize?: (message: MessageView) => void;
  senderName?: string;
  onEdit: (id: string, content: string) => void;
  onDelete: (id: string) => void;
  onTogglePin: (id: string) => void;
  /** Toggles my reaction; absent in read-only surfaces (a shared card, a test). */
  onToggleReaction?: (messageId: string, emoji: string) => void;
  onRetry: (message: MessageView) => void;
  /** Sets the reply. `focus: false` arms it mid-swipe (banner only — the
   *  keyboard must NOT pop up under the moving finger); the default focuses
   *  the composer (menu / double-click / swipe lift). */
  onReply: (message: MessageView, opts?: { focus?: boolean }) => void;
  onCopy: (text: string) => void;
  quotedMessage?: MessageView | null;
  /**
   * Jump to the quoted message when the reader taps the quote (Telegram's
   * behaviour: the quote is a link, not decoration). Optional — a bubble without
   * it renders the quote as plain text.
   */
  onJumpToMessage?: (messageId: string) => void;
  peerReadAt?: string | null;
  peerDeliveredAt?: string | null;
  /** The reader's user id — reaction labels say "Вы" for their own chip. */
  viewerId?: string;
  /** An incoming voice note started playing (drops its unheard dot). */
  onVoiceListen?: () => void;
  /** Shows the "unheard" dot on a voice note (computed by the chat view). */
  voiceUnheard?: boolean;
}

export const MessageBubble = memo(function MessageBubble({
  message,
  isMine,
  isConsecutive,
  isPinned,
  isGroup,
  notesControls,
  onNotesOrganize,
  senderName,
  onEdit,
  onDelete,
  onTogglePin,
  onToggleReaction,
  onRetry,
  onReply,
  onCopy,
  quotedMessage,
  onJumpToMessage,
  peerReadAt,
  peerDeliveredAt,
  viewerId = "",
  onVoiceListen,
  voiceUnheard = false,
}: Props) {
  // Message bubbles are memoized; subscribe explicitly so their timestamps
  // refresh when the language changes even if message props stay identical.
  const language = useLanguageStore((state) => state.language);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartPos = useRef({ x: 0, y: 0 });
  const [isLongPressing, setIsLongPressing] = useState(false);
  // A failed send is a property of ONE message. Its retry/delete menu must not
  // open the full action panel or shift the bubble.
  const [failedMenuOpen, setFailedMenuOpen] = useState(false);
  // Deleting is the one irreversible action in the panel: it asks once, in a
  // compact dialog. Radix focuses «Отмена» (the least destructive action), so
  // Esc or Enter both cancel and only an explicit «Удалить» erases.
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
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
  // The panel is still mounted while it glides down after an action is chosen
  // (it leaves the way it arrived instead of blinking out).
  const [menuClosing, setMenuClosing] = useState(false);
  const menuCloseTimerRef = useRef<number | null>(null);
  const menuOpenRef = useRef(false);
  const actionPanelRef = useRef<HTMLDivElement | null>(null);
  // Whether the composer's editing surface was engaged when the panel opened
  // (editor focused, attach/emoji sheet open): an outside tap that dismisses
  // the panel must not yank that focus away — the soft keyboard would drop.
  const composerEngagedRef = useRef(false);
  const hasComposerEngaged = (chatEl: Element | null): boolean => {
    const active = document.activeElement;
    // The editor or any control inside the composer row (attach, emoji, send,
    // toolbar); the attach sheet and the emoji sheet render as body portals.
    const activeInComposer = Boolean(
      active
      && active !== document.body
      && (
        active.closest?.(".composer")
        || active.closest?.(".composer-attach-sheet")
        || active.closest?.('[data-testid="emoji-keyboard-panel"], [data-testid="emoji-picker-popover"]')
      ),
    );
    // ...or one of the swap sheets is actually open (its focus may already
    // have moved to <body> after the sheet replaced the keyboard).
    const sheetOpen = chatEl?.querySelector(".composer")?.classList.contains("is-sheet-open") ?? false;
    return activeInComposer || sheetOpen;
  };

  const finishMenuClose = useCallback(() => {
    if (menuCloseTimerRef.current !== null) {
      clearTimeout(menuCloseTimerRef.current);
      menuCloseTimerRef.current = null;
    }
    setMenuOpen(false);
    setMenuClosing(false);
  }, []);

  const openMenu = useCallback(() => {
    if (menuCloseTimerRef.current !== null) {
      clearTimeout(menuCloseTimerRef.current);
      menuCloseTimerRef.current = null;
    }
    setMenuClosing(false);
    composerEngagedRef.current = hasComposerEngaged(
      rowInnerRef.current?.closest(".chat-panel") ?? null,
    );
    menuOpenRef.current = true;
    setMenuOpen(true);
  }, []);

  /**
   * `animate` is for an action chosen IN the panel: the panel glides down the
   * way it came in and is unmounted when the exit ends. Outside taps, Escape
   * and scroll stay instant — the reader is already looking elsewhere.
   */
  const dismissMenu = useCallback((options?: { animate?: boolean }) => {
    if (!menuOpenRef.current) return;
    menuOpenRef.current = false;
    clearLongPress();
    if (!options?.animate || prefersReducedMotion()) {
      finishMenuClose();
      return;
    }
    setMenuClosing(true);
    menuCloseTimerRef.current = window.setTimeout(finishMenuClose, MENU_EXIT_MS);
  }, [clearLongPress, finishMenuClose]);

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
    const hostEl = rowEl?.closest(".message-row") ?? rowEl?.closest(".notes-pinned-item") ?? null;
    const scroller = rowEl?.closest(".message-scroll");
    chatEl?.classList.add("has-message-menu");
    hostEl?.classList.add("is-menu-host");

    const onPointerDown = (e: PointerEvent) => {
      if (actionPanelRef.current?.contains(e.target as Node)) return;
      // The reaction bar is real UI in the same floated group (a sibling of the
      // cloned bubble), and this listener runs in the capture phase — React's
      // own stopPropagation on the bar cannot keep the panel open. Presses on
      // the bar apply a reaction, they do not dismiss.
      if ((e.target as Element | null)?.closest?.(".msg-reaction-bar")) return;
      // If the composer's editing surface was engaged when the panel opened,
      // an outside tap dismisses the panel but must not drop that focus: the
      // tap's default action (blurring the active element on a non-focusable
      // target) would collapse the soft keyboard. Suppress it unless the tap
      // itself landed on an interactive control that wants the focus anyway.
      if (composerEngagedRef.current) {
        const target = e.target as Element | null;
        const interactive = target?.closest?.(
          "input, textarea, select, button, a[href], [contenteditable], [role='button'], label",
        );
        if (!interactive) e.preventDefault();
      }
      dismissMenu();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismissMenu();
    };
    const onScroll = () => {
      // Scrolling takes the message away from the panel (and the row can even
      // be sliced out of the mounted window) — close instead of leaving an
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
    // Telegram's clock while the outbox still owns the message.
    if (message.localStatus === "sending") {
      return <Clock size={11} className="status-clock" aria-label="Отправляется" />;
    }
    if (message.localStatus === "failed") {
      return <span className="status-failed" aria-label="Не отправлено">!</span>;
    }
    if (peerReadAt) return <span className="status-double-check is-read">✓✓</span>;
    if (peerDeliveredAt) return <span className="status-double-check">✓✓</span>;
    return <span className="status-check">✓</span>;
  };

  void language;

  const handleRowDoubleClick = useCallback(() => {
    if (!isTouchDevice) onReply(message);
  }, [isTouchDevice, onReply, message]);

  // ── Double-tap on touch: the quick reaction ──────────────────────────────
  // Native `dblclick` is not reliable on touch (and the bubble also owns a swipe
  // and a long press), so the taps are counted here: two taps inside Telegram's
  // 300ms window, neither of them a drag. The second one applies the reader's
  // quick reaction — Telegram's gesture model, where a swipe is the reply and a
  // double-tap is the reaction (desktop keeps double-click → reply).
  const lastTapRef = useRef<{ at: number; x: number; y: number } | null>(null);
  // The reaction a double-tap just applied, floated over the bubble while its
  // chip pops in (Telegram's double-tap feedback).
  const [floatingEmoji, setFloatingEmoji] = useState<string | null>(null);
  const floatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showFloatingEmoji = useCallback((emoji: string) => {
    if (floatTimerRef.current) clearTimeout(floatTimerRef.current);
    setFloatingEmoji(emoji);
    floatTimerRef.current = setTimeout(() => setFloatingEmoji(null), 700);
  }, []);
  const handleRowPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch") return;

    const now = Date.now();
    const previous = lastTapRef.current;
    const isTap = !previous
      || Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= DOUBLE_TAP_SLOP;

    if (previous && isTap && now - previous.at <= DOUBLE_TAP_WINDOW_MS) {
      lastTapRef.current = null;
      const emoji = getQuickReaction();
      hapticSuccess();
      onToggleReaction?.(message.id, emoji);
      showFloatingEmoji(emoji);
      return;
    }

    lastTapRef.current = { at: now, x: event.clientX, y: event.clientY };
  }, [message.id, onToggleReaction, showFloatingEmoji]);

  useEffect(() => () => {
    if (floatTimerRef.current) clearTimeout(floatTimerRef.current);
    if (menuCloseTimerRef.current !== null) clearTimeout(menuCloseTimerRef.current);
  }, []);

  useEffect(() => {
    if (!failedMenuOpen) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest(".message-failed")) return;
      setFailedMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [failedMenuOpen]);

  // The delete exit: the bubble crumbles and the row collapses while the store
  // holds it in the list (see `core/deleteAnimation`). The row is dropped by the
  // store when the exit ends, so there is nothing to clean up here.
  const deleting = Boolean(message.deleting);
  useEffect(() => {
    if (!deleting) return;
    const bubble = messageBubbleRef.current;
    const row = bubble?.closest<HTMLElement>(".message-item");
    if (!bubble || !row) return;
    runDeleteExit({ row, bubble, seed: message.id });
  }, [deleting, message.id]);

  // The long-press panel applies a reaction and closes: the chip under the
  // message is the result, so the panel has nothing left to say.
  const handlePickReaction = useCallback((emoji: string) => {
    dismissMenu();
    onToggleReaction?.(message.id, emoji);
    showFloatingEmoji(emoji);
  }, [dismissMenu, message.id, onToggleReaction, showFloatingEmoji]);

  const hasVisualAttachments = message.attachments?.some(
    (attachment) => attachment.type === "image" || attachment.type === "video",
  ) ?? false;
  // A single voice note is its own bubble shape: the player needs a stable
  // width, and the inline time/status must not try to overlap it.
  const voiceAttachment = !quotedMessage && message.attachments?.length === 1 ? message.attachments[0] : null;
  const isVoiceBubble = Boolean(voiceAttachment && isVoiceAttachment(voiceAttachment));

  const isMediaBubble = !quotedMessage
    && message.localStatus !== "failed"
    && hasVisualAttachments
    && message.attachments?.every((attachment) => attachment.type === "image" || attachment.type === "video");

  // A shared post (__SHARE__) renders a full-height card instead of text: line
  // measurement does not apply, and the card reserves its own meta space, so
  // skip the whole inline-meta path for it.
  const isShareMessage = message.type === "share" || (message.content?.startsWith("__SHARE__") ?? false);
  const canUseInlineMeta = !isVoiceBubble
    && !isMediaBubble
    && !isShareMessage
    && !message.attachments?.length
    && message.localStatus !== "failed";

  // Telegram Web's layout trick, with zero DOM reads: the timestamp/status pill
  // is rendered TWICE — once invisible, inline at the end of the text, where
  // the browser's own line breaking reserves exactly its width; and once
  // visible, absolutely positioned at the bubble's bottom-right. The text can
  // never run under the pill, and nothing is measured: no forced reflow
  // (`offsetWidth`), no Range.getClientRects, no per-bubble ResizeObserver and
  // no second layout pass after mount.
  const metaChildren = (
    <>
      {/* Telegram's media-unread dot: an incoming voice note nobody has
          listened to yet. It disappears on the first playback. */}
      {voiceUnheard && (
        <span
          className="message-unheard-dot"
          role="img"
          aria-label={isMine ? "Собеседник ещё не прослушал" : "Не прослушано"}
        />
      )}
      <span className="message-time">{formatTime(message.sent_at)}</span>
      {message.is_edited && <span className="edited-label">изм.</span>}
      {isMine && (
        <span className="message-status">{getStatusIcon()}</span>
      )}
    </>
  );

  // The floated action layer renders into the same chat surface the blur
  // lives on; both refs are guaranteed set by the time a user gesture opens
  // the menu (the bubble has already been committed to the DOM).
  const chatPanelEl = menuOpen ? (rowInnerRef.current?.closest(".chat-panel") as HTMLElement | null) ?? null : null;
  const hostBubbleEl = menuOpen ? messageBubbleRef.current : null;

  if (message.is_deleted) {
    // Deleted messages never reach the list (the store drops them and the
    // server only returns them to delta sync as contentless tombstones), so
    // there is nothing to render — a «Сообщение удалено» plate would be a
    // trace of something the reader asked to erase.
    return null;
  }

  return (
    <div
      className={`bubble-row${isMine ? " is-mine" : ""}${isConsecutive ? " is-consecutive" : ""}${deleting ? " is-deleting" : ""}`}
      onDoubleClick={handleRowDoubleClick}
      onPointerUp={handleRowPointerUp}
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
          className={`message-bubble${isMine ? " is-mine" : ""}${isVoiceBubble ? " is-voice-bubble" : ""}${isPinned ? " is-pinned" : ""}${message.localStatus === "failed" ? " is-stuck" : ""}${isMediaBubble ? " is-media-bubble" : ""}${isMediaBubble && (message.attachments?.length ?? 0) > 1 ? " is-media-album" : ""}${isMediaBubble && message.content.trim() ? " has-caption" : ""}${isShareMessage ? " is-share-bubble" : ""}${menuOpen ? " is-menu-hidden" : ""}`}
          data-message-id={message.id}
          onContextMenu={(e) => { e.preventDefault(); openMenu(); }}
        >
          {quotedMessage && (() => {
            const quoteContent = (
              <>
                <CornerDownRight size={12} />
                <span className="quoted-author">
                  {quotedMessage.sender_user_id === message.sender_user_id ? "Вы" : "Собеседник"}
                </span>
                <span className="quoted-text">
                  {quotedMessage.attachments?.some((attachment) => isVoiceAttachment(attachment))
                    ? "Голосовое сообщение"
                    : messengerPlainPreview(quotedMessage.content)}
                </span>
              </>
            );

            if (!onJumpToMessage) {
              return <div className="quoted-message">{quoteContent}</div>;
            }

            return (
              <button
                type="button"
                className="quoted-message is-clickable"
                onClick={() => onJumpToMessage(quotedMessage.id)}
                title="Перейти к сообщению"
                aria-label="Перейти к сообщению"
              >
                {quoteContent}
              </button>
            );
          })()}

          <MessageContentBoundary>
            <MessageContent
              content={message.content}
              payload={message.payload}
              attachments={message.attachments}
              hasQuotedMessage={Boolean(quotedMessage)}
              isMine={isMine}
              onVoiceListen={onVoiceListen}
              trailingMeta={canUseInlineMeta ? (
                <span className="message-meta-reserve" aria-hidden="true">
                  {metaChildren}
                </span>
              ) : undefined}
            />
          </MessageContentBoundary>

          {message.localStatus === "failed" && (
            <div className="message-failed">
              <button
                type="button"
                className="message-failed-dot"
                aria-label="Сообщение не отправлено"
                aria-haspopup="menu"
                aria-expanded={failedMenuOpen}
                onClick={(event) => {
                  event.stopPropagation();
                  setFailedMenuOpen((open) => !open);
                }}
              >
                !
              </button>
              {failedMenuOpen && (
                <div className="message-failed-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={(event) => {
                      event.stopPropagation();
                      setFailedMenuOpen(false);
                      onRetry(message);
                    }}
                  >
                    <RefreshCw size={13} />
                    Повторить
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="is-destructive"
                    onClick={(event) => {
                      event.stopPropagation();
                      setFailedMenuOpen(false);
                      onDelete(message.id);
                    }}
                  >
                    <Trash2 size={13} />
                    Удалить
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="message-meta">{metaChildren}</div>

          {floatingEmoji && (
            <span className="reaction-float" key={floatingEmoji} aria-hidden="true">
              {floatingEmoji}
            </span>
          )}

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

        {message.reactions && message.reactions.length > 0 && onToggleReaction && (
          <ReactionChips
            chips={message.reactions}
            viewerId={viewerId}
            onToggle={(emoji) => onToggleReaction(message.id, emoji)}
          />
        )}

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
        <MessageActionOverlay
          hostEl={hostBubbleEl}
          portalEl={chatPanelEl}
          isMine={isMine}
          closing={menuClosing}
          topSlot={onToggleReaction ? (
            <ReactionBar
              chips={message.reactions ?? []}
              viewerId={viewerId}
              onPick={handlePickReaction}
            />
          ) : undefined}
        >
          <div
            ref={actionPanelRef}
            className={`msg-action-panel${menuClosing ? " is-closing" : ""}`}
            role="menu"
            tabIndex={-1}
            onDoubleClick={(e) => e.stopPropagation()}
            // One tactile cue for every action in the panel (Telegram ticks on the
            // menu item, not on the menu itself).
            onClickCapture={() => hapticTick(8)}
          >
            <button type="button" role="menuitem" className="msg-action-item" onClick={() => { dismissMenu({ animate: true }); onReply(message); }}>
              <Reply size={15} /><span>Ответить</span>
            </button>
            <button type="button" role="menuitem" className="msg-action-item" onClick={() => { dismissMenu({ animate: true }); onCopy(message.content); }}>
              <Copy size={15} /><span>Копировать</span>
            </button>
            <div className="msg-action-sep" role="separator" />
            {isMine && !message.is_deleted && (
              <>
                <button type="button" role="menuitem" className="msg-action-item" onClick={() => { dismissMenu({ animate: true }); onEdit(message.id, message.content); }}>
                  <Pencil size={15} /><span>Редактировать</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="msg-action-item msg-action-item-danger"
                  onClick={() => {
                    // The panel leaves first, then the question appears — the
                    // confirm never pops on top of a menu that is still there.
                    dismissMenu({ animate: true });
                    window.setTimeout(() => setConfirmDeleteOpen(true), prefersReducedMotion() ? 0 : MENU_EXIT_MS);
                  }}
                >
                  <Trash2 size={15} /><span>Удалить</span>
                </button>
                <div className="msg-action-sep" role="separator" />
              </>
            )}
            <button type="button" role="menuitem" className="msg-action-item" onClick={() => { dismissMenu({ animate: true }); onTogglePin(message.id); }}>
              {isPinned ? <PinOff size={15} /> : <Pin size={15} />}
              <span>{isPinned ? "Открепить" : "Закрепить"}</span>
            </button>
            {notesControls && (
              <>
                <div className="msg-action-sep" role="separator" />
                <button type="button" role="menuitem" className="msg-action-item" onClick={() => { dismissMenu({ animate: true }); onNotesOrganize?.(message); }}>
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

      {/* One line, two buttons — nothing else. Focus starts on «Отмена»: the
          action that erases must be chosen on purpose. `aria-describedby` is
          cleared because the question is the whole content (Radix would
          otherwise warn about a missing description). */}
      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent
          aria-describedby={undefined}
          className="z-[150] w-auto min-w-[240px] max-w-[320px] gap-4 rounded-2xl p-5"
          // The message starts crumbling the moment «Удалить» is pressed, so the
          // dialog must not sit on top of it: the surface is gone in a blink
          // (1ms) and the veil is light, enough to focus without drowning the
          // animation behind it.
          overlayClassName="z-[149] bg-black/20"
          style={{ animationDuration: "1ms" }}
        >
          <AlertDialogTitle className="text-center text-[15px] font-semibold leading-5">
            Вы хотите удалить это сообщение?
          </AlertDialogTitle>
          <AlertDialogFooter className="flex-row justify-center gap-2 sm:space-x-0">
            <AlertDialogAction
              className="rounded-full bg-destructive px-4 text-destructive-foreground hover:bg-destructive/90"
              onClick={() => onDelete(message.id)}
            >
              Удалить
            </AlertDialogAction>
            <AlertDialogCancel className="mt-0 rounded-full">
              Отмена
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
});
