import { useCallback, useRef, useState } from "react";

import { runViewTransition, type TransitionStyle } from "@/lib/viewTransitions";

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

/** Applied to the visible view so the swap reads as a soft fade. */
export const PENDING_VIEW_VISIBLE =
  "view-fade-in";

export const pendingViewClass = (
  visible: boolean,
  style: TransitionStyle = "fade",
): string => {
  if (!visible) return "hidden";
  // With the View Transitions API the browser animates the swap itself, so an
  // extra CSS fade would double up.
  return style === "view-transition" ? "" : PENDING_VIEW_VISIBLE;
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

export const usePendingView = <K extends string>(target: K, initial: K): PendingView<K> => {
  const [shown, setShown] = useState<K>(initial);
  const readyCache = useRef(new Map<K, () => void>());

  const readyFor = useCallback((view: K) => {
    let fn = readyCache.current.get(view);
    if (!fn) {
      fn = () => runViewTransition(() => setShown(view));
      readyCache.current.set(view, fn);
    }
    return fn;
  }, []);

  return {
    shown,
    isRendered: (view: K) => target === view || shown === view,
    isShown: (view: K) => shown === view,
    readyFor,
  };
};
