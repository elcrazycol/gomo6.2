/**
 * Telegram-style delete exit.
 *
 * The bubble does not blink out: it breaks into a handful of pieces while the
 * row's height collapses, so the messages ABOVE it slide down into the gap and
 * everything BELOW stays exactly where it was.
 *
 * Cost model (this runs on a phone, possibly mid-scroll):
 *   - the pieces are plain divs moved with `transform` + `opacity` only — no
 *     filters, no shadows, no `clip-path` (those repaint every frame);
 *   - exactly ONE layout-animating property per frame (`height` of the row) for
 *     ~200ms, and it belongs to a single element;
 *   - the scroll witness costs one `getBoundingClientRect` read per frame, and a
 *     `scrollTop` write only when the engine did not anchor on its own (Chrome
 *     anchors natively, WebKit does not and needs the write);
 *   - `prefers-reduced-motion` collapses instantly, with no pieces at all;
 *   - everything is torn down by the caller's unmount or by a single timeout.
 */

/** How long the row takes to disappear. The store schedules the removal with it. */
export const DELETE_EXIT_MS = 200;

/** Pieces fly a little longer than the row collapses, so none is cut off. */
const PIECE_MS = 240;

/** The bubble is gone almost at once; the pieces carry the motion from there. */
const FADE_MS = 90;

const EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

/** Grid the bubble is broken into: 12 pieces read as «shattered» and stay cheap. */
const PIECES_X = 4;
const PIECES_Y = 3;

/** The row's share of the animation, 0 when the reader asked for less motion. */
export function deleteExitDuration(): number {
  if (typeof window === "undefined") return 0;
  if (typeof window.matchMedia !== "function") return DELETE_EXIT_MS;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : DELETE_EXIT_MS;
}

/**
 * Deterministic pseudo-random in [0, 1) from a string: the same message always
 * crumbles the same way, and a re-render never re-rolls the flight.
 */
