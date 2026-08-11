import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useThread, useThreads, useCreateThread, useThreadSubscription } from "./useThreads";

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
  mockChain.single.mockReturnThis();
  mockChain.maybeSingle.mockReturnThis();
  mockChain.insert.mockReturnThis();
});

afterEach(() => {
  vi.restoreAllMocks();
});

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

// ─── useThread ───────────────────────────────────────────────────────────────

describe("useThread", () => {
  it("is disabled when threadId is undefined", async () => {
    const { result } = renderHook(() => useThread(undefined), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toBeUndefined();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("fetches a thread with related board and profile", async () => {
    const thread = { id: "t1", title: "Hi", board_id: "b1", user_id: "u1", created_at: "2025-01-01T00:00:00Z" };
    mockResolve(thread);

    const { result } = renderHook(() => useThread("t1"), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.data).toEqual(thread);
    expect(mockFrom).toHaveBeenCalledWith("threads");
    expect(mockChain.select).toHaveBeenCalledWith("*, boards(*), profiles:user_id(*)");
    expect(mockChain.eq).toHaveBeenCalledWith("id", "t1");
    expect(mockChain.single).toHaveBeenCalled();
  });

  it("surfaces API errors", async () => {
    mockResolve(null, { message: "boom" });

    const { result } = renderHook(() => useThread("t1"), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeDefined();
  });
});

// ─── useThreads ──────────────────────────────────────────────────────────────

describe("useThreads", () => {
  it("is disabled when boardId is undefined", async () => {
    const { result } = renderHook(() => useThreads(undefined), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("fetches board threads with pagination defaults", async () => {
    mockResolve([{ id: "t1", board_id: "b1", created_at: "2025-01-01T00:00:00Z" }]);

    const { result } = renderHook(() => useThreads("b1"), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(mockChain.eq).toHaveBeenCalledWith("board_id", "b1");
    expect(mockChain.order).toHaveBeenCalledWith("updated_at", { ascending: false });
    expect(mockChain.range).toHaveBeenCalledWith(0, 19);
  });

  it("honors custom limit/offset", async () => {
    mockResolve([]);

    const { result } = renderHook(() => useThreads("b1", { limit: 10, offset: 5 }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(mockChain.range).toHaveBeenCalledWith(5, 14);
  });

  it("uses distinct cache entries per page", async () => {
    mockResolve([]);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = createWrapper(queryClient);

    const { rerender } = renderHook(({ offset }) => useThreads("b1", { limit: 20, offset }), {
      wrapper,
      initialProps: { offset: 0 },
    });

    await waitFor(() => {
      expect(queryClient.getQueryData(["threads", "b1", 20, 0])).toBeDefined();
    });

    rerender({ offset: 20 });

    await waitFor(() => {
      expect(queryClient.getQueryData(["threads", "b1", 20, 20])).toBeDefined();
    });
    expect(queryClient.getQueryData(["threads", "b1", 20, 0])).toBeDefined();
  });
});

// ─── useCreateThread ─────────────────────────────────────────────────────────

describe("useCreateThread", () => {
  it("creates a thread and invalidates the board cache", async () => {
    const created = { id: "t9", board_id: "b1", title: "New", created_at: "2025-01-01T00:00:00Z" };
    mockResolve(created);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const wrapper = createWrapper(queryClient);

    const { result } = renderHook(() => useCreateThread(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        board_id: "b1",
        title: "New",
        content: "body",
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockChain.insert).toHaveBeenCalledWith({
      board_id: "b1",
      title: "New",
      content: "body",
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["threads", "b1"] });
  });

  it("throws when insert fails", async () => {
    mockResolve(null, { message: "insert failed" });

    const { result } = renderHook(() => useCreateThread(), { wrapper: createWrapper() });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ board_id: "b1", title: "x", content: "y" })
      ).rejects.toThrow();
    });
  });
});

// ─── useThreadSubscription ───────────────────────────────────────────────────

describe("useThreadSubscription", () => {
  it("is disabled when ids are missing", async () => {
    const { result } = renderHook(() => useThreadSubscription(undefined, undefined), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("returns true when a subscription row exists", async () => {
    mockResolve({ id: "sub1" });

    const { result } = renderHook(() => useThreadSubscription("t1", "u1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.data).toBe(true);
    expect(mockChain.eq).toHaveBeenCalledWith("user_id", "u1");
    expect(mockChain.eq).toHaveBeenCalledWith("thread_id", "t1");
    expect(mockChain.maybeSingle).toHaveBeenCalled();
  });

  it("returns false when no subscription row exists", async () => {
    mockResolve(null);

    const { result } = renderHook(() => useThreadSubscription("t1", "u1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.data).toBe(false);
  });
});
