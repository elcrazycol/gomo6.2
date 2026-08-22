/**
 * Global mobile virtual-keyboard handling (iOS Safari / Android Chrome /
 * Android Firefox / tablets), built on the native Visual Viewport API — the
 * de-facto standard solution (no third-party library needed; all target
 * browsers expose `window.visualViewport`).
 *
 * Why this is needed
 * ─────────────────
 *  • iOS Safari never resizes the *layout* viewport when the software
 *    keyboard opens — the keyboard simply covers the bottom of the screen.
 *    `100dvh`/`100svh` keep their values, so fixed-height app surfaces and
 *    `position: fixed/sticky; bottom: X` bars end up hidden *under* the
 *    keyboard.
 *  • Chrome/Firefox Android resize the layout viewport only with
 *    `interactive-widget=resizes-content` (now enabled in index.html); older
 *    builds keep the old `resizes-visual` behavior.
 *  • Browsers' own focus auto-scrolling fights sticky/fixed composer bars
 *    (notably Firefox Android: the composer is scrolled to but lands below
 *    the fold / needs excessive manual scrolling).
 *
 * What this module does
 * ────────────────────
 *  • Computes the real keyboard height as
 *    `window.innerHeight − visualViewport.height − visualViewport.offsetTop`
 *    (the delta includes the expanded iOS URL bar, which sits at the TOP of
 *    the screen and must not lift bottom-anchored bars; exact on every
 *    platform regardless of `interactive-widget` mode or URL-bar state).
 *  • Publishes CSS variables on <html> so the whole app can react:
 *      --app-vh   — visual viewport height in px. Use instead of `100dvh`
 *                   for full-screen surfaces (messenger page, chat panel…).
 *      --kb-inset — keyboard height in px. Add to `bottom` of fixed/sticky
 *                   bars so they float exactly above the keyboard on iOS.
 *    plus a `kb-open` class on <html>.
 *  • Keeps the focused editable element visible inside the *visual* viewport
 *    (12px above the keyboard) with exact math, overriding the browser's own
 *    buggy focus-scrolling.
 *  • Prevents Safari's document pan for inputs inside fixed/sticky composer
 *    bars (messenger chat, wall/thread comments): the document is pinned
 *    (position:fixed + overflow:hidden) from the TOUCHSTART on a composer bar
 *    (before the native focus-pan can even start — the focusin-only pin
 *    raced it and sometimes lost), and the pin is held while the input is
 *    focused. Full-screen surfaces (the messenger route, the wall-post
 *    overlay) additionally hold the pin for their whole lifetime on touch
 *    (pinDocumentForSurface), which makes the pan structurally impossible
 *    instead of racing it: the keyboard slide-in has nothing to scroll and
 *    content never flies down then back up.
 *    (see syncScrollLock / handleTouchStart).
 *  • iOS scroll-to-dismiss behaves exactly like tapping outside the composer:
 *    the focused input is blurred (so focus-to-expand composers collapse via
 *    their own onBlur animation) and the fixed/sticky bars descend smoothly
 *    (eased rAF interpolation of the CSS vars) instead of teleporting.
 *    Surfaces marked [data-kb-keep] (the messenger chat) opt out: scrolling
 *    them keeps the keyboard up — only a real outside tap dismisses.
 *
 * Only touch devices (`(pointer: coarse)`) ever get keyboard handling;
 * desktop layouts are untouched.
 */

export interface MobileKeyboardState {
  /** True while a software keyboard covers part of the viewport (touch only). */
  isOpen: boolean;
  /** Height in px of the area covered by the keyboard (0 when closed / non-touch). */
  keyboardInset: number;
  /** Current visual viewport height in px (screen minus URL bar/keyboard). */
  viewportHeight: number;
  /** True on touch devices — keyboard handling is active there. */
  isTouch: boolean;
}

type Listener = () => void;

const TOUCH_QUERY = "(pointer: coarse)";
/** Below this height difference the resize is URL-bar noise, not a keyboard. */
const OPEN_THRESHOLD_PX = 60;
/** Gap between the focused input's bottom edge and the keyboard top. */
const SCROLL_GAP_PX = 12;
/** Close events are debounced: the keyboard collapse fires several resize
 *  events and the URL bar can briefly distort the delta mid-animation. */
const CLOSE_DEBOUNCE_MS = 120;
/** Below this delta the keyboard is gone for sure — close immediately. */
const CLOSE_IMMEDIATE_THRESHOLD_PX = 24;
/** After a committed close, re-measure this long later: the keyboard-open
 *  animation can end with ONE transient resize event that reports the
 *  pre-keyboard geometry (WebKit quirk), which would commit a false close
 *  while the keyboard is still up. The verify re-opens it. */
const CLOSE_VERIFY_MS = 150;
/** While an editable is focused, re-measure this often: iOS can open the
 *  soft keyboard on re-focus WITHOUT firing any visual-viewport events, so
 *  the resize-driven state machine would never notice. visualViewport.height
 *  is a LIVE property, so the poll detects the keyboard exactly. */
const FOCUS_POLL_MS = 250;
/** How long the per-frame geometry follow keeps running after the last
 *  visual-viewport event — comfortably longer than the ~250ms keyboard slide
 *  (plus URL-bar collapse), so the layout keeps gliding with the keyboard for
 *  the whole animation. */
const FOLLOW_MS = 600;
/** iOS scroll-to-dismiss: WebKit defers visualViewport resize events while a
 *  scroll gesture is running, so after the keyboard starts hiding the stale
 *  values would keep `--kb-inset` applied (composer floating mid-screen).
 *  `dismissUntil` ignores stale "open" events until the gesture ends. */
const GESTURE_SUPPRESS_MS = 200;
/** Movement (px) a touch must exceed before we treat it as a scroll — matches
 *  the iOS touch slop. Sub-slop jitter (a slightly-off tap) must not dismiss
 *  the keyboard while composing. */
const TOUCH_SLOP_PX = 10;
/** Duration of the scroll-to-dismiss descent animation. The keyboard slides
 *  away over roughly this time on iOS; the eased interpolation keeps the
 *  fixed/sticky bars glued to it instead of teleporting. */
const DISMISS_DURATION_MS = 280;

