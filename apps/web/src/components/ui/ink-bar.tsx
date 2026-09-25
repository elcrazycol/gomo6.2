// A reusable "ink" hover effect: a soft primary blob that springs under the
// hovered/focused child marked with `data-ink`. Wrap a row of buttons; the
// blob never intercepts pointer events.

import { useCallback, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";

/** Mark a child so the ink blob glides under it. */
export const INK_ATTR = "data-ink";

/**
 * Icon button for an InkBar: no flat hover tint (the blob is the hover
 * feedback), rounded, focus-ringed, marked with data-ink. `active` renders the
 * filled primary pill used by the formatting toolbar.
 */
/** Active state: frosted glass with a primary tint, not a hard fill. */
const glassActiveClass =
  "bg-gradient-to-b from-primary/25 to-primary/5 text-primary ring-1 ring-inset ring-primary/30 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.22)]";

/** Plain glass ghost button (no ink blob): used for the composer header. */
export const glassGhostButtonClass =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground ring-1 ring-inset ring-transparent transition-colors hover:bg-primary/10 hover:text-foreground hover:ring-primary/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export const inkButtonClass = (active = false, size: "sm" | "md" = "md") =>
  `relative z-10 inline-flex ${size === "sm" ? "h-8 w-8" : "h-9 w-9"} shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 ${
    active ? glassActiveClass : "text-muted-foreground hover:text-foreground"
  }`;

export const InkButton = ({
  active = false,
  size = "md",
  className = "",
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; size?: "sm" | "md" }) => (
  <button
    type="button"
    aria-pressed={props["aria-pressed"] ?? (active || undefined)}
    {...{ [INK_ATTR]: true }}
    className={`${inkButtonClass(active, size)} ${className}`}
    {...props}
  >
    {children}
  </button>
);

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
