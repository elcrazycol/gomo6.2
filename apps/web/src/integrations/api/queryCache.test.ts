import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getCached, invalidateByPrefix, clearQueryCache } from "./queryCache";

describe("queryCache", () => {
  beforeEach(() => {
    clearQueryCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("caches the first fetch and serves it on repeat calls", async () => {
    const fetcher = vi.fn().mockResolvedValue({ id: 1 });

    const a = await getCached("k1", fetcher);
    const b = await getCached("k1", fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ id: 1 });
    expect(b).toEqual({ id: 1 });
  });

  it("deduplicates parallel identical fetches into one request", async () => {
    const fetcher = vi.fn().mockResolvedValue({ id: 1 });

    const [a, b] = await Promise.all([
      getCached("k2", fetcher),
      getCached("k2", fetcher),
    ]);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  it("expires entries after the TTL", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValue({ id: 1 });

    await getCached("k3", fetcher, { ttlMs: 1000 });
    vi.advanceTimersByTime(1001);
    await getCached("k3", fetcher, { ttlMs: 1000 });

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not cache when shouldCache returns false", async () => {
    const fetcher = vi.fn().mockResolvedValue({ id: 1 });

    await getCached("k4", fetcher, { shouldCache: () => false });
    await getCached("k4", fetcher, { shouldCache: () => false });

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("returns deep clones so caller mutations do not poison the cache", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue({ id: 1, nested: { tags: ["a"] } });

    const first = await getCached("k5", fetcher);
    (first as { nested: { tags: string[] } }).nested.tags.push("b");

    const second = await getCached("k5", fetcher);
    expect((second as { nested: { tags: string[] } }).nested.tags).toEqual(["a"]);
  });

  it("invalidates entries by URL prefix", async () => {
    const fetcher = vi.fn().mockResolvedValue({ id: 1 });

    await getCached("/api/v1/posts?thread_id=eq.t1", fetcher);
    await getCached("/api/v1/posts?thread_id=eq.t2", fetcher);

    invalidateByPrefix("/api/v1/posts");

    await getCached("/api/v1/posts?thread_id=eq.t1", fetcher);
    await getCached("/api/v1/posts?thread_id=eq.t2", fetcher);

    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("invalidates only matching prefixes", async () => {
    const fetcher = vi.fn().mockResolvedValue({ id: 1 });

    await getCached("/api/v1/posts", fetcher);
    await getCached("/api/v1/threads", fetcher);

    invalidateByPrefix("/api/v1/posts");

    await getCached("/api/v1/posts", fetcher);
    await getCached("/api/v1/threads", fetcher);

    expect(fetcher).toHaveBeenCalledTimes(3); // posts refetched, threads cached
  });

  it("clearQueryCache resets everything", async () => {
    const fetcher = vi.fn().mockResolvedValue({ id: 1 });

    await getCached("k6", fetcher);
    clearQueryCache();
    await getCached("k6", fetcher);

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("profile-cache:invalidate clears custom profile-page keys (Profile.tsx cache)", async () => {
    const fetcher = vi.fn().mockResolvedValue({ id: "u1", username: "alice" });

    // Prime the exact keys Profile.tsx uses for the profile row.
    await getCached("profile-page:owner:u1", fetcher);
    await getCached("profile-page:viewer:u1", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);

    // A profile save broadcasts this event (dispatchProfileCacheInvalidate);
    // the whole cache — including non-URL custom keys — must reset so the
    // next loadProfile() refetches instead of serving the stale row.
    window.dispatchEvent(new CustomEvent("profile-cache:invalidate"));

    await getCached("profile-page:owner:u1", fetcher);
    await getCached("profile-page:viewer:u1", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
});
