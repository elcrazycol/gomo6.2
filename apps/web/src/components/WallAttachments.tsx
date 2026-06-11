import { FileText } from "lucide-react";
import { storageUrl } from "@/utils/storage";
import { MediaPlayer } from "@/components/MediaPlayer";
import { AudioAttachment } from "@/components/AudioAttachment";
import type { AttachmentMeta } from "@/types/forum";

export const WallAttachments = ({
  attachments,
  onImageClick,
  galleryKey,
}: {
  attachments: AttachmentMeta[];
  onImageClick: (images: string[], index: number) => void;
  galleryKey: string;
}) => {
  const imageUrls = attachments
    .filter((attachment) => attachment.type === "image")
    .map((attachment) => storageUrl("content", attachment.url) || attachment.url);

  return (
    <div className="space-y-3">
      {imageUrls.length > 1 && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {imageUrls.map((url, index) => (
            <button
              key={url}
              type="button"
              className="overflow-hidden border border-border/60 bg-muted/30"
              onClick={() => onImageClick(imageUrls, index)}
            >
              <img src={url} alt={`attachment-${index + 1}`} className="h-40 w-full object-cover transition-transform hover:scale-[1.02]" />
            </button>
          ))}
        </div>
      )}

      {attachments.map((attachment, index) => {
        if (attachment.type === "image" && imageUrls.length > 1) return null;

        if (attachment.type === "image") {
          return (
            <button
              key={`${galleryKey}-${index}`}
              type="button"
              className="block overflow-hidden border border-border/60 bg-muted/30"
              onClick={() => onImageClick(imageUrls, 0)}
            >
              <img
                src={storageUrl("content", attachment.url) || attachment.url}
                alt={attachment.name || "attachment"}
                className="max-h-[32rem] w-full object-cover"
              />
            </button>
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
