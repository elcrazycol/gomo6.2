/**
 * Global mobile virtual-keyboard handling (iOS Safari / Android Chrome /
 * Android Firefox / tablets), built on the native Visual Viewport API — the
 * de-facto standard solution (no third-party library needed; all target
 * browsers expose `window.visualViewport`).
 *
 * Philosophy: COOPERATE with the browser instead of fighting it.
 * ────────────────────────────────────────────────────────────────────────────
 *  • iOS Safari never resizes the *layout* viewport when the software
 *    keyboard opens — the keyboard simply covers the bottom of the screen.
 *    `100dvh`/`100svh` keep their values, so fixed-height app surfaces and
 *    `position: fixed/sticky; bottom: X` bars end up hidden *under* the
 *    keyboard. There is NO document pin (no body position:fixed), no gesture
 *    interception, no easing state machines — full-screen surfaces are CSS
 *    boxes sized by `--app-vh` with their own internal scrollers, and
 *    bottom-anchored bars ride `--kb-inset` live, every frame, exactly like
 *    the keyboard itself (the Twitter/X model).
 *  • Chrome/Firefox Android resize the layout viewport only with
 *    `interactive-widget=resizes-content` (now enabled in index.html); older
 *    builds keep the old `resizes-visual` behavior.
 *  • The composer's own focus is native (with preventScroll forced via the
 *    editor's dom.focus patch — Tiptap otherwise calls a bare view.dom.focus()
 *    on iOS). No tap interception, no caret re-settling timers.
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
 *  • A short per-frame follow reads the LIVE visual viewport while the
 *    keyboard is animating (its resize events are choppy — a handful of
 *    steps, not one per frame) and glides `--kb-inset` / `--app-vh` with it
 *    in one continuous motion. No interpolation, no easing: the vars are the
 *    live viewport. The follow also detects keyboards that open WITHOUT any
 *    events (a known iOS quirk) while an editable is focused.
 *  • iOS scroll-to-dismiss behaves exactly like tapping outside the composer:
 *    the focused input is blurred (so focus-to-expand composers collapse via
 *    their own onBlur animation) and the fixed/sticky bars descend smoothly
 *    (an eased rAF interpolation of the CSS vars — the keyboard's own slide
 *    takes ~250ms, and WebKit reports STALE open geometry until the whole
 *    gesture, including momentum, ends). Surfaces marked [data-kb-keep] (the
 *    messenger chat) opt out: scrolling them keeps the keyboard up — only a
 *    real outside tap dismisses.
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
/** How long the per-frame geometry follow keeps running after the last
 *  visual-viewport event / focus — comfortably longer than the ~250ms
 *  keyboard slide (plus URL-bar collapse), so the layout keeps gliding with
 *  the keyboard for the whole animation, and a keyboard that opens without
 *  ANY events is detected while the editable is focused. */
const FOLLOW_MS = 600;
/** While the per-frame follow is tracking the keyboard, cap how much the
 *  inset may GROW per frame. The keyboard rises ~20px/frame at 60fps; a
 *  one-frame spike — the URL-bar/visualViewport desync at the end of the
 *  slide-in, or a keyboard overshoot — is 50-90px and made the composer jump
 *  UP for a millisecond before settling back. Capping growth spreads the
 *  spike over 1-2 frames (invisible) while the real motion passes untouched.
 *  Shrink is never capped: the closing side drops freely (scroll-to-dismiss
 *  animates it anyway), so the composer never lags a departing keyboard. */
const MAX_KB_GROWTH_PER_FRAME = 40;

const listeners = new Set<Listener>();
let initialized = false;
let state: MobileKeyboardState = {
  isOpen: false,
  keyboardInset: 0,
  viewportHeight: typeof window === "undefined" ? 0 : window.innerHeight,
  isTouch: false,
};
let focusedEditable: HTMLElement | null = null;
let dismissUntil = 0;
let dismissalActive = false;
let dismissProbeTimer: ReturnType<typeof setTimeout> | null = null;
// Per-frame geometry follow (see startGeometryFollow).
let followRaf: number | null = null;
let followUntil = 0;
let gestureStart: { x: number; y: number } | null = null;
let dismissAnimFrame: number | null = null;
// True while the per-frame geometry follow loop is running. While set, the
// inset-growth clamp in commitState is active (see MAX_KB_GROWTH_PER_FRAME).
let followActive = false;
// The last inset actually written. The follow's growth clamp measures
// against it; fresh runs reset it to +∞ so the first write catches up to the
// real geometry before capping kicks in.
let lastCommittedInset = 0;
// True while the current touch began on a `[data-kb-keep]` element (the
// messenger chat surface). Scrolling such a surface is content browsing, not
// a dismissal gesture — the keyboard must stay up, exactly like when the
// emoji swap panel is open (there the editor is blurred, so no dismissal can
// fire; the open keyboard must match that stability).
let stickyScrollActive = false;

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
  // Track the finger's origin so sub-slop jitter is never treated as a scroll,
  // and which surface the gesture began on ([data-kb-keep] keeps the keyboard).
  document.addEventListener("touchstart", handleTouchStart, { passive: true, capture: true });
  document.addEventListener("touchend", handleTouchEnd, { passive: true, capture: true });
  document.addEventListener("touchcancel", handleTouchEnd, { passive: true, capture: true });

  // Seed the CSS variables immediately so full-screen surfaces are sized
  // correctly before the first user interaction.
  applyState(computeRaw());

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
    document.removeEventListener("touchstart", handleTouchStart, { capture: true });
    document.removeEventListener("touchend", handleTouchEnd, { capture: true });
    document.removeEventListener("touchcancel", handleTouchEnd, { capture: true });
    if (dismissProbeTimer) clearTimeout(dismissProbeTimer);
    dismissProbeTimer = null;
    if (followRaf !== null) cancelAnimationFrame(followRaf);
    followRaf = null;
    if (dismissAnimFrame !== null) cancelAnimationFrame(dismissAnimFrame);
    dismissAnimFrame = null;
    gestureStart = null;
    stickyScrollActive = false;
    dismissUntil = 0;
    dismissalActive = false;
    followActive = false;
    focusedEditable = null;
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
 * Writes a new state: CSS vars + kb-open class + listener notification.
 * Does NOT (re)start the follow — the caller decides that (applyState does,
 * the follow loop itself must not re-arm itself through here).
 */
