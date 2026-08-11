import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  useProfile,
  useProfiles,
  useUpdateProfile,
  useAchievements,
  useUserThreads,
} from "./useProfiles";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockChain: any = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  range: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  single: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  then: vi.fn(),
};

const mockFrom = vi.fn().mockReturnValue(mockChain);

vi.mock("@/integrations/api/compat", () => ({
  api: {
    from: (...args: any[]) => mockFrom(...args),
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: "test-token" } },
        error: null,
      }),
    },
    rpc: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockFrom.mockReturnValue(mockChain);
  mockChain.select.mockReturnThis();
  mockChain.eq.mockReturnThis();
  mockChain.order.mockReturnThis();
  mockChain.range.mockReturnThis();
  mockChain.limit.mockReturnThis();
  mockChain.in.mockReturnThis();
  mockChain.single.mockReturnThis();
  mockChain.maybeSingle.mockReturnThis();
  mockChain.update.mockReturnThis();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Wrapper ──────────────────────────────────────────────────────────────────

function createWrapper(queryClient?: QueryClient) {
  const client =
    queryClient ??
    new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function mockResolve(data: unknown, error: unknown = null) {
  mockChain.then.mockImplementation((cb: any) => {
    return Promise.resolve({ data, error }).then(cb);
  });
}

// ─── useProfile ──────────────────────────────────────────────────────────────

describe("useProfile", () => {
  it("is disabled when userId is undefined", async () => {
    const { result } = renderHook(() => useProfile(undefined), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toBeUndefined();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("fetches a single profile by id", async () => {
    const profile = { id: "u1", username: "alice", created_at: "2025-01-01T00:00:00Z" };
    mockResolve(profile);

    const { result } = renderHook(() => useProfile("u1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.data).toEqual(profile);
    expect(mockFrom).toHaveBeenCalledWith("profiles");
    expect(mockChain.eq).toHaveBeenCalledWith("id", "u1");
    expect(mockChain.single).toHaveBeenCalled();
  });

  it("surfaces API errors", async () => {
    mockResolve(null, { message: "boom" });

    const { result } = renderHook(() => useProfile("u1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeDefined();
  });
});

// ─── useProfiles ─────────────────────────────────────────────────────────────

describe("useProfiles", () => {
  it("is disabled for an empty id list", async () => {
    const { result } = renderHook(() => useProfiles([]), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("fetches a batch of profiles sorted by id", async () => {
    const profiles = [
      { id: "u2", username: "bob", created_at: "2025-01-01T00:00:00Z" },
      { id: "u1", username: "alice", created_at: "2025-01-01T00:00:00Z" },
    ];
    mockResolve(profiles);

    const { result } = renderHook(() => useProfiles(["u2", "u1"]), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.data).toEqual(profiles);
    expect(mockChain.in).toHaveBeenCalledWith("id", ["u2", "u1"]);
  });

  it("dedupes overlapping queries into one cache entry", async () => {
    mockResolve([]);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = createWrapper(queryClient);

    renderHook(() => useProfiles(["a", "b"]), { wrapper });
    renderHook(() => useProfiles(["b", "a"]), { wrapper });

    await waitFor(() => {
      const entries = queryClient
        .getQueryCache()
        .getAll()
        .filter((q) => String(q.queryKey[0]).startsWith("profiles"));
      expect(entries).toHaveLength(1);
    });
  });
});

// ─── useUpdateProfile ────────────────────────────────────────────────────────

describe("useUpdateProfile", () => {
  it("updates the profile and invalidates related caches", async () => {
    const updated = { id: "u1", username: "alice", bio: "new bio", created_at: "2025-01-01T00:00:00Z" };
    mockResolve(updated);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const wrapper = createWrapper(queryClient);

    const { result } = renderHook(() => useUpdateProfile(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ userId: "u1", updates: { bio: "new bio" } });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockChain.update).toHaveBeenCalledWith({ bio: "new bio" });
    expect(mockChain.eq).toHaveBeenCalledWith("id", "u1");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["profile", "u1"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["profiles"] });
  });

  it("throws when the API returns an error", async () => {
    mockResolve(null, { message: "update failed" });

    const { result } = renderHook(() => useUpdateProfile(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ userId: "u1", updates: { bio: "x" } })
      ).rejects.toThrow();
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

// ─── useAchievements ─────────────────────────────────────────────────────────

describe("useAchievements", () => {
  it("is disabled when userId is undefined", async () => {
    const { result } = renderHook(() => useAchievements(undefined), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("fetches user achievements with related data", async () => {
    const rows = [{ level: 1, is_pinned: false, achievements: { id: "a1" } }];
    mockResolve(rows);

    const { result } = renderHook(() => useAchievements("u1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.data).toEqual(rows);
    expect(mockFrom).toHaveBeenCalledWith("user_achievements");
    expect(mockChain.eq).toHaveBeenCalledWith("user_id", "u1");
    expect(mockChain.order).toHaveBeenCalledWith("is_pinned", { ascending: false });
    expect(mockChain.order).toHaveBeenCalledWith("level", { ascending: false });
  });
});

// ─── useUserThreads ──────────────────────────────────────────────────────────

describe("useUserThreads", () => {
  it("is disabled when userId is undefined", async () => {
    const { result } = renderHook(() => useUserThreads(undefined), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("respects the enabled=false option", async () => {
    const { result } = renderHook(() => useUserThreads("u1", { enabled: false }), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("fetches the latest 20 threads for a user", async () => {
    const threads = [{ id: "t1", title: "Hello", user_id: "u1", created_at: "2025-01-01T00:00:00Z" }];
    mockResolve(threads);

    const { result } = renderHook(() => useUserThreads("u1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.data).toEqual(threads);
    expect(mockFrom).toHaveBeenCalledWith("threads");
    expect(mockChain.eq).toHaveBeenCalledWith("user_id", "u1");
    expect(mockChain.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(mockChain.limit).toHaveBeenCalledWith(20);
  });
});
