import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";

import { HistoryView } from "@/components/HistoryView";

vi.mock("@/components/FeedThreadCard", () => ({
  FeedThreadCard: ({ thread }: any) => <div data-testid="thread-card">{thread.title}</div>,
}));
vi.mock("@/components/FeedWallPostCard", () => ({
  FeedWallPostCard: ({ post }: any) => <div data-testid="wall-card">{post.content}</div>,
}));
vi.mock("@/components/Lightbox", () => ({ Lightbox: () => null }));
vi.mock("@/components/PentagramLoader", () => ({ PentagramLoader: () => <span /> }));

const requestMock = vi.fn();
vi.mock("@/integrations/api/client", () => ({
  apiClient: { request: (...args: any[]) => requestMock(...args) },
}));

const threadItem = {
  item_type: "thread",
  item_id: "t1",
  title: "Просмотренная тема",
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
  viewed_at: "2026-01-03T10:00:00Z",
};

const wallItem = {
  item_type: "wall_post",
  item_id: "w1",
  user_id: "u1",
  author_id: "u1",
  content: "Просмотренный пост",
  created_at: "2026-01-01T10:00:00Z",
  author: { username: "bob", is_anonymous: false, avatar_url: null },
  likes_count: 1,
  comments_count: 0,
  reposts_count: 0,
  liked_by_viewer: false,
  views_count: 0,
  viewed_at: "2026-01-03T09:00:00Z",
};

describe("HistoryView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders viewed threads and wall posts", async () => {
    requestMock.mockResolvedValue({ data: [threadItem, wallItem] });

    render(<HistoryView currentUserId="me" currentUsername="me" />);

    await waitFor(() => expect(screen.getByTestId("thread-card")).toHaveTextContent("Просмотренная тема"));
    expect(screen.getByTestId("wall-card")).toHaveTextContent("Просмотренный пост");
    expect(screen.getByText("История")).toBeInTheDocument();
  });

  it("shows the empty state", async () => {
    requestMock.mockResolvedValue({ data: [] });

    render(<HistoryView currentUserId="me" currentUsername="me" />);

    await waitFor(() => expect(screen.getByText("История пуста")).toBeInTheDocument());
  });

  it("asks a guest to sign in and does not fetch", async () => {
    render(<HistoryView currentUserId={null} currentUsername="" />);

    await waitFor(() => expect(screen.getByText("Войди, чтобы видеть историю")).toBeInTheDocument());
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("clears the history after confirmation", async () => {
    requestMock.mockResolvedValue({ data: [threadItem] });
    const user = userEvent.setup();

    render(<HistoryView currentUserId="me" currentUsername="me" />);

    await waitFor(() => expect(screen.getByTestId("thread-card")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Очистить историю" }));
    await user.click(screen.getByRole("button", { name: "Очистить" }));

    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/history", { method: "DELETE" }),
    );
    expect(screen.getByText("История пуста")).toBeInTheDocument();
  });
});
