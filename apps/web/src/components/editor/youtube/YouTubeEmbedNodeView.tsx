// Editor NodeView for a YouTube embed: the shared facade plus a toolbar to open
// the video on YouTube or remove it. No editable content (atom node).

import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { ExternalLink, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { YouTubeEmbedView } from "./YouTubeEmbedView";
import { youtubeWatchUrl } from "./youtubeSchema";

export const YouTubeEmbedNodeView = ({ node, deleteNode, selected }: NodeViewProps) => {
  const videoId = String(node.attrs.videoId || "");
  const toolbarVisibility = selected
    ? "opacity-100"
    : "pointer-events-none opacity-0 group-hover/yt:pointer-events-auto group-hover/yt:opacity-100";

  return (
    <NodeViewWrapper as="div" contentEditable={false} className="group/yt relative my-2">
      <YouTubeEmbedView videoId={videoId} />

      <div
        data-media-toolbar="true"
        className={`absolute right-2 top-2 z-20 flex items-center gap-0.5 rounded-lg border border-border/70 bg-background/95 p-1 shadow-sm transition-opacity ${toolbarVisibility}`}
      >
        <Button
          asChild
          type="button"
          variant="ghost"
          size="icon"
          title="Открыть на YouTube"
          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
          onMouseDown={(event) => event.preventDefault()}
        >
          <a href={youtubeWatchUrl(videoId)} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-4 w-4" />
          </a>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          title="Удалить видео"
          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => deleteNode()}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </NodeViewWrapper>
  );
};
