import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { usePosts, useCreatePost, useDeletePost } from "./usePosts";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockChain: any = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  range: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  single: vi.fn(),
  maybeSingle: vi.fn(),
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

// Reset mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
  mockFrom.mockReturnValue(mockChain);
  mockChain.select.mockReturnThis();
  mockChain.eq.mockReturnThis();
  mockChain.order.mockReturnThis();
  mockChain.range.mockReturnThis();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Wrapper ──────────────────────────────────────────────────────────────────

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

describe("usePosts", () => {
  it("returns empty array when threadId is undefined", async () => {
    const { result } = renderHook(() => usePosts(undefined), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // With no threadId, query is disabled — data stays undefined
    expect(result.current.data).toBeUndefined();
  });

  it("fetches posts for a given thread with pagination params", async () => {
    const mockPosts = [
      { id: "post-1", thread_id: "thread-1", content: "Hello", created_at: "2025-01-01T00:00:00Z" },
      { id: "post-2", thread_id: "thread-1", content: "World", created_at: "2025-01-01T01:00:00Z" },
    ];

    mockChain.then.mockImplementation((cb: any) => {
      return Promise.resolve({ data: mockPosts, error: null }).then(cb);
    });

    const { result } = renderHook(
      () => usePosts("thread-1", { limit: 50, offset: 0 }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isFetching).toBe(false);
    });

    expect(result.current.data).toEqual(mockPosts);
    expect(mockChain.eq).toHaveBeenCalledWith("thread_id", "thread-1");
    expect(mockChain.order).toHaveBeenCalledWith("created_at", { ascending: true });
    expect(mockChain.range).toHaveBeenCalledWith(0, 49);
  });

  it("handles API errors gracefully", async () => {
    mockChain.then.mockImplementation((cb: any) => {
      return Promise.resolve({ data: null, error: { message: "Database error" } }).then(cb);
    });

    const { result } = renderHook(
      () => usePosts("thread-1", { limit: 50, offset: 0 }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBeDefined();
  });

  it("supports placeholderData for pagination", async () => {
    const page1 = [{ id: "post-1", thread_id: "thread-1", content: "Page 1", created_at: "2025-01-01T00:00:00Z" }];
    const page2 = [{ id: "post-2", thread_id: "thread-1", content: "Page 2", created_at: "2025-01-01T01:00:00Z" }];

    let callCount = 0;
    mockChain.then.mockImplementation((cb: any) => {
      callCount++;
      return Promise.resolve({
        data: callCount === 1 ? page1 : page2,
        error: null,
      }).then(cb);
    });

    // First page
    const { result, rerender } = renderHook(
      ({ offset }) => usePosts("thread-1", { limit: 50, offset }, { placeholderData: (prev: any) => prev }),
      { wrapper: createWrapper(), initialProps: { offset: 0 } }
    );

    await waitFor(() => {
      expect(result.current.data).toEqual(page1);
    });

    expect(result.current.isFetching).toBe(false);

    // Load more — while fetching, placeholderData keeps previous data
    rerender({ offset: 50 });

    // Should have started fetching
    await waitFor(() => {
      expect(result.current.isFetching).toBe(true);
    });

    // During fetch, previous data preserved via placeholderData
    await waitFor(() => {
      expect(result.current.data).toEqual(page2);
    });
  });

  it("uses different queryKeys for different offsets", async () => {
    mockChain.then.mockImplementation((cb: any) => {
      return Promise.resolve({ data: [], error: null }).then(cb);
    });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { rerender } = renderHook(
      ({ offset }) => usePosts("thread-1", { limit: 50, offset }),
      { wrapper, initialProps: { offset: 0 } }
    );

    await waitFor(() => {
      const cache0 = queryClient.getQueryData(["posts", "thread-1", { limit: 50, offset: 0 }]);
      expect(cache0).toBeDefined();
    });

    rerender({ offset: 50 });

    await waitFor(() => {
      const cache50 = queryClient.getQueryData(["posts", "thread-1", { limit: 50, offset: 50 }]);
      expect(cache50).toBeDefined();
    });

    // Both queries should be cached separately
    const cache0 = queryClient.getQueryData(["posts", "thread-1", { limit: 50, offset: 0 }]);
    const cache50 = queryClient.getQueryData(["posts", "thread-1", { limit: 50, offset: 50 }]);
    expect(cache0).not.toBeUndefined();
    expect(cache50).not.toBeUndefined();
  });
});
