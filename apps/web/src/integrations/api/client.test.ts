import { describe, it, expect, beforeEach, vi } from "vitest";
import { apiClient } from "./client";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockFetch(data: unknown, status = 200) {
  global.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function mockFetchError(message: string, status = 401) {
  global.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ error: message }), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function mockFetchNetworkError() {
  global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));
}

function makeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.signature`;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ApiClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    apiClient.clearToken();
    // Force-clear the singleton's internal refreshPromise
    (apiClient as any).refreshPromise = null;
    // Always have fetch as a spy so assertions don't blow up
    global.fetch = vi.fn();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Chunk 1: Token management
  // ═══════════════════════════════════════════════════════════════════════════

  describe("token management", () => {
    it("setTokens saves both tokens to localStorage", () => {
      apiClient.setTokens("access-123", "refresh-456");

      expect(localStorage.getItem("auth_token")).toBe("access-123");
      expect(localStorage.getItem("auth_refresh_token")).toBe("refresh-456");
      expect(apiClient.getToken()).toBe("access-123");
      expect(apiClient.getRefreshToken()).toBe("refresh-456");
    });

    it("setTokens with null refresh_token does not store refresh", () => {
      apiClient.setTokens("access-123", null);

      expect(localStorage.getItem("auth_token")).toBe("access-123");
      expect(localStorage.getItem("auth_refresh_token")).toBeNull();
      expect(apiClient.getRefreshToken()).toBeNull();
    });

    it("clearTokens clears everything", () => {
      apiClient.setTokens("access-123", "refresh-456");
      apiClient.clearTokens();

      expect(apiClient.getToken()).toBeNull();
      expect(apiClient.getRefreshToken()).toBeNull();
      expect(localStorage.getItem("auth_token")).toBeNull();
      expect(localStorage.getItem("auth_refresh_token")).toBeNull();
    });

    it("setToken preserves existing refresh token", () => {
      apiClient.setTokens("old-access", "old-refresh");
      apiClient.setToken("new-access");

      expect(apiClient.getToken()).toBe("new-access");
      expect(apiClient.getRefreshToken()).toBe("old-refresh");
    });

    it("clearToken clears both tokens", () => {
      apiClient.setTokens("access", "refresh");
      apiClient.clearToken();

      expect(apiClient.getToken()).toBeNull();
      expect(apiClient.getRefreshToken()).toBeNull();
    });

    it("constructor reads token from localStorage on init", () => {
      const token = makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
      apiClient.setTokens(token, "refresh-abc");
      expect(apiClient.getToken()).toBe(token);
      expect(apiClient.getRefreshToken()).toBe("refresh-abc");
    });

    it("handles invalid JWT gracefully", () => {
      apiClient.setTokens("not-a-jwt", null);
      expect(apiClient.getToken()).toBe("not-a-jwt");
    });

    it("decodes expiry from valid JWT", () => {
      const exp = Math.floor(Date.now() / 1000) + 7200;
      const token = makeJwt({ exp });
      apiClient.setTokens(token, null);
      expect(apiClient.getToken()).toBe(token);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Chunk 2: tryRefreshToken()
  // ═══════════════════════════════════════════════════════════════════════════

  describe("tryRefreshToken", () => {
    it("returns null when no refresh token", async () => {
      const result = await apiClient.tryRefreshToken();
      expect(result).toBeNull();
      expect(fetch).not.toHaveBeenCalled();
    });

    it("successful refresh updates tokens", async () => {
      apiClient.setTokens("old-access", "refresh-token-abc");
      mockFetch({
        success: true,
        data: { token: "new-access", refresh_token: "new-refresh" },
      });

      const result = await apiClient.tryRefreshToken();

      expect(result).toBe("new-access");
      expect(apiClient.getToken()).toBe("new-access");
      expect(apiClient.getRefreshToken()).toBe("new-refresh");
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/auth/refresh"),
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("returns null on non-ok response", async () => {
      apiClient.setTokens("access", "refresh-xyz");
      mockFetchError("Invalid refresh token", 401);

      const result = await apiClient.tryRefreshToken();
      expect(result).toBeNull();
    });

    it("returns null on network error", async () => {
      apiClient.setTokens("access", "refresh-xyz");
      mockFetchNetworkError();

      const result = await apiClient.tryRefreshToken();
      expect(result).toBeNull();
    });

    it("keeps old refresh token when server omits new one", async () => {
      apiClient.setTokens("access", "original-refresh");
      mockFetch({
        success: true,
        data: { token: "new-access" },
      });

      const result = await apiClient.tryRefreshToken();
      expect(result).toBe("new-access");
      expect(apiClient.getRefreshToken()).toBe("original-refresh");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Chunk 3: request() core
  // ═══════════════════════════════════════════════════════════════════════════

  describe("request", () => {
    it("adds Authorization header when token is set", async () => {
      apiClient.setTokens("my-token", null);
      mockFetch({ success: true, data: { ok: true } });

      await apiClient.request("/api/v1/test");

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer my-token",
          }),
        }),
      );
    });

    it("no Authorization header when no token", async () => {
      mockFetch({ success: true, data: { ok: true } });

      await apiClient.request("/api/v1/test");

      const callHeaders = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]
        .headers;
      expect(callHeaders.Authorization).toBeUndefined();
    });

    it("non-JSON response wraps as error", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response("Internal Server Error", { status: 500 }),
      );

      await expect(apiClient.request("/api/v1/test")).rejects.toThrow();
    });

    it("HTTP error (non-401) throws with status", async () => {
      mockFetchError("Not found", 404);

      try {
        await apiClient.request("/api/v1/test");
        expect.fail("Should have thrown");
      } catch (e: unknown) {
        expect((e as Error & { status?: number }).status).toBe(404);
      }
    });

    it("success: false in JSON body throws", async () => {
      mockFetch({ success: false, error: "Validation failed" });

      await expect(apiClient.request("/api/v1/test")).rejects.toThrow(
        "Validation failed",
      );
    });

    it("proactive refresh when token near expiry", async () => {
      const exp = Math.floor(Date.now() / 1000) + 30;
      const token = makeJwt({ exp });
      apiClient.setTokens(token, "refresh-123");

      let callCount = 0;
      global.fetch = vi.fn().mockImplementation((url: string) => {
        callCount++;
        if (url.includes("/api/v1/auth/refresh")) {
          return new Response(
            JSON.stringify({
              success: true,
              data: { token: "refreshed-token" },
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        return new Response(
          JSON.stringify({ success: true, data: { id: "resource-1" } }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      });

      const result = await apiClient.request("/api/v1/test");
      expect(result.data).toEqual({ id: "resource-1" });
      expect(callCount).toBe(2);
    });

    it("401 retry with refresh token re-fetches with new token", async () => {
      apiClient.setTokens("old-token", "refresh-ok");

      let callCount = 0;
      global.fetch = vi.fn().mockImplementation((url: string) => {
        callCount++;
        if (url.includes("/api/v1/auth/refresh")) {
          return new Response(
            JSON.stringify({
              success: true,
              data: { token: "refreshed-token" },
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        if (callCount === 1) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({ success: true, data: { id: "resource-1" } }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      });

      const result = await apiClient.request("/api/v1/protected");
      expect(result.data).toEqual({ id: "resource-1" });
      expect(apiClient.getToken()).toBe("refreshed-token");
    });

    it("401 no refresh token clears tokens and dispatches auth:expired", async () => {
      apiClient.setTokens("expired-token", null);
      mockFetchError("Unauthorized", 401);

      const handler = vi.fn();
      window.addEventListener("auth:expired", handler);

      await expect(apiClient.request("/api/v1/protected")).rejects.toThrow(
        "Session expired",
      );
      expect(apiClient.getToken()).toBeNull();
      expect(handler).toHaveBeenCalled();

      window.removeEventListener("auth:expired", handler);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Chunk 4: Board/Thread/Post methods
  // ═══════════════════════════════════════════════════════════════════════════

  describe("boards", () => {
    it("getBoards with no params calls GET /api/v1/boards", async () => {
      mockFetch({ success: true, data: [], count: 0 });
      const result = await apiClient.getBoards();

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/boards"),
        expect.anything(),
      );
      expect(result.data).toEqual([]);
    });

    it("getBoards with slug adds slug=eq:slug param", async () => {
      mockFetch({ success: true, data: [], count: 0 });
      await apiClient.getBoards({ slug: "my-board" });

      const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(url).toContain("slug=eq%3Amy-board");
    });

    it("getBoards with is_gomosub adds param", async () => {
      mockFetch({ success: true, data: [], count: 0 });
      await apiClient.getBoards({ is_gomosub: true });

      const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(url).toContain("is_gomosub=eq%3Atrue");
    });

    it("getBoard(slug) calls GET /api/v1/boards/{slug}", async () => {
      mockFetch({ success: true, data: { slug: "test", name: "Test" } });
      const result = await apiClient.getBoard("test");

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/boards/test"),
        expect.anything(),
      );
      expect(result.data).toEqual({ slug: "test", name: "Test" });
    });

    it("createBoard calls POST with JSON body", async () => {
      mockFetch({ success: true, data: { id: "board-1" } });
      await apiClient.createBoard({ name: "New Board", slug: "new" });

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/boards"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ name: "New Board", slug: "new" }),
        }),
      );
    });
  });

  describe("threads", () => {
    it("getThreads with board_id adds query param", async () => {
      mockFetch({ success: true, data: [] });
      await apiClient.getThreads({ board_id: "board-1" });

      const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(url).toContain("board_id=board-1");
    });

    it("getThread(id) calls GET /api/v1/threads/{id}", async () => {
      mockFetch({ success: true, data: { id: "t-1", title: "Hello" } });
      const result = await apiClient.getThread("t-1");

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/threads/t-1"),
        expect.anything(),
      );
      expect(result.data).toEqual({ id: "t-1", title: "Hello" });
    });

    it("createThread calls POST to /api/rpc/create_thread", async () => {
      mockFetch({ success: true, data: { id: "t-2" } });
      await apiClient.createThread({ title: "New", content: "Body" });

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/rpc/create_thread"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ title: "New", content: "Body" }),
        }),
      );
    });

    it("getThreads with limit/offset adds pagination params", async () => {
      mockFetch({ success: true, data: [] });
      await apiClient.getThreads({ limit: 10, offset: 20 });

      const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(url).toContain("limit=10");
      expect(url).toContain("offset=20");
    });
  });

  describe("posts", () => {
    it("getPosts with thread_id adds query param", async () => {
      mockFetch({ success: true, data: [] });
      await apiClient.getPosts({ thread_id: "thread-1" });

      const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(url).toContain("thread_id=thread-1");
    });

    it("getPost(id) calls GET /api/v1/posts/{id}", async () => {
      mockFetch({ success: true, data: { id: "p-1", content: "Hello" } });
      const result = await apiClient.getPost("p-1");

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/posts/p-1"),
        expect.anything(),
      );
      expect(result.data).toEqual({ id: "p-1", content: "Hello" });
    });

    it("createPost calls POST to /api/rpc/create_post", async () => {
      mockFetch({ success: true, data: { id: "p-2" } });
      await apiClient.createPost({ thread_id: "t-1", content: "Reply" });

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/rpc/create_post"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ thread_id: "t-1", content: "Reply" }),
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Chunk 5: Profile + Like + RPC methods
  // ═══════════════════════════════════════════════════════════════════════════

  describe("profiles", () => {
    it("getProfiles with username filter", async () => {
      mockFetch({ success: true, data: [] });
      await apiClient.getProfiles({ username: "alice" });

      const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(url).toContain("username=alice");
    });

    it("getProfile(id) calls GET", async () => {
      mockFetch({ success: true, data: { id: "u-1", username: "bob" } });
      const result = await apiClient.getProfile("u-1");

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/profiles/u-1"),
        expect.anything(),
      );
      expect(result.data).toEqual({ id: "u-1", username: "bob" });
    });

    it("updateProfile(id, data) calls PUT", async () => {
      mockFetch({ success: true, data: { id: "u-1" } });
      await apiClient.updateProfile("u-1", { bio: "New bio" });

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/profiles/u-1"),
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ bio: "New bio" }),
        }),
      );
    });
  });

  describe("likes", () => {
    it("likeThread calls POST", async () => {
      mockFetch({ success: true, data: { id: "like-1" } });
      await apiClient.likeThread("thread-1");

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/threads/thread-1/like"),
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("unlikeThread calls DELETE", async () => {
      mockFetch({ success: true, data: null });
      await apiClient.unlikeThread("thread-1");

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/threads/thread-1/like"),
        expect.objectContaining({ method: "DELETE" }),
      );
    });

    it("likePost calls POST", async () => {
      mockFetch({ success: true, data: { id: "like-1" } });
      await apiClient.likePost("post-1");

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/posts/post-1/like"),
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("unlikePost calls DELETE", async () => {
      mockFetch({ success: true, data: null });
      await apiClient.unlikePost("post-1");

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/posts/post-1/like"),
        expect.objectContaining({ method: "DELETE" }),
      );
    });

    it("getThreadLikes with params", async () => {
      mockFetch({ success: true, data: [] });
      await apiClient.getThreadLikes("thread-1", { limit: 5, offset: 10 });

      const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(url).toContain("limit=5");
      expect(url).toContain("offset=10");
    });
  });

  describe("RPC methods", () => {
    it("getPostLikesCount", async () => {
      mockFetch({ success: true, data: 42 });
      const result = await apiClient.getPostLikesCount("post-uuid");

      const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(url).toContain("post_uuid=post-uuid");
      expect(result.data).toBe(42);
    });

    it("getThreadLikesCount", async () => {
      mockFetch({ success: true, data: 7 });
      const result = await apiClient.getThreadLikesCount("thread-uuid");

      const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(url).toContain("thread_uuid=thread-uuid");
      expect(result.data).toBe(7);
    });

    it("hasUserLikedPost", async () => {
      mockFetch({ success: true, data: true });
      const result = await apiClient.hasUserLikedPost("post-uuid", "user-uuid");

      const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(url).toContain("post_uuid=post-uuid");
      expect(url).toContain("user_uuid=user-uuid");
      expect(result.data).toBe(true);
    });

    it("hasUserLikedThread", async () => {
      mockFetch({ success: true, data: false });
      const result = await apiClient.hasUserLikedThread("thread-uuid", "user-uuid");

      expect(result.data).toBe(false);
    });

    it("getUserLikesReceivedCount with encoded UUID", async () => {
      mockFetch({ success: true, data: 15 });
      const result = await apiClient.getUserLikesReceivedCount("user-uuid");

      const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(url).toContain("user_uuid=user-uuid");
      expect(result.data).toBe(15);
    });

    it("getRecentPostLikers with custom limit", async () => {
      mockFetch({ success: true, data: [] });
      await apiClient.getRecentPostLikers("post-uuid", 5);

      const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(url).toContain("limit_count=5");
    });
  });
});
