import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, beforeEach, vi } from "vitest";
import OAuthConsent from "./OAuthConsent";

const { mockNavigate } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
}));
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockGetSession = vi.fn();
const mockGetUser = vi.fn();

vi.mock("@/integrations/api/compat", () => ({
  api: {
    auth: {
      getSession: () => mockGetSession(),
      getUser: () => mockGetUser(),
    },
  },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface MockAppInfo {
  client_id: string;
  name: string;
  description: string;
  logo_url: string;
  homepage_url: string;
  allowed_scopes: string[];
  redirect_uris?: string[];
  scope_descriptions: Record<string, string>;
  scope_labels: Record<string, string>;
}

const mockAppInfo: MockAppInfo = {
  client_id: "app-1",
  name: "Test App",
  description: "A test OAuth application",
  logo_url: "",
  homepage_url: "https://example.com",
  allowed_scopes: ["openid", "profile", "email"],
  redirect_uris: ["https://example.com/callback"],
  scope_descriptions: {
    openid: "Идентификация вашей учётной записи (OpenID Connect)",
    profile: "Чтение вашего имени пользователя и аватара",
    email: "Чтение вашего email адреса",
    offline_access: "Обновление токенов в фоне (offline access)",
  },
  scope_labels: {
    openid: "OpenID Connect (аутентификация)",
    profile: "Имя пользователя и аватар",
    email: "Email адрес",
    offline_access: "Offline доступ",
  },
};

function setupFetch() {
  global.fetch = vi.fn().mockImplementation((url: RequestInfo | URL) => {
    const urlStr = typeof url === "string" ? url : url.toString();
    if (urlStr.includes("/api/v1/auth/me")) {
      // The backend wraps the profile in the unified { success, data } envelope.
      return Promise.resolve(
        new Response(
          JSON.stringify({ success: true, data: { id: "user-1", username: "testuser" } }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
    }
    if (urlStr.includes("/oauth/app-info")) {
      return Promise.resolve(
        new Response(JSON.stringify(mockAppInfo), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    if (urlStr.includes("/oauth/authorize")) {
      return Promise.resolve(
        new Response(JSON.stringify({ redirect_url: "https://example.com/callback?code=abc123" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  });
}

function renderComponent(searchParams = "") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const route = `/oauth/consent${searchParams}`;
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <OAuthConsent />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("OAuthConsent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppInfo.redirect_uris = ["https://example.com/callback"];
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          user: { id: "user-1", email: "test@example.com" },
          access_token: "token-123",
        },
      },
    });
    mockGetUser.mockResolvedValue({
      data: { user: { user_metadata: { username: "testuser" } } },
    });
    setupFetch();
  });

  it("shows loading state while checking session", () => {
    // Don't resolve the session promise yet — component stays loading
    mockGetSession.mockReturnValue(new Promise(() => {}));
    renderComponent("?client_id=app-1");
    expect(screen.getByText("Загрузка...")).toBeInTheDocument();
  });

  it("redirects to /auth when not logged in", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });

    renderComponent("?client_id=app-1");

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        expect.stringContaining("/auth?redirect=")
      );
    });
  });

  it("shows error card when app info fails to load", async () => {      global.fetch = vi.fn().mockImplementation((url: RequestInfo | URL) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("/api/v1/auth/me")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ success: true, data: { id: "user-1", username: "testuser" } }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      }
      // App info fails
      return Promise.reject(new Error("Network error"));
    });
    delete (window as any).location;
    window.location = { href: "", assign: vi.fn() } as any;

    renderComponent("?client_id=app-1");

    await waitFor(() => {
      expect(screen.getByText("Приложение не найдено")).toBeInTheDocument();
    });
  });

  it("renders app name and description when loaded", async () => {
    renderComponent("?client_id=app-1");

    await waitFor(() => {
      expect(screen.getByText("Test App")).toBeInTheDocument();
    });
    expect(screen.getByText("A test OAuth application")).toBeInTheDocument();
    expect(screen.getByText("example.com")).toBeInTheDocument();
  });

  it("shows scope cards with labels and descriptions", async () => {
    renderComponent("?client_id=app-1&scope=openid+profile+email");

    await waitFor(() => {
      expect(screen.getByText("Test App")).toBeInTheDocument();
    });

    // Scope labels
    expect(screen.getByText("OpenID Connect (аутентификация)")).toBeInTheDocument();
    expect(screen.getByText("Имя пользователя и аватар")).toBeInTheDocument();
    expect(screen.getByText("Email адрес")).toBeInTheDocument();

    // Scope descriptions
    expect(
      screen.getByText("Идентификация вашей учётной записи (OpenID Connect)"),
    ).toBeInTheDocument();
    expect(screen.getByText("Чтение вашего имени пользователя и аватара")).toBeInTheDocument();
    expect(screen.getByText("Чтение вашего email адреса")).toBeInTheDocument();
  });

  it('shows "Базовый доступ" when no scopes requested', async () => {
    renderComponent("?client_id=app-1");

    await waitFor(() => {
      expect(screen.getByText("Test App")).toBeInTheDocument();
    });

    expect(
      screen.getByText("Базовый доступ (только аутентификация)"),
    ).toBeInTheDocument();
  });

  it("shows redirect host when redirect_uri is provided", async () => {
    renderComponent(
      "?client_id=app-1&redirect_uri=https://example.com/callback",
    );

    await waitFor(() => {
      expect(screen.getByText(/Будет перенаправлено на/)).toBeInTheDocument();
      expect(screen.getAllByText("example.com").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("warns when requested redirect_uri is not registered", async () => {
    mockAppInfo.redirect_uris = ["https://other.example.com/callback"];

    renderComponent(
      "?client_id=app-1&redirect_uri=https://gomo6.wtf/oauth2/callback/generic",
    );

    await waitFor(() => {
      expect(
        screen.getByText(/Запрошенный redirect URI не зарегистрирован/),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/Зарегистрированные redirect URI/)).toBeInTheDocument();
    expect(
      screen.getByText("https://other.example.com/callback"),
    ).toBeInTheDocument();
    // The requested (non-registered) URI is shown too
    expect(
      screen.getByText("https://gomo6.wtf/oauth2/callback/generic"),
    ).toBeInTheDocument();

    mockAppInfo.redirect_uris = ["https://example.com/callback"];
  });

  it("shows user info when logged in", async () => {
    renderComponent("?client_id=app-1");

    await waitFor(() => {
      expect(screen.getByText("testuser")).toBeInTheDocument();
    });
    expect(screen.getByText("Вы вошли как этот пользователь")).toBeInTheDocument();
  });

  it("falls back to the session username when /me lacks a username", async () => {
    global.fetch = vi.fn().mockImplementation((url: RequestInfo | URL) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("/api/v1/auth/me")) {
        return Promise.resolve(
          new Response(JSON.stringify({ success: true, data: { id: "user-1" } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (urlStr.includes("/oauth/app-info")) {
        return Promise.resolve(
          new Response(JSON.stringify(mockAppInfo), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    // Session user carries the real nickname; /me returns no username.
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          user: { id: "user-1", username: "lesha", email: "" },
          access_token: "token-123",
        },
      },
    });

    renderComponent("?client_id=app-1");

    await waitFor(() => {
      expect(screen.getByText("lesha")).toBeInTheDocument();
    });
  });

  it("calls /oauth/authorize on Allow and redirects", async () => {
    renderComponent("?client_id=app-1&scope=openid&redirect_uri=https://example.com/callback");

    await waitFor(() => {
      expect(screen.getByText("Test App")).toBeInTheDocument();
    });

    const allowBtn = screen.getByText("Разрешить");
    await userEvent.click(allowBtn);

    await waitFor(() => {
      expect(window.location.href).toBe("https://example.com/callback?code=abc123");
    });
  });

  it("redirects with error on Deny when redirect_uri is provided", async () => {
    renderComponent(
      "?client_id=app-1&state=xyz&redirect_uri=https://example.com/callback",
    );

    await waitFor(() => {
      expect(screen.getByText("Test App")).toBeInTheDocument();
    });

    const denyBtn = screen.getByText("Отказаться");
    await userEvent.click(denyBtn);

    expect(window.location.href).toContain("https://example.com/callback?error=access_denied");
    expect(window.location.href).toContain("state=xyz");
  });

  it("preserves existing query parameters when denying", async () => {
    mockAppInfo.redirect_uris = ["https://example.com/callback?tenant=demo"];

    renderComponent(
      "?client_id=app-1&state=xyz&redirect_uri=https://example.com/callback%3Ftenant%3Ddemo",
    );

    await waitFor(() => {
      expect(screen.getByText("Test App")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Отказаться"));

    expect(window.location.href).toContain("https://example.com/callback?tenant=demo");
    expect(window.location.href).toContain("error=access_denied");
    expect(window.location.href).toContain("state=xyz");

    mockAppInfo.redirect_uris = ["https://example.com/callback"];
  });

  it("does not redirect to an unregistered URI on Deny", async () => {
    renderComponent(
      "?client_id=app-1&redirect_uri=https://attacker.example/callback",
    );

    await waitFor(() => {
      expect(screen.getByText("Test App")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Отказаться"));

    expect(mockNavigate).toHaveBeenCalledWith("/");
    expect(window.location.href).not.toContain("attacker.example");
  });
});
