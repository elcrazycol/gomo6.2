import { useRef, type MouseEvent, type ReactNode } from "react";

import { cn } from "@/lib/utils";

interface SpotlightProps {
  children: ReactNode;
  /** Display/size classes for the wrapper (e.g. `block` or `min-w-0 flex-1`). */
  className?: string;
  /** Corner rounding of the glow overlay (matches the child's radius). */
  overlayClassName?: string;
  /** Glow colour. Defaults to the theme primary (invisible on a solid-primary
   *  surface — pass a lighter colour there). */
  color?: string;
}

/**
 * Cursor-following spotlight for a sidebar row.
 *
 * Tracks the pointer inside the wrapper and paints a soft radial glow under the
 * cursor; fades in on hover and out on leave. The overlay is
 * `pointer-events-none`, so clicks still reach the wrapped control.
 */
export const Spotlight = ({ children, className, overlayClassName, color }: SpotlightProps) => {
  const ref = useRef<HTMLSpanElement>(null);

  const handleMouseMove = (event: MouseEvent<HTMLSpanElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--spot-x", `${event.clientX - rect.left}px`);
    el.style.setProperty("--spot-y", `${event.clientY - rect.top}px`);
  };

  return (
    <span ref={ref} onMouseMove={handleMouseMove} className={cn("group/spot relative", className)}>
      {children}
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 ease-out group-hover/spot:opacity-100 motion-reduce:transition-none",
          overlayClassName ?? "rounded-lg",
        )}
        style={{
          background: `radial-gradient(140px circle at var(--spot-x, 50%) var(--spot-y, 50%), ${
            color ?? "hsl(var(--primary) / 0.18)"
          }, transparent 72%)`,
        }}
      />
    </span>
  );
};
