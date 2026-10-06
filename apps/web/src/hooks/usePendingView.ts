import { useCallback, useRef, useState } from "react";

import { runViewTransition, setTransitionDirection, transitionEnterClass, type TransitionStyle } from "@/lib/viewTransitions";

/**
 * Stale-view retention for URL-driven view switching.
 *
 * The view the URL asks for (`target`) is not shown until it reports ready;
 * meanwhile the view already on screen (`shown`) stays put. Progress is the
 * header's loading bar, so switching never flashes a skeleton. Views are
 * mounted while they are the target OR still on screen, and hidden otherwise.
 *
 * Usage:
 *   const view = usePendingView(targetMode, initialMode);
 *   {view.isRendered("feed") && (
 *     <div className={pendingViewClass(view.isShown("feed"))}>
 *       <ThreadFeed onReady={view.readyFor("feed")} />
 *     </div>
 *   )}
 */

export const pendingViewClass = (
  visible: boolean,
  style: TransitionStyle = "fade",
): string => {
  if (!visible) return "hidden";
  // Styles the browser animates itself (or "none") get no extra CSS entrance —
  // an inner fade would double up with the browser's swap.
  return transitionEnterClass(style);
};

export interface PendingView<K extends string> {
  /** The view currently on screen. */
  shown: K;
  /** Mount this view? True while it is the target or still the shown one. */
  isRendered: (view: K) => boolean;
  /** Is this view the one on screen? */
  isShown: (view: K) => boolean;
  /**
   * A STABLE `onReady` callback for this view — stable identity matters, since
   * views put it in effect deps and a fresh function every render would loop.
   */
  readyFor: (view: K) => () => void;
}

export const usePendingView = <K extends string>(
  target: K,
  initial: K,
  /**
   * Navigation depth per view (feed = 0, раздел = 1, …). Used only to give the
   * slide transition its direction, computed at swap time — an effect would race
   * the child that reports ready. Must be referentially stable.
   */
  depthOf?: Record<K, number>,
): PendingView<K> => {
  const [shown, setShownState] = useState<K>(initial);
  const readyCache = useRef(new Map<K, () => void>());
  // Mirrors `shown` so the stable onReady callbacks can tell that their view is
  // already on screen. Swapping to the view that is already shown changes no
  // DOM, but the View Transitions API would still animate an empty old→new pair
  // — and the content of that view (e.g. another раздел in the same component)
  // may already have been swapped underneath by its own fetch.
  const shownRef = useRef<K>(initial);

  const setShown = useCallback((view: K) => {
    shownRef.current = view;
    setShownState(view);
  }, []);

  const readyFor = useCallback(
    (view: K) => {
      let fn = readyCache.current.get(view);
      if (!fn) {
        fn = () => {
          if (shownRef.current === view) return;
          if (depthOf) {
            const from = depthOf[shownRef.current] ?? 0;
            const to = depthOf[view] ?? 0;
            setTransitionDirection(to >= from ? "forward" : "back");
          }
          runViewTransition(() => setShown(view));
        };
        readyCache.current.set(view, fn);
      }
      return fn;
    },
    [depthOf, setShown],
  );

  return {
    shown,
    isRendered: (view: K) => target === view || shown === view,
    isShown: (view: K) => shown === view,
    readyFor,
  };
};