const listeners = new Set<Listener>();
let initialized = false;
let state: MobileKeyboardState = {
  isOpen: false,
  keyboardInset: 0,
  viewportHeight: typeof window === "undefined" ? 0 : window.innerHeight,
  isTouch: false,
};
let focusedEditable: HTMLElement | null = null;
const pendingScrollTimers = new Set<ReturnType<typeof setTimeout>>();
let cancelUserInterrupt: (() => void) | null = null;
let closeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let dismissUntil = 0;
let dismissalActive = false;
let dismissProbeTimer: ReturnType<typeof setTimeout> | null = null;
// Re-measures shortly after a committed close — see scheduleCloseVerify.
let closeVerifyTimer: ReturnType<typeof setTimeout> | null = null;
// Light poll while an editable is focused — see scheduleFocusPoll.
let focusPollTimer: ReturnType<typeof setTimeout> | null = null;
// Per-frame geometry follow (see startGeometryFollow).
let followRaf: number | null = null;
let followUntil = 0;
let gestureStart: { x: number; y: number } | null = null;
let dismissAnimFrame: number | null = null;
// True while the current touch began on a `[data-kb-locked]` element (a
// pinned composer bar). Such gestures must never scroll the page or dismiss
// the keyboard — the bar is position:fixed and cannot be dragged.
let lockedGestureActive = false;
// True while the current touch began on a `[data-kb-keep]` element (the
// messenger chat surface). Scrolling such a surface is content browsing, not
// a dismissal gesture — the keyboard must stay up, exactly like when the
// emoji swap panel is open (there the editor is blurred, so no dismissal can
// fire; the open keyboard must match that stability).
let stickyScrollActive = false;
// Document scroll lock. The body is pinned (position:fixed + top:-scrollY +
// overflow:hidden on html/body) while the pin is needed, so iOS cannot pan the
// document to "reveal" a focused input. That pan is the root cause of the jump
// (content flies down then back up) in the messenger and the wall comments: it
// feeds visualViewport.offsetTop — which the --kb-inset formula subtracts — so
// the fixed bar wiggles, and every scroll-restore the app tried just fought it
// visibly. Prevent the pan instead of undoing it. Internal scrollers (message
// list, overlay container) are separate overflow containers and keep working
// while the pin is on.
//
// The pin has TWO independent owners, so a full-screen surface (messenger
// route, wall-post overlay) can hold the document pinned for its whole
// lifetime — making the focus-pan structurally impossible instead of racing it
// — while the per-focus keyboard pin (touchstart on a composer bar, focusin in
// a fixed bar) adds/releases its own contribution on top:
//   surfacePinActive  — set by full-screen surfaces via pinDocumentForSurface()
//                       for as long as they are open (touch only).
//   keyboardPinActive — set while an editable inside a composer bar is focused
//                       (touchstart/focusin), released on blur / touch outside
//                       the bar / keyboard close.
let surfacePinActive = false;
let keyboardPinActive = false;
let scrollLock: {
  rootOverflow: string;
  bodyOverflow: string;
  bodyPosition: string;
  bodyTop: string;
  bodyWidth: string;
  scrollY: number;
} | null = null;

// ── Public API ───────────────────────────────────────────────────────────────

export function getMobileKeyboardState(): MobileKeyboardState {
  return state;
}

/** Subscribe to state changes (used by useSyncExternalStore). Returns unsubscribe. */
export function subscribeMobileKeyboard(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Pin the document for the whole lifetime of a full-screen surface (the
 * messenger route, the wall-post overlay) on touch devices. While any surface
 * holds this pin the body stays position:fixed, so iOS's focus-pan has
 * literally nothing to scroll when a composer input inside the surface is
 * focused — the keyboard slide-in is always smooth, no race. The pin is
 * released by unpinDocumentForSurface (call it when the surface unmounts).
 * No-op on desktop / non-touch.
 */
export function pinDocumentForSurface(): void {
  if (!isCoarsePointer()) return;
  surfacePinActive = true;
  syncScrollLock();
}

/** Release a surface-level document pin (see pinDocumentForSurface). */
export function unpinDocumentForSurface(): void {
  surfacePinActive = false;
  syncScrollLock();
}

/** Idempotent. Call once from the app entry point. Returns a dispose fn. */
export function initMobileKeyboard(): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => undefined;
  }
  if (initialized) return () => undefined;
  initialized = true;

  const vv = window.visualViewport;
  if (vv) {
    vv.addEventListener("resize", handleMetricsChanged);
    vv.addEventListener("scroll", handleMetricsChanged);
  }
  window.addEventListener("resize", handleMetricsChanged);
  window.addEventListener("orientationchange", handleMetricsChanged);
  window.addEventListener("pageshow", handleMetricsChanged);
  document.addEventListener("focusin", handleFocusIn);
  document.addEventListener("focusout", handleFocusOut);
  // iOS scroll-to-dismiss detection (see handleGestureScroll).
  // Pinned composer bars ([data-kb-locked]) are not draggable: this passive:
  // false handler cancels scrolls that begin on them. Registered BEFORE the
  // dismiss handler so the preventDefault is in place before the dismiss
  // logic runs on the same touchmove.
  document.addEventListener("touchmove", handleLockedTouchMove, { passive: false, capture: true });
  document.addEventListener("touchmove", handleGestureScroll, { passive: true, capture: true });
  document.addEventListener("wheel", handleGestureScroll, { passive: true, capture: true });
  // Track the finger's origin so sub-slop jitter is never treated as a scroll.
  document.addEventListener("touchstart", handleTouchStart, { passive: true, capture: true });
  document.addEventListener("touchend", handleTouchEnd, { passive: true, capture: true });
  document.addEventListener("touchcancel", handleTouchEnd, { passive: true, capture: true });

  // Seed the CSS variables immediately so full-screen surfaces are sized
  // correctly before the first user interaction.
  handleMetricsChanged();

  return () => {
    initialized = false;
    if (vv) {
      vv.removeEventListener("resize", handleMetricsChanged);
      vv.removeEventListener("scroll", handleMetricsChanged);
    }
    window.removeEventListener("resize", handleMetricsChanged);
    window.removeEventListener("orientationchange", handleMetricsChanged);
    window.removeEventListener("pageshow", handleMetricsChanged);
    document.removeEventListener("focusin", handleFocusIn);
    document.removeEventListener("focusout", handleFocusOut);
    document.removeEventListener("touchmove", handleLockedTouchMove, { capture: true });
    document.removeEventListener("touchmove", handleGestureScroll, { capture: true });
    document.removeEventListener("wheel", handleGestureScroll, { capture: true });
    document.removeEventListener("touchstart", handleTouchStart, { capture: true });
    document.removeEventListener("touchend", handleTouchEnd, { capture: true });
    document.removeEventListener("touchcancel", handleTouchEnd, { capture: true });
    clearPendingScrolls();
    if (closeDebounceTimer) clearTimeout(closeDebounceTimer);
    closeDebounceTimer = null;
    if (dismissProbeTimer) clearTimeout(dismissProbeTimer);
    dismissProbeTimer = null;
    if (closeVerifyTimer) clearTimeout(closeVerifyTimer);
    closeVerifyTimer = null;
    if (focusPollTimer) clearTimeout(focusPollTimer);
    focusPollTimer = null;
    if (followRaf !== null) cancelAnimationFrame(followRaf);
    followRaf = null;
    if (dismissAnimFrame !== null) cancelAnimationFrame(dismissAnimFrame);
    dismissAnimFrame = null;
    gestureStart = null;
    lockedGestureActive = false;
    stickyScrollActive = false;
    dismissUntil = 0;
    dismissalActive = false;
    focusedEditable = null;
    // Release both pin contributions — surfaces and the keyboard — so a test
    // dispose never leaves the body frozen.
    surfacePinActive = false;
    keyboardPinActive = false;
    syncScrollLock();
  };
}

