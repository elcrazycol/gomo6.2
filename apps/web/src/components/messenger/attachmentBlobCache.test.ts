import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachmentBlobCacheSize,
  cacheAttachmentUrl,
  clearAttachmentBlobCache,
  getCachedAttachmentUrl,
  releaseAttachmentUrl,
  retainAttachmentUrl,
} from "./attachmentBlobCache";

const MAX = 16;

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
    cacheAttachmentUrl("a", "blob:a");
    cacheAttachmentUrl("b", "blob:b");
    expect(getCachedAttachmentUrl("a")).toBe("blob:a");
    expect(attachmentBlobCacheSize()).toBe(2);

    clearAttachmentBlobCache();
    expect(attachmentBlobCacheSize()).toBe(0);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:a");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:b");
  });

  it("evicts the oldest entry past the limit and revokes it", () => {
    for (let i = 0; i < MAX; i += 1) cacheAttachmentUrl(`k${i}`, `blob:${i}`);
    cacheAttachmentUrl("k-new", "blob:new");

    expect(attachmentBlobCacheSize()).toBe(MAX);
    expect(getCachedAttachmentUrl("k0")).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:0");
  });

  it("refreshes LRU position on read", () => {
    for (let i = 0; i < MAX; i += 1) cacheAttachmentUrl(`k${i}`, `blob:${i}`);
    getCachedAttachmentUrl("k0"); // k0 is now the most recent
    cacheAttachmentUrl("k-new", "blob:new");

    expect(getCachedAttachmentUrl("k0")).toBe("blob:0");
    expect(getCachedAttachmentUrl("k1")).toBeNull();
  });

  it("never evicts an in-use (retained) url", () => {
    for (let i = 0; i < MAX; i += 1) cacheAttachmentUrl(`k${i}`, `blob:${i}`);
    retainAttachmentUrl("k0");
    cacheAttachmentUrl("k-new", "blob:new");

    expect(getCachedAttachmentUrl("k0")).toBe("blob:0");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:1");

    releaseAttachmentUrl("k0");
  });

  it("revokes a replaced url only when it is not in use", () => {
    cacheAttachmentUrl("a", "blob:old");
    cacheAttachmentUrl("a", "blob:new");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:old");
    expect(getCachedAttachmentUrl("a")).toBe("blob:new");
  });
});
