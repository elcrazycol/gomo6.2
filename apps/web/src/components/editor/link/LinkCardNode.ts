import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { LinkCardNodeView } from "./LinkCardNodeView";
import { LINK_CARD_NODE } from "./linkCardSchema";

export const LinkCardNode = Node.create({
  name: LINK_CARD_NODE,
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      url: { default: "" },
      title: { default: "" },
      description: { default: "" },
      image: { default: null },
      siteName: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-link-card]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-link-card": "true" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(LinkCardNodeView);
  },
});
