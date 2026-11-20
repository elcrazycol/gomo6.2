/**
 * Motion language — spring presets and spatial helpers.
 *
 * The app animates with SPRINGS, not with duration/ease curves: a spring has
 * velocity, so an interrupted animation continues from where it is instead of
 * restarting, and the tail decelerates like a physical object. `duration` is
 * only used for opacity (a fade has no physics) and as the reduced-motion
 * fallback.
 *
 * Presets are named by intent, not by number, so every surface that means the
 * same thing moves the same way:
 *
 *   snappy   — direct manipulation feedback (press, hover, toggle). Instant.
 *   standard — the default for entering/exiting content.
 *   soft     — large surfaces: panels, containers, page-level reflow.
 *   sheet    — sheets/dialogs that come from an edge and settle.
 *   pop      — small punctuation: a badge landing, an icon bouncing.
 *
 * Reduced motion is honoured per-component via `useSpring(reduce)`; when it is
 * on, every preset collapses to an instant transition and spatial offsets are
 * dropped.
 *
 * Signed-off taste and locked parameters live in docs/wiki/MOTION_TASTE.md —
 * read it before adding or retuning a preset.
 */
import type { TargetAndTransition, Transition, Variants } from "motion/react";

/**
 * Telegram-grade physics. These four constants are the whole vocabulary of
 * spatial motion in the app — every spring below is one of them, not a
 * hand-tuned copy. Values are physical (stiffness/damping/mass), so an
 * interrupted animation keeps its velocity instead of restarting.
 *
 *   SPRING_SNAPPY — menus, popovers, buttons, toggles, press feedback.
 *   SPRING_SMOOTH — modals, panels, layout shifts, shared elements.
 *   SPRING_BOUNCY — micro only: reactions, badges, small icons.
 *   EASE_OUT_EXPO — opacity / colour / blur only, never movement.
 */
export const SPRING_SNAPPY = { type: "spring", stiffness: 500, damping: 32, mass: 0.8 } as const;
export const SPRING_SMOOTH = { type: "spring", stiffness: 380, damping: 30, mass: 1 } as const;
export const SPRING_BOUNCY = { type: "spring", stiffness: 600, damping: 20, mass: 0.7 } as const;
export const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

export const SPRING = {
  snappy: SPRING_SNAPPY,
  standard: SPRING_SMOOTH,
  soft: { type: "spring", stiffness: 260, damping: 30, mass: 1 },
  sheet: { type: "spring", stiffness: 300, damping: 32, mass: 0.9 },
  pop: SPRING_BOUNCY,
  bouncy: SPRING_BOUNCY,
  /**
   * A latched element being let go. Spring-loaded, but restrained: ζ ≈ 0.63
   * gives ~8% overshoot of the travel, which on the profile's 0.24 scale range
   * is a ~1–1.5% pop above 1 — a settle you feel more than you see.
   */
  eject: { type: "spring", stiffness: 500, damping: 28, mass: 1 },
  /**
   * The composer sheet — the pop character with its power turned down ~1.5×:
   * less stiffness and a more damped rebound, so a full-height surface moves
   * softly instead of snapping. Kept separate from `pop` so badges and icons
   * keep their snap.
   */
  composer: { type: "spring", stiffness: 400, damping: 20, mass: 0.7 },
  /**
   * The composer's exit. Same character as `composer`, deliberately a little
   * slower and more damped so the panel is seen travelling down instead of
   * being gone before the eye catches it.
   */
  composerClose: { type: "spring", stiffness: 320, damping: 26, mass: 0.9 },
  /**
   * A measured dimension — `width`/`height` of a label, row or chip that opens
   * to its content. Deliberately over-damped: a spring overshoot on a measured
   * box is not bounce, it is the last glyph of the text sliding a fraction of a
   * pixel and back at the end of the animation.
   */
  reveal: { type: "spring", stiffness: 500, damping: 44, mass: 0.8 },
  /**
   * Shape properties — `border-radius`, `clip-path`. Fast and critically damped:
   * a shape that overshoots is not motion, it is a rendering glitch (a negative
   * radius, a mask that pops), so this preset deliberately has no bounce.
   */
  shape: { type: "spring", stiffness: 855, damping: 50, mass: 0.8 },
  /**
   * A shared-element flight — the geometry of an object travelling between two
   * boxes (avatar → photo). Stiffer than `soft` on purpose: a flight is the one
   * transition the user is actively waiting for, so it should be over quickly
   * while still carrying a spring's deceleration and interruptibility.
   */
  flight: { type: "spring", stiffness: 530, damping: 43, mass: 1 },
} as const satisfies Record<string, Transition>;

