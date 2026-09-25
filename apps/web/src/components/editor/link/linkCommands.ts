// Insertion command for link cards.

import type { Editor } from "@tiptap/core";

import { blockInsertPos } from "@/components/editor/media/mediaCommands";
import { LINK_CARD_NODE, type LinkCardAttrs } from "./linkCardSchema";

/** Insert a link card at the block position near the caret (or `at`). */
export const insertLinkCard = (editor: Editor, attrs: LinkCardAttrs, at?: number): void => {
  const position = blockInsertPos(editor.state, at);
  editor.chain().focus().insertContentAt(position, { type: LINK_CARD_NODE, attrs }).run();
};
