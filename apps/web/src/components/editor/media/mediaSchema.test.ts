import { describe, expect, it } from "vitest";
import type { AttachmentMeta } from "@/utils/mediaUpload";
import {
  clampMediaWidth,
  collectMediaAttachmentIds,
  countMediaNodes,
  deterministicAttachmentId,
  docHasMediaNodes,
  ensureAttachmentIds,
  hasUploadPlaceholders,
  makeUploadId,
  mediaBlockAttrsFromAttachment,
  mediaShape,
  naturalWidthPercent,
  normalizeMediaNodesInDoc,
  safeHref,
  stripUploadPlaceholders,
  toMediaBlockAttrs,
  toMediaGroupAttrs,
  appendAttachmentsAsMedia,
} from "./mediaSchema";

const imageAttachment = (overrides: Partial<AttachmentMeta> = {}): AttachmentMeta => ({
  url: "/storage/v1/object/wall/user-1/photo.webp",
  type: "image",
  mime: "image/webp",
  name: "photo.webp",
  size: 1000,
  ...overrides,
});

const doc = (content: unknown[]) => ({ type: "doc", schema_version: 2, content });

describe("mediaSchema", () => {
  it("derives a stable, prefixed id from the path", () => {
    const a = deterministicAttachmentId("/storage/v1/object/wall/u/1.png");
    const b = deterministicAttachmentId("/storage/v1/object/wall/u/1.png");
    const c = deterministicAttachmentId("/storage/v1/object/wall/u/2.png");
    expect(a).toMatch(/^att_[0-9a-f]{8}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("fills ids for legacy attachments and preserves existing ones", () => {
    const legacy = imageAttachment();
    const withId = imageAttachment({ id: "att_keep" });
    const result = ensureAttachmentIds([legacy, withId]);
    expect(result[0].id).toMatch(/^att_[0-9a-f]{8}$/);
    expect(result[1].id).toBe("att_keep");
    // Deterministic across calls, so the editor and renderer agree.
    expect(ensureAttachmentIds([legacy])[0].id).toBe(result[0].id);
  });

  it("tolerates null/undefined attachment lists", () => {
    expect(ensureAttachmentIds(null)).toEqual([]);
    expect(ensureAttachmentIds(undefined)).toEqual([]);
  });

  it("clamps widths to the 10–100 range", () => {
    expect(clampMediaWidth(0)).toBe(10);
    expect(clampMediaWidth(150)).toBe(100);
    expect(clampMediaWidth(63.4)).toBe(63);
    expect(clampMediaWidth("not-a-number")).toBe(100);
  });

  it("only accepts non-executable hrefs", () => {
    expect(safeHref("https://example.com")).toBe("https://example.com");
    expect(safeHref("mailto:a@b.c")).toBe("mailto:a@b.c");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,x")).toBeNull();
    expect(safeHref("")).toBeNull();
    expect(safeHref(null)).toBeNull();
  });

  it("coerces unsafe node attrs into a valid shape", () => {
    const attrs = toMediaBlockAttrs({
      attachmentId: "att_1",
      kind: "bogus",
      align: "bogus",
      width: 999,
      href: "javascript:alert(1)",
      caption: 42,
      aspect: -1,
    });
    expect(attrs.kind).toBe("image");
    expect(attrs.align).toBe("inline");
    expect(attrs.width).toBe(100);
    expect(attrs.href).toBe("javascript:alert(1)"); // sanitized at render via safeHref
    expect(attrs.caption).toBe("");
    expect(attrs.aspect).toBeNull();
  });

  it("detects media nodes in object and JSON-string documents", () => {
    expect(docHasMediaNodes(doc([{ type: "paragraph" }]))).toBe(false);
    expect(
      docHasMediaNodes(doc([{ type: "mediaBlock", attrs: { attachmentId: "a" } }])),
    ).toBe(true);
    expect(
      docHasMediaNodes(JSON.stringify(doc([{ type: "mediaGroup", content: [{ type: "mediaBlock" }] }]))),
    ).toBe(true);
    expect(docHasMediaNodes(null)).toBe(false);
    expect(docHasMediaNodes("{broken")).toBe(false);
  });

  it("collects attachment ids in document order", () => {
    const ids = collectMediaAttachmentIds(
      doc([
        { type: "mediaBlock", attrs: { attachmentId: "a" } },
        { type: "paragraph" },
        { type: "mediaBlock", attrs: { attachmentId: "b" } },
        { type: "mediaBlock", attrs: {} },
      ]),
    );
    expect(ids).toEqual(["a", "b"]);
  });

  it("builds default media attrs from an attachment", () => {
    const attrs = mediaBlockAttrsFromAttachment({
      id: "att_1",
      url: "u",
      type: "video",
      mime: "video/mp4",
      name: "clip.mp4",
      size: 10,
      width: 1920,
      height: 1080,
    });
    expect(attrs).toMatchObject({ attachmentId: "att_1", kind: "video", width: 100, align: "inline", alt: "clip.mp4" });
    expect(attrs.aspect).toBeCloseTo(16 / 9);
    // Overrides win.
    expect(mediaBlockAttrsFromAttachment(
      { id: "att_1", url: "u", type: "image", mime: "image/webp", name: "p", size: 1 },
      { width: 50 },
    ).width).toBe(50);
  });

  it("detects and strips upload placeholders", () => {
    const withPlaceholder = doc([
      { type: "paragraph" },
      { type: "uploadPlaceholder", attrs: { uploadId: "u1" } },
      { type: "mediaBlock", attrs: { attachmentId: "a" } },
    ]);
    expect(hasUploadPlaceholders(withPlaceholder)).toBe(true);
    const stripped = stripUploadPlaceholders(withPlaceholder) as { content: Array<{ type: string }> };
    expect(stripped.content.map((node) => node.type)).toEqual(["paragraph", "mediaBlock"]);
    expect(hasUploadPlaceholders(stripped)).toBe(false);
  });

  it("counts media nodes", () => {
    expect(countMediaNodes(doc([{ type: "mediaBlock" }, { type: "mediaBlock" }, { type: "paragraph" }]))).toBe(2);
    expect(countMediaNodes(null)).toBe(0);
  });

  it("coerces a media group layout", () => {
    expect(toMediaGroupAttrs({ layout: "carousel" })).toEqual({ layout: "carousel" });
    expect(toMediaGroupAttrs({ layout: "compare" })).toEqual({ layout: "compare" });
    expect(toMediaGroupAttrs({ layout: "smart" })).toEqual({ layout: "smart" });
    expect(toMediaGroupAttrs({ layout: "bogus" })).toEqual({ layout: "smart" });
    expect(toMediaGroupAttrs(null)).toEqual({ layout: "smart" });
  });

  it("buckets aspect ratios into smart-collage shapes", () => {
    expect(mediaShape(1.8)).toBe("wide");
    expect(mediaShape(1)).toBe("square");
    expect(mediaShape(0.6)).toBe("tall");
    expect(mediaShape(null)).toBe("square");
    expect(mediaShape(0)).toBe("square");
  });

  it("generates unique upload ids", () => {
    const a = makeUploadId();
    const b = makeUploadId();
    expect(a).not.toBe(b);
    expect(a.startsWith("up_")).toBe(true);
  });

  it("computes a natural width percentage from attachment dimensions", () => {
    const baseMeta = { preview_key: "", lqip: "", width: 300, height: 200, pipeline: "image-v2" };
    const image = (meta: Record<string, unknown>) =>
      ({ id: "a", url: "u", type: "image" as const, mime: "image/webp", name: "p", size: 1, meta: meta as never });
    expect(naturalWidthPercent(image(baseMeta), 600)).toBe(50);
    expect(naturalWidthPercent(image({ ...baseMeta, width: 5000 }), 600)).toBe(100);
    expect(naturalWidthPercent(image({ ...baseMeta, width: 10 }), 600)).toBe(10);
    // No dimensions → visual media starts at 60%, files may span the column.
    expect(naturalWidthPercent({ id: "b", url: "u", type: "image", mime: "image/webp", name: "p", size: 1 })).toBe(60);
    expect(naturalWidthPercent({ id: "c", url: "u", type: "file", mime: "application/pdf", name: "d", size: 1 })).toBe(100);
    // Video dimensions live at the top level.
    expect(naturalWidthPercent({ id: "d", url: "u", type: "video", mime: "video/mp4", name: "v", size: 1, width: 320, height: 240 }, 640)).toBe(50);
  });

  it("wraps several legacy attachments into one gallery (edit conversion)", () => {
    const attachments = [
      { id: "att_1", url: "u1", type: "image" as const, mime: "image/webp", name: "p1", size: 1 },
      { id: "att_2", url: "u2", type: "file" as const, mime: "application/pdf", name: "d.pdf", size: 2 },
    ];
    const result = appendAttachmentsAsMedia(doc([{ type: "paragraph" }]), attachments) as {
      content: Array<{ type: string; attrs?: Record<string, unknown>; content?: Array<{ type: string; attrs?: Record<string, unknown> }> }>;
    };
    // Several media are grouped into a gallery.
    expect(result.content.map((node) => node.type)).toEqual(["paragraph", "mediaGroup"]);
    const mediaNodes = result.content[1].content ?? [];
    expect(mediaNodes.map((node) => node.type)).toEqual(["mediaBlock", "mediaBlock"]);
    expect(mediaNodes[0].attrs?.attachmentId).toBe("att_1");
    // Idempotent: a document that already has media is untouched.
    expect(appendAttachmentsAsMedia(result, attachments)).toBe(result);
    // No attachments → unchanged.
    const plain = doc([{ type: "paragraph" }]);
    expect(appendAttachmentsAsMedia(plain, [])).toBe(plain);
  });

  it("keeps a single legacy attachment as an inline media node", () => {
    const result = appendAttachmentsAsMedia(doc([{ type: "paragraph" }]), [
      { id: "att_1", url: "u1", type: "image" as const, mime: "image/webp", name: "p1", size: 1 },
    ]) as { content: Array<{ type: string; content?: Array<{ type: string }> }> };
    expect(result.content.map((node) => node.type)).toEqual(["paragraph", "paragraph"]);
    expect(result.content[1].content?.map((node) => node.type)).toEqual(["mediaBlock"]);
  });

  it("wraps legacy top-level media nodes into paragraphs", () => {
    const blockDoc = {
      type: "doc",
      content: [
        { type: "paragraph" },
        { type: "mediaBlock", attrs: { attachmentId: "a" } },
        { type: "mediaBlock", attrs: { attachmentId: "b" } },
      ],
    };
    const result = normalizeMediaNodesInDoc(blockDoc) as {
      content: Array<{ type: string; content?: Array<{ attrs?: Record<string, unknown> }> }>;
    };
    expect(result.content.map((node) => node.type)).toEqual(["paragraph", "paragraph"]);
    expect(result.content[1].content?.map((node) => node.attrs?.attachmentId)).toEqual(["a", "b"]);
    // Already inline documents are unchanged.
    const inlineDoc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "mediaBlock" }] }] };
    expect(normalizeMediaNodesInDoc(inlineDoc)).toBe(inlineDoc);
  });
});