export type SpringName = keyof typeof SPRING;

/** Motion is off: apply the change now, without a curve. */
export const INSTANT: Transition = { duration: 0 };

/**
 * The transition to use for a preset given the user's reduced-motion setting
 * (`useReducedMotion()` returns `null` while unknown, treated as "allowed").
 */
export const springFor = (name: SpringName, reduce: boolean | null): Transition =>
  reduce ? INSTANT : SPRING[name];

/** A spatial slide: how far content travels along an axis when it enters. */
export const SPATIAL_OFFSET = {
  /** Tab/segment content — a hint of direction, not a slide show. */
  tab: 14,
  /** Cards and rows appearing in a stream. */
  row: 14,
  /** Full panels swapping in a two-pane layout. */
  panel: 24,
} as const;

/**
 * Direction of travel between two positions in an ordered sequence
 * (tabs, steps, pages). Equal positions count as forward.
 */
export const travelDirection = (from: number, to: number): 1 | -1 => (to >= from ? 1 : -1);

/**
 * Entering content that arrives from a direction. `false` disables the initial
 * state entirely (first paint, reduced motion) — the element then simply is
 * where it belongs.
 */
export const spatialEnter = (
  direction: 1 | -1,
  distance: number,
  reduce: boolean | null,
  animate = true,
) => ({
  initial: animate && !reduce ? { opacity: 0, x: direction * distance } : (false as const),
  animate: { opacity: 1, x: 0 },
});

/**
 * Press feedback for a tappable surface: scale in on pointer down, spring back
 * on release. Skipped under reduced motion (the change still happens).
 */
export const pressFeedback = (reduce: boolean | null, scale = 0.96) =>
  reduce ? {} : { whileTap: { scale } };

/** Hover lift — only where hover is a real pointer state. */
export const hoverLift = (reduce: boolean | null, scale = 1.03) =>
  reduce ? {} : { whileHover: { scale } };

// ─────────────────────────────────────────────────────────────────────────────
// Dimensional morph — how an element is allowed to enter or leave the DOM.
// Never a bare fade: opacity + scale + blur, with a logical origin so the motion
// reads as the surface unfolding from the thing that opened it (a dropdown from
// its trigger, a panel from the edge, a row from the list).
// ─────────────────────────────────────────────────────────────────────────────

/** A rapid cascade. Tight enough to feel immediate, never blocking. */
export const STAGGER = { staggerChildren: 0.025, delayChildren: 0.02 } as const;

/** Shared parent choreography for content groups across the app. */
export const CASCADE_VARIANTS: Variants = {
  hidden: {},
  show: { transition: STAGGER },
};

/** A more legible cadence for long-form streams: each card gets its own beat. */
export const STREAM_CASCADE_VARIANTS: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.055, delayChildren: 0.02 } },
};

/**
 * Keeps the same entrance language as the stream cascade, but this is explicitly
 * set on **each row** with `initial` + `animate` instead of being inherited from
 * a parent. Inherited variant trees can be muffled by a re-render that happens
 * between mounting and the animation (the channel load race silenced "show" and
 * made rows stay at opacity 0 forever); a self-driven row plays to the end no
 * matter what happens around it.
 */
