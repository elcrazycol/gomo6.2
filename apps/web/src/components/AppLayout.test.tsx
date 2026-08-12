import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AppLayout } from "./AppLayout";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const { mockAuth, mockProfileCache, mockSearchGlobal, mockEventManager, mockAnimate } = vi.hoisted(() => {
  return {
    mockAnimate: vi.fn(() => ({ stop: vi.fn() })),
    mockAuth: {
      user: null as any,
      isLoading: false,
      isAuthenticated: false,
      error: null,
      refetch: vi.fn(),
      invalidateAuth: vi.fn(),
    },
    mockProfileCache: {
      loadProfile: vi.fn().mockResolvedValue({
        username: "testuser",
        color: "",
        customization: null,
        isAdmin: false,
      }),
      getProfile: vi.fn().mockReturnValue(null),
      clearCache: vi.fn(),
    },
    mockSearchGlobal: vi.fn().mockResolvedValue({ users: [], boards: [], threads: [], posts: [] }),
    mockEventManager: {
      init: vi.fn(),
      cleanup: vi.fn(),
      subscribeConversation: vi.fn(),
      unsubscribeConversation: vi.fn(),
    },
  };
});

const mockNavigate = vi.hoisted(() => vi.fn());
const mockLocation = vi.hoisted(() => ({ pathname: "/", search: "", hash: "" }));
const mockInvalidateQueries = vi.hoisted(() => vi.fn());

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => mockLocation,
  Link: ({ to, children, ...props }: any) => (
    <a href={to} {...props}>{children}</a>
  ),
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual("@tanstack/react-query");
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => mockAuth,
}));

vi.mock("@/contexts/ProfileCacheContext", () => ({
  useProfileCache: () => mockProfileCache,
}));

vi.mock("@/hooks/useProfileInvalidation", () => ({
  useProfileInvalidation: (cb: () => void) => {
    // Store callback for tests to trigger
    (globalThis as any).__profileInvalidationCb = cb;
  },
}));

vi.mock("@/hooks/useTabTitle", () => ({
  useTabTitle: () => {},
}));

vi.mock("@/services/eventManager", () => ({
  eventManager: mockEventManager,
}));

vi.mock("@/utils/globalSearch", () => ({
  searchGlobal: mockSearchGlobal,
}));

// framer-motion: replace motion components with plain elements. The scroll
// machinery is mocked so tests can drive the header hide/show handler directly
// via __scrollHandler (latest) with the previous scroll position in
// __scrollPrevious, and assert the resulting animation target on mockAnimate.
vi.mock("framer-motion", () => ({
  motion: {
    header: ({ children, ...props }: any) => <div data-testid="motion-header" {...props}>{children}</div>,
    main: ({ children, ...props }: any) => <main {...props}>{children}</main>,
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  useScroll: () => ({ scrollY: { getPrevious: () => (globalThis as any).__scrollPrevious ?? 0 } }),
  useMotionValueEvent: (_mv: any, _ev: any, cb: any) => {
    (globalThis as any).__scrollHandler = cb;
  },
  useMotionValue: (initial: any) => ({ get: () => initial, set: () => {} }),
  useTransform: () => "0px",
  animate: mockAnimate,
}));

// Sub-components
vi.mock("@/components/NotificationBell", () => ({
  NotificationBell: ({ userId }: any) => <div data-testid="notification-bell">{userId}</div>,
}));
vi.mock("@/components/ChatIcon", () => ({
  ChatIcon: ({ userId }: any) => <div data-testid="chat-icon">{userId}</div>,
}));
vi.mock("@/components/MobileMenu", () => ({
  MobileMenu: ({ isModerator }: any) => <div data-testid="mobile-menu">{String(isModerator)}</div>,
}));
vi.mock("@/components/HeaderUsername", () => ({
  HeaderUsername: ({ userId }: any) => <div data-testid="header-username">{userId}</div>,
}));
vi.mock("@/components/Footer", () => ({
  Footer: () => <div data-testid="footer">Footer</div>,
}));
vi.mock("@/components/CookieBanner", () => ({
  CookieBanner: () => <div data-testid="cookie-banner">Cookies</div>,
}));
vi.mock("@/components/AchievementToastListener", () => ({
  AchievementToastListener: () => <div data-testid="achievement-listener" />,
}));
vi.mock("@/components/DropsShop", () => ({
  DropsShop: ({ open }: any) => (open ? <div data-testid="drops-shop">Shop</div> : null),
}));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children }: any) => <>{children}</>,
  TooltipContent: ({ children }: any) => <div>{children}</div>,
}));

