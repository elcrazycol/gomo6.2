// Build a compact teaser from a wall-post document: the rich text with media
// stripped (so marks/emoji/mentions survive), plus the first few media for a
// preview strip and the total media count (for the "+N" badge).

import { toMediaBlockAttrs, type MediaBlockAttrs } from "@/components/editor/media/mediaSchema";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseDocument = (contentJson: unknown): Record<string, unknown> | null => {
  if (isRecord(contentJson)) return contentJson;
  if (typeof contentJson === "string") {
    const trimmed = contentJson.trim();
    if (!trimmed.startsWith("{")) return null;
    try {
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
};

export interface PostTeaser {
  /** Document with every media/link/spoiler/rule stripped, for rich text. */
  textDoc: Record<string, unknown> | null;
  /** The first `maxMedia` media (presentation attrs), in document order. */
  media: MediaBlockAttrs[];
  /** Total media in the (visible part of the) document. */
  totalMedia: number;
}

export const buildPostTeaser = (contentJson: unknown, maxMedia = 3): PostTeaser => {
  const doc = parseDocument(contentJson);
  if (!doc || doc.type !== "doc" || !Array.isArray(doc.content)) {
    return { textDoc: null, media: [], totalMedia: 0 };
  }

  const media: MediaBlockAttrs[] = [];
  let totalMedia = 0;

  const collect = (node: Record<string, unknown>) => {
    if (node.type !== "mediaBlock") return;
    totalMedia += 1;
    if (media.length < maxMedia) media.push(toMediaBlockAttrs(node.attrs));
  };

  const strip = (value: unknown): Record<string, unknown> | null => {
    if (!isRecord(value)) return null;
    const type = value.type;

    if (type === "mediaBlock") {
      collect(value);
      return null;
    }
    if (type === "mediaGroup") {
      for (const child of Array.isArray(value.content) ? value.content : []) {
        if (isRecord(child)) collect(child);
      }
      return null;
    }
    // Collapsed spoilers, link cards and rules carry no preview text.
    if (type === "uploadPlaceholder" || type === "linkCard" || type === "horizontalRule" || type === "spoilerBlock") {
      return null;
    }
    if (type === "text") return value;

    const content = Array.isArray(value.content)
      ? value.content.map(strip).filter((child): child is Record<string, unknown> => child !== null)
      : undefined;

    if (type === "paragraph") {
      const meaningful = (content ?? []).some((child) => {
        if (child.type === "text") {
          return String(child.text ?? "").replace(/\u200b/g, "").trim().length > 0;
        }
        return child.type === "customEmoji" || child.type === "mention";
      });
      if (!meaningful) return null;
    }

    return content ? { ...value, content } : { ...value };
  };

  const content = doc.content
    .map(strip)
    .filter((child): child is Record<string, unknown> => child !== null);

  return { textDoc: { ...doc, content }, media, totalMedia };
};

/** Whether a post is long enough to need a teaser + "show more". */
export const needsPostTeaser = (contentJson: unknown, plainText: string | null | undefined): boolean => {
  const { totalMedia } = buildPostTeaser(contentJson, 0);
  if (totalMedia > 3) return true;
  return (plainText ?? "").trim().length > 400;
};
