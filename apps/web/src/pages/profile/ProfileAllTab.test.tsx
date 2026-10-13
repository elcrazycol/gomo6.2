import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";

import { ProfileAllTab } from "@/pages/profile/ProfileAllTab";

vi.mock("@/components/FeedThreadCard", () => ({
  FeedThreadCard: ({ thread }: any) => <div data-testid="thread-card">{thread.title}</div>,
}));
vi.mock("@/components/FeedWallPostCard", () => ({
  FeedWallPostCard: ({ post }: any) => <div data-testid="wall-card">{post.content}</div>,
}));
vi.mock("@/components/Lightbox", () => ({ Lightbox: () => null }));
vi.mock("@/components/QuietLoading", () => ({ QuietLoading: () => <span data-testid="quiet-loading" /> }));

const mockFrom = vi.fn();
vi.mock("@/integrations/api/compat", () => ({
  api: { from: (...args: any[]) => mockFrom(...args) },
}));

const wallChain = (rows: unknown[]) => {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => Promise.resolve({ data: rows, error: null }),
  };
  return chain;
};

const mockFetch = (threads: unknown[]) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () => (String(url).includes("/api/v1/threads") ? { data: threads } : { data: [] }),
    })),
  );
};

const threadRow = {
  id: "t1",
  title: "Тема владельца",
  content: "текст",
  created_at: "2026-01-02T10:00:00Z",
  updated_at: "2026-01-02T10:00:00Z",
  user_id: "owner",
  username: "owner",
  is_anonymous: false,
};

const wallRow = {
  id: "w1",
  user_id: "owner",
  author_id: "owner",
  content: "Пост на стене",
  created_at: "2026-01-01T10:00:00Z",
  author: { username: "owner", is_anonymous: false, avatar_url: null },
};

const renderTab = (overrides: Partial<React.ComponentProps<typeof ProfileAllTab>> = {}) =>
  render(
    <ProfileAllTab
      profileUserId="owner"
      profileUsername="owner"
      includeThreads
      includeWall
      currentUserId="me"
      currentUsername="me"
      currentUserColor="#fff"
      {...overrides}
    />,
  );

describe("ProfileAllTab", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockFrom.mockReset();
  });

  it("merges the owner's threads and wall posts newest-first", async () => {
    mockFetch([threadRow]);
    mockFrom.mockReturnValue(wallChain([wallRow]));

    renderTab();

    await waitFor(() => expect(screen.getByTestId("thread-card")).toHaveTextContent("Тема владельца"));
    expect(screen.getByTestId("wall-card")).toHaveTextContent("Пост на стене");

    // The thread is newer, so it renders above the wall post.
    const cards = screen.getAllByTestId(/thread-card|wall-card/);
    expect(cards[0]).toHaveTextContent("Тема владельца");
  });

  it("skips the wall query when the wall is not visible to the viewer", async () => {
    mockFetch([threadRow]);

    renderTab({ includeWall: false });

    await waitFor(() => expect(screen.getByTestId("thread-card")).toBeInTheDocument());
    expect(mockFrom).not.toHaveBeenCalled();
    expect(screen.queryByTestId("wall-card")).not.toBeInTheDocument();
  });

  it("shows the empty state when the owner has no visible content", async () => {
    mockFetch([]);
    mockFrom.mockReturnValue(wallChain([]));

    renderTab();

    await waitFor(() => expect(screen.getByText("Пока нет контента")).toBeInTheDocument());
  });

  it("skips the threads query when threads are not visible to the viewer", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) }));
    vi.stubGlobal("fetch", fetchMock);
    mockFrom.mockReturnValue(wallChain([wallRow]));

    renderTab({ includeThreads: false });

    await waitFor(() => expect(screen.getByTestId("wall-card")).toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pulls the next page when the sentinel enters the viewport", async () => {
    // The shared setup mocks IntersectionObserver as inert; capture the
    // callback so the test can simulate the sentinel scrolling into view.
    const callbacks: IntersectionObserverCallback[] = [];
    const original = window.IntersectionObserver;
    (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
      root = null;
      rootMargin = "";
      thresholds: number[] = [];
      constructor(cb: IntersectionObserverCallback) {
        callbacks.push(cb);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    };

    // A full page of threads (=== PAGE_SIZE) means "there may be more".
    const rows = Array.from({ length: 20 }, (_, i) => ({
      ...threadRow,
      id: `t${i}`,
      title: `Тема ${i}`,
    }));
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => (String(url).includes("/api/v1/threads") ? { data: rows } : { data: [] }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    mockFrom.mockReturnValue(wallChain([]));

    try {
      renderTab();

      await waitFor(() => expect(callbacks.length).toBeGreaterThan(0));

      await act(async () => {
        callbacks[0]([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
      });

      await waitFor(() => {
        const threadCalls = fetchMock.mock.calls
          .map(([url]) => String(url))
          .filter((url) => url.includes("/api/v1/threads"));
        expect(threadCalls.some((url) => url.includes("limit=40"))).toBe(true);
      });
    } finally {
      (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = original;
    }
  });
});
