// Shared media block views.
//
// MediaBlockContent is the actual media output (link chip + photo/video/audio/
// file + caption) reused by both the read figure and the editor NodeView, so
// WYSIWYG holds. MediaBlockView wraps it in a positioned <figure>; the editor
// wraps it in a NodeViewWrapper instead (a nested <figure> would be invalid).
// MediaBlockRenderer adds the inlineMedia kill-switch for the read path.

import { useMemo } from "react";
import { ImageOff } from "lucide-react";

import { WallAttachments } from "@/components/WallAttachments";
import { useMediaView } from "./mediaViewContext";
import { mediaShape, safeHref, type MediaBlockAttrs } from "./mediaSchema";
import { mediaFigureLayout } from "./mediaLayout";

/** The media itself, without any width/align wrapper. */
export const MediaBlockContent = ({ attrs, editable = false }: { attrs: MediaBlockAttrs; editable?: boolean }) => {
  const { attachments, onImageClick, onVideoOpen, onOpenMedia, autoPlayVideo, galleryKey } = useMediaView();

  const attachment = useMemo(
    () => attachments.find((att) => att.id === attrs.attachmentId) ?? null,
    [attachments, attrs.attachmentId],
  );

  const href = safeHref(attrs.href);
  const caption = attrs.caption.trim();

  // In the editor the viewer should open the whole post gallery; the read path
  // keeps WallAttachments' per-block click behaviour.
  const handleImageClick = onOpenMedia
    ? () => onOpenMedia(attrs.attachmentId)
    : (items: Parameters<NonNullable<typeof onImageClick>>[0], index: number) => onImageClick?.(items, index);

  return (
    <>
      {attachment ? (
        <div className="relative" data-media-content="true">
          <WallAttachments
            attachments={[attachment]}
            galleryKey={`${galleryKey}-media-${attrs.attachmentId}`}
            onImageClick={handleImageClick}
            onVideoOpen={onVideoOpen}
            autoPlayVideo={autoPlayVideo}
          />
          {/* A link on the image makes the whole photo the link (read view
              only) — no separate button. */}
          {!editable && href && attachment.type === "image" && (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer nofollow ugc"
              aria-label="Открыть ссылку"
              title={href}
              data-wall-no-open="true"
              className="absolute inset-0 z-10 cursor-pointer"
            />
          )}
        </div>
      ) : (
        <div
          data-media-missing="true"
          className="flex min-h-24 items-center justify-center gap-2 rounded-lg border border-dashed border-border/70 bg-muted/20 px-3 py-6 text-xs text-muted-foreground"
        >
          <ImageOff className="h-4 w-4" />
          Медиа недоступно
        </div>
      )}

      {caption && (
        <figcaption
          data-media-caption="true"
          className={`mt-1.5 text-xs text-muted-foreground${editable ? "" : " text-center"}`}
        >
          {caption}
        </figcaption>
      )}
    </>
  );
};

export const MediaBlockView = ({ attrs, editable = false }: { attrs: MediaBlockAttrs; editable?: boolean }) => {
  const layout = mediaFigureLayout(attrs.align, attrs.width);
  return (
    <figure
      data-media-block="true"
      data-shape={mediaShape(attrs.aspect)}
      data-editable={editable ? "true" : "false"}
      data-align={attrs.align}
      className={layout.className}
      style={layout.style}
    >
      <MediaBlockContent attrs={attrs} editable={editable} />
    </figure>
  );
};

/**
 * Renderer variant for the read path. Honours the inlineMedia kill-switch:
 * with the feature off, media nodes are skipped entirely and the post's media
 * is served by the legacy bottom gallery instead.
 */
export const MediaBlockRenderer = ({ attrs }: { attrs: MediaBlockAttrs }) => {
  const { inlineMedia } = useMediaView();
  if (!inlineMedia) return null;
  return <MediaBlockView attrs={attrs} />;
};
