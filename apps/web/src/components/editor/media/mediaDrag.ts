// Pointer-based media dragging.
//
// Native HTML5 drag-and-drop gives no control over the cursor (the OS shows
// its own drag cursor) and keeps a translucent "ghost" of the element. This
// implementation uses pointer events instead: the body cursor becomes a
// grabbing hand, a custom caret shows the drop position, and there is no ghost.

import type { Editor } from "@tiptap/core";
import { moveNodeToPos, resolveDropPosition } from "./mediaCommands";

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

  /**
   * Position inside the empty line under the pointer, if any.
   *
   * Determined by geometry over the document blocks (`nodeDOM` + their rects),
   * NOT by `posAtCoords`: that depends on X, so a pointer anywhere but the very
   * start of an empty line used to resolve past it. This matches the block at
   * the pointer's Y regardless of X.
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
      const dom =
        (view.nodeDOM(pos) as HTMLElement | null) ??
        (view.dom.children.length === doc.childCount ? (view.dom.children[i] as HTMLElement) : null);
      const isEmpty = node.isTextblock && node.content.size === 0;
      if (dom && typeof dom.getBoundingClientRect === "function") {
        const rect = dom.getBoundingClientRect();
        const inside = y >= rect.top && y <= rect.bottom;
        if (inside) {
          strictAny = true;
          if (isEmpty) strictEmpty = pos + 1;
        } else if (isEmpty) {
          // Empty lines can have a near-zero hit box; remember the closest one.
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
    // Pointer is in a gap / on a zero-height empty line and nothing contains it.
    if (!strictAny && nearEmpty !== null && nearDist <= 12) return nearEmpty;
    return null;
  };

  const placeCaret = (clientXValue: number, clientYValue: number) => {
    const emptyLinePos = emptyLinePosAt(clientXValue, clientYValue);
    if (emptyLinePos !== null) {
      targetPos = emptyLinePos;
    } else {
      const coords = view.posAtCoords({ left: clientXValue, top: clientYValue });
      if (coords) targetPos = coords.pos;
    }
    if (targetPos === null) return;
    // Anchor the caret at the resolved position. resolveDropPosition prefers an
    // adjacent empty line, so hovering one no longer draws the caret below it.
    const resolved = resolveDropPosition(view.state.doc, targetPos);
    const caretPos = resolved ? resolved.pos : targetPos;
    try {
      const rect = view.coordsAtPos(caretPos);
      let { top, bottom, left } = rect;
      // Empty line: pin the caret to that block's own rect so it can never be
      // drawn on a different line (the earlier "a couple lines lower" bug).
      const $c = view.state.doc.resolve(caretPos);
      if ($c.parent.inlineContent && $c.parent.content.size === 0) {
        const blockDom = view.nodeDOM($c.before($c.depth)) as HTMLElement | null;
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
      if (caret) caret.style.display = "none";
    }
  };

  const cleanup = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    document.removeEventListener("mousedown", blockMouseDown, true);
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
    const target = targetPos;
    const destroyed = editor.isDestroyed;
    cleanup();
    if (destroyed || target === null) return;
    const tr = moveNodeToPos(view.state, sourcePos, target);
    if (tr) view.dispatch(tr);
  }
  function onCancel() {
    cleanup();
  }

  document.body.style.cursor = "grabbing";
  document.body.style.userSelect = "none";
  onStart?.();
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
  document.addEventListener("mousedown", blockMouseDown, true);
  // Show the caret immediately, at the grab point.
  placeCaret(clientX, clientY);
};
