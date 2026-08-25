import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

// ─── Floated copy of the selected message + its action panel ──────────────
// The chat itself NEVER scrolls when the action panel is opened: the bubble is
// deep-cloned into this overlay layer (positioned exactly over the original's
// slot, which is hidden in place), and the panel renders below it. When the
// panel would not fit inside the visible message area, the WHOLE group —
// message and panel together — glides UP with a single eased transition, on
// top of the blurred chat, without moving a single other message.
//
// Portal target is .chat-panel, so the group lives in the same stacking
// context as the blur (above the per-surface blurred siblings), and the
// outside-tap dismissal listener on the panel catches events from here.

const BOTTOM_BREATH = 14; // breathing room at the bottom of the message area
const TOP_BREATH = 8; // the group must never rise past the top of the area

interface MessageActionOverlayProps {
  /** The selected message bubble — hidden in place via `.is-menu-hidden`. */
  hostEl: HTMLElement;
  /** `.chat-panel` — the absolute-positioning base for the group. */
  portalEl: HTMLElement;
  isMine: boolean;
  /** The action panel JSX; rendered below the floated message. */
  children: ReactNode;
}

export function MessageActionOverlay({ hostEl, portalEl, isMine, children }: MessageActionOverlayProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const cloneHostRef = useRef<HTMLDivElement | null>(null);
  // Upward shift (px, ≤ 0). Applied as translateY with a CSS transition, so
  // the lift is a single smooth eased move — no per-frame jitter.
  const [lift, setLift] = useState(0);

  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    const cloneHost = cloneHostRef.current;
    if (!wrapper || !cloneHost) return;

    // Pixel-identical copy of the rendered bubble (purely visual — the group
    // is not interactive; all actions live in the panel below it).
    const clone = hostEl.cloneNode(true) as HTMLElement;
    clone.removeAttribute("id");
    clone.classList.remove("is-menu-hidden");
    cloneHost.appendChild(clone);

    // Anchor the group exactly over the original's slot. Rect → portal
    // coordinates (viewport minus the portal's own origin), so the desktop
    // chat column (not at 0,0) lands correctly too.
    const base = portalEl.getBoundingClientRect();
    const rect = hostEl.getBoundingClientRect();
    wrapper.style.left = `${rect.left - base.left}px`;
    wrapper.style.top = `${rect.top - base.top}px`;
    wrapper.style.width = `${rect.width}px`;

    // Cap the panel so even the tightest message areas keep every action
    // tappable — measured before the lift so the fit math sees the final size.
    const scroller = portalEl.querySelector(".message-scroll");
    if (scroller) {
      const scrollerRect = scroller.getBoundingClientRect();
      const available = scrollerRect.height - BOTTOM_BREATH - TOP_BREATH;
      const maxHeight = Math.max(150, Math.min(available, 480));
      const panel = wrapper.querySelector(".msg-action-panel");
      if (panel && panel.scrollHeight > maxHeight + 2) {
        (panel as HTMLElement).style.maxHeight = `${maxHeight}px`;
      }
    }

    // Next frame, once the panel is laid out at its final size: measure how
    // far it pokes below the visible message area and glide the group up by
    // exactly that much (never past the area's top edge).
    const raf = requestAnimationFrame(() => {
      const panel = wrapper.querySelector(".msg-action-panel");
      const scroller = portalEl.querySelector(".message-scroll");
      if (!panel || !scroller) return;
      const scrollerRect = scroller.getBoundingClientRect();
      const panelBottom = panel.getBoundingClientRect().bottom;
      const overflow = Math.max(0, panelBottom - (scrollerRect.bottom - BOTTOM_BREATH));
      const roomUp = Math.max(0, rect.top - scrollerRect.top - TOP_BREATH);
      setLift(-Math.min(overflow, roomUp));
    });

    return () => cancelAnimationFrame(raf);
  }, [hostEl, portalEl, isMine]);

  return createPortal(
    <div
      ref={wrapperRef}
      className={`msg-action-lift${isMine ? " is-mine" : ""}`}
      style={{ transform: `translateY(${lift}px)` }}
    >
      <div ref={cloneHostRef} className="msg-action-lift-bubble" />
      {children}
    </div>,
    portalEl,
  );
}