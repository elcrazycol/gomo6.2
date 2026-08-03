import { describe, it, expect, beforeEach } from "vitest";
import { OAuthClient, type TokenResponse } from "./oauth";

const baseTokens: TokenResponse = {
  accessToken: "at-123",
  tokenType: "Bearer",
  expiresIn: 3600,
  refreshToken: "rt-456",
};

function makeClient(storageKey?: string, persistTokens?: boolean): OAuthClient {
  return new OAuthClient({
    clientId: "test-client",
    redirectUri: "http://localhost:3000/callback",
    ...(storageKey ? { storageKey } : {}),
    ...(persistTokens !== undefined ? { persistTokens } : {}),
  });
}

describe("OAuthClient token storage (C1: no tokens in localStorage)", () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset the module-level in-memory store for the default storage key so
    // tests in this file do not observe each other's saved tokens.
    makeClient().clearTokens();
  });

  it("keeps tokens in memory and never writes them to localStorage by default", () => {
    const client = makeClient();

    client.saveTokens(baseTokens);

    expect(client.loadTokens()?.accessToken).toBe("at-123");
    expect(client.loadTokens()?.refreshToken).toBe("rt-456");
    expect(localStorage.getItem("gomo6_oauth_tokens")).toBeNull();
  });

  it("persists tokens to localStorage only when persistTokens is enabled", () => {
    const client = makeClient(undefined, true);

    client.saveTokens(baseTokens);

    expect(localStorage.getItem("gomo6_oauth_tokens")).toContain("at-123");
    expect(client.loadTokens()?.refreshToken).toBe("rt-456");
  });

  it("does not resurrect legacy localStorage tokens into memory by default", () => {
    const storageKey = "legacy_orphan";
    localStorage.setItem(
      `${storageKey}_tokens`,
      JSON.stringify({ accessToken: "stale", refreshToken: "stale-rt" }),
    );
    const client = makeClient(storageKey);

    expect(client.loadTokens()).toBeNull();
  });

  it("removes a legacy localStorage copy when saving in-memory tokens", () => {
    const storageKey = "legacy_migration";
    localStorage.setItem(
      `${storageKey}_tokens`,
      JSON.stringify({ accessToken: "old", refreshToken: "old-rt" }),
    );
    const client = makeClient(storageKey);

    client.saveTokens(baseTokens);

    expect(localStorage.getItem(`${storageKey}_tokens`)).toBeNull();
    expect(client.loadTokens()?.accessToken).toBe("at-123");
  });

  it("clearTokens wipes both the in-memory store and any legacy localStorage copy", () => {
    const client = makeClient(undefined, true);
    client.saveTokens(baseTokens);
    expect(client.loadTokens()).not.toBeNull();

    client.clearTokens();

    expect(client.loadTokens()).toBeNull();
    expect(localStorage.getItem("gomo6_oauth_tokens")).toBeNull();
  });

  it("separate storageKey prefixes use separate in-memory stores", () => {
    const clientA = makeClient("app_a");
    const clientB = makeClient("app_b");

    clientA.saveTokens(baseTokens);
    clientB.saveTokens({ ...baseTokens, accessToken: "at-b" });

    expect(clientA.loadTokens()?.accessToken).toBe("at-123");
    expect(clientB.loadTokens()?.accessToken).toBe("at-b");
    // Neither leaked into localStorage
    expect(localStorage.getItem("app_a_tokens")).toBeNull();
    expect(localStorage.getItem("app_b_tokens")).toBeNull();
  });
});
