// RichComposer — the shared "profile-grade" composer.
//
// Extracted from CreateWallPostInline so the wall, g-sub posts and global
// topics all edit with the same machine: media blocks living inside the
// document (not a separate attachment list), slash commands, link cards,
// spoilers, YouTube embeds, drag & drop, an in-place image editor and a
// fullscreen mode. The wall composer keeps its own persistence; g-sub and
// topic composers pass `onPublish` and let this component own the editing UX.
//
// The parent owns everything the composer cannot know: the header destination,
// any extra fields (a title input, topic tags) rendered through `children`, and
// the actual submit side effect via `onPublish`.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { animate, motion, useDragControls, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { EASE_OUT_EXPO, springFor } from "@/lib/motion";
import { computeKeyboardMetrics, isEditableElement, isStaleUpwardJump, resolveSheetBottomAction } from "@/lib/mobileKeyboard";
import { apiClient } from "@/integrations/api/client";
import { Popover, PopoverPanel } from "@/components/ui/popover";
import { InkBar, InkButton, glassGhostButtonClass } from "@/components/ui/ink-bar";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { toast } from "sonner";
import { EmojiPicker } from "@/components/EmojiPicker";
import { GomoRichEditor, Toolbar, type GomoRichEditorHandle } from "@/components/GomoRichEditor";
import { PublishButton } from "@/components/PublishButton";
import { getPublishButtonStyle } from "@/lib/publishButtonStyle";
import { Lightbox, type LightboxItem } from "@/components/Lightbox";
import { Expand, Loader2, Minimize2, Paperclip, Smile, X } from "lucide-react";

import { uploadAttachments, uploadEditedDataUrl } from "@/utils/mediaUpload";
import { storageUrl } from "@/utils/storage";
import {
  EMPTY_EDITOR_STATE,
  prosemirrorToPlainText,
  stripEdgeEmptyParagraphs,
} from "@/utils/contentConverter";

import { mediaExtensions } from "@/components/editor/media/mediaExtensions";
import { createSlashCommand } from "@/components/editor/slash/slashCommands";
import { insertLinkCard } from "@/components/editor/link/linkCommands";
import { insertSpoilerBlock } from "@/components/editor/spoiler/spoilerCommands";
import { insertYouTubeEmbed } from "@/components/editor/youtube/youtubeCommands";
import { parseYouTubeId } from "@/components/editor/youtube/youtubeSchema";
import { isCardableUrl, linkHost } from "@/components/editor/link/linkCardSchema";
import { MediaAttachmentsProvider } from "@/components/editor/media/mediaViewContext";
import { MediaEditorProvider } from "@/components/editor/media/mediaEditorContext";
import {
  countMediaNodes as countEditorMediaNodes,
  insertMediaGroupWithPlaceholders,
  insertUploadPlaceholders,
  replaceUploadPlaceholder,
  updateUploadPlaceholder,
} from "@/components/editor/media/mediaCommands";
import {
  MAX_MEDIA_NODES,
  collectMediaAttachmentIds,
  countMediaNodes,
  ensureAttachmentIds,
  getDocCover,
  hasUploadPlaceholders,
  makeUploadId,
  mediaBlockAttrsFromAttachment,
  naturalWidthPercent,
  stripUploadPlaceholders,
  withDocCover,
  type DocCover,
  type MediaAttachment,
  type MediaKind,
} from "@/components/editor/media/mediaSchema";

/** The sheet is flicked away rather than slid: closing from the X or Escape
    should feel like the same downward swipe that dismisses it. */
const DISMISS_VELOCITY = 1000;

/**
 * Keyboard ride for the composer sheet.
 *
 * Why a dedicated writer instead of the global `--kb-inset`: the sheet is a
 * fixed overlay with its own scroller and a locked page behind it, so the
 * only thing it needs is `bottom` == the live keyboard height.
 *
 * Two things used to make the open glide visibly jump on iOS, both fixed here:
 *
 * 1. Stepwise events. visualViewport resize events are choppy (a handful of
 *    steps for the whole slide) while `vv.height` itself is LIVE. Every real
 *    event therefore arms a short per-frame follow loop that re-reads the
 *    live geometry each frame — the sheet glides at 60fps instead of
 *    stepping. Upward follow moves are gated exactly like events (see below):
 *    a fresh fall with no user intent behind it is the mid-hide freeze, and
 *    tracking its stale "open" geometry would snap the bar back up.
 * 2. Safari toolbar drift. iOS hides its bottom toolbar as the keyboard rises,
 *    growing `window.innerHeight` mid-animation — measuring against the live
 *    value injects that growth as a one-frame jump. The inset is measured
 *    against a baseline frozen while the keyboard is closed (refreshed on
 *    every settled closed event), so it stays a pure function of the visual
 *    viewport.
 *
 * Close is the one asymmetric case: iOS freezes visualViewport while the
 * keyboard slides away, so the last live value would stick until the
 * keyboard is gone and then teleport. The descent therefore starts on blur
 * (100ms delay, so quick refocuses and dialog inputs never start it) and
 * eases down through the same follower. Every viewport event meanwhile is
 * arbitrated by focus (see resolveSheetBottomAction): a stale WebKit "open"
 * transient with focus elsewhere is ignored instead of snapping the bar back
 * up mid-glide.
 * A fast poll while an editable owns focus covers the hide-button case —
 * the keyboard gone, focus retained, viewport frozen: no focusout ever
 * fires, so without the poll the bar floats until the next tick.
 *
 * Open has its own mirror race: the poll (or the first sparse event) can read
 * the geometry BEFORE the keyboard commits — inset still ~0, focus already in
 * the sheet — and that "closed" verdict starts the descent while the keyboard
 * is rising. The next event then snaps the bar back up: the visible DOWN-UP
 * jump. An opening grace covers it: for a short window after genuine user
 * intent (focus/tap in the sheet) a "closed" read with focus held is treated
 * as the animation's leading edge and tracked, never descended. The grace
 * only applies while the keyboard was never seen open since the intent
 * (`seenOpen`), so a genuine hide (hide button, gesture) still glides at once.
 *
 * Why easing instead of direct writes: visualViewport commits arrive in 2–3
 * coarse steps, and writing them straight through IS the teleport ("no
 * animation"). The follower eases the display toward each gated target every
 * frame (fast up so it stays glued to the rising keys, deliberately lazier
 * down so it settles under the departing keyboard instead of dropping
 * through it), so even sparse commits read as one continuous glide.
 */
