// The post's cover: a wide banner shown under the author header in the card /
// post page. Resolves the chosen attachment from the media view context.

import { useMediaView } from "@/components/editor/media/mediaViewContext";
import { attachmentPreviewSrc } from "@/utils/attachmentPreview";

export const PostCover = ({
  attachmentId,
  className = "",
  aspectClassName = "aspect-[2/1]",
}: {
  attachmentId: string;
  className?: string;
  /** Reserved shape (avoids layout shift before the image loads). */
  aspectClassName?: string;
}) => {
  const { attachments } = useMediaView();
  const attachment = attachments.find((item) => item.id === attachmentId) ?? null;
  const src = attachmentPreviewSrc(attachment);
  if (!src) return null;

  return (
    <div
      data-post-cover="true"
      className={`relative mb-3 overflow-hidden rounded-xl border border-border/60 bg-muted ${aspectClassName} ${className}`}
    >
      <img src={src} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
      {/* Transparent layer so tapping the cover opens the post: a raw <img>
          click is treated as media and would be swallowed by the card. */}
      <div className="absolute inset-0" aria-hidden="true" />
    </div>
  );
};
