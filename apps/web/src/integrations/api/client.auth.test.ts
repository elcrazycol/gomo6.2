import { describe, it, expect, beforeEach, vi } from "vitest";
import { apiClient } from "./client";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockFetch(data: any, status = 200) {
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ApiClient auth methods", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    apiClient.clearToken();
  });

  // ─── register ───────────────────────────────────────────────────────────────

  describe("register", () => {
    it("calls POST /api/v1/auth/register and sets token", async () => {
      mockFetch({
        success: true,
        data: {
          token: "test-token",
          user: { id: "user-1", username: "newuser", email: "new@gomo6.local" },
        },
      });

      const result = await apiClient.register(
        "newuser",
        "secret123",
        "New User",
      );

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/auth/register"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            username: "newuser",
            password: "secret123",
            display_name: "New User",
          }),
        }),
      );
      expect(result.token).toBe("test-token");
      expect(result.user.username).toBe("newuser");
      expect(apiClient.getToken()).toBe("test-token");
    });

    it("includes cf_turnstile_response when a Turnstile token is provided", async () => {
      mockFetch({
        success: true,
        data: {
          token: "test-token",
          user: { id: "user-1", username: "newuser" },
        },
      });

      await apiClient.register(
        "newuser",
        "secret123",
        undefined,
        "cf-token-abc",
      );

      const callBody = JSON.parse((fetch as any).mock.calls[0][1].body);
      expect(callBody.cf_turnstile_response).toBe("cf-token-abc");
    });

    it("throws on error response", async () => {
      mockFetchError("Username already taken");

      await expect(
        apiClient.register("existing", "password123"),
      ).rejects.toThrow("Username already taken");
    });

    it("throws on network error", async () => {
      mockFetchNetworkError();

      await expect(
        apiClient.register("newuser", "password123"),
      ).rejects.toThrow("Network error");
    });
  });

  // ─── login ──────────────────────────────────────────────────────────────────

  describe("login", () => {
    it("calls POST /api/v1/auth/login and sets token", async () => {
      mockFetch({
        success: true,
        data: {
          token: "full-token",
          user: { id: "user-1", username: "testuser", email: "test@gomo6.local" },
        },
      });

      const result = await apiClient.login("testuser", "secret123");

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/auth/login"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            username: "testuser",
            password: "secret123",
          }),
        }),
      );
      expect(result.token).toBe("full-token");
      expect(apiClient.getToken()).toBe("full-token");
    });

    it("passes device_token when provided", async () => {
      mockFetch({
        success: true,
        data: {
          token: "token",
          user: { id: "user-1" },
        },
      });

      await apiClient.login("testuser", "pass", "device-token-abc");

      const callBody = JSON.parse(
        (fetch as any).mock.calls[0][1].body,
      );
      expect(callBody.device_token).toBe("device-token-abc");
    });

    it("includes cf_turnstile_response when a Turnstile token is provided", async () => {
      mockFetch({
        success: true,
        data: {
          token: "token",
          user: { id: "user-1" },
        },
      });

      await apiClient.login(
        "testuser",
        "pass",
        undefined,
        "cf-token-def",
      );

      const callBody = JSON.parse((fetch as any).mock.calls[0][1].body);
      expect(callBody.cf_turnstile_response).toBe("cf-token-def");
    });

    it("sets needs_2fa flag without saving token", async () => {
      mockFetch({
        success: true,
        data: {
          token: "partial-token",
          user: { id: "user-1" },
          needs_2fa: true,
        },
      });

      const result = await apiClient.login("test@gomo6.local", "secret123");

      expect(result.needs_2fa).toBe(true);
      expect(result.token).toBe("partial-token");
      // Token should NOT be saved when 2FA is needed
      expect(apiClient.getToken()).toBeNull();
    });
  });

  // ─── getCurrentUser ─────────────────────────────────────────────────────────

  describe("getCurrentUser", () => {
    it("returns null when no token set", async () => {
      const result = await apiClient.getCurrentUser();

      expect(result).toBeNull();
      expect(fetch).not.toHaveBeenCalled();
    });

    it("fetches /api/v1/auth/me with auth header", async () => {
      apiClient.setToken("test-token");
      mockFetch({
        success: true,
        data: {
          id: "user-1",
          username: "testuser",
          email: "test@gomo6.local",
          domain: "gomo6.wtf",
          created_at: "2024-01-01T00:00:00Z",
          is_remote: false,
          is_anonymous: false,
        },
      });

      const result = await apiClient.getCurrentUser();

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/auth/me"),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        }),
      );
      expect(result?.username).toBe("testuser");
    });

    it("clears token and returns null on 401", async () => {
      apiClient.setToken("expired-token");
      mockFetchError("Unauthorized", 401);

      const result = await apiClient.getCurrentUser();

      expect(result).toBeNull();
      expect(apiClient.getToken()).toBeNull();
    });
  });

  // ─── logout ─────────────────────────────────────────────────────────────────

  describe("logout", () => {
    it("clears the token", async () => {
      apiClient.setToken("test-token");
      expect(apiClient.getToken()).toBe("test-token");

      await apiClient.logout();

      expect(apiClient.getToken()).toBeNull();
    });

    it("purges privacy-sensitive PWA caches (L2)", async () => {
      apiClient.setToken("test-token");
      mockFetch({ success: true, data: { ok: true } });

      // Simulate the browser Cache Storage API. jsdom exposes neither
      // window.caches nor globalThis.caches by default, so both must be
      // stubbed for the guard in logout() to run.
      const deleteMock = vi.fn().mockResolvedValue(true);
      const cachesStub = { delete: deleteMock };
      (globalThis as any).caches = cachesStub;
      Object.defineProperty(window, "caches", {
        value: cachesStub,
        configurable: true,
      });

      try {
        await apiClient.logout();
      } finally {
        delete (globalThis as any).caches;
      }

      expect(deleteMock).toHaveBeenCalledWith("storage-objects");
      expect(deleteMock).toHaveBeenCalledWith("storage-objects-v2");
      expect(deleteMock).toHaveBeenCalledWith("messenger-conversations");
    });
  });

  // ─── setToken / clearToken / getToken ───────────────────────────────────────

  describe("token management", () => {
    it("setToken saves to localStorage and getToken returns it", () => {
      apiClient.setToken("my-token");

      expect(apiClient.getToken()).toBe("my-token");
      expect(apiClient.getToken()).toBe("my-token");
    });

    it("clearToken removes from localStorage and getToken returns null", () => {
      apiClient.setToken("my-token");
      apiClient.clearToken();

      expect(apiClient.getToken()).toBeNull();
      expect(apiClient.getToken()).toBeNull();
    });

    it("does not load auth tokens from localStorage", () => {
      // Browser sessions are restored through HttpOnly cookies, not Web Storage.
      expect(apiClient.getToken()).toBeNull();
    });
  });

  // ─── verify2FA ──────────────────────────────────────────────────────────────

  describe("verify2FA", () => {
    it("calls POST /api/v1/auth/verify-2fa and sets token", async () => {
      mockFetch({
        success: true,
        data: {
          token: "full-token",
          user: { id: "user-1" },
        },
      });

      const result = await apiClient.verify2FA(
        "partial-token",
        "123456",
        "device-token-abc",
        true,
      );

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/auth/verify-2fa"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            token: "partial-token",
            code: "123456",
            device_token: "device-token-abc",
            trust_device: true,
          }),
        }),
      );
      expect(result.token).toBe("full-token");
      expect(apiClient.getToken()).toBe("full-token");
    });

    it("does not include trust_device when false", async () => {
      mockFetch({
        success: true,
        data: { token: "full-token", user: { id: "user-1" } },
      });

      await apiClient.verify2FA("partial-token", "123456");

      const callBody = JSON.parse((fetch as any).mock.calls[0][1].body);
      expect(callBody.trust_device).toBeUndefined();
    });
  });

  // ─── TOTP methods ───────────────────────────────────────────────────────────

  describe("TOTP methods", () => {
    it("setupTOTP calls POST /api/v1/auth/2fa/setup with current password", async () => {
      apiClient.setToken("test-token");
      mockFetch({
        success: true,
        data: {
          secret: "JBSWY3DPEHPK3PXP",
          uri: "otpauth://totp/gomo6:testuser?secret=JBSWY3DPEHPK3PXP",
        },
      });

      const result = await apiClient.setupTOTP("current-pass");

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/auth/2fa/setup"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ password: "current-pass" }),
        }),
      );
      expect(result.secret).toBe("JBSWY3DPEHPK3PXP");
    });

    it("verifyAndEnableTOTP calls POST with code", async () => {
      apiClient.setToken("test-token");
      mockFetch({
        success: true,
        data: {
          enabled: true,
          recovery_codes: ["code1", "code2"],
        },
      });

      const result = await apiClient.verifyAndEnableTOTP("123456");

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/auth/2fa/verify-and-enable"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ code: "123456" }),
        }),
      );
      expect(result.enabled).toBe(true);
      expect(result.recovery_codes).toEqual(["code1", "code2"]);
    });

    it("disableTOTP calls POST /api/v1/auth/2fa/disable with current code", async () => {
      apiClient.setToken("test-token");
      mockFetch({ success: true, data: { ok: true } });

      await apiClient.disableTOTP("123456");

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/auth/2fa/disable"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ code: "123456" }),
        }),
      );
    });

    it("get2FAStatus calls GET /api/v1/auth/2fa/status", async () => {
      apiClient.setToken("test-token");
      mockFetch({
        success: true,
        data: { enabled: true, has_pending_secret: false },
      });

      const result = await apiClient.get2FAStatus();

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/auth/2fa/status"),
        expect.any(Object),
      );
      expect(result.enabled).toBe(true);
    });
  });

  // ─── updatePassword ─────────────────────────────────────────────────────────

  describe("updatePassword", () => {
    it("calls POST /api/v1/auth/password", async () => {
      apiClient.setToken("test-token");
      mockFetch({ success: true, data: { ok: true } });

      await apiClient.updatePassword("new-secret");

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/auth/password"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ password: "new-secret", current_password: "" }),
        }),
      );
    });
  });
});