function useSheetKeyboardInset(panelRef: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const panel = panelRef.current;
    if (typeof window === "undefined" || !panel) return;
    const isTouch =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches;
    const vv = window.visualViewport;
    if (!isTouch || !vv) return;

    // Layout height while the keyboard is CLOSED — the ruler the inset is
    // measured against (see the header comment). Refreshed whenever the
    // geometry settles closed, so URL-bar show/hide drift never accumulates.
    let baseHeight = window.innerHeight;
    let closing = false;
    let blurTimer: ReturnType<typeof setTimeout> | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    // Per-frame eased follower while the geometry is moving (see ensureLoop).
    // Decisions only ever set `targetBottom`; the loop eases
    // `displayedBottom` toward it and is the ONLY writer of the sheet offset.
    // followUntil keeps the loop alive across sparse event streams; the loop
    // also runs until the display converges on the target.
    let followRaf: number | null = null;
    let followUntil = 0;
    let targetBottom = 0;
    let displayedBottom = 0;
    let lastFrameAt = 0;
    // Exponential-smoothing time constants: the rise tracks the keyboard
    // tightly, the descent is deliberately lazier (settles under the
    // departing keys instead of dropping through them).
    const TAU_UP_MS = 70;
    const TAU_DOWN_MS = 140;
    // iOS can hide the keyboard while focus stays in the field (notably for
    // contenteditable: the keyboard's own hide button keeps focus, unlike
    // native inputs which blur). No focusout fires; the frozen properties
    // unfreeze the moment the keyboard is gone. A fast poll while an editable
    // owns focus bounds the stuck window to one tick + the glide.
    let focusPollInterval: ReturnType<typeof setInterval> | null = null;

    // Stale-transient wiring (see isStaleUpwardJump): pure timestamps, no
    // timers. lastEventAt detects the freeze gap, lastDownAt the fresh fall,
    // lastIntentAt genuine user intent (tap / focus move after the fall).
    let lastEventAt = 0;
    let lastDownAt = 0;
    let lastIntentAt = 0;
    // Opening-grace wiring (see the header comment): a "closed" read right
    // after intent is the animation's leading edge, not a dismissal.
    // openingUntil bounds the grace window; seenOpen arms it only until the
    // keyboard is actually observed, so real closes glide immediately.
    const OPENING_GRACE_MS = 1200;
    let openingUntil = 0;
    let seenOpen = false;
    // Layout engines that resize with the keyboard (Android Chrome/Firefox
    // with interactive-widget=resizes-content) move the fixed sheet above
    // the keys NATIVELY — the vv delta against the frozen baseline still
    // reads "open", but writing it as `bottom` double-lifts the sheet over
    // the whole view. Detected live: the layout viewport itself shrank well
    // beyond URL-bar noise (same 60px noise floor as the global keyboard
    // module). While set, the hook writes nothing and the native position
    // stands — on such engines the composer does exactly nothing fancy.
    const LAYOUT_SHRINK_PX = 60;
    let resizingEngine = false;
    const markIntent = () => {
      const now = Date.now();
      lastIntentAt = now;
      openingUntil = now + OPENING_GRACE_MS;
      // A re-tap resummons the keyboard from zero: until it is observed the
      // grace treats "closed" as the leading edge again. Harmless while open
      // (readings are open → track → seenOpen flips back on the next read).
      seenOpen = false;
    };

    // The ONLY writer of the sheet offset. Decisions set the target; the loop
    // eases the display (see ensureLoop).
    const writeBottom = (px: number) => {
      const next = `${Math.max(0, Math.round(px))}px`;
      if (panel.style.bottom !== next) panel.style.bottom = next;
      // The keyboard covers the home indicator: keep the safe-area pad only
      // while actually lifted, otherwise it reads as a gap floating the bar
      // above the keyboard (see .kb-sheet-bar in index.css).
      if (px > 2) panel.style.setProperty("--kb-safe", "0px");
      else panel.style.removeProperty("--kb-safe");
    };
    // Focus still holds the keyboard open (an editable anywhere — the sheet
    // editor, the title input, or a dialog input portaled outside the panel).
    const keyboardHeldByFocus = () => {
      const active = document.activeElement;
      return active instanceof HTMLElement && isEditableElement(active);
    };
    const focusedInSheet = () => {
      const active = document.activeElement;
      return (
        active instanceof HTMLElement &&
        panel.contains(active) &&
        isEditableElement(active)
      );
    };
    // NOTE: the ruler is the frozen baseline, never the live innerHeight.
    const readLive = () =>
      computeKeyboardMetrics({
        innerHeight: baseHeight,
        visualViewportHeight: vv.height,
        visualViewportOffsetTop: vv.offsetTop,
        isTouch: true,
      });
    // The single motion loop: ease the display toward the gated target every
    // frame — fast up so it stays glued to the rising keys, deliberately
    // lazier down so it settles under the departing keyboard instead of
    // dropping through it. Converges and stops by itself; `ms` keeps it
    // alive across sparse event streams.
    const ensureLoop = (ms = 700) => {
      followUntil = Math.max(followUntil, Date.now() + ms);
      if (lastFrameAt === 0) lastFrameAt = Date.now();
      if (followRaf !== null) return;
      const step = () => {
        followRaf = null;
        const now = Date.now();
        const dt = Math.min(64, Math.max(1, now - lastFrameAt));
        lastFrameAt = now;
        const tau = targetBottom > displayedBottom ? TAU_UP_MS : TAU_DOWN_MS;
        displayedBottom += (targetBottom - displayedBottom) * (1 - Math.exp(-dt / tau));
        if (Math.abs(targetBottom - displayedBottom) < 0.5) displayedBottom = targetBottom;
        writeBottom(displayedBottom);
        if (displayedBottom !== targetBottom || now < followUntil) {
          followRaf = requestAnimationFrame(step);
        } else {
          lastFrameAt = 0;
        }
      };
      followRaf = requestAnimationFrame(step);
    };
    const cancelClosing = () => {
      closing = false;
      if (blurTimer) {
        clearTimeout(blurTimer);
        blurTimer = null;
      }
      if (settleTimer) {
        clearTimeout(settleTimer);
        settleTimer = null;
      }
    };
    const beginClosing = () => {
      if (closing && targetBottom === 0) return;
      closing = true;
      // The descent goes through the same eased follower (target 0): no CSS
      // transition, so event steps and the loop never fight each other.
      targetBottom = 0;
      ensureLoop(500);
      if (settleTimer) clearTimeout(settleTimer);
      // Safety net: never stay "closing" forever (stalled rAF, old WebKit).
      settleTimer = setTimeout(cancelClosing, 800);
    };
    // One live read (event or poll tick), arbitrated by focus (see
    // resolveSheetBottomAction). Decisions only ever set `targetBottom` — the
    // eased loop (see ensureLoop) moves the display. Any resync toward zero
    // goes through the ease — an instant snap after a frozen-viewport window
    // is exactly the visible jump (the keyboard is long gone, but the bar
    // teleporting reads as a glitch; gliding reads as settling).
    const applyLive = () => {
      const now = Date.now();
      // Resizing engine (Android): the layout viewport shrank with the
      // keyboard, so the fixed sheet already clears it natively — any
      // `bottom` we write lands on top and covers the view. Hold zero.
      const layoutShrink = baseHeight - window.innerHeight;
      if (layoutShrink >= LAYOUT_SHRINK_PX) resizingEngine = true;
      if (resizingEngine) {
        if (layoutShrink < LAYOUT_SHRINK_PX) {
          // Settled back (keyboard gone, layout restored): re-baseline so
          // URL-bar drift never accumulates, and drop the flag so a tall
          // toolbar flick can never stick the bypass on forever.
          resizingEngine = false;
          baseHeight = window.innerHeight;
        }
        cancelClosing();
        if (targetBottom !== 0 || displayedBottom > 0.5) {
          targetBottom = 0;
          ensureLoop();
        }
        return;
      }
      // Only real viewport/window events reset the silence clock: the loop
      // only eases toward the gated target and never re-reads geometry, so
      // it cannot disguise the freeze gap that identifies the stale transient.
      const msSinceLastEvent = lastEventAt === 0 ? 0 : now - lastEventAt;
      const m = readLive();
      const focused = focusedInSheet();
      const action = resolveSheetBottomAction({
        viewportOpen: m.isOpen,
        closing,
        focusedInSheet: focused,
      });
      // Opening grace (see the header comment): a "closed" read right after
      // intent with focus held is the animation's leading edge — track the
      // live value instead of descending and snapping back up. Only while
      // the keyboard was never observed since the intent, so a real hide
      // (hide button, gesture) still glides at once.
      if (
        !seenOpen &&
        focused &&
        now < openingUntil &&
        (action === "begin-close" || action === "settle-zero")
      ) {
        cancelClosing();
        targetBottom = m.keyboardInset;
        if (m.keyboardInset > 8) seenOpen = true;
        ensureLoop();
        return;
      }
      if (action === "track") {
        // Mid-hide stale transient: the bar was falling live, iOS went
        // silent, and this read says "open" again with no user intent behind
        // it — honouring it snaps the bar back up (down, UP, down-glide).
        // Dense genuine movement (including keyboard-type switches) and any
        // tap/focus intent pass straight through.
        if (
          isStaleUpwardJump({
            appliedBottom: displayedBottom,
            liveInset: m.keyboardInset,
            msSinceLastEvent,
            msSinceFallStart: lastDownAt === 0 ? Number.POSITIVE_INFINITY : now - lastDownAt,
            intentAfterFallStart: lastIntentAt >= lastDownAt && lastIntentAt > 0,
          })
        ) {
          return;
        }
        cancelClosing();
        if (m.keyboardInset > 8) seenOpen = true;
        if (m.keyboardInset < displayedBottom - 8) lastDownAt = now;
        targetBottom = m.keyboardInset;
        ensureLoop();
      } else if (action === "begin-close") {
        beginClosing();
      } else if (action === "settle-zero") {
        // Settled closed — refresh the baseline (URL-bar drift).
        baseHeight = window.innerHeight;
        if (targetBottom !== 0 || displayedBottom > 0.5) beginClosing();
      }
      // "ignore": the eased descent owns `bottom`.
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !panel.contains(target)) return;
      if (!isEditableElement(target)) return;
      // Genuine user intent: drop any in-flight descent. The loop below eases
      // the rise from the first frame and the poll catches a silent iOS
      // open/close that fires no viewport event at all.
      // Max, never a plain assignment: on a resizing engine (Android) focus
      // can land while the layout is already shrunk by the open keyboard —
      // freezing that as the ruler corrupts every later reading.
      baseHeight = Math.max(baseHeight, window.innerHeight);
      markIntent();
      cancelClosing();
      ensureLoop();
      if (focusPollInterval === null) {
        focusPollInterval = setInterval(() => {
          if (!focusedInSheet()) return;
          const before = targetBottom;
          applyLive();
          // A silent hide (keyboard button, focus retained) moves the target —
          // keep easing toward it instead of teleporting on the next event.
          if (targetBottom !== before) ensureLoop();
        }, 150);
      }
    };
    const onFocusOut = () => {
      if (blurTimer) clearTimeout(blurTimer);
      blurTimer = setTimeout(() => {
        blurTimer = null;
        // Focus moved to another editable (dialog input, title ↔ editor):
        // the keyboard stays up, so no descent.
        if (!keyboardHeldByFocus()) beginClosing();
      }, 100);
    };
    // A tap is user intent even when it moves no focus (re-tapping the
    // already-focused field to resummon the keyboard): a genuine re-open
    // must never be mistaken for the free-floating stale transient.
    const onTouchStart = (event: TouchEvent) => {
      if (event.target instanceof HTMLElement && panel.contains(event.target)) {
        markIntent();
        ensureLoop();
      }
    };

    const onRealEvent = () => {
      lastEventAt = Date.now();
      applyLive();
      ensureLoop();
    };
    const onOrientationChange = () => {
      // A rotation rebuilds every height: re-baseline and re-read.
      baseHeight = window.innerHeight;
      lastEventAt = Date.now();
      applyLive();
      ensureLoop();
    };

    vv.addEventListener("resize", onRealEvent);
    vv.addEventListener("scroll", onRealEvent);
    window.addEventListener("resize", onRealEvent);
    window.addEventListener("orientationchange", onOrientationChange);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    lastEventAt = Date.now();
    applyLive();

    return () => {
      vv.removeEventListener("resize", onRealEvent);
      vv.removeEventListener("scroll", onRealEvent);
      window.removeEventListener("resize", onRealEvent);
      window.removeEventListener("orientationchange", onOrientationChange);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("touchstart", onTouchStart);
      if (followRaf !== null) {
        cancelAnimationFrame(followRaf);
        followRaf = null;
      }
      if (focusPollInterval !== null) {
        clearInterval(focusPollInterval);
        focusPollInterval = null;
      }
      cancelClosing();
      panel.style.bottom = "";
      panel.style.removeProperty("--kb-safe");
    };
  }, [panelRef]);
}

