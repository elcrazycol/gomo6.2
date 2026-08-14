import { describe, it, expect } from "vitest";
import {
  prosemirrorToMessengerText,
  messengerTextToProsemirror,
  messengerTextToPlain,
  isMessengerTextEmpty,
  messengerPlainPreview,
  sanitizeMessengerHref,
} from "./messengerRichTextUtils";

const doc = (content: unknown[]) => ({ type: "doc", content });
const para = (content: unknown[]) => ({ type: "paragraph", content });
const text = (value: string, marks: unknown[] = []) =>
  marks.length > 0 ? { type: "text", text: value, marks } : { type: "text", text: value };

describe("prosemirrorToMessengerText", () => {
  it("serializes plain text", () => {
    expect(prosemirrorToMessengerText(doc([para([text("hello")])]))).toBe("hello");
  });

  it("serializes multi-paragraph text", () => {
    expect(prosemirrorToMessengerText(doc([para([text("one")]), para([text("two")])]))).toBe("one\ntwo");
  });

  it("serializes text marks as BBCode", () => {
    expect(prosemirrorToMessengerText(doc([para([text("b", [{ type: "bold" }])])]))).toBe("[b]b[/b]");
    expect(prosemirrorToMessengerText(doc([para([text("i", [{ type: "italic" }])])]))).toBe("[i]i[/i]");
    expect(prosemirrorToMessengerText(doc([para([text("u", [{ type: "underline" }])])]))).toBe("[u]u[/u]");
    expect(prosemirrorToMessengerText(doc([para([text("s", [{ type: "strike" }])])]))).toBe("[s]s[/s]");
  });

  it("serializes color, size and spoiler", () => {
    expect(prosemirrorToMessengerText(doc([para([text("r", [{ type: "textStyle", attrs: { color: "#ff0000" } }])])]))).toBe("[col=#ff0000]r[/col]");
    expect(prosemirrorToMessengerText(doc([para([text("x", [{ type: "textStyle", attrs: { fontSize: "18px" } }])])]))).toBe("[size=3]x[/size]");
    expect(prosemirrorToMessengerText(doc([para([text("z", [{ type: "spoiler" }])])]))).toBe("[blur]z[/blur]");
  });

  it("serializes links with a sanitized href", () => {
    expect(prosemirrorToMessengerText(doc([para([text("go", [{ type: "link", attrs: { href: "https://gomo6.wtf" } }])])]))).toBe("[url=https://gomo6.wtf]go[/url]");
    // javascript: href must be dropped, not serialized
    expect(prosemirrorToMessengerText(doc([para([text("go", [{ type: "link", attrs: { href: "javascript:alert(1)" } }])])]))).toBe("go");
  });

  it("serializes nested marks", () => {
    // MARK_ORDER wraps italic inside bold; the parser restores both marks.
    expect(
      prosemirrorToMessengerText(doc([para([text("x", [{ type: "bold" }, { type: "italic" }])])])),
    ).toBe("[b][i]x[/i][/b]");
  });

  it("groups siblings sharing marks into one BBCode block", () => {
    expect(
      prosemirrorToMessengerText(doc([
        para([
          text("mixed ", [{ type: "bold" }]),
          { type: "customEmoji", attrs: { emojiId: "def" }, marks: [{ type: "bold" }] },
          text(" and ", [{ type: "bold" }]),
        ]),
      ])),
    ).toBe("[b]mixed [e:def] and [/b]");
  });

  it("serializes emoji tokens and mentions", () => {
    expect(prosemirrorToMessengerText(doc([para([{ type: "customEmoji", attrs: { emojiId: "abc" } }])]))).toBe("[e:abc]");
    expect(prosemirrorToMessengerText(doc([para([{ type: "mention", attrs: { id: "1", label: "john" } }])]))).toBe("@john");
  });

  it("returns empty string for junk input", () => {
    expect(prosemirrorToMessengerText(null)).toBe("");
    expect(prosemirrorToMessengerText({})).toBe("");
  });
});

