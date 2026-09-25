// Insertion command for spoiler blocks.

import type { Editor } from "@tiptap/core";

import { blockInsertPos } from "@/components/editor/media/mediaCommands";
import { SPOILER_BLOCK_NODE, clampSpoilerLabel } from "./spoilerSchema";

/** Insert an empty spoiler block (with the given label) at the caret. */
export const insertSpoilerBlock = (editor: Editor, label: string, at?: number): void => {
  const position = blockInsertPos(editor.state, at);
  editor
    .chain()
    .focus()
    .insertContentAt(position, {
      type: SPOILER_BLOCK_NODE,
      attrs: { label: clampSpoilerLabel(label) },
      content: [{ type: "paragraph" }],
    })
    .setTextSelection(position + 2)
    .run();
};