export interface RichComposerPayload {
  /** Final ProseMirror document (upload placeholders stripped, cover attached). */
  json: unknown;
  /** Plain-text projection of `json`. */
  text: string;
  /** Attachments actually referenced by the document. */
  attachments: MediaAttachment[];
  /** Post cover chosen from the document images, if any. */
  cover: DocCover | null;
}

interface RichComposerProps {
  /** Storage bucket uploads go to (e.g. "wall", "content"). */
  bucket: string;
  /** Center header text (destination, editing state…). */
  headerLabel: React.ReactNode;
  /** Small muted text next to the label (e.g. "черновик"). */
  headerMeta?: React.ReactNode;
  /** Extra header content, right of the fullscreen button. */
  headerRight?: React.ReactNode;
  /** Extra content between the header and the editor (title input, tags…). */
  children?: React.ReactNode;
  placeholder?: string;
  /** Plain-text cap; omit for no limit. */
  maxLength?: number;
  /** Max media nodes in the document; defaults to MAX_MEDIA_NODES. */
  maxMedia?: number;
  /** localStorage key — when set the composer autosaves/restores a draft. */
  draftKey?: string;
  initialContentJson?: unknown;
  initialLegacyContent?: string;
  initialAttachments?: MediaAttachment[];
  /** Reported on every editor change (let the parent autosave title etc.). */
  onChange?: (value: { json: unknown; text: string }) => void;
  /** Extra toolbar buttons rendered before the emoji picker. */
  toolbarLeading?: React.ReactNode;
  publishLabel?: string;
  /** External disable (e.g. the parent's title is empty). */
  publishDisabled?: boolean;
  /** Suspend the Escape-to-close handler (e.g. while a picker dialog is open). */
  escapeDisabled?: boolean;
  /** Reset the editor to empty after a successful publish (wall behaviour). */
  resetOnPublish?: boolean;
  onPublish: (payload: RichComposerPayload) => void | Promise<void>;
  onClose: () => void;
  /** Root test id. */
  testId?: string;
}

