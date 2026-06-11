import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockRegister = vi.fn();
const mockLogin = vi.fn();
const mockVerify2FA = vi.fn();
const mockGetCurrentUser = vi.fn();
const mockLogout = vi.fn();
const mockSetupTOTP = vi.fn();
const mockVerifyAndEnableTOTP = vi.fn();
const mockDisableTOTP = vi.fn();
const mockGet2FAStatus = vi.fn();
const mockUpdatePassword = vi.fn();

vi.mock("@/integrations/api/client", () => ({
  apiClient: {
    register: (...args: any[]) => mockRegister(...args),
    login: (...args: any[]) => mockLogin(...args),
    verify2FA: (...args: any[]) => mockVerify2FA(...args),
    getCurrentUser: (...args: any[]) => mockGetCurrentUser(...args),
    logout: (...args: any[]) => mockLogout(...args),
    setupTOTP: (...args: any[]) => mockSetupTOTP(...args),
    verifyAndEnableTOTP: (...args: any[]) => mockVerifyAndEnableTOTP(...args),
    disableTOTP: (...args: any[]) => mockDisableTOTP(...args),
    get2FAStatus: (...args: any[]) => mockGet2FAStatus(...args),
    updatePassword: (...args: any[]) => mockUpdatePassword(...args),
  },
  getDeviceId: () => "test-device-id",
}));

// ─── Module under test ───────────────────────────────────────────────────────

