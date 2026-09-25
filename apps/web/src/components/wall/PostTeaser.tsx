// Compact preview of a long wall post: a rich-text snippet that fades out with
// a centered "Показать больше" button on the fade, a strip of the first few
// media (with a "+N" badge), and a fallback button when there is no text fade.
// Rendered inside the card's MediaAttachmentsProvider.

import { useEffect, useMemo, useRef, useState } from "react";
import { ImageOff } from "lucide-react";

import { ProseMirrorRenderer } from "@/components/ProseMirrorRenderer";
import { useMediaView } from "@/components/editor/media/mediaViewContext";
import { getDocCover } from "@/components/editor/media/mediaSchema";
import { attachmentPreviewSrc } from "@/utils/attachmentPreview";
import { buildPostTeaser } from "@/utils/postTeaser";
import { PostCover } from "@/components/wall/PostCover";

const showMoreButtonClass =
  "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-sm font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground";

export const PostTeaser = ({ contentJson, onOpenPost }: { contentJson: unknown; onOpenPost: () => void }) => {
  const { attachments } = useMediaView();
  const teaser = useMemo(() => buildPostTeaser(contentJson, 3), [contentJson]);
  const cover = useMemo(() => getDocCover(contentJson), [contentJson]);
  const coverId = cover?.id ?? null;

  const textRef = useRef<HTMLDivElement | null>(null);
  const [textOverflow, setTextOverflow] = useState(false);

  const hasText = Array.isArray(teaser.textDoc?.content) && (teaser.textDoc?.content as unknown[]).length > 0;
  const extra = Math.max(0, teaser.totalMedia - teaser.media.length);

  // Show the fade + centered button only when the snippet is actually clipped.
  useEffect(() => {
    const element = textRef.current;
    if (!element) return;
    const check = () => setTextOverflow(element.scrollHeight > element.clientHeight + 2);
    check();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(check);
    observer.observe(element);
    return () => observer.disconnect();
  }, [teaser.textDoc]);

  const handleOpen = (event: React.MouseEvent) => {
    event.stopPropagation();
    onOpenPost();
  };

  return (
    <div className="post-teaser">
      {hasText && teaser.textDoc && (
        <div ref={textRef} className="relative max-h-56 overflow-hidden">
          <ProseMirrorRenderer json={teaser.textDoc as unknown as Parameters<typeof ProseMirrorRenderer>[0]["json"]} />
          {textOverflow && (
            <>
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background via-background/85 to-transparent" />
              <div className="absolute inset-x-0 bottom-2 flex justify-center">
                <button type="button" onClick={handleOpen} className={showMoreButtonClass}>
                  Показать больше
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {coverId ? (
        <>
          <PostCover attachmentId={coverId} className="mt-3" aspectClassName="aspect-[3/1]" />
          {extra > 0 && <div className="-mt-1 text-xs text-muted-foreground">ещё {extra} медиа</div>}
        </>
      ) : (
        teaser.media.length > 0 && (
          <div className="mt-3 grid grid-cols-3 gap-1">
            {teaser.media.map((item, index) => {
              const attachment = attachments.find((a) => a.id === item.attachmentId) ?? null;
              const src = attachmentPreviewSrc(attachment);
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
        )
      )}

      {/* Fallback: no text fade to sit on (media-only, or text short enough). */}
      {(!hasText || !textOverflow) && (
        <button type="button" onClick={handleOpen} className={`mt-3 ${showMoreButtonClass}`}>
          Показать больше
        </button>
      )}
    </div>
  );
};
