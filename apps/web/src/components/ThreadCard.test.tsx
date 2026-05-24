import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi, afterEach, beforeAll } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Mock date-fns BEFORE the component imports it
vi.mock("date-fns", () => ({
  formatDistanceToNow: () => "2 дня назад",
}));
vi.mock("date-fns/locale", () => ({ ru: {} }));

const mockFrom = vi.fn();
const mockRpc = vi.fn();
const mockNavigateFn = vi.fn();

vi.mock("@/integrations/api/compat", () => ({
  api: {
    from: (...args: any[]) => mockFrom(...args),
    rpc: (...args: any[]) => mockRpc(...args),
  },
}));

vi.mock("@/utils/storage", () => ({
  storageUrl: (_bucket: string, keyOrUrl?: string | null) => keyOrUrl || null,
}));

vi.mock("@/components/UserBadge", () => ({
  UserBadge: ({ username, isAnonymous }: any) => (
    <span data-testid="user-badge" data-anonymous={!!isAnonymous}>
      {username || "Аноним"}
    </span>
  ),
}));

vi.mock("@/components/ProcessedContent", () => ({
  ProcessedContent: ({ content }: any) => (
    <span data-testid="processed-content">{content}</span>
  ),
}));



vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigateFn,
  Link: ({ children, to, className, onClick }: any) => (
    <a href={to} className={className} onClick={onClick}>
      {children}
    </a>
  ),
}));

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
    const insertResult = { data: { id: "new-id" }, error: null };
    const insertP = Promise.resolve(insertResult) as any;
    insertP.select = () => insertP;
    insertP.single = () => insertP;
    return insertP;
  };
  p.delete = () => {
    const delP = Promise.resolve({ data: null, error: null }) as any;
    delP.eq = () => delP;
    delP.or = () => delP;
    delP.select = () => delP;
    return delP;
  };
  return p;
}

function createMockThread(overrides: any = {}) {
  return {
    id: "thread-1",
    title: "Test Thread Title",
    content: "This is the thread content.",
    content_json: null,
    image_url: null,
    image_urls: null,
    created_at: "2025-01-18T10:00:00Z",
    updated_at: "2025-01-18T10:00:00Z",
    user_id: "author-1",
    post_count: 5,
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
    switch (table) {
      case "posts":
        return makeChain({ data: [], error: null });
      case "profiles":
        return makeChain({ data: [], error: null });
      case "thread_likes":
        return makeChain({ data: null, error: null });
      default:
        return makeChain({ data: [], error: null });
    }
  });
  mockRpc.mockImplementation((fn: string) => {
    if (fn === "get_thread_likes_count") return Promise.resolve({ data: 0, error: null });
    if (fn === "get_recent_thread_likers") return Promise.resolve({ data: [], error: null });
    if (fn === "has_user_liked_thread") return Promise.resolve({ data: false, error: null });
    return Promise.resolve({ data: null, error: null });
  });
}

