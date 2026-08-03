import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { storageUrl } from "@/utils/storage";
import { MediaPlayer } from "@/components/MediaPlayer";
import { AudioAttachment } from "@/components/AudioAttachment";
import type { AttachmentMeta } from "@/types/forum";

/**
 * Parses raw attachment data (JSON, array, or string) into AttachmentMeta[].
 * Safe fallback — returns empty array on any parse error.
 */
export const parseAttachments = (raw: unknown): AttachmentMeta[] => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as AttachmentMeta[];
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/**
 * Renders a list of attachments for threads/posts.
 * Extracted from Thread.tsx to reduce file size and enable reuse.
 */
const ProgressiveContentImage = ({
  url,
  previewKey,
  lqip,
  alt,
  onClick,
}: {
  url: string;
  previewKey?: string;
  lqip?: string;
  alt: string;
  onClick?: () => void;
}) => {
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const previewUrl = previewKey
    ? (storageUrl("content", previewKey) || previewKey)
    : null;
  const originalUrl = storageUrl("content", url) || url;

  useEffect(() => setPreviewLoaded(false), [previewUrl]);

  return (
    <button type="button" className="relative block w-full overflow-hidden rounded-lg border border-border bg-muted/30 cursor-zoom-in" onClick={onClick}>
      {lqip && <img src={lqip} alt="" aria-hidden="true" className="absolute inset-0 w-full h-full object-contain blur-xl scale-105 transition-opacity duration-500" style={{ opacity: previewLoaded ? 0 : 1 }} />}
      {previewUrl ? <img
        src={previewUrl}
        alt={alt}
        loading="lazy"
        decoding="async"
        className="relative w-full max-h-[70vh] object-contain transition-[filter,opacity,transform] duration-500"
        style={{ opacity: previewLoaded ? 1 : 0, filter: previewLoaded ? "blur(0)" : "blur(8px)", transform: previewLoaded ? "scale(1)" : "scale(1.02)" }}
        onLoad={() => setPreviewLoaded(true)}
      /> : <span className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">Открыть фото</span>}
    </button>
  );
};

export const renderAttachments = (
  attachments: AttachmentMeta[] | undefined | null,
  onImageClick?: (urls: string[], index: number) => void,
  playlistKey?: string
) => {
  if (!attachments || attachments.length === 0) return null;
  const imageUrls = attachments
    .filter((att) => att.type === "image")
    .map((att) => storageUrl("content", att.url) || att.url);
  const hasManyImages = imageUrls.length > 1;

  return (
    <div className="space-y-3 mt-2">
      {hasManyImages && (
        <div className="flex flex-wrap gap-2 mb-1">
          {imageUrls.map((url, idx) => (
            <div
              key={idx}
              className="w-20 h-20 sm:w-24 sm:h-24 border border-border rounded-md overflow-hidden bg-muted/40 cursor-pointer"
              onClick={() => onImageClick?.(imageUrls, idx)}
            >
              <ProgressiveContentImage
                url={url}
                previewKey={attachments.find((att) => att.type === "image" && (storageUrl("content", att.url) || att.url) === url)?.meta?.preview_key}
                lqip={attachments.find((att) => att.type === "image" && (storageUrl("content", att.url) || att.url) === url)?.meta?.lqip}
                alt={`img-${idx}`}
                onClick={() => onImageClick?.(imageUrls, idx)}
              />
            </div>
          ))}
        </div>
      )}

      {attachments.map((att, idx) => {
        if (att.type === "image" && hasManyImages) return null; // already rendered grid

        if (att.type === "image") {
          const imageIndex = imageUrls.indexOf(att.url);
          return (
            <figure key={idx} className="w-full">
              <ProgressiveContentImage
                url={storageUrl("content", att.url) || att.url}
                previewKey={att.meta?.preview_key}
                lqip={att.meta?.lqip}
                alt={att.name || `img-${idx}`}
                onClick={() => onImageClick?.(imageUrls, imageIndex)}
              />
            </figure>
          );
        }
        if (att.type === "video") {
          return (
            <div key={idx} className="flex justify-start pb-3">
              <MediaPlayer
                kind="video"
                poster={att.poster}
                sources={[{ src: att.url, type: att.mime || "video/webm" }]}
                className="max-w-xl sm:max-w-2xl"
              />
            </div>
          );
        }
        if (att.type === "audio") {
          return (
            <div key={idx} className="flex justify-start pb-3">
              <AudioAttachment
                attachment={att}
                className="max-w-md"
                playlistId={playlistKey}
                playlistIndex={idx}
              />
            </div>
          );
        }
        return (
          <a
            key={idx}
            href={att.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 text-sm text-primary underline"
          >
            <FileText className="w-4 h-4" />
            <span className="truncate">{att.name || att.url}</span>
            <span className="text-xs text-muted-foreground">{(att.size / 1024 / 1024).toFixed(1)} МБ</span>
          </a>
        );
      })}
    </div>
  );
};
