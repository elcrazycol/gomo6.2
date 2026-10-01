/**
 * Transition style for URL-driven view switching (Settings → Appearance).
 *
 * Every style is a different way of swapping the content column when the URL
 * changes. Two of them are animated by the browser (View Transitions API), the
 * rest are plain CSS entrance animations, and one turns animation off entirely:
 *
 *   "fade"            — the incoming view fades in (default, works everywhere).
 *   "view-transition" — the browser fade-through: old fades out, new fades in.
 *   "rise"            — the incoming view fades in while sliding up a few px.
 *   "slide"           — the browser pushes the old view out and the new one in,
 *                       direction-aware (forward into a раздел, back to the feed).
 *   "none"            — instant swap, no animation.
 * The order here is the order shown in Settings: the default first.
 *
 * Stored in localStorage like the other appearance preferences.
 */
import { flushSync } from "react-dom";

export type TransitionStyle = "fade" | "rise" | "slide" | "view-transition" | "none";

/** Direction of a slide, derived from where the user is navigating. */
export type TransitionDirection = "forward" | "back";

export const TRANSITION_STYLE_KEY = "transition-style";

export const DEFAULT_TRANSITION_STYLE: TransitionStyle = "fade";

export const TRANSITION_STYLES: { id: TransitionStyle; label: string; description: string }[] = [
  {
    id: "fade",
    label: "Плавное затухание",
    description: "Новый экран мягко проявляется. Работает везде",
  },
  {
    id: "view-transition",
    label: "Наплыв (View Transitions API)",
    description: "Браузер плавно наплывает новый экран вместо старого",
  },
  {
    id: "rise",
    label: "Появление снизу",
    description: "Экран проявляется, чуть поднимаясь — мягче плоского затухания",
  },
  {
    id: "slide",
    label: "Слайд вперёд/назад",
    description: "В раздел — влево, обратно — вправо. Читается как навигация",
  },
  {
    id: "none",
    label: "Без анимации",
    description: "Мгновенная смена экрана — для слабых устройств",
  },
];

/** Broadcast so the main page picks up a change made on the Settings page. */
export const TRANSITION_STYLE_EVENT = "gomo6:transition-style";

export const getTransitionStyle = (): TransitionStyle => {
  try {
    const saved = localStorage.getItem(TRANSITION_STYLE_KEY);
    return TRANSITION_STYLES.some((s) => s.id === saved)
      ? (saved as TransitionStyle)
      : DEFAULT_TRANSITION_STYLE;
  } catch {
    return DEFAULT_TRANSITION_STYLE;
  }
};

export const setTransitionStyle = (style: TransitionStyle): void => {
  try {
    localStorage.setItem(TRANSITION_STYLE_KEY, style);
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent(TRANSITION_STYLE_EVENT, { detail: { style } }));
};

/** Whether this style is animated by the browser's View Transitions API. */
export const isViewTransitionStyle = (style: TransitionStyle): boolean =>
  style === "view-transition" || style === "slide";

/**
 * The class the incoming view carries while WE animate the swap (see
 * hooks/usePendingView). Empty for styles the browser animates itself, or none.
 */
export const transitionEnterClass = (style: TransitionStyle): string => {
  switch (style) {
    case "fade":
      return "view-fade-in";
    case "rise":
      return "view-rise-in";
    default:
      return "";
  }
};

/** Whether the browser can run a view transition right now. */
export const supportsViewTransitions = (): boolean =>
  typeof document !== "undefined" && typeof document.startViewTransition === "function";

/**
 * Shared-element name for a раздел's title. The sidebar label and the раздел
 * header both use `section-<slug>` — but never at the same time (see Index and
 * SectionThreads), so the browser can morph one into the other.
 */
export const sectionTransitionName = (slug: string): string =>
  `section-${slug.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

export const prefersReducedMotion = (): boolean => {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  } catch {
    return false;
  }
};

/**
 * The feed and раздел routes all render the Index page, which animates its OWN
 * view switches (hooks/usePendingView). Page-level transitions must skip these
 * so the two systems don't animate the same navigation twice.
 */
export const isFeedRoute = (pathname: string): boolean =>
  pathname === "/" || /^\/(feed|mine|history|favorites|c)(\/|$)/.test(pathname);

/**
 * Weak hardware is put on the cheap tier (utils/perfTier) — the always-on glass
 * header is dropped for the same reason transitions are: a device that cannot
 * hold a blur cannot hold a full-screen crossfade either.
 */
export const isPerfLite = (): boolean =>
  typeof document !== "undefined" && document.documentElement.classList.contains("perf-lite");

// ── Direction ────────────────────────────────────────────────────────────────
// Read by the slide choreography. Set by the main page from the route depth
// (feed → раздел → подраздел is forward, the reverse is back) and the history
// action for same-depth hops (browser "back" slides back).
export const setTransitionDirection = (direction: TransitionDirection): void => {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.vtDirection = direction;
};

export const getTransitionDirection = (): TransitionDirection =>
  typeof document !== "undefined" && document.documentElement.dataset.vtDirection === "back"
    ? "back"
    : "forward";

/**
 * At most one swap animates at a time. The pending-view pattern can report two
 * views ready in the same tick — a view mounts from cache and the network then
 * revalidates it — and a second `startViewTransition` while one is running
 * aborts the first with `AbortError: Transition was skipped` (which also
 * surfaced as an unhandled rejection). Instead of racing, hold the latest
 * superseded update and apply it once the running swap is done.
 */
let activeTransition = false;
let queuedUpdate: (() => void) | null = null;

export interface RunTransitionOptions {
  /**
   * Run the View Transitions API even on weak hardware / when the user picked a
   * non-VT style. Used by the Settings previews, which must demonstrate a style
   * regardless of the saved one.
   */
  force?: boolean;
}

/** Run `update` through the View Transitions API (or apply it directly). */
export const runTransition = (
  style: TransitionStyle,
  update: () => void,
  options: RunTransitionOptions = {},
): void => {
  if (
    !isViewTransitionStyle(style) ||
    !supportsViewTransitions() ||
    prefersReducedMotion() ||
    (!options.force && isPerfLite())
  ) {
    update();
    return;
  }

  if (activeTransition) {
    // A swap is already animating; remember this one and run it after, so the
    // final state is never stranded on the wrong view.
    queuedUpdate = update;
    return;
  }

  // Start on the next task: views report ready from React effects, and
  // flushSync called inside a lifecycle method warns.
  queueMicrotask(() => {
    if (activeTransition) {
      queuedUpdate = update;
      return;
    }
    activeTransition = true;
    const transition = document.startViewTransition!(() => {
      flushSync(update);
    });
    // A skipped transition rejects `ready`/`finished`; that is expected when a
    // swap is superseded and must never surface as an unhandled rejection. The
    // update callback itself still runs, so the DOM always reaches the target.
    void transition.finished
      .catch(() => {})
      .finally(() => {
        activeTransition = false;
        const next = queuedUpdate;
        queuedUpdate = null;
        // The superseded update is stale by a whole animation; apply it plainly.
        next?.();
      });
  });
};

/**
 * Run a DOM update through a view transition when the user picked that style
 * (and the browser + motion preferences + hardware allow it), otherwise just
 * apply it.
 *
 * The update MUST flush synchronously inside the callback — React batches state
 * updates, and the browser has to see the new DOM before it can snapshot it.
 */
export const runViewTransition = (update: () => void): void =>
  runTransition(getTransitionStyle(), update);
