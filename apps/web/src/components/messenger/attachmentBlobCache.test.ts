import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachmentBlobCacheBytes,
  attachmentBlobCacheSize,
  cacheAttachmentUrl,
  clearAttachmentBlobCache,
  getCachedAttachmentUrl,
  getOrLoadAttachmentUrl,
  releaseAttachmentUrl,
  retainAttachmentUrl,
} from "./attachmentBlobCache";

const MB = 1024 * 1024;
const MAX_ENTRIES = 32;

describe("attachment blob cache", () => {
  beforeEach(() => {
    if (typeof URL.revokeObjectURL !== "function") {
      URL.revokeObjectURL = () => {};
    }
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    clearAttachmentBlobCache();
    vi.mocked(URL.revokeObjectURL).mockClear();
  });

  afterEach(() => {
    clearAttachmentBlobCache();
    vi.restoreAllMocks();
  });

  it("returns the cached url and revokes everything on clear", () => {
    cacheAttachmentUrl("a", "blob:a", 10);
    cacheAttachmentUrl("b", "blob:b", 10);
    expect(getCachedAttachmentUrl("a")).toBe("blob:a");

    clearAttachmentBlobCache();
    expect(attachmentBlobCacheSize()).toBe(0);
    expect(attachmentBlobCacheBytes()).toBe(0);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:a");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:b");
  });

  it("evicts the oldest entry past the count limit", () => {
    for (let i = 0; i < MAX_ENTRIES; i += 1) cacheAttachmentUrl(`k${i}`, `blob:${i}`, 10);
    cacheAttachmentUrl("k-new", "blob:new", 10);

    expect(attachmentBlobCacheSize()).toBe(MAX_ENTRIES);
    expect(getCachedAttachmentUrl("k0")).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:0");
  });

  it("evicts by total bytes, not just count", () => {
    for (let i = 0; i < 7; i += 1) cacheAttachmentUrl(`k${i}`, `blob:${i}`, 10 * MB);

    // 7 × 10MB = 70MB > 64MB → the oldest is dropped, 60MB remains.
    expect(attachmentBlobCacheSize()).toBe(6);
    expect(attachmentBlobCacheBytes()).toBe(60 * MB);
    expect(getCachedAttachmentUrl("k0")).toBeNull();
  });

  it("holds a large clip only while it is on screen", () => {
    cacheAttachmentUrl("big", "blob:big", 20 * MB); // > per-entry cap → transient
    retainAttachmentUrl("big");
    expect(getCachedAttachmentUrl("big")).toBe("blob:big");

    releaseAttachmentUrl("big");
    expect(getCachedAttachmentUrl("big")).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:big");
    expect(attachmentBlobCacheBytes()).toBe(0);
  });

  it("never evicts an in-use (retained) url", () => {
    for (let i = 0; i < MAX_ENTRIES; i += 1) cacheAttachmentUrl(`k${i}`, `blob:${i}`, 10);
    retainAttachmentUrl("k0");
    cacheAttachmentUrl("k-new", "blob:new", 10);

    expect(getCachedAttachmentUrl("k0")).toBe("blob:0");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:1");
    releaseAttachmentUrl("k0");
  });
});

describe("single-flight attachment loads", () => {
  beforeEach(() => {
    if (typeof URL.revokeObjectURL !== "function") URL.revokeObjectURL = () => {};
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    clearAttachmentBlobCache();
  });

  afterEach(() => {
    clearAttachmentBlobCache();
    vi.restoreAllMocks();
  });

  it("shares one load between concurrent callers", async () => {
    const loader = vi.fn(async () => ({ url: "blob:shared", bytes: 100 }));
    const a = getOrLoadAttachmentUrl("k", loader);
    const b = getOrLoadAttachmentUrl("k", loader);

    await expect(Promise.all([a.promise, b.promise])).resolves.toEqual(["blob:shared", "blob:shared"]);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(getCachedAttachmentUrl("k")).toBe("blob:shared");

    a.release();
    b.release();
  });

  it("aborts the load once the last waiter leaves", () => {
    let signal: AbortSignal | undefined;
    const loader = (s: AbortSignal) => {
      signal = s;
      return new Promise<never>(() => {});
    };
    const a = getOrLoadAttachmentUrl("k", loader);
    const b = getOrLoadAttachmentUrl("k", loader);

    a.release();
    expect(signal?.aborted).toBe(false);
    b.release();
    expect(signal?.aborted).toBe(true);
  });
});
