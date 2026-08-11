/**
 * Eased smooth scrolling to an element.
 *
 * Native `scrollIntoView({ behavior: "smooth" })` uses the browser's built-in
 * easing and duration, which feel abrupt next to our entrance animations.
 * This helper animates every scroll container between the target and the
 * viewport (including the window) with a single eased rAF loop instead.
 */

type ScrollBlock = "start" | "center" | "end";

export interface SmoothScrollOptions {
  /** Where the target should land inside the viewport. Defaults to "center". */
  block?: ScrollBlock;
  /** Animation length in ms. Defaults to 700. */
  duration?: number;
  /** Extra offset in px for "start"/"end" anchoring. */
  margin?: number;
}

const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const isScrollable = (el: Element): boolean => {
  const overflowY = getComputedStyle(el).overflowY;
  if (overflowY !== "auto" && overflowY !== "scroll" && overflowY !== "overlay" && overflowY !== "hidden") {
    return false;
  }
  return el.scrollHeight > el.clientHeight + 1;
};

/**
 * Where the comments section should start inside the viewport — a fraction of
 * the viewport height. Shared by the decision helper AND the scroll margin in
 * WallPostCard, so the nudge always lands the section exactly on this line.
 */
export const COMMENTS_TARGET_FRACTION = 0.35;

/** Tolerance in px — skip the nudge when the section already starts close to the target line. */
const COMMENTS_DEAD_ZONE = 64;

export interface CommentsScrollOptions {
  /** Where the comments section should start inside the viewport (fraction of height). */
  targetFraction?: number;
  /** Tolerance in px — skip the nudge when already close to the target line. */
  deadZone?: number;
}

/**
 * Decide whether opening the comments section should nudge the page down.
 * Only ever scrolls DOWN: if the section already starts at or above the target
 * line (the user is already low enough), the page is left exactly where it is.
 */
export const shouldScrollToComments = (
  el: Element,
  viewportHeight: number,
  options: CommentsScrollOptions = {},
): boolean => {
  const targetFraction = options.targetFraction ?? COMMENTS_TARGET_FRACTION;
  const deadZone = options.deadZone ?? COMMENTS_DEAD_ZONE;
  const rect = el.getBoundingClientRect();
  return rect.top > viewportHeight * targetFraction + deadZone;
};

export const smoothScrollToElement = (target: Element, options: SmoothScrollOptions = {}): void => {
  const { block = "center", duration = 700, margin = 0 } = options;
  const safeDuration = Math.max(1, duration);
  if (typeof window === "undefined" || typeof document === "undefined") return;

  if (prefersReducedMotion()) {
    target.scrollIntoView({ behavior: "auto", block });
    return;
  }

  const rect = target.getBoundingClientRect();
  const viewportHeight = window.innerHeight;

  // Every scrollable ancestor between the target and the viewport.
  const scrollers: { el: Element; delta: number }[] = [];
  let node: Element | null = target.parentElement;
  while (node && node !== document.body) {
    if (isScrollable(node)) {
      const container = node.getBoundingClientRect();
      const desired =
        block === "start"
          ? rect.top - container.top - margin
          : block === "end"
            ? rect.top - container.top - container.height + rect.height + margin
            : rect.top - container.top + rect.height / 2 - container.height / 2;
      const maxScroll = Math.max(0, node.scrollHeight - node.clientHeight);
      const next = Math.min(Math.max(node.scrollTop + desired, 0), maxScroll);
      const delta = next - node.scrollTop;
      if (Math.abs(delta) > 1) scrollers.push({ el: node, delta });
    }
    node = node.parentElement;
  }

  // The window is the outermost scroll container. Note: its delta is computed
  // from the pre-scroll rect, so when BOTH inner scrollers and the window move,
  // the resting position can be slightly off-center (this app scrolls only the
  // window, so the common case is exact).
  const doc = document.scrollingElement || document.documentElement;
  const windowDesired =
    block === "start"
      ? rect.top - margin
      : block === "end"
        ? rect.top + rect.height - viewportHeight + margin
        : rect.top + rect.height / 2 - viewportHeight / 2;
  const windowMax = Math.max(0, doc.scrollHeight - viewportHeight);
  const windowNext = Math.min(Math.max(doc.scrollTop + windowDesired, 0), windowMax);
  const windowDelta = windowNext - doc.scrollTop;

  if (Math.abs(windowDelta) < 1 && scrollers.length === 0) return;

  const startScrolls = [...scrollers.map((s) => s.el.scrollTop), doc.scrollTop];
  const deltas = [...scrollers.map((s) => s.delta), windowDelta];
  const applyAt = (progress: number) => {
    scrollers.forEach((s, i) => {
      s.el.scrollTop = startScrolls[i] + deltas[i] * progress;
    });
    doc.scrollTop = startScrolls[scrollers.length] + deltas[scrollers.length] * progress;
  };

  const startedAt = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - startedAt) / safeDuration);
    applyAt(easeOutCubic(t));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
};
