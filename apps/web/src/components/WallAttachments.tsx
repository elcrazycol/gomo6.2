import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { storageUrl } from "@/utils/storage";
import { MediaPlayer } from "@/components/MediaPlayer";
import { AudioAttachment } from "@/components/AudioAttachment";
import type { AttachmentMeta } from "@/types/forum";
import type { LightboxItem } from "@/components/Lightbox";

/** Resolve a stored key/URL through the storage layer (absolute URLs pass through). */
const resolveUrl = (keyOrUrl?: string | null): string | null =>
  keyOrUrl ? storageUrl("content", keyOrUrl) || keyOrUrl : null;

/**
 * Progressive photo for the wall: renders the tiny inline LQIP (a ~200-byte
 * data URL) first, then fades in the compressed server preview, and only the
 * lightbox ever fetches the full original. Old posts without variants fall
 * back to the plain URL, so nothing regresses.
 */
const ProgressiveWallImage = ({
  url,
  previewKey,
  lqip,
  aspectRatio,
  alt,
  className = "",
  fill = false,
  onClick,
}: {
  url: string;
  previewKey?: string | null;
  lqip?: string | null;
  /** Reserve the real photo's aspect ratio so the layout does not jump. */
  aspectRatio?: number | null;
  alt: string;
  /** Button sizing classes (e.g. "h-40" for grid tiles, "max-h-[70vh]" for singles). */
  className?: string;
  /** When true the image fills an absolutely sized button (grid tile / ratio box). */
  fill?: boolean;
  onClick: () => void;
}) => {
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const previewUrl = resolveUrl(previewKey);
  const originalUrl = resolveUrl(url) || url;
  const progressive = Boolean(lqip || previewUrl);

  useEffect(() => {
    setPreviewLoaded(false);
    setPreviewFailed(false);
  }, [previewUrl]);

  return (
    <button
      type="button"
      className={`relative block w-full cursor-zoom-in overflow-hidden border border-border/60 bg-muted/30 ${className}`}
      style={aspectRatio ? { aspectRatio: String(aspectRatio) } : undefined}
      onClick={onClick}
    >
      {lqip && (
        <img
          src={lqip}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-contain blur-xl scale-105 transition-opacity duration-500"
          style={{ opacity: previewLoaded ? 0 : 1 }}
        />
      )}
      <img
        src={previewFailed ? originalUrl : previewUrl || originalUrl}
        alt={alt}
        loading="lazy"
        decoding="async"
        className={`${fill ? "absolute inset-0 h-full w-full" : "relative w-full max-h-[70vh]"} object-contain transition-[filter,opacity,transform] duration-500`}
        style={
          progressive
            ? {
                opacity: previewLoaded ? 1 : 0,
                filter: previewLoaded ? "blur(0)" : "blur(8px)",
                transform: previewLoaded ? "scale(1)" : "scale(1.02)",
              }
            : undefined
        }
        onLoad={progressive ? () => setPreviewLoaded(true) : undefined}
        // If the compressed preview is ever missing, fall back to the full
        // original so the photo never stays hidden behind the blurry LQIP.
        onError={progressive ? () => { setPreviewFailed(true); setPreviewLoaded(true); } : undefined}
      />
    </button>
  );
};

export const WallAttachments = ({
  attachments,
  onImageClick,
  galleryKey,
}: {
  attachments: AttachmentMeta[];
  /** Items carry meta (preview_key/lqip), so the lightbox uses preview
      thumbnails while the slides load the full originals. */
  onImageClick: (items: LightboxItem[], index: number) => void;
  galleryKey: string;
}) => {
  const images = attachments.filter((attachment) => attachment.type === "image");

  const galleryItems: LightboxItem[] = images.map((attachment) => ({
    url: resolveUrl(attachment.url) || attachment.url,
    type: "image",
    name: attachment.name || "Фото",
    mime: attachment.mime || "image/*",
    // LightboxItem.meta is the JSON-string shape the lightbox expects.
    meta: attachment.meta ? JSON.stringify(attachment.meta) : null,
  }));

  const imageProps = (attachment: AttachmentMeta, alt: string) => ({
    url: resolveUrl(attachment.url) || attachment.url,
    previewKey: attachment.meta?.preview_key,
    lqip: attachment.meta?.lqip,
    aspectRatio:
      attachment.meta?.width && attachment.meta?.height
        ? attachment.meta.width / attachment.meta.height
        : null,
    alt,
  });

  return (
    <div className="space-y-3">
      {galleryItems.length > 1 && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {images.map((attachment, index) => (
            <ProgressiveWallImage
              key={resolveUrl(attachment.url) || attachment.url}
              {...imageProps(attachment, `attachment-${index + 1}`)}
              className="h-40"
              aspectRatio={null}
              fill
              onClick={() => onImageClick(galleryItems, index)}
            />
          ))}
        </div>
      )}

      {attachments.map((attachment, index) => {
        if (attachment.type === "image" && galleryItems.length > 1) return null;

        if (attachment.type === "image") {
          return (
            <figure key={`${galleryKey}-${index}`} className="w-full">
              <ProgressiveWallImage
                {...imageProps(attachment, attachment.name || "attachment")}
                className="max-h-[70vh]"
                fill={Boolean(
                  attachment.meta?.width && attachment.meta?.height
                )}
                onClick={() => onImageClick(galleryItems, 0)}
              />
            </figure>
          );
        }

        if (attachment.type === "video") {
          return (
            <MediaPlayer
              key={`${galleryKey}-${index}`}
              kind="video"
              poster={attachment.poster ?? undefined}
              sources={[{ src: storageUrl("content", attachment.url) ?? attachment.url, type: attachment.mime || "video/webm" }]}
              className="max-w-3xl"
            />
          );
        }

        if (attachment.type === "audio") {
          return (
            <AudioAttachment
              key={`${galleryKey}-${index}`}
              attachment={attachment}
              className="max-w-xl"
              playlistId={`wall-${galleryKey}`}
              playlistIndex={index}
            />
          );
        }

        return (
          <a
            key={`${galleryKey}-${index}`}
            href={storageUrl("content", attachment.url) || attachment.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 border border-border/60 bg-background px-3 py-2 text-sm text-primary"
          >
            <FileText className="h-4 w-4" />
            <span className="max-w-[18rem] truncate">{attachment.name || attachment.url}</span>
          </a>
        );
      })}
    </div>
  );
};