export const streamRowVariants = (index: number): Variants => {
  const show = STREAM_ITEM_VARIANTS.show as TargetAndTransition;
  return {
    hidden: STREAM_ITEM_VARIANTS.hidden,
    show: {
      ...show,
      transition: { ...show.transition, delay: Math.max(0, Math.min(index, 5)) * 0.055 },
    },
  };
};

/** Card landing in streams: lift + fade + a breath of scale, all on short expo
 *  tweens. The look of the old spring cascade, but deterministic: no spring
 *  tail, no per-card physics — the re-raster window is ~0.2s per card and the
 *  cascade only plays on cold start (cached pages paint instantly). */
export const STREAM_ITEM_VARIANTS: Variants = {
  hidden: { opacity: 0, y: SPATIAL_OFFSET.row, scale: 0.98 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      y: { duration: 0.22, ease: EASE_OUT_EXPO },
      opacity: { duration: 0.16, ease: EASE_OUT_EXPO },
      scale: { duration: 0.22, ease: EASE_OUT_EXPO },
    },
  },
};

/**
 * Whisper-level row entrance: a breath of lift (no scale), fast fade, tight
 * ~25ms stagger across up to 9 rows. For lists that should ARRIVE, not
 * perform — the notification inbox uses this instead of the card landing.
 */
export const whisperRowVariants = (index: number): Variants => {
  const slot = Math.max(0, Math.min(index, 8)) * 0.025;
  return {
    hidden: { opacity: 0, y: SPATIAL_OFFSET.row / 2 },
    show: {
      opacity: 1,
      y: 0,
      transition: {
        ...SPRING.soft,
        delay: slot,
        opacity: { duration: 0.14, ease: EASE_OUT_EXPO, delay: slot },
      },
    },
  };
};

export interface MorphOrigin {
  /** 0 = left edge, 0.5 = centre, 1 = right edge. */
  x?: number;
  /** 0 = top edge, 0.5 = centre, 1 = bottom edge. */
  y?: number;
}

/** The `style` that anchors a morph to its logical origin. */
export const morphOrigin = ({ x = 0.5, y = 0.5 }: MorphOrigin = {}) => ({
  originX: x,
  originY: y,
});

/**
 * Enter/exit for any element that mounts inside `AnimatePresence`. `entering`
 * is the start scale — 0.88 for compact surfaces (menus, cards, popovers),
 * closer to 1 for large containers where 0.88 would read as a zoom.
 *
 * `blurPx` is the defocus the surface enters from. Large containers pass 0:
 * a `filter` left on a full-page wrapper creates a containing block and a
 * composited layer for everything inside it, which is exactly how a list ends
 * up feeling heavier than it looks.
 */
export const morphVariants = (entering = 0.88, blurPx = 6): Variants => {
  const defocus = blurPx > 0 ? { filter: `blur(${blurPx}px)` } : {};
  const focused = blurPx > 0 ? { filter: "blur(0px)" } : {};
  const leaving = blurPx > 0 ? { filter: `blur(${Math.min(blurPx, 4)}px)` } : {};
  return {
    hidden: { opacity: 0, scale: entering, ...defocus },
    show: { opacity: 1, scale: 1, ...focused },
    exit: { opacity: 0, scale: Math.min(1, entering + 0.06), ...leaving },
  };
};

/**
 * Transition for a dimensional morph: the geometry is a spring, the fade and
 * the blur are short opacity-class tweens (a blur has no physics, and tweening
 * it longer than ~200 ms is the most expensive thing a browser can do).
 */
export const morphTransition = (
  reduce: boolean | null,
  spring: Transition = SPRING_SMOOTH,
): Transition =>
  reduce
    ? INSTANT
    : {
        ...spring,
        opacity: { duration: 0.16, ease: EASE_OUT_EXPO },
        filter: { duration: 0.18, ease: EASE_OUT_EXPO },
      };
