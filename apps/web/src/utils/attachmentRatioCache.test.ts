import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getAttachmentAspectRatio,
  rememberAttachmentAspectRatio,
  clearAttachmentAspectRatios,
  __resetAttachmentRatioCacheForTests,
} from "./attachmentRatioCache";

const KEY = "gomo6:msg-attachment-ratios";

beforeEach(() => {
  localStorage.clear();
  __resetAttachmentRatioCacheForTests();
});

afterEach(() => {
  localStorage.clear();
  __resetAttachmentRatioCacheForTests();
});

describe("attachmentRatioCache", () => {
  it("returns null for unknown urls", () => {
    expect(getAttachmentAspectRatio("user-1/messenger/photo.jpg")).toBeNull();
  });

  it("stores and returns a remembered ratio", () => {
    rememberAttachmentAspectRatio("user-1/messenger/photo.jpg", 1.5);
    expect(getAttachmentAspectRatio("user-1/messenger/photo.jpg")).toBeCloseTo(1.5, 6);
  });

  it("persists to localStorage", () => {
    rememberAttachmentAspectRatio("user-1/messenger/photo.jpg", 1.5);
    const raw = localStorage.getItem(KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);
    expect(parsed["user-1/messenger/photo.jpg"].ratio).toBeCloseTo(1.5, 6);
  });

  it("reads ratios written by a previous session", () => {
    localStorage.setItem(KEY, JSON.stringify({
      "user-1/messenger/photo.jpg": { ratio: 0.75, savedAt: Date.now() },
    }));
    expect(getAttachmentAspectRatio("user-1/messenger/photo.jpg")).toBeCloseTo(0.75, 6);
  });

  it("skips storing ratios that match the fallback placeholder", () => {
    rememberAttachmentAspectRatio("user-1/messenger/photo.jpg", 4 / 3, 4 / 3);
    expect(localStorage.getItem(KEY)).toBeNull();

    rememberAttachmentAspectRatio("user-1/messenger/clip.mp4", 16 / 9, 16 / 9);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("ignores invalid stored entries", () => {
    localStorage.setItem(KEY, JSON.stringify({
      good: { ratio: 1.25, savedAt: Date.now() },
      bad: { ratio: -2, savedAt: Date.now() },
      zero: { ratio: 0, savedAt: Date.now() },
      nan: { ratio: "nope", savedAt: Date.now() },
      expired: { ratio: 2, savedAt: 0 },
    }));
    expect(getAttachmentAspectRatio("good")).toBeCloseTo(1.25, 6);
    expect(getAttachmentAspectRatio("bad")).toBeNull();
    expect(getAttachmentAspectRatio("zero")).toBeNull();
    expect(getAttachmentAspectRatio("nan")).toBeNull();
    expect(getAttachmentAspectRatio("expired")).toBeNull();
  });

  it("evicts the oldest entry when the cache is full", () => {
    __resetAttachmentRatioCacheForTests();
    const now = Date.now();
    const entries: Record<string, { ratio: number; savedAt: number }> = {};
    for (let i = 0; i < 400; i += 1) {
      entries[`old-${i}`] = { ratio: 1 + i / 1000, savedAt: now + i };
    }
    localStorage.setItem(KEY, JSON.stringify(entries));
    rememberAttachmentAspectRatio("new-entry", 2, 4 / 3);
    const parsed = JSON.parse(localStorage.getItem(KEY) as string);
    expect(Object.keys(parsed)).toHaveLength(400);
    expect(parsed["new-entry"]).toBeDefined();
    expect(parsed["old-0"]).toBeUndefined();
  });

  it("clear removes both memory and storage", () => {
    rememberAttachmentAspectRatio("user-1/messenger/photo.jpg", 2);
    clearAttachmentAspectRatios();
    expect(getAttachmentAspectRatio("user-1/messenger/photo.jpg")).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("survives localStorage failures", () => {
    const original = localStorage;
    const throwing = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
      removeItem: () => { throw new Error("denied"); },
    } as unknown as Storage;
    Object.defineProperty(globalThis, "localStorage", { value: throwing, configurable: true });

    try {
      expect(getAttachmentAspectRatio("x")).toBeNull();
      rememberAttachmentAspectRatio("user-1/messenger/photo.jpg", 2, 4 / 3);
      expect(getAttachmentAspectRatio("user-1/messenger/photo.jpg")).toBeCloseTo(2, 6);
    } finally {
      Object.defineProperty(globalThis, "localStorage", { value: original, configurable: true });
    }
  });
});
