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
              <img src={url} alt={`img-${idx}`} className="w-full h-full object-cover" />
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
              <img
                src={storageUrl("content", att.url) || att.url}
                alt={att.name || `img-${idx}`}
                className="w-full max-h-[70vh] object-contain rounded-lg border border-border bg-muted/30 cursor-pointer"
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
