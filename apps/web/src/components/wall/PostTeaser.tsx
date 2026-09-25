// Compact preview of a long wall post: a rich-text snippet, a strip of the
// first few media (with a "+N" badge) and a "Показать полностью" button that
// opens the full post page. Rendered inside the card's MediaAttachmentsProvider.

import { useMemo } from "react";
import { ChevronRight, ImageOff } from "lucide-react";

import { ProseMirrorRenderer } from "@/components/ProseMirrorRenderer";
import { useMediaView } from "@/components/editor/media/mediaViewContext";
import { storageUrl } from "@/utils/storage";
import { buildPostTeaser } from "@/utils/postTeaser";
import type { MediaAttachment } from "@/components/editor/media/mediaSchema";

const resolveUrl = (keyOrUrl?: string | null): string | null =>
  keyOrUrl ? storageUrl("content", keyOrUrl) || keyOrUrl : null;

/** Preview image for a tile: image preview, or a video's poster. */
const tileSrc = (attachment: MediaAttachment | null): string | null => {
  if (!attachment) return null;
  if (attachment.type === "video") return resolveUrl(attachment.poster) ?? resolveUrl(attachment.url);
  return resolveUrl(attachment.meta?.preview_key) ?? resolveUrl(attachment.url);
};

export const PostTeaser = ({ contentJson, onOpenPost }: { contentJson: unknown; onOpenPost: () => void }) => {
  const { attachments } = useMediaView();
  const teaser = useMemo(() => buildPostTeaser(contentJson, 3), [contentJson]);

  const hasText = Array.isArray(teaser.textDoc?.content) && (teaser.textDoc?.content as unknown[]).length > 0;
  const extra = Math.max(0, teaser.totalMedia - teaser.media.length);

  return (
    <div className="post-teaser">
      {hasText && teaser.textDoc && (
        <div className="relative max-h-56 overflow-hidden">
          <ProseMirrorRenderer json={teaser.textDoc as unknown as Parameters<typeof ProseMirrorRenderer>[0]["json"]} />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-background to-transparent" />
        </div>
      )}

      {teaser.media.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-1">
          {teaser.media.map((item, index) => {
            const attachment = attachments.find((a) => a.id === item.attachmentId) ?? null;
            const src = tileSrc(attachment);
            const isLast = index === teaser.media.length - 1;
            return (
              <div
                key={`${item.attachmentId}-${index}`}
                className="relative h-24 overflow-hidden rounded-md border border-border/60 bg-muted"
              >
                {src ? (
                  <img
                    src={src}
                    alt={item.alt || ""}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-muted-foreground">
                    <ImageOff className="h-4 w-4" />
                  </div>
                )}
                {isLast && extra > 0 && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-sm font-semibold text-white">
                    +{extra}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onOpenPost();
        }}
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
      >
        Показать полностью
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
};
