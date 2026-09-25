// Shared YouTube embed facade: a thumbnail + play button that swaps in the
// privacy-friendly (youtube-nocookie) iframe on click. Used by the read
// renderer and the editor NodeView.

import { useState } from "react";
import { Play } from "lucide-react";

import { isYouTubeId, youtubeEmbedUrl, youtubeThumbnailUrl } from "./youtubeSchema";

export const YouTubeEmbedView = ({ videoId }: { videoId: string }) => {
  const [playing, setPlaying] = useState(false);

  if (!isYouTubeId(videoId)) {
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/20 text-xs text-muted-foreground">
        Видео недоступно
      </div>
    );
  }

  return (
    <div
      data-youtube-embed="true"
      data-video-id={videoId}
      className="relative aspect-video w-full overflow-hidden rounded-xl border border-border/70 bg-black"
    >
      {playing ? (
        <iframe
          src={youtubeEmbedUrl(videoId)}
          title="YouTube"
          className="absolute inset-0 h-full w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        <button
          type="button"
          aria-label="Воспроизвести видео YouTube"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setPlaying(true)}
          className="group/ytfacade absolute inset-0 h-full w-full"
        >
          <img
            src={youtubeThumbnailUrl(videoId)}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover opacity-90 transition-opacity group-hover/ytfacade:opacity-100"
          />
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-transform group-hover/ytfacade:scale-105">
              <Play className="h-7 w-7 fill-current pl-0.5" />
            </span>
          </span>
        </button>
      )}
    </div>
  );
};
