/**
 * DEV-only, on-device scroll diagnostics.
 *
 * Enable from the browser/Web Inspector console and reload:
 *   localStorage.setItem('gomo6:scroll-debug', '1')
 *
 * The scroll physics cannot be reproduced headless, and a jump cannot be told
 * from a scroll-compensation by looking at the DOM alone. So the sampler tracks
 * user gestures and only reports a jump while the user is IDLE: when no
 * wheel/touch/pointer/key input happened recently, the tracked message must stay
 * at the same screen Y — any movement is a real, visible jump.
 *
 * Log lines (`[scroll]` prefix):
 *   [scroll] JUMP shift=… id=… st=…   the tracked message moved on screen while
 *                                     the user was idle (a real jump)
 *   [scroll] FRAME …ms (long …)       a dropped frame (jank)
 *   [scroll] loadMore start/done      an older page started/finished
 *
 * Disable with `localStorage.removeItem('gomo6:scroll-debug')`.
 */

const FLAG = "gomo6:scroll-debug";
const LONG_FRAME_MS = 32;
const IDLE_MS = 180;

export function isScrollDebugEnabled(): boolean {
  if (!import.meta.env.DEV) return false;
  try {
    return localStorage.getItem(FLAG) === "1";
  } catch {
    return false;
  }
}

/** Log a one-off note (load start/finish, restore jump, …). */
export function scrollDebugNote(message: string): void {
  if (isScrollDebugEnabled()) console.log(`[scroll] ${message}`);
}

function topMostVisible(scroller: HTMLElement): HTMLElement | null {
  for (const el of scroller.querySelectorAll<HTMLElement>(".message-virtual-item")) {
    if (el.getBoundingClientRect().bottom > 0) return el;
  }
  return null;
}

const GESTURES = ["wheel", "touchstart", "touchmove", "pointerdown", "pointermove", "keydown"] as const;

/** Starts the per-frame sampler; returns a stop function. */
export function startScrollDebug(scroller: HTMLElement): () => void {
  let raf = 0;
  let trackedId: string | null = null;
  let lastScreenY: number | null = null;
  let lastFrameAt = performance.now();
  let lastGestureAt = 0;
  let frames = 0;
  let longFrames = 0;

  const markGesture = () => {
    lastGestureAt = performance.now();
  };
  for (const event of GESTURES) scroller.addEventListener(event, markGesture, { passive: true });
  scroller.addEventListener("scroll", markGesture, { passive: true });

  const tick = () => {
    const now = performance.now();
    const dt = now - lastFrameAt;
    lastFrameAt = now;
    frames += 1;
    if (dt > LONG_FRAME_MS) {
      longFrames += 1;
      console.log(`[scroll] FRAME ${Math.round(dt)}ms (long ${longFrames}/${frames})`);
    }

    let el = trackedId
      ? scroller.querySelector<HTMLElement>(`[data-message-id="${trackedId}"]`)
      : null;
    let switched = false;
    if (!el) {
      el = topMostVisible(scroller);
      trackedId = el?.getAttribute("data-message-id") ?? null;
      switched = true;
    }

    if (el) {
      const screenY = Math.round(el.getBoundingClientRect().top);
      const idle = now - lastGestureAt > IDLE_MS;
      if (idle && !switched && lastScreenY !== null && Math.abs(screenY - lastScreenY) > 2) {
        console.log(
          `[scroll] JUMP shift=${screenY - lastScreenY} id=${trackedId} st=${Math.round(scroller.scrollTop)}`,
        );
      }
      lastScreenY = screenY;
    } else {
      lastScreenY = null;
    }

    raf = requestAnimationFrame(tick);
  };

  raf = requestAnimationFrame(tick);
  console.log("[scroll] debug on");
  return () => {
    cancelAnimationFrame(raf);
    for (const event of GESTURES) scroller.removeEventListener(event, markGesture);
    scroller.removeEventListener("scroll", markGesture);
    console.log("[scroll] debug off");
  };
}
