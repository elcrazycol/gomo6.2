import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { useAuth, useSession } from "./useAuth";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockGetCurrentUser = vi.fn();

vi.mock("@/integrations/api/client", () => ({
  apiClient: {
    getCurrentUser: (...args: any[]) => mockGetCurrentUser(...args),
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("returns user when getCurrentUser succeeds", async () => {
    const testUser = {
      id: "user-1",
      username: "testuser",
      email: "test@gomo6.local",
      domain: "gomo6.wtf",
      created_at: "2024-01-01T00:00:00Z",
      is_remote: false,
      is_anonymous: false,
    };
    mockGetCurrentUser.mockResolvedValue(testUser);

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.user).toEqual(testUser);
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("returns null user when not authenticated", async () => {
    mockGetCurrentUser.mockResolvedValue(null);

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it("returns falsy user when getCurrentUser throws", async () => {
    mockGetCurrentUser.mockRejectedValue(new Error("Token expired"));

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(),
    });

    // Query has retry:1, so wait for it to finish retrying
    await waitFor(
      () => {
        expect(result.current.isLoading).toBe(false);
      },
      { timeout: 5000 },
    );

    // When query errors, data is undefined (not null)
    expect(result.current.user).toBeFalsy();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it("fetches current user on mount", async () => {
    // We can verify the query functions by checking the data flow
    mockGetCurrentUser.mockResolvedValue({
      id: "user-1",
      username: "testuser",
      email: "test@gomo6.local",
      domain: "gomo6.wtf",
      created_at: new Date().toISOString(),
      is_remote: false,
      is_anonymous: false,
    });

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Should fetch on mount
    expect(mockGetCurrentUser).toHaveBeenCalledTimes(1);
  });
});

describe("useSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("returns session with token when user is authenticated", async () => {
    localStorage.setItem("auth_token", "test-token-123");
    mockGetCurrentUser.mockResolvedValue({
      id: "user-1",
      username: "testuser",
      email: "test@gomo6.local",
      domain: "gomo6.wtf",
      created_at: "2024-01-01T00:00:00Z",
      is_remote: false,
      is_anonymous: false,
    });

    const { result } = renderHook(() => useSession(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.session).not.toBeNull();
    expect(result.current.session?.user?.username).toBe("testuser");
    expect(result.current.session?.access_token).toBe("test-token-123");
  });

  it("returns null session when apiClient returns null", async () => {
    mockGetCurrentUser.mockResolvedValue(null);

    const { result } = renderHook(() => useSession(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.session).toBeNull();
    // getCurrentUser is called by the queryFn (useSession doesn't gate on localStorage)
    expect(mockGetCurrentUser).toHaveBeenCalledTimes(1);
  });

  it("returns falsy session when getCurrentUser throws", async () => {
    localStorage.setItem("auth_token", "expired-token");
    mockGetCurrentUser.mockRejectedValue(new Error("Unauthorized"));

    const { result } = renderHook(() => useSession(), {
      wrapper: createWrapper(),
    });

    await waitFor(
      () => {
        expect(result.current.isLoading).toBe(false);
      },
      { timeout: 5000 },
    );

    // When query errors, data is undefined (not null)
    expect(result.current.session).toBeFalsy();
  });
});
