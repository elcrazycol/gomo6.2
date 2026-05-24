import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi, afterEach, beforeAll, afterAll } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock("@/integrations/api/compat", () => ({
  api: {
    from: (...args: any[]) => mockFrom(...args),
    rpc: (...args: any[]) => mockRpc(...args),
  },
}));

vi.mock("@/components/ThreadCard", () => ({
  ThreadCard: ({ thread, currentUserId }: any) => (
    <div data-testid="thread-card" data-thread-id={thread.id} data-user-id={currentUserId}>
      {thread.title}
    </div>
  ),
}));

vi.mock("@/components/PentagramLoader", () => ({
  PentagramLoader: ({ size }: any) => (
    <div data-testid="pentagram-loader" data-size={size}>
      Loading...
    </div>
  ),
}));

// Mock IntersectionObserver
const mockIntersectionObserve = vi.fn();
const mockIntersectionDisconnect = vi.fn();
let intersectionCallback: ((entries: any[]) => void) | null = null;

const originalIntersectionObserver = (global as any).IntersectionObserver;

beforeAll(() => {
  (global as any).IntersectionObserver = class {
    constructor(callback: (entries: any[]) => void, _options?: any) {
      intersectionCallback = callback;
    }
    observe = mockIntersectionObserve;
    disconnect = mockIntersectionDisconnect;
  };
});

