import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useOAuth, type UseOAuthOptions } from "./useOAuth";

// ─── Mocks ───────────────────────────────────────────────────────────────────
// vi.hoisted ensures the mock factories can reference these before module init.
const { mockOAuthClient, oauthClients, OAuthError } = vi.hoisted(() => {
  class OAuthError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    OAuthError,
    oauthClients: [] as any[],
    mockOAuthClient: {
      loadTokens: vi.fn(),
      saveTokens: vi.fn(),
      clearTokens: vi.fn(),
      hasValidAccessToken: vi.fn(),
      isTokenExpiringSoon: vi.fn(),
      getUserinfo: vi.fn(),
      refreshToken: vi.fn(),
      handleCallback: vi.fn(),
      getAccessToken: vi.fn(),
      generatePKCE: vi.fn(),
      createAuthorizeUrl: vi.fn(),
      exchangeCode: vi.fn(),
    },
  };
});

vi.mock("@/integrations/api/oauth", () => {
  return {
    OAuthClient: class {
      config: any;
      constructor(config: any) {
        this.config = config;
        Object.assign(this, mockOAuthClient);
        oauthClients.push(this);
      }
    },
    OAuthError,
  };
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const baseConfig = {
  clientId: "test-client",
  authorizationEndpoint: "https://auth.example.com/authorize",
  tokenEndpoint: "https://auth.example.com/token",
  userinfoEndpoint: "https://auth.example.com/userinfo",
  redirectUri: "https://app.example.com/callback",
} as const;

// Simulates the OAuthClient token storage: saveTokens writes, loadTokens reads.
let storedTokens: any = null;

function makeOptions(overrides: Partial<UseOAuthOptions> = {}): UseOAuthOptions {
  return { config: baseConfig, ...overrides } as UseOAuthOptions;
}

const mockTokens = {
  accessToken: "at-1",
  refreshToken: "rt-1",
  idToken: "id-1",
  expiresIn: 3600,
};

const mockUser = { sub: "u1", preferred_username: "bob", email: "bob@example.com" };

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("useOAuth", () => {
  beforeEach(() => {
    // resetAllMocks clears implementations too, so a mockResolvedValue set in
    // one test can never leak into the next one.
    vi.resetAllMocks();
    oauthClients.length = 0;
    sessionStorage.clear();
    storedTokens = null;
    mockOAuthClient.loadTokens.mockImplementation(() => storedTokens);
    mockOAuthClient.saveTokens.mockImplementation((t: any) => {
      storedTokens = t;
    });
    mockOAuthClient.clearTokens.mockImplementation(() => {
      storedTokens = null;
    });
    mockOAuthClient.hasValidAccessToken.mockReturnValue(false);
    mockOAuthClient.isTokenExpiringSoon.mockReturnValue(false);
  });

  it("creates a client with the provided config", () => {
    const { result } = renderHook(() => useOAuth(makeOptions()));
    expect(oauthClients.length).toBeGreaterThanOrEqual(1);
    expect(result.current.client).toBe(oauthClients[0]);
    // The client must have been constructed with the passed config
    expect((oauthClients[0] as any).config).toEqual(baseConfig);
  });

  it("skips token loading when autoLoad is false and reports not loading", () => {
    const { result } = renderHook(() => useOAuth(makeOptions({ autoLoad: false })));
    expect(result.current.isLoading).toBe(false);
    expect(mockOAuthClient.loadTokens).not.toHaveBeenCalled();
  });

  it("stays unauthenticated when there are no stored tokens", async () => {
    const { result } = renderHook(() => useOAuth(makeOptions()));
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.accessToken).toBeNull();
    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it("auto-loads the userinfo from a stored valid token", async () => {
    storedTokens = { accessToken: "at-1", refreshToken: "rt-1", idToken: "id-1" };
    mockOAuthClient.hasValidAccessToken.mockReturnValue(true);
    mockOAuthClient.getUserinfo.mockResolvedValue(mockUser);

    const { result } = renderHook(() => useOAuth(makeOptions()));

    await waitFor(() => {
      expect(result.current.user).toEqual(mockUser);
    });
    expect(result.current.accessToken).toBe("at-1");
    expect(result.current.refreshToken).toBe("rt-1");
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.isExpired).toBe(false);
    expect(mockOAuthClient.getUserinfo).toHaveBeenCalledWith("at-1");
  });

  it("refreshes the token when the stored one has expired", async () => {
    storedTokens = { accessToken: "at-old", refreshToken: "rt-1", idToken: null };
    mockOAuthClient.hasValidAccessToken.mockReturnValue(true); // until getUserinfo fails
    mockOAuthClient.getUserinfo
      .mockRejectedValueOnce(new Error("token expired"))
      .mockResolvedValueOnce(mockUser);
    mockOAuthClient.refreshToken.mockResolvedValue(mockTokens);

    const { result } = renderHook(() => useOAuth(makeOptions()));

    await waitFor(() => {
      expect(result.current.user).toEqual(mockUser);
    });
    expect(mockOAuthClient.refreshToken).toHaveBeenCalledWith("rt-1");
    expect(mockOAuthClient.saveTokens).toHaveBeenCalledWith(mockTokens);
    expect(result.current.accessToken).toBe("at-1");
  });

  it("clears tokens when refresh also fails", async () => {
    storedTokens = { accessToken: "at-old", refreshToken: "rt-dead", idToken: null };
    mockOAuthClient.hasValidAccessToken.mockReturnValue(true);
    mockOAuthClient.getUserinfo.mockRejectedValue(new Error("expired"));
    mockOAuthClient.refreshToken.mockRejectedValue(new Error("invalid_grant"));

    const { result } = renderHook(() => useOAuth(makeOptions()));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(mockOAuthClient.clearTokens).toHaveBeenCalled();
    expect(result.current.accessToken).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it("processes a callback URL on mount (redirect flow)", async () => {
    mockOAuthClient.handleCallback.mockResolvedValue(mockTokens);
    mockOAuthClient.getUserinfo.mockResolvedValue(mockUser);

    const { result } = renderHook(() =>
      useOAuth(
        makeOptions({
          callbackUrl: "https://app.example.com/callback?code=xyz",
          savedVerifier: "verifier-1",
          savedState: "state-1",
        }),
      ),
    );

    await waitFor(() => {
      expect(result.current.user).toEqual(mockUser);
    });
    expect(mockOAuthClient.handleCallback).toHaveBeenCalledWith(
      "https://app.example.com/callback?code=xyz",
      "verifier-1",
      "state-1",
    );
    expect(mockOAuthClient.saveTokens).toHaveBeenCalledWith(mockTokens);
    expect(result.current.accessToken).toBe("at-1");
  });

  it("stores the error when callback processing fails on mount", async () => {
    mockOAuthClient.handleCallback.mockRejectedValue(new OAuthError("invalid_state", "State mismatch"));

    const { result } = renderHook(() =>
      useOAuth(makeOptions({ callbackUrl: "cb-url", savedVerifier: "v", savedState: "s" })),
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.error).toBeInstanceOf(OAuthError);
  });

  it("loginWithRedirect stores the PKCE verifier and builds the authorize URL", async () => {
    mockOAuthClient.generatePKCE.mockResolvedValue({ verifier: "verifier-abc", challenge: "challenge-abc" });
    mockOAuthClient.createAuthorizeUrl.mockReturnValue(
      new URL("https://auth.example.com/authorize?code_challenge=challenge-abc"),
    );

    const { result } = renderHook(() => useOAuth(makeOptions({ autoLoad: false })));

    let url: URL | undefined;
    await act(async () => {
      url = await result.current.loginWithRedirect();
    });

    expect(url?.toString()).toContain("code_challenge=challenge-abc");
    expect(sessionStorage.getItem("oauth_pkce_verifier")).toBe("verifier-abc");
    expect(sessionStorage.getItem("oauth_state")).toBeTruthy();
    expect(mockOAuthClient.createAuthorizeUrl).toHaveBeenCalledWith({
      scope: "openid profile email",
      state: expect.any(String),
      codeChallenge: "challenge-abc",
      codeChallengeMethod: "S256",
      extraParams: undefined,
    });
  });

  it("logout clears all state", async () => {
    storedTokens = { accessToken: "at-1", refreshToken: "rt-1", idToken: "id-1" };
    mockOAuthClient.hasValidAccessToken.mockReturnValue(true);
    mockOAuthClient.getUserinfo.mockResolvedValue(mockUser);

    const { result } = renderHook(() => useOAuth(makeOptions()));
    await waitFor(() => {
      expect(result.current.user).toEqual(mockUser);
    });

    act(() => {
      result.current.logout();
    });

    expect(mockOAuthClient.clearTokens).toHaveBeenCalled();
    expect(result.current.accessToken).toBeNull();
    expect(result.current.refreshToken).toBeNull();
    expect(result.current.idToken).toBeNull();
    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it("getAccessToken returns the client token and syncs store state", async () => {
    mockOAuthClient.getAccessToken.mockResolvedValue("at-fresh");
    storedTokens = { accessToken: "at-fresh", refreshToken: "rt-1", idToken: null };
    mockOAuthClient.loadTokens.mockImplementation(() => storedTokens);

    const { result } = renderHook(() => useOAuth(makeOptions({ autoLoad: false })));

    let token: string | null = null;
    await act(async () => {
      token = await result.current.getAccessToken();
    });

    expect(token).toBe("at-fresh");
    expect(result.current.accessToken).toBe("at-fresh");
  });

  it("handleCallback action throws when the PKCE verifier is missing", async () => {
    const { result } = renderHook(() => useOAuth(makeOptions({ autoLoad: false })));

    await act(async () => {
      await expect(result.current.handleCallback("https://app/cb?code=x")).rejects.toMatchObject({
        code: "missing_verifier",
      });
    });
    expect(result.current.error).toMatchObject({ code: "missing_verifier" });
  });

  it("handleCallback action exchanges the code and loads the user", async () => {
    // The client persists tokens itself during handleCallback (the hook's
    // action does not call saveTokens explicitly), so the mock must too.
    mockOAuthClient.handleCallback.mockImplementation(async () => {
      storedTokens = mockTokens;
      return mockTokens;
    });
    mockOAuthClient.getUserinfo.mockResolvedValue(mockUser);
    sessionStorage.setItem("oauth_pkce_verifier", "v1");
    sessionStorage.setItem("oauth_state", "s1");

    const { result } = renderHook(() => useOAuth(makeOptions({ autoLoad: false })));

    await act(async () => {
      await result.current.handleCallback("https://app/cb?code=x");
    });

    expect(result.current.user).toEqual(mockUser);
    expect(result.current.accessToken).toBe("at-1");
    // PKCE artifacts are cleaned up
    expect(sessionStorage.getItem("oauth_pkce_verifier")).toBeNull();
    expect(sessionStorage.getItem("oauth_state")).toBeNull();
  });

  it("refresh throws when there is no refresh token", async () => {
    storedTokens = { accessToken: "at-1", refreshToken: null, idToken: null };
    mockOAuthClient.loadTokens.mockImplementation(() => storedTokens);

    const { result } = renderHook(() => useOAuth(makeOptions({ autoLoad: false })));

    await act(async () => {
      await expect(result.current.refresh()).rejects.toMatchObject({ code: "no_refresh_token" });
    });
  });

  it("refresh exchanges the stored refresh token and saves the new pair", async () => {
    storedTokens = { accessToken: "at-1", refreshToken: "rt-1", idToken: null };
    mockOAuthClient.refreshToken.mockResolvedValue(mockTokens);

    const { result } = renderHook(() => useOAuth(makeOptions({ autoLoad: false })));

    await act(async () => {
      await result.current.refresh();
    });

    expect(mockOAuthClient.refreshToken).toHaveBeenCalledWith("rt-1");
    expect(mockOAuthClient.saveTokens).toHaveBeenCalledWith(mockTokens);
    expect(result.current.accessToken).toBe("at-1");
  });

  it("exchangeCode exchanges a code manually and stores the tokens", async () => {
    mockOAuthClient.exchangeCode.mockResolvedValue(mockTokens);
    mockOAuthClient.getUserinfo.mockResolvedValue(mockUser);

    const { result } = renderHook(() => useOAuth(makeOptions({ autoLoad: false })));

    await act(async () => {
      await result.current.exchangeCode("auth-code", "verifier-1");
    });

    expect(mockOAuthClient.exchangeCode).toHaveBeenCalledWith({ code: "auth-code", codeVerifier: "verifier-1" });
    expect(mockOAuthClient.saveTokens).toHaveBeenCalledWith(mockTokens);
    expect(result.current.user).toEqual(mockUser);
  });
});
