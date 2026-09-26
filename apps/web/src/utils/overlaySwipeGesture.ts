// Gate for the "swipe right to close" gesture on full-screen post overlays.
//
// Framer Motion attaches its drag listener natively on the overlay element, so
// an inner control cannot stop the gesture from starting with a React
// `stopPropagation()`. We therefore disable that listener and start the drag
// ourselves — but only when the pointer went down somewhere that does not have
// a horizontal gesture of its own.
//
// Motivating bug: dragging the "до/после" compare handle swiped the whole post
// off screen instead of moving the divider.

/**
 * Elements that own their horizontal pointer gesture. A swipe-close must never
 * start on one of these:
 *  - form / text controls, where a horizontal drag selects text or scrubs;
 *  - the before/after compare slider, whose whole purpose is a horizontal drag
 *    on the very same axis as the close gesture;
 *  - tap targets (links, buttons) so a drag can't swallow their click;
 *  - media with native controls, plus any element that opts out explicitly.
 */
export const GESTURE_OWNING_SELECTOR = [
  "input",
  "textarea",
  "select",
  "summary",
  "button",
  "a",
  "[role='button']",
  "[role='slider']",
  "[contenteditable='true']",
  "video",
  "audio",
  "[data-compare-wrapper]",
  "[data-compare-handle]",
  "[data-no-swipe-close]",
].join(",");

/** True when a pointerdown on `target` is allowed to drag-close the overlay. */
export const canStartOverlayDrag = (target: EventTarget | null): boolean => {
  if (!(target instanceof Element)) return false;
  if (target.closest(GESTURE_OWNING_SELECTOR)) return false;

  // A horizontally scrollable ancestor (e.g. a media carousel) owns the
  // horizontal gesture too: swiping inside it must scroll it, not close the post.
  for (let el: Element | null = target; el; el = el.parentElement) {
    if (el.scrollWidth <= el.clientWidth + 1) continue;
    const overflowX = window.getComputedStyle(el).overflowX;
    if (overflowX === "auto" || overflowX === "scroll") return false;
  }

  return true;
};
