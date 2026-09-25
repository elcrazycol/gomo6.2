// Resolve an attachment's display URL (preview for images, poster for videos).
// Shared by the post cover, the long-post teaser and any other preview surface.

import { storageUrl } from "@/utils/storage";
import type { MediaAttachment } from "@/components/editor/media/mediaSchema";

export const resolveAttachmentUrl = (keyOrUrl?: string | null): string | null =>
  keyOrUrl ? storageUrl("content", keyOrUrl) || keyOrUrl : null;

/** Best available preview: image preview, or a video's poster (falling back to
    the original url). */
export const attachmentPreviewSrc = (attachment: MediaAttachment | null | undefined): string | null => {
  if (!attachment) return null;
  if (attachment.type === "video") {
    return resolveAttachmentUrl(attachment.poster) ?? resolveAttachmentUrl(attachment.url);
  }
  return resolveAttachmentUrl(attachment.meta?.preview_key) ?? resolveAttachmentUrl(attachment.url);
};
