import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi, beforeAll, afterEach, afterAll } from "vitest";
import React from "react";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const { mockAuth, mockApiClient, mockToast, mockGetCurrentUserMeta } = vi.hoisted(() => ({
  mockAuth: { getSession: vi.fn(), getUser: vi.fn(), onAuthStateChange: vi.fn() },
  mockApiClient: { getToken: vi.fn(() => "token-abc"), getCSRFToken: vi.fn(() => "csrf-xyz") },
  mockToast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn() },
  mockGetCurrentUserMeta: vi.fn().mockResolvedValue({ roles: [] }),
}));

const mockFetch = vi.fn();

// Stub fetch for the whole file (mirrors Thread.test.tsx / Profile.test.tsx):
// vitest isolates each test file, so the stub cannot leak into other files. A
// per-test `vi.unstubAllGlobals()` in afterEach races with in-flight component
// async that resumes after the test ends — that continuation then hits the
// REAL Node fetch with a relative URL and throws an unhandled rejection (the
// "Failed to parse URL from /api/v1/boards/test" coverage-CI flake).
vi.stubGlobal("fetch", mockFetch);

vi.mock("@/integrations/api/compat", () => ({ api: { from: vi.fn(), rpc: vi.fn(), auth: mockAuth } }));
vi.mock("@/integrations/api/client", () => ({ apiClient: mockApiClient }));
vi.mock("@/integrations/api/queryCache", () => ({ invalidateByPrefix: vi.fn() }));
vi.mock("@/utils/currentUserMeta", () => ({ getCurrentUserMeta: (...args: unknown[]) => mockGetCurrentUserMeta(...args) }));
vi.mock("@/hooks/useSessionTime", () => ({ useSessionTime: vi.fn() }));
vi.mock("@/hooks/useProfileInvalidation", () => ({ useProfileInvalidation: vi.fn() }));
vi.mock("@/services/websocket", () => ({
  wsService: { subscribe: vi.fn(), unsubscribe: vi.fn(), on: vi.fn().mockReturnValue(vi.fn()) },
}));
vi.mock("@/utils/storage", () => ({ storageUrl: () => undefined }));
vi.mock("@/utils/emojiUtils.tsx", () => ({
  renderPreviewContent: (text: string) => <span data-testid="preview-content">{text}</span>,
}));
vi.mock("@/components/ThreadCard", () => ({ renderTags: () => null }));
vi.mock("@/components/LikeButton", () => ({ LikeButton: () => null }));
vi.mock("@/components/UserBadge", () => ({ UserBadge: () => null }));
vi.mock("@/components/PentagramLoader", () => ({
  PentagramLoader: () => <div data-testid="pentagram-loader">Loading...</div>,
}));
vi.mock("@/components/AgeVerification", () => ({
  AgeVerification: ({ open, onConfirm, onDecline }: any) =>
    open ? (
      <div data-testid="age-verification">
        <button data-testid="age-confirm" onClick={onConfirm}>Подтвердить возраст</button>
        <button data-testid="age-decline" onClick={onDecline}>Отказаться</button>
      </div>
    ) : null,
}));
vi.mock("sonner", () => ({ toast: mockToast }));
// vaul needs matchMedia/ResizeObserver plumbing that jsdom lacks — stub the
// whole drawer module (mirrors ShareSheet.test.tsx). The mock renders the
// content only while open, with role=dialog so the sheet assertions below
// keep working.
vi.mock("@/components/ui/drawer", () => ({
  Drawer: ({ open, onOpenChange, children }: any) =>
    open ? (
      <div role="dialog">
        <button onClick={() => onOpenChange(false)}>Закрыть</button>
        {children}
      </div>
    ) : null,
  DrawerContent: ({ children }: any) => <div data-testid="drawer-content">{children}</div>,
  DrawerHandle: ({ children }: any) => <div>{children}</div>,
  DrawerTitle: ({ children }: any) => <div>{children}</div>,
}));

const mockNavigate = vi.fn();
const mockParams: Record<string, string | undefined> = { slug: "test", channelSlug: undefined };
const mockPathname: { current: string } = { current: "/test" };
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => mockParams,
    useLocation: () => ({ pathname: mockPathname.current }),
    useSearchParams: () => [new URLSearchParams(""), vi.fn()],
    Link: ({ children, to, onClick }: { children: React.ReactNode; to: string; onClick?: (e: unknown) => void }) => (
      <a href={to} onClick={onClick}>{children}</a>
    ),
    // The real Navigate requires a Router context; the test renders Board bare.
    Navigate: () => null,
  };
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

const baseBoard = {
  id: "board-1",
  slug: "test",
  name: "Test Board",
  description: "Board description text",
  is_rules_board: false,
  is_gomosub: false,
};

