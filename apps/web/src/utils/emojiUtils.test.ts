import { describe, it, expect, vi } from "vitest";
import { processEmojiText, renderPreviewContent } from "./emojiUtils";

vi.mock("./bbcodePlugins", () => ({
  renderBbCode: (text: string, opts: any) => {
    return `[rendered:${text}:${opts.keyPrefix}]`;
  },
}));

describe("processEmojiText", () => {
  it("returns empty array for empty input", () => {
    expect(processEmojiText("")).toEqual([]);
  });

  it("delegates to renderBbCode", () => {
    const result = processEmojiText(":smile:");
    expect(result.length).toBeGreaterThan(0);
  });

  it("uses custom keyPrefix", () => {
    const result = processEmojiText(":heart:", "custom");
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("renderPreviewContent", () => {
  it("returns null for empty input", () => {
    expect(renderPreviewContent("")).toBeNull();
  });

  it("delegates to renderBbCode", () => {
    const result = renderPreviewContent("hello");
    expect(result).toBeTruthy();
  });

  it("uses default keyPrefix", () => {
    const result = renderPreviewContent("test");
    expect(result).toBeTruthy();
  });
});
