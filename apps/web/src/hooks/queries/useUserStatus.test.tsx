import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useUserStatus, useBulkUserStatus } from "./useUserStatus";

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
  mockChain.single.mockReturnThis();
  mockChain.in.mockReturnThis();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function mockResolve(data: unknown, error: unknown = null) {
  mockChain.then.mockImplementation((cb: any) => {
    return Promise.resolve({ data, error }).then(cb);
  });
}

// ─── useUserStatus ───────────────────────────────────────────────────────────

describe("useUserStatus", () => {
  it("is disabled when userId is undefined", async () => {
    const { result } = renderHook(() => useUserStatus(undefined), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toBeUndefined();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("fetches status with a 30s cache TTL override", async () => {
    mockResolve({ id: "u1", is_online: true, last_seen: "2025-01-01T00:00:00Z" });

    const { result } = renderHook(() => useUserStatus("u1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.data).toEqual({
      user_id: "u1",
      is_online: true,
      last_seen: "2025-01-01T00:00:00Z",
    });
    expect(mockFrom).toHaveBeenCalledWith("profiles", { ttlMs: 30 * 1000 });
    expect(mockChain.select).toHaveBeenCalledWith("id, is_online, last_seen");
    expect(mockChain.eq).toHaveBeenCalledWith("id", "u1");
  });

  it("defaults is_online to false when the field is missing", async () => {
    mockResolve({ id: "u1", last_seen: null });

    const { result } = renderHook(() => useUserStatus("u1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.data?.is_online).toBe(false);
  });

  it("surfaces API errors", async () => {
    mockResolve(null, { message: "boom" });

    const { result } = renderHook(() => useUserStatus("u1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeDefined();
  });
});

// ─── useBulkUserStatus ───────────────────────────────────────────────────────

describe("useBulkUserStatus", () => {
  it("is disabled for an empty id list", async () => {
    const { result } = renderHook(() => useBulkUserStatus([]), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("fetches statuses for multiple users", async () => {
    mockResolve([
      { id: "u1", is_online: true, last_seen: "2025-01-01T00:00:00Z" },
      { id: "u2", is_online: false, last_seen: null },
    ]);

    const { result } = renderHook(() => useBulkUserStatus(["u1", "u2"]), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.data).toEqual([
      { user_id: "u1", is_online: true, last_seen: "2025-01-01T00:00:00Z" },
      { user_id: "u2", is_online: false, last_seen: null },
    ]);
    expect(mockFrom).toHaveBeenCalledWith("profiles", { ttlMs: 30 * 1000 });
    expect(mockChain.in).toHaveBeenCalledWith("id", ["u1", "u2"]);
  });

  it("normalizes missing is_online to false", async () => {
    mockResolve([{ id: "u1" }]);

    const { result } = renderHook(() => useBulkUserStatus(["u1"]), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.data?.[0].is_online).toBe(false);
  });

  it("surfaces API errors", async () => {
    mockResolve(null, { message: "boom" });

    const { result } = renderHook(() => useBulkUserStatus(["u1"]), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
