import { describe, it, expect } from "vitest";
import {
  prosemirrorToPlainText,
  isProsemirrorJson,
  normalizeContent,
  isEmptyProsemirror,
} from "./contentConverter";

describe("isProsemirrorJson", () => {
  it("returns true for valid prosemirror doc", () => {
    expect(isProsemirrorJson({ type: "doc", content: [] })).toBe(true);
  });

  it("returns false for random object", () => {
    expect(isProsemirrorJson({ root: { type: "root", children: [] } })).toBe(false);
  });

  it("returns false for null", () => {
    expect(isProsemirrorJson(null)).toBe(false);
  });

  it("returns false for string", () => {
    expect(isProsemirrorJson("not json")).toBe(false);
  });
});

describe("isEmptyProsemirror", () => {
  it("returns true for empty doc", () => {
    expect(isEmptyProsemirror({ type: "doc", content: [] })).toBe(true);
  });

  it("returns true for doc with empty paragraph", () => {
    expect(isEmptyProsemirror({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "\u200b" }] }],
    })).toBe(true);
  });

  it("returns false for doc with content", () => {
    expect(isEmptyProsemirror({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }],
    })).toBe(false);
  });
});

describe("prosemirrorToPlainText", () => {
  it("extracts text from prosemirror doc", () => {
    const json = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hello" }] },
        { type: "paragraph", content: [{ type: "text", text: "World" }] },
      ],
    };
    expect(prosemirrorToPlainText(json)).toBe("Hello\nWorld");
  });

  it("returns fallback for null input", () => {
    expect(prosemirrorToPlainText(null, "fallback")).toBe("fallback");
  });

  it("returns fallback for empty doc", () => {
    expect(prosemirrorToPlainText({ type: "doc", content: [] }, "empty")).toBe("empty");
  });
});

describe("normalizeContent", () => {
  it("returns null for null input", () => {
    expect(normalizeContent(null)).toBeNull();
    expect(normalizeContent(undefined)).toBeNull();
  });

  it("returns prosemirror json as-is", () => {
    const pm = { type: "doc", content: [] };
    expect(normalizeContent(pm)).toBe(pm);
  });

  it("returns null for non-string non-object input", () => {
    expect(normalizeContent(42)).toBeNull();
  });

  it("converts plain text string to ProseMirror doc", () => {
    const result = normalizeContent("just text");
    expect(result?.type).toBe("doc");
  });
});
