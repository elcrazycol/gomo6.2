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
    canReadModeration: true,
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
vi.mock("react-router-dom", () => ({ Link: ({ children, to }: any) => <a href={to}>{children}</a> }));

// Radix Select renders options through a portal; stub it so the option labels
// do not leak into the queries.
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => null,
  SelectContent: () => null,
  SelectItem: () => null,
}));

const report = (overrides: Record<string, unknown> = {}) => ({
  id: "r-1",
  target_type: "wall_post",
  target_id: "post-1",
  reporter_id: "rep-1",
  reporter: { username: "alice", display_name: null, avatar_url: null },
  category: "spam",
  reason: "Реклама казино",
  status: "open",
  reason_code: null,
  resolution_note: null,
  created_at: "2026-09-02T10:00:00Z",
  ...overrides,
});

const group = (overrides: Record<string, unknown> = {}) => ({
  target: {
    type: "wall_post",
    id: "post-1",
    exists: true,
    title: "",
    content: "Спорная запись",
    author_username: "author",
    author_id: "author-1",
    created_at: "2026-09-01T10:00:00Z",
    link: "/profile/owner-1/wall/post-1",
  },
  reports: [report()],
  open_count: 1,
  total_count: 1,
  last_at: "2026-09-02T10:00:00Z",
  ...overrides,
});

const page = (items: unknown[]) => ({ items, total: items.length, limit: 50, offset: 0 });
const apiResponse = (data: unknown) => ({ success: true, data });

describe("ModerationPosts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWsService.on.mockReturnValue(vi.fn());
    mockRawRequest.mockResolvedValue(apiResponse(page([])));
  });

  it("shows the empty state when the queue is empty", async () => {
    render(<ModerationPosts />);
    await waitFor(() => {
      expect(screen.getByText("Очередь пуста")).toBeInTheDocument();
    });
  });

  it("renders the reported content, its author and a link to open it", async () => {
    mockRawRequest.mockResolvedValue(apiResponse(page([group()])));
    render(<ModerationPosts />);

    await waitFor(() => {
      expect(screen.getByText("Спорная запись")).toBeInTheDocument();
    });
    expect(screen.getByText("1 жалоба")).toBeInTheDocument();
    // author links to the moderation card
    expect(screen.getByRole("link", { name: "author" })).toHaveAttribute("href", "/moderation/users/author-1");
    // content link opens the wall post
    expect(screen.getByRole("link", { name: /Открыть/ })).toHaveAttribute(
      "href",
      "/profile/owner-1/wall/post-1",
    );
    // category chip with count
    expect(screen.getByText("Спам/реклама ×1")).toBeInTheDocument();
  });

  it("expands to show every report with its category and reason", async () => {
    mockRawRequest.mockResolvedValue(
      apiResponse(page([
        group({
          open_count: 2,
          total_count: 2,
          reports: [report(), report({ id: "r-2", category: "abuse", reason: "Оскорбления в мой адрес" })],
        }),
      ])),
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
    });
  });

  it("keeps the content and closes the reports via «Оставить»", async () => {
    mockRawRequest.mockResolvedValue(apiResponse(page([group()])));
    render(<ModerationPosts />);

    await waitFor(() => {
      expect(screen.getByText("Спорная запись")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: /Оставить/ }));
    await waitFor(() => {
      expect(mockRawRequest).toHaveBeenCalledWith(
        "/api/v1/moderation/targets/wall_post/post-1/resolve",
        { method: "POST" },
      );
      expect(toast.success).toHaveBeenCalledWith("Жалобы закрыты, контент оставлен");
    });
  });

  it("deletes the content after a two-step confirmation", async () => {
    mockRawRequest.mockResolvedValue(apiResponse(page([group()])));
    render(<ModerationPosts />);

    await waitFor(() => {
      expect(screen.getByText("Спорная запись")).toBeInTheDocument();
    });

    await userEvent.click(screen.getAllByRole("button", { name: /Удалить/ })[0]);
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /Удалить/ }));

    await waitFor(() => {
      expect(mockRawRequest).toHaveBeenCalledWith("/api/v1/moderation/posts/post-1", {
        method: "DELETE",
      });
      expect(toast.success).toHaveBeenCalledWith("Контент удалён");
    });
  });

  it("does not offer delete for a target with no moderator delete path", async () => {
    mockRawRequest.mockResolvedValue(
      apiResponse(page([
        group({
          target: { type: "wall_comment", id: "c-1", exists: true, content: "коммент", author_username: "bob", author_id: "bob-1", link: "/profile/owner-1/wall/post-9" },
        }),
      ])),
    );
    render(<ModerationPosts />);

    await waitFor(() => {
      expect(screen.getByText("коммент")).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /Удалить/ })).not.toBeInTheDocument();
    // «Оставить» is still available
    expect(screen.getByRole("button", { name: /Оставить/ })).toBeInTheDocument();
  });

  it("subscribes to the moderation room and reloads on new_report", async () => {
    let newReportHandler: () => void = () => {};
    mockWsService.on.mockImplementation(((type: string, handler: () => void) => {
      if (type === "new_report") newReportHandler = handler;
      return vi.fn();
    }) as any);
    mockRawRequest.mockResolvedValue(apiResponse(page([])));

    render(<ModerationPosts />);
    await waitFor(() => {
      expect(mockWsService.subscribe).toHaveBeenCalledWith("moderation");
    });

    mockRawRequest.mockResolvedValue(apiResponse(page([group()])));
    newReportHandler();

    await waitFor(() => {
      expect(screen.getByText("Спорная запись")).toBeInTheDocument();
    });
  });
});
