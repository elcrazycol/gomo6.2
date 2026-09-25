// Media-node editing operations.
//
// Media are inline nodes, so they live inside paragraphs and can be placed
// between characters/words. The tricky parts (reordering, replacing a
// placeholder) are pure transaction builders so they can be unit-tested
// against a plain ProseMirror state without mounting a React NodeView. The
// `*Editor` wrappers below are thin dispatchers used by the NodeView/composer.

import type { Editor } from "@tiptap/core";
import { Fragment, type Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, type EditorState, type Transaction } from "@tiptap/pm/state";

import {
  MEDIA_BLOCK_NODE,
  MEDIA_GROUP_NODE,
  UPLOAD_PLACEHOLDER_NODE,
  type MediaBlockAttrs,
} from "./mediaSchema";

export type MoveDirection = "up" | "down";

/** Find the document position of the first node matching a predicate. */
export const findNodePos = (
  doc: PMNode,
  typeName: string,
  match: (node: PMNode) => boolean = () => true,
): number | null => {
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.type.name === typeName && match(node)) {
      found = pos;
      return false;
    }
    return true;
  });
  return found;
};

export const findUploadPlaceholderPos = (doc: PMNode, uploadId: string): number | null =>
  findNodePos(doc, UPLOAD_PLACEHOLDER_NODE, (node) => node.attrs.uploadId === uploadId);

/**
 * Move the inline node at `pos` one step. Within a paragraph it swaps with the
 * neighbouring inline node (horizontal move); at the edge of the paragraph it
 * hops into the previous/next block (a line up/down). Returns null when there
 * is nowhere to go.
 */
export const moveTransaction = (
  state: EditorState,
  pos: number,
  direction: MoveDirection,
): Transaction | null => {
  const node = state.doc.nodeAt(pos);
  if (!node) return null;
  const $pos = state.doc.resolve(pos);
  if ($pos.depth === 0) return null;
  const parent = $pos.parent;
  const index = $pos.index();
  const hasPrevSibling = index > 0;
  const hasNextSibling = index + 1 < parent.childCount;

  if (direction === "up" && hasPrevSibling) {
    const prev = parent.child(index - 1);
    const from = pos - prev.nodeSize;
    const to = pos + node.nodeSize;
    const tr = state.tr.replaceWith(from, to, Fragment.fromArray([node, prev]));
    tr.setSelection(NodeSelection.create(tr.doc, from));
    return tr;
  }
  if (direction === "down" && hasNextSibling) {
    const next = parent.child(index + 1);
    const from = pos;
    const to = pos + node.nodeSize + next.nodeSize;
    const tr = state.tr.replaceWith(from, to, Fragment.fromArray([next, node]));
    tr.setSelection(NodeSelection.create(tr.doc, from + next.nodeSize));
    return tr;
  }

  // Cross-block hop.
  const blockIndex = $pos.index(0);
  if (direction === "up") {
    if (blockIndex === 0) return null;
    // Just before the previous block's closing token = end of its content.
    const insertAt = $pos.before(1) - 1;
    const tr = state.tr.insert(insertAt, node);
    // The original sits after insertAt, so it shifted by node.nodeSize.
    tr.delete(pos + node.nodeSize, pos + node.nodeSize * 2);
    tr.setSelection(NodeSelection.create(tr.doc, insertAt));
    return tr;
  }
  if (blockIndex >= state.doc.childCount - 1) return null;
  // Just after the next block's opening token = start of its content.
  const insertAt = $pos.after(1) + 1;
  const tr = state.tr.insert(insertAt, node);
  // The original sits before insertAt, so the inserted node shifts left.
  tr.delete(pos, pos + node.nodeSize);
  tr.setSelection(NodeSelection.create(tr.doc, insertAt - node.nodeSize));
  return tr;
};

/**
 * Build a transaction that turns an upload placeholder into a real media node.
 * Marked addToHistory:false per the plan — an upload completing should not
 * pollute undo (undoing it would resurrect a dead placeholder).
 */
