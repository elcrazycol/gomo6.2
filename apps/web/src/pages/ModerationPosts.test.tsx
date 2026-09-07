import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { toast } from "sonner";

import ModerationPosts from "./ModerationPosts";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/hooks/useModeratorGate", () => ({
  useModeratorGate: () => ({
    user: { id: "mod-1" },
    isModerator: true,
    currentUserUsername: "moderator",
    currentUserColor: "blue",
  }),
}));

const { mockRawRequest, mockWsService } = vi.hoisted(() => {
  const mockRawRequest = vi.fn();
  const mockWsService = {
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    on: vi.fn(() => vi.fn()),
  };
  return { mockRawRequest, mockWsService };
});

vi.mock("@/integrations/api/client", () => ({
  apiClient: { rawRequest: (...args: any[]) => mockRawRequest(...args) },
}));

vi.mock("@/services/websocket", () => ({ wsService: mockWsService }));

vi.mock("react-router-dom", () => ({
  Link: ({ children, to }: any) => <a href={to}>{children}</a>,
}));

const group = (overrides: Record<string, unknown> = {}) => ({
  post: {
    id: "post-1",
    user_id: "owner-1",
    author_id: "author-1",
    title: "",
    content: "Спорная запись",
    content_json: null,
    image_url: null,
    attachments: null,
    repost_of_post_id: null,
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-01T10:00:00Z",
    is_pinned: false,
    pinned_order: null,
    likes_count: 1,
    comments_count: 2,
    reposts_count: 0,
    views_count: 3,
    author: { username: "author", display_name: null, nickname_emoji_id: null, is_anonymous: false, avatar_url: null },
  },
  reports: [
    {
      id: "r-1",
      post_id: "post-1",
      reporter_id: "rep-1",
      reporter: { username: "alice", display_name: null, avatar_url: null },
      category: "spam",
      reason: "Реклама казино",
      status: "open",
      created_at: "2026-09-02T10:00:00Z",
    },
  ],
  report_count: 1,
  open_count: 1,
  ...overrides,
});

const apiResponse = (data: unknown) => ({ success: true, data });

describe("ModerationPosts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWsService.on.mockReturnValue(vi.fn());
    mockRawRequest.mockResolvedValue(apiResponse([]));
  });

  it("shows the empty state when the queue is empty", async () => {
    render(<ModerationPosts />);
    await waitFor(() => {
      expect(screen.getByText(/Очередь пуста/)).toBeInTheDocument();
    });
  });

  it("renders reported posts grouped by post with an open-count badge", async () => {
    mockRawRequest.mockResolvedValue(apiResponse([group()]));
    render(<ModerationPosts />);

    await waitFor(() => {
      expect(screen.getByText("Спорная запись")).toBeInTheDocument();
    });
    expect(screen.getByText("1 жалоба")).toBeInTheDocument();
  });

  it("expands to show every report with its category and reason", async () => {
    mockRawRequest.mockResolvedValue(
      apiResponse([
        group({
          report_count: 2,
          open_count: 2,
          reports: [
            {
              id: "r-1",
              post_id: "post-1",
              reporter_id: "rep-1",
              reporter: { username: "alice", display_name: null, avatar_url: null },
              category: "spam",
              reason: "Реклама казино",
              status: "open",
              created_at: "2026-09-02T10:00:00Z",
            },
            {
              id: "r-2",
              post_id: "post-1",
              reporter_id: "rep-2",
              reporter: { username: "bob", display_name: null, avatar_url: null },
              category: "abuse",
              reason: "Оскорбления в мой адрес",
              status: "open",
              created_at: "2026-09-02T11:00:00Z",
            },
          ],
        }),
      ]),
    );
    render(<ModerationPosts />);

    await waitFor(() => {
      expect(screen.getByText("Спорная запись")).toBeInTheDocument();
    });
    expect(screen.queryByText("Реклама казино")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Жалобы \(2\)/ }));
    await waitFor(() => {
      expect(screen.getByText("Реклама казино")).toBeInTheDocument();
      expect(screen.getByText("Оскорбления в мой адрес")).toBeInTheDocument();
      expect(screen.getByText("Спам/реклама")).toBeInTheDocument();
      expect(screen.getByText("Оскорбления")).toBeInTheDocument();
    });
  });

  it("resolves the open reports of a post without deleting it", async () => {
    mockRawRequest.mockResolvedValue(apiResponse([group()]));
    render(<ModerationPosts />);

    await waitFor(() => {
      expect(screen.getByText("Спорная запись")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: /Решить/ }));
    await waitFor(() => {
      expect(mockRawRequest).toHaveBeenCalledWith("/api/v1/moderation/posts/post-1/resolve", {
        method: "POST",
      });
      expect(toast.success).toHaveBeenCalledWith("Жалобы решены — пост остаётся на стене");
    });
  });

  it("deletes the post after a two-step confirmation", async () => {
    mockRawRequest.mockResolvedValue(apiResponse([group()]));
    render(<ModerationPosts />);

    await waitFor(() => {
      expect(screen.getByText("Спорная запись")).toBeInTheDocument();
    });

    // The row action and the confirm dialog both say "Удалить" — click the
    // row's action first (there is exactly one group), then confirm inside the dialog.
    await userEvent.click(screen.getAllByRole("button", { name: /Удалить/ })[0]);
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /Удалить/ }));

    await waitFor(() => {
      expect(mockRawRequest).toHaveBeenCalledWith("/api/v1/moderation/posts/post-1", {
        method: "DELETE",
      });
      expect(toast.success).toHaveBeenCalledWith("Пост удалён");
    });
  });

  it("subscribes to the moderation room and reloads on new_report", async () => {
    let newReportHandler: () => void = () => {};
    mockWsService.on.mockImplementation(((type: string, handler: () => void) => {
      if (type === "new_report") newReportHandler = handler;
      return vi.fn();
    }) as any);
    mockRawRequest.mockResolvedValue(apiResponse([]));

    render(<ModerationPosts />);
    await waitFor(() => {
      expect(mockWsService.subscribe).toHaveBeenCalledWith("moderation");
    });

    // A fresh report arrives → the queue is refetched.
    mockRawRequest.mockResolvedValue(apiResponse([group()]));
    newReportHandler();

    await waitFor(() => {
      expect(screen.getByText("Спорная запись")).toBeInTheDocument();
    });
  });
});