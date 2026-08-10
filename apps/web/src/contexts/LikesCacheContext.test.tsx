import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LikesCacheProvider, useLikesCache } from "./LikesCacheContext";
import { ReactNode } from "react";

const mockRpc = vi.fn();
vi.mock("@/integrations/api/compat", () => ({
  api: {
    rpc: (...args: any[]) => mockRpc(...args),
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  return <LikesCacheProvider>{children}</LikesCacheProvider>;
}

describe("LikesCacheContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("throws when used outside provider", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => {
      renderHook(() => useLikesCache());
    }).toThrow("useLikesCache must be used within LikesCacheProvider");
    consoleSpy.mockRestore();
  });

  it("getLikeData returns null for empty cache", () => {
    const { result } = renderHook(() => useLikesCache(), { wrapper });
    expect(result.current.getLikeData("post-1", false)).toBeNull();
  });

  it("updateLikeData stores data", () => {
    const { result } = renderHook(() => useLikesCache(), { wrapper });

    act(() => {
      result.current.updateLikeData("post-1", false, true, 5);
    });

    const data = result.current.getLikeData("post-1", false);
    expect(data).not.toBeNull();
    expect(data!.count).toBe(5);
    expect(data!.isLiked).toBe(true);
  });

  it("getLikeData returns null after TTL expiry", () => {
    const { result } = renderHook(() => useLikesCache(), { wrapper });

    act(() => {
      result.current.updateLikeData("post-1", false, true, 5);
    });

    vi.advanceTimersByTime(31000);

    expect(result.current.getLikeData("post-1", false)).toBeNull();
  });

  it("uses different keys for posts vs threads", () => {
    const { result } = renderHook(() => useLikesCache(), { wrapper });

    act(() => {
      result.current.updateLikeData("id-1", false, true, 3);
      result.current.updateLikeData("id-1", true, false, 7);
    });

    expect(result.current.getLikeData("id-1", false)!.count).toBe(3);
    expect(result.current.getLikeData("id-1", true)!.count).toBe(7);
  });

  it("loadLikeData fetches from API", async () => {
    mockRpc.mockImplementation((fn: string) => {
      if (fn === "get_post_likes_count") return Promise.resolve({ data: 10 });
      if (fn === "has_user_liked_post") return Promise.resolve({ data: true });
      return Promise.resolve({ data: null });
    });

    const { result } = renderHook(() => useLikesCache(), { wrapper });

    let data: any;
    await act(async () => {
      data = await result.current.loadLikeData("post-1", "user-1", false);
    });

    expect(data.count).toBe(10);
    expect(data.isLiked).toBe(true);
  });

  it("loadLikeData returns cached data on second call", async () => {
    mockRpc.mockResolvedValue({ data: 5 });

    const { result } = renderHook(() => useLikesCache(), { wrapper });

    await act(async () => {
      await result.current.loadLikeData("post-1", "user-1", false);
    });

    const callCountAfterFirst = mockRpc.mock.calls.length;

    await act(async () => {
      await result.current.loadLikeData("post-1", "user-1", false);
    });

    expect(mockRpc.mock.calls.length).toBe(callCountAfterFirst);
  });

  it("loadLikeData handles API errors gracefully", async () => {
    mockRpc.mockRejectedValue(new Error("Network error"));
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { result } = renderHook(() => useLikesCache(), { wrapper });

    let data: any;
    await act(async () => {
      data = await result.current.loadLikeData("post-1", "user-1", false);
    });

    expect(data.count).toBe(0);
    expect(data.isLiked).toBe(false);
    consoleSpy.mockRestore();
  });

  it("clearCache resets everything", async () => {
    mockRpc.mockResolvedValue({ data: 5 });

    const { result } = renderHook(() => useLikesCache(), { wrapper });

    act(() => {
      result.current.updateLikeData("post-1", false, true, 10);
    });

    act(() => {
      result.current.clearCache();
    });

    expect(result.current.getLikeData("post-1", false)).toBeNull();
  });

  it("deduplicates concurrent requests for same post", async () => {
    mockRpc.mockResolvedValue({ data: 42 });

    const { result } = renderHook(() => useLikesCache(), { wrapper });

    const p1 = result.current.loadLikeData("post-1", null, false);
    const p2 = result.current.loadLikeData("post-1", null, false);

    const [d1, d2] = await Promise.all([p1, p2]);
    expect(d1.count).toBe(d2.count);
  });

  it("loadLikeData for thread uses thread functions", async () => {
    mockRpc.mockImplementation((fn: string) => {
      if (fn === "get_thread_likes_count") return Promise.resolve({ data: 20 });
      return Promise.resolve({ data: null });
    });

    const { result } = renderHook(() => useLikesCache(), { wrapper });

    let data: any;
    await act(async () => {
      data = await result.current.loadLikeData("thread-1", null, true);
    });

    expect(data.count).toBe(20);
    expect(mockRpc).toHaveBeenCalledWith("get_thread_likes_count", { thread_uuid: "thread-1" });
  });

  it("loadLikeDataBatch fetches many posts with ONE rpc call and fills cache", async () => {
    mockRpc.mockImplementation((fn: string) => {
      if (fn === "get_post_likes_batch") {
        return Promise.resolve({
          data: [
            { post_id: "p1", count: 5, is_liked: true },
            { post_id: "p2", count: 2, is_liked: false },
          ],
        });
      }
      return Promise.resolve({ data: null });
    });

    const { result } = renderHook(() => useLikesCache(), { wrapper });

    await act(async () => {
      await result.current.loadLikeDataBatch(["p1", "p2"], "user-1", false);
    });

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith("get_post_likes_batch", { post_ids: "p1,p2", user_uuid: "user-1" });

    // Both entries are now served from cache — zero additional requests.
    expect(result.current.getLikeData("p1", false)!.count).toBe(5);
    expect(result.current.getLikeData("p1", false)!.isLiked).toBe(true);
    expect(result.current.getLikeData("p2", false)!.count).toBe(2);
    expect(result.current.getLikeData("p2", false)!.isLiked).toBe(false);
  });

  it("loadLikeDataBatch skips already-cached ids and requests only the rest", async () => {
    mockRpc.mockImplementation((fn: string) => {
      if (fn === "get_post_likes_batch") {
        return Promise.resolve({ data: [{ post_id: "p2", count: 7, is_liked: false }] });
      }
      return Promise.resolve({ data: null });
    });

    const { result } = renderHook(() => useLikesCache(), { wrapper });

    act(() => {
      result.current.updateLikeData("p1", false, true, 3);
    });

    await act(async () => {
      await result.current.loadLikeDataBatch(["p1", "p2"], null, false);
    });

    // Only the miss (p2) was requested, and p1's fresher local data is kept.
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith("get_post_likes_batch", { post_ids: "p2", user_uuid: "" });
    expect(result.current.getLikeData("p1", false)!.count).toBe(3);
    expect(result.current.getLikeData("p2", false)!.count).toBe(7);
  });

  it("loadLikeDataBatch for threads uses thread batch function", async () => {
    mockRpc.mockImplementation((fn: string) => {
      if (fn === "get_thread_likes_batch") {
        return Promise.resolve({
          data: [{ thread_id: "t1", count: 9, is_liked: true }],
        });
      }
      return Promise.resolve({ data: null });
    });

    const { result } = renderHook(() => useLikesCache(), { wrapper });

    await act(async () => {
      await result.current.loadLikeDataBatch(["t1"], "user-1", true);
    });

    expect(mockRpc).toHaveBeenCalledWith("get_thread_likes_batch", { thread_ids: "t1", user_uuid: "user-1" });
    expect(result.current.getLikeData("t1", true)!.count).toBe(9);
  });

  it("loadLikeDataBatch deduplicates ids and no-ops when everything is cached", async () => {
    mockRpc.mockImplementation((fn: string) => {
      if (fn === "get_post_likes_batch") {
        return Promise.resolve({ data: [{ post_id: "p1", count: 1, is_liked: false }] });
      }
      return Promise.resolve({ data: null });
    });

    const { result } = renderHook(() => useLikesCache(), { wrapper });

    await act(async () => {
      await result.current.loadLikeDataBatch(["p1", "p1", "p1"], null, false);
    });

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith("get_post_likes_batch", { post_ids: "p1", user_uuid: "" });

    const callsBefore = mockRpc.mock.calls.length;
    await act(async () => {
      await result.current.loadLikeDataBatch(["p1"], null, false);
    });
    expect(mockRpc.mock.calls.length).toBe(callsBefore);
  });

  it("loadLikeDataBatch handles API errors gracefully without breaking cache", async () => {
    mockRpc.mockRejectedValue(new Error("Network error"));
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { result } = renderHook(() => useLikesCache(), { wrapper });

    await act(async () => {
      await result.current.loadLikeDataBatch(["p1"], "user-1", false);
    });

    expect(result.current.getLikeData("p1", false)).toBeNull();
    consoleSpy.mockRestore();
  });
});