function renderLayout(children: React.ReactNode = <div>content</div>) {
  return render(<AppLayout>{children}</AppLayout>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.user = null;
  mockAuth.isAuthenticated = false;
  mockLocation.pathname = "/";
  mockSearchGlobal.mockResolvedValue({ users: [], boards: [], threads: [], posts: [] });
  mockProfileCache.loadProfile.mockResolvedValue({
    username: "testuser",
    color: "",
    customization: null,
    isAdmin: false,
  });
  mockProfileCache.getProfile.mockReturnValue(null);
  (globalThis as any).__profileInvalidationCb = null;
  (globalThis as any).__scrollHandler = null;
  (globalThis as any).__scrollPrevious = 0;
  localStorage.clear();
  document.body.classList.remove("messenger-mobile-chat-active");
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AppLayout", () => {
  it("renders children", () => {
    renderLayout(<div>content</div>);
    expect(screen.getByText("content")).toBeInTheDocument();
  });

  it("renders header, footer and cookie banner on regular pages", () => {
    renderLayout();
    expect(screen.getByTestId("motion-header")).toBeInTheDocument();
    expect(screen.getByTestId("footer")).toBeInTheDocument();
    expect(screen.getByTestId("cookie-banner")).toBeInTheDocument();
    expect(screen.getByTestId("achievement-listener")).toBeInTheDocument();
  });

  it("renders gomo6 logo link", () => {
    renderLayout();
    expect(screen.getByText("gomo6")).toBeInTheDocument();
  });

  it("hides header/footer on the auth page", () => {
    mockLocation.pathname = "/auth";
    renderLayout(<div>auth content</div>);
    expect(screen.queryByTestId("motion-header")).not.toBeInTheDocument();
    expect(screen.queryByTestId("footer")).not.toBeInTheDocument();
    expect(screen.getByText("auth content")).toBeInTheDocument();
  });

  describe("authentication", () => {
    it("shows 'Войти' button for guests", () => {
      renderLayout();
      expect(screen.getByRole("button", { name: "Войти" })).toBeInTheDocument();
      expect(screen.queryByTestId("notification-bell")).not.toBeInTheDocument();
    });

    it("navigates to /auth when guest clicks login", () => {
      renderLayout();
      fireEvent.click(screen.getByRole("button", { name: "Войти" }));
      expect(mockNavigate).toHaveBeenCalledWith("/auth");
    });

    it("shows user chrome when authenticated", async () => {
      mockAuth.user = { id: "user-1" };
      mockAuth.isAuthenticated = true;
      renderLayout();
      expect(screen.getByTestId("notification-bell")).toHaveTextContent("user-1");
      expect(screen.getByTestId("chat-icon")).toHaveTextContent("user-1");
      expect(screen.getByTestId("header-username")).toHaveTextContent("user-1");
      expect(screen.queryByRole("button", { name: "Войти" })).not.toBeInTheDocument();
    });

    it("loads profile for authenticated user (moderator state)", async () => {
      mockAuth.user = { id: "user-1" };
      mockAuth.isAuthenticated = true;
      mockProfileCache.loadProfile.mockResolvedValue({
        username: "moderator",
        color: "purple",
        customization: null,
        isAdmin: true,
      });
      renderLayout();
      await waitFor(() => {
        expect(mockProfileCache.loadProfile).toHaveBeenCalledWith("user-1");
      });
      expect(screen.getByTestId("mobile-menu")).toHaveTextContent("true");
    });
  });

  describe("global events", () => {
    it("opens the drops shop on 'open-drops-shop' event", () => {
      renderLayout();
      expect(screen.queryByTestId("drops-shop")).not.toBeInTheDocument();
      fireEvent(window, new CustomEvent("open-drops-shop"));
      expect(screen.getByTestId("drops-shop")).toBeInTheDocument();
    });

    it("navigates on 'navigate-to' event", () => {
      renderLayout();
      fireEvent(window, new CustomEvent("navigate-to", { detail: "/profile/42" }));
      expect(mockNavigate).toHaveBeenCalledWith("/profile/42");
    });

    it("redirects to login and invalidates auth on 'auth:expired'", () => {
      renderLayout();
      fireEvent(window, new CustomEvent("auth:expired"));
      expect(mockNavigate).toHaveBeenCalledWith("/auth");
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ["auth"] });
    });

    it("invalidates feed caches on profile invalidation", () => {
      renderLayout();
      const cb = (globalThis as any).__profileInvalidationCb;
      expect(typeof cb).toBe("function");
      act(() => cb());
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ["threads"] });
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ["posts"] });
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ["profiles"] });
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ["user-threads"] });
    });

    it("initializes the event manager for authenticated users", () => {
      mockAuth.user = { id: "user-1" };
      renderLayout();
      expect(mockEventManager.init).toHaveBeenCalledWith("user-1");
    });
  });

  describe("search", () => {
    it("performs a debounced global search and shows results", async () => {
      mockSearchGlobal.mockResolvedValue({
        users: [{ id: "u1", username: "alice" }],
        boards: [],
        threads: [],
        posts: [],
      });
      renderLayout();

      // Open desktop search
      fireEvent.click(screen.getByRole("button", { name: "Открыть поиск" }));
      fireEvent.change(screen.getByPlaceholderText("Поиск: юзер, g-саб, тред..."), {
        target: { value: "ali" },
      });

      await waitFor(() => {
        expect(mockSearchGlobal).toHaveBeenCalledWith("ali", expect.anything());
      });
      await waitFor(() => {
        expect(screen.getByText("@alice")).toBeInTheDocument();
      });
    });

    it("shows 'Ничего не найдено' when search has no results", async () => {
      renderLayout();
      fireEvent.click(screen.getByRole("button", { name: "Открыть поиск" }));
      fireEvent.change(screen.getByPlaceholderText("Поиск: юзер, g-саб, тред..."), {
        target: { value: "zzz" },
      });
      await waitFor(() => {
        expect(screen.getByText("Ничего не найдено")).toBeInTheDocument();
      });
    });

    it("navigates to /search on submit", async () => {
      renderLayout();
      fireEvent.click(screen.getByRole("button", { name: "Открыть поиск" }));
      fireEvent.change(screen.getByPlaceholderText("Поиск: юзер, g-саб, тред..."), {
        target: { value: "алиса" },
      });
      fireEvent.submit(screen.getByPlaceholderText("Поиск: юзер, g-саб, тред...").closest("form")!);
      expect(mockNavigate).toHaveBeenCalledWith("/search?q=%D0%B0%D0%BB%D0%B8%D1%81%D0%B0");
    });

    it("does not search for queries shorter than 2 chars", async () => {
      renderLayout();
      fireEvent.click(screen.getByRole("button", { name: "Открыть поиск" }));
      fireEvent.change(screen.getByPlaceholderText("Поиск: юзер, g-саб, тред..."), {
        target: { value: "a" },
      });
      expect(mockSearchGlobal).not.toHaveBeenCalled();
    });

    it("closes search on route change", async () => {
      mockSearchGlobal.mockResolvedValue({
        users: [{ id: "u1", username: "alice" }],
        boards: [],
        threads: [],
        posts: [],
      });
      const { rerender } = renderLayout();

      // Open search and wait for real results to appear
      fireEvent.click(screen.getByRole("button", { name: "Открыть поиск" }));
      fireEvent.change(screen.getByPlaceholderText("Поиск: юзер, g-саб, тред..."), {
        target: { value: "ali" },
      });
      await waitFor(() => {
        expect(screen.getByText("@alice")).toBeInTheDocument();
      });

      // Route change on the SAME instance must close the search panel
      mockLocation.pathname = "/new";
      rerender(<AppLayout><div>content</div></AppLayout>);

      expect(screen.queryByText("@alice")).not.toBeInTheDocument();
      expect(screen.queryByText("Ничего не найдено")).not.toBeInTheDocument();
    });
  });

  describe("audio player", () => {
    function makeAudioInstance() {
      return {
        paused: true,
        ended: false,
        muted: false,
        currentTime: 0,
        duration: 100,
        volume: 0.8,
        play: vi.fn().mockResolvedValue(undefined),
        pause: vi.fn(),
        // AppLayout requires a truthy media element to treat the instance as playable
        media: {},
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        on: vi.fn(),
      };
    }

    it("shows the now-playing bar when a track starts", async () => {
      renderLayout();
      const instance = makeAudioInstance();
      fireEvent(window, new CustomEvent("global-audio-play", {
        detail: { playerId: "p1", title: "Мой трек", src: "/audio.mp3", instance },
      }));
      // Title appears both in the bar and in the playlist tooltip
      expect(screen.getAllByText("Мой трек").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByLabelText("Пауза/Воспроизведение")).toBeInTheDocument();
    });

    it("toggles play/pause from the player bar", async () => {
      renderLayout();
      // Playing instance → toggle should pause it
      const instance = { ...makeAudioInstance(), paused: false };
      fireEvent(window, new CustomEvent("global-audio-play", {
        detail: { playerId: "p1", title: "Трек", src: "/a.mp3", instance },
      }));
      fireEvent.click(screen.getByLabelText("Пауза/Воспроизведение"));
      expect(instance.pause).toHaveBeenCalled();
    });

    it("closes the player and stores the hidden state", async () => {
      renderLayout();
      const instance = makeAudioInstance();
      fireEvent(window, new CustomEvent("global-audio-play", {
        detail: { playerId: "p1", title: "Трек", src: "/a.mp3", instance },
      }));
      fireEvent.click(screen.getByLabelText("Закрыть плеер"));
      expect(screen.queryByText("Трек")).not.toBeInTheDocument();
      expect(localStorage.getItem("nowPlayingHidden")).toBe("true");
    });

    it("restores the last track from localStorage on mount", async () => {
      localStorage.setItem("audio-last", JSON.stringify({
        id: "p9",
        title: "Восстановленный",
        src: "/restored.mp3",
        volume: 0.5,
        position: 30,
      }));
      renderLayout();
      await waitFor(() => {
        expect(screen.getAllByText("Восстановленный").length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe("header hide/show on scroll", () => {
    // Drive the captured useMotionValueEvent handler directly.
    function scrollTo(latest: number, previous: number) {
      (globalThis as any).__scrollPrevious = previous;
      const handler = (globalThis as any).__scrollHandler;
      act(() => handler(latest));
    }

    let origInnerHeight = 0;

    beforeEach(() => {
      origInnerHeight = window.innerHeight;
      Object.defineProperty(document.documentElement, "scrollHeight", { value: 3000, configurable: true });
      window.innerHeight = 800;
      renderLayout();
      mockAnimate.mockClear();
    });

    afterEach(() => {
      delete (document.documentElement as any).scrollHeight;
      window.innerHeight = origInnerHeight;
    });

    it("hides the header when scrolling down past the threshold", () => {
      scrollTo(500, 0);
      expect(mockAnimate).toHaveBeenCalledWith(expect.anything(), 0, expect.anything());
    });

    it("shows the header again when scrolling up", () => {
      scrollTo(500, 0); // hide
      mockAnimate.mockClear();
      scrollTo(300, 500); // scroll up
      expect(mockAnimate).toHaveBeenCalledWith(expect.anything(), 1, expect.anything());
    });

    it("keeps the header visible at the top and within the first 120px", () => {
      scrollTo(4, 0); // at top — never hides
      expect(mockAnimate).not.toHaveBeenCalled();
      scrollTo(100, 4); // below the hide threshold
      expect(mockAnimate).not.toHaveBeenCalled();
    });

    it("does not animate the header near the page bottom", () => {
      scrollTo(2999, 0); // near bottom (maxScroll = 2200)
      expect(mockAnimate).not.toHaveBeenCalled();
    });
  });

  describe("messenger chrome", () => {
    it("hides the header when messenger mobile chat is active", async () => {
      renderLayout();
      document.body.classList.add("messenger-mobile-chat-active");
      fireEvent(window, new CustomEvent("gomo6:messenger-mobile-chat"));
      await waitFor(() => {
        expect(screen.queryByTestId("motion-header")).not.toBeInTheDocument();
      });
    });

    it("shows the header when messenger mobile chat is not active", () => {
      renderLayout();
      expect(screen.getByTestId("motion-header")).toBeInTheDocument();
    });
  });
});