const baseThread = (overrides?: Record<string, unknown>) => ({
  id: "thread-1",
  board_id: "board-1",
  title: "My Awesome Thread",
  content: "Thread body content",
  image_url: null,
  created_at: "2025-01-01T00:00:00Z",
  updated_at: "2025-01-01T00:00:00Z",
  post_count: 3,
  user_id: "author-1",
  tags: null,
  profiles: { username: "author", display_name: null, nickname_emoji_id: null, is_anonymous: false },
  latest_post: {
    content: "Latest comment text",
    created_at: "2025-01-02T00:00:00Z",
    is_private: false,
    user_id: "poster-1",
    profiles: { username: "poster", display_name: null, nickname_emoji_id: null, is_anonymous: false },
  },
  ...overrides,
});

// jsonResponse returns the shape consumed by Board: { data: ..., ...extra }.
function jsonResponse(data: unknown, extra?: Record<string, unknown>) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve({ data, ...extra }) });
}

// rawJsonResponse returns a top-level object — the shape used by write
// endpoints (Board checks result.success directly).
function rawJsonResponse(data: Record<string, unknown>) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
}

function setupFetchRoutes(opts: {
  board?: Record<string, unknown>;
  threads?: Record<string, unknown>[];
  posts?: Record<string, unknown>[];
  profiles?: Record<string, unknown>[];
}) {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    if (url.startsWith("/api/v1/boards/")) {
      return jsonResponse(opts.board ?? null);
    }
    if (url.startsWith("/api/v1/threads")) {
      return jsonResponse(opts.threads ?? [], { next_cursor: null });
    }
    if (url.startsWith("/api/v1/posts")) {
      return jsonResponse(opts.posts ?? []);
    }
    if (url.startsWith("/api/v1/profiles")) {
      return jsonResponse(opts.profiles ?? []);
    }
    if (url.startsWith("/api/v1/channels")) {
      return jsonResponse([]);
    }
    if (url.startsWith("/api/v1/gomosub_rules_acceptance") && init?.method === "POST") {
      return rawJsonResponse({ success: true });
    }
    if (url.startsWith("/api/v1/gomosub_memberships")) {
      if (init?.method === "POST") return rawJsonResponse({ success: true });
      if (init?.method === "DELETE") return rawJsonResponse({ success: true });
      return jsonResponse([]);
    }
    if (url.startsWith("/api/rpc/get_board_user_permissions")) {
      return jsonResponse(null);
    }
    if (url.startsWith("/api/rpc/award_achievement")) {
      return jsonResponse(null);
    }
    return jsonResponse([]);
  });
}

function setupLoggedIn() {
  mockAuth.getSession.mockResolvedValue({ data: { session: { user: { id: "user-1" }, access_token: "token-abc" } }, error: null });
  mockAuth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } }, error: null });
}

function setupLoggedOut() {
  mockAuth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  mockAuth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } }, error: null });
}

