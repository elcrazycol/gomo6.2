import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { SpoilerBlockNodeView } from "./SpoilerBlockNodeView";
import { SPOILER_BLOCK_NODE } from "./spoilerSchema";

export const SpoilerBlockNode = Node.create({
  name: SPOILER_BLOCK_NODE,
  group: "block",
  // Text, media, galleries, dividers, nested blocks — anything the wall editor
  // can hold can be hidden behind a spoiler.
  content: "block+",
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      label: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-spoiler-block]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-spoiler-block": "true" }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(SpoilerBlockNodeView);
  },
});