// ── Pure helpers (exported for tests) ───────────────────────────────────────

export function computeKeyboardMetrics(input: {
  innerHeight: number;
  visualViewportHeight: number | null;
  /** iOS: the visual viewport is pushed down by the expanded URL bar
   *  (visualViewport.offsetTop ≈ URL-bar height, 0 when collapsed). */
  visualViewportOffsetTop?: number;
  isTouch: boolean;
}): Pick<MobileKeyboardState, "isOpen" | "keyboardInset" | "viewportHeight"> {
  const { innerHeight, visualViewportHeight, visualViewportOffsetTop = 0, isTouch } = input;
  if (visualViewportHeight === null) {
    return { isOpen: false, keyboardInset: 0, viewportHeight: innerHeight };
  }
  const delta = innerHeight - visualViewportHeight;
  const isOpen = isTouch && delta >= OPEN_THRESHOLD_PX;
  return {
    isOpen,
    // The delta covers everything below the visual viewport — on iOS that is
    // the keyboard PLUS the expanded URL bar (visualViewport.offsetTop), which
    // sits at the TOP of the screen. A bottom-anchored bar must only clear the
    // real keyboard height; including the URL bar makes it float up by that
    // amount whenever the keyboard opens mid-page (URL bar expanded). Below
    // the threshold the delta is URL-bar noise, not a keyboard — keep the CSS
    // inset 0 so fixed bars don't jump for nothing.
    keyboardInset: isOpen ? Math.max(0, Math.round(delta - visualViewportOffsetTop)) : 0,
    viewportHeight: Math.round(visualViewportHeight),
  };
}

/**
 * Window-mode correction: how much to scroll the page so the focused element
 * sits SCROLL_GAP_PX above the keyboard top. Returns 0 when no scroll is
 * needed (element fully visible). Positive = scroll down, negative = up.
 */
export function computeWindowScrollDelta(input: {
  elementRectTop: number;
  elementRectBottom: number;
  visibleHeight: number;
}): number {
  const { elementRectTop, elementRectBottom, visibleHeight } = input;
  if (elementRectTop >= 0 && elementRectBottom <= visibleHeight - SCROLL_GAP_PX) return 0;
  const delta = elementRectBottom - (visibleHeight - SCROLL_GAP_PX);
  if (delta > 0) return delta;
  if (elementRectTop < 0) return elementRectTop - 8;
  return 0;
}

/**
 * Container-mode correction: how much to scroll the element's scrollable
 * ancestor (relative to its current scrollTop). 0 = no scroll needed.
 */
export function computeContainerScrollDelta(input: {
  elementRectTop: number;
  elementRectBottom: number;
  scrollerRectTop: number;
  scrollerRectBottom: number;
  visibleHeight: number;
}): number {
  const { elementRectTop, elementRectBottom, scrollerRectTop, scrollerRectBottom, visibleHeight } = input;
  const visibleBottom = Math.min(scrollerRectBottom, visibleHeight) - SCROLL_GAP_PX;
  const delta = elementRectBottom - visibleBottom;
  if (delta > 0) return delta;
  if (elementRectTop < scrollerRectTop) return elementRectTop - scrollerRectTop - 8;
  return 0;
}

/**
 * iOS detection, including iPadOS 13+ which reports a desktop-style UA
 * (touch-capable MacIntel = iPad). Scroll-to-dismiss only exists on iOS, so
 * the gesture-based keyboard dismissal is gated on this.
 */
export function isIOSDevice(input: {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
}): boolean {
  if (/iP(hone|ad|od)/i.test(input.userAgent)) return true;
  return input.platform === "MacIntel" && input.maxTouchPoints > 1;
}

/**
 * One frame of the scroll-to-dismiss descent: eased interpolation of the
 * keyboard inset (300px → 0) and the viewport height (shrunk → full screen),
 * so fixed/sticky bars follow the departing keyboard smoothly instead of
 * teleporting. progress ∈ [0,1]. Pure, for tests.
 */
export function computeDismissalFrame(input: {
  startInset: number;
  startViewportHeight: number;
  endViewportHeight: number;
  progress: number;
}): { keyboardInset: number; viewportHeight: number } {
  const t = Math.min(1, Math.max(0, input.progress));
  const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
  return {
    keyboardInset: Math.round(input.startInset * (1 - eased)),
    viewportHeight: Math.round(input.startViewportHeight + (input.endViewportHeight - input.startViewportHeight) * eased),
  };
}

/**
 * Whether the finger has moved far enough from the gesture origin to count as
 * a scroll. Below the iOS touch slop a touch is a tap — dismissing the
 * keyboard there would make the UI feel broken (taps killing the composer).
 */
export function isBeyondTouchSlop(input: {
  startX: number | null;
  startY: number | null;
  currentX: number;
  currentY: number;
  slopPx: number;
}): boolean {
  if (input.startX === null || input.startY === null) return false;
  return Math.abs(input.currentX - input.startX) + Math.abs(input.currentY - input.startY) >= input.slopPx;
}

function currentIsIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return isIOSDevice({
    userAgent: navigator.userAgent,
    platform: navigator.platform || "",
    maxTouchPoints: navigator.maxTouchPoints || 0,
  });
}

export function isEditableElement(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  // Attribute check covers jsdom (which never reports isContentEditable) and
  // contenteditable="false" subtrees.
  const contentEditable = el.getAttribute("contenteditable");
  if (contentEditable !== null && contentEditable !== "false") return true;
  return el.matches("input, textarea, select");
}

/**
 * Whether a touch that started on this target must not scroll the page or
 * dismiss the keyboard: the target (or an ancestor) carries [data-kb-locked],
 * which pinned composer bars set while they are fixed above the keyboard.
 */
export function isLockedGestureTarget(target: EventTarget | null): boolean {
  return !!(
    target instanceof Element &&
    typeof target.closest === "function" &&
    target.closest("[data-kb-locked]")
  );
}

/**
 * Whether a touch/wheel that started on this target must NOT dismiss the
 * keyboard: the target (or an ancestor) carries [data-kb-keep] (the messenger
 * chat surface). Scrolling there is normal content browsing — the keyboard
 * stays up until the user taps outside, sends, or uses the keyboard's own
 * hide control.
 */
export function isStickyGestureTarget(target: EventTarget | null): boolean {
  return !!(
    target instanceof Element &&
    typeof target.closest === "function" &&
    target.closest("[data-kb-keep]")
  );
}

/**
 * Whether a touch began on a composer bar ([data-kb-pin] — the wall comment
 * dock, the messenger composer, the thread comment composer). A tap there is
 * about to focus its editor, so the document is pinned on touchstart (BEFORE
 * the native focus) to beat Safari's focus-pan deterministically — the
 * focusin-only pin raced it and sometimes lost (see handleTouchStart).
 */
export function isComposerBarTarget(target: EventTarget | null): boolean {
  return !!(
    target instanceof Element &&
    typeof target.closest === "function" &&
    target.closest("[data-kb-pin]")
  );
}

export type ScrollContext =
  | { mode: "window"; scroller: null }
  | { mode: "container"; scroller: HTMLElement }
  | { mode: "fixed"; scroller: null };

/**
 * Decide how the focused element should be scrolled into the *visual*
 * viewport:
 *  • "window"    — element lives in the document flow; scroll the page.
 *  • "container" — element lives inside a scrollable ancestor; scroll that.
 *  • "fixed"     — element lives in a `position: fixed` overlay (messenger
 *                  shell, modal). The browser manages those (iOS pans fixed
 *                  elements itself); we never scroll the window for them.
 * Fixed ancestors terminate the walk — a fixed shell already sizes itself to
 * the visible area via --app-vh / --kb-inset.
 */
export function getScrollContext(el: HTMLElement): ScrollContext {
  let node = el.parentElement;
  while (node && node !== document.body && node !== document.documentElement) {
    const style = getComputedStyle(node);
    if (style.position === "fixed") return { mode: "fixed", scroller: null };
    // Sticky containers are managed by the browser — never scroll the page
    // for elements inside them (e.g. wall comment composer). The browser
    // already keeps sticky elements visible.
    if (style.position === "sticky") return { mode: "fixed", scroller: null };
    const overflowY = style.overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      node.scrollHeight > node.clientHeight + 1
    ) {
      return { mode: "container", scroller: node };
    }
    node = node.parentElement;
  }
  return { mode: "window", scroller: null };
}

// ── Internal wiring ──────────────────────────────────────────────────────────

function isCoarsePointer(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(TOUCH_QUERY).matches
  );
}

function computeRaw(): MobileKeyboardState {
  const isTouch = isCoarsePointer();
  const innerHeight = typeof window === "undefined" ? 0 : window.innerHeight;
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  return {
    isTouch,
    ...computeKeyboardMetrics({
      innerHeight,
      visualViewportHeight: vv ? vv.height : null,
      visualViewportOffsetTop: vv ? vv.offsetTop : 0,
      isTouch,
    }),
  };
}

function writeGeometryVars(next: MobileKeyboardState) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--app-vh", `${next.viewportHeight}px`);
  root.style.setProperty("--kb-inset", `${next.keyboardInset}px`);
}

/**
 * While the soft keyboard animates, its visual-viewport resize events are
 * choppy (a handful of steps, not one per frame) — following them directly
 * makes bottom-anchored bars jerk step-by-step while the keyboard itself
 * slides smoothly. visualViewport.height is a LIVE property, so this short
 * per-frame follow after any geometry event reads the keyboard's true
 * position every frame and glides the layout with it in one continuous
 * motion — no interpolation lag (the composer is always exactly at the
 * keyboard top), no event-stepping.
 *
 * The follow also re-arms itself while the keyboard is open, so the frame
 * loop survives the whole typing session, not just the slide-in animation.
 * That lets the window-scroll pin below counteract Safari's document pan
 * continuously (a pan fired after the last timer used to leave the fixed
 * messenger shell shifted — the header drifting up, the composer down).
 */
function startGeometryFollow() {
  followUntil = Date.now() + FOLLOW_MS;
  if (followRaf !== null) return;
  const step = () => {
    followRaf = null;
    if (dismissalActive) return; // the dismissal animation owns the vars
    writeGeometryVars(computeRaw());
    // While the document is pinned (composer-bar input focused), undo any
    // focus-pan that slipped through despite the touchstart pin: the keyboard
    // slide-in is exactly the window where Safari may still shift the page,
    // and the LIVE-geometry follow keeps this loop alive through the whole
    // animation, so a stray pan is reverted within a frame instead of being
    // visible as the content flying down then back up.
    if (scrollLock && typeof window !== "undefined" && window.scrollY !== scrollLock.scrollY) {
      window.scrollTo(0, scrollLock.scrollY);
    }
    if (Date.now() < followUntil || state.isOpen) {
      followRaf = requestAnimationFrame(step);
    }
  };
  followRaf = requestAnimationFrame(step);
}