describe("messengerTextToProsemirror", () => {
  it("parses plain text into a paragraph", () => {
    const result = messengerTextToProsemirror("hello");
    expect(result?.type).toBe("doc");
    expect(result?.content?.[0]).toMatchObject({ type: "paragraph" });
    expect(result?.content?.[0]?.content).toEqual([{ type: "text", text: "hello" }]);
  });

  it("parses BBCode marks", () => {
    const bold = messengerTextToProsemirror("[b]x[/b]");
    expect(bold?.content?.[0]?.content).toEqual([{ type: "text", text: "x", marks: [{ type: "bold" }] }]);

    const color = messengerTextToProsemirror("[col=#ff0000]red[/col]");
    expect(color?.content?.[0]?.content).toEqual([
      { type: "text", text: "red", marks: [{ type: "textStyle", attrs: { color: "#ff0000" } }] },
    ]);

    const size = messengerTextToProsemirror("[size=3]big[/size]");
    expect(size?.content?.[0]?.content).toEqual([
      { type: "text", text: "big", marks: [{ type: "textStyle", attrs: { fontSize: "18px" } }] },
    ]);

    const blur = messengerTextToProsemirror("[blur]secret[/blur]");
    expect(blur?.content?.[0]?.content).toEqual([{ type: "text", text: "secret", marks: [{ type: "spoiler" }] }]);
  });

  it("parses nested marks", () => {
    const result = messengerTextToProsemirror("[b][i]x[/i][/b]");
    const marks = result?.content?.[0]?.content?.[0]?.marks as Array<{ type: string }>;
    expect(marks.map((m) => m.type).sort()).toEqual(["bold", "italic"]);
  });

  it("turns [e:…] tokens into customEmoji nodes", () => {
    const result = messengerTextToProsemirror("a[e:abc]b");
    const content = result?.content?.[0]?.content as unknown as Array<Record<string, unknown>>;
    expect(content[0]).toMatchObject({ type: "text", text: "a" });
    expect(content[1]).toMatchObject({ type: "customEmoji", attrs: { emojiId: "abc" } });
    expect(content[2]).toMatchObject({ type: "text", text: "b" });
  });

  it("parses [url=…] into a link mark", () => {
    const result = messengerTextToProsemirror("[url=https://gomo6.wtf]go[/url]");
    expect(result?.content?.[0]?.content).toEqual([
      { type: "text", text: "go", marks: [{ type: "link", attrs: { href: "https://gomo6.wtf" } }] },
    ]);
  });

  it("keeps unknown tags as literal text", () => {
    const result = messengerTextToProsemirror("a [quote]x[/quote]");
    const content = result?.content?.[0]?.content as unknown as Array<{ text?: string }>;
    expect(content.map((n) => n.text ?? "").join("")).toBe("a [quote]x[/quote]");
  });
});

describe("round-trips", () => {
  const cases = [
    "hello world",
    "[b]bold[/b] and [i]italic[/i]",
    "[col=#ff0000]red[/col]",
    "[size=3]big[/size]",
    "[blur]secret[/blur]",
    "[url=https://gomo6.wtf]go[/url]",
    "hi [e:abc] there",
    "[b]mixed [e:def] and [url=https://x.ru]link[/url][/b]",
    "line one\nline two",
  ];
  for (const source of cases) {
    it(`round-trips: ${JSON.stringify(source)}`, () => {
      const json = messengerTextToProsemirror(source);
      expect(prosemirrorToMessengerText(json)).toBe(source);
    });
  }
});

describe("messengerTextToPlain / isMessengerTextEmpty", () => {
  it("strips formatting tags", () => {
    expect(messengerTextToPlain("[b]bold[/b] and [i]italic[/i]")).toBe("bold and italic");
  });

  it("counts emoji tokens as content (one character each)", () => {
    expect(messengerTextToPlain("a[e:abc]b")).toBe("a◆b");
  });

  it("collapses whitespace", () => {
    expect(messengerTextToPlain("  a\t\tb  ")).toBe("a b");
  });

  it("detects empty (even with formatting)", () => {
    expect(isMessengerTextEmpty("")).toBe(true);
    expect(isMessengerTextEmpty("   ")).toBe(true);
    expect(isMessengerTextEmpty("[b][/b]")).toBe(true);
    expect(isMessengerTextEmpty("text")).toBe(false);
    expect(isMessengerTextEmpty("[e:abc]")).toBe(false);
  });
});

describe("messengerPlainPreview", () => {
  it("strips markup and truncates", () => {
    expect(messengerPlainPreview("[b]hello[/b] [e:abc] world")).toBe("hello world");
    const long = "word ".repeat(30).trim();
    const preview = messengerPlainPreview(long, 40);
    expect(preview.length).toBeLessThanOrEqual(41);
    expect(preview.endsWith("…")).toBe(true);
  });

  it("keeps short text intact", () => {
    expect(messengerPlainPreview("short")).toBe("short");
  });
});

describe("sanitizeMessengerHref", () => {
  it("allows safe schemes only", () => {
    expect(sanitizeMessengerHref("https://x.ru")).toBe("https://x.ru");
    expect(sanitizeMessengerHref("http://x.ru")).toBe("http://x.ru");
    expect(sanitizeMessengerHref("mailto:a@b.c")).toBe("mailto:a@b.c");
    expect(sanitizeMessengerHref("tel:+123")).toBe("tel:+123");
    expect(sanitizeMessengerHref("javascript:alert(1)")).toBe("");
    expect(sanitizeMessengerHref("data:text/html,x")).toBe("");
  });
});
