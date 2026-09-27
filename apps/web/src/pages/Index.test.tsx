import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, beforeEach, vi, afterEach, beforeAll } from "vitest";
import { BrowserRouter } from "react-router-dom";

// ─── Mocks ───────────────────────────────────────────────────────────────────

// makePromiseChain must be defined BEFORE mockFrom uses it
function makePromiseChain(resolvedValue: any): any {
  const chain: Record<string, any> = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    in: () => chain,
    limit: () => chain,
    range: () => chain,
    single: () => chain,
    maybeSingle: () => chain,
    insert: () => chain,
    update: () => chain,
    delete: () => chain,
    head: () => chain,
    neq: () => chain,
    or: () => chain,
    then: (cb: any) => Promise.resolve(resolvedValue).then(cb),
  };
  return chain;
}

const { mockFrom, mockRpc, mockAuth, mockParams } = vi.hoisted(() => ({
  mockFrom: vi.fn<any>().mockImplementation(() => makePromiseChain({ data: [], error: null })),
  mockRpc: vi.fn<any>().mockResolvedValue({ data: null, error: null }),
  mockAuth: { getSession: vi.fn(), getUser: vi.fn(), onAuthStateChange: vi.fn(), signOut: vi.fn() },
  mockParams: { current: {} as Record<string, string> },
}));

vi.mock("@/integrations/api/compat", () => ({
  api: {
    from: (...args: any[]) => mockFrom(...args),
    rpc: (...args: any[]) => mockRpc(...args),
    auth: mockAuth,
  },
}));

// «Mr. рандомность» and other view blocks talk to the raw client; keep them
// offline in tests.
vi.mock("@/integrations/api/client", () => ({
  apiClient: { request: vi.fn().mockResolvedValue({ data: [] }) },
}));

vi.mock("@/components/ThreadFeed", () => ({
  ThreadFeed: () => <div data-testid="thread-feed">ThreadFeed</div>,
}));

vi.mock("@/components/SectionThreads", () => ({
  SectionThreads: ({ section }: { section: { name: string } }) => (
    <div data-testid="section-threads">{section.name}</div>
  ),
}));

vi.mock("@/components/MyPosts", () => ({
  MyPosts: () => <div data-testid="my-posts">MyPosts</div>,
}));
vi.mock("@/components/HistoryView", () => ({
  HistoryView: () => <div data-testid="history-view">History</div>,
}));
vi.mock("@/components/FavoritesView", () => ({
  FavoritesView: () => <div data-testid="favorites-view">Favorites</div>,
}));

vi.mock("@/components/PentagramLoader", () => ({
  PentagramLoader: () => <div data-testid="pentagram-loader">Loading...</div>,
}));

vi.mock("@/components/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/ChatIcon", () => ({ ChatIcon: () => null }));
vi.mock("@/components/MobileMenu", () => ({ MobileMenu: () => null }));
vi.mock("@/components/ProfileHoverCard", () => ({ ProfileHoverCard: () => null }));
vi.mock("@/components/ThemeToggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/components/UserBadge", () => ({ UserBadge: () => null }));
vi.mock("@/components/HeaderUsername", () => ({ HeaderUsername: () => null }));
vi.mock("@/components/TermsOfService", () => ({ TermsOfService: () => null }));
vi.mock("@/components/PrefetchLink", () => ({
  PrefetchLink: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock("@/services/messengerWebSocket", () => ({
  messengerWs: { connect: vi.fn(), disconnect: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() },
}));
vi.mock("@/stores/messengerStore", () => ({
  useMessengerStore: Object.assign(vi.fn((selector: any) => selector?.({
    conversations: [],
    selectedConversationId: null,
    messages: [],
    typingUsers: {},
    isInitialLoading: false,
    isMessagesLoading: false,
    isSending: false,
    error: null,
    me: null,
    receipts: {},
    totalUnread: 0,
    init: vi.fn(),
    selectConversation: vi.fn(),
    createConversation: vi.fn(),
    setError: vi.fn(),
    sendMessage: vi.fn(),
    editMessage: vi.fn(),
    deleteMessage: vi.fn(),
    markRead: vi.fn(),
    markDelivered: vi.fn(),
    togglePin: vi.fn(),
    updateConversationFromWs: vi.fn(),
    selectedConversation: vi.fn(() => null),
  })), { getState: vi.fn(() => ({ conversations: [], selectedConversationId: null, markDelivered: vi.fn(), markRead: vi.fn() })) }),
  selectTotalUnread: () => 0,
  selectSelectedConversation: () => null,
}));
vi.mock("@/hooks/useSessionTime", () => ({ useSessionTime: vi.fn() }));
vi.mock("@/contexts/ProfileCacheContext", () => ({
  ProfileCacheProvider: ({ children }: { children: React.ReactNode }) => children,
  useProfileCache: () => ({
    getProfile: vi.fn(() => null),	    loadProfile: vi.fn(() => Promise.resolve({ username: "", isAdmin: false, customization: null })),
    clearCache: vi.fn(),
  }),
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => mockParams.current,
    Link: ({ children, to, className }: { children: React.ReactNode; to: string; className?: string }) => (
      <a href={to} className={className}>{children}</a>
    ),
  };
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setupLoggedIn() {
  const user = { id: "user-1" };
  const session = { user, access_token: "token-abc" };
  mockAuth.getSession.mockResolvedValue({ data: { session }, error: null });
  mockAuth.getUser.mockResolvedValue({ data: { user }, error: null });
  mockAuth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } }, error: null });

  mockFrom.mockImplementation((table: string) => {
    switch (table) {
      case "boards":
        return makePromiseChain({
          data: [
            { id: "board-1", slug: "general", name: "General", description: "General discussion" },
            { id: "board-3", slug: "random", name: "Random", description: "Random" },
          ],
          error: null,
        });
      case "user_roles":
        return makePromiseChain({ data: [], error: null });
      case "profiles":
        return makePromiseChain({ data: [{ id: "user-1", username: "testuser" }], error: null });
      case "user_achievements":
        return makePromiseChain({ data: [], error: null });
      case "user_terms_acceptance":
        return makePromiseChain({ data: { user_id: "user-1" }, error: null });
      case "gomosub_memberships":
        return makePromiseChain({ data: [], error: null });
      case "thread_sections":
        return makePromiseChain({
          data: [
            {
              id: "sec-1",
              slug: "general",
              name: "Общение",
              description: null,
              icon: "message-circle",
              is_nsfw: false,
              sort_order: 10,
            },
          ],
          error: null,
        });
      case "thread_subsections":
        return makePromiseChain({
          data: [
            {
              id: "sub-1",
              section_id: "sec-1",
              slug: "dating",
              name: "Знакомства",
              description: null,
              sort_order: 10,
            },
          ],
          error: null,
        });
      default:
        return makePromiseChain({ data: [], error: null });
    }
  });
  mockRpc.mockResolvedValue({ data: null, error: null });
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {ui}
      </BrowserRouter>
    </QueryClientProvider>
  );
}