afterAll(() => {
  (global as any).IntersectionObserver = originalIntersectionObserver;
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeChain<T>(resolveValue: T): any {
  const p = Promise.resolve(resolveValue) as any;
  p.select = (_sel?: string, _opts?: any) => p;
  p.eq = (_col?: string, _val?: any) => p;
  p.order = (_col?: string, _opts?: any) => p;
  p.in = (_col?: string, _vals?: any[]) => p;
  p.limit = (_n?: number) => p;
  p.range = (_from?: number, _to?: number) => p;
  p.single = () => p;
  p.maybeSingle = () => p;
  p.insert = (_row?: any) => {
    const insertP = Promise.resolve({ data: { id: "new-id" }, error: null }) as any;
    insertP.select = () => insertP;
    insertP.single = () => insertP;
    return insertP;
  };
  return p;
}

function createMockThread(overrides: any = {}) {
  return {
    id: overrides.id || "thread-1",
    title: overrides.title || "Test Thread",
    content: "Content here",
    image_url: null,
    image_urls: null,
    created_at: "2025-01-18T10:00:00Z",
    updated_at: "2025-01-18T10:00:00Z",
    user_id: "author-1",
    board_id: "board-1",
    post_count: 3,
    tags: null,
    ephemeral_type: null,
    ephemeral_value: null,
    auto_delete_at: null,
    profiles: { username: "testuser", is_anonymous: false, avatar_url: null },
    boards: { slug: "test-board", name: "Test Board", is_gomosub: false },
    ...overrides,
  };
}

function defaultApiMocks() {
  mockFrom.mockImplementation((table: string) => {
    if (table === "threads") {
      return makeChain({
        data: [createMockThread({ id: "thread-1", title: "First Thread" }), createMockThread({ id: "thread-2", title: "Second Thread" })],
        error: null,
      });
    }
    if (table === "profiles") {
      return makeChain({
        data: [{ id: "author-1", username: "testuser", is_anonymous: false, avatar_url: null }],
        error: null,
      });
    }
    return makeChain({ data: [], error: null });
  });
  mockRpc.mockImplementation((fn: string) => {
    if (fn === "get_recommended_threads") return Promise.resolve({ data: null, error: { message: "No recommendations" } });
    return Promise.resolve({ data: null, error: null });
  });
}

let ThreadFeedComponent: any;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ThreadFeed", () => {
  beforeAll(async () => {
    const mod = await import("./ThreadFeed");
    ThreadFeedComponent = mod.ThreadFeed;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    defaultApiMocks();
    intersectionCallback = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Loading state ──────────────────────────────────────────────────────────

  it("shows loading state initially", () => {
    // Make api never resolve with a chainable pending promise
    const deferP = new Promise(() => {}) as any;
    deferP.select = () => deferP;
    deferP.eq = () => deferP;
    deferP.order = () => deferP;
    deferP.in = () => deferP;
    deferP.limit = () => deferP;
    deferP.range = () => deferP;
    deferP.single = () => deferP;
    deferP.maybeSingle = () => deferP;
    mockFrom.mockImplementation(() => deferP);

    render(
      <ThreadFeedComponent
        currentUserId="current-user"
        currentUsername="currentuser"
      />,
    );

    expect(screen.getAllByTestId("pentagram-loader").length).toBeGreaterThanOrEqual(1);
  });

  // ─── Threads rendering ──────────────────────────────────────────────────────

  it("renders threads when data loads", async () => {
    render(
      <ThreadFeedComponent
        currentUserId="current-user"
        currentUsername="currentuser"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("First Thread")).toBeInTheDocument();
    });
    expect(screen.getByText("Second Thread")).toBeInTheDocument();
  });

  it("renders correct number of thread cards", async () => {
    render(
      <ThreadFeedComponent
        currentUserId="current-user"
        currentUsername="currentuser"
      />,
    );

    await waitFor(() => {
      const cards = screen.getAllByTestId("thread-card");
      expect(cards).toHaveLength(2);
    });
  });

  it("passes currentUserId to ThreadCard", async () => {
    render(
      <ThreadFeedComponent
        currentUserId="user-123"
        currentUsername="currentuser"
      />,
    );

    await waitFor(() => {
      const cards = screen.getAllByTestId("thread-card");
      expect(cards[0]).toHaveAttribute("data-user-id", "user-123");
    });
  });

  // ─── Empty state ────────────────────────────────────────────────────────────

  it("shows 'Больше тредов нет' after loading threads when no more data", async () => {
    // Return 1 thread first, then empty on "load more"
    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "threads") {
        callCount++;
        if (callCount === 1) {
          return makeChain({
            data: [createMockThread({ id: "thread-1", title: "First Thread" })],
            error: null,
          });
        }
        return makeChain({ data: [], error: null });
      }
      if (table === "profiles") {
        return makeChain({
          data: [{ id: "author-1", username: "testuser", is_anonymous: false, avatar_url: null }],
          error: null,
        });
      }
      return makeChain({ data: [], error: null });
    });

    // Simulate load more via IntersectionObserver callback
    render(
      <ThreadFeedComponent
        currentUserId="current-user"
        currentUsername="currentuser"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("First Thread")).toBeInTheDocument();
    });

    // Trigger IntersectionObserver to load more
    if (intersectionCallback) {
      intersectionCallback([{ isIntersecting: true }]);
    }

    await waitFor(() => {
      expect(screen.getByText("Больше тредов нет")).toBeInTheDocument();
    });
  });

  // ─── API error ──────────────────────────────────────────────────────────────

  it("handles API error gracefully", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockFrom.mockImplementation((table: string) => {
      return makeChain({ data: null, error: { message: "DB error" } });
    });

    render(
      <ThreadFeedComponent
        currentUserId="current-user"
        currentUsername="currentuser"
      />,
    );

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        "Error loading threads:",
        expect.objectContaining({ message: "DB error" }),
      );
    });

    consoleSpy.mockRestore();
  });

  // ─── API calls ──────────────────────────────────────────────────────────────

  it("calls api.from('threads') with correct params", async () => {
    render(
      <ThreadFeedComponent
        currentUserId="current-user"
        currentUsername="currentuser"
      />,
    );

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith("threads");
    });

    // Also loads profiles separately
    expect(mockFrom).toHaveBeenCalledWith("profiles");
  });

  it("calls get_recommended_threads rpc for logged-in user", async () => {
    render(
      <ThreadFeedComponent
        currentUserId="current-user"
        currentUsername="currentuser"
      />,
    );

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith("get_recommended_threads", {
        user_uuid: "current-user",
        limit_count: 20,
        offset_count: 0,
      });
    });
  });

  // ─── Recommendations flow ───────────────────────────────────────────────────

  it("uses recommended threads when api returns them", async () => {
    mockRpc.mockImplementation((fn: string) => {
      if (fn === "get_recommended_threads") {
        return Promise.resolve({
          data: [{ thread_id: "rec-1", score: 10 }],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    // Return recommended threads on second call (by thread IDs)
    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "threads") {
        callCount++;
        if (callCount === 2) {
          // Second call is for recommended thread IDs
          return makeChain({
            data: [createMockThread({ id: "rec-1", title: "Recommended Thread" })],
            error: null,
          });
        }
        return makeChain({ data: [], error: null });
      }
      if (table === "profiles") {
        return makeChain({
          data: [{ id: "author-1", username: "testuser", is_anonymous: false, avatar_url: null }],
          error: null,
        });
      }
      return makeChain({ data: [], error: null });
    });

    render(
      <ThreadFeedComponent
        currentUserId="current-user"
        currentUsername="currentuser"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Recommended Thread")).toBeInTheDocument();
    });
  });

  it("falls back to chronological feed when recommendations fail", async () => {
    // Recommendations return empty data
    mockRpc.mockImplementation((fn: string) => {
      if (fn === "get_recommended_threads") {
        return Promise.resolve({ data: [], error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    render(
      <ThreadFeedComponent
        currentUserId="current-user"
        currentUsername="currentuser"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("First Thread")).toBeInTheDocument();
    });
    expect(screen.getByText("Second Thread")).toBeInTheDocument();
  });
});