export const replacePlaceholderTransaction = (
  state: EditorState,
  uploadId: string,
  attrs: MediaBlockAttrs,
): Transaction | null => {
  const pos = findUploadPlaceholderPos(state.doc, uploadId);
  if (pos === null) return null;
  const node = state.doc.nodeAt(pos);
  const mediaType = state.schema.nodes[MEDIA_BLOCK_NODE];
  if (!node || !mediaType) return null;
  const newNode = mediaType.create(attrs);
  return state.tr
    .replaceWith(pos, pos + node.nodeSize, newNode)
    .setMeta("addToHistory", false);
};

/** Build a transaction updating an upload placeholder's progress attrs. */
export const updatePlaceholderTransaction = (
  state: EditorState,
  uploadId: string,
  patch: Record<string, unknown>,
): Transaction | null => {
  const pos = findUploadPlaceholderPos(state.doc, uploadId);
  if (pos === null) return null;
  const node = state.doc.nodeAt(pos);
  if (!node) return null;
  return state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...patch });
};

/** Build a transaction deleting an upload placeholder (e.g. failed upload). */
export const removePlaceholderTransaction = (
  state: EditorState,
  uploadId: string,
): Transaction | null => {
  const pos = findUploadPlaceholderPos(state.doc, uploadId);
  if (pos === null) return null;
  const node = state.doc.nodeAt(pos);
  if (!node) return null;
  return state.tr.delete(pos, pos + node.nodeSize);
};

// ── Editor wrappers ─────────────────────────────────────────────────────────

export const moveMediaNode = (editor: Editor, pos: number, direction: MoveDirection): boolean => {
  const tr = moveTransaction(editor.state, pos, direction);
  if (!tr) return false;
  editor.view.dispatch(tr);
  editor.view.focus();
  return true;
};

export type MergeSide = "before" | "after";

/**
 * Merge the media node at `sourcePos` into the media node at `targetPos`.
 *
 * - target already in a mediaGroup → the source is inserted next to it;
 * - target standalone → a new gallery is created (replacing the target's
 *   paragraph when that paragraph held only the target).
 *
 * `side` is which half of the target the pointer was over (dragging to the
 * left half puts the source before the target).
 */
export const mergeMediaTransaction = (
  state: EditorState,
  sourcePos: number,
  targetPos: number,
  side: MergeSide,
): Transaction | null => {
  const sourceNode = state.doc.nodeAt(sourcePos);
  if (!sourceNode || sourceNode.type.name !== MEDIA_BLOCK_NODE) return null;
  const sourceEnd = sourcePos + sourceNode.nodeSize;
  if (targetPos >= sourcePos && targetPos <= sourceEnd) return null;
  const targetType = state.doc.nodeAt(targetPos)?.type.name;
  if (targetType !== MEDIA_BLOCK_NODE) return null;
  const groupType = state.schema.nodes[MEDIA_GROUP_NODE];
  if (!groupType) return null;

  const tr = state.tr.delete(sourcePos, sourceEnd);
  const tPos = targetPos > sourceEnd ? targetPos - sourceNode.nodeSize : targetPos;
  const $target = tr.doc.resolve(tPos);
  const parent = $target.parent;

  if (parent.type.name === MEDIA_GROUP_NODE) {
    const insertIndex = Math.max(0, Math.min($target.index() + (side === "after" ? 1 : 0), parent.childCount));
    let childPos = $target.start();
    for (let i = 0; i < insertIndex; i += 1) childPos += parent.child(i).nodeSize;
    tr.insert(childPos, sourceNode);
    return tr;
  }

  const targetNode = tr.doc.nodeAt(tPos);
  if (!targetNode) return null;
  const first = side === "after" ? targetNode : sourceNode;
  const second = side === "after" ? sourceNode : targetNode;
  const group = groupType.create({ layout: "grid" }, [first, second]);

  const blockDepth = $target.depth;
  const blockStart = $target.before(blockDepth);
  const blockEnd = $target.after(blockDepth);
  const blockNode = tr.doc.nodeAt(blockStart);
  const paragraphOnlyMedia = blockNode?.type.name === "paragraph" && blockNode.childCount === 1;

  if (paragraphOnlyMedia) {
    tr.replaceWith(blockStart, blockEnd, group);
  } else {
    tr.delete(tPos, tPos + targetNode.nodeSize);
    const endNow = blockStart + (blockNode ? blockNode.nodeSize - targetNode.nodeSize : 0);
    tr.insert(endNow, group);
  }
  return tr;
};