function applyState(next: MobileKeyboardState) {
  // The keyboard just opened in THIS transition. The slide-in alignment below
  // must arm once per open, not on every metrics change while open: the
  // keyboard animation fires a stream of visualViewport resizes, and each one
  // used to re-arm 4 more page scrolls — recomputed against the live (and
  // possibly still growing) editor rect — which made long-post composers
  // visibly fight the browser's own caret-follow scrolling.
  const opened = next.isOpen && !state.isOpen;
  const changed =
    next.isOpen !== state.isOpen ||
    next.keyboardInset !== state.keyboardInset ||
    next.viewportHeight !== state.viewportHeight ||
    next.isTouch !== state.isTouch;
  state = next;

  writeGeometryVars(next);
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("kb-open", next.isOpen);
  }
  // The keyboard is gone — the document scroll lock (fixed-bar focus) is no
  // longer needed: the pan it prevents only ever happens at the moment of
  // focus, so releasing now can never cause a jump.
  if (!next.isOpen) unlockDocumentScroll();
  // Keep the per-frame follow alive — the LIVE viewport keeps gliding after
  // this event (see startGeometryFollow).
  startGeometryFollow();

  if (!changed) return;
  for (const listener of listeners) listener();
  if (opened) {
    // The keyboard slides in over ~250ms; re-align the focused input a few
    // times so it lands exactly above the keyboard when the animation ends.
    // Each correction reads the LIVE visual-viewport geometry at fire time, so
    // a single arm already tracks the slide-in. But only if the element isn't
    // already fully visible — skipping the scroll prevents the composer from
    // jumping when it's already at the bottom and the user focuses it
    // (e.g. replying to a comment).
    const el = focusedEditable;
    if (el && el.isConnected) {
      const vv = typeof window !== 'undefined' ? window.visualViewport : null;
      const visibleHeight = vv ? vv.height : window.innerHeight;
      const rect = el.getBoundingClientRect();
      const isFullyVisible = rect.top >= 0 && rect.bottom <= visibleHeight - SCROLL_GAP_PX;
      if (!isFullyVisible) {
        scheduleScrollIntoView(0);
        scheduleScrollIntoView(120);
        scheduleScrollIntoView(300);
        scheduleScrollIntoView(600);
      }
    }
  }
}

function currentVisualDelta(): number {
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  if (!vv) return 0;
  return window.innerHeight - vv.height;
}

function handleMetricsChanged() {
  if (dismissalActive) {
    // Scroll-to-dismiss in progress: WebKit reports the old keyboard-open
    // geometry until the scroll (including the momentum phase, which fires
    // visualViewport.scroll events with no touch contact at all) fully ends.
    // Every event postpones the probe; the dropped state (isOpen:false,
    // inset:0, --app-vh: innerHeight) is already the correct final one on
    // iOS, so nothing needs to be applied mid-scroll.
    dismissUntil = Date.now() + GESTURE_SUPPRESS_MS;
    scheduleDismissProbe();
    return;
  }
  const next = computeRaw();
  if (next.isOpen) {
    if (closeDebounceTimer) {
      clearTimeout(closeDebounceTimer);
      closeDebounceTimer = null;
    }
    if (closeVerifyTimer) {
      clearTimeout(closeVerifyTimer);
      closeVerifyTimer = null;
    }
    applyState(next);
  } else if (state.isOpen) {
    const delta = currentVisualDelta();
    if (delta < CLOSE_IMMEDIATE_THRESHOLD_PX) {
      // Keyboard fully gone — close right away so full-screen surfaces expand
      // in sync with the collapse instead of lagging a debounce window.
      applyState(next);
      scheduleCloseVerify();
    } else {
      // Still mid-transition (delta 24–60): hold the open state for a beat.
      if (closeDebounceTimer) clearTimeout(closeDebounceTimer);
      closeDebounceTimer = setTimeout(() => {
        closeDebounceTimer = null;
        const again = computeRaw();
        if (!again.isOpen) applyState(again);
        scheduleCloseVerify();
      }, CLOSE_DEBOUNCE_MS);
    }
  } else {
    // Closed → closed: viewportHeight can still change (URL bar collapse).
    applyState(next);
  }
}

function handleFocusIn(e: FocusEvent) {
  const el = e.target as HTMLElement | null;
  if (!isEditableElement(el)) return;
  focusedEditable = el;
  // Fresh focus re-arms keyboard detection: cancel any pending dismissal,
  // including an in-flight descent animation (user re-tapped the composer
  // while the keyboard was sliding away).
  dismissalActive = false;
  if (dismissProbeTimer) {
    clearTimeout(dismissProbeTimer);
    dismissProbeTimer = null;
  }
  if (dismissAnimFrame !== null) {
    cancelAnimationFrame(dismissAnimFrame);
    dismissAnimFrame = null;
  }
  dismissUntil = 0;
  if (!state.isTouch) return;
  // While an editable is focused, keep re-measuring — a keyboard that opens
  // without visual-viewport events must still be detected (see
  // scheduleFocusPoll), and the per-frame follow starts gliding the layout
  // with the LIVE viewport the moment focus lands (see startGeometryFollow).
  scheduleFocusPoll();
  startGeometryFollow();
  // Focus inside a fixed/sticky bar (pinned wall composer, messenger shell):
  // the bar is already positioned above the keyboard by the app, so the
  // browser's own focus-scroll must not move the page — iOS yanks it (and
  // collapses the URL bar) the moment the keyboard opens, reading as the
  // composer "flying up" when re-tapped mid-page. Lock the document so there
  // is nothing to pan (see lockDocumentScroll); a real user touch or blur
  // releases it.
  if (getScrollContext(el).mode === "fixed") {
    lockDocumentScroll();
    return;
  }
  // Skip scroll-into-view for elements that are already fully visible.
  // This prevents jumping when focusing an already-expanded composer
  // (e.g. when clicking reply on a comment while the composer is open).
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  const visibleHeight = vv ? vv.height : window.innerHeight;
  const rect = el.getBoundingClientRect();
  if (rect.top >= 0 && rect.bottom <= visibleHeight - SCROLL_GAP_PX) return;
  scheduleScrollIntoView(0);
  if (state.isOpen) {
    scheduleScrollIntoView(80);
    scheduleScrollIntoView(250);
  }
}

function handleFocusOut() {
  // Keep `focusedEditable` — the scroll keeper still targets it while the
  // keyboard is animating closed. Just cancel pending scrolls and stop the
  // focus poll (the resize events take over the close detection).
  if (focusPollTimer) {
    clearTimeout(focusPollTimer);
    focusPollTimer = null;
  }
  clearPendingScrolls();
  // The pan the lock prevents only ever happens at the moment of focus, so a
  // blur can release it immediately — even if the keyboard is still animating
  // closed. Releasing on blur also covers focus migration (fixed bar → plain
  // input), where the document must become scrollable again right away.
  unlockDocumentScroll();
}