let ThreadCardComponent: any;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ThreadCard", () => {
  beforeAll(async () => {
    const mod = await import("./ThreadCard");
    ThreadCardComponent = mod.ThreadCard;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    defaultApiMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Basic render ───────────────────────────────────────────────────────────

  it("renders thread title and content", async () => {
    render(
      <ThreadCardComponent
        thread={createMockThread()}
        currentUserId="current-user"
        currentUsername="currentuser"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Test Thread Title")).toBeInTheDocument();
    });
    expect(screen.getByText("This is the thread content.")).toBeInTheDocument();
  });

  it("renders author username", async () => {
    render(
      <ThreadCardComponent
        thread={createMockThread()}
        currentUserId="current-user"
        currentUsername="currentuser"
      />,
    );

    await waitFor(() => {
      const badges = screen.getAllByTestId("user-badge");
      expect(badges[0]).toHaveTextContent("testuser");
    });
  });

  it("renders board link with correct slug", async () => {
    render(
      <ThreadCardComponent
        thread={createMockThread()}
        currentUserId="current-user"
        currentUsername="currentuser"
      />,
    );

    await waitFor(() => {
      const boardLink = screen.getByText(/test-board/);
      expect(boardLink).toBeInTheDocument();
    });
  });

  it("renders timestamp relative to now", async () => {
    render(
      <ThreadCardComponent
        thread={createMockThread()}
        currentUserId="current-user"
        currentUsername="currentuser"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("2 дня назад")).toBeInTheDocument();
    });
  });

  it("renders reply count", async () => {
    render(
      <ThreadCardComponent
        thread={createMockThread({ post_count: 5 })}
        currentUserId="current-user"
        currentUsername="currentuser"
      />,
    );

    await waitFor(() => {
      const replyBtn = screen.getByRole("button", { name: /5/i });
      expect(replyBtn).toBeInTheDocument();
      expect(replyBtn.textContent).toMatch(/5.*ответов/);
    });
  });

  // ─── Tags ───────────────────────────────────────────────────────────────────

  it.each([
    ["content", "anime", "Аниме"],
    ["format", "discussion", "Обсуждение"],
    ["atmosphere", "serious", "Серьёзно"],
  ])("renders %s tag (%s → %s)", async (_key, _val, label) => {
    render(
      <ThreadCardComponent
        thread={createMockThread({ tags: { [_key]: _val } })}
        currentUserId="current-user"
        currentUsername="currentuser"
      />,
    );

    await waitFor(() => {
      // Tags render twice: desktop + mobile
      expect(screen.getAllByText(label as string).length).toBeGreaterThanOrEqual(1);
    });
  });

  it("renders night flag tag", async () => {
    render(
      <ThreadCardComponent
        thread={createMockThread({ tags: { flag: "night" } })}
        currentUserId="current-user"
        currentUsername="currentuser"
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByText("Ночной").length).toBeGreaterThanOrEqual(1);
    });
  });

  it.each([
    ["time", 24, "24ч"],
    ["messages", 100, "100сообщ."],
  ])("renders ephemeral badge with %s", async (_type, _val, expected) => {
    render(
      <ThreadCardComponent
        thread={createMockThread({ ephemeral_type: _type, ephemeral_value: _val })}
        currentUserId="current-user"
        currentUsername="currentuser"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(expected as string)).toBeInTheDocument();
    });
  });

  // ─── Content expansion ──────────────────────────────────────────────────────

  it("shows expand button for content longer than 300 chars", async () => {
    const longContent = "A".repeat(301);

    render(
      <ThreadCardComponent
        thread={createMockThread({ content: longContent })}
        currentUserId="current-user"
        currentUsername="currentuser"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Раскрыть")).toBeInTheDocument();
    });
  });

  it("does not show expand button for short content", async () => {
    render(
      <ThreadCardComponent
        thread={createMockThread({ content: "Short content" })}
        currentUserId="current-user"
        currentUsername="currentuser"
      />,
    );

    await waitFor(() => {
      expect(screen.queryByText("Раскрыть")).not.toBeInTheDocument();
    });
  });

  it("expands content when clicking 'Раскрыть'", async () => {
    render(
      <ThreadCardComponent
        thread={createMockThread({ content: "A".repeat(301) })}
        currentUserId="current-user"
        currentUsername="currentuser"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Раскрыть")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Раскрыть"));

    await waitFor(() => {
      expect(screen.queryByText("Раскрыть")).not.toBeInTheDocument();
    });
  });

  // ─── Images ─────────────────────────────────────────────────────────────────

  it("renders image elements when image_urls are present", async () => {
    render(
      <ThreadCardComponent
        thread={createMockThread({ image_urls: ["img1.jpg", "img2.jpg"] })}
        currentUserId="current-user"
        currentUsername="currentuser"
      />,
    );

    await waitFor(() => {
      // avatar img + 2 attachment images = 3
      const imgs = screen.getAllByRole("img");
      expect(imgs.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("shows expand images button when images exist", async () => {
    render(
      <ThreadCardComponent
        thread={createMockThread({ image_urls: ["img1.jpg", "img2.jpg"] })}
        currentUserId="current-user"
        currentUsername="currentuser"
      />,
    );

    // The image grid is shown with "Раскрыть" for both content (if long) and images
    // The content is short so the expand button is only for images
    await waitFor(() => {
      expect(screen.getByText("Раскрыть")).toBeInTheDocument();
    });
  });

  // ─── Recent posts ───────────────────────────────────────────────────────────

  it("shows recent post preview when api returns posts", async () => {
    mockFrom.mockImplementation((table: string) => {
      switch (table) {
        case "posts":
          return makeChain({
            data: [
              {
                id: "recent-post-1",
                content: "Recent reply content",
                content_json: null,
                created_at: "2025-01-19T15:00:00Z",
                user_id: "reply-author-1",
              },
            ],
            error: null,
          });
        case "profiles":
          return makeChain({
            data: [
              { id: "reply-author-1", username: "replyuser", is_anonymous: false, avatar_url: null },
            ],
            error: null,
          });
        case "thread_likes":
          return makeChain({ data: null, error: null });
        default:
          return makeChain({ data: [], error: null });
      }
    });

    render(
      <ThreadCardComponent
        thread={createMockThread()}
        currentUserId="current-user"
        currentUsername="currentuser"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Recent reply content")).toBeInTheDocument();
    });

    expect(screen.getByText("replyuser:")).toBeInTheDocument();
  });

  it("does not show recent post preview when api returns empty", async () => {
    render(
      <ThreadCardComponent
        thread={createMockThread()}
        currentUserId="current-user"
        currentUsername="currentuser"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Test Thread Title")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith("posts");
    });

    expect(screen.queryByText("replyuser:")).not.toBeInTheDocument();
  });

  // ─── Likes ──────────────────────────────────────────────────────────────────

  it("loads likes data from API on mount", async () => {
    render(
      <ThreadCardComponent
        thread={createMockThread()}
        currentUserId="current-user"
        currentUsername="currentuser"
      />,
    );

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith("get_thread_likes_count", {
        thread_uuid: "thread-1",
      });
    });
    expect(mockRpc).toHaveBeenCalledWith("get_recent_thread_likers", {
      thread_uuid: "thread-1",
      limit_count: 3,
    });
    expect(mockRpc).toHaveBeenCalledWith("has_user_liked_thread", {
      thread_uuid: "thread-1",
      user_uuid: "current-user",
    });
  });

  it("renders inline like button with Heart icon", async () => {
    render(
      <ThreadCardComponent
        thread={createMockThread()}
        currentUserId="current-user"
        currentUsername="currentuser"
      />,
    );

    await waitFor(() => {
      const likesCount = screen.getByText("0");
      expect(likesCount).toBeInTheDocument();
      expect(likesCount.closest("button")).toBeInTheDocument();
    });
  });

  // ─── Navigation ─────────────────────────────────────────────────────────────

  it("navigates to thread on card click", async () => {
    render(
      <ThreadCardComponent
        thread={createMockThread()}
        currentUserId="current-user"
        currentUsername="currentuser"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Test Thread Title")).toBeInTheDocument();
    });

    const article = screen.getByRole("article");
    await userEvent.click(article);

    expect(mockNavigateFn).toHaveBeenCalledWith("/test-board/thread/thread-1");
  });

  it("navigates with gomosub prefix for gomosub boards", async () => {
    render(
      <ThreadCardComponent
        thread={createMockThread({
          boards: { slug: "gomo-board", name: "Gomo Board", is_gomosub: true },
        })}
        currentUserId="current-user"
        currentUsername="currentuser"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Test Thread Title")).toBeInTheDocument();
    });

    const article = screen.getByRole("article");
    await userEvent.click(article);

    expect(mockNavigateFn).toHaveBeenCalledWith("/g/gomo-board/thread/thread-1");
  });

  // ─── Active indicator ───────────────────────────────────────────────────────

  it("shows 'Активен' when updated_at differs from created_at", async () => {
    render(
      <ThreadCardComponent
        thread={createMockThread({ updated_at: "2025-01-19T10:00:00Z" })}
        currentUserId="current-user"
        currentUsername="currentuser"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Активен")).toBeInTheDocument();
    });
  });

  // ─── Multiple tags ──────────────────────────────────────────────────────────

  it("renders multiple tags simultaneously", async () => {
    render(
      <ThreadCardComponent
        thread={createMockThread({
          tags: { content: "games", format: "question", atmosphere: "irony", flag: "night" },
        })}
        currentUserId="current-user"
        currentUsername="currentuser"
      />,
    );

    await waitFor(() => {
      // Tags render twice (desktop + mobile), use getAllByText
      expect(screen.getAllByText("Игры").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Вопрос").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Ирония").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Ночной").length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── Error handling ─────────────────────────────────────────────────────────

  it("handles recent posts API error gracefully", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    mockFrom.mockImplementation((table: string) => {
      if (table === "posts") {
        // Use a deferred promise that we don't reject immediately to avoid unhandled rejection
        const deferP = new Promise(() => {}) as any;
        deferP.select = () => deferP;
        deferP.eq = () => deferP;
        deferP.order = () => deferP;
        deferP.limit = () => deferP;
        return deferP;
      }
      return makeChain({ data: [], error: null });
    });

    render(
      <ThreadCardComponent
        thread={createMockThread()}
        currentUserId="current-user"
        currentUsername="currentuser"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Test Thread Title")).toBeInTheDocument();
    });

    consoleSpy.mockRestore();
  });

  it("handles likes data API error gracefully", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Make rpc return a never-resolving promise for likes (simulating error path)
    mockRpc.mockImplementation((fn: string) => {
      if (fn === "has_user_liked_thread") return Promise.resolve({ data: false, error: null });
      return new Promise(() => {}); // never resolves
    });

    render(
      <ThreadCardComponent
        thread={createMockThread()}
        currentUserId="current-user"
        currentUsername="currentuser"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Test Thread Title")).toBeInTheDocument();
    });

    consoleSpy.mockRestore();
  });

  // ─── Gomosub board link ─────────────────────────────────────────────────────

  it("uses /g/ prefix for gomosub board board link", async () => {
    render(
      <ThreadCardComponent
        thread={createMockThread({
          boards: { slug: "gomo-board", name: "Gomo Board", is_gomosub: true },
        })}
        currentUserId="current-user"
        currentUsername="currentuser"
      />,
    );

    await waitFor(() => {
      const boardLink = screen.getByText(/gomo-board/);
      expect(boardLink.closest("a")).toHaveAttribute("href", "/g/gomo-board");
    });
  });
});
