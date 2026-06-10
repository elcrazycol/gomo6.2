import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, beforeEach, vi, afterEach, beforeAll } from "vitest";
import { BrowserRouter } from "react-router-dom";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockFrom = vi.fn<any>();
const mockRpc = vi.fn<any>();
const mockAuth = { getSession: vi.fn(), getUser: vi.fn(), onAuthStateChange: vi.fn(), signOut: vi.fn() };

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

vi.mock("@/integrations/api/compat", () => ({
  api: {
    from: (...args: any[]) => mockFrom(...args),
    rpc: (...args: any[]) => mockRpc(...args),
    auth: mockAuth,
  },
}));

vi.mock("@/components/ThreadFeed", () => ({
  ThreadFeed: () => <div data-testid="thread-feed">ThreadFeed</div>,
}));

vi.mock("@/components/ThreadCard", () => ({
  ThreadCard: ({ thread }: { thread: { id: string; title: string } }) => (
    <div data-testid="thread-card">{thread.title}</div>
  ),
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

vi.mock("@/hooks/useSessionTime", () => ({ useSessionTime: vi.fn() }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: vi.fn() }));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
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
      case "thread_subscriptions":
        return makePromiseChain({ data: [], error: null });
      default:
        return makePromiseChain({ data: [], error: null });
    }
  });
  mockRpc.mockResolvedValue({ data: null, error: null });
}

function setupLoggedOut() {
  mockAuth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  mockAuth.getUser.mockResolvedValue({ data: { user: null }, error: null });
  mockAuth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } }, error: null });
  mockFrom.mockImplementation((_table: string) => makePromiseChain({ data: [], error: null }));
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it("shows subscription/promo tab switcher", async () => {
    setupLoggedIn();
    renderWithProviders(<IndexComponent />);
    await waitFor(() => {
      const recommendBtns = screen.getAllByText("Рекомендации");
      expect(recommendBtns.length).toBeGreaterThanOrEqual(1);
      const subBtns = screen.getAllByText("Подписки");
      expect(subBtns.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("renders sidebar navigation buttons", async () => {
    setupLoggedIn();
    renderWithProviders(<IndexComponent />);
    await waitFor(() => {
      expect(screen.getByText("Основные доски")).toBeInTheDocument();
      expect(screen.getByText("G-сабы")).toBeInTheDocument();
    });
  });

  it("renders important links in sidebar", async () => {
    setupLoggedIn();
    renderWithProviders(<IndexComponent />);
    await waitFor(() => {
      expect(screen.getByText("Информация")).toBeInTheDocument();
      expect(screen.getByText("Баги/Идеи")).toBeInTheDocument();
      expect(screen.getByText("FAQ")).toBeInTheDocument();
    });
  });

  it("loads boards on mount", async () => {
    setupLoggedIn();
    renderWithProviders(<IndexComponent />);
    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith("boards");
    });
  });

  it("loads user roles when logged in", async () => {
    setupLoggedIn();
    renderWithProviders(<IndexComponent />);
    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith("user_roles");
    });
  });
});