/**
 * iOS scroll-to-dismiss: the moment the user starts scrolling with the
 * keyboard up, iOS begins hiding the keyboard but defers visualViewport
 * resize events until the gesture ends. If we waited for those, fixed/sticky
 * bars would keep floating at the keyboard height during the whole scroll.
 *
 * Instead we react to the gesture itself and behave exactly like a tap
 * outside the composer:
 *  • blur the focused editable — focus-to-expand composers collapse through
 *    their own onBlur animation (identical to clicking outside), and iOS
 *    dismisses the keyboard the same way;
 *  • animate `--kb-inset` → 0 and `--app-vh` → innerHeight with an eased rAF
 *    interpolation (see startDismissalAnimation) so the bar descends smoothly
 *    in sync with the departing keyboard instead of teleporting.
 *
 * Scrolling inside the focused editor is excluded — iOS keeps the keyboard
 * there.
 */
function handleGestureScroll(e: Event) {
  if (!state.isOpen || !state.isTouch || !currentIsIOS()) return;
  // A gesture that started on a locked composer bar must neither dismiss the
  // keyboard nor scroll the page — the bar is pinned above the keyboard and
  // cannot be dragged.
  if (lockedGestureActive) return;
  // A gesture that started on a [data-kb-keep] surface (the messenger chat)
  // must keep the keyboard: scrolling the history is content browsing, not a
  // tap-outside. Wheel events have no touchstart, so the target is checked
  // directly here too.
  if (stickyScrollActive || isStickyGestureTarget(e.target)) return;
  // One dismissal per gesture — later touchmoves during the same scroll must
  // not restart the descent animation or re-blur (would jitter).
  if (dismissalActive) return;
  if (focusedEditable && e.target instanceof Node && focusedEditable.contains(e.target)) return;

  // A touch that has not yet exceeded the iOS touch slop is a tap, not a
  // scroll — never dismiss on sub-slop jitter (a slightly-off tap must not
  // kill the keyboard while the user is about to type). Wheel events are
  // always real scrolling intent.
  if (e.type === "touchmove") {
    const touch = (e as TouchEvent).touches?.[0];
    if (
      !touch ||
      !isBeyondTouchSlop({
        startX: gestureStart?.x ?? null,
        startY: gestureStart?.y ?? null,
        currentX: touch.clientX,
        currentY: touch.clientY,
        slopPx: TOUCH_SLOP_PX,
      })
    ) {
      return;
    }
  }

  dismissalActive = true;
  dismissUntil = Date.now() + GESTURE_SUPPRESS_MS;
  // Scroll = tap outside: drop focus so focus-to-expand composers collapse via
  // their own existing onBlur animation (no new collapse code needed), and the
  // keyboard dismisses exactly like it does for a real outside tap.
  focusedEditable?.blur();
  startDismissalAnimation();
  scheduleDismissProbe();
}

/**
 * Records where the current touch began so handleGestureScroll can tell a
 * real scroll from sub-slop tap jitter — and pins the document BEFORE the
 * native focus-pan for taps on composer bars.
 *
 * iOS pans the document when the keyboard opens after focusing an input in a
 * fixed bar, even when the app already positioned the bar above the keyboard.
 * The focusin handler pins the document, but that races the pan and sometimes
 * loses — the content then visibly flies down and back up, and the bar wiggles
 * as visualViewport.offsetTop corrupts the --kb-inset formula mid-pan. A tap
 * on a [data-kb-pin] bar (wall dock, messenger composer, thread composer) is
 * about to focus its editor, so pinning HERE — inside the gesture, before
 * focus even fires — makes the document unpannable before iOS can start:
 * nothing to race, the slide-in is always smooth.
 */
function handleTouchStart(e: TouchEvent) {
  const touch = e.touches?.[0];
  if (!touch) return;
  gestureStart = { x: touch.clientX, y: touch.clientY };
  const target = e.target;
  const inBar = state.isTouch && isComposerBarTarget(target);

  // A real user touch while the document is pinned (composer-bar focus)
  // releases the pin UNLESS it lands on the composer bar itself (the focused
  // editor — caret drag, tap to reposition — or the bar around it, which is
  // about to re-focus): the pan the pin prevents only ever happens at the
  // moment of focus, so after that a touch is the user browsing — the page
  // must not feel frozen, and the normal scroll-to-dismiss flow takes over.
  // A later re-focus re-pins (focusin, or the touchstart pin just below).
  if (scrollLock && !inBar) {
    const onEditor = focusedEditable && target instanceof Node && focusedEditable.contains(target);
    if (!onEditor) unlockDocumentScroll();
  }
  // Pin BEFORE the native focus-pan (see the comment above).
  if (inBar) lockDocumentScroll();

  // Pinned composer bars carry [data-kb-locked]; a scroll that begins on one
  // must not move the page (the bar is fixed and can't be dragged along).
  lockedGestureActive = state.isTouch && isLockedGestureTarget(e.target);
  // The messenger chat surface carries [data-kb-keep]; scrolls that begin on
  // it keep the keyboard up (see handleGestureScroll).
  stickyScrollActive = state.isTouch && isStickyGestureTarget(e.target);
}

function handleTouchEnd() {
  gestureStart = null;
  lockedGestureActive = false;
  stickyScrollActive = false;
}

/**
 * Cancels scrolls that begin on a pinned composer bar ([data-kb-locked]).
 * Without this, iOS scroll-to-dismiss would slide the keyboard away (and our
 * dismiss handler would unpin the composer) the moment the user drags from
 * the composer, leaving the bar floating mid-list.
 *
 * The lock flag is lazily re-checked against the live target: the pin can
 * land between the document-level touchstart (where lockedGestureActive is
 * computed) and the first touchmove — e.g. a tap-and-drag that pins the
 * composer synchronously in its own (bubble-phase) touchstart handler. The
 * document-level touchstart runs first (capture), before the composer's
 * handler, so on the very first touchmove the flag may still be false even
 * though the bar is now locked — checking the target here catches that.
 */
function handleLockedTouchMove(e: TouchEvent) {
  if (!lockedGestureActive) {
    lockedGestureActive = state.isTouch && isLockedGestureTarget(e.target);
  }
  if (lockedGestureActive) e.preventDefault();
}