function seeded(id: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/**
 * Builds the crumbling pieces over the bubble and starts their flight. The
 * layer is fixed to the chat's visible rect (NOT inside the collapsing row), so
 * it is neither clipped nor faded by the row's exit — and, because a fixed box
 * takes no part in the scroller's scrollable overflow, the pieces falling past
 * the last message cannot inflate `scrollHeight` (which would flash the
 * "scroll to bottom" button and leave a strip under the newest message).
 */
function explode(bubble: HTMLElement, scroller: HTMLElement | null, seed: string): void {
  if (typeof document === "undefined") return;
  const host = scroller ?? bubble.parentElement;
  if (!host) return;

  const bubbleRect = bubble.getBoundingClientRect();
  const hostRect = host.getBoundingClientRect();
  if (bubbleRect.width < 2 || bubbleRect.height < 2) return;

  // Where the pieces are drawn: the chat's visible box, viewport coordinates.
  const frame = scroller ? hostRect : {
    left: 0, top: 0,
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight,
  };

  // The bubble's own fill is often 4-6% alpha: a fragment painted with it is
  // invisible against the chat, so the shards are tinted in CSS from the theme
  // (primary for my messages, neutral dust for the peer's).
  const mine = bubble.classList.contains("is-mine");
  const radius = Math.max(2, Math.min(6, bubbleRect.height / PIECES_Y / 2));

  const layer = document.createElement("div");
  layer.className = "delete-crumbs";
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText = [
    // Fixed, not absolute: see the note above (`scrollHeight`).
    `position:${scroller ? "fixed" : "absolute"}`,
    "pointer-events:none",
    "overflow:hidden",
    "z-index:3",
    `left:${Math.round(frame.left)}px`,
    `top:${Math.round(frame.top)}px`,
    `width:${Math.round(frame.width)}px`,
    `height:${Math.round(frame.height)}px`,
  ].join(";");

  const pieceW = bubbleRect.width / PIECES_X;
  const pieceH = bubbleRect.height / PIECES_Y;
  const inset = 1;

  for (let iy = 0; iy < PIECES_Y; iy += 1) {
    for (let ix = 0; ix < PIECES_X; ix += 1) {
      const index = iy * PIECES_X + ix;
      const piece = document.createElement("span");
      piece.className = "delete-crumb";
      piece.style.cssText = [
        "position:absolute",
        "box-sizing:border-box",
        // Relative to the frame, which is the chat's visible box.
        `left:${Math.round(bubbleRect.left - frame.left + ix * pieceW) + inset}px`,
        `top:${Math.round(bubbleRect.top - frame.top + iy * pieceH) + inset}px`,
        `width:${Math.max(1, Math.round(pieceW) - inset * 2)}px`,
        `height:${Math.max(1, Math.round(pieceH) - inset * 2)}px`,
        `border-radius:${radius}px`,
      ].join(";");
      piece.dataset.mine = mine ? "1" : "0";

      // Centre-out drift: outer pieces travel further, all of them fall a little
      // faster than they slide, with a slight rotation.
      const cx = (ix + 0.5) / PIECES_X - 0.5;
      const cy = (iy + 0.5) / PIECES_Y - 0.5;
      const r1 = seeded(seed, index);
      const r2 = seeded(seed, index + 41);
      piece.style.setProperty("--crumb-dx", `${(cx * 34 + (r1 - 0.5) * 18).toFixed(1)}px`);
      piece.style.setProperty("--crumb-dy", `${(10 + (cy + 0.5) * 20 + r2 * 16).toFixed(1)}px`);
      piece.style.setProperty("--crumb-rot", `${((r1 - 0.5) * 44).toFixed(1)}deg`);
      piece.style.setProperty("--crumb-delay", `${(r2 * 40).toFixed(0)}ms`);
      layer.appendChild(piece);
    }
  }

  host.appendChild(layer);
  // The row unmounts at DELETE_EXIT_MS; the last pieces outlive it by a beat.
  window.setTimeout(() => layer.remove(), PIECE_MS + 80);
}

interface ExitTargets {
  /** The row that owns the height, i.e. `.message-item`. */
  row: HTMLElement;
  /** The bubble that crumbles, i.e. `.message-bubble`. */
  bubble: HTMLElement;
  /** Stable seed (the message id) so the flight is deterministic. */
  seed: string;
}

/**
 * Runs the whole exit on a row that is about to be removed: the bubble breaks
 * apart, the row collapses, and the scroller is nudged so the content below the
 * gap does not move.
 */
export function runDeleteExit({ row, bubble, seed }: ExitTargets): void {
  if (row.dataset.exit === "1") return;
  row.dataset.exit = "1";
  row.style.pointerEvents = "none";

  const duration = deleteExitDuration();
  const rowHeight = row.getBoundingClientRect().height;
  if (rowHeight <= 0) return;

  if (duration === 0) {
    // Reduced motion: no flight, no pieces — just close the gap.
    row.style.height = "0px";
    row.style.opacity = "0";
    return;
  }

  const scroller = row.closest<HTMLElement>(".message-scroll");
  explode(bubble, scroller, seed);

  // A witness below the gap. Holding its viewport position is exactly
  // «everything below stays, everything above slides down».
  const witness = row.nextElementSibling as HTMLElement | null;
  const witnessTop = witness ? witness.getBoundingClientRect().top : null;

  const raf = typeof requestAnimationFrame === "function"
    ? requestAnimationFrame
    : (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 16);

  // Pin the current height, then collapse on the next frame so the transition
  // has two real endpoints. `overflow: hidden` is safe because the pieces live
  // in their own fixed layer, not in this row: the message is clipped away by
  // the closing gap instead of sliding over the row below it.
  row.style.height = `${rowHeight}px`;
  row.style.overflow = "hidden";
  row.style.transition = `height ${duration}ms ${EASING}, opacity ${FADE_MS}ms linear`;
  raf(() => {
    row.style.height = "0px";
    row.style.opacity = "0";
  });

  if (!scroller || !witness || witnessTop === null) return;

  const started = typeof performance !== "undefined" ? performance.now() : 0;
  const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 2;
  if (atBottom) {
    // Reading at the bottom: the list must stay glued to it while the gap
    // closes, so every message above slides down into place. Browser scroll
    // anchoring would instead hold the DELETED row's bottom edge and leave a
    // blank strip above the composer that snaps shut at the end — the jump this
    // animation exists to avoid. One write per frame, only in this case.
    const pin = () => {
      scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight;
      const elapsed = (typeof performance !== "undefined" ? performance.now() : 0) - started;
      if (elapsed < duration + 60) raf(pin);
    };
    raf(pin);
    return;
  }

  const compensate = () => {
    // One rect read per frame. A write only when the content below drifted —
    // on engines with anchoring the drift is already 0 and we touch nothing.
    const drift = witness.getBoundingClientRect().top - witnessTop;
    if (Math.abs(drift) >= 1) scroller.scrollTop += drift;
    const elapsed = (typeof performance !== "undefined" ? performance.now() : 0) - started;
    if (elapsed < duration + 60) raf(compensate);
  };
  raf(compensate);
}
