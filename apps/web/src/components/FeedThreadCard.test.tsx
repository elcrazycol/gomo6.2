import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi, beforeAll } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("date-fns", () => ({
  formatDistanceToNow: () => "2 дня назад",
}));
vi.mock("date-fns/locale", () => ({ ru: {} }));

const mockFrom = vi.fn();
const mockNavigateFn = vi.fn();
const insertFn = vi.fn(() => Promise.resolve({ data: null, error: null }));
const deleteFn = vi.fn(() => {
  const chain = Promise.resolve({ data: null, error: null }) as any;
  chain.eq = () => chain;
  return chain;
});

vi.mock("@/integrations/api/compat", () => ({
  api: {
    from: (...args: any[]) => mockFrom(...args),
    rpc: vi.fn(),
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

// Keep renderTags real (tag pills), stub only the heavy card component.
vi.mock("@/components/ThreadCard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ThreadCard")>();
  return { ...actual, ThreadCard: () => null };
});

vi.mock("@/components/WallAttachments", () => ({
  WallAttachments: ({ attachments }: any) => (
    <div
      data-testid="wall-attachments"
      data-count={attachments.length}
      data-first-url={attachments[0]?.url}
    />
  ),
}));

vi.mock("@/components/MediaPlayer", () => ({
  MediaPlayer: () => null,
}));
vi.mock("@/components/AudioAttachment", () => ({
  AudioAttachment: () => null,
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigateFn,
  Link: ({ children, to, onClick }: any) => (
    <a href={to} onClick={onClick}>
      {children}
    </a>
  ),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createMockThread(overrides: any = {}) {
  return {
    id: "thread-1",
    title: "Test Thread Title",
    content: "This is the thread content.",
    content_json: null,
    image_url: null,
    image_urls: null,
    attachments: null,
    created_at: "2025-01-18T10:00:00Z",
    updated_at: "2025-01-18T10:00:00Z",
    user_id: "author-1",
    board_id: "board-1",
    post_count: 5,
    tags: null,
    profiles: { username: "testuser", is_anonymous: false, avatar_url: null },
    boards: { slug: "test-board", name: "Test Board", is_gomosub: false },
    ...overrides,
  };
}

let FeedThreadCardComponent: any;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("FeedThreadCard", () => {
  beforeAll(async () => {
    const mod = await import("./FeedThreadCard");
    FeedThreadCardComponent = mod.FeedThreadCard;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockImplementation((table: string) => {
      if (table === "thread_likes") {
        return { insert: insertFn, delete: deleteFn };
      }
      return { insert: insertFn, delete: deleteFn };
    });
  });

  const renderCard = (thread = createMockThread(), props: any = {}) =>
    render(
      <FeedThreadCardComponent
        thread={thread}
        currentUserId="current-user"
        currentUsername="currentuser"
        onImageClick={vi.fn()}
        {...props}
      />,
    );

  // ─── Basic render ───────────────────────────────────────────────────────────

  it("renders title, content, author and board link", async () => {
    renderCard();

    await waitFor(() => {
      expect(screen.getByText("Test Thread Title")).toBeInTheDocument();
    });
    expect(screen.getByText("This is the thread content.")).toBeInTheDocument();
    expect(screen.getByTestId("user-badge")).toHaveTextContent("testuser");
    expect(screen.getByText("2 дня назад")).toBeInTheDocument();
    expect(screen.getByText(/test-board/)).toBeInTheDocument();
  });

  it("renders tag pills from thread tags", async () => {
    renderCard(createMockThread({ tags: { content: "games", format: "question" } }));

    await waitFor(() => {
      expect(screen.getByText("Игры")).toBeInTheDocument();
    });
    expect(screen.getByText("Вопрос")).toBeInTheDocument();
  });

  it("renders replies count from post_count", async () => {
    renderCard();

    await waitFor(() => {
      expect(screen.getByText("5")).toBeInTheDocument();
    });
  });

  // ─── Attachments ────────────────────────────────────────────────────────────

  it("maps legacy image_urls to plain attachments for the wall gallery", async () => {
    renderCard(createMockThread({ image_urls: ["img1.jpg", "img2.jpg"] }));

    await waitFor(() => {
      const attachments = screen.getByTestId("wall-attachments");
      expect(attachments).toHaveAttribute("data-count", "2");
      expect(attachments).toHaveAttribute("data-first-url", "img1.jpg");
    });
  });

  it("passes rich attachments through and merges extra legacy image_urls", async () => {
    const rich = [{
      url: "rich.jpg",
      type: "image" as const,
      mime: "image/jpeg",
      name: "photo",
      size: 1000,
      meta: {
        preview_key: "rich.preview.jpg",
        lqip: "data:image/jpeg;base64,lqip",
        width: 800,
        height: 600,
        pipeline: "image-v2",
      },
    }];
    renderCard(createMockThread({ attachments: rich, image_urls: ["extra.jpg"] }));

    await waitFor(() => {
      const attachments = screen.getByTestId("wall-attachments");
      expect(attachments).toHaveAttribute("data-count", "2");
      expect(attachments).toHaveAttribute("data-first-url", "rich.jpg");
    });
  });

  it("renders no attachments when the thread has none", async () => {
    renderCard();

    await waitFor(() => {
      expect(screen.getByText("Test Thread Title")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("wall-attachments")).not.toBeInTheDocument();
  });

  // ─── Likes ──────────────────────────────────────────────────────────────────

  it("likes the thread via the live button and updates the count", async () => {
    renderCard();

    await waitFor(() => {
      expect(screen.getByText("Test Thread Title")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("0"));

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith("thread_likes");
      expect(insertFn).toHaveBeenCalledWith({ thread_id: "thread-1", user_id: "current-user" });
    });
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(mockNavigateFn).not.toHaveBeenCalled();
  });

  it("unlikes a thread that the viewer already liked", async () => {
    renderCard(createMockThread(), { initialLikesCount: 1, initialUserLiked: true });

    await waitFor(() => {
      expect(screen.getByText("1")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("1"));

    await waitFor(() => {
      expect(deleteFn).toHaveBeenCalled();
    });
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  // ─── Navigation ─────────────────────────────────────────────────────────────

  it("navigates to the thread on card click", async () => {
    renderCard();

    await waitFor(() => {
      expect(screen.getByText("Test Thread Title")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Test Thread Title"));

    expect(mockNavigateFn).toHaveBeenCalledWith("/test-board/thread/thread-1");
  });

  it("navigates with the /g/ prefix for gomosub boards", async () => {
    renderCard(createMockThread({
      boards: { slug: "gomo-board", name: "Gomo Board", is_gomosub: true },
    }));

    await waitFor(() => {
      expect(screen.getByText("Test Thread Title")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Test Thread Title"));

    expect(mockNavigateFn).toHaveBeenCalledWith("/g/gomo-board/thread/thread-1");
  });

  it("opens the thread from the answers button", async () => {
    renderCard();

    await waitFor(() => {
      expect(screen.getByText("5")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("5"));

    expect(mockNavigateFn).toHaveBeenCalledWith("/test-board/thread/thread-1");
  });
});
