// Schema helpers for inline media blocks in a post document.
//
// A media node stores only presentation (which attachment, how wide, aligned
// how) and references the post's attachment pool by id. The files themselves
// live in `attachments[]` (see AttachmentMeta) so the document stays small and
// an upload can be replaced without rewriting the document.
//
// IMPORTANT: the ids this module derives for legacy attachments must be stable
// across sessions — the read renderer and (later) the editor both resolve
// `attachmentId` against them, and if the two derived different ids a legacy
// post's media would vanish from one of them. `deterministicAttachmentId` is
// therefore a pure hash of the storage path, never a random uuid.

import type { AttachmentMeta } from "@/utils/mediaUpload";

/** Bump when node/attribute shape changes. Stored on the doc root. */
export const MEDIA_SCHEMA_VERSION = 2;

export type MediaKind = "image" | "video" | "audio" | "file";
/**
 * Placement of a media node. Media are inline nodes living inside a paragraph,
 * so they can sit between characters/words and next to other media:
 *  - inline — natural size, flows in the line (default)
 *  - left   — floats left, text wraps on the right
 *  - right  — floats right, text wraps on the left
 *  - full   — takes the whole line width
 */
export type MediaAlign = "inline" | "left" | "right" | "full";

export const MEDIA_BLOCK_NODE = "mediaBlock";
export const MEDIA_GROUP_NODE = "mediaGroup";
export const UPLOAD_PLACEHOLDER_NODE = "uploadPlaceholder";

/** An attachment that is guaranteed to carry a stable id. */
export type MediaAttachment = AttachmentMeta & { id: string };

export interface MediaBlockAttrs {
  /** Reference into the post's attachment pool. */
  attachmentId: string;
  kind: MediaKind;
  /** Width as a percentage of the content column (10–100). */
  width: number;
  align: MediaAlign;
  /** Optional outbound link on the media. */
  href: string | null;
  caption: string;
  alt: string;
  /** Natural aspect ratio (w/h) so the layout does not jump while loading. */
  aspect: number | null;
}

export const DEFAULT_MEDIA_BLOCK_ATTRS: MediaBlockAttrs = {
  attachmentId: "",
  kind: "image",
  width: 100,
  align: "inline",
  href: null,
  caption: "",
  alt: "",
  aspect: null,
};

const MEDIA_KINDS: readonly MediaKind[] = ["image", "video", "audio", "file"];
const MEDIA_ALIGNS: readonly MediaAlign[] = ["inline", "left", "right", "full"];

export const clampMediaWidth = (value: unknown): number => {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_MEDIA_BLOCK_ATTRS.width;
  return Math.min(100, Math.max(10, Math.round(n)));
};

/**
 * Only allow links that cannot execute script. Mirrors the server-side href
 * allow-list (P2); the client validates too so a bad value never reaches the DOM.
 */
