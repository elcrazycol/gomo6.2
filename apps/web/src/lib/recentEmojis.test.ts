import { describe, it, expect, beforeEach, vi } from "vitest";
import { getRecentEmojis, addRecentEmoji, subscribeRecentEmojis } from "./recentEmojis";

describe("recentEmojis", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("starts empty", () => {
    expect(getRecentEmojis()).toEqual([]);
  });

  it("prepends new emojis and dedupes by emojiId", () => {
    addRecentEmoji({ emojiId: "a", packId: "p", url: "u1", name: "A" });
    addRecentEmoji({ emojiId: "b", packId: "p", url: "u2", name: "B" });
    addRecentEmoji({ emojiId: "a", packId: "p", url: "u3", name: "A" });

    const list = getRecentEmojis();
    expect(list.map((e) => e.emojiId)).toEqual(["a", "b"]);
    // Re-picking moves it to the front with the latest url.
    expect(list[0].url).toBe("u3");
  });

  it("caps the list size", () => {
    for (let i = 0; i < 40; i++) {
      addRecentEmoji({ emojiId: `e${i}`, packId: "p", url: `u${i}`, name: `E${i}` });
    }
    expect(getRecentEmojis().length).toBeLessThanOrEqual(24);
  });

  it("notifies subscribers on change", () => {
    const cb = vi.fn();
    const unsubscribe = subscribeRecentEmojis(cb);

    addRecentEmoji({ emojiId: "a", packId: "p", url: "u", name: "A" });
    expect(cb).toHaveBeenCalledTimes(1);

    unsubscribe();
    addRecentEmoji({ emojiId: "b", packId: "p", url: "u", name: "B" });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("recovers from corrupted storage", () => {
    window.localStorage.setItem("gomo6-recent-emojis:v1", "{not json");
    expect(getRecentEmojis()).toEqual([]);
  });

  it("drops malformed entries", () => {
    window.localStorage.setItem(
      "gomo6-recent-emojis:v1",
      JSON.stringify([{ emojiId: "ok", packId: "p", url: "u", name: "OK" }, { bad: true }])
    );
    const list = getRecentEmojis();
    expect(list.length).toBe(1);
    expect(list[0].emojiId).toBe("ok");
  });
});
