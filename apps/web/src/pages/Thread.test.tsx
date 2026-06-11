import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { describe, it, expect, beforeEach, vi, afterEach, beforeAll } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockAuth = { getSession: vi.fn(), getUser: vi.fn(), onAuthStateChange: vi.fn() };
const mockFetch = vi.fn();

vi.stubGlobal("fetch", mockFetch);

vi.mock("@/integrations/api/compat", () => ({ api: { from: vi.fn(), rpc: vi.fn(), auth: mockAuth } }));
vi.mock("@/hooks/queries", () => ({
  useThread: () => ({ data: null, isLoading: false }),
  usePosts: () => ({ data: [], isLoading: false }),
  useThreadSubscription: () => ({ data: false }),
}));
vi.mock("@/hooks/useWebSocketSync", () => ({ useWebSocketSync: vi.fn() }));
vi.mock("@/services/websocket", () => ({ wsService: { subscribe: vi.fn(), subscribeToThread: vi.fn(), unsubscribe: vi.fn(), on: vi.fn().mockReturnValue(vi.fn()) } }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: vi.fn() }));
vi.mock("@/lib/imageProcessing", () => ({ getUserPrivacySettings: () => Promise.resolve({ remove_image_metadata: false }) }));
vi.mock("@/utils/storage", () => ({ storageUrl: () => null }));
vi.mock("@/utils/bbcodePlugins", () => ({ renderBbCode: () => null }));

// Render nothing for visual components
const NullComp = () => null;
vi.mock("@/components/PentagramLoader", () => ({ PentagramLoader: () => <div data-testid="pentagram-loader">Loading...</div> }));
vi.mock("@/components/ProcessedContent", () => ({
  ProcessedContent: ({ content }: { content: string }) => <span data-testid="processed-content">{content}</span>,
}));
vi.mock("@/components/UserBadge", () => ({ UserBadge: () => null }));
vi.mock("@/components/GomoRichEditor", () => ({ GomoRichEditor: () => null }));
vi.mock("@/components/LikeButton", () => ({ LikeButton: () => null }));
vi.mock("@/components/ImageGallery", () => ({ ImageGallery: () => null }));
vi.mock("@/components/MediaPlayer", () => ({ MediaPlayer: () => null }));
vi.mock("@/components/AudioAttachment", () => ({ AudioAttachment: () => null }));
vi.mock("@/components/ScrollToBottomButton", () => ({ ScrollToBottomButton: () => null }));
vi.mock("@/components/ModeratorMenu", () => ({ ModeratorMenu: () => null }));
vi.mock("@/components/UserMenu", () => ({ UserMenu: () => null }));
vi.mock("@/components/AttachmentUpload", () => ({ AttachmentUpload: () => null }));
vi.mock("@/components/ThreadAttachmentUpload", () => ({ ThreadAttachmentUpload: () => null }));
vi.mock("@/components/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/ChatIcon", () => ({ ChatIcon: () => null }));
vi.mock("@/components/MobileMenu", () => ({ MobileMenu: () => null }));
vi.mock("@/components/ProfileHoverCard", () => ({ ProfileHoverCard: () => null }));
vi.mock("@/components/HeaderUsername", () => ({ HeaderUsername: () => null }));
vi.mock("@/components/MentionLink", () => ({ MentionLink: () => null }));
vi.mock("@/components/LinkButton", () => ({ LinkButton: () => null }));
vi.mock("@/components/EmojiInline", () => ({ EmojiInline: () => null }));
vi.mock("@/components/CensorBlur", () => ({ CensorBlur: () => null }));
vi.mock("@/components/SpoilerText", () => ({ SpoilerText: () => null }));
vi.mock("@/components/EmojiPicker", () => ({ EmojiPicker: () => null }));
vi.mock("@/components/Poll", () => ({ Poll: () => null }));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ slug: "test-board", threadId: "thread-1" }),
    useLocation: () => ({ pathname: "/test-board/thread/thread-1" }),
  };
});

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>{ui}</BrowserRouter>
    </QueryClientProvider>
  );
}

let ThreadComponent: any;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Thread", () => {
  beforeAll(async () => {
    const mod = await import("./Thread");
    ThreadComponent = mod.default;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    const session = { user: { id: "user-1" }, access_token: "token-abc" };
    mockAuth.getSession.mockResolvedValue({ data: { session }, error: null });
    mockAuth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    mockAuth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } }, error: null });
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: [] }) });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows pentagram loader when thread is still loading", async () => {
    const queries = await import("@/hooks/queries");
    (queries.useThread as any) = () => ({ data: null, isLoading: true });
    renderWithProviders(<ThreadComponent />);
    await waitFor(() => {
      expect(screen.getByTestId("pentagram-loader")).toBeInTheDocument();
    });
  });

  it("renders back link to board page when thread is loaded", async () => {
    const queries = await import("@/hooks/queries");
    const threadData = {
      id: "thread-1", board_id: "board-1", user_id: "author-1",
      title: "Test Thread", content: "Hello world",
      created_at: "2025-01-01T00:00:00Z", updated_at: "2025-01-01T00:00:00Z",
      post_count: 3,
      boards: { slug: "test-board", name: "Test Board", is_gomosub: false, is_rules_board: false },
    };
    (queries.useThread as any) = () => ({ data: threadData, isLoading: false });
    (queries.usePosts as any) = () => ({ data: [], isLoading: false });
    (queries.useThreadSubscription as any) = () => ({ data: false });

    renderWithProviders(<ThreadComponent />);

    await waitFor(() => {
      expect(screen.getByText("← Назад к доске")).toBeInTheDocument();
    });
  });

  it("renders thread title", async () => {
    const queries = await import("@/hooks/queries");
    const threadData = {
      id: "thread-1", board_id: "board-1", user_id: "author-1",
      title: "My Awesome Thread", content: "Hello world",
      created_at: "2025-01-01T00:00:00Z", updated_at: "2025-01-01T00:00:00Z",
      post_count: 3,
      boards: { slug: "test-board", name: "Test Board", is_gomosub: false, is_rules_board: false },
    };
    (queries.useThread as any) = () => ({ data: threadData, isLoading: false });
    (queries.usePosts as any) = () => ({ data: [], isLoading: false });
    (queries.useThreadSubscription as any) = () => ({ data: false });

    renderWithProviders(<ThreadComponent />);

    await waitFor(() => {
      expect(screen.getByText("My Awesome Thread")).toBeInTheDocument();
    });
  });

  it("shows login prompt when user is not logged in", async () => {
    mockAuth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    const queries = await import("@/hooks/queries");
    (queries.useThread as any) = () => ({
      data: {
        id: "thread-1", board_id: "board-1", user_id: "author-1",
        title: "Test Thread", content: "Hello",
        created_at: "2025-01-01T00:00:00Z", updated_at: "2025-01-01T00:00:00Z",
        post_count: 0,
        boards: { slug: "test-board", name: "Test Board", is_gomosub: false, is_rules_board: false },
      },
      isLoading: false,
    });
    (queries.usePosts as any) = () => ({ data: [], isLoading: false });
    (queries.useThreadSubscription as any) = () => ({ data: false });

    renderWithProviders(<ThreadComponent />);

    await waitFor(() => {
      expect(screen.getByText("Войдите, чтобы ответить")).toBeInTheDocument();
      expect(screen.getByText("Войти")).toBeInTheDocument();
    });
  });
});