export const mergeMedia = (
  editor: Editor,
  sourcePos: number,
  targetPos: number,
  side: MergeSide,
): boolean => {
  const tr = mergeMediaTransaction(editor.state, sourcePos, targetPos, side);
  if (!tr) return false;
  editor.view.dispatch(tr);
  editor.view.focus();
  return true;
};

/**
 * Dissolve a mediaGroup, leaving its media in a normal paragraph (natural
 * inline flow) so they are no longer constrained by a gallery layout.
 */
export const ungroupTransaction = (state: EditorState, groupPos: number): Transaction | null => {
  const groupNode = state.doc.nodeAt(groupPos);
  if (!groupNode || groupNode.type.name !== MEDIA_GROUP_NODE) return null;
  const paragraphType = state.schema.nodes.paragraph;
  if (!paragraphType) return null;
  const children: PMNode[] = [];
  groupNode.forEach((child) => children.push(child));
  const paragraph = paragraphType.create(null, children);
  return state.tr.replaceWith(groupPos, groupPos + groupNode.nodeSize, paragraph);
};

export const ungroupMediaGroup = (editor: Editor, groupPos: number): boolean => {
  const tr = ungroupTransaction(editor.state, groupPos);
  if (!tr) return false;
  editor.view.dispatch(tr);
  return true;
};

export const replaceUploadPlaceholder = (
  editor: Editor,
  uploadId: string,
  attrs: MediaBlockAttrs,
): boolean => {
  const tr = replacePlaceholderTransaction(editor.state, uploadId, attrs);
  if (!tr) return false;
  editor.view.dispatch(tr);
  return true;
};

export const updateUploadPlaceholder = (
  editor: Editor,
  uploadId: string,
  patch: Record<string, unknown>,
): void => {
  const tr = updatePlaceholderTransaction(editor.state, uploadId, patch);
  if (tr) editor.view.dispatch(tr);
};

export const removeUploadPlaceholder = (editor: Editor, uploadId: string): void => {
  const tr = removePlaceholderTransaction(editor.state, uploadId);
  if (tr) editor.view.dispatch(tr);
};

/** Insert inline placeholder nodes at the given position (or the caret). */
export const insertUploadPlaceholders = (
  editor: Editor,
  placeholders: Array<{ uploadId: string; kind: string; name: string }>,
  at?: number,
): void => {
  if (placeholders.length === 0) return;
  const pos = typeof at === "number" ? at : editor.state.selection.from;
  const content = placeholders.map((placeholder) => ({
    type: UPLOAD_PLACEHOLDER_NODE,
    attrs: { uploadId: placeholder.uploadId, kind: placeholder.kind, name: placeholder.name, percent: 0, phase: "upload", error: null },
  }));
  editor.chain().insertContentAt(pos, content).run();
};

/** A block-level position near `at` (or the caret), for block insertions. */
export const blockInsertPos = (state: EditorState, at?: number): number => {
  const raw = at ?? state.selection.from;
  const clamped = Math.max(0, Math.min(raw, state.doc.content.size));
  const $pos = state.doc.resolve(clamped);
  if ($pos.depth === 0) return $pos.pos;
  return $pos.after(1);
};

/**
 * Insert several upload placeholders as one media gallery (a mediaGroup block)
 * so a multi-file drop/paste lands as a grid, not a stack.
 */
export const insertMediaGroupWithPlaceholders = (
  editor: Editor,
  placeholders: Array<{ uploadId: string; kind: string; name: string }>,
  at?: number,
): void => {
  if (placeholders.length === 0) return;
  const pos = blockInsertPos(editor.state, at);
  const content = placeholders.map((placeholder) => ({
    type: UPLOAD_PLACEHOLDER_NODE,
    attrs: { uploadId: placeholder.uploadId, kind: placeholder.kind, name: placeholder.name, percent: 0, phase: "upload", error: null },
  }));
  editor.chain().insertContentAt(pos, { type: MEDIA_GROUP_NODE, attrs: { layout: "grid" }, content }).run();
};

