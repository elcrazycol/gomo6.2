import { useEffect, useRef, useState } from "react";
import { useLoadingBarStore } from "@/stores/loadingBarStore";

/** Don't flash the bar for loads shorter than this… */
const SHOW_DELAY_MS = 180;
/** …and once it is up, keep it visible at least this long so it never flickers. */
const MIN_VISIBLE_MS = 400;

/**
 * Thin indeterminate progress line pinned to the header's bottom edge.
 *
 * It fades in whenever any view is loading, so switching between views never
 * flashes a skeleton over the content you were already reading — the current
 * view stays put and this line says "something's coming". It is debounced
 * (delay before showing, minimum time on screen) so fast transitions do not
 * make it blink.
 */
export const TopLoadingBar = () => {
  const active = useLoadingBarStore((state) => state.count > 0);
  const [visible, setVisible] = useState(false);
  const shownAtRef = useRef(0);

  useEffect(() => {
    if (active) {
      if (visible) return;
      const timer = window.setTimeout(() => {
        shownAtRef.current = Date.now();
        setVisible(true);
      }, SHOW_DELAY_MS);
      return () => window.clearTimeout(timer);
    }
    if (!visible) return;
    const elapsed = Date.now() - shownAtRef.current;
    const timer = window.setTimeout(
      () => setVisible(false),
      Math.max(0, MIN_VISIBLE_MS - elapsed),
    );
    return () => window.clearTimeout(timer);
  }, [active, visible]);

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-x-0 bottom-0 h-[2px] overflow-hidden transition-opacity duration-200 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      <div className="absolute inset-0 bg-primary/15" />
      {visible && (
        <span className="loading-bar-segment absolute inset-y-0 w-1/3 rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary)/0.7)]" />
      )}
    </div>
  );
};
