// Insertion command for YouTube embeds.

import type { Editor } from "@tiptap/core";

import { blockInsertPos } from "@/components/editor/media/mediaCommands";
import { YOUTUBE_EMBED_NODE } from "./youtubeSchema";

/** Insert a YouTube embed (by video id) at the caret. */
export const insertYouTubeEmbed = (editor: Editor, videoId: string, at?: number): void => {
  const position = blockInsertPos(editor.state, at);
  editor.chain().focus().insertContentAt(position, { type: YOUTUBE_EMBED_NODE, attrs: { videoId } }).run();
};
