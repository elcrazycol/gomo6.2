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
vi.mock("@/components/NicknameEmoji", () => ({ NicknameEmoji: () => null }));
vi.mock("@/components/EmojiPicker", () => ({ EmojiPicker: () => null }));
vi.mock("@/components/ThreadCard", () => ({
  ThreadCard: ({ thread }: { thread: { id: string; title: string } }) => (
    <div data-testid="thread-card">{thread.title}</div>
  ),
}));
vi.mock("@/components/GomoRichEditor", () => ({ GomoRichEditor: () => null }));
const mockProfileWallProps: any[] = [];
vi.mock("@/components/ProfileWall", () => ({
  ProfileWall: (props: any) => {
    mockProfileWallProps.push(props);
    return <div data-testid="profile-wall">ProfileWall</div>;
  },
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
    mockProfileWallProps.length = 0;
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
              is_anonymous: false, thread_count: 5, post_count: 42,
              wall_post_count: 3, comment_count: 7, likes_received_count: 25,
              garma: 100, created_at: "2025-01-01T00:00:00Z",
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

  it("shows skeleton loader before profile loads", () => {
    mockAuth.getSession.mockReturnValue(new Promise(() => {}));
    mockAuth.getUser.mockReturnValue(new Promise(() => {}));
    mockAuth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } }, error: null });

    const { container } = renderWithProviders(<ProfileComponent />);
    // Skeleton loading state renders animated pulse divs
    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
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

  // ─── Private profile viewed by a non-friend ─────────────────────────────────

  function setupForeignPrivateProfile(privacyOverrides: Record<string, unknown> = {}) {
    const user = { id: "viewer-user" };
    const session = { user, access_token: "token-abc" };
    mockAuth.getSession.mockResolvedValue({ data: { session }, error: null });
    mockAuth.getUser.mockResolvedValue({ data: { user }, error: null });
    mockAuth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } }, error: null });

    const privacyData = {
      show_last_seen: true, show_online_status: true, show_profile_wall: true,
      allow_wall_posts_from_others: true, show_threads_tab: true,
      show_profile_stats: false,
      private_profile: true,
      private_hide_avatar: false,
      private_hide_wall: false,
      private_hide_threads: true,
      private_hide_stats: false,
      private_hide_friends: true,
      private_hide_gifts: true,
      private_hide_achievements: true,
      ...privacyOverrides,
    };

    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/v1/user_roles") || url.includes("/api/v1/user_achievements")) {
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
              id: "profile-user-1", username: "privateuser", bio: "Secret bio",
              is_anonymous: false, thread_count: 0, post_count: 0,
              wall_post_count: 0, comment_count: 0, likes_received_count: 0,
              garma: 0, created_at: "2025-01-01T00:00:00Z",
              avatar_url: null, is_online: false, last_seen_at: null,
            }],
          }),
        });
      }
      if (url.includes("/api/v1/users/") && url.includes("/privacy")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: privacyData }) });
      }
      if (url.includes("/api/v1/friends/status/")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: { status: "none" } }) });
      }
      if (url.includes("/api/v1/user_gifts")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ count: 0 }) });
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

  it("fetches the owner's visibility flags from the public privacy endpoint for a foreign profile", async () => {
    setupForeignPrivateProfile();
    renderWithProviders(<ProfileComponent />);

    // The wall tab renders once the friendship/privacy check resolves.
    await waitFor(() => {
      expect(screen.getByText("Стена")).toBeInTheDocument();
    });

    const privacyCalls = mockFetch.mock.calls.filter(([url]: [string]) =>
      url.includes("/api/v1/users/") && url.includes("/privacy")
    );
    expect(privacyCalls.length).toBeGreaterThan(0);
    // The old viewer-scoped endpoint must NOT be used for a foreign profile.
    const scopedCalls = mockFetch.mock.calls.filter(([url]: [string]) =>
      url.includes("/api/v1/privacy_settings")
    );
    expect(scopedCalls.length).toBe(0);
  });

  it("keeps the wall tab (with a private notice) and hides sections per privacy settings for a non-friend on a private profile", async () => {
    setupForeignPrivateProfile();
    renderWithProviders(<ProfileComponent />);

    // The wall tab appears once the friendship/privacy check resolves; the
    // wall notice below explains why the wall is hidden for non-friends.
    await waitFor(() => {
      expect(screen.getByText("Стена")).toBeInTheDocument();
    });

    // The wall tab stays and is the default landing tab; ProfileWall gets told
    // the wall is hidden (server-side) so it renders the private notice.
    expect(screen.getByText("Стена")).toBeInTheDocument();
    await waitFor(() => {
      expect(mockProfileWallProps.length).toBeGreaterThan(0);
      const props = mockProfileWallProps[mockProfileWallProps.length - 1];
      expect(props.wallHidden).toBe(true);
      expect(props.privateProfile).toBe(true);
    });

    // Everything hidden by the owner's settings disappears entirely: no
    // achievements, threads, gifts or friends tabs for this viewer.
    expect(screen.queryByText(/Достижения/)).not.toBeInTheDocument();
    expect(screen.queryByText("Треды")).not.toBeInTheDocument();
    expect(screen.queryByText(/Подарки/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Друзья/)).not.toBeInTheDocument();
  });

  it("shows the friends tab when the owner keeps friends visible on a private profile", async () => {
    // Override privacy: friends NOT hidden → the tab must appear.
    setupForeignPrivateProfile({ private_hide_friends: false });

    renderWithProviders(<ProfileComponent />);

    await waitFor(() => {
      expect(screen.getByText("Стена")).toBeInTheDocument();
    });

    // Friends not hidden → the friends tab shows (wall + friends only).
    expect(screen.getByText("Стена")).toBeInTheDocument();
    expect(screen.getByText(/^Друзья/)).toBeInTheDocument();
    // Hidden sections stay hidden.
    expect(screen.queryByText(/Достижения/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Подарки/)).not.toBeInTheDocument();
  });
});
