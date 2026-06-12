import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { describe, it, expect, beforeEach, vi, afterEach, beforeAll } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockFrom = vi.fn();
const mockRpc = vi.fn();
const mockAuth = { getSession: vi.fn(), getUser: vi.fn(), onAuthStateChange: vi.fn(), signOut: vi.fn(), updateUser: vi.fn() };
const mockFetch: any = vi.fn((_url: string) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) })
);

vi.stubGlobal("fetch", mockFetch);

vi.mock("@/integrations/api/compat", () => ({
  api: { from: (...args: any[]) => mockFrom(...args), rpc: (...args: any[]) => mockRpc(...args), auth: mockAuth },
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: vi.fn() }));
vi.mock("@/utils/profileCustomization", () => ({ getProfileCustomization: () => Promise.resolve(null), parseCssToStyle: () => ({}) }));
vi.mock("@/utils/storage", () => ({ storageUrl: () => null, uploadFile: vi.fn() }));

vi.mock("@/components/PentagramLoader", () => ({
  PentagramLoader: () => <div data-testid="pentagram-loader">Loading...</div>,
}));
vi.mock("@/components/ProcessedContent", () => ({
  ProcessedContent: ({ content }: { content: string }) => <span data-testid="processed-content">{content}</span>,
}));
vi.mock("@/components/UserBadge", () => ({ UserBadge: () => null }));
vi.mock("@/components/AdminBadge", () => ({ AdminBadge: () => null }));
vi.mock("@/components/ThreadCard", () => ({
  ThreadCard: ({ thread }: { thread: { id: string; title: string } }) => (
    <div data-testid="thread-card">{thread.title}</div>
  ),
}));
vi.mock("@/components/GomoRichEditor", () => ({ GomoRichEditor: () => null }));
vi.mock("@/components/ProfileWall", () => ({
  ProfileWall: () => <div data-testid="profile-wall">ProfileWall</div>,
}));
vi.mock("@/components/AvatarCropper", () => ({ AvatarCropper: () => null }));
vi.mock("@/components/AvatarGallery", () => ({ AvatarGallery: () => null }));
vi.mock("@/components/OnlineStatus", () => ({ OnlineStatus: () => null }));
vi.mock("@/components/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/ChatIcon", () => ({ ChatIcon: () => null }));
vi.mock("@/components/MobileMenu", () => ({ MobileMenu: () => null }));
vi.mock("@/components/ProfileHoverCard", () => ({ ProfileHoverCard: () => null }));
vi.mock("@/components/HeaderUsername", () => ({ HeaderUsername: () => null }));
vi.mock("@/components/ThemeToggle", () => ({ ThemeToggle: () => null }));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ userId: "profile-user-1" }),
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

let ProfileComponent: any;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Profile", () => {
  beforeAll(async () => {
    const mod = await import("./Profile");
    ProfileComponent = mod.default;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function setupOwnProfile() {
    const user = { id: "profile-user-1" };
    const session = { user, access_token: "token-abc" };
    mockAuth.getSession.mockResolvedValue({ data: { session }, error: null });
    mockAuth.getUser.mockResolvedValue({ data: { user }, error: null });
    mockAuth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } }, error: null });

    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/v1/user_roles")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
      }
      if (url.includes("/api/v1/user_achievements")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
      }
      if (url.includes("/api/rpc/get_avatar_history")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
      }
      if (url.includes("/api/v1/profiles")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            data: [{
              id: "profile-user-1", username: "testuser", bio: "Hello world",
              is_anonymous: false, thread_count: 5, post_count: 42, garma: 100,
              thread_likes_received_count: 10, created_at: "2025-01-01T00:00:00Z",
              avatar_url: null, is_online: false, last_seen_at: null,
            }],
          }),
        });
      }
      if (url.includes("/api/v1/privacy_settings")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            data: [{ show_last_seen: true, show_online_status: true, show_profile_wall: true, allow_wall_posts_from_others: true, show_threads_tab: true, show_profile_stats: false }],
          }),
        });
      }
      if (url.includes("/api/rpc/get_user_likes_received_count")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: 15 }) });
      }
      if (url.includes("/api/rpc/get_user_thread_likes_received_count")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: 10 }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    });

    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          order: () => ({
            maybeSingle: () => Promise.resolve({ data: {}, error: null }),
          }),
        }),
      }),
    });
    mockRpc.mockResolvedValue({ data: 0, error: null });
  }

  it("shows pentagram loader before profile loads", () => {
    mockAuth.getSession.mockReturnValue(new Promise(() => {}));
    mockAuth.getUser.mockReturnValue(new Promise(() => {}));
    mockAuth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } }, error: null });

    renderWithProviders(<ProfileComponent />);
    expect(screen.getByTestId("pentagram-loader")).toBeInTheDocument();
  });

  it("renders username after profile loads", async () => {
    setupOwnProfile();
    renderWithProviders(<ProfileComponent />);

    await waitFor(() => {
      expect(screen.getByText("testuser")).toBeInTheDocument();
    });
  });

  it("shows achievements tab with count", async () => {
    setupOwnProfile();
    renderWithProviders(<ProfileComponent />);

    await waitFor(() => {
      expect(screen.getByText(/Достижения/)).toBeInTheDocument();
    });
  });

  it("shows threads tab when privacy allows", async () => {
    setupOwnProfile();
    renderWithProviders(<ProfileComponent />);

    await waitFor(() => {
      expect(screen.getByText("Треды")).toBeInTheDocument();
    });
  });

  it("renders bio content", async () => {
    setupOwnProfile();
    renderWithProviders(<ProfileComponent />);

    await waitFor(() => {
      const contents = screen.getAllByTestId("processed-content");
      expect(contents.length).toBeGreaterThanOrEqual(1);
    });
  });
});
