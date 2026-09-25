import { describe, expect, it } from "vitest";

import { buildPostTeaser, needsPostTeaser } from "./postTeaser";

const text = (value: string) => ({ type: "text", text: value });
const paragraph = (...content: unknown[]) => ({ type: "paragraph", content });
const media = (id: string) => ({
  type: "mediaBlock",
  attrs: { attachmentId: id, kind: "image", width: 100, align: "inline", aspect: 1 },
});

describe("buildPostTeaser", () => {
  it("keeps text, strips media and caps the media list", () => {
    const doc = {
      type: "doc",
      content: [
        paragraph(text("Привет")),
        {
          type: "mediaGroup",
          attrs: { layout: "smart" },
          content: [media("a"), media("b"), media("c"), media("d")],
        },
        paragraph(text("Пока")),
      ],
    };

    const teaser = buildPostTeaser(doc, 3);

    expect(teaser.totalMedia).toBe(4);
    expect(teaser.media).toHaveLength(3);
    expect(teaser.media[0].attachmentId).toBe("a");
    const types = (teaser.textDoc?.content as Array<{ type: string }>).map((node) => node.type);
    expect(types).toEqual(["paragraph", "paragraph"]);
    expect(JSON.stringify(teaser.textDoc)).toContain("Привет");
    expect(JSON.stringify(teaser.textDoc)).not.toContain("mediaBlock");
  });

  it("drops spoiler, link card and rules from the preview text", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "spoilerBlock", attrs: { label: "x" }, content: [paragraph(text("секрет"))] },
        { type: "linkCard", attrs: { url: "https://x" } },
        { type: "horizontalRule" },
        paragraph(text("видно")),
      ],
    };

    const teaser = buildPostTeaser(doc, 3);

    expect((teaser.textDoc?.content as Array<{ type: string }>).map((node) => node.type)).toEqual(["paragraph"]);
    expect(JSON.stringify(teaser.textDoc)).not.toContain("секрет");
  });

  it("returns empty for a non-document", () => {
    expect(buildPostTeaser(null)).toEqual({ textDoc: null, media: [], totalMedia: 0 });
    expect(buildPostTeaser("plain text")).toEqual({ textDoc: null, media: [], totalMedia: 0 });
  });
});

describe("needsPostTeaser", () => {
  it("triggers on many media or long text, not on short posts", () => {
    const manyMedia = {
      type: "doc",
      content: [{ type: "mediaGroup", content: [media("a"), media("b"), media("c"), media("d")] }],
    };
    expect(needsPostTeaser(manyMedia, "")).toBe(true);
    expect(needsPostTeaser({ type: "doc", content: [paragraph(text("коротко"))] }, "коротко")).toBe(false);
    expect(needsPostTeaser({ type: "doc", content: [] }, "x".repeat(401))).toBe(true);
  });
});
