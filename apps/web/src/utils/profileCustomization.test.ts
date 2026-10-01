import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseCssToStyle, getProfileCustomization, clearCustomizationCache, dispatchProfileCacheInvalidate } from "./profileCustomization";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", (...args: unknown[]) => mockFetch(...args));

function respondWith(data: unknown, ok = true): void {
  mockFetch.mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => ({ success: ok, data }),
  });
}

describe("parseCssToStyle", () => {
  it("returns empty object for empty string", () => {
    expect(parseCssToStyle("")).toEqual({});
  });

  it("parses single color declaration", () => {
    expect(parseCssToStyle("color: red")).toEqual({ color: "red" });
  });

  it("parses multiple declarations", () => {
    const result = parseCssToStyle("color: blue; font-weight: bold");
    expect(result).toEqual({ color: "blue", fontWeight: "bold" });
  });

  it("converts kebab-case to camelCase", () => {
    expect(parseCssToStyle("font-size: 14px")).toEqual({ fontSize: "14px" });
  });

  it("handles webkit prefix", () => {
    const result = parseCssToStyle("-webkit-background-clip: text");
    expect(result).toEqual({ WebkitBackgroundClip: "text" });
  });

  it("handles webkit-text-fill-color", () => {
    const result = parseCssToStyle("-webkit-text-fill-color: transparent");
    expect(result).toEqual({ WebkitTextFillColor: "transparent" });
  });

  it("handles text-shadow", () => {
    const result = parseCssToStyle("text-shadow: 0 0 5px red");
    expect(result).toEqual({ textShadow: "0 0 5px red" });
  });

  it("handles background-color", () => {
    const result = parseCssToStyle("background-color: #fff");
    expect(result).toEqual({ backgroundColor: "#fff" });
  });

  it("handles border-radius", () => {
    const result = parseCssToStyle("border-radius: 8px");
    expect(result).toEqual({ borderRadius: "8px" });
  });

  it("skips declarations without colon", () => {
    expect(parseCssToStyle("invalid-no-colon")).toEqual({});
  });

  it("skips declarations with empty property or value", () => {
    expect(parseCssToStyle(": value; property:")).toEqual({});
  });

  it("handles values containing colons (e.g. rgba)", () => {
    const result = parseCssToStyle("background: rgba(0, 0, 0, 0.5)");
    expect(result).toEqual({ background: "rgba(0, 0, 0, 0.5)" });
  });
});

describe("getProfileCustomization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCustomizationCache();
  });

  it("reads the public per-user endpoint, not the owner-scoped table", async () => {
    // Regression guard: /profile_customization is scoped to the caller's own
    // user_id, so a foreign id came back empty and nobody ever saw another
    // user's nickname colour. The display fields now come from the public
    // /users/:id/customization route.
    respondWith({ username_css: "color: red" });

    await getProfileCustomization("user-1");

    expect(mockFetch).toHaveBeenCalledWith("/api/v1/users/user-1/customization");
  });

  it("fetches customization from API", async () => {
    const mockData = { username_css: "color: red", profile_badge_text: "VIP", profile_badge_css: null };
    respondWith(mockData);

    const result = await getProfileCustomization("user-1");
    expect(result).toEqual(mockData);
  });

  it("returns null when no data found", async () => {
    respondWith(null);

    const result = await getProfileCustomization("user-1");
    expect(result).toBeNull();
  });

  it("caches result on subsequent calls", async () => {
    const mockData = { username_css: "color: blue", profile_badge_text: null, profile_badge_css: null };
    respondWith(mockData);

    await getProfileCustomization("user-1");
    await getProfileCustomization("user-1");

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent requests for the same user", async () => {
    // A feed mounts N badges for the same author in one commit; the cache is
    // empty until the response resolves, so without in-flight dedupe each badge
    // fired its own identical request.
    respondWith({ username_css: "color: red" });

    await Promise.all([
      getProfileCustomization("user-1"),
      getProfileCustomization("user-1"),
      getProfileCustomization("user-1"),
    ]);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("re-fetches once the cached entry passes its TTL", async () => {
    const mockData = { username_css: "color: blue", profile_badge_text: null, profile_badge_css: null };
    respondWith(mockData);

    // Only Date is faked, so the promise chain still settles normally.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      await getProfileCustomization("user-1");
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Inside the window: served from cache.
      vi.setSystemTime(Date.now() + 4 * 60 * 1000);
      await getProfileCustomization("user-1");
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Past it: a viewer who once saw a nickname must not keep it forever —
      // the invalidate event only fires in the editor's own browser.
      vi.setSystemTime(Date.now() + 6 * 60 * 1000);
      await getProfileCustomization("user-1");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns null on API error", async () => {
    respondWith(null, false);

    const result = await getProfileCustomization("user-1");
    expect(result).toBeNull();
  });

  it("does not cache a response that resolves after an invalidation", async () => {
    let resolveFetch!: (value: unknown) => void;
    mockFetch.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const pending = getProfileCustomization("user-1");
    // The profile is edited while the first request is still on the wire.
    dispatchProfileCacheInvalidate("user-1");
    resolveFetch({ ok: true, json: async () => ({ data: { username_css: "stale" } }) });
    await pending;

    // The pre-edit response must not have repopulated the cache.
    respondWith({ username_css: "fresh" });
    const value = await getProfileCustomization("user-1");
    expect(value?.username_css).toBe("fresh");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe("clearCustomizationCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCustomizationCache();
  });

  it("clears specific user from cache", async () => {
    respondWith({ username_css: null, profile_badge_text: null, profile_badge_css: null });

    await getProfileCustomization("user-1");
    clearCustomizationCache("user-1");
    await getProfileCustomization("user-1");

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("clears entire cache when no userId", async () => {
    respondWith({ username_css: null, profile_badge_text: null, profile_badge_css: null });

    await getProfileCustomization("user-1");
    clearCustomizationCache();
    await getProfileCustomization("user-1");

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe("dispatchProfileCacheInvalidate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCustomizationCache();
  });

  it("dispatches the invalidate event and clears the customization cache", async () => {
    respondWith({ username_css: null, profile_badge_text: null, profile_badge_css: null });

    // Prime the cache for two users
    await getProfileCustomization("user-1");
    await getProfileCustomization("user-2");
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const listener = vi.fn();
    window.addEventListener("profile-cache:invalidate", listener);

    dispatchProfileCacheInvalidate();

    // Event broadcast so ProfileCacheContext / currentUserMeta also reset
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener("profile-cache:invalidate", listener);

    // Cache cleared → next call must refetch, not serve the old value
    await getProfileCustomization("user-1");
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("scopes the event and cache clear to one user when given an id", async () => {
    respondWith({ username_css: null, profile_badge_text: null, profile_badge_css: null });

    await getProfileCustomization("user-1");
    await getProfileCustomization("user-2");
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const listener = vi.fn();
    window.addEventListener("profile-cache:invalidate", listener);

    // The server sends the changed user id with profile_updated; only that
    // profile must be invalidated.
    dispatchProfileCacheInvalidate("user-1");

    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({ userId: "user-1" });
    window.removeEventListener("profile-cache:invalidate", listener);

    // user-1 evicted → refetch; user-2 stays cached (no request).
    await getProfileCustomization("user-1");
    await getProfileCustomization("user-2");
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});
