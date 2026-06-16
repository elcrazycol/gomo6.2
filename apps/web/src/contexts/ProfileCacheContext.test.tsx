import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ProfileCacheProvider, useProfileCache } from "./ProfileCacheContext";
import { ReactNode } from "react";

const mockFrom = vi.fn();
vi.mock("@/integrations/api/compat", () => ({
  api: {
    from: (...args: any[]) => mockFrom(...args),
  },
}));

function makeChain<T>(resolveValue: T): any {
  const p = Promise.resolve(resolveValue) as any;
  p.select = () => p;
  p.eq = () => p;
  p.single = () => p;
  return p;
}

function wrapper({ children }: { children: ReactNode }) {
  return <ProfileCacheProvider>{children}</ProfileCacheProvider>;
}

function defaultMocks() {
  mockFrom.mockImplementation((table: string) => {
    if (table === "profiles") return makeChain({ data: { username: "alice", avatar_url: "av.jpg" }, error: null });
    if (table === "user_achievements") return makeChain({ data: [], error: null });
    if (table === "user_roles") return makeChain({ data: [], error: null });
    if (table === "profile_customization") return makeChain({ data: null, error: null });
    return makeChain({ data: null, error: null });
  });
}

describe("ProfileCacheContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    defaultMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("throws when used outside provider", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => {
      renderHook(() => useProfileCache());
    }).toThrow("useProfileCache must be used within ProfileCacheProvider");
    consoleSpy.mockRestore();
  });

  it("getProfile returns null for empty cache", () => {
    const { result } = renderHook(() => useProfileCache(), { wrapper });
    expect(result.current.getProfile("user-1")).toBeNull();
  });

  it("loadProfile fetches profile data", async () => {
    const { result } = renderHook(() => useProfileCache(), { wrapper });

    let data: any;
    await act(async () => {
      data = await result.current.loadProfile("user-1");
    });

    expect(data.username).toBe("alice");
    expect(data.avatarUrl).toBe("av.jpg");
  });

  it("caches profile after loading", async () => {
    const { result } = renderHook(() => useProfileCache(), { wrapper });

    await act(async () => {
      await result.current.loadProfile("user-1");
    });

    const cached = result.current.getProfile("user-1");
    expect(cached).not.toBeNull();
    expect(cached!.username).toBe("alice");
    expect(mockFrom).toHaveBeenCalledTimes(4); // 4 parallel API calls
  });

  it("returns cached data on second load", async () => {
    const { result } = renderHook(() => useProfileCache(), { wrapper });

    await act(async () => {
      await result.current.loadProfile("user-1");
    });

    mockFrom.mockClear();
    await act(async () => {
      await result.current.loadProfile("user-1");
    });

    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("returns default profile for undefined userId", async () => {
    const { result } = renderHook(() => useProfileCache(), { wrapper });

    let data: any;
    await act(async () => {
      data = await result.current.loadProfile(undefined);
    });

    expect(data.username).toBe("");
    expect(data.isAdmin).toBe(false);
  });

  it("returns null after TTL expiry", async () => {
    const { result } = renderHook(() => useProfileCache(), { wrapper });

    await act(async () => {
      await result.current.loadProfile("user-1");
    });

    vi.advanceTimersByTime(5 * 60 * 1000 + 1);

    expect(result.current.getProfile("user-1")).toBeNull();
  });

  it("clearCache resets everything", async () => {
    const { result } = renderHook(() => useProfileCache(), { wrapper });

    await act(async () => {
      await result.current.loadProfile("user-1");
    });

    act(() => {
      result.current.clearCache();
    });

    expect(result.current.getProfile("user-1")).toBeNull();
  });

  it("detects admin role", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "profiles") return makeChain({ data: { username: "admin" }, error: null });
      if (table === "user_achievements") return makeChain({ data: [], error: null });
      if (table === "user_roles") return makeChain({ data: [{ role: "admin" }], error: null });
      if (table === "profile_customization") return makeChain({ data: null, error: null });
      return makeChain({ data: null, error: null });
    });

    const { result } = renderHook(() => useProfileCache(), { wrapper });

    let data: any;
    await act(async () => {
      data = await result.current.loadProfile("admin-1");
    });

    expect(data.isAdmin).toBe(true);
  });

  it("extracts color from achievements", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "profiles") return makeChain({ data: { username: "colored" }, error: null });
      if (table === "user_achievements") return makeChain({
        data: [{ achievements: { reward_type: "username_color", reward_value: "purple" } }],
        error: null,
      });
      if (table === "user_roles") return makeChain({ data: [], error: null });
      if (table === "profile_customization") return makeChain({ data: null, error: null });
      return makeChain({ data: null, error: null });
    });

    const { result } = renderHook(() => useProfileCache(), { wrapper });

    let data: any;
    await act(async () => {
      data = await result.current.loadProfile("user-1");
    });

    expect(data.color).toBe("purple");
  });

  it("deduplicates concurrent requests", async () => {
    const { result } = renderHook(() => useProfileCache(), { wrapper });

    const p1 = result.current.loadProfile("user-1");
    const p2 = result.current.loadProfile("user-1");

    const [d1, d2] = await Promise.all([p1, p2]);
    expect(d1).toBe(d2);
  });
});
