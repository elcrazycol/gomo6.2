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
  document.addEventListener("touchmove", handleGestureScroll, { passive: true, capture: true });
  document.addEventListener("wheel", handleGestureScroll, { passive: true, capture: true });

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
    document.removeEventListener("touchmove", handleGestureScroll, { capture: true });
    document.removeEventListener("wheel", handleGestureScroll, { capture: true });
    clearPendingScrolls();
    if (closeDebounceTimer) clearTimeout(closeDebounceTimer);
    closeDebounceTimer = null;
    if (dismissProbeTimer) clearTimeout(dismissProbeTimer);
    dismissProbeTimer = null;
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
  // Fresh focus re-arms keyboard detection: cancel any pending dismissal.
  dismissalActive = false;
  if (dismissProbeTimer) {
    clearTimeout(dismissProbeTimer);
    dismissProbeTimer = null;
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
 * Instead we react to the gesture itself: drop `--kb-inset` (and restore
 * `--app-vh` to innerHeight — on iOS the layout-viewport height is always the
 * full screen, so it is live and correct here) so composers follow the
 * keyboard down like in a native app. Scrolling inside the focused editor is
 * excluded — iOS keeps the keyboard for that.
 */
function handleGestureScroll(e: Event) {
  if (!state.isOpen || !state.isTouch || !currentIsIOS()) return;
  if (focusedEditable && e.target instanceof Node && focusedEditable.contains(e.target)) return;

  dismissalActive = true;
  dismissUntil = Date.now() + GESTURE_SUPPRESS_MS;
  applyState({ ...state, isOpen: false, keyboardInset: 0, viewportHeight: window.innerHeight });
  scheduleDismissProbe();
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
    dismissalActive = false;
    if (Date.now() < dismissUntil) return;
    if (currentVisualDelta() >= OPEN_THRESHOLD_PX) applyState(computeRaw());
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
