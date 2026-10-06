import { parseAttachments } from "@/components/ThreadAttachments";
import type { AttachmentMeta } from "@/types/forum";

/**
 * Thread/post attachment normalisation shared by every card that renders a
 * thread (feed, g-sub board, profile/topic lists).
 *
 * New threads carry rich attachment meta (preview_key/lqip) that powers the
 * progressive gallery; legacy threads only have plain `image_url(s)`, which
 * are wrapped so they render through the same `WallAttachments` component.
 */
export interface ThreadAttachmentSource {
  image_url?: string | null;
  image_urls?: string[] | null;
  attachments?: unknown;
}

/** Plain image URLs from the legacy columns, newest shape first. */
export const legacyThreadImageUrls = (thread: ThreadAttachmentSource): string[] =>
  Array.isArray(thread.image_urls) && thread.image_urls.length > 0
    ? thread.image_urls
    : thread.image_url
      ? [thread.image_url]
      : [];

const plainImage = (url: string): AttachmentMeta => ({
  url,
  type: "image",
  mime: "image/*",
  name: "image",
  size: 0,
});

export const buildThreadAttachments = (thread: ThreadAttachmentSource): AttachmentMeta[] => {
  // Rich attachments may arrive as a JSON array, a JSON string, or null.
  const parsed = parseAttachments(thread.attachments);
  if (parsed.length > 0) {
    // Some legacy threads have both: merge any image_urls not already covered
    // by the rich list so no photo silently disappears.
    const known = new Set(
      parsed.filter((att) => att.type === "image").map((att) => att.url),
    );
    const extra = legacyThreadImageUrls(thread)
      .filter((url) => !known.has(url))
      .map(plainImage);
    return [...parsed, ...extra];
  }
  return legacyThreadImageUrls(thread).map(plainImage);
};