/**
 * Smoothly lowers the bars: animates `--kb-inset` from its current value to 0
 * and `--app-vh` from the shrunk viewport height to `innerHeight` (which on
 * iOS is always the full layout-viewport height, so it is live and correct
 * here) over ~280ms with easeOutCubic. The composer's own 300ms onBlur
 * collapse (triggered above) runs in parallel — the two animations compose
 * into one natural descent, like a native app.
 */
function startDismissalAnimation() {
  const startInset = state.keyboardInset;
  const startViewportHeight = state.viewportHeight;
  const endViewportHeight = typeof window === "undefined" ? startViewportHeight : window.innerHeight;
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();

  const step = (now: number) => {
    const progress = Math.min(1, (now - startedAt) / DISMISS_DURATION_MS);
    const frame = computeDismissalFrame({
      startInset,
      startViewportHeight,
      endViewportHeight,
      progress,
    });
    if (typeof document !== "undefined") {
      const root = document.documentElement;
      root.style.setProperty("--kb-inset", `${frame.keyboardInset}px`);
      root.style.setProperty("--app-vh", `${frame.viewportHeight}px`);
    }
    if (progress < 1) {
      dismissAnimFrame = requestAnimationFrame(step);
    } else {
      dismissAnimFrame = null;
      // Commit the final state so listeners/kb-open sync up exactly when the
      // animation ends — the CSS vars already hold the final values. Guarded
      // on dismissalActive: if the probe already decided the keyboard stayed
      // up (and re-opened), or the user re-focused mid-slide, the commit must
      // not stomp that newer open state.
      if (dismissalActive) {
        applyState({ ...state, isOpen: false, keyboardInset: 0, viewportHeight: endViewportHeight });
      }
    }
  };

  if (dismissAnimFrame !== null) cancelAnimationFrame(dismissAnimFrame);
  dismissAnimFrame = requestAnimationFrame(step);
}

/**
 * The keyboard-open animation can end with ONE transient resize event that
 * reports the pre-keyboard geometry (WebKit quirk), committing a false close
 * while the keyboard is still up. Re-measure shortly after every committed
 * close and re-open if the keyboard is actually still there, so bottom-
 * anchored bars never stay stuck under the keyboard.
 */
function scheduleCloseVerify() {
  if (closeVerifyTimer) clearTimeout(closeVerifyTimer);
  closeVerifyTimer = setTimeout(() => {
    closeVerifyTimer = null;
    if (dismissalActive) return;
    const again = computeRaw();
    if (again.isOpen && !state.isOpen) applyState(again);
  }, CLOSE_VERIFY_MS);
}

/**
 * iOS can open the soft keyboard without firing ANY visual-viewport events
 * (notably on re-focus after a prior dismissal), so the resize-driven state
 * machine would never notice and bottom-anchored bars would sit under the
 * keyboard. visualViewport.height is a LIVE property, so a light poll while
 * an editable is focused detects the keyboard exactly. The poll only ever
 * OPENS the state — it never closes it (a real dismissal still goes through
 * the resize/debounce paths).
 */
function scheduleFocusPoll() {
  if (focusPollTimer) clearTimeout(focusPollTimer);
  focusPollTimer = setTimeout(() => {
    focusPollTimer = null;
    if (!focusedEditable || !focusedEditable.isConnected || dismissalActive) return;
    const again = computeRaw();
    if (again.isOpen && !state.isOpen) applyState(again);
    scheduleFocusPoll();
  }, FOCUS_POLL_MS);
}

/**
 * Schedules the post-scroll probe. It only fires once the scroll has truly
 * ended (no touchmove/wheel/visualViewport events for a while), so the visual
 * viewport values are live again and the decision is reliable:
 *  • delta still >= threshold → the keyboard actually stayed up → re-open.
 *  • delta < threshold → the keyboard dismissed and the deferred resize (or
 *    our dropped state) already reflects it → stay closed.
 */
function scheduleDismissProbe() {
  if (dismissProbeTimer) clearTimeout(dismissProbeTimer);
  dismissProbeTimer = setTimeout(() => {
    dismissProbeTimer = null;
    if (Date.now() < dismissUntil) {
      // Still inside the suppression window (more events arrived while the
      // timer was pending) — stay in dismissal mode; a stale "open" resize
      // must not re-open the state mid-slide.
      dismissalActive = true;
      return;
    }
    dismissalActive = false;
    // Stop the descent animation either way: it may still be mid-flight, and a
    // later frame would overwrite the vars with intermediate values (or its
    // guarded final commit would be skipped, leaving the state stale).
    if (dismissAnimFrame !== null) {
      cancelAnimationFrame(dismissAnimFrame);
      dismissAnimFrame = null;
    }
    // Re-sync with the live geometry. computeRaw() reads the real visual
    // viewport, so it decides the outcome itself: keyboard still covering the
    // screen → open state restored; keyboard gone → closed state applied
    // deterministically (values match the animation's end state: inset 0,
    // vh = innerHeight — no flash), instead of relying on the deferred resize
    // to self-heal in case the animation's own final commit was skipped.
    applyState(computeRaw());
  }, GESTURE_SUPPRESS_MS + 80);
}

/** While any scroll correction is pending, the user must be able to take over:
 *  the first scroll/touch (capture phase, any element) cancels every pending
 *  correction so we never yank them back to the input mid-list. */
function armUserInterrupt() {
  if (cancelUserInterrupt) return;
  const onUserScroll = () => clearPendingScrolls();
  window.addEventListener("scroll", onUserScroll, { passive: true, capture: true });
  window.addEventListener("touchstart", onUserScroll, { passive: true, capture: true });
  cancelUserInterrupt = () => {
    window.removeEventListener("scroll", onUserScroll, { capture: true });
    window.removeEventListener("touchstart", onUserScroll, { capture: true });
    cancelUserInterrupt = null;
  };
}

function clearPendingScrolls() {
  for (const timer of pendingScrollTimers) clearTimeout(timer);
  pendingScrollTimers.clear();
  cancelUserInterrupt?.();
}

