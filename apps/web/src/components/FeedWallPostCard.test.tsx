import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("date-fns", () => ({
  formatDistanceToNow: () => "2 дня назад",
}));

const mockNavigateFn = vi.fn();
const mockLocation = { pathname: "/", search: "", hash: "", state: null, key: "default" };

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigateFn,
  useLocation: () => mockLocation,
  Link: ({ children, to, onClick }: any) => (
    <a href={to} onClick={onClick}>
      {children}
    </a>
  ),
}));

const insertFn = vi.fn(() => Promise.resolve({ data: null, error: null }));
const deleteFn = vi.fn(() => {
  const chain = Promise.resolve({ data: null, error: null }) as any;
  chain.eq = () => chain;
  return chain;
});

vi.mock("@/integrations/api/compat", () => ({
  api: {
    from: () => ({ insert: insertFn, delete: deleteFn }),
    rpc: vi.fn(),
  },
}));

vi.mock("@/utils/storage", () => ({
  storageUrl: (_bucket: string, keyOrUrl?: string | null) => keyOrUrl || null,
}));

vi.mock("@/components/UserBadge", () => ({
  UserBadge: ({ username }: any) => <span data-testid="user-badge">{username}</span>,
}));

vi.mock("@/components/ProcessedContent", () => ({
  ProcessedContent: ({ content }: any) => (
    <span data-testid="processed-content">{content}</span>
  ),
}));

vi.mock("@/components/WallAttachments", () => ({
  WallAttachments: ({ attachments, onVideoOpen }: any) => (
    <div
      data-testid="wall-attachments"
      data-count={attachments.length}
      data-on-video-open={onVideoOpen ? "true" : "false"}
      // Mirrors the real VideoPlayer open-mode: a tap opens the destination
      // and stops propagation so the card's own navigate handler is skipped.
      onClick={(e: any) => {
        e.stopPropagation();
        onVideoOpen?.();
      }}
    />
  ),
}));

vi.mock("@/components/share/ShareSheet", () => ({
  ShareSheet: () => null,
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockPost(overrides: any = {}) {
  return {
    id: "post-1",
    user_id: "wall-owner",
    author_id: "author-1",
    title: "Test post",
    content: "Hello wall!",
    content_json: null,
    image_url: null,
    attachments: null,
    repost_of_post_id: null,
    created_at: "2025-01-15T10:00:00Z",
    updated_at: "2025-01-15T10:00:00Z",
    is_pinned: false,
    author: { username: "testuser", is_anonymous: false, avatar_url: null },
    ...overrides,
  };
}

let FeedWallPostCardComponent: any;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("FeedWallPostCard", () => {
  beforeAll(async () => {
    const mod = await import("./FeedWallPostCard");
    FeedWallPostCardComponent = mod.FeedWallPostCard;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderCard = (post = createMockPost(), props: any = {}) =>
    render(
      <FeedWallPostCardComponent
        post={post}
        currentUserId="current-user"
        currentUsername="currentuser"
        onImageClick={vi.fn()}
        {...props}
      />,
    );

  it("navigates to the post page on a card tap without an autoplay flag", async () => {
    const { container } = renderCard();

    await waitFor(() => {
      expect(screen.getByTestId("user-badge")).toHaveTextContent("testuser");
    });

    fireEvent.click(container.querySelector('[role="button"]')!);

    const [path, options] = mockNavigateFn.mock.calls[0];
    expect(path).toBe("/profile/wall-owner/wall/post-1");
    expect(options.state.wallPost?.id).toBe("post-1");
    expect(options.state.backgroundLocation).toBe(mockLocation);
    expect(options.state.autoplayVideo).toBeUndefined();
  });

  it("wires the video-open callback to WallAttachments for posts with video", async () => {
    renderCard(createMockPost({
      attachments: [{ url: "clip.mp4", type: "video", mime: "video/mp4", name: "clip", size: 5000 }],
    }));

    await waitFor(() => {
      expect(screen.getByTestId("wall-attachments")).toHaveAttribute("data-on-video-open", "true");
    });
  });

  it("tapping a wall video opens the post page with an autoplay flag", async () => {
    renderCard(createMockPost({
      attachments: [{ url: "clip.mp4", type: "video", mime: "video/mp4", name: "clip", size: 5000 }],
    }));

    await waitFor(() => {
      expect(screen.getByTestId("wall-attachments")).toHaveAttribute("data-on-video-open", "true");
    });
    fireEvent.click(screen.getByTestId("wall-attachments"));

    expect(mockNavigateFn).toHaveBeenCalledWith(
      "/profile/wall-owner/wall/post-1",
      expect.objectContaining({ state: expect.objectContaining({ autoplayVideo: true }) }),
    );
  });
});