import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import {
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
} from "motion/react";
import { springFor } from "@/lib/motion";
import { releasePullPx } from "@/lib/scrollResistance";

export interface RecedeOnScrollProps {
  children: ReactNode;
  /** Extra classes for the measuring wrapper. */
  className?: string;
  /** How much of the block must pass the top edge for the pull-in to finish (0..1). */
  exitAt?: number;
  /** Start the pull-in this far before the block's top reaches the viewport top. */
  leadPx?: number;
  /** 0..1 strength multiplier — lower for secondary blocks. */
  intensity?: number;
}

type Mode = "follow" | "locked" | "releasing";

/**
 * Pulls a block "into" the top edge as the page scrolls: the block scales down,
 * rises and loses contrast just before it leaves the viewport, then the next
 * block does the same. Every instance measures its own document box, so stacked
 * blocks (header → stats → bio → pins) are drawn in one after another with no
 * shared timeline and no per-frame React state.
 *
 * Coming back up is NOT the same curve in reverse. Once a block has been drawn
 * in past the visible edge it latches: the page keeps scrolling, the block
 * stays compressed, and it takes a deliberate upward pull (more distance the
 * slower you scroll) to free it. The release runs on the under-damped `eject`
 * spring, so it overshoots ~6–8% and settles instead of sliding back. A scroll
 * down at any point cancels the pull or the release and re-latches immediately,
 * so the gesture is always interruptible and native scrolling is never blocked.
 *
 * The measuring wrapper never receives the transform — only the inner element
 * does — so `getBoundingClientRect` on the wrapper keeps returning the layout
 * box even while the content is scaled.
 */
export function RecedeOnScroll({
  children,
  className,
  exitAt = 0.7,
  leadPx = 80,
  intensity = 1,
}: RecedeOnScrollProps) {
  const outerRef = useRef<HTMLDivElement | null>(null);
  const startRef = useRef(Number.POSITIVE_INFINITY);
  const spanRef = useRef(1);
  const reduce = useReducedMotion();
  const { scrollY } = useScroll();

  const progress = useMotionValue(0);
  const modeRef = useRef<Mode>("follow");
  const pullRef = useRef(0);
  const lastYRef = useRef<number | null>(null);
  const lastTRef = useRef(0);
  const releaseRef = useRef<ReturnType<typeof animate> | null>(null);

  const measure = useCallback(() => {
    const el = outerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const top = rect.top + window.scrollY;
    const start = Math.max(0, top - leadPx);
    startRef.current = start;
    spanRef.current = Math.max(1, top + rect.height * exitAt - start);
  }, [exitAt, leadPx]);

  // Re-measure after every render (the bio and lazy lists can grow) and on
  // resize. Scrolling never triggers a React render, so this is not hot.
  useLayoutEffect(() => {
    measure();
  });
  useEffect(() => {
    const ro = new ResizeObserver(() => measure());
    if (outerRef.current) ro.observe(outerRef.current);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  useEffect(() => () => releaseRef.current?.stop(), []);

  const rawAt = (y: number) => {
    const p = Math.min(1, Math.max(0, (y - startRef.current) / spanRef.current));
    // Smoothstep: barely moves at first, then accelerates — reads as suction.
    return p * p * (3 - 2 * p);
  };

  useMotionValueEvent(scrollY, "change", (y) => {
    if (reduce) return;

    const now = performance.now();
    const prev = lastYRef.current;
    lastYRef.current = y;
    const raw = rawAt(y);
    if (prev === null) {
      lastTRef.current = now;
      // Already fully open — avoid a redundant motion-value write per frame.
      if (raw === 0 && progress.get() === 0) return;
      progress.set(raw);
      return;
    }

    const dt = Math.max(8, now - lastTRef.current);
    lastTRef.current = now;
    const dy = y - prev;

    // Down: direct manipulation again. Any latch, pull or release is cancelled.
    if (dy > 0.5) {
      releaseRef.current?.stop();
      releaseRef.current = null;
      modeRef.current = "follow";
      pullRef.current = 0;
      if (raw !== progress.get()) progress.set(raw);
      return;
    }
    if (dy > -0.5) return;

    // Up: latch the block at the state it had when the direction flipped — but
    // only while it is still meaningfully on screen. A block that is already
    // fully out must come back normally, otherwise the user would be pulling on
    // an empty layout box.
    if (modeRef.current === "follow") {
      if (raw > 0.03 && raw < 0.8) {
        modeRef.current = "locked";
        pullRef.current = 0;
      } else {
        if (raw !== progress.get()) progress.set(raw);
        return;
      }
    }

    if (modeRef.current === "locked") {
      pullRef.current += Math.abs(dy);
      const speed = Math.abs(dy) / dt;
      if (pullRef.current >= releasePullPx(speed) || raw <= 0.01) {
        modeRef.current = "releasing";
        pullRef.current = 0;
        releaseRef.current?.stop();
        // Fully open, not just "back to the scroll position": the point of the
        // gesture is that the block leaps out once it gives way.
        releaseRef.current = animate(progress, 0, springFor("eject", reduce));
      }
    }
  });

  // Halved geometry vs the original (0.24/44px): scaling forces a re-raster
  // of the whole block, so a subtler pull keeps the feel at half the GPU cost.
  const scale = useTransform(progress, (p) => 1 - 0.12 * intensity * p);
  const lift = useTransform(progress, (p) => -24 * intensity * p);
  const fade = useTransform(progress, (p) => 1 - 0.6 * intensity * p);

  return (
    <div ref={outerRef} className={className}>
      <motion.div
        style={reduce ? undefined : { scale, y: lift, opacity: fade, transformOrigin: "50% 0%" }}
      >
        {children}
      </motion.div>
    </div>
  );
}
