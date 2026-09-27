import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";

import { MyPosts } from "@/components/MyPosts";

vi.mock("@/components/FeedThreadCard", () => ({
  FeedThreadCard: ({ thread }: any) => <div data-testid="thread-card">{thread.title}</div>,
}));
vi.mock("@/components/FeedWallPostCard", () => ({
  FeedWallPostCard: ({ post }: any) => <div data-testid="wall-card">{post.content}</div>,
}));
vi.mock("@/components/Lightbox", () => ({ Lightbox: () => null }));
vi.mock("@/components/PentagramLoader", () => ({ PentagramLoader: () => <span /> }));
vi.mock("@/components/skeletons/ContentSkeletons", () => ({
  ThreadFeedSkeleton: () => <div data-testid="skeleton" />,
}));

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
  title: "Моя тема",
  content: "текст",
  created_at: "2026-01-02T10:00:00Z",
  updated_at: "2026-01-02T10:00:00Z",
  user_id: "me",
  username: "me",
  is_anonymous: false,
};

const wallRow = {
  id: "w1",
  user_id: "me",
  author_id: "me",
  content: "Мой пост на стене",
  created_at: "2026-01-01T10:00:00Z",
  author: { username: "me", is_anonymous: false, avatar_url: null },
};

describe("MyPosts", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("merges authored threads and wall posts into one list", async () => {
    mockFetch([threadRow]);
    mockFrom.mockReturnValue(wallChain([wallRow]));

    render(<MyPosts currentUserId="me" currentUsername="me" />);

    await waitFor(() => expect(screen.getByTestId("thread-card")).toHaveTextContent("Моя тема"));
    expect(screen.getByTestId("wall-card")).toHaveTextContent("Мой пост на стене");
    expect(screen.getByText("Мои записи")).toBeInTheDocument();
  });

  it("shows the empty state when there is nothing authored", async () => {
    mockFetch([]);
    mockFrom.mockReturnValue(wallChain([]));

    render(<MyPosts currentUserId="me" currentUsername="me" />);

    await waitFor(() => expect(screen.getByText("Пока нет записей")).toBeInTheDocument());
  });

  it("does not fetch for a guest", async () => {
    mockFetch([]);
    mockFrom.mockReturnValue(wallChain([]));

    render(<MyPosts currentUserId={null} currentUsername="" />);

    await waitFor(() => expect(screen.getByText("Пока нет записей")).toBeInTheDocument());
    expect(fetch).not.toHaveBeenCalled();
  });
});
