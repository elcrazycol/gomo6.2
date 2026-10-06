import { render, screen, waitFor, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi, afterEach, beforeAll, afterAll } from "vitest";

import { wsService } from "@/services/websocket";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("@/components/FeedThreadCard", () => ({
  FeedThreadCard: ({ thread, currentUserId }: any) => (
    <div data-testid="thread-card" data-thread-id={thread.id} data-user-id={currentUserId}>
      {thread.title}
    </div>
  ),
}));

vi.mock("@/components/FeedWallPostCard", () => ({
  FeedWallPostCard: ({ post, currentUserId }: any) => (
    <div data-testid="wall-post-card" data-post-id={post.id} data-user-id={currentUserId}>
      {post.content || "Wall content"}
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

vi.mock("@/components/Lightbox", () => ({
  Lightbox: () => <div data-testid="lightbox">Lightbox</div>,
}));

vi.mock("@/utils/wallNormalizers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/wallNormalizers")>();
  return {
    ...actual,
    normalizeWallPostRecord: (post: Record<string, unknown>) => ({
      id: post.id as string,
      user_id: post.user_id as string,
      author_id: post.author_id as string,
      content: post.content as string,
      created_at: post.created_at as string,
      updated_at: post.updated_at as string,
      author: post.author || { username: "walluser", is_anonymous: false },
      likes_count: (post.likes_count as number) ?? 0,
      comments_count: (post.comments_count as number) ?? 0,
      reposts_count: (post.reposts_count as number) ?? 0,
      liked_by_viewer: Boolean(post.liked_by_viewer),
      ...post,
    }),
  };
});

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

function createMockThreadItem(overrides: any = {}) {
  return {
    item_type: "thread",
    item_id: overrides.id || "thread-1",
    score: 10,
    created_at: "2025-01-18T10:00:00Z",
    updated_at: "2025-01-18T10:00:00Z",
    title: overrides.title || "Test Thread",
    content: "Content here",
    image_url: null,
    image_urls: null,
    post_count: 3,
    tags: null,
    author_id: "author-1",
    author: { username: "testuser", is_anonymous: false, avatar_url: null },
    board_id: "board-1",
    boards: { slug: "test-board", name: "Test Board", is_gomosub: false },
    likes_count: 5,
    comments_count: 3,
    reposts_count: 0,
    liked_by_viewer: false,
    ...overrides,
  };
}

function createMockWallPostItem(overrides: any = {}) {
  return {
    item_type: "wall_post",
    item_id: overrides.id || "wall-1",
    score: 8,
    created_at: "2025-01-18T10:00:00Z",
    updated_at: "2025-01-18T10:00:00Z",
    title: null,
    content: "Wall content here",
    image_url: null,
    author_id: "wall-author-1",
    author: { username: "walluser", is_anonymous: false, avatar_url: null },
    wall_user_id: "wall-owner-1",
    likes_count: 2,
    comments_count: 1,
    reposts_count: 0,
    liked_by_viewer: false,
    ...overrides,
  };
}

function makeFeedResponse(items: any[]) {
  return {
    data: items,
    success: true,
    count: items.length,
  };
}

function defaultFetchMocks() {
  mockFetch.mockImplementation((url: string) => {
    if (typeof url === "string" && url.includes("/api/v1/feed")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(makeFeedResponse([
          createMockThreadItem({ id: "thread-1", title: "First Thread" }),
          createMockThreadItem({ id: "thread-2", title: "Second Thread" }),
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Loading state ──────────────────────────────────────────────────────────

  it("shows a quiet loading placeholder (no skeleton) before the first page", () => {
    // Never-resolving fetch
    mockFetch.mockImplementation(() => new Promise(() => {}));

    const { container } = render(
      <ThreadFeedComponent
        currentUserId="current-user"
        currentUsername="currentuser"
      />,
    );

    // No skeleton any more — the header's loading bar is the progress cue.
    expect(container.querySelector(".animate-pulse")).not.toBeInTheDocument();
    expect(container.querySelector("[aria-busy='true']")).toBeInTheDocument();
  });

  // ─── Feed rendering ─────────────────────────────────────────────────────────

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

  it("renders wall post cards alongside thread cards", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/api/v1/feed")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(makeFeedResponse([
            createMockThreadItem({ id: "thread-1", title: "First Thread" }),
            createMockWallPostItem({ id: "wall-1" }),
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
      expect(screen.getByTestId("wall-post-card")).toBeInTheDocument();
    });
    expect(screen.getByTestId("thread-card")).toBeInTheDocument();
  });

  // ─── Empty state ────────────────────────────────────────────────────────────

  it("shows empty state when feed has no content", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/api/v1/feed")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(makeFeedResponse([])),
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
      expect(screen.getByText("В ленте пока пусто")).toBeInTheDocument();
    });
  });

  it("does not flash the empty state while a superseded request is aborted", async () => {
    let call = 0;
    let resolveSecond: (() => void) | null = null;

    mockFetch.mockImplementation((_url: string, init?: RequestInit) => {
      call += 1;
      if (call === 1) {
        // First request: stays pending until aborted (StrictMode's double
        // mount / the auth session resolving), then rejects like a real fetch.
        return new Promise((_resolve, reject) => {
          const signal = init?.signal;
          const onAbort = () =>
            reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
          if (signal?.aborted) onAbort();
          else signal?.addEventListener("abort", onAbort);
        });
      }
      return new Promise((resolve) => {
        resolveSecond = () =>
          resolve({
            ok: true,
            json: async () => makeFeedResponse([createMockThreadItem({ id: "thread-1", title: "First Thread" })]),
          });
      });
    });

    const { rerender } = render(
      <ThreadFeedComponent currentUserId={undefined} currentUsername="" />,
    );
    // A new currentUserId re-creates loadInitial → the effect re-runs → the
    // first request is aborted.
    rerender(<ThreadFeedComponent currentUserId="current-user" currentUsername="currentuser" />);

    // The aborted request settles while the second is still in flight: the
    // empty state must NOT appear (regression: it used to flash here).
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText("В ленте пока пусто")).not.toBeInTheDocument();

    act(() => {
      resolveSecond?.();
    });
    await waitFor(() => expect(screen.getByText("First Thread")).toBeInTheDocument());
  });

  it("shows 'Больше контента нет' when no more data", async () => {
    let callCount = 0;
    mockFetch.mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/api/v1/feed")) {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(makeFeedResponse([
              createMockThreadItem({ id: "thread-1", title: "First Thread" }),
            ])),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(makeFeedResponse([])),
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
      expect(screen.getByText("Больше контента нет")).toBeInTheDocument();
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

  it("calls fetch for the unified feed endpoint", async () => {
    render(
      <ThreadFeedComponent
        currentUserId="current-user"
        currentUsername="currentuser"
      />,
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/feed"),
        expect.any(Object),
      );
    });
  });

  // ─── Live wall-post deletion ─────────────────────────────────────────────────

  it("removes a wall post card when a delete_wall_post event arrives", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/api/v1/feed")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(makeFeedResponse([
            createMockThreadItem({ id: "thread-1", title: "First Thread" }),
            createMockWallPostItem({ id: "wall-1" }),
          ])),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [], success: true }),
      });
    });

    let deleteHandler: ((message: unknown) => void) | null = null;
    vi.spyOn(wsService, "on").mockImplementation(((
      type: string,
      handler: (message: unknown) => void,
    ) => {
      if (type === "delete_wall_post") deleteHandler = handler;
      return () => {};
    }) as typeof wsService.on);

    render(
      <ThreadFeedComponent
        currentUserId="current-user"
        currentUsername="currentuser"
      />,
    );

    await waitFor(() => expect(screen.getByTestId("wall-post-card")).toBeInTheDocument());

    act(() => {
      deleteHandler?.({ data: { id: "wall-1" } });
    });

    await waitFor(() =>
      expect(screen.queryByTestId("wall-post-card")).not.toBeInTheDocument(),
    );
    // The unrelated thread stays.
    expect(screen.getByText("First Thread")).toBeInTheDocument();
  });
});
