import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, beforeEach, vi } from "vitest";
import AppDetail from "./AppDetail";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockGetSession = vi.fn();

vi.mock("@/integrations/api/client_simple", () => ({
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
    },
  },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// Mock clipboard API
Object.assign(navigator, {
  clipboard: { writeText: vi.fn() },
});

// Mock window.confirm
const mockConfirm = vi.fn();
window.confirm = mockConfirm;

// ─── Fixtures ────────────────────────────────────────────────────────────────

const mockApp = {
  id: "app-1",
  name: "My Test App",
  description: "Test description",
  client_id: "test-client-id-123",
  redirect_uris: ["https://example.com/callback", "http://localhost:3000/callback"],
  allowed_scopes: ["openid", "profile", "email"],
  is_confidential: true,
  logo_url: "",
  homepage_url: "https://example.com",
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-15T00:00:00Z",
};

const mockTokens = [
  {
    id: "tok-1",
    token_id: "tok-abc-def-ghi",
    user_id: "user-123",
    scopes: ["openid", "profile"],
    expires_at: "2027-01-01T00:00:00Z",
    revoked: false,
    created_at: "2026-01-10T00:00:00Z",
  },
];

function setupFetch() {
  global.fetch = vi.fn().mockImplementation((url: RequestInfo | URL) => {
    const urlStr = typeof url === "string" ? url : url.toString();

    if (urlStr.includes("/api/v1/developer/apps/app-1")) {
      if (urlStr.includes("/tokens")) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: mockTokens }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (urlStr.includes("/regenerate-secret")) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: { client_secret: "new-secret-456" } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      // App detail
      return Promise.resolve(
        new Response(JSON.stringify({ data: mockApp }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }

    return Promise.resolve(new Response(null, { status: 404 }));
  });
}

function renderComponent() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/developer/apps/app-1"]}>
        <Routes>
          <Route path="/developer/apps/:id" element={<AppDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AppDetail", () => {
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
    mockConfirm.mockReturnValue(true);
    setupFetch();
  });

  it("shows loading state initially", () => {
    // Delay the session promise so the component stays loading
    mockGetSession.mockReturnValue(new Promise(() => {}));
    renderComponent();
    // PentagramLoader renders an SVG with role="progressbar" — check for container
    const container = document.querySelector(".min-h-\\[50vh\\]");
    expect(container).toBeInTheDocument();
  });

  it("renders app name and description when loaded", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("My Test App")).toBeInTheDocument();
    });
    expect(screen.getByText("Test description")).toBeInTheDocument();
  });

  it("shows active status badge", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Активно")).toBeInTheDocument();
    });
  });

  it("shows inactive status when app is not active", async () => {
    // Override fetch to return inactive app
    global.fetch = vi.fn().mockImplementation((url: RequestInfo | URL) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("/api/v1/developer/apps/app-1") && !urlStr.includes("/tokens")) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: { ...mockApp, is_active: false } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (urlStr.includes("/tokens")) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Неактивно")).toBeInTheDocument();
    });
  });

  it("shows Client ID in credentials tab", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByDisplayValue("test-client-id-123")).toBeInTheDocument();
    });
  });

  it("has regenerate secret button", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Сгенерировать новый")).toBeInTheDocument();
    });
  });

  it("regenerates secret on button click", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Сгенерировать новый")).toBeInTheDocument();
    });

    const regenBtn = screen.getByText("Сгенерировать новый");
    await userEvent.click(regenBtn);

    expect(mockConfirm).toHaveBeenCalled();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("new-secret-456");
  });

  it("shows Redirect URIs in settings tab", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("My Test App")).toBeInTheDocument();
    });

    // Click settings tab
    const settingsTab = screen.getByText("Настройки");
    await userEvent.click(settingsTab);

    await waitFor(() => {
      expect(screen.getByText("https://example.com/callback")).toBeInTheDocument();
      expect(screen.getByText("http://localhost:3000/callback")).toBeInTheDocument();
    });
  });

  it("shows scopes with descriptions in settings tab", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("My Test App")).toBeInTheDocument();
    });

    // Click settings tab
    const settingsTab = screen.getByText("Настройки");
    await userEvent.click(settingsTab);

    await waitFor(() => {
      expect(screen.getByText("openid")).toBeInTheDocument();
      expect(screen.getByText("profile")).toBeInTheDocument();
      expect(screen.getByText("email")).toBeInTheDocument();
    });

    expect(
      screen.getByText("OpenID Connect — идентификация учётной записи"),
    ).toBeInTheDocument();
    expect(screen.getByText("Имя пользователя и аватар")).toBeInTheDocument();
    expect(screen.getByText("Email адрес")).toBeInTheDocument();
  });

  it("shows toggle button for app status", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("My Test App")).toBeInTheDocument();
    });

    const settingsTab = screen.getByText("Настройки");
    await userEvent.click(settingsTab);

    await waitFor(() => {
      expect(screen.getByText("Отключить")).toBeInTheDocument();
    });
  });

  it("shows token count in tab", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Токены (1)")).toBeInTheDocument();
    });
  });

  it("shows 'no tokens' when empty", async () => {
    global.fetch = vi.fn().mockImplementation((url: RequestInfo | URL) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("/api/v1/developer/apps/app-1") && !urlStr.includes("/tokens")) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: mockApp }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (urlStr.includes("/tokens")) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Токены (0)")).toBeInTheDocument();
    });

    // Click tokens tab
    const tokensTab = screen.getByText("Токены (0)");
    await userEvent.click(tokensTab);

    await waitFor(() => {
      expect(screen.getByText("Нет активных токенов")).toBeInTheDocument();
    });
  });

  it("shows token details in tokens tab", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("My Test App")).toBeInTheDocument();
    });

    // Click tokens tab
    const tokensTab = screen.getByText("Токены (1)");
    await userEvent.click(tokensTab);

    await waitFor(() => {
      expect(screen.getByText(/ID: tok-abc-def-ghi/)).toBeInTheDocument();
      expect(screen.getByText(/User: user-123/)).toBeInTheDocument();
    });
  });

  it("navigates back when app not found", async () => {
    global.fetch = vi.fn().mockImplementation((url: RequestInfo | URL) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("/tokens")) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ error: "not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Приложение не найдено")).toBeInTheDocument();
    });
  });
});