interface ComposerDraft {
  contentJson: unknown;
  attachments?: MediaAttachment[] | null;
}

const readDraft = (key: string): ComposerDraft | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as ComposerDraft;
  } catch {
    // corrupt draft — ignore
  }
  return null;
};

const previewKind = (file: File): MediaKind => {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "file";
};

export const RichComposer = ({
  bucket,
  headerLabel,
  headerMeta,
  headerRight,
  children,
  placeholder = "Что нового? Пишите, двигайте фото и видео прямо в тексте…",
  maxLength,
  maxMedia = MAX_MEDIA_NODES,
  draftKey,
  initialContentJson,
  initialLegacyContent,
  initialAttachments,
  onChange,
  toolbarLeading,
  publishLabel = "Опубликовать",
  publishDisabled = false,
  escapeDisabled = false,
  resetOnPublish = false,
  onPublish,
  onClose,
  testId,
}: RichComposerProps) => {
  const editorRef = useRef<GomoRichEditorHandle>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composerRootRef = useRef<HTMLDivElement | null>(null);

  // Draft is read once per mount (create mode only).
  const initialDraft = useMemo(() => (draftKey ? readDraft(draftKey) : null), [draftKey]);

  const [contentJson, setContentJson] = useState<unknown>(
    () => initialDraft?.contentJson ?? initialContentJson ?? EMPTY_EDITOR_STATE,
  );
  const [cover, setCoverState] = useState<DocCover | null>(() =>
    getDocCover(initialDraft?.contentJson ?? initialContentJson),
  );
  const [attachments, setAttachments] = useState<MediaAttachment[]>(() =>
    initialDraft ? ensureAttachmentIds(initialDraft.attachments ?? []) : initialAttachments ?? [],
  );
  const [restoredDraft, setRestoredDraft] = useState(Boolean(initialDraft));
  const [editorResetKey, setEditorResetKey] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [closing, setClosing] = useState(false);
  const reduceMotion = useReducedMotion();
  // The sheet comes up from the bottom on phones; on desktop it is a centred
  // dialog that grows in. Decided once — resizing while composing is rare.
  const [isDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.("(min-width: 768px)").matches,
  );
  // Decided once, same as isDesktop above.
  const [isTouchDevice] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches,
  );
  // Live tiptap instance for the formatting toolbar, captured after commit
  // (rAF poll: tiptap creates the instance in its own effect). The toolbar is
  // rendered OUTSIDE the editor's scroll container (a fixed row above it): a
  // `sticky` bar inside the keyboard-resized scroller re-lays on every
  // visualViewport frame on iOS and visibly jumps. Out here it is painted
  // once and never moves — same pattern as MessageComposer's toolbar.
  const [toolbarEditor, setToolbarEditor] = useState<ReturnType<GomoRichEditorHandle["getEditor"]>>(null);
  useLayoutEffect(() => {
    let raf = 0;
    let attempts = 0;
    const poll = () => {
      attempts += 1;
      const instance = editorRef.current?.getEditor() ?? null;
      if (instance || attempts > 120) {
        if (instance) setToolbarEditor((prev) => (prev === instance ? prev : instance));
        return;
      }
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, []);
  const dragControls = useDragControls();
  const closeFinishedRef = useRef(false);
  const releaseVelocityRef = useRef(0);
  // Keyboard ride: the sheet's `bottom` tracks the live visual-viewport
  // keyboard height (exact, no easing on open); see useSheetKeyboardInset.
  useSheetKeyboardInset(composerRootRef);
  // The sheet's actual position: entrance, drag and exit all move this one
  // value, so a flick keeps its velocity into the closing spring.
  const sheetY = useMotionValue(
    isDesktop ? 28 : typeof window !== "undefined" ? window.innerHeight : 900,
  );

  useEffect(() => {
    if (reduceMotion) {
      sheetY.set(0);
      return;
    }
    // Touch: glide up with an ease instead of the composer spring. The spring
    // overshoots (~10% of a full-height travel) and the keyboard usually rises
    // in the same moment (autofocused title) — the overshoot then reads as the
    // sheet jumping on open. The ease lands exactly and never fights the
    // keyboard ride (see useSheetKeyboardInset).
    if (isTouchDevice) {
      const controls = animate(sheetY, 0, { duration: 0.28, ease: EASE_OUT_EXPO });
      return () => controls.stop();
    }
    const controls = animate(sheetY, 0, springFor("composer", reduceMotion));
    return () => controls.stop();
  }, [isTouchDevice, reduceMotion, sheetY]);

  // The dim and the solid pad dissolve as the sheet travels down, so pulling
  // the sheet by its top handle peeks at the content underneath instead of a
  // blackout. Keyboard ride moves `bottom`, not `sheetY`, so typing never
  // touches the dim. Same travel as the exit target below.
  const dismissDistance = typeof window !== "undefined" ? window.innerHeight + 32 : 932;
  const dimOpacity = useTransform(sheetY, [0, dismissDistance], [0.45, 0]);
  const padOpacity = useTransform(sheetY, [0, dismissDistance * 0.6], [1, 0]);

  // Lock the page scroll while the sheet is up: the feed/board/wall
  // underneath must not move. Same recipe as CreateWallPost — html+body
  // overflow (html must be locked too: its overflow-x:hidden stops the
  // body lock from propagating), overscroll off, and outright prevention
  // of touchmoves that start outside the sheet (iOS ignores body locks).
  // Portaled overlays (Radix dialogs/popovers, emoji panels) keep working
  // through the exemptions below.
  //
  // Two iOS holes this additionally plugs (both observed on contenteditable
  // focus, where a native input stays put):
  //  • Safari force-scrolls the WINDOW for caret reveal straight through the
  //    overflow lock above; once displaced, chained drags from the editor
  //    move the background freely ("провал" под композер). The pin below
  //    resets the displacement synchronously inside the scroll event, so it
  //    never lands. Element-level scrollers (editor, dialogs) are
  //    unaffected, and the editor div natively keeps the caret visible.
  //  • Drags starting inside the editor chain to the document when the doc
  //    is short (nothing to scroll) — stopped by `overscroll-contain` on
  //    the editor scroller itself (see below).
  useEffect(() => {
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevBodyOverflow = document.body.style.overflow;
    const prevOverscroll = document.documentElement.style.overscrollBehavior;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.documentElement.style.overscrollBehavior = "none";

    const pinWindowScroll = () => {
      if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);
    };
    window.addEventListener("scroll", pinWindowScroll, { passive: true, capture: true });

    const root = composerRootRef.current;
    const onTouchMove = (e: TouchEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (root?.contains(target)) return;
      if (
        target.closest(
          '[data-radix-popper-content-wrapper], [role="dialog"], [data-testid="emoji-keyboard-panel"], [data-testid="emoji-picker-popover"]',
        )
      ) {
        return;
      }
      e.preventDefault();
    };
    document.addEventListener("touchmove", onTouchMove, { passive: false, capture: true });

    return () => {
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overscrollBehavior = prevOverscroll;
      window.removeEventListener("scroll", pinWindowScroll, { capture: true } as EventListenerOptions);
      document.removeEventListener("touchmove", onTouchMove, { capture: true } as EventListenerOptions);
    };
  }, []);

  const finishClose = useCallback(() => {
    if (closeFinishedRef.current) return;
    closeFinishedRef.current = true;
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!closing) return;
    if (reduceMotion) {
      finishClose();
      return;
    }
    const target = isDesktop
      ? 16
      : typeof window !== "undefined"
        ? window.innerHeight + 32
        : 900;
    const controls = animate(sheetY, target, {
      ...springFor("composerClose", reduceMotion),
      // A flick carries its speed into the exit instead of restarting from rest.
      velocity: releaseVelocityRef.current,
      onComplete: finishClose,
    });
    return () => controls.stop();
  }, [closing, finishClose, isDesktop, reduceMotion, sheetY]);
  const [isDragging, setIsDragging] = useState(false);
  const [lightbox, setLightbox] = useState<{ items: LightboxItem[]; index: number; startInEditMode: boolean } | null>(null);
  const [publishButtonStyle] = useState(getPublishButtonStyle);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLoading, setLinkLoading] = useState(false);
  const [spoilerDialogOpen, setSpoilerDialogOpen] = useState(false);
  const [spoilerLabelDraft, setSpoilerLabelDraft] = useState("");
  const [youtubeDialogOpen, setYoutubeDialogOpen] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const minSizeRef = useRef<{ w: number; h: number } | null>(null);

  const editorExtensions = useMemo(
    () => [
      ...mediaExtensions,
      createSlashCommand({
        requestMedia: () => fileInputRef.current?.click(),
        requestLinkCard: () => setLinkDialogOpen(true),
        requestSpoiler: () => setSpoilerDialogOpen(true),
        requestYouTube: () => setYoutubeDialogOpen(true),
      }),
    ],
    [],
  );

  const imageAttachments = useMemo(() => attachments.filter((att) => att.type === "image"), [attachments]);
  const imageGallery: LightboxItem[] = useMemo(
    () =>
      imageAttachments.map((att) => ({
        url: storageUrl(bucket, att.url) || att.url,
        type: "image" as const,
        name: att.name || "Фото",
        mime: att.mime || "image/*",
        meta: att.meta ? JSON.stringify(att.meta) : null,
      })),
    [imageAttachments, bucket],
  );

  const uploading = hasUploadPlaceholders(contentJson);
  const mediaCount = useMemo(() => countMediaNodes(contentJson), [contentJson]);
  const referencedIds = useMemo(() => new Set(collectMediaAttachmentIds(contentJson)), [contentJson]);

  useEffect(() => {
    if (cover && !referencedIds.has(cover.id)) setCoverState(null);
  }, [cover, referencedIds]);

  const handleSetCover = useCallback(
    (attachmentId: string | null, placements: DocCover["placements"]) => {
      if (!attachmentId || placements.length === 0) setCoverState(null);
      else setCoverState({ id: attachmentId, placements });
    },
    [],
  );

  const plainText = useMemo(
    () => prosemirrorToPlainText(contentJson, "").replace(/\u200b/g, "").trim(),
    [contentJson],
  );
  const canSubmit = (plainText.length > 0 || referencedIds.size > 0) && !uploading && !isSubmitting && !publishDisabled;

  const close = useCallback((velocity = 0) => {
    if (closing) return;
    releaseVelocityRef.current = velocity;
    setClosing(true);
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
    if (reduceMotion) {
      finishClose();
      return;
    }
    // The exit spring reports back through onComplete; the timer is only a
    // fallback for a missed frame.
    window.setTimeout(finishClose, 1200);
  }, [closing, finishClose, reduceMotion]);

  // Escape closes (unless a lightbox or another dialog owns Escape then).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !lightbox && !escapeDisabled) {
        event.preventDefault();
        close(DISMISS_VELOCITY);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, lightbox, escapeDisabled]);

  // Autosave draft (debounced). Placeholders are stripped — their blob previews
  // cannot survive a reload.
  useEffect(() => {
    if (!draftKey) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      const stored: ComposerDraft = {
        contentJson: withDocCover(stripEdgeEmptyParagraphs(stripUploadPlaceholders(contentJson)), cover),
        attachments: attachments.filter((att) => referencedIds.has(att.id)),
      };
      try {
        window.localStorage.setItem(draftKey, JSON.stringify(stored));
      } catch {
        // storage full — publishing still works
      }
    }, 350);
    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
  }, [draftKey, contentJson, attachments, referencedIds, cover]);

  const handleEditorChange = useCallback(
    (json: unknown, text: string) => {
      setContentJson(json);
      onChange?.({ json, text });
    },
    [onChange],
  );

  // ── Uploads ───────────────────────────────────────────────────────────────
  const runUploads = useCallback(
    async (
      editor: NonNullable<ReturnType<GomoRichEditorHandle["getEditor"]>>,
      pending: Array<{ uploadId: string; file: File }>,
    ) => {
      for (const item of pending) {
        if (editor.isDestroyed) return;
        try {
          const [uploaded] = await uploadAttachments([item.file], bucket, (progress) => {
            if (editor.isDestroyed) return;
            updateUploadPlaceholder(editor, item.uploadId, {
              percent: progress.percent,
              phase: progress.phase ?? "upload",
            });
          });
          if (editor.isDestroyed) return;
          const attachment = ensureAttachmentIds([uploaded])[0];
          const containerWidth = editor.view.dom.clientWidth || 640;
          const attrs = mediaBlockAttrsFromAttachment(attachment, {
            width: naturalWidthPercent(attachment, containerWidth),
          });
          if (replaceUploadPlaceholder(editor, item.uploadId, attrs)) {
            setAttachments((prev) => [...prev, attachment]);
          }
        } catch (error) {
          console.error("Composer media upload failed", error);
          if (!editor.isDestroyed) {
            updateUploadPlaceholder(editor, item.uploadId, { error: "Не удалось загрузить", phase: "done" });
          }
          toast.error("Не удалось загрузить файл");
        }
      }
    },
    [bucket],
  );

  const uploadFiles = useCallback(
    (files: File[], at?: number | null) => {
      const editor = editorRef.current?.getEditor();
      if (!editor || files.length === 0) return;
      const freeSlots = maxMedia - countEditorMediaNodes(editor);
      if (freeSlots <= 0) {
        toast.error(`Максимум ${maxMedia} медиа в записи`);
        return;
      }
      const chosen = files.slice(0, freeSlots);
      if (chosen.length < files.length) {
        toast.error(`Максимум ${maxMedia} медиа в записи`);
      }
      const pending = chosen.map((file) => ({ uploadId: makeUploadId(), kind: previewKind(file), name: file.name }));
      if (pending.length > 1) {
        insertMediaGroupWithPlaceholders(editor, pending, at ?? undefined);
      } else {
        insertUploadPlaceholders(editor, pending, at ?? undefined);
      }
      void runUploads(
        editor,
        pending.map((item, index) => ({ uploadId: item.uploadId, file: chosen[index] })),
      );
    },
    [runUploads, maxMedia],
  );

  const handleFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    uploadFiles(files, null);
  };

  const handleRootDrop = (event: React.DragEvent) => {
    setIsDragging(false);
    if (event.defaultPrevented) return;
    const files = Array.from(event.dataTransfer?.files || []);
    if (files.length === 0) return;
    event.preventDefault();
    uploadFiles(files, null);
  };

  const replaceAttachment = useCallback(
    async (attachmentId: string, file: File): Promise<MediaAttachment | null> => {
      try {
        const [uploaded] = await uploadAttachments([file], bucket);
        const attachment = ensureAttachmentIds([uploaded])[0];
        setAttachments((prev) => prev.map((att) => (att.id === attachmentId ? attachment : att)));
        return attachment;
      } catch (error) {
        console.error("Composer media replace failed", error);
        toast.error("Не удалось заменить файл");
        return null;
      }
    },
    [bucket],
  );

  const openImageEditor = useCallback(
    (attachmentId: string) => {
      const index = imageAttachments.findIndex((att) => att.id === attachmentId);
      if (index < 0) return;
      setLightbox({ items: imageGallery, index, startInEditMode: true });
    },
    [imageAttachments, imageGallery],
  );

  const handleEditImage = async (index: number, dataUrl: string) => {
    const target = imageAttachments[index];
    if (!target) return;
    try {
      const uploaded = await uploadEditedDataUrl(dataUrl, bucket);
      setAttachments((prev) => prev.map((att) => (att.id === target.id ? { ...uploaded, id: target.id } : att)));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить фото");
    }
  };

  // The "/" toolbar key types a slash at the caret, so the tiptap suggestion
  // opens the same command menu as a typed "/" (media, gallery, divider,
  // link card, spoiler, YouTube). Same machine, no parallel UI.
  const insertSlashCommand = useCallback(() => {
    editorRef.current?.insertText("/");
  }, []);

  // ── Link card ─────────────────────────────────────────────────────────────
  const handleCreateLinkCard = async () => {
    const editor = editorRef.current?.getEditor();
    const raw = linkUrl.trim();
    if (!editor || !raw) return;
    if (!isCardableUrl(raw)) {
      toast.error("Вставьте ссылку, начинающуюся с http(s)://");
      return;
    }
    setLinkLoading(true);
    try {
      type LinkPreviewData = { url?: string; title?: string; description?: string; image?: string; site_name?: string };
      const response = await apiClient.rawRequest<{ data?: LinkPreviewData }>("/api/v1/link-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: raw }),
      });
      const payload = Array.isArray(response) ? response[0] : response;
      const data = payload?.data ?? {};
      insertLinkCard(editor, {
        url: data.url || raw,
        title: data.title || raw,
        description: data.description || "",
        image: data.image || null,
        siteName: data.site_name || linkHost(raw),
      });
      toast.success("Карточка добавлена");
    } catch (error) {
      console.error("link preview failed", error);
      insertLinkCard(editor, { url: raw, title: raw, description: "", image: null, siteName: linkHost(raw) });
      toast.message("Предпросмотр недоступен — добавили обычную ссылку");
    } finally {
      setLinkLoading(false);
      setLinkDialogOpen(false);
      setLinkUrl("");
    }
  };

  const handleCreateSpoiler = () => {
    const editor = editorRef.current?.getEditor();
    if (!editor) return;
    insertSpoilerBlock(editor, spoilerLabelDraft);
    setSpoilerDialogOpen(false);
    setSpoilerLabelDraft("");
  };

  const handleCreateYouTube = () => {
    const editor = editorRef.current?.getEditor();
    if (!editor) return;
    const videoId = parseYouTubeId(youtubeUrl);
    if (!videoId) {
      toast.error("Не удалось распознать ссылку на YouTube");
      return;
    }
    insertYouTubeEmbed(editor, videoId);
    setYoutubeDialogOpen(false);
    setYoutubeUrl("");
  };

  // ── Composer resize (desktop, bottom-right corner) ───────────────────────
  const handleResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const panel = composerRootRef.current;
    if (!panel) return;
    event.preventDefault();
    event.stopPropagation();

    const rect = panel.getBoundingClientRect();
    if (!minSizeRef.current) minSizeRef.current = { w: rect.width, h: rect.height };
    const min = minSizeRef.current;
    const startW = rect.width;
    const startH = rect.height;
    const startX = event.clientX;
    const startY = event.clientY;

    const onMove = (moveEvent: PointerEvent) => {
      const maxW = Math.max(min.w, window.innerWidth - 32);
      const maxH = Math.max(min.h, window.innerHeight - 32);
      const w = Math.min(maxW, Math.max(min.w, startW + (moveEvent.clientX - startX)));
      const h = Math.min(maxH, Math.max(min.h, startH + (moveEvent.clientY - startY)));
      setSize({ w, h });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "nwse-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  // ── Publish ───────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    const editor = editorRef.current?.getEditor();
    if (!editor || isSubmitting) return;
    if (uploading) {
      toast.error("Дождитесь загрузки файлов");
      return;
    }

    const json = withDocCover(stripEdgeEmptyParagraphs(stripUploadPlaceholders(editor.getJSON())), cover);
    const text = prosemirrorToPlainText(json, "").replace(/\u200b/g, "").trim();
    const usedIds = new Set(collectMediaAttachmentIds(json));
    const usedAttachments = attachments.filter((att) => usedIds.has(att.id));
    if (!text && usedAttachments.length === 0) {
      toast.error("Добавьте текст или медиа");
      return;
    }

    setIsSubmitting(true);
    try {
      await onPublish({ json, text, attachments: usedAttachments, cover });
      if (resetOnPublish) {
        setContentJson(EMPTY_EDITOR_STATE);
        setAttachments([]);
        setEditorResetKey((prev) => prev + 1);
        setRestoredDraft(false);
      }
      if (draftKey) {
        try {
          window.localStorage.removeItem(draftKey);
        } catch {
          // ignore
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const atLimit = mediaCount >= maxMedia;

  return createPortal(
    <div
      className={`fixed inset-0 z-[60] ${
        fullscreen ? "" : "md:flex md:items-center md:justify-center"
      }`}
    >
      {/* The dimming is its own layer: the panel must never fade with it.
          Opacity follows the sheet position — pulling the sheet down
          dissolves the dim so the content underneath shows through. */}
      <motion.div
        aria-hidden="true"
        className="absolute inset-0 bg-black/45 md:backdrop-blur-lg"
        style={{ opacity: dimOpacity }}
      />
      {/* Solid pad under the sheet (mobile only): the panel must always sit
          on a filled background — while the keyboard lifts it, while the
          close-glide settles, during the entrance overshoot and the exit.
          Without this the page shows through under a lifted sheet (via the
          45% dim) and every late resync reads as a transparency glitch.
          It sits above the dim and behind the panel, so the visible area is
          pure bg-background — seamless with the opaque panel. Like the dim,
          it dissolves as the sheet is pulled down, so dragging peeks at the
          real content instead of a solid fill. */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-background md:hidden"
        style={{ opacity: padOpacity }}
      />
      <motion.div
        ref={composerRootRef}
        role="dialog"
        aria-modal="true"
        data-testid={testId}
        data-kb-sheet
        initial={reduceMotion ? false : isDesktop ? { scale: 0.9 } : { scale: 1 }}
        animate={
          reduceMotion
            ? undefined
            : closing
              ? { scale: isDesktop ? 0.96 : 1 }
              : { scale: 1 }
        }
        transition={springFor("snappy", reduceMotion)}
        drag={isDesktop ? false : "y"}
        dragControls={dragControls}
        dragListener={false}
        dragConstraints={isDesktop ? undefined : { top: 0, bottom: 0 }}
        dragElastic={{ top: 0.22, bottom: 0.7 }}
        dragMomentum={false}
        onDragEnd={(_, info) => {
          if (isDesktop) return;
          // Distance never closes the sheet: it can be pulled as low as the
          // gesture allows, stopped there and released, and it will always
          // spring back up. Only a decisive downward flick commits.
          if (info.velocity.y > 650) {
            close(info.velocity.y);
            return;
          }
          if (reduceMotion) {
            sheetY.set(0);
            return;
          }
          animate(sheetY, 0, {
            ...springFor("composer", reduceMotion),
            velocity: info.velocity.y,
          });
        }}
        style={{
          y: sheetY,
          originX: 1,
          originY: 1,
          willChange: "transform",
          ...(size && !fullscreen
            ? { width: `${size.w}px`, height: `${size.h}px`, maxWidth: "none", maxHeight: "none" }
            : {}),
        }}
        onDragOver={(event) => {
          if (Array.from(event.dataTransfer?.types || []).includes("Files")) {
            event.preventDefault();
            setIsDragging(true);
          }
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleRootDrop}
        className={`group/panel fixed inset-x-0 bottom-0 top-[max(1.4rem,env(safe-area-inset-top,0px))] flex w-full flex-col overflow-hidden rounded-t-2xl border-t border-border/60 bg-background md:relative md:top-0 md:border md:border-border/60 md:bg-card/85 md:shadow-2xl md:backdrop-blur-2xl ${
          fullscreen
            ? "md:h-[100dvh] md:max-h-none md:max-w-none md:rounded-none"
            : "md:h-auto md:max-h-[85vh] md:max-w-2xl md:rounded-2xl"
        }`}
      >
        {isDragging && (
          <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center border-2 border-dashed border-primary/60 bg-background/60 backdrop-blur-[2px]">
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-primary/25 bg-card px-8 py-6 shadow-xl">
              <Paperclip className="h-6 w-6 text-primary" />
              <span className="text-sm font-semibold text-foreground">Отпустите, чтобы прикрепить</span>
              <span className="text-xs text-muted-foreground">Медиа появится прямо в записи</span>
            </div>
          </div>
        )}

        {/* Header — doubles as the sheet's drag handle on phones. The grip is
            decorative; the whole header (except its buttons) starts the drag. */}
        <div
          className="relative flex shrink-0 touch-none items-center gap-1 border-b border-border/60 px-2 py-2 pt-3 md:touch-auto md:pt-2"
          onPointerDown={(event) => {
            if (isDesktop) return;
            if ((event.target as HTMLElement).closest("button")) return;
            dragControls.start(event);
          }}
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-1 h-1 w-10 -translate-x-1/2 rounded-full bg-foreground/20 md:hidden"
          />
          {/* Left balancer (mobile only): mirrors the close button, which
              sits on the right on phones, so the label stays centered.
              On desktop the button is back on the left. */}
          <span aria-hidden="true" className="order-1 h-9 w-9 shrink-0 md:hidden" />
          <button
            type="button"
            onClick={() => close(DISMISS_VELOCITY)}
            aria-label="Закрыть"
            title="Закрыть"
            className={`${glassGhostButtonClass} active:scale-95 order-3 md:order-1`}
          >
            <X className="h-5 w-5" />
          </button>
          <div className="order-2 min-w-0 flex-1 truncate px-1 text-center">
            <span className="text-sm font-semibold">{headerLabel}</span>
            {restoredDraft && (
              <span className="ml-2 whitespace-nowrap text-[11px] text-muted-foreground/70">черновик</span>
            )}
            {headerMeta && <span className="ml-2 whitespace-nowrap text-[11px] text-muted-foreground/70">{headerMeta}</span>}
          </div>
          {headerRight}
          {isDesktop && (
            <button
              type="button"
              title={fullscreen ? "Свернуть" : "На весь экран"}
              onClick={() => setFullscreen((prev) => !prev)}
              className={`${glassGhostButtonClass} order-3`}
            >
              {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
            </button>
          )}
        </div>

        {/* Extra fields (title, topic placement…) */}
        {children}

        {/* Formatting toolbar — a fixed row ABOVE the editor scroller, never
            inside it: `sticky` inside the keyboard-resized scroller re-lays
            on every visualViewport frame on iOS and the bar visibly jumps.
            Out here it is painted once and never moves. Swipes starting here
            must neither dismiss the keyboard nor scroll the page behind. */}
        {toolbarEditor && (
          <div data-kb-locked className="shrink-0 px-3 pt-1">
            <Toolbar editor={toolbarEditor} />
          </div>
        )}

        {/* Editor — media blocks are edited in place. `overscroll-contain`
            stops drags from chaining to the document when the doc is short
            (nothing to scroll): without it the gesture falls through and the
            background page moves under the sheet. */}
        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-2"
          onClick={(event) => {
            const target = event.target as HTMLElement;
            if (
              target.closest(
                "a, button, input, textarea, select, [contenteditable='true'], [data-media-toolbar], [data-radix-popper-content-wrapper]",
              )
            ) {
              return;
            }
            editorRef.current?.focus();
          }}
        >
          <MediaAttachmentsProvider value={{ attachments, inlineMedia: true, galleryKey: "draft" }}>
            <MediaEditorProvider
              value={{
                replaceAttachment,
                openImageEditor,
                toggleFullscreen: () => setFullscreen((prev) => !prev),
                canAddMore: !atLimit,
                coverId: cover?.id ?? null,
                coverPlacements: cover?.placements ?? [],
                setCover: handleSetCover,
              }}
            >
              <GomoRichEditor
                ref={editorRef}
                resetKey={editorResetKey}
                showToolbar={false}
                maxLength={maxLength}
                contentJson={contentJson}
                legacyContent={initialLegacyContent ?? ""}
                extraExtensions={editorExtensions}
                enableMediaDrop
                onFilesDropped={(files, pos) => uploadFiles(files, pos)}
                onFilesPasted={(files, pos) => uploadFiles(files, pos)}
                onChange={({ json, text }) => handleEditorChange(json, text)}
                onSubmit={handleSubmit}
                placeholder={placeholder}
                minHeightClassName={fullscreen ? "min-h-[70dvh]" : "min-h-[180px]"}
                maxHeightClassName="max-h-full"
              />
            </MediaEditorProvider>
          </MediaAttachmentsProvider>
        </div>

        {/* Toolbar — pinned above the keyboard (see [data-kb-locked] in
            lib/mobileKeyboard.ts): swipes starting here must neither
            dismiss the keyboard nor scroll the page behind. */}
        <div data-kb-locked className="contents">
        <InkBar
          blobClassName="h-9 w-9"
          className="kb-sheet-bar flex shrink-0 items-center gap-0.5 border-t border-border/60 pl-2 pr-2 pt-1.5 pb-1.5 md:pr-7"
        >
          <InkButton
            title="Добавить медиа"
            disabled={isSubmitting || atLimit}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Paperclip className="h-5 w-5" />}
          </InkButton>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            data-testid="inline-media-file-input"
            onChange={handleFiles}
          />
          <EmojiPicker
            onEmojiSelect={(data) => {
              editorRef.current?.focus();
              editorRef.current?.insertEmoji(data);
            }}
          >
            <InkButton title="Эмодзи">
              <Smile className="h-5 w-5" />
            </InkButton>
          </EmojiPicker>
          <InkButton
            title="Команды (/)"
            aria-label="Открыть меню команд"
            onMouseDown={(event) => event.preventDefault()}
            onClick={insertSlashCommand}
          >
            <span aria-hidden="true" className="text-[19px] font-bold leading-none">
              /
            </span>
          </InkButton>
          <Popover
            open={linkDialogOpen}
            onOpenChange={(open) => {
              if (!linkLoading) setLinkDialogOpen(open);
            }}
          >
            <PopoverPanel side="top" align="start" className="z-[80] w-80">
              <div className="px-3 py-3">
                <Input
                  autoFocus
                  className="h-9 focus-visible:ring-1 focus-visible:ring-primary/40 focus-visible:ring-offset-0"
                  value={linkUrl}
                  onChange={(event) => setLinkUrl(event.target.value)}
                  placeholder="https://…"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void handleCreateLinkCard();
                    }
                  }}
                />
              </div>
              <div className="flex justify-end border-t border-border/60 px-1.5 py-1">
                <button
                  type="button"
                  onClick={() => void handleCreateLinkCard()}
                  disabled={linkLoading || !linkUrl.trim()}
                  className="rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                >
                  {linkLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Добавить"}
                </button>
              </div>
            </PopoverPanel>
          </Popover>
          {toolbarLeading}
          <span className="ml-1 text-[11px] text-muted-foreground">
            {mediaCount > 0 ? `${mediaCount}/${maxMedia}` : null}
          </span>
          <div className="flex-1" />
          <PublishButton
            style={publishButtonStyle}
            creating={isSubmitting}
            disabled={!canSubmit}
            onClick={handleSubmit}
            label={publishLabel}
          />
        </InkBar>
        </div>

        <div
          role="separator"
          aria-label="Изменить размер окна"
          title="Потяните, чтобы изменить размер"
          onPointerDown={handleResizeStart}
          className="absolute bottom-0 right-0 z-40 hidden h-6 w-6 cursor-nwse-resize items-end justify-end p-1 md:flex"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            aria-hidden="true"
            className="text-muted-foreground/50 transition-colors group-hover/panel:text-muted-foreground"
          >
            <path d="M13 5 L5 13 M13 10 L10 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
      </motion.div>

      {lightbox && (
        <Lightbox
          bucket={bucket}
          items={lightbox.items}
          initialIndex={lightbox.index}
          startInEditMode={lightbox.startInEditMode}
          onClose={() => setLightbox(null)}
          onEditImage={handleEditImage}
        />
      )}

      <Dialog open={spoilerDialogOpen} onOpenChange={setSpoilerDialogOpen}>
        <DialogContent className="z-[70] w-[calc(100vw-2rem)] max-w-sm !gap-0 !p-0 border-border/60 bg-background">
          <div className="border-b border-border/60 px-4 py-3 pr-10 text-sm font-medium">Спойлер</div>
          <div className="px-4 py-4">
            <Input
              autoFocus
              className="h-9 focus-visible:ring-1 focus-visible:ring-primary/40 focus-visible:ring-offset-0"
              value={spoilerLabelDraft}
              onChange={(event) => setSpoilerLabelDraft(event.target.value)}
              placeholder="Текст на спойлере"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleCreateSpoiler();
                }
              }}
            />
          </div>
          <div className="flex justify-end border-t border-border/60 px-2 py-1.5">
            <button
              type="button"
              onClick={handleCreateSpoiler}
              className="rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
            >
              Добавить
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={youtubeDialogOpen} onOpenChange={setYoutubeDialogOpen}>
        <DialogContent className="z-[70] w-[calc(100vw-2rem)] max-w-sm !gap-0 !p-0 border-border/60 bg-background">
          <div className="border-b border-border/60 px-4 py-3 pr-10 text-sm font-medium">YouTube</div>
          <div className="px-4 py-4">
            <Input
              autoFocus
              className="h-9 focus-visible:ring-1 focus-visible:ring-primary/40 focus-visible:ring-offset-0"
              value={youtubeUrl}
              onChange={(event) => setYoutubeUrl(event.target.value)}
              placeholder="https://youtu.be/…"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleCreateYouTube();
                }
              }}
            />
          </div>
          <div className="flex justify-end border-t border-border/60 px-2 py-1.5">
            <button
              type="button"
              onClick={handleCreateYouTube}
              disabled={!youtubeUrl.trim()}
              className="rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            >
              Добавить
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>,
    document.body,
  );
};
