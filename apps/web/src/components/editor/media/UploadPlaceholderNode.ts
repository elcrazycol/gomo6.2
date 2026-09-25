// Transient upload placeholder node. See UploadPlaceholderNodeView.

import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { UPLOAD_PLACEHOLDER_NODE } from "./mediaSchema";
import { UploadPlaceholderNodeView } from "./UploadPlaceholderNodeView";

export const UploadPlaceholderNode = Node.create({
  name: UPLOAD_PLACEHOLDER_NODE,
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  // Never persisted (stripped before save), so it has no real HTML round-trip.
  addAttributes() {
    return {
      uploadId: { default: "" },
      kind: { default: "image" },
      name: { default: "" },
      percent: { default: 0 },
      phase: { default: "upload" },
      error: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-upload-placeholder]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-upload-placeholder": "true" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(UploadPlaceholderNodeView);
  },
});