/** Insert a ready inline media node at the given position (or the caret). */
export const insertMediaBlock = (editor: Editor, attrs: MediaBlockAttrs, at?: number): void => {
  const pos = typeof at === "number" ? at : editor.state.selection.from;
  editor.chain().insertContentAt(pos, { type: MEDIA_BLOCK_NODE, attrs }).run();
};

export interface DropPosition {
  pos: number;
  /** True when the media should become its own new paragraph at `pos`. */
  ownParagraph: boolean;
}

/**
 * Resolve a raw `posAtCoords` position into an actual drop position.
 *
 * The subtle part is empty lines: hovering an empty paragraph, `posAtCoords`
 * often returns the boundary *after* it, which drew the caret a couple of lines
 * too low. Here an adjacent empty textblock is preferred, so hovering an empty
 * line targets that very line.
 */
export const resolveDropPosition = (doc: PMNode, targetPos: number): DropPosition | null => {
  const clamped = Math.max(0, Math.min(targetPos, doc.content.size));
  const $t = doc.resolve(clamped);
  if ($t.parent.inlineContent) {
    const offset = $t.parentOffset;
    const lineSize = $t.parent.content.size;
    // Empty line: land inside it (it becomes the media's line).
    if (lineSize === 0) return { pos: $t.pos, ownParagraph: false };
    // Middle of a line → inline; start/end → own line above/below.
    if (offset <= 0) return { pos: $t.before($t.depth), ownParagraph: true };
    if (offset >= lineSize) return { pos: $t.after($t.depth), ownParagraph: true };
    return { pos: $t.pos, ownParagraph: false };
  }
  const before = $t.nodeBefore;
  const after = $t.nodeAfter;
  // Boundary next to an empty block → land inside that empty block.
  if (before && before.isTextblock && before.content.size === 0) {
    return { pos: $t.pos - 1, ownParagraph: false };
  }
  if (after && after.isTextblock && after.content.size === 0) {
    return { pos: $t.pos + 1, ownParagraph: false };
  }
  if (after && after.isTextblock) return { pos: $t.pos, ownParagraph: true };
  if (before && before.isTextblock) return { pos: $t.pos, ownParagraph: true };
  return null;
};

/**
 * Move a media node to a drop position.
 *
 * When the target resolves to a text position the media is inserted inline at
 * the caret (dropped "into" a line). When it lands on a block boundary — the
 * gap between two paragraphs — the media is placed in its own new paragraph,
 * so you can drop it "between the lines". An empty line is used as-is.
 */
export const moveNodeToPos = (
  state: EditorState,
  sourcePos: number,
  targetPos: number,
): Transaction | null => {
  const node = state.doc.nodeAt(sourcePos);
  if (!node || node.type.name !== MEDIA_BLOCK_NODE) return null;
  const sourceEnd = sourcePos + node.nodeSize;
  // Dropped within its own span (or on itself) — nothing to do.
  if (targetPos >= sourcePos && targetPos <= sourceEnd) return null;

  const target = resolveDropPosition(state.doc, targetPos);
  if (!target) return null;
  const { pos: insertPos, ownParagraph } = target;
  if (insertPos >= sourcePos && insertPos <= sourceEnd) return null;

  const tr = state.tr.delete(sourcePos, sourceEnd);
  const at = insertPos > sourceEnd ? insertPos - node.nodeSize : insertPos;
  if (ownParagraph) {
    const paragraphType = state.schema.nodes.paragraph;
    if (!paragraphType) return null;
    tr.insert(at, paragraphType.create(null, node));
    try {
      tr.setSelection(NodeSelection.create(tr.doc, at + 1));
    } catch {
      // selection is best-effort
    }
  } else {
    tr.insert(at, node);
    try {
      tr.setSelection(NodeSelection.create(tr.doc, at));
    } catch {
      // selection is best-effort
    }
  }
  return tr;
};

/** Count mediaBlock nodes in the editor. */
export const countMediaNodes = (editor: Editor): number => {
  let count = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === MEDIA_BLOCK_NODE) count += 1;
    return true;
  });
  return count;
};

/** Count in-flight upload placeholders in the editor. */
export const countUploadPlaceholders = (editor: Editor): number => {
  let count = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === UPLOAD_PLACEHOLDER_NODE) count += 1;
    return true;
  });
  return count;
};
