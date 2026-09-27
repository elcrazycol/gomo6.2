import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";

import { FavoritesView } from "@/components/FavoritesView";
import { useFavoritesStore } from "@/stores/favoritesStore";

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

const requestMock = vi.fn();
vi.mock("@/integrations/api/client", () => ({
  apiClient: { request: (...args: any[]) => requestMock(...args) },
}));

const threadItem = {
  item_type: "thread",
  item_id: "t1",
  title: "Избранная тема",
  content: "текст",
  created_at: "2026-01-02T10:00:00Z",
  updated_at: "2026-01-02T10:00:00Z",
  author_id: "u1",
  author: { username: "bob", is_anonymous: false, avatar_url: null },
  likes_count: 3,
  comments_count: 0,
  reposts_count: 0,
  liked_by_viewer: false,
  views_count: 0,
};

const wallItem = {
  item_type: "wall_post",
  item_id: "w1",
  user_id: "u1",
  author_id: "u1",
  content: "НЕ избранный пост",
  created_at: "2026-01-01T10:00:00Z",
  author: { username: "bob", is_anonymous: false, avatar_url: null },
  likes_count: 0,
  comments_count: 0,
  reposts_count: 0,
  liked_by_viewer: false,
  views_count: 0,
};

describe("FavoritesView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFavoritesStore.getState().reset();
  });

  it("shows only items present in the favorites store", async () => {
    requestMock.mockImplementation(async (url: string) => {
      if (url.includes("/favorites/ids")) {
        return { data: [{ item_type: "thread", item_id: "t1" }] };
      }
      return { data: [threadItem, wallItem] };
    });

    render(<FavoritesView currentUserId="me" currentUsername="me" />);

    await waitFor(() => expect(screen.getByTestId("thread-card")).toHaveTextContent("Избранная тема"));
    // The wall post is not in the favorites set → filtered out.
    expect(screen.queryByTestId("wall-card")).not.toBeInTheDocument();
  });

  it("shows the empty state", async () => {
    requestMock.mockResolvedValue({ data: [] });

    render(<FavoritesView currentUserId="me" currentUsername="me" />);

    await waitFor(() => expect(screen.getByText("В избранном пусто")).toBeInTheDocument());
  });

  it("asks a guest to sign in and does not fetch", async () => {
    render(<FavoritesView currentUserId={null} currentUsername="" />);

    await waitFor(() => expect(screen.getByText("Войди, чтобы видеть избранное")).toBeInTheDocument());
    expect(requestMock).not.toHaveBeenCalled();
  });
});
