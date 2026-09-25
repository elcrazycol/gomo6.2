// A reusable "ink" hover effect: a soft primary blob that springs under the
// hovered/focused child marked with `data-ink`. Wrap a row of buttons; the
// blob never intercepts pointer events.

import { useCallback, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";

/** Mark a child so the ink blob glides under it. */
export const INK_ATTR = "data-ink";

export const InkBar = ({
  children,
  className = "",
  blobClassName = "h-8 w-8",
}: {
  children: ReactNode;
  className?: string;
  /** Size of the blob — match the target buttons (e.g. "h-9 w-9"). */
  blobClassName?: string;
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const reduceMotion = useReducedMotion();
  const [ink, setInk] = useState({ x: 0, y: 0, visible: false });

  const moveTo = useCallback((element: HTMLElement | null) => {
    if (!element) return;
    // offsetLeft/Top are relative to the positioned container and scroll-safe.
    setInk({ x: element.offsetLeft, y: element.offsetTop, visible: true });
  }, []);

  const findInkTarget = (target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof HTMLElement)) return null;
    const element = target.closest<HTMLElement>(`[${INK_ATTR}]`);
    return element && containerRef.current?.contains(element) ? element : null;
  };

  return (
    <div
      ref={containerRef}
      className={`relative ${className}`}
      onMouseLeave={() => setInk((prev) => ({ ...prev, visible: false }))}
      onMouseOver={(event) => moveTo(findInkTarget(event.target))}
      onFocusCapture={(event) => moveTo(findInkTarget(event.target))}
    >
      <motion.span
        aria-hidden="true"
        initial={false}
        animate={{ x: ink.x, y: ink.y, opacity: ink.visible ? 1 : 0, scale: ink.visible ? 1 : 0.55 }}
        transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 700, damping: 38, mass: 0.6 }}
        className={`pointer-events-none absolute left-0 top-0 z-0 rounded-full bg-primary/30 blur-[7px] ${blobClassName}`}
      />
      {children}
    </div>
  );
};
