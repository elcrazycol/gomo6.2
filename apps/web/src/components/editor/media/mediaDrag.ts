// Pointer-based media dragging.
//
// Native HTML5 drag-and-drop gives no control over the cursor (the OS shows
// its own drag cursor) and keeps a translucent "ghost" of the element. This
// implementation uses pointer events instead: the body cursor becomes a
// grabbing hand, a custom caret shows the drop position, and there is no ghost.
//
// When the pointer is over (or near) another media node, the drop merges the
// dragged media into a gallery with that node instead of moving it.

import type { Editor } from "@tiptap/core";
import { MEDIA_BLOCK_NODE } from "./mediaSchema";
import { mergeMediaTransaction, moveNodeToPos, resolveDropPosition, type MergeSide } from "./mediaCommands";

export interface StartMediaDragOptions {
  editor: Editor;
  sourcePos: number;
  clientX: number;
  clientY: number;
  onStart?: () => void;
  onEnd?: () => void;
}

const CARET_STYLE = [
  "position:fixed",
  "z-index:9999",
  "width:2px",
  "border-radius:2px",
  "background:hsl(var(--primary))",
  "pointer-events:none",
].join(";");

interface MergeTarget {
  pos: number;
  side: MergeSide;
  el: HTMLElement;
}

/** Begin dragging the media node at `sourcePos`. Resolves the drop on pointerup. */
export const startMediaDrag = ({
  editor,
  sourcePos,
  clientX,
  clientY,
  onStart,
  onEnd,
}: StartMediaDragOptions): void => {
  const view = editor.view;
  if (editor.isDestroyed || !view) return;

  let targetPos: number | null = null;
  let caret: HTMLDivElement | null = null;
  let mergeTarget: MergeTarget | null = null;

  const clearMerge = () => {
    if (mergeTarget) {
      mergeTarget.el.classList.remove("media-merge-target");
      mergeTarget = null;
    }
  };

  const hideCaret = () => {
    if (caret) caret.style.display = "none";
  };

  /** Document position of the media node whose DOM is `element`. */
  const mediaPosForElement = (element: HTMLElement): number | null => {
    let found: number | null = null;
    view.state.doc.descendants((node, pos) => {
      if (found !== null) return false;
      if (node.type.name !== MEDIA_BLOCK_NODE) return true;
      let dom: Node | null = null;
      try {
        dom = view.nodeDOM(pos);
      } catch {
        dom = null;
      }
      if (dom === element) {
        found = pos;
        return false;
      }
      return true;
    });
    if (found !== null) return found;
    // Fallback: resolve through the DOM position.
    try {
      const domPos = view.posAtDOM(element, 0);
      for (const candidate of [domPos, domPos - 1, domPos + 1]) {
        const node = view.state.doc.nodeAt(candidate);
        if (node && node.type.name === MEDIA_BLOCK_NODE) return candidate;
      }
    } catch {
      // posAtDOM can throw for detached nodes
    }
    return null;
  };

  /** A media node under/near the pointer (other than the source), if any. */
  const findMergeTarget = (x: number, y: number): MergeTarget | null => {
    clearMerge();
    // What is actually under the pointer: this also works when a media's hover
    // toolbar is on top (it is a descendant of the media node).
    let element: HTMLElement | null = null;
    if (typeof document.elementFromPoint === "function") {
      try {
        const under = document.elementFromPoint(x, y) as HTMLElement | null;
        element = (under?.closest?.("[data-media-block]") as HTMLElement | null) ?? null;
      } catch {
        element = null;
      }
    }
    // Fallback: nearest media by rect (covers the small gap around a media).
    if (!element) {
      let bestDist = Number.POSITIVE_INFINITY;
      view.state.doc.descendants((node, pos) => {
        if (node.type.name !== MEDIA_BLOCK_NODE || pos === sourcePos) return true;
        let el: HTMLElement | null = null;
        try {
          el = view.nodeDOM(pos) as HTMLElement | null;
        } catch {
          return true;
        }
        if (!el || typeof el.getBoundingClientRect !== "function") return true;
        const rect = el.getBoundingClientRect();
        const pad = 10;
        if (x < rect.left - pad || x > rect.right + pad || y < rect.top - pad || y > rect.bottom + pad) return true;
        const distance = Math.abs(x - (rect.left + rect.width / 2));
        if (distance < bestDist) {
          bestDist = distance;
          element = el;
        }
        return true;
      });
    }
    if (!element) return null;

    const pos = mediaPosForElement(element);
    if (pos === null || pos === sourcePos) return null;

    const rect = element.getBoundingClientRect();
    const target: MergeTarget = { pos, side: x < rect.left + rect.width / 2 ? "before" : "after", el: element };
    element.classList.add("media-merge-target");
    mergeTarget = target;
    return target;
  };

  /**
   * Position inside the empty line under the pointer, if any. Determined by
   * geometry over the document blocks (nodeDOM + their rects), NOT posAtCoords:
   * that depends on X, so a pointer anywhere but the very start of an empty
   * line used to resolve past it.
   */
  const emptyLinePosAt = (_x: number, y: number): number | null => {
    const doc = view.state.doc;
    let pos = 0;
    let strictAny = false;
    let strictEmpty: number | null = null;
    let nearEmpty: number | null = null;
    let nearDist = Number.POSITIVE_INFINITY;

    for (let i = 0; i < doc.childCount; i += 1) {
      const node = doc.child(i);
      let dom: HTMLElement | null = null;
      try {
        dom = view.nodeDOM(pos) as HTMLElement | null;
      } catch {
        dom = null;
      }
      if (!dom && view.dom.children.length === doc.childCount) {
        dom = view.dom.children[i] as HTMLElement;
      }
      const isEmpty = node.isTextblock && node.content.size === 0;
      if (dom && typeof dom.getBoundingClientRect === "function") {
        const rect = dom.getBoundingClientRect();
        const inside = y >= rect.top && y <= rect.bottom;
        if (inside) {
          strictAny = true;
          if (isEmpty) strictEmpty = pos + 1;
        } else if (isEmpty) {
          const distance = y < rect.top ? rect.top - y : y - rect.bottom;
          if (distance < nearDist) {
            nearDist = distance;
            nearEmpty = pos + 1;
          }
        }
      }
      pos += node.nodeSize;
    }

    if (strictEmpty !== null) return strictEmpty;
    if (!strictAny && nearEmpty !== null && nearDist <= 12) return nearEmpty;
    return null;
  };

  const placeCaret = (clientXValue: number, clientYValue: number) => {
    // Media under the pointer wins: the drop merges into a gallery.
    if (findMergeTarget(clientXValue, clientYValue)) {
      hideCaret();
      return;
    }
    const emptyLinePos = emptyLinePosAt(clientXValue, clientYValue);
    if (emptyLinePos !== null) {
      targetPos = emptyLinePos;
    } else {
      const coords = view.posAtCoords({ left: clientXValue, top: clientYValue });
      if (coords) targetPos = coords.pos;
    }
    if (targetPos === null) return;
    const resolved = resolveDropPosition(view.state.doc, targetPos);
    const caretPos = resolved ? resolved.pos : targetPos;
    try {
      const rect = view.coordsAtPos(caretPos);
      let { top, bottom, left } = rect;
      const $c = view.state.doc.resolve(caretPos);
      if ($c.parent.inlineContent && $c.parent.content.size === 0) {
        let blockDom: HTMLElement | null = null;
        try {
          blockDom = view.nodeDOM($c.before($c.depth)) as HTMLElement | null;
        } catch {
          blockDom = null;
        }
        if (blockDom && typeof blockDom.getBoundingClientRect === "function") {
          const box = blockDom.getBoundingClientRect();
          if (box.height > 0) {
            top = box.top;
            bottom = box.bottom;
            left = Math.max(box.left, left);
          }
        }
      }
      if (!caret) {
        caret = document.createElement("div");
        caret.setAttribute("data-media-drop-caret", "true");
        caret.style.cssText = CARET_STYLE;
        document.body.appendChild(caret);
      }
      caret.style.display = "block";
      caret.style.left = `${left}px`;
      caret.style.top = `${top}px`;
      caret.style.height = `${Math.max(8, bottom - top)}px`;
    } catch {
      hideCaret();
    }
  };

  const cleanup = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    document.removeEventListener("mousedown", blockMouseDown, true);
    document.body.classList.remove("media-dragging");
    clearMerge();
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    if (caret) {
      caret.remove();
      caret = null;
    }
    onEnd?.();
  };

  // Keep ProseMirror from starting its own native node drag alongside ours.
  function blockMouseDown(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
  }

  function onMove(event: PointerEvent) {
    placeCaret(event.clientX, event.clientY);
  }
  function onUp() {
    const merge = mergeTarget ? { pos: mergeTarget.pos, side: mergeTarget.side } : null;
    const target = targetPos;
    const destroyed = editor.isDestroyed;
    cleanup();
    if (destroyed) return;
    if (merge) {
      const tr = mergeMediaTransaction(view.state, sourcePos, merge.pos, merge.side);
      if (tr) view.dispatch(tr);
      return;
    }
    if (target !== null) {
      const tr = moveNodeToPos(view.state, sourcePos, target);
      if (tr) view.dispatch(tr);
    }
  }
  function onCancel() {
    cleanup();
  }

  document.body.style.cursor = "grabbing";
  document.body.style.userSelect = "none";
  // Hide the media toolbars while dragging so they do not pop up over the
  // target and get in the way of the merge affordance.
  document.body.classList.add("media-dragging");
  onStart?.();
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
  document.addEventListener("mousedown", blockMouseDown, true);
  // Show the caret immediately, at the grab point.
  placeCaret(clientX, clientY);
};