function commitState(next: MobileKeyboardState) {
  let keyboardInset = next.keyboardInset;
  // While the per-frame follow is actively tracking the keyboard, consecutive
  // writes are ≤1 frame apart and the keyboard cannot physically rise faster
  // than ~20-40px/frame. Capping inset GROWTH kills the one-frame spikes —
  // the URL-bar/visualViewport desync at the end of the slide-in, or a
  // keyboard overshoot — that made the composer jump UP for a millisecond and
  // settle back. Shrink is never capped: the closing side drops freely (and
  // scroll-to-dismiss animates it), so the composer never lags a departing
  // keyboard. lastCommittedInset is +∞ after a fresh follow start, so the
  // first write catches up to reality instead of being falsely clamped.
  if (followActive && next.isOpen) {
    keyboardInset = Math.min(keyboardInset, lastCommittedInset + MAX_KB_GROWTH_PER_FRAME);
  }
  lastCommittedInset = keyboardInset;
  const changed =
    next.isOpen !== state.isOpen ||
    keyboardInset !== state.keyboardInset ||
    next.viewportHeight !== state.viewportHeight ||
    next.isTouch !== state.isTouch;
  state = { ...next, keyboardInset };
  writeGeometryVars({ ...next, keyboardInset });
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("kb-open", next.isOpen);
  }
  if (changed) {
    for (const listener of listeners) listener();
  }
}

function applyState(next: MobileKeyboardState) {
  commitState(next);
  startGeometryFollow();
}

/**
 * While the soft keyboard animates, its visual-viewport resize events are
 * choppy (a handful of steps, not one per frame) — following them directly
 * makes bottom-anchored bars jerk step-by-step while the keyboard itself
 * slides smoothly. visualViewport.height is a LIVE property, so this short
 * per-frame follow after any geometry event / focus reads the keyboard's
 * true position every frame and glides the layout with it in one continuous
 * motion — the vars ARE the live viewport, no interpolation. The follow also
 * detects keyboards that open WITHOUT any visual-viewport events (a known
 * iOS quirk) while an editable is focused.
 *
 * The loop keeps running while the keyboard is open (each committed frame
 * refreshes followUntil), so it survives the whole typing session.
 */
function startGeometryFollow() {
  followUntil = Date.now() + FOLLOW_MS;
  if (followRaf !== null) return;
  // Fresh run: no clamp baseline yet — the first write must catch up to the
  // real geometry (e.g. a keyboard already open) before growth capping kicks
  // in on subsequent frames.
  lastCommittedInset = Number.POSITIVE_INFINITY;
  followActive = true;
  const step = () => {
    followRaf = null;
    // Scroll-to-dismiss in progress: WebKit reports the old keyboard-open
    // geometry until the gesture fully ends, so the LIVE values are stale —
    // the dismissal animation owns the vars; just keep the loop alive for the
    // post-gesture probe.
    if (dismissalActive) {
      if (Date.now() < followUntil || state.isOpen) {
        followRaf = requestAnimationFrame(step);
      } else {
        followActive = false;
      }
      return;
    }
    commitState(computeRaw());
    if (Date.now() < followUntil || state.isOpen) {
      followRaf = requestAnimationFrame(step);
    } else {
      followActive = false;
    }
  };
  followRaf = requestAnimationFrame(step);
}

function handleMetricsChanged() {
  if (dismissalActive) {
    // Scroll-to-dismiss in progress: every event postpones the probe; the
    // dismissal animation already owns the vars and the dropped final state
    // (isOpen:false, inset:0, --app-vh: innerHeight) is correct on iOS.
    dismissUntil = Date.now() + GESTURE_SUPPRESS_MS;
    scheduleDismissProbe();
    return;
  }
  applyState(computeRaw());
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
  // The follow starts gliding the layout with the LIVE viewport the moment
  // focus lands — and detects a keyboard that opens without events.
  startGeometryFollow();
}

function handleFocusOut() {
  // Nothing to tear down: the per-frame follow keeps running while the
  // keyboard is up and reads the LIVE viewport as it slides away, then stops
  // once it is closed. `focusedEditable` is kept — scroll-to-dismiss blurs it
  // and excludes scrolls inside the editor.
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
 * real scroll from sub-slop tap jitter — and which surface it began on
 * ([data-kb-keep] surfaces keep the keyboard while scrolling).
 */
function handleTouchStart(e: TouchEvent) {
  const touch = e.touches?.[0];
  if (!touch) return;
  gestureStart = { x: touch.clientX, y: touch.clientY };
  stickyScrollActive = state.isTouch && isStickyGestureTarget(e.target);
}

function handleTouchEnd() {
  gestureStart = null;
  stickyScrollActive = false;
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
 *  • delta < threshold → the keyboard dismissed and the dropped state (or
 *    the deferred resize) already reflects it → stay closed.
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