let BoardComponent: any;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Board (wall)", () => {
  beforeAll(async () => {
    const mod = await import("./Board");
    BoardComponent = mod.default;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockParams.slug = "test";
    mockParams.channelSlug = undefined;
    mockPathname.current = "/test";
    sessionStorage.clear();
    localStorage.clear();
    setupLoggedIn();
    setupFetchRoutes({ board: baseBoard, threads: [baseThread()] });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("renders the board header and loads threads", async () => {
    render(<BoardComponent />);

    // loadBoard runs twice (auth resolves user after mount) and briefly resets
    // the board to null, so assertions below must re-poll instead of checking
    // the DOM right after an earlier waitFor.
    await waitFor(() => {
      expect(screen.getByText("Board description text")).toBeInTheDocument();
    });
    // The thread list is rendered in both the mobile and desktop layouts, so
    // the same title/content appears twice in the DOM (CSS hides one of them).
    await waitFor(() => {
      expect(screen.getAllByText("My Awesome Thread").length).toBeGreaterThan(0);
    });
    await waitFor(() => {
      expect(screen.getAllByText("Thread body content").length).toBeGreaterThan(0);
    });
  });

  it("shows the empty state when the board has no threads", async () => {
    setupFetchRoutes({ board: baseBoard, threads: [] });

    render(<BoardComponent />);

    await waitFor(() => {
      expect(screen.getByText("Записей пока нет. Будьте первым!")).toBeInTheDocument();
    });
  });

  it("shows the create-thread button for a logged-in user", async () => {
    render(<BoardComponent />);

    await waitFor(() => {
      expect(screen.getAllByText("Создать запись").length).toBeGreaterThan(0);
    });
  });

  it("hides the create-thread button for guests", async () => {
    setupLoggedOut();
    render(<BoardComponent />);

    await waitFor(() => {
      expect(screen.getByText("Board description text")).toBeInTheDocument();
    });
    expect(screen.queryAllByText("Создать запись").length).toBe(0);
  });

  it("navigates with a content tag filter when a filter chip is clicked", async () => {
    const user = userEvent.setup();
    render(<BoardComponent />);

    await waitFor(() => {
      expect(screen.getByText("Board description text")).toBeInTheDocument();
    });

    // Filter chips render after the board settles (it may briefly re-enter the
    // loading state while auth resolves), so poll for them.
    const animeChips = await screen.findAllByText("Аниме");
    await user.click(animeChips[0]);

    expect(mockNavigate).toHaveBeenCalledWith("?content=anime");
  });

  it("replaces visibility-tagged content with a login teaser", async () => {
    setupFetchRoutes({ board: baseBoard, threads: [baseThread({ content: "[seeusers=1]secret[/seeusers]" })] });

    render(<BoardComponent />);

    await waitFor(() => {
      expect(screen.getAllByText("зайдите в запись чтобы посмотреть").length).toBeGreaterThan(0);
    });
    expect(screen.queryAllByText(/secret/).length).toBe(0);
  });

  it("renders thread image when present", async () => {
    setupFetchRoutes({ board: baseBoard, threads: [baseThread({ image_url: "user-1/photo.jpg" })] });

    render(<BoardComponent />);

    await waitFor(() => {
      // The image renders in both the mobile and desktop layouts.
      expect(screen.getAllByAltText("Thread").length).toBeGreaterThan(0);
    });
  });

  it("redirects the legacy /gomosubs route", async () => {
    mockParams.slug = "gomosubs";
    mockPathname.current = "/gomosubs";

    const { container } = render(<BoardComponent />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/v1/boards/gomosubs");
    });
    // Navigate renders nothing — the board must not be shown.
    expect(container.querySelector("main")).toBeNull();
  });

  it("shows age verification on board 'd' and loads threads after confirming", async () => {
    mockParams.slug = "d";
    mockPathname.current = "/d";
    setupFetchRoutes({
      board: { ...baseBoard, id: "d-1", slug: "d" },
      threads: [baseThread({ id: "d-thread", title: "Adult Thread" })],
    });
    const user = userEvent.setup();

    render(<BoardComponent />);

    await waitFor(() => {
      expect(screen.getByTestId("age-verification")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("age-confirm"));

    await waitFor(() => {
      expect(screen.getAllByText("Adult Thread").length).toBeGreaterThan(0);
    });
    // Confirming awards the achievement for a logged-in user.
    const awardCalls = mockFetch.mock.calls.filter(([url]) => url === "/api/rpc/award_achievement");
    expect(awardCalls.length).toBeGreaterThan(0);
  });

  it("blocks non-members from a private gomosub board", async () => {
    mockParams.slug = "private";
    mockPathname.current = "/g/private";
    setupFetchRoutes({
      board: {
        id: "g-1",
        slug: "private",
        name: "Private Sub",
        description: "secret club",
        is_rules_board: false,
        is_gomosub: true,
        visibility: "private",
        owner_id: "owner-1",
      },
    });

    render(<BoardComponent />);

    await waitFor(() => {
      expect(screen.getByText("Приватный g-саб")).toBeInTheDocument();
    });
  });

  it("lets a user join a public gomosub board", async () => {
    mockParams.slug = "community";
    mockPathname.current = "/g/community";
    setupFetchRoutes({
      board: {
        id: "g-2",
        slug: "community",
        name: "Community",
        description: "public sub",
        is_rules_board: false,
        is_gomosub: true,
      },
    });
    const user = userEvent.setup();

    render(<BoardComponent />);

    await waitFor(() => {
      expect(screen.getByText("Вступить")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Вступить"));

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith("Вы вступили в саб");
    });
    const joinCall = mockFetch.mock.calls.find(
      ([url, init]) => url === "/api/v1/gomosub_memberships" && init?.method === "POST"
    );
    expect(joinCall).toBeTruthy();
  });

  it("shows a loader while the board is loading", async () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));
    render(<BoardComponent />);

    expect(screen.getByTestId("pentagram-loader")).toBeInTheDocument();
  });

  it("opens the mobile channel drawer and keeps it open after picking a channel", async () => {
    mockParams.slug = "gsub";
    mockPathname.current = "/g/gsub";
    const channels = [
      { id: "ch-1", board_id: "g-3", slug: "general", name: "Основной", category: null, sort_order: 0, is_private: false },
      { id: "ch-2", board_id: "g-3", slug: "news", name: "Новости", category: "Инфо", sort_order: 1, is_private: false },
      { id: "ch-3", board_id: "g-3", slug: "staff", name: "Модерация", category: "Инфо", sort_order: 2, is_private: true },
    ];
    mockFetch.mockImplementation((url: string) => {
      if (url.startsWith("/api/v1/channels")) return jsonResponse(channels);
      if (url.startsWith("/api/v1/boards/")) {
        return jsonResponse({
          id: "g-3",
          slug: "gsub",
          name: "G-Sub",
          description: "sub",
          is_rules_board: false,
          is_gomosub: true,
          owner_id: "user-1",
        });
      }
      if (url.startsWith("/api/v1/threads")) return jsonResponse([], { next_cursor: null });
      if (url.startsWith("/api/v1/gomosub_rules_acceptance")) return jsonResponse([]);
      if (url.startsWith("/api/rpc/get_board_user_permissions")) return jsonResponse(null);
      return jsonResponse([]);
    });
    const user = userEvent.setup();

    render(<BoardComponent />);

    // The mobile channel switcher (current-channel pill) renders once channels load.
    const pill = await screen.findByTitle("Каналы");
    expect(pill).toBeInTheDocument();

    // Sheet is closed — no dialog in the DOM.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(pill);

    // Sheet opens (Radix renders it in a portal with role=dialog).
    const dialog = await screen.findByRole("dialog");
    // Both the desktop sidebar and the sheet render the channel names.
    expect(dialog).toHaveTextContent("Новости");
    expect(dialog).toHaveTextContent("Модерация");
    expect(dialog).toHaveTextContent("Основной");

    // Picking a channel keeps the sheet open (native-picker behaviour) —
    // scoped to the dialog to avoid the desktop sidebar copy, which jsdom
    // still renders.
    await user.click(within(dialog).getByRole("link", { name: "Новости" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("opens the create-post composer from the sheet header (+ button)", async () => {
    mockParams.slug = "gsub";
    mockPathname.current = "/g/gsub";
    mockFetch.mockImplementation((url: string) => {
      if (url.startsWith("/api/v1/channels")) {
        return jsonResponse([
          { id: "ch-1", board_id: "g-3", slug: "general", name: "Основной", category: null, sort_order: 0, is_private: false },
        ]);
      }
      if (url.startsWith("/api/v1/boards/")) {
        return jsonResponse({ id: "g-3", slug: "gsub", name: "G-Sub", description: "sub", is_rules_board: false, is_gomosub: true, owner_id: "user-1" });
      }
      if (url.startsWith("/api/v1/threads")) return jsonResponse([], { next_cursor: null });
      if (url.startsWith("/api/v1/gomosub_rules_acceptance")) return jsonResponse([]);
      if (url.startsWith("/api/rpc/get_board_user_permissions")) return jsonResponse(null);
      return jsonResponse([]);
    });
    const user = userEvent.setup();

    render(<BoardComponent />);

    const pill = await screen.findByTitle("Каналы");
    await user.click(pill);
    const dialog = await screen.findByRole("dialog");

    // Compact sheet: a + button in the header, next to the board identity.
    const createBtn = within(dialog).getByRole("button", { name: "Создать запись" });
    expect(createBtn).toBeInTheDocument();
    await user.click(createBtn);

    // No channel picked → composer opens for the sub as a whole.
    expect(mockNavigate).toHaveBeenCalledWith("/g/gsub/create");
  });

  it("locks the page scroll the moment the channel sheet opens and restores it on close", async () => {
    mockParams.slug = "gsub";
    mockPathname.current = "/g/gsub";
    mockFetch.mockImplementation((url: string) => {
      if (url.startsWith("/api/v1/channels")) {
        return jsonResponse([{ id: "ch-1", board_id: "g-3", slug: "general", name: "Основной", category: null, sort_order: 0, is_private: false }]);
      }
      if (url.startsWith("/api/v1/boards/")) {
        return jsonResponse({ id: "g-3", slug: "gsub", name: "G-Sub", description: "sub", is_rules_board: false, is_gomosub: true, owner_id: "user-1" });
      }
      if (url.startsWith("/api/v1/threads")) return jsonResponse([], { next_cursor: null });
      if (url.startsWith("/api/v1/gomosub_rules_acceptance")) return jsonResponse([]);
      if (url.startsWith("/api/rpc/get_board_user_permissions")) return jsonResponse(null);
      return jsonResponse([]);
    });
    const user = userEvent.setup();

    render(<BoardComponent />);
    const pill = await screen.findByTitle("Каналы");

    expect(document.body.style.overflow).not.toBe("hidden");
    await user.click(pill);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    // Lock applies immediately (while the sheet is still open).
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.documentElement.style.overflow).toBe("hidden");

    // Picking a channel keeps the sheet open, so close via the drawer mock's
    // close button (the real overlay click is mocked away in jsdom).
    await user.click(within(dialog).getByRole("link", { name: "Основной" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Закрыть" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(document.body.style.overflow).not.toBe("hidden");
  });
});
