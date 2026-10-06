import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Location } from "react-router-dom";

import {
  preloadRoute,
  prefetchRouteData,
  registerRouteData,
  matchedRouteData,
  shouldPrefetch,
  hasRouteData,
  LOADER_TIMEOUT_MS,
  __resetRouteData,
} from "./routeData";
import { useLoadingBarStore } from "@/stores/loadingBarStore";

const location = (pathname: string): Location =>
  ({ pathname, search: "", hash: "", state: null, key: "test" }) as Location;

const setConnection = (connection: unknown): void => {
  Object.defineProperty(navigator, "connection", { configurable: true, value: connection });
};

describe("routeData", () => {
  beforeEach(() => {
    __resetRouteData();
  });

  afterEach(() => {
    delete (navigator as unknown as { connection?: unknown }).connection;
  });

  it("matches an entry by path pattern and captures params", async () => {
    const warm = vi.fn().mockResolvedValue(undefined);
    registerRouteData({ id: "profile", match: "/profile/:userId", warm });

    expect(matchedRouteData("/profile/42").map((e) => e.id)).toEqual(["profile"]);
    expect(matchedRouteData("/profile/42/wall/7")).toEqual([]);

    await preloadRoute(location("/profile/42"));
    expect(warm).toHaveBeenCalledTimes(1);
    expect(warm.mock.calls[0][0].params).toEqual({ userId: "42" });
  });

  it("resolves without warming when no entry matches", async () => {
    const warm = vi.fn();
    registerRouteData({ id: "profile", match: "/profile/:userId", warm });

    await expect(preloadRoute(location("/unrelated"))).resolves.toBeUndefined();
    expect(warm).not.toHaveBeenCalled();
  });

  it("shares one in-flight warm-up for concurrent identical preloads", async () => {
    let resolve!: () => void;
    const warm = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
    registerRouteData({ id: "thread", match: "/thread/:threadId", warm });

    const a = preloadRoute(location("/thread/1"));
    const b = preloadRoute(location("/thread/1"));
    resolve();
    await Promise.all([a, b]);

    expect(warm).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed warm forever — the next preload retries", async () => {
    const warm = vi.fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(undefined);
    registerRouteData({ id: "board", match: "/g/:slug", warm });

    await preloadRoute(location("/g/test"));
    await preloadRoute(location("/g/test"));

    expect(warm).toHaveBeenCalledTimes(2);
  });

  it("drives the header loading bar for a preload, but not for intent prefetch", async () => {
    let release!: () => void;
    const warm = vi.fn(() => new Promise<void>((r) => { release = r; }));
    registerRouteData({ id: "slow", match: "/slow", warm });

    const before = useLoadingBarStore.getState().count;
    const pending = preloadRoute(location("/slow"));
    // Navigation reports progress while its loader is in flight…
    expect(useLoadingBarStore.getState().count).toBe(before + 1);
    release();
    await pending;
    expect(useLoadingBarStore.getState().count).toBe(before);

    // …hover prefetch never touches the bar.
    prefetchRouteData(location("/slow"));
    expect(useLoadingBarStore.getState().count).toBe(before);
    release();
    await Promise.resolve();
  });

  it("shows the bar when a navigation joins a bar-less intent prefetch", async () => {
    let release!: () => void;
    const warm = vi.fn(() => new Promise<void>((r) => { release = r; }));
    registerRouteData({ id: "joined", match: "/joined", warm });

    const before = useLoadingBarStore.getState().count;
    prefetchRouteData(location("/joined"));
    expect(useLoadingBarStore.getState().count).toBe(before);

    // The click reuses the in-flight prefetch — but must still show the bar.
    const pending = preloadRoute(location("/joined"));
    expect(useLoadingBarStore.getState().count).toBe(before + 1);

    release();
    await pending;
    expect(useLoadingBarStore.getState().count).toBe(before);
    expect(warm).toHaveBeenCalledTimes(1);
  });

  it("prefetchRouteData skips warming when Save-Data is on", () => {
    const warm = vi.fn();
    registerRouteData({ id: "profile", match: "/profile/:userId", warm });

    setConnection({ saveData: true });
    expect(shouldPrefetch()).toBe(false);
    prefetchRouteData(location("/profile/42"));
    expect(warm).not.toHaveBeenCalled();
  });

  it("prefetchRouteData warms on intent when the connection allows it", () => {
    const warm = vi.fn().mockResolvedValue(undefined);
    registerRouteData({ id: "profile", match: "/profile/:userId", warm });

    setConnection({ saveData: false, effectiveType: "4g" });
    expect(shouldPrefetch()).toBe(true);
    prefetchRouteData(location("/profile/42"));
    expect(warm).toHaveBeenCalledTimes(1);
  });

  it("treats 2g connections as not worth prefetching", () => {
    setConnection({ saveData: false, effectiveType: "2g" });
    expect(shouldPrefetch()).toBe(false);
    setConnection({ effectiveType: "slow-2g" });
    expect(shouldPrefetch()).toBe(false);
    setConnection({ effectiveType: "3g" });
    expect(shouldPrefetch()).toBe(true);
  });

  it("reports whether a route has a preloader", () => {
    registerRouteData({ id: "profile", match: "/profile/:userId", warm: vi.fn() });
    expect(hasRouteData("/profile/42")).toBe(true);
    expect(hasRouteData("/settings")).toBe(false);
  });

  it("stops before the next entry once a newer navigation supersedes it", async () => {
    let releaseFirst!: () => void;
    const first = vi.fn(() => new Promise<void>((r) => { releaseFirst = r; }));
    const second = vi.fn().mockResolvedValue(undefined);
    registerRouteData({ id: "first", match: "/g/one", warm: first });
    registerRouteData({ id: "second", match: "/g/one", warm: second });
    registerRouteData({ id: "other", match: "/g/two", warm: vi.fn().mockResolvedValue(undefined) });

    const superseded = preloadRoute(location("/g/one"));
    // A newer navigation bumps the token before the first entry settles.
    await preloadRoute(location("/g/two"));
    releaseFirst();
    await superseded;

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it("resolves within the loader timeout when a loader never settles", async () => {
    vi.useFakeTimers();
    const warm = vi.fn(() => new Promise<void>(() => {}));
    registerRouteData({ id: "hang", match: "/hang", warm });

    const pending = preloadRoute(location("/hang"));
    await vi.advanceTimersByTimeAsync(LOADER_TIMEOUT_MS);

    await expect(pending).resolves.toBeUndefined();
    vi.useRealTimers();
  });
});