/**
 * iOS pans the document when an input inside a fixed/sticky composer bar is
 * focused — the keyboard slides in and Safari scrolls the page to "reveal"
 * the input, even though the bar is already positioned above the keyboard by
 * the app. The pan moves every fixed element with it (and corrupts
 * visualViewport.offsetTop, which --kb-inset subtracts), so the bar and the
 * content visibly jump down then up. Undoing the pan with scroll-restores
 * only turns it into a fight — the pan wins the race on real devices.
 *
 * Instead, pin the document while the bar's editor is focused: the body is
 * taken out of scroll flow (position:fixed + top: -scrollY + overflow:hidden
 * on html/body), so Safari has nothing to pan — the same canonical technique
 * this app already uses for the avatar gallery modal (see AvatarGallery.tsx),
 * where iOS otherwise shifts the whole page when a modal input is focused.
 * The visual position is preserved (top: -scrollY) and internal scrollers
 * (message list, overlay container) are unaffected. Releasing the lock is
 * safe — the pan only ever happens at the moment of focus, and the saved
 * scroll position is restored.
 */
/**
 * Applies or removes the body pin based on the two contributions
 * (surfacePinActive || keyboardPinActive). Safe to call anytime — no-ops when
 * the state already matches.
 */
function syncScrollLock() {
  const shouldPin = surfacePinActive || keyboardPinActive;
  if (shouldPin && !scrollLock) applyScrollLock();
  else if (!shouldPin && scrollLock) releaseScrollLock();
}

/**
 * iOS pans the document when an input inside a fixed/sticky composer bar is
 * focused — the keyboard slides in and Safari scrolls the page to "reveal"
 * the input, even though the bar is already positioned above the keyboard by
 * the app. The pan moves every fixed element with it (and corrupts
 * visualViewport.offsetTop, which --kb-inset subtracts), so the bar and the
 * content visibly jump down then up. Undoing the pan with scroll-restores
 * only turns it into a fight — the pan wins the race on real devices.
 *
 * Instead, pin the document while the pin is needed: the body is taken out of
 * scroll flow (position:fixed + top: -scrollY + overflow:hidden on html/body),
 * so Safari has nothing to pan — the same canonical technique this app already
 * uses for the avatar gallery modal (see AvatarGallery.tsx), where iOS
 * otherwise shifts the whole page when a modal input is focused. The visual
 * position is preserved (top: -scrollY) and internal scrollers (message list,
 * overlay container) are unaffected. Releasing is safe — the pan only ever
 * happens at the moment of focus, and the saved scroll position is restored.
 */
function applyScrollLock() {
  if (scrollLock || typeof document === "undefined") return;
  const root = document.documentElement;
  const body = document.body;
  scrollLock = {
    rootOverflow: root.style.overflow,
    bodyOverflow: body.style.overflow,
    bodyPosition: body.style.position,
    bodyTop: body.style.top,
    bodyWidth: body.style.width,
    scrollY: typeof window === "undefined" ? 0 : window.scrollY,
  };
  root.style.overflow = "hidden";
  body.style.overflow = "hidden";
  body.style.position = "fixed";
  body.style.top = `-${scrollLock.scrollY}px`;
  body.style.width = "100%";
}

function releaseScrollLock() {
  if (!scrollLock) return;
  const root = document.documentElement;
  const body = document.body;
  root.style.overflow = scrollLock.rootOverflow;
  body.style.overflow = scrollLock.bodyOverflow;
  body.style.position = scrollLock.bodyPosition;
  body.style.top = scrollLock.bodyTop;
  body.style.width = scrollLock.bodyWidth;
  const scrollY = scrollLock.scrollY;
  scrollLock = null;
  if (typeof window !== "undefined" && window.scrollY !== scrollY) {
    window.scrollTo(0, scrollY);
  }
}

/** Keyboard-pin contribution: while an editable in a composer bar is focused
 *  (or a touch on a bar is about to focus it). Released on blur / touch
 *  outside the bar / keyboard close — see unlockDocumentScroll. */
function lockDocumentScroll() {
  keyboardPinActive = true;
  syncScrollLock();
}

function unlockDocumentScroll() {
  keyboardPinActive = false;
  syncScrollLock();
}

function scheduleScrollIntoView(delay: number) {
  // Progressive alignment during the ~250ms keyboard animation: keep a few
  // passes, all cancelled the moment the user starts scrolling or touching.
  armUserInterrupt();
  const timer = setTimeout(() => {
    pendingScrollTimers.delete(timer);
    if (pendingScrollTimers.size === 0) cancelUserInterrupt?.();
    scrollEditableIntoView();
  }, delay);
  pendingScrollTimers.add(timer);
}

/**
 * Positions the focused editable so its bottom edge sits SCROLL_GAP_PX above
 * the keyboard top, using visual-viewport math. Overrides the browser's own
 * focus-scrolling (which misbehaves on Firefox Android / Safari with sticky
 * or fixed composer bars). No-op on desktop.
 */
export function scrollEditableIntoView() {
  const el = focusedEditable;
  if (!el || !el.isConnected || !state.isTouch) return;
  // Only steer the page for the element that actually owns focus. focusedEditable
  // is kept across blur on purpose (the keyboard still animates closed), but a
  // late resize/timer must never yank the page back to an editor the user has
  // already left (e.g. they tapped a Reply button on a comment).
  const active = document.activeElement;
  if (active !== el && !(active instanceof Node && el.contains(active))) return;

  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  const visibleHeight = vv ? vv.height : window.innerHeight;
  const rect = el.getBoundingClientRect();
  const isFullyVisible = rect.top >= 0 && rect.bottom <= visibleHeight - SCROLL_GAP_PX;

  const context = getScrollContext(el);

  if (context.mode === "fixed") {
    // The bar is already positioned above the keyboard by the app, and the
    // document scroll is locked while the editor is focused (see
    // lockDocumentScroll) — there is nothing to scroll here.
    return;
  }

  if (isFullyVisible) return;

  if (context.mode === "container" && context.scroller) {
    const scroller = context.scroller;
    const scrollerRect = scroller.getBoundingClientRect();
    scroller.scrollTop += computeContainerScrollDelta({
      elementRectTop: rect.top,
      elementRectBottom: rect.bottom,
      scrollerRectTop: scrollerRect.top,
      scrollerRectBottom: scrollerRect.bottom,
      visibleHeight,
    });
    return;
  }

  // Document flow: scroll the page so the element is visible above the
  // keyboard. Instant (auto), never smooth — the keyboard animation is
  // already moving the layout; a second animation would jitter.
  const scrollingElement = document.scrollingElement || document.documentElement;
  scrollingElement.scrollTop += computeWindowScrollDelta({
    elementRectTop: rect.top,
    elementRectBottom: rect.bottom,
    visibleHeight,
  });
}
