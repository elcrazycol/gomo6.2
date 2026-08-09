import { describe, expect, it } from "vitest";
import { isEmojiSequence, normalizeEmojiTriggers, splitEmojiGraphemes } from "./emojiGraphemes";

describe("emojiGraphemes", () => {
  it("keeps ZWJ and skin-tone sequences together when Segmenter is unavailable", () => {
    const IntlWithSegmenter = Intl as typeof Intl & { Segmenter?: unknown };
    const originalSegmenter = IntlWithSegmenter.Segmenter;
    // Exercise the fallback path used by older browsers.
    Object.defineProperty(IntlWithSegmenter, "Segmenter", { configurable: true, value: undefined });

    try {
      expect(splitEmojiGraphemes("👩🏽‍💻❤️")).toEqual(["👩🏽‍💻", "❤️"]);
    } finally {
      Object.defineProperty(IntlWithSegmenter, "Segmenter", { configurable: true, value: originalSegmenter });
    }
  });

  it("normalizes only complete emoji triggers and keeps at most three", () => {
    expect(normalizeEmojiTriggers("😀 👨‍👩‍👧‍👦 1️⃣ 🇷🇺 nope")).toEqual([
      "😀",
      "👨‍👩‍👧‍👦",
      "1️⃣",
    ]);
  });

  it("recognizes keycap and joined emoji sequences", () => {
    expect(isEmojiSequence("1️⃣")).toBe(true);
    expect(isEmojiSequence("👨‍👩‍👧‍👦")).toBe(true);
    expect(isEmojiSequence("plain text")).toBe(false);
  });
});
