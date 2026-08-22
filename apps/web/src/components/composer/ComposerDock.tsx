import { forwardRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface ComposerDockProps {
  children: ReactNode;
  /** Extra classes on the fixed bar (positioning lives in CSS, e.g.
   *  `wall-composer-dock` for the wall comments). */
  className?: string;
  /** Extra classes on the inner padded wrapper (safe-area padding etc.). */
  innerClassName?: string;
  /** When set, the dock is portaled into this element — use it to move the bar
   *  OUT of a scroll container (wall-post overlay) so the editor inside has no
   *  scrollable ancestor for iOS to focus-scroll. */
  portalTo?: HTMLElement | null;
  /** Set data-kb-pin (the mobile-keyboard gesture lock). Defaults to true —
   *  a dock always carries it. Pass false for non-docked (sticky) variants. */
  pin?: boolean;
}

/**
 * Universal fixed-bottom composer dock — the shared shell every mobile
 * composer surface (wall comments, thread comments, …) builds on:
 *
 *  • `position: fixed; bottom: var(--kb-inset)` — the bar is glued exactly
 *    above the soft keyboard, gliding with it via the per-frame geometry
 *    follow in lib/mobileKeyboard (no pinning dance, nothing to land under
 *    the keyboard, smooth slide-in/out);
 *  • `data-kb-pin` — mobileKeyboard pins the document on touchstart INSIDE
 *    this bar (before the native focus), so iOS has nothing to pan when the
 *    keyboard opens;
 *  • optional portal — teleports the bar out of a scroll container (the
 *    wall-post overlay) so the editor has no scrollable ancestor;
 *  • the inner wrapper carries surface-specific padding (safe-area, column
 *    width) without the consumer fighting the fixed positioning.
 *
 * The messenger keeps its own structure (the whole chat panel rides
 * --kb-inset); it uses the same primitives (data-kb-pin, --kb-inset) directly.
 */
export const ComposerDock = forwardRef<HTMLDivElement, ComposerDockProps>(
  ({ children, className = "", innerClassName = "", portalTo, pin = true }, ref) => {
    const dock = (
      <div
        ref={ref}
        data-kb-pin={pin ? "true" : undefined}
        className={`composer-dock ${className}`}
      >
        <div className={innerClassName}>{children}</div>
      </div>
    );
    return portalTo ? createPortal(dock, portalTo) : dock;
  },
);

ComposerDock.displayName = "ComposerDock";