let IndexComponent: any;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Index", () => {
  beforeAll(async () => {
    const mod = await import("./Index");
    IndexComponent = mod.default;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockParams.current = {};
    window.history.pushState({}, "", "/");
  });

  afterEach(() => {});

  it("shows pentagram loader while loading", () => {
    mockAuth.getSession.mockReturnValue(new Promise(() => {}));
    mockAuth.getUser.mockReturnValue(new Promise(() => {}));
    mockAuth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } }, error: null });

    const { container } = renderWithProviders(<IndexComponent />);
    const loaderContainer = container.querySelector(".min-h-screen");
    expect(loaderContainer).toBeInTheDocument();
  });

  it("renders ThreadFeed when logged in", async () => {
    setupLoggedIn();
    renderWithProviders(<IndexComponent />);
    await waitFor(() => {
      expect(screen.getByTestId("thread-feed")).toBeInTheDocument();
    });
  });

  it("renders the feed without the recommendations/subscriptions switcher", async () => {
    setupLoggedIn();
    renderWithProviders(<IndexComponent />);
    await waitFor(() => {
      expect(screen.getByTestId("thread-feed")).toBeInTheDocument();
    });
    // The feed is recommendations-only now: the toggle (and the subscriptions
    // view behind it) has been removed.
    expect(screen.queryByText("Рекомендации")).not.toBeInTheDocument();
    expect(screen.queryByText("Новые записи из подписок")).not.toBeInTheDocument();
  });

  it("renders sidebar navigation buttons", async () => {
    setupLoggedIn();
    renderWithProviders(<IndexComponent />);
    await waitFor(() => {
      expect(screen.getByText("G-сабы")).toBeInTheDocument();
    });
  });

  it("renders the restyled sidebar blocks with their lists", async () => {
    setupLoggedIn();
    renderWithProviders(<IndexComponent />);
    await waitFor(() => {
      expect(screen.getByText("Подписки")).toBeInTheDocument();
      expect(screen.getByText("Mr. рандомность")).toBeInTheDocument();
    });
  });

  it("does not render links to the removed forum boards", async () => {
    setupLoggedIn();
    renderWithProviders(<IndexComponent />);
    await waitFor(() => {
      expect(screen.getByText("Mr. рандомность")).toBeInTheDocument();
    });
    expect(screen.queryByText("Важное")).not.toBeInTheDocument();
    expect(screen.queryByText("Информация")).not.toBeInTheDocument();
    expect(screen.queryByText("FAQ")).not.toBeInTheDocument();
  });

  it("loads user roles when logged in", async () => {
    setupLoggedIn();
    renderWithProviders(<IndexComponent />);
    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalled();
    });
  });

  it("on a раздел path renders the section and never mounts the feed", async () => {
    setupLoggedIn();
    mockParams.current = { sectionSlug: "general" };
    renderWithProviders(<IndexComponent />);

    await waitFor(() => expect(screen.getByTestId("section-threads")).toHaveTextContent("Общение"));
    expect(screen.queryByTestId("thread-feed")).not.toBeInTheDocument();
  });

  it("redirects the legacy ?section= URL to the /c/ path form", async () => {
    setupLoggedIn();
    window.history.pushState({}, "", "/?section=general&sub=dating");
    renderWithProviders(<IndexComponent />);

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("/c/general/dating", { replace: true }),
    );
  });

  it("redirects the legacy ?view= URL to its path", async () => {
    setupLoggedIn();
    window.history.pushState({}, "", "/?view=favorites");
    renderWithProviders(<IndexComponent />);

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/favorites", { replace: true }));
  });

  it("renders «Мои записи» on /mine", async () => {
    setupLoggedIn();
    window.history.pushState({}, "", "/mine");
    renderWithProviders(<IndexComponent />);

    await waitFor(() => expect(screen.getByTestId("my-posts")).toBeInTheDocument());
  });
});
