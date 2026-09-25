// A gallery block: one or more media nodes laid out together (grid / mosaic /
// carousel). The media nodes stay real mediaBlock nodes, so each one is still
// editable/resizable inside the group.

import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { MediaGroupNodeView } from "./MediaGroupNodeView";
import {
  DEFAULT_MEDIA_GROUP_ATTRS,
  MEDIA_GROUP_LAYOUTS,
  MEDIA_GROUP_NODE,
  type MediaGroupLayout,
} from "./mediaSchema";

export const MediaGroupNode = Node.create({
  name: MEDIA_GROUP_NODE,
  group: "block",
  // A gallery holds media, and transiently the upload placeholders that become
  // media once their upload finishes (a multi-file insert starts as a group of
  // placeholders).
  content: "(mediaBlock | uploadPlaceholder)+",
  defining: true,

  addAttributes() {
    return {
      layout: {
        default: DEFAULT_MEDIA_GROUP_ATTRS.layout,
        parseHTML: (element) => {
          const value = element.getAttribute("data-layout");
          return MEDIA_GROUP_LAYOUTS.includes(value as MediaGroupLayout)
            ? value
            : DEFAULT_MEDIA_GROUP_ATTRS.layout;
        },
        renderHTML: (attributes) => ({ "data-layout": attributes.layout }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-media-group]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-media-group": "true" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MediaGroupNodeView);
  },
});
