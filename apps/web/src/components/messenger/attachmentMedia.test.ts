import { describe, it, expect } from "vitest";
import { getAttachmentDisplayStyle, parseImageMeta, thumbHashToPlaceholderDataUrl } from "./attachmentMedia";
import type { Attachment } from "./types";

// A well-formed ThumbHash (base64 of the binary hash from the thumbhash README
// example). thumbHashToDataURL must decode it into a PNG data URL.
const SAMPLE_HASH = "1QcSHQRnh493V4dIh4eXh1h4kJUI";

const makeAttachment = (overrides: Partial<Attachment> = {}): Attachment => ({
  id: "a1",
  url: "u1/messenger/a.jpg",
  type: "image",
  name: "a.jpg",
  size: 1000,
  mime: "image/jpeg",
  ...overrides,
});

describe("parseImageMeta", () => {
  it("parses width, height, preview_key and thumb_hash", () => {
    const attachment = makeAttachment({
      meta: JSON.stringify({ width: 800, height: 600, preview_key: "k.preview.jpg", thumb_hash: SAMPLE_HASH }),
    });
    expect(parseImageMeta(attachment)).toEqual({
      width: 800,
      height: 600,
      preview_key: "k.preview.jpg",
      thumb_hash: SAMPLE_HASH,
    });
  });

  it("ignores a non-data-URL lqip and returns empty for missing meta", () => {
    expect(parseImageMeta(makeAttachment())).toEqual({});
    expect(parseImageMeta(makeAttachment({ meta: '{"lqip":"http://evil.example/x"}' }))).toEqual({});
  });
});

describe("thumbHashToPlaceholderDataUrl", () => {
  it("renders a valid hash into an instant PNG data URL", () => {
    const url = thumbHashToPlaceholderDataUrl(SAMPLE_HASH);
    expect(url).toBeTruthy();
    expect(url!.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("returns null for missing or unparseable hashes (legacy fallback path)", () => {
    expect(thumbHashToPlaceholderDataUrl(undefined)).toBeNull();
    expect(thumbHashToPlaceholderDataUrl("")).toBeNull();
    expect(thumbHashToPlaceholderDataUrl("not-base64!!")).toBeNull();
  });
});

describe("getAttachmentDisplayStyle", () => {
  it("reserves a box at the image's own ratio", () => {
    // 2:1 photo — width caps at 640, height follows the ratio.
    const style = getAttachmentDisplayStyle(2);
    expect(style.width).toBe("min(100%, 640px)");
    expect(style.aspectRatio).toBe(2);
  });

  it("caps very tall images via their width, never their height (ratio stays exact)", () => {
    // 1:2 portrait — maxHeight 480 caps the box at 240px wide / 480px tall.
    const style = getAttachmentDisplayStyle(0.5);
    expect(style.width).toBe("min(100%, 240px)");
    expect(style.aspectRatio).toBe(0.5);
  });

  it("uses the provided maxWidth for mixed text+image bubbles", () => {
    const style = getAttachmentDisplayStyle(1.5, { maxWidth: 420 });
    expect(style.width).toBe("min(100%, 420px)");
    expect(style.aspectRatio).toBe(1.5);
  });
});