export const safeHref = (raw?: string | null): string | null => {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;
  return /^(https?:\/\/|mailto:|tel:)/i.test(value) ? value : null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** True for the empty-editor sentinel and whitespace-only text. */
export const isZeroWidthText = (value: string | null | undefined): boolean =>
  (value ?? "").replace(/\u200b/g, "").trim().length === 0;

/** Coerce arbitrary node attributes (from stored JSON) into a safe shape. */
export const toMediaBlockAttrs = (raw: unknown): MediaBlockAttrs => {
  const src = isRecord(raw) ? raw : {};
  const kind = MEDIA_KINDS.includes(src.kind as MediaKind) ? (src.kind as MediaKind) : "image";
  const align = MEDIA_ALIGNS.includes(src.align as MediaAlign)
    ? (src.align as MediaAlign)
    : DEFAULT_MEDIA_BLOCK_ATTRS.align;
  const aspect = Number(src.aspect);
  return {
    attachmentId: typeof src.attachmentId === "string" ? src.attachmentId : "",
    kind,
    align,
    width: clampMediaWidth(src.width),
    href: typeof src.href === "string" ? src.href : null,
    caption: typeof src.caption === "string" ? src.caption : "",
    alt: typeof src.alt === "string" ? src.alt : "",
    aspect: Number.isFinite(aspect) && aspect > 0 ? aspect : null,
  };
};

/** FNV-1a 32-bit, hex. Small, dependency-free, stable across runs. */
const fnv1a = (input: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

/** Stable id derived from an attachment's storage path (see module note). */
export const deterministicAttachmentId = (seed: string): string => `att_${fnv1a(seed)}`;

const attachmentSeed = (att: AttachmentMeta): string =>
  att.url || att.meta?.preview_key || att.poster || att.coverArt || att.name || "";

/** Fill in the id of legacy attachments (uploads created before ids existed). */
export const ensureAttachmentIds = (attachments?: AttachmentMeta[] | null): MediaAttachment[] => {
  if (!Array.isArray(attachments)) return [];
  return attachments.map((att) =>
    att.id ? (att as MediaAttachment) : { ...att, id: deterministicAttachmentId(attachmentSeed(att)) },
  );
};

/** Parse content_json when it is still a JSON string (legacy rows). */
const parseDocument = (contentJson: unknown): unknown => {
  if (typeof contentJson !== "string") return contentJson;
  const trimmed = contentJson.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
};

const walkNodes = (value: unknown, visit: (node: Record<string, unknown>) => void): void => {
  if (!isRecord(value)) return;
  if (typeof value.type === "string") visit(value);
  const content = value.content;
  if (Array.isArray(content)) {
    for (const child of content) walkNodes(child, visit);
  }
};

/** True when the document places at least one media node inline. */
export const docHasMediaNodes = (contentJson: unknown): boolean => {
  const doc = parseDocument(contentJson);
  if (!doc) return false;
  let found = false;
  walkNodes(doc, (node) => {
    if (node.type === MEDIA_BLOCK_NODE || node.type === MEDIA_GROUP_NODE) found = true;
  });
  return found;
};

/** Every attachmentId referenced by media nodes in the document, in order. */
export const collectMediaAttachmentIds = (contentJson: unknown): string[] => {
  const doc = parseDocument(contentJson);
  if (!doc) return [];
  const ids: string[] = [];
  walkNodes(doc, (node) => {
    if (node.type !== MEDIA_BLOCK_NODE) return;
    const attrs = isRecord(node.attrs) ? node.attrs : {};
    if (typeof attrs.attachmentId === "string" && attrs.attachmentId) {
      ids.push(attrs.attachmentId);
    }
  });
  return ids;
};

/** Hard cap on inline media per post (server validates the same number in P2). */
export const MAX_MEDIA_NODES = 15;

export const makeUploadId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `up_${crypto.randomUUID()}`;
  }
  return `up_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
};

/**
 * Width percentage that makes a media node render at (approximately) its
 * natural pixel size inside a container of `containerWidth` px. Used as the
 * default so photos do not stretch to the full column. Returns a sane fallback
 * when the upload carries no dimensions (e.g. an audio file or a legacy row).
 */
export const naturalWidthPercent = (attachment: AttachmentMeta, containerWidth = 640): number => {
  const natural = attachment.meta?.width ?? attachment.width;
  if (natural && containerWidth > 0) {
    return Math.min(100, Math.max(10, Math.round((natural / containerWidth) * 100)));
  }
  // No dimensions: non-visual files may span the column, visual ones start
  // smaller so they clearly do not take the whole line.
  return attachment.type === "image" || attachment.type === "video" ? 60 : 100;
};

/** Build the default media node attrs for a freshly uploaded attachment. */
export const mediaBlockAttrsFromAttachment = (
  attachment: MediaAttachment,
  overrides: Partial<MediaBlockAttrs> = {},
): MediaBlockAttrs => {
  const { meta } = attachment;
  const width = meta?.width ?? attachment.width;
  const height = meta?.height ?? attachment.height;
  const aspect = width && height ? width / height : null;
  return {
    ...DEFAULT_MEDIA_BLOCK_ATTRS,
    attachmentId: attachment.id,
    kind: attachment.type,
    aspect,
    alt: attachment.name || "",
    ...overrides,
  };
};

/** True while the document still holds an in-flight upload placeholder. */
export const hasUploadPlaceholders = (contentJson: unknown): boolean => {
  const doc = parseDocument(contentJson);
  if (!doc) return false;
  let found = false;
  walkNodes(doc, (node) => {
    if (node.type === UPLOAD_PLACEHOLDER_NODE) found = true;
  });
  return found;
};

/**
 * Remove transient upload placeholders before persisting (document or draft).
 * Blob-backed placeholders cannot survive a reload, so they must never be
 * written to storage.
 */
export const stripUploadPlaceholders = (contentJson: unknown): unknown => {
  if (!isRecord(contentJson)) return contentJson;
  const content = contentJson.content;
  if (!Array.isArray(content)) return contentJson;
  const filtered = content
    .filter((child) => !(isRecord(child) && child.type === UPLOAD_PLACEHOLDER_NODE))
    .map((child) => (isRecord(child) && Array.isArray(child.content) ? stripUploadPlaceholders(child) : child));
  return { ...contentJson, content: filtered };
};

/** Number of mediaBlock nodes in a stored document. */
export const countMediaNodes = (contentJson: unknown): number => {
  const doc = parseDocument(contentJson);
  if (!doc) return 0;
  let count = 0;
  walkNodes(doc, (node) => {
    if (node.type === MEDIA_BLOCK_NODE) count += 1;
  });
  return count;
};

/**
 * Turn legacy attachments into media blocks at the end of the document when
 * the document has none (opening an old post for editing). Idempotent: a
 * document that already places media is returned unchanged. Media are inline
 * nodes, so they are wrapped in a paragraph.
 */
export const appendAttachmentsAsMedia = (
  doc: unknown,
  attachments: MediaAttachment[],
): unknown => {
  if (!isRecord(doc) || !Array.isArray(doc.content) || attachments.length === 0) return doc;
  if (docHasMediaNodes(doc)) return doc;
  const mediaNodes = attachments.map((attachment) => ({
    type: MEDIA_BLOCK_NODE,
    attrs: mediaBlockAttrsFromAttachment(attachment, {
      // Default to the photo's own size so a converted legacy post does not
      // suddenly show a full-width image.
      width: naturalWidthPercent(attachment),
    }),
  }));
  return { ...doc, content: [...doc.content, { type: "paragraph", content: mediaNodes }] };
};

/**
 * Media nodes are inline, so a document that still stores them as top-level
 * block children (produced while the node was block-level) is invalid for the
 * schema. Wrap every direct media/placeholder child of the doc root in a
 * paragraph. Documents written by the inline editor are returned unchanged.
 */
export const normalizeMediaNodesInDoc = (doc: unknown): unknown => {
  if (!isRecord(doc) || doc.type !== "doc" || !Array.isArray(doc.content)) return doc;
  const out: unknown[] = [];
  let buffer: unknown[] = [];
  let changed = false;
  const flush = () => {
    if (buffer.length > 0) {
      out.push({ type: "paragraph", content: buffer });
      buffer = [];
      changed = true;
    }
  };
  for (const child of doc.content) {
    if (isRecord(child) && (child.type === MEDIA_BLOCK_NODE || child.type === UPLOAD_PLACEHOLDER_NODE)) {
      buffer.push(child);
    } else {
      flush();
      out.push(child);
    }
  }
  flush();
  return changed ? { ...doc, content: out } : doc;
};
