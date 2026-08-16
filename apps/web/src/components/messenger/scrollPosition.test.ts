import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  saveScrollPosition,
  getScrollPosition,
  clearScrollPosition,
  clearAllScrollPositions,
} from "./scrollPosition";

beforeEach(() => {
  clearAllScrollPositions();
});

describe("scrollPosition", () => {
  it("saves, reads and clears an anchor", () => {
    expect(getScrollPosition("c1")).toBeUndefined();
    saveScrollPosition("c1", { messageId: "m1", offset: 42 });
    expect(getScrollPosition("c1")).toEqual({ messageId: "m1", offset: 42 });
    clearScrollPosition("c1");
    expect(getScrollPosition("c1")).toBeUndefined();
  });

  it("does not rewrite storage when the anchor did not change", () => {
    saveScrollPosition("c1", { messageId: "m1", offset: 42 });
    const rawAfterFirst = window.sessionStorage.getItem("gomo6:messenger-scroll-positions");
    // Same message, offset within the 2px jitter band — no write.
    saveScrollPosition("c1", { messageId: "m1", offset: 41 });
    expect(window.sessionStorage.getItem("gomo6:messenger-scroll-positions")).toBe(rawAfterFirst);
    // A genuinely different anchor persists.
    saveScrollPosition("c1", { messageId: "m2", offset: 42 });
    expect(window.sessionStorage.getItem("gomo6:messenger-scroll-positions")).not.toBe(rawAfterFirst);
  });

  it("persists across a page reload (fresh module hydrates from sessionStorage)", async () => {
    saveScrollPosition("c1", { messageId: "m1", offset: 42 });
    // Simulate a reload: re-import the module — it must hydrate from storage.
    vi.resetModules();
    const fresh = await import("./scrollPosition");
    expect(fresh.getScrollPosition("c1")).toEqual({ messageId: "m1", offset: 42 });
    fresh.clearAllScrollPositions();
  });

  it("ignores corrupted storage gracefully", async () => {
    window.sessionStorage.setItem("gomo6:messenger-scroll-positions", "{not-json");
    vi.resetModules();
    const fresh = await import("./scrollPosition");
    expect(fresh.getScrollPosition("c1")).toBeUndefined();
    fresh.clearAllScrollPositions();
  });
});
