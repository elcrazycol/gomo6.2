import { describe, it, expect, beforeEach } from "vitest";
import { clearMediaCache, getCacheSize } from "./mediaCache";

describe("clearMediaCache", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("removes gomo-media- keys", () => {
    localStorage.setItem("gomo-media-1", "data1");
    localStorage.setItem("gomo-media-2", "data2");
    localStorage.setItem("other-key", "other");
    clearMediaCache();
    expect(localStorage.getItem("gomo-media-1")).toBeNull();
    expect(localStorage.getItem("gomo-media-2")).toBeNull();
    expect(localStorage.getItem("other-key")).toBe("other");
  });

  it("removes ffmpeg-cache- keys", () => {
    localStorage.setItem("ffmpeg-cache-1", "data1");
    clearMediaCache();
    expect(localStorage.getItem("ffmpeg-cache-1")).toBeNull();
  });

  it("handles empty localStorage", () => {
    expect(() => clearMediaCache()).not.toThrow();
  });

  it("leaves unrelated keys intact", () => {
    localStorage.setItem("gomo-media-x", "x");
    localStorage.setItem("auth_token", "token");
    localStorage.setItem("theme", "dark");
    clearMediaCache();
    expect(localStorage.getItem("auth_token")).toBe("token");
    expect(localStorage.getItem("theme")).toBe("dark");
  });
});

describe("getCacheSize", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns '0.00' for empty cache", () => {
    expect(getCacheSize()).toBe("0.00");
  });

  it("returns non-negative for media cache entries", () => {
    localStorage.setItem("gomo-media-1", "hello world");
    localStorage.setItem("other-key", "other");
    const size = getCacheSize();
    const parsed = parseFloat(size);
    expect(parsed).toBeGreaterThanOrEqual(0);
  });

  it("returns non-negative for ffmpeg-cache entries", () => {
    localStorage.setItem("ffmpeg-cache-1", "some data content");
    const size = getCacheSize();
    const parsed = parseFloat(size);
    expect(parsed).toBeGreaterThanOrEqual(0);
  });

  it("ignores non-media keys", () => {
    localStorage.setItem("auth_token", "a".repeat(1000));
    const size = getCacheSize();
    expect(parseFloat(size)).toBe(0);
  });
});
