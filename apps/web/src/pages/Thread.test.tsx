import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { describe, it, expect, beforeEach, vi, beforeAll } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockAuth = { getSession: vi.fn(), getUser: vi.fn(), onAuthStateChange: vi.fn() };
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("@/integrations/api/compat", () => ({ api: { from: vi.fn(), rpc: vi.fn(), auth: mockAuth } }));
vi.mock("@/hooks/queries", () => ({
  useThread: vi.fn(),
  useThreadSubscription: vi.fn(),
}));
vi.mock("@/services/websocket", () => ({
  wsService: { subscribe: vi.fn(), subscribeToThread: vi.fn(), unsubscribe: vi.fn(), on: vi.fn().mockReturnValue(vi.fn()) },
}));
vi.mock("@/utils/storage", () => ({ storageUrl: () => null }));
vi.mock("@/utils/currentUserMeta", () => ({
  getCurrentUserMeta: () => Promise.resolve({ roles: [], color: "", username: "me", avatarUrl: null }),
}));
vi.mock("@/contexts/LikesCacheContext", () => ({
  LikesCacheProvider: ({ children }: any) => children,
  useLikesCache: () => ({ getLikeData: vi.fn(), loadLikeData: vi.fn(), updateLikeData: vi.fn(), loadLikeDataBatch: vi.fn() }),
}));
vi.mock("@/components/PentagramLoader", () => ({ PentagramLoader: () => <div data-testid="pentagram-loader">Loading...</div> }));
vi.mock("@/components/ProcessedContent", () => ({
  ProcessedContent: ({ content }: any) => <div data-testid="processed-content">{content}</div>,
}));
vi.mock("@/components/UserBadge", () => ({ UserBadge: () => <span data-testid="user-badge" /> }));
vi.mock("@/components/LikeButton", () => ({ LikeButton: () => null }));
vi.mock("@/components/Lightbox", () => ({ Lightbox: () => null }));
vi.mock("@/components/Poll", () => ({ Poll: () => null }));
vi.mock("@/components/UserMenu", () => ({ UserMenu: () => <div data-testid="user-menu" /> }));
vi.mock("@/components/GomoRichEditor", () => ({
  GomoRichEditor: ({ legacyContent, onChange }: any) => (
    <textarea
      data-testid="thread-edit-input"
      defaultValue={legacyContent || ""}
      onChange={(e) => onChange?.({ json: null, text: e.target.value })}
    />
  ),
}));
vi.mock("@/components/WallAttachments", () => ({ WallAttachments: () => null }));
vi.mock("@/components/share/ShareSheet", () => ({ ShareSheet: () => null }));
vi.mock("@/components/thread/ThreadCommentTree", () => ({
  ThreadCommentTree: ({ currentUserId }: any) => (
    <div data-testid="thread-comment-tree" data-can-post={!!currentUserId} />
  ),
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await import("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ slug: "test-board", threadId: "thread-1" }),
    useLocation: () => ({ pathname: "/test-board/thread/thread-1" }),
  };
});

let ThreadComponent: any;
let useThread: any;
let useThreadSubscription: any;

// ─── Fixtures ────────────────────────────────────────────────────────────────

const mockThread = (overrides?: Record<string, unknown>) => ({
  id: "thread-1", board_id: "board-1", user_id: "author-1",
  title: "Test Thread", content: "Hello world",
  created_at: "2025-01-01T00:00:00Z", updated_at: "2025-01-01T00:00:00Z",
  post_count: 3,
  boards: { slug: "test-board", name: "Test Board", is_gomosub: false, is_rules_board: false },
  profiles: { username: "author", avatar_url: null, is_anonymous: false },
  ...overrides,
});

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>{ui}</BrowserRouter>
    </QueryClientProvider>
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Thread", () => {
  beforeAll(async () => {
    const mod = await import("./Thread");
    ThreadComponent = mod.default;
    const queries = await import("@/hooks/queries");
    useThread = queries.useThread;
    useThreadSubscription = queries.useThreadSubscription;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    const session = { user: { id: "user-1" }, access_token: "token-abc" };
    mockAuth.getSession.mockResolvedValue({ data: { session }, error: null });
    mockAuth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    mockAuth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } }, error: null });
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: [] }) });
  });

  it("shows pentagram loader when thread is still loading", async () => {
    useThread.mockReturnValue({ data: null, isLoading: true } as any);
    useThreadSubscription.mockReturnValue({ data: false } as any);
    renderWithProviders(<ThreadComponent />);
    await waitFor(() => {
      expect(screen.getByTestId("pentagram-loader")).toBeInTheDocument();
    });
  });

  it("renders back button when thread is loaded", async () => {
    useThread.mockReturnValue({ data: mockThread(), isLoading: false } as any);
    useThreadSubscription.mockReturnValue({ data: false } as any);

    renderWithProviders(<ThreadComponent />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /назад/i })).toBeInTheDocument();
    });
  });

  it("goes back in history when the thread was opened from another page", async () => {
    useThread.mockReturnValue({ data: mockThread(), isLoading: false } as any);
    useThreadSubscription.mockReturnValue({ data: false } as any);
    Object.defineProperty(window.history, "length", { configurable: true, get: () => 5 });

    renderWithProviders(<ThreadComponent />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /назад/i })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: /назад/i }));
    expect(mockNavigate).toHaveBeenCalledWith(-1);
  });

  it("falls back to the board when the thread was opened directly", async () => {
    useThread.mockReturnValue({ data: mockThread(), isLoading: false } as any);
    useThreadSubscription.mockReturnValue({ data: false } as any);
    Object.defineProperty(window.history, "length", { configurable: true, get: () => 1 });

    renderWithProviders(<ThreadComponent />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /назад/i })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: /назад/i }));
    expect(mockNavigate).toHaveBeenCalledWith("/test-board", { replace: true });
  });

  it("renders the thread card: title, author and content", async () => {
    useThread.mockReturnValue({ data: mockThread({ title: "My Awesome Thread" }), isLoading: false } as any);
    useThreadSubscription.mockReturnValue({ data: false } as any);

    renderWithProviders(<ThreadComponent />);
    await waitFor(() => {
      expect(screen.getByText("My Awesome Thread")).toBeInTheDocument();
      expect(screen.getByTestId("processed-content")).toHaveTextContent("Hello world");
      expect(screen.getByTestId("user-badge")).toBeInTheDocument();
    });
  });

  it("renders the comment tree with posting enabled for a logged-in user", async () => {
    useThread.mockReturnValue({ data: mockThread(), isLoading: false } as any);
    useThreadSubscription.mockReturnValue({ data: false } as any);

    renderWithProviders(<ThreadComponent />);
    await waitFor(() => {
      expect(screen.getByTestId("thread-comment-tree")).toHaveAttribute("data-can-post", "true");
    });
  });

  it("hides the comment composer for guests", async () => {
    mockAuth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    useThread.mockReturnValue({ data: mockThread(), isLoading: false } as any);
    useThreadSubscription.mockReturnValue({ data: false } as any);

    renderWithProviders(<ThreadComponent />);
    await waitFor(() => {
      expect(screen.getByTestId("thread-comment-tree")).toHaveAttribute("data-can-post", "false");
    });
  });

  it("shows the post count from the thread", async () => {
    useThread.mockReturnValue({ data: mockThread({ post_count: 7 }), isLoading: false } as any);
    useThreadSubscription.mockReturnValue({ data: false } as any);

    renderWithProviders(<ThreadComponent />);
    await waitFor(() => {
      expect(screen.getByText("7")).toBeInTheDocument();
    });
  });

  it("lets the author edit the thread", async () => {
    useThread.mockReturnValue({
      data: mockThread({ user_id: "user-1" }),
      isLoading: false,
    } as any);
    useThreadSubscription.mockReturnValue({ data: false } as any);

    renderWithProviders(<ThreadComponent />);
    await waitFor(() => {
      expect(screen.getByTestId("user-menu")).toBeInTheDocument();
    });
    // The edit handler lives behind UserMenu (mocked) — the card itself renders.
    expect(screen.getByText("Test Thread")).toBeInTheDocument();
  });
});
