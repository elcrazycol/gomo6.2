import { useEffect, useMemo, useRef, useState } from "react";
import { Play } from "lucide-react";
import type { Attachment } from "./types";
import {
  getAttachmentAspectRatio,
  parseImageMeta,
  rememberMeasuredAttachmentRatio,
  thumbHashToPlaceholderDataUrl,
  useAuthenticatedAttachmentUrl,
} from "./attachmentMedia";

export type MessageMediaMosaicProps = {
  attachments: Attachment[];
  onOpen: (index: number) => void;
};

function attachmentsTileStyle(attachment: Attachment): React.CSSProperties {
  return { aspectRatio: getAttachmentAspectRatio(attachment) };
}

function MosaicTile({ attachment, index, onOpen }: { attachment: Attachment; index: number; onOpen: (index: number) => void }) {
  const meta = useMemo(() => parseImageMeta(attachment), [attachment]);
  // Albums must remain useful for older attachments that predate preview
  // derivatives. Fall back to the authenticated original so every tile still
  // displays an image instead of a dead placeholder.
  const previewKey = meta.preview_key || attachment.url;
  const url = useAuthenticatedAttachmentUrl(attachment, previewKey, true);
  const placeholder = useMemo(
    () => thumbHashToPlaceholderDataUrl(meta.thumb_hash) ?? meta.lqip ?? null,
    [meta.thumb_hash, meta.lqip],
  );
  const [isLoaded, setIsLoaded] = useState(false);
  const tileRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => setIsLoaded(false), [url]);

  const handleImageLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    setIsLoaded(true);
    const { naturalWidth, naturalHeight } = event.currentTarget;
    if (naturalWidth > 0 && naturalHeight > 0 && !attachment.meta) {
      rememberMeasuredAttachmentRatio(attachment, naturalWidth / naturalHeight);
    }
  };

  const isVideo = attachment.type === "video";

  return (
    <button
      ref={tileRef}
      type="button"
      className={`msg-media-mosaic-tile msg-attachment-image tile-${index + 1}${isLoaded ? " is-loaded" : " is-loading"}`}
      onClick={() => onOpen(index)}
      aria-label={`Открыть ${attachment.name}`}          style={attachmentsTileStyle(attachment)}
    >
      {placeholder && <img className="msg-attachment-lqip" src={placeholder} alt="" aria-hidden="true" />}
      {url && (isVideo ? (
        <video
          className="msg-media-mosaic-image msg-attachment-preview"
          src={url}
          muted
          playsInline
          preload="metadata"
          onLoadedMetadata={() => setIsLoaded(true)}
        />
      ) : (
        <img
          className="msg-media-mosaic-image msg-attachment-preview"
          src={url}
          alt={attachment.name}
          loading="lazy"
          decoding="async"
          onLoad={handleImageLoad}
        />
      ))}
      {!url && placeholder && <span className="msg-attachment-loading-shimmer" aria-hidden="true" />}
      {!url && !placeholder && <span className="msg-attachment-legacy-placeholder" aria-hidden="true">Открыть фото</span>}
      {isVideo && (
        <span className="msg-media-mosaic-video" aria-hidden="true"><Play size={22} fill="currentColor" /></span>
      )}
    </button>
  );
}

function mosaicRatio(count: number): number {
  if (count === 2) return 3 / 2;
  if (count === 3) return 4 / 3;
  if (count === 4) return 1;
  // 2 columns × 3 rows: square-ish cells keep six photos readable without
  // forcing portrait images into a stretched or cropped frame.
  return 2 / 3;
}

export function MessageMediaMosaic({ attachments, onOpen }: MessageMediaMosaicProps) {
  const count = Math.min(Math.max(attachments.length, 1), 6);
  const ratio = count === 1 ? getAttachmentAspectRatio(attachments[0]) : mosaicRatio(count);

  return (
    <div
      className={`msg-media-mosaic mosaic-count-${count}`}
      style={{ "--mosaic-ratio": ratio } as React.CSSProperties}
      data-count={count}
    >
      {attachments.slice(0, 6).map((attachment, index) => (
        <MosaicTile key={attachment.id || `${attachment.url}-${index}`} attachment={attachment} index={index} onOpen={onOpen} />
      ))}
    </div>
  );
}