import { apiAuth } from "./auth";

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("apiAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  // ─── signUp ─────────────────────────────────────────────────────────────────

  describe("signUp", () => {
    it("calls apiClient.register with email, username, password", async () => {
      mockRegister.mockResolvedValue({
        token: "token-1",
        user: { id: "user-1", username: "testuser" },
      });

      const result = await apiAuth.signUp({
        email: "test@gomo6.local",
        password: "secret123",
        options: { data: { username: "testuser" } },
      });

      expect(mockRegister).toHaveBeenCalledWith(
        "test@gomo6.local",
        "testuser",
        "secret123",
        { challenge_id: undefined, solution: undefined, captcha_token: undefined },
      );
      expect(result.data?.user).toEqual({ id: "user-1", username: "testuser" });
      expect(result.data?.session?.access_token).toBe("token-1");
      expect(result.error).toBeNull();
    });

    it("falls back to email prefix for username when not provided", async () => {
      mockRegister.mockResolvedValue({
        token: "token-1",
        user: { id: "user-1", username: "test" },
      });

      const result = await apiAuth.signUp({
        email: "test@gomo6.local",
        password: "secret123",
      });

      expect(mockRegister).toHaveBeenCalledWith(
        "test@gomo6.local",
        "test",
        "secret123",
        { challenge_id: undefined, solution: undefined, captcha_token: undefined },
      );
      expect(result.error).toBeNull();
    });

    it("returns error when apiClient.register throws", async () => {
      mockRegister.mockRejectedValue(new Error("Username already taken"));

      const result = await apiAuth.signUp({
        email: "test@gomo6.local",
        password: "secret123",
        options: { data: { username: "testuser" } },
      });

      expect(result.data).toBeNull();
      expect(result.error?.message).toBe("Username already taken");
    });
  });

  // ─── signInWithPassword ─────────────────────────────────────────────────────

  describe("signInWithPassword", () => {
    it("calls apiClient.login with email, password, deviceId", async () => {
      mockLogin.mockResolvedValue({
        token: "token-1",
        user: { id: "user-1", username: "testuser" },
      });

      const result = await apiAuth.signInWithPassword({
        email: "test@gomo6.local",
        password: "secret123",
      });

      expect(mockLogin).toHaveBeenCalledWith(
        "test@gomo6.local",
        "secret123",
        "test-device-id",
        { challenge_id: undefined, solution: undefined, captcha_token: undefined },
      );
      expect(result.data?.user).toEqual({ id: "user-1", username: "testuser" });
      expect(result.data?.session?.access_token).toBe("token-1");
      expect(result.data?.session?.needs_2fa).toBeUndefined();
      expect(result.error).toBeNull();
    });

    it("sets needs_2fa flag when response has needs_2fa", async () => {
      mockLogin.mockResolvedValue({
        token: "partial-token",
        user: { id: "user-1", username: "testuser" },
        needs_2fa: true,
      });

      const result = await apiAuth.signInWithPassword({
        email: "test@gomo6.local",
        password: "secret123",
      });

      expect(result.data?.session?.access_token).toBe("partial-token");
      expect(result.data?.session?.needs_2fa).toBe(true);
      expect(result.error).toBeNull();
    });

    it("returns error on failure", async () => {
      mockLogin.mockRejectedValue(new Error("Invalid login credentials"));

      const result = await apiAuth.signInWithPassword({
        email: "test@gomo6.local",
        password: "wrong",
      });

      expect(result.data).toBeNull();
      expect(result.error?.message).toBe("Invalid login credentials");
    });
  });

  // ─── signOut ────────────────────────────────────────────────────────────────

  describe("signOut", () => {
    it("calls apiClient.logout and returns no error", async () => {
      const result = await apiAuth.signOut();

      expect(mockLogout).toHaveBeenCalledOnce();
      expect(result.error).toBeNull();
    });
  });

  // ─── getUser ────────────────────────────────────────────────────────────────

  describe("getUser", () => {
    it("returns user when token exists and getCurrentUser succeeds", async () => {
      localStorage.setItem("auth_token", "token-1");
      mockGetCurrentUser.mockResolvedValue({
        id: "user-1",
        username: "testuser",
      });

      const result = await apiAuth.getUser();

      expect(mockGetCurrentUser).toHaveBeenCalledOnce();
      expect(result.data?.user).toEqual({ id: "user-1", username: "testuser" });
      expect(result.error).toBeNull();
    });

    it("returns null user when no token", async () => {
      const result = await apiAuth.getUser();

      expect(mockGetCurrentUser).not.toHaveBeenCalled();
      expect(result.data?.user).toBeNull();
      expect(result.error).toBeNull();
    });

    it("returns null user when getCurrentUser throws", async () => {
      localStorage.setItem("auth_token", "token-expired");
      mockGetCurrentUser.mockRejectedValue(new Error("Token expired"));

      const result = await apiAuth.getUser();

      expect(result.data?.user).toBeNull();
      expect(result.error).toBeNull();
    });
  });

  // ─── getSession ─────────────────────────────────────────────────────────────

  describe("getSession", () => {
    it("returns session when user is logged in", async () => {
      localStorage.setItem("auth_token", "token-1");
      mockGetCurrentUser.mockResolvedValue({
        id: "user-1",
        username: "testuser",
      });

      const result = await apiAuth.getSession();

      expect(result.data?.session?.user).toEqual({
        id: "user-1",
        username: "testuser",
      });
      expect(result.data?.session?.access_token).toBe("token-1");
      expect(result.error).toBeNull();
    });

    it("returns null session when no token", async () => {
      const result = await apiAuth.getSession();

      expect(result.data?.session).toBeNull();
      expect(result.error).toBeNull();
    });

    it("returns null session when getCurrentUser returns null", async () => {
      localStorage.setItem("auth_token", "token-1");
      mockGetCurrentUser.mockResolvedValue(null);

      const result = await apiAuth.getSession();

      expect(result.data?.session).toBeNull();
      expect(result.error).toBeNull();
    });
  });

  // ─── verify2FA ──────────────────────────────────────────────────────────────

  describe("verify2FA", () => {
    it("calls apiClient.verify2FA with correct params", async () => {
      mockVerify2FA.mockResolvedValue({
        token: "full-token",
        user: { id: "user-1", username: "testuser" },
      });

      const result = await apiAuth.verify2FA("partial-token", "123456", true);

      expect(mockVerify2FA).toHaveBeenCalledWith(
        "partial-token",
        "123456",
        "test-device-id",
        true,
      );
      expect(result.data?.session?.access_token).toBe("full-token");
      expect(result.error).toBeNull();
    });

    it("returns error on failure", async () => {
      mockVerify2FA.mockRejectedValue(new Error("Invalid code"));

      const result = await apiAuth.verify2FA("partial-token", "000000");

      expect(result.data).toBeNull();
      expect(result.error?.message).toBe("Invalid code");
    });

    it("calls without trustDevice when not provided", async () => {
      mockVerify2FA.mockResolvedValue({
        token: "full-token",
        user: { id: "user-1" },
      });

      await apiAuth.verify2FA("partial-token", "123456");

      expect(mockVerify2FA).toHaveBeenCalledWith(
        "partial-token",
        "123456",
        "test-device-id",
        undefined,
      );
    });
  });

  // ─── setupTOTP ──────────────────────────────────────────────────────────────

  describe("setupTOTP", () => {
    it("calls apiClient.setupTOTP and returns result", async () => {
      mockSetupTOTP.mockResolvedValue({
        secret: "JBSWY3DPEHPK3PXP",
        uri: "otpauth://totp/gomo6:testuser?secret=...",
      });

      const result = await apiAuth.setupTOTP();

      expect(mockSetupTOTP).toHaveBeenCalledOnce();
      expect(result.data?.secret).toBe("JBSWY3DPEHPK3PXP");
      expect(result.error).toBeNull();
    });

    it("returns error on failure", async () => {
      mockSetupTOTP.mockRejectedValue(new Error("Already enabled"));

      const result = await apiAuth.setupTOTP();

      expect(result.data).toBeNull();
      expect(result.error?.message).toBe("Already enabled");
    });
  });

  // ─── verifyAndEnableTOTP ────────────────────────────────────────────────────

  describe("verifyAndEnableTOTP", () => {
    it("calls apiClient.verifyAndEnableTOTP with code", async () => {
      mockVerifyAndEnableTOTP.mockResolvedValue({
        enabled: true,
        recovery_codes: ["code1", "code2"],
      });

      const result = await apiAuth.verifyAndEnableTOTP("123456");

      expect(mockVerifyAndEnableTOTP).toHaveBeenCalledWith("123456");
      expect(result.data?.enabled).toBe(true);
      expect(result.data?.recovery_codes).toEqual(["code1", "code2"]);
      expect(result.error).toBeNull();
    });

    it("returns error on failure", async () => {
      mockVerifyAndEnableTOTP.mockRejectedValue(new Error("Invalid code"));

      const result = await apiAuth.verifyAndEnableTOTP("000000");

      expect(result.data).toBeNull();
      expect(result.error?.message).toBe("Invalid code");
    });
  });

  // ─── disableTOTP ────────────────────────────────────────────────────────────

  describe("disableTOTP", () => {
    it("calls apiClient.disableTOTP and returns ok", async () => {
      mockDisableTOTP.mockResolvedValue(undefined);

      const result = await apiAuth.disableTOTP();

      expect(mockDisableTOTP).toHaveBeenCalledOnce();
      expect(result.data).toEqual({ ok: true });
      expect(result.error).toBeNull();
    });

    it("returns error on failure", async () => {
      mockDisableTOTP.mockRejectedValue(new Error("Cannot disable"));

      const result = await apiAuth.disableTOTP();

      expect(result.data).toBeNull();
      expect(result.error?.message).toBe("Cannot disable");
    });
  });

  // ─── get2FAStatus ───────────────────────────────────────────────────────────

  describe("get2FAStatus", () => {
    it("returns 2FA status from apiClient", async () => {
      mockGet2FAStatus.mockResolvedValue({
        enabled: true,
        has_pending_secret: false,
      });

      const result = await apiAuth.get2FAStatus();

      expect(mockGet2FAStatus).toHaveBeenCalledOnce();
      expect(result.data?.enabled).toBe(true);
      expect(result.data?.has_pending_secret).toBe(false);
      expect(result.error).toBeNull();
    });

    it("returns error on failure", async () => {
      mockGet2FAStatus.mockRejectedValue(new Error("Not authenticated"));

      const result = await apiAuth.get2FAStatus();

      expect(result.data).toBeNull();
      expect(result.error?.message).toBe("Not authenticated");
    });
  });

  // ─── updateUser ─────────────────────────────────────────────────────────────

  describe("updateUser", () => {
    it("calls apiClient.updatePassword when password provided", async () => {
      mockUpdatePassword.mockResolvedValue(undefined);
      mockGetCurrentUser.mockResolvedValue({
        id: "user-1",
        username: "testuser",
      });

      const result = await apiAuth.updateUser({ password: "newpass123" });

      expect(mockUpdatePassword).toHaveBeenCalledWith("newpass123");
      expect(mockGetCurrentUser).toHaveBeenCalledOnce();
      expect(result.data?.user).toEqual({ id: "user-1", username: "testuser" });
      expect(result.error).toBeNull();
    });

    it("returns error when no password provided", async () => {
      const result = await apiAuth.updateUser({});

      expect(mockUpdatePassword).not.toHaveBeenCalled();
      expect(result.data?.user).toBeNull();
      expect(result.error?.message).toBe(
        "Поддерживается только смена пароля (password)",
      );
    });
  });
});
