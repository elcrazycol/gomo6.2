import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi, afterEach, beforeAll, afterAll } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const mockRpc = vi.fn();

vi.mock("@/integrations/api/compat", () => ({
  api: {
    from: vi.fn(),
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
  vi.unstubAllGlobals();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function makeThreadsResponse(threads: any[], nextCursor: string | null = null) {
  return {
    data: threads,
    next_cursor: nextCursor,
    success: true,
    count: threads.length,
  };
}

function makeProfilesResponse(profiles: any[]) {
  return { data: profiles, success: true };
}

function defaultFetchMocks() {
  mockFetch.mockImplementation((url: string) => {
    if (typeof url === "string" && url.includes("/api/v1/threads")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(makeThreadsResponse([
          createMockThread({ id: "thread-1", title: "First Thread" }),
          createMockThread({ id: "thread-2", title: "Second Thread" }),
        ])),
      });
    }
    if (typeof url === "string" && url.includes("/api/v1/profiles")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(makeProfilesResponse([
          { id: "author-1", username: "testuser", is_anonymous: false, avatar_url: null },
        ])),
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ data: [], success: true }),
    });
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
    defaultFetchMocks();
    intersectionCallback = null;
    mockRpc.mockImplementation((fn: string) => {
      if (fn === "get_recommended_threads")
        return Promise.resolve({ data: null, error: { message: "No recommendations" } });
      return Promise.resolve({ data: null, error: null });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Loading state ──────────────────────────────────────────────────────────

  it("shows loading state initially", () => {
    // Never-resolving fetch
    mockFetch.mockImplementation(() => new Promise(() => {}));

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
    let callCount = 0;
    mockFetch.mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/api/v1/threads")) {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(makeThreadsResponse([
              createMockThread({ id: "thread-1", title: "First Thread" }),
            ])),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(makeThreadsResponse([])),
        });
      }
      if (typeof url === "string" && url.includes("/api/v1/profiles")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(makeProfilesResponse([
            { id: "author-1", username: "testuser", is_anonymous: false, avatar_url: null },
          ])),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [], success: true }),
      });
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
    mockFetch.mockRejectedValue(new Error("Network error"));

    render(
      <ThreadFeedComponent
        currentUserId="current-user"
        currentUsername="currentuser"
      />,
    );

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalled();
    });

    consoleSpy.mockRestore();
  });

  // ─── API calls ──────────────────────────────────────────────────────────────

  it("calls fetch for threads endpoint", async () => {
    render(
      <ThreadFeedComponent
        currentUserId="current-user"
        currentUsername="currentuser"
      />,
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/threads"),
      );
    });
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

    let threadsCallCount = 0;
    mockFetch.mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/api/v1/threads")) {
        threadsCallCount++;
        if (threadsCallCount === 2) {
          // Second call is for recommended thread IDs
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(makeThreadsResponse([
              createMockThread({ id: "rec-1", title: "Recommended Thread" }),
            ])),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(makeThreadsResponse([])),
        });
      }
      if (typeof url === "string" && url.includes("/api/v1/profiles")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(makeProfilesResponse([
            { id: "author-1", username: "testuser", is_anonymous: false, avatar_url: null },
          ])),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [], success: true }),
      });
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
