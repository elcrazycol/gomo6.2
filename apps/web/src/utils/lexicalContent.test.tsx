import { describe, it, expect, vi } from "vitest";

vi.mock("@/components/CensorBlur", () => ({
  CensorBlur: ({ children }: any) => <span data-testid="censor">{children}</span>,
}));
vi.mock("@/components/EmojiInline", () => ({
  EmojiInline: ({ code }: any) => <span data-testid="emoji">{code}</span>,
}));
vi.mock("@/components/MentionLink", () => ({
  MentionLink: ({ username }: any) => <span data-testid="mention">{username}</span>,
}));
vi.mock("@/components/LinkButton", () => ({
  LinkButton: ({ url }: any) => <a data-testid="link" href={url}>{url}</a>,
}));

import {
  lexicalJsonToPlainText,
  normalizeLexicalContent,
  isLegacyVisibilityContent,
  EMPTY_EDITOR_STATE,
} from "./lexicalContent";

describe("lexicalJsonToPlainText", () => {
  it("extracts text from simple node", () => {
    const json = {
      root: {
        type: "root",
        children: [{ type: "paragraph", children: [{ type: "text", text: "Hello world" }] }],
      },
    };
    expect(lexicalJsonToPlainText(json)).toBe("Hello world");
  });

  it("returns fallback for empty content", () => {
    expect(lexicalJsonToPlainText(null)).toBe("");
    expect(lexicalJsonToPlainText(null, "fallback")).toBe("fallback");
  });

  it("returns fallback for non-JSON string", () => {
    expect(lexicalJsonToPlainText("not json", "default")).toBe("default");
  });

  it("handles multiple paragraphs", () => {
    const json = {
      root: {
        type: "root",
        children: [
          { type: "paragraph", children: [{ type: "text", text: "Line 1" }] },
          { type: "paragraph", children: [{ type: "text", text: "Line 2" }] },
        ],
      },
    };
    const result = lexicalJsonToPlainText(json);
    expect(result).toContain("Line 1");
    expect(result).toContain("Line 2");
  });

  it("handles linebreak nodes", () => {
    const json = {
      root: {
        type: "root",
        children: [
          { type: "paragraph", children: [{ type: "text", text: "A" }, { type: "linebreak" }, { type: "text", text: "B" }] },
        ],
      },
    };
    const result = lexicalJsonToPlainText(json);
    expect(result).toContain("A");
    expect(result).toContain("B");
  });

  it("coerces JSON string input", () => {
    const jsonStr = JSON.stringify({
      root: { type: "root", children: [{ type: "paragraph", children: [{ type: "text", text: "from string" }] }] },
    });
    expect(lexicalJsonToPlainText(jsonStr)).toBe("from string");
  });

  it("handles nested text nodes", () => {
    const json = {
      root: {
        type: "root",
        children: [{ type: "paragraph", children: [{ type: "text", text: "deep" }] }],
      },
    };
    expect(lexicalJsonToPlainText(json)).toBe("deep");
  });
});

describe("normalizeLexicalContent", () => {
  it("returns EMPTY_EDITOR_STATE for null input", () => {
    const result = normalizeLexicalContent(null);
    expect(result).toEqual(EMPTY_EDITOR_STATE);
  });

  it("returns EMPTY_EDITOR_STATE for undefined input", () => {
    const result = normalizeLexicalContent(undefined);
    expect(result).toEqual(EMPTY_EDITOR_STATE);
  });

  it("returns valid lexical state as-is", () => {
    const state = {
      root: {
        type: "root",
        version: 1,
        children: [{ type: "paragraph", version: 1, children: [{ type: "text", text: "hi" }] }],
      },
    };
    const result = normalizeLexicalContent(state);
    expect(result.root.type).toBe("root");
  });

  it("coerces JSON string to object", () => {
    const state = {
      root: {
        type: "root",
        version: 1,
        children: [{ type: "paragraph", version: 1, children: [{ type: "text", text: "parsed" }] }],
      },
    };
    const result = normalizeLexicalContent(JSON.stringify(state));
    expect(result.root.type).toBe("root");
  });

  it("falls back to legacy content when contentJson is not lexical", () => {
    const result = normalizeLexicalContent("not lexical", "legacy text");
    expect(result.root.children).toBeTruthy();
  });

  it("ensures non-empty editor state", () => {
    const state = {
      root: {
        type: "root",
        version: 1,
        children: [],
      },
    };
    const result = normalizeLexicalContent(state);
    expect(result.root.children.length).toBeGreaterThan(0);
  });
});

describe("isLegacyVisibilityContent", () => {
  it("detects [seeusers=] tag", () => {
    expect(isLegacyVisibilityContent("[seeusers=user1]text[/seeusers]")).toBe(true);
  });

  it("detects [nousers=] tag", () => {
    expect(isLegacyVisibilityContent("[nousers=user1]text[/nousers]")).toBe(true);
  });

  it("detects [adm] tag", () => {
    expect(isLegacyVisibilityContent("[adm]text[/adm]")).toBe(true);
  });

  it("detects [me] tag", () => {
    expect(isLegacyVisibilityContent("[me]text[/me]")).toBe(true);
  });

  it("detects [dude] tag", () => {
    expect(isLegacyVisibilityContent("[dude][/dude]")).toBe(true);
  });

  it("returns false for plain text", () => {
    expect(isLegacyVisibilityContent("Hello world")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isLegacyVisibilityContent("")).toBe(false);
  });
});

describe("EMPTY_EDITOR_STATE", () => {
  it("has correct structure", () => {
    expect(EMPTY_EDITOR_STATE.root.type).toBe("root");
    expect(EMPTY_EDITOR_STATE.root.version).toBe(1);
    expect(Array.isArray(EMPTY_EDITOR_STATE.root.children)).toBe(true);
    expect(EMPTY_EDITOR_STATE.root.children.length).toBe(1);
  });

  it("has a paragraph child with zero-width space", () => {
    const paragraph = EMPTY_EDITOR_STATE.root.children[0];
    expect(paragraph.type).toBe("paragraph");
    expect(paragraph.children![0].text).toBe("\u200b");
  });
});
