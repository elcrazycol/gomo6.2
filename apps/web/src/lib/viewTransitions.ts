/**
 * Transition style for URL-driven view switching (Settings → Appearance).
 *
 * "fade"           — a CSS fade-in of the incoming view (default, works everywhere).
 * "view-transition" — the View Transitions API: the browser snapshots the
 *                     outgoing/incoming DOM and animates between them, so the
 *                     swap is a real crossfade (and elements can morph).
 *
 * Stored in localStorage like the other appearance preferences.
 */
import { flushSync } from "react-dom";

export type TransitionStyle = "fade" | "view-transition";

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
    label: "View Transitions API",
    description: "Браузер сам кроссфейдит старый и новый экран — плавнее и с морфингом",
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

/** Whether the browser can run a view transition right now. */
export const supportsViewTransitions = (): boolean =>
  typeof document !== "undefined" && typeof document.startViewTransition === "function";

const prefersReducedMotion = (): boolean => {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  } catch {
    return false;
  }
};

/**
 * Run a DOM update through a view transition when the user picked that style
 * (and the browser + motion preferences allow it), otherwise just apply it.
 *
 * The update MUST flush synchronously inside the callback — React batches state
 * updates, and the browser has to see the new DOM before it can snapshot it.
 */
export const runViewTransition = (update: () => void): void => {
  if (
    getTransitionStyle() !== "view-transition" ||
    !supportsViewTransitions() ||
    prefersReducedMotion()
  ) {
    update();
    return;
  }
  // Start on the next task: views report ready from React effects, and
  // flushSync called inside a lifecycle method warns.
  queueMicrotask(() => {
    document.startViewTransition!(() => {
      flushSync(update);
    });
  });
};
