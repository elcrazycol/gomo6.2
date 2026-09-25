// Tiptap node for an inline media block.
//
// Atom (no editable content), block-level, draggable and selectable. The
// NodeView is wired in P1; for P0 the node exists as the schema contract and
// is rendered on the read path by ProseMirrorRenderer → MediaBlockView.

import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { MediaBlockNodeView } from "./MediaBlockNodeView";
import {
  DEFAULT_MEDIA_BLOCK_ATTRS,
  MEDIA_BLOCK_NODE,
  clampMediaWidth,
  type MediaAlign,
} from "./mediaSchema";

const MEDIA_ALIGNS: readonly MediaAlign[] = ["inline", "left", "right", "full"];

export const MediaBlockNode = Node.create({
  name: MEDIA_BLOCK_NODE,
  group: "inline",
  inline: true,
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      attachmentId: {
        default: DEFAULT_MEDIA_BLOCK_ATTRS.attachmentId,
        parseHTML: (element) => element.getAttribute("data-attachment-id"),
        renderHTML: (attributes) => ({ "data-attachment-id": attributes.attachmentId }),
      },
      kind: {
        default: DEFAULT_MEDIA_BLOCK_ATTRS.kind,
        parseHTML: (element) => element.getAttribute("data-kind"),
        renderHTML: (attributes) => ({ "data-kind": attributes.kind }),
      },
      width: {
        default: DEFAULT_MEDIA_BLOCK_ATTRS.width,
        parseHTML: (element) => clampMediaWidth(element.getAttribute("data-width")),
        renderHTML: (attributes) => ({ "data-width": attributes.width }),
      },
      align: {
        default: DEFAULT_MEDIA_BLOCK_ATTRS.align,
        parseHTML: (element) => {
          const value = element.getAttribute("data-align");
          return MEDIA_ALIGNS.includes(value as MediaAlign) ? value : DEFAULT_MEDIA_BLOCK_ATTRS.align;
        },
        renderHTML: (attributes) => ({ "data-align": attributes.align }),
      },
      href: {
        default: DEFAULT_MEDIA_BLOCK_ATTRS.href,
        parseHTML: (element) => element.getAttribute("data-href"),
        renderHTML: (attributes) =>
          attributes.href ? { "data-href": attributes.href } : {},
      },
      caption: {
        default: DEFAULT_MEDIA_BLOCK_ATTRS.caption,
        parseHTML: (element) => element.getAttribute("data-caption"),
        renderHTML: (attributes) =>
          attributes.caption ? { "data-caption": attributes.caption } : {},
      },
      alt: {
        default: DEFAULT_MEDIA_BLOCK_ATTRS.alt,
        parseHTML: (element) => element.getAttribute("data-alt"),
        renderHTML: (attributes) => (attributes.alt ? { "data-alt": attributes.alt } : {}),
      },
      aspect: {
        default: DEFAULT_MEDIA_BLOCK_ATTRS.aspect,
        parseHTML: (element) => {
          const value = Number(element.getAttribute("data-aspect"));
          return Number.isFinite(value) && value > 0 ? value : null;
        },
        renderHTML: (attributes) =>
          attributes.aspect ? { "data-aspect": String(attributes.aspect) } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-media-block]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-media-block": "true" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MediaBlockNodeView);
  },
});
