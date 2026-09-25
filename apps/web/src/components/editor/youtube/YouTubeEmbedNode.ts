import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { YouTubeEmbedNodeView } from "./YouTubeEmbedNodeView";
import { YOUTUBE_EMBED_NODE } from "./youtubeSchema";

export const YouTubeEmbedNode = Node.create({
  name: YOUTUBE_EMBED_NODE,
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      videoId: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-youtube-embed]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-youtube-embed": "true" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(YouTubeEmbedNodeView);
  },
});
