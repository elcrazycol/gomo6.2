import { describe, it, expect } from "vitest";
import {
  parseLexicalFormat,
  lexicalToProsemirror,
  prosemirrorToPlainText,
  isProsemirrorJson,
  isLexicalJson,
  normalizeContent,
} from "./contentConverter";

describe("parseLexicalFormat", () => {
  it("returns empty array for 0", () => {
    expect(parseLexicalFormat(0)).toEqual([]);
  });

  it("parses bold (1)", () => {
    expect(parseLexicalFormat(1)).toEqual(["bold"]);
  });

  it("parses italic (2)", () => {
    expect(parseLexicalFormat(2)).toEqual(["italic"]);
  });

  it("parses bold+italic (3)", () => {
    expect(parseLexicalFormat(3)).toEqual(["bold", "italic"]);
  });

  it("parses strikethrough (4)", () => {
    expect(parseLexicalFormat(4)).toEqual(["strike"]);
  });

  it("parses underline (8)", () => {
    expect(parseLexicalFormat(8)).toEqual(["underline"]);
  });

  it("parses bold+italic+underline (11)", () => {
    expect(parseLexicalFormat(11)).toEqual(["bold", "italic", "underline"]);
  });

  it("parses all formats (15)", () => {
    expect(parseLexicalFormat(15)).toEqual(["bold", "italic", "strike", "underline"]);
  });
});

describe("isProsemirrorJson", () => {
  it("returns true for valid prosemirror doc", () => {
    expect(isProsemirrorJson({ type: "doc", content: [] })).toBe(true);
  });

  it("returns false for lexical json", () => {
    expect(isProsemirrorJson({ root: { type: "root", children: [] } })).toBe(false);
  });

  it("returns false for null", () => {
    expect(isProsemirrorJson(null)).toBe(false);
  });

  it("returns false for string", () => {
    expect(isProsemirrorJson("not json")).toBe(false);
  });
});

describe("isLexicalJson", () => {
  it("returns true for valid lexical state", () => {
    expect(isLexicalJson({ root: { type: "root", children: [] } })).toBe(true);
  });

  it("returns false for prosemirror json", () => {
    expect(isLexicalJson({ type: "doc", content: [] })).toBe(false);
  });

  it("returns false for null", () => {
    expect(isLexicalJson(null)).toBe(false);
  });
});

describe("lexicalToProsemirror", () => {
  it("converts empty lexical state", () => {
    const result = lexicalToProsemirror({ root: { type: "root", children: [] } });
    expect(result).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
  });

  it("converts simple text", () => {
    const result = lexicalToProsemirror({
      root: {
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [{ type: "text", text: "Hello", format: 0 }],
          },
        ],
      },
    });
    expect(result).toEqual({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
    });
  });

  it("converts bold text", () => {
    const result = lexicalToProsemirror({
      root: {
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [{ type: "text", text: "Hello", format: 1 }],
          },
        ],
      },
    });
    expect(result?.content?.[0]?.content?.[0]).toEqual({
      type: "text",
      text: "Hello",
      marks: [{ type: "bold" }],
    });
  });

  it("converts bold+italic text", () => {
    const result = lexicalToProsemirror({
      root: {
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [{ type: "text", text: "Hello", format: 3 }],
          },
        ],
      },
    });
    expect(result?.content?.[0]?.content?.[0]).toEqual({
      type: "text",
      text: "Hello",
      marks: [{ type: "bold" }, { type: "italic" }],
    });
  });

  it("converts link node", () => {
    const result = lexicalToProsemirror({
      root: {
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [
              {
                type: "link",
                url: "https://example.com",
                children: [{ type: "text", text: "click", format: 0 }],
              },
            ],
          },
        ],
      },
    });
    expect(result?.content?.[0]?.content?.[0]).toEqual({
      type: "text",
      text: "click",
      marks: [{ type: "link", attrs: { href: "https://example.com" } }],
    });
  });

  it("converts emoji text markers", () => {
    const emojiId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const result = lexicalToProsemirror({
      root: {
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [{ type: "text", text: `Hello [e:${emojiId}] world`, format: 0 }],
          },
        ],
      },
    });
    const content = result?.content?.[0]?.content || [];
    expect(content).toHaveLength(3);
    expect(content[0]).toEqual({ type: "text", text: "Hello " });
    expect(content[1]).toEqual({
      type: "customEmoji",
      attrs: { emojiId, url: null, name: null },
    });
    expect(content[2]).toEqual({ type: "text", text: " world" });
  });

  it("converts colored text", () => {
    const result = lexicalToProsemirror({
      root: {
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [{ type: "text", text: "Red", format: 0, style: "color: #ff0000" }],
          },
        ],
      },
    });
    expect(result?.content?.[0]?.content?.[0]).toEqual({
      type: "text",
      text: "Red",
      marks: [{ type: "textStyle", attrs: { color: "#ff0000" } }],
    });
  });

  it("converts spoiler text", () => {
    const result = lexicalToProsemirror({
      root: {
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [
              {
                type: "text",
                text: "Secret",
                format: 0,
                style: "filter: blur(6px)",
              },
            ],
          },
        ],
      },
    });
    expect(result?.content?.[0]?.content?.[0]).toEqual({
      type: "text",
      text: "Secret",
      marks: [{ type: "spoiler" }],
    });
  });

  it("returns null for invalid input", () => {
    expect(lexicalToProsemirror(null)).toBeNull();
    expect(lexicalToProsemirror("string")).toBeNull();
    expect(lexicalToProsemirror({})).toBeNull();
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

  it("converts lexical json to prosemirror", () => {
    const lexical = {
      root: {
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [{ type: "text", text: "Hello", format: 0 }],
          },
        ],
      },
    };
    const result = normalizeContent(lexical);
    expect(result?.type).toBe("doc");
  });

  it("returns null for unrecognized input", () => {
    expect(normalizeContent("just text")).toBeNull();
    expect(normalizeContent(42)).toBeNull();
  });
});
