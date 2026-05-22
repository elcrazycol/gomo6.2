import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, beforeEach, vi } from "vitest";
import OAuthConsent from "./OAuthConsent";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockGetSession = vi.fn();
const mockGetUser = vi.fn();

vi.mock("@/integrations/api/client_simple", () => ({
  supabase: {
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

const mockAppInfo = {
  client_id: "app-1",
  name: "Test App",
  description: "A test OAuth application",
  logo_url: "",
  homepage_url: "https://example.com",
  allowed_scopes: ["openid", "profile", "email"],
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
      return Promise.resolve(
        new Response(JSON.stringify({ id: "user-1", username: "testuser" }), {
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
    // Mock window.location.href for the redirect
    delete (window as any).location;
    delete (window as any).location;
    window.location = { href: "", assign: vi.fn() } as any;

    renderComponent("?client_id=app-1");

    await waitFor(() => {
      expect(window.location.href).toContain("/auth?redirect=");
    });
  });

  it("shows error card when app info fails to load", async () => {      global.fetch = vi.fn().mockImplementation((url: RequestInfo | URL) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("/api/v1/auth/me")) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: "user-1", username: "testuser" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
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
      expect(screen.getByText("example.com")).toBeInTheDocument();
    });
  });

  it("shows user info when logged in", async () => {
    renderComponent("?client_id=app-1");

    await waitFor(() => {
      expect(screen.getByText("testuser")).toBeInTheDocument();
    });
    expect(screen.getByText("Вы вошли как этот пользователь")).toBeInTheDocument();
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
});
