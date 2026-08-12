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
 *    `window.innerHeight − visualViewport.height` (this formula is exact on
 *    every platform, regardless of `interactive-widget` mode or URL-bar
 *    state).
 *  • Publishes CSS variables on <html> so the whole app can react:
 *      --app-vh   — visual viewport height in px. Use instead of `100dvh`
 *                   for full-screen surfaces (messenger page, chat panel…).
 *      --kb-inset — keyboard height in px. Add to `bottom` of fixed/sticky
 *                   bars so they float exactly above the keyboard on iOS.
 *    plus a `kb-open` class on <html>.
 *  • Keeps the focused editable element visible inside the *visual* viewport
 *    (12px above the keyboard) with exact math, overriding the browser's own
 *    buggy focus-scrolling, and cancels Safari's document pan when typing
 *    inside the full-screen messenger.
 *  • iOS scroll-to-dismiss behaves exactly like tapping outside the composer:
 *    the focused input is blurred (so focus-to-expand composers collapse via
 *    their own onBlur animation) and the fixed/sticky bars descend smoothly
 *    (eased rAF interpolation of the CSS vars) instead of teleporting.
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
let gestureStart: { x: number; y: number } | null = null;
let dismissAnimFrame: number | null = null;
// True while the current touch began on a `[data-kb-locked]` element (a
// pinned composer bar). Such gestures must never scroll the page or dismiss
// the keyboard — the bar is position:fixed and cannot be dragged.
let lockedGestureActive = false;

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
    if (dismissAnimFrame !== null) cancelAnimationFrame(dismissAnimFrame);
    dismissAnimFrame = null;
    gestureStart = null;
    lockedGestureActive = false;
    dismissUntil = 0;
    dismissalActive = false;
    focusedEditable = null;
  };
}

// ── Pure helpers (exported for tests) ───────────────────────────────────────

export function computeKeyboardMetrics(input: {
  innerHeight: number;
  visualViewportHeight: number | null;
  isTouch: boolean;
}): Pick<MobileKeyboardState, "isOpen" | "keyboardInset" | "viewportHeight"> {
  const { innerHeight, visualViewportHeight, isTouch } = input;
  if (visualViewportHeight === null) {
    return { isOpen: false, keyboardInset: 0, viewportHeight: innerHeight };
  }
  const delta = innerHeight - visualViewportHeight;
  const isOpen = isTouch && delta >= OPEN_THRESHOLD_PX;
  return {
    isOpen,
    // Below the threshold the delta is URL-bar noise, not a keyboard — keep
    // the CSS inset 0 so fixed bars don't jump for nothing.
    keyboardInset: isOpen ? Math.round(delta) : 0,
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

function computeRaw(): MobileKeyboardState {
  const isTouch =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(TOUCH_QUERY).matches;
  const innerHeight = typeof window === "undefined" ? 0 : window.innerHeight;
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  return {
    isTouch,
    ...computeKeyboardMetrics({
      innerHeight,
      visualViewportHeight: vv ? vv.height : null,
      isTouch,
    }),
  };
}

function applyState(next: MobileKeyboardState) {
  const changed =
    next.isOpen !== state.isOpen ||
    next.keyboardInset !== state.keyboardInset ||
    next.viewportHeight !== state.viewportHeight ||
    next.isTouch !== state.isTouch;
  state = next;

  if (typeof document !== "undefined") {
    const root = document.documentElement;
    root.style.setProperty("--app-vh", `${next.viewportHeight}px`);
    root.style.setProperty("--kb-inset", `${next.keyboardInset}px`);
    root.classList.toggle("kb-open", next.isOpen);
  }

  if (!changed) return;
  for (const listener of listeners) listener();
  if (next.isOpen) {
    // The keyboard slides in over ~250ms; re-align the focused input a few
    // times so it lands exactly above the keyboard when the animation ends.
    scheduleScrollIntoView(0);
    scheduleScrollIntoView(120);
    scheduleScrollIntoView(300);
    scheduleScrollIntoView(600);
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
    applyState(next);
  } else if (state.isOpen) {
    const delta = currentVisualDelta();
    if (delta < CLOSE_IMMEDIATE_THRESHOLD_PX) {
      // Keyboard fully gone — close right away so full-screen surfaces expand
      // in sync with the collapse instead of lagging a debounce window.
      applyState(next);
    } else {
      // Still mid-transition (delta 24–60): hold the open state for a beat.
      if (closeDebounceTimer) clearTimeout(closeDebounceTimer);
      closeDebounceTimer = setTimeout(() => {
        closeDebounceTimer = null;
        const again = computeRaw();
        if (!again.isOpen) applyState(again);
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
  scheduleScrollIntoView(0);
  if (state.isOpen) {
    scheduleScrollIntoView(80);
    scheduleScrollIntoView(250);
  }
}

function handleFocusOut() {
  // Keep `focusedEditable` — the scroll keeper still targets it while the
  // keyboard is animating closed. Just cancel pending scrolls.
  clearPendingScrolls();
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
 * real scroll from sub-slop tap jitter.
 */
function handleTouchStart(e: TouchEvent) {
  const touch = e.touches?.[0];
  if (!touch) return;
  gestureStart = { x: touch.clientX, y: touch.clientY };
  // Pinned composer bars carry [data-kb-locked]; a scroll that begins on one
  // must not move the page (the bar is fixed and can't be dragged along).
  lockedGestureActive = state.isTouch && isLockedGestureTarget(e.target);
}

function handleTouchEnd() {
  gestureStart = null;
  lockedGestureActive = false;
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
    // The full-screen messenger shell sizes itself to the visible area via
    // --app-vh; cancel the document pan Safari performs when focusing an
    // input inside it. For floating fixed bars (thread composer) iOS manages
    // them itself — resetting the page scroll there would yank the reader to
    // the top, so we never touch it.
    if (el.closest("[data-kb-app]") && window.scrollY !== 0) window.scrollTo(0, 0);
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
