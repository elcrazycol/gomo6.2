import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearMessengerCache,
  loadCachedMessages,
  messengerCacheLimits,
  saveCachedMessages,
} from "./messengerCache";

const originalIndexedDB = globalThis.indexedDB;

afterEach(() => {
  vi.stubGlobal("indexedDB", originalIndexedDB);
});

describe("messengerCache", () => {
  it("keeps the cache bounded to the latest 50 messages", () => {
    expect(messengerCacheLimits.maxMessages).toBe(50);
  });

  it("falls back safely when IndexedDB is unavailable", async () => {
    vi.stubGlobal("indexedDB", undefined);

    await expect(loadCachedMessages("user-1", "conv-1")).resolves.toBeNull();
    await expect(saveCachedMessages("user-1", "conv-1", [])).resolves.toBeUndefined();
    await expect(clearMessengerCache()).resolves.toBeUndefined();
  });
});
