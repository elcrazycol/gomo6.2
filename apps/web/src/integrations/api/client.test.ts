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
});
