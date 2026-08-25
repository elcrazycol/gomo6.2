import { useEffect, useRef, useState } from "react";
import { animate, useMotionValue } from "framer-motion";

// ─── Swipe-right-to-go-back (mobile chat → conversation list) ──────────────
// The chat panel follows the finger horizontally, revealing the conversation
// list beneath it. Same gesture vocabulary as swipe-to-reply:
//   • ±40° cone — diagonal thumb paths are accepted from the very first px;
//   • a dead zone (SWIPE_BACK_ARM_PX) — sub-slop jitter on the screen never
//     moves the panel, so ordinary vertical list scrolling stays untouched;
//   • rightward-only — leftward drags fall through to the reply swipe on
//     message rows (which is leftward-only itself, so the two never contend).
// Once committed, every touchmove is preventDefault'ed (the browser cannot
// steal the gesture as a scroll).
// On release: past 32% of the viewport width or a fast flick glides the panel
// fully off and calls onBack; anything less springs back. framer-motion drives
// both the snap-back and the exit-off animation — the same overlay-drag
// technique as WallPost.

const SWIPE_BACK_ARM_PX = 16; // rightward travel before the panel starts moving
const SWIPE_BACK_ANGLE_TAN = Math.tan((40 * Math.PI) / 180);
const SWIPE_BACK_EXIT_FRACTION = 0.32; // of the viewport width
const SWIPE_BACK_EXIT_SPEED = 0.55; // px/ms — a deliberate flick exits even short
const CHAT_PANEL_BREAKPOINT_PX = 980; // the messenger's mobile breakpoint

/** The chat panel starts off-screen on touch devices until a chat is opened;
 *  on desktop it is a plain grid column at x = 0. Computed synchronously so
 *  the very first paint is right (an async matchMedia would flash the panel). */
function getInitialPanelX() {
  if (typeof window === "undefined") return 0;
  return window.matchMedia(`(max-width: ${CHAT_PANEL_BREAKPOINT_PX}px)`).matches
    ? window.innerWidth
    : 0;
}

export function useSwipeBackToClose(options: { enabled: boolean; onBack: () => void }) {
  const { enabled, onBack } = options;
  const x = useMotionValue(getInitialPanelX());
  const panelRef = useRef<HTMLElement | null>(null);
  const [isBackDragging, setIsBackDragging] = useState(false);

  // Live mirrors so the native listeners never race a stale closure (the
  // enabled flag can flip mid-session as the soft keyboard opens/closes).
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;

    let anchor: { x: number; y: number } | null = null;
    let dragging = false;
    let prevX = 0;
    let prevT = 0;
    let lastX = 0;
    let lastT = 0;

    const onTouchStart = (e: TouchEvent) => {
      // The press-and-hold message panel owns the screen while it is open —
      // taps and drags belong to it, not to the peek-back gesture.
      if (el.classList.contains("has-message-menu")) return;
      // Only a single-finger, enabled (mobile + keyboard closed) gesture.
      if (!enabledRef.current || e.touches.length > 1) return;
      const t = e.touches[0];
      anchor = { x: t.clientX, y: t.clientY };
      dragging = false;
      prevX = lastX = 0;
      prevT = lastT = 0;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!anchor) return;
      const t = e.touches[0];
      const dx = t.clientX - anchor.x;
      const dy = t.clientY - anchor.y;

      if (!dragging) {
        // Dead zone: leave sub-slop movement to the browser (list scrolling).
        if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_BACK_ARM_PX) return;
        // Commit only to a rightward swipe inside the ±40° cone. Vertical
        // scrolls and leftward swipes (the reply on a message row) fall
        // through untouched.
        if (dx > 0 && Math.abs(dy) <= dx * SWIPE_BACK_ANGLE_TAN) {
          dragging = true;
          setIsBackDragging(true);
        } else {
          anchor = null;
          return;
        }
      }

      // Committed: secure the gesture and follow the finger 1:1 (dead zone
      // subtracted so the panel does not jump by the arm distance).
      e.preventDefault();
      const v = Math.max(0, Math.min(window.innerWidth, dx - SWIPE_BACK_ARM_PX));
      prevX = lastX;
      prevT = lastT;
      lastX = v;
      lastT = performance.now();
      x.set(v);
    };

    const settle = () => {
      if (!anchor) return;
      const wasDragging = dragging;
      anchor = null;
      dragging = false;
      if (wasDragging) {
        setIsBackDragging(false);
        const vx = lastT > prevT ? (lastX - prevX) / (lastT - prevT) : 0;
        const width = window.innerWidth;
        if (lastX > width * SWIPE_BACK_EXIT_FRACTION || vx > SWIPE_BACK_EXIT_SPEED) {
          // Exit: glide the panel fully off, then leave the chat.
          animate(x, width, {
            duration: 0.18,
            ease: [0.32, 0.72, 0, 1],
            onComplete: () => onBackRef.current(),
          });
        } else {
          // Snap back with a spring (the WallPost overlay feel).
          animate(x, 0, { type: "spring", stiffness: 300, damping: 30 });
        }
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", settle, { passive: true });
    el.addEventListener("touchcancel", settle, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", settle);
      el.removeEventListener("touchcancel", settle);
    };
  }, [x]);

  return { x, panelRef, isBackDragging };
}