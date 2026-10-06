import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getCached, invalidateByPrefix, clearQueryCache, peekCached, subscribe } from "./queryCache";

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

  it("peekCached returns a warm value without fetching", async () => {
    const fetcher = vi.fn().mockResolvedValue({ id: 1 });

    expect(peekCached("peek1")).toBeUndefined();

    await getCached("peek1", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(peekCached("peek1")).toEqual({ id: 1 });
    // Still no second fetch — peek never triggers one.
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("peekCached misses after the TTL expires", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValue({ id: 1 });

    await getCached("peek2", fetcher, { ttlMs: 1000 });
    expect(peekCached("peek2")).toEqual({ id: 1 });

    vi.advanceTimersByTime(1001);
    expect(peekCached("peek2")).toBeUndefined();
  });

  it("peekCached returns a clone so callers cannot poison the cache", async () => {
    const fetcher = vi.fn().mockResolvedValue({ id: 1, tags: ["a"] });

    await getCached("peek3", fetcher);
    (peekCached("peek3") as { tags: string[] }).tags.push("b");

    expect((peekCached("peek3") as { tags: string[] }).tags).toEqual(["a"]);
  });

  it("serves a stale value immediately and revalidates in the background", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ v: 1 })
      .mockResolvedValueOnce({ v: 2 });

    await getCached("swr1", fetcher, { ttlMs: 1000, staleTtlMs: 5000 });
    vi.advanceTimersByTime(1001);

    // Stale read: returns the old value without blocking on the network.
    const stale = await getCached("swr1", fetcher, { ttlMs: 1000, staleTtlMs: 5000 });
    expect(stale).toEqual({ v: 1 });

    // The revalidation runs on the microtask queue and refreshes the entry.
    await Promise.resolve();
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(peekCached("swr1")).toEqual({ v: 2 });
  });

  it("notifies subscribers when a background revalidation lands", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ v: 1 })
      .mockResolvedValueOnce({ v: 2 });

    await getCached("swr2", fetcher, { ttlMs: 1000, staleTtlMs: 5000 });
    const listener = vi.fn();
    const unsubscribe = subscribe("swr2", listener);

    vi.advanceTimersByTime(1001);
    await getCached("swr2", fetcher, { ttlMs: 1000, staleTtlMs: 5000 });
    await Promise.resolve();
    await Promise.resolve();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(peekCached("swr2")).toEqual({ v: 2 });
    unsubscribe();
  });

  it("blocks on a fetch once the stale window has passed", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ v: 1 })
      .mockResolvedValueOnce({ v: 3 });

    await getCached("swr3", fetcher, { ttlMs: 1000, staleTtlMs: 1000 });
    vi.advanceTimersByTime(2001);

    const value = await getCached("swr3", fetcher, { ttlMs: 1000, staleTtlMs: 1000 });
    expect(value).toEqual({ v: 3 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps the stale value when a background revalidation fails", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ v: 1 })
      .mockRejectedValueOnce(new Error("offline"));

    await getCached("swr4", fetcher, { ttlMs: 1000, staleTtlMs: 5000 });
    vi.advanceTimersByTime(1001);

    const stale = await getCached("swr4", fetcher, { ttlMs: 1000, staleTtlMs: 5000 });
    expect(stale).toEqual({ v: 1 });

    await Promise.resolve();
    await Promise.resolve();
    expect(peekCached("swr4")).toEqual({ v: 1 });
  });
});
