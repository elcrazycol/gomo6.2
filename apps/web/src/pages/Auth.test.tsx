import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { toast } from "sonner";
import Auth from "./Auth";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  );
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// WebSocket — dynamic import in Auth.tsx
vi.mock("@/services/websocket", () => ({
  wsService: {
    disconnect: vi.fn().mockResolvedValue(undefined),
    connect: vi.fn().mockResolvedValue(undefined),
  },
}));

// ─── Auth API mocks ──────────────────────────────────────────────────────────

const mockSignIn = vi.fn();
const mockSignUp = vi.fn();
const mockGetSession = vi.fn();
const mockVerify2FA = vi.fn();

vi.mock("@/integrations/api/compat", () => ({
  api: {
    auth: {
      signInWithPassword: (...args: any[]) => mockSignIn(...args),
      signUp: (...args: any[]) => mockSignUp(...args),
      getSession: (...args: any[]) => mockGetSession(...args),
      verify2FA: (...args: any[]) => mockVerify2FA(...args),
    },
    from: () => ({
      insert: () => ({
        select: () => ({ single: vi.fn().mockResolvedValue({ data: null, error: null }) }),
      }),
    }),
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderComponent() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/auth"]}>
        <Auth />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Auth Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // Default: not logged in
    mockGetSession.mockResolvedValue({ data: { session: null } });
  });

  // ─── Initial state ──────────────────────────────────────────────────────────

  it("redirects to / if already logged in", async () => {
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          user: { id: "user-1" },
          access_token: "token-1",
        },
      },
    });

    renderComponent();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/");
    });
  });

  it("shows login form by default", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Вход")).toBeInTheDocument();
    });
    expect(screen.getByText("Войти")).toBeInTheDocument();
    expect(screen.getByLabelText("Юзернейм")).toBeInTheDocument();
    expect(screen.getByLabelText("Пароль")).toBeInTheDocument();
    // Terms checkbox should NOT be visible in login mode
    expect(screen.queryByText(/пользовательским соглашением/)).not.toBeInTheDocument();
  });

  it("switches to register form and shows terms checkbox", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Вход")).toBeInTheDocument();
    });

    const toggleBtn = screen.getByText("Нет аккаунта? Регистрация");
    await userEvent.click(toggleBtn);

    await waitFor(() => {
      expect(screen.getByText("Регистрация")).toBeInTheDocument();
    });
    expect(screen.getByText("Зарегистрироваться")).toBeInTheDocument();
    // Terms checkbox should now be visible
    expect(screen.getByText(/пользовательским соглашением GOMO6/)).toBeInTheDocument();
  });

  it("can switch back to login from register", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Вход")).toBeInTheDocument();
    });

    // Switch to register
    await userEvent.click(screen.getByText("Нет аккаунта? Регистрация"));
    await waitFor(() => {
      expect(screen.getByText("Регистрация")).toBeInTheDocument();
    });

    // Switch back to login
    await userEvent.click(screen.getByText("Уже есть аккаунт? Вход"));
    expect(screen.getByText("Вход")).toBeInTheDocument();
  });

  // ─── Login validation ───────────────────────────────────────────────────────

  it("validates username min length (3 chars) on login", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Вход")).toBeInTheDocument();
    });

    const usernameInput = screen.getByLabelText("Юзернейм");
    const passwordInput = screen.getByLabelText("Пароль");
    const submitBtn = screen.getByText("Войти");

    await userEvent.type(usernameInput, "ab");
    await userEvent.type(passwordInput, "123456");
    await userEvent.click(submitBtn);

    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("минимум 3"),
    );
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it("validates password min length (6 chars) on login", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Вход")).toBeInTheDocument();
    });

    const usernameInput = screen.getByLabelText("Юзернейм");
    const passwordInput = screen.getByLabelText("Пароль");
    const submitBtn = screen.getByText("Войти");

    await userEvent.type(usernameInput, "validuser");
    await userEvent.type(passwordInput, "12345");
    await userEvent.click(submitBtn);

    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("минимум 6"),
    );
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  // ─── Successful login ───────────────────────────────────────────────────────

  it("logs in successfully with valid credentials", async () => {
    mockSignIn.mockResolvedValue({
      data: {
        user: { id: "user-1", username: "testuser" },
        session: { access_token: "token-1" },
      },
      error: null,
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Вход")).toBeInTheDocument();
    });

    const usernameInput = screen.getByLabelText("Юзернейм");
    const passwordInput = screen.getByLabelText("Пароль");
    const submitBtn = screen.getByText("Войти");

    await userEvent.type(usernameInput, "testuser");
    await userEvent.type(passwordInput, "secret123");
    await userEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalledWith({
        email: "testuser@gomo6.local",
        password: "secret123",
      });
      expect(mockNavigate).toHaveBeenCalledWith("/");
    });

    expect(toast.success).toHaveBeenCalledWith("Вход выполнен");
  });

  it("shows error toast on invalid login credentials", async () => {
    mockSignIn.mockResolvedValue({
      data: null,
      error: { message: "Invalid login credentials" },
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Вход")).toBeInTheDocument();
    });

    await userEvent.type(screen.getByLabelText("Юзернейм"), "testuser");
    await userEvent.type(screen.getByLabelText("Пароль"), "wrongpass");
    await userEvent.click(screen.getByText("Войти"));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Неверный логин или пароль");
    });
  });

  // ─── Registration ───────────────────────────────────────────────────────────

  it("disables register button when terms not agreed", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Вход")).toBeInTheDocument();
    });

    // Switch to register
    await userEvent.click(screen.getByText("Нет аккаунта? Регистрация"));

    await waitFor(() => {
      expect(screen.getByText("Регистрация")).toBeInTheDocument();
    });

    // Submit button should be disabled because terms are not agreed
    expect(screen.getByText("Зарегистрироваться")).toBeDisabled();
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it("registers successfully with terms agreed", async () => {
    mockSignUp.mockResolvedValue({
      data: {
        user: { id: "user-1", username: "newuser" },
        session: { access_token: "token-1" },
      },
      error: null,
    });
    // For the getSession call after registration
    mockGetSession
      .mockResolvedValueOnce({ data: { session: null } }) // initial checkSession
      .mockResolvedValueOnce({
        data: {
          session: {
            user: { id: "user-1" },
            access_token: "token-1",
          },
        },
      }); // after registration

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Вход")).toBeInTheDocument();
    });

    // Switch to register
    await userEvent.click(screen.getByText("Нет аккаунта? Регистрация"));

    // Fill form
    await userEvent.type(screen.getByLabelText("Юзернейм"), "newuser");
    await userEvent.type(screen.getByLabelText("Пароль"), "secret123");

    // Agree to terms
    const termsCheckbox = screen.getByRole("checkbox", { name: /Вы согласны/ });
    await userEvent.click(termsCheckbox);

    // Submit
    await userEvent.click(screen.getByText("Зарегистрироваться"));

    await waitFor(() => {
      expect(mockSignUp).toHaveBeenCalledWith({
        email: "newuser@gomo6.local",
        password: "secret123",
        options: {
          data: { username: "newuser" },
          emailRedirectTo: `${window.location.origin}/`,
        },
      });
    });

    expect(toast.success).toHaveBeenCalledWith(
      "Регистрация успешна! Можете войти.",
    );
    // Should switch back to login mode
    expect(screen.getByText("Войти")).toBeInTheDocument();
  });

  it("shows error on duplicate username during registration", async () => {
    mockSignUp.mockResolvedValue({
      data: null,
      error: { message: "already registered" },
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Вход")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Нет аккаунта? Регистрация"));
    await userEvent.type(screen.getByLabelText("Юзернейм"), "existing");
    await userEvent.type(screen.getByLabelText("Пароль"), "secret123");
    await userEvent.click(screen.getByRole("checkbox", { name: /Вы согласны/ }));
    await userEvent.click(screen.getByText("Зарегистрироваться"));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Этот юзернейм уже занят");
    });
  });

  // ─── 2FA ────────────────────────────────────────────────────────────────────

  it("shows 2FA form when needs_2fa is returned during login", async () => {
    mockSignIn.mockResolvedValue({
      data: {
        user: { id: "user-1", username: "testuser" },
        session: { access_token: "partial-token", needs_2fa: true },
      },
      error: null,
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Вход")).toBeInTheDocument();
    });

    await userEvent.type(screen.getByLabelText("Юзернейм"), "testuser");
    await userEvent.type(screen.getByLabelText("Пароль"), "secret123");
    await userEvent.click(screen.getByText("Войти"));

    await waitFor(() => {
      expect(
        screen.getByText("Двухфакторная аутентификация"),
      ).toBeInTheDocument();
      expect(screen.getByText("Подтверждение входа")).toBeInTheDocument();
    });
  });

  it("submits 2FA code and navigates to / on success", async () => {
    // Login triggers 2FA
    mockSignIn.mockResolvedValue({
      data: {
        user: { id: "user-1", username: "testuser" },
        session: { access_token: "partial-token", needs_2fa: true },
      },
      error: null,
    });

    // 2FA verification succeeds
    mockVerify2FA.mockResolvedValue({
      data: { session: { access_token: "full-token" } },
      error: null,
    });

    renderComponent();

    // First login
    await waitFor(() => {
      expect(screen.getByText("Вход")).toBeInTheDocument();
    });

    await userEvent.type(screen.getByLabelText("Юзернейм"), "testuser");
    await userEvent.type(screen.getByLabelText("Пароль"), "secret123");
    await userEvent.click(screen.getByText("Войти"));

    // Wait for 2FA form
    await waitFor(() => {
      expect(screen.getByText("Подтверждение входа")).toBeInTheDocument();
    });

    // Enter 2FA code
    const codeInput = screen.getByLabelText("Код из аутентификатора");
    await userEvent.type(codeInput, "123456");

    await userEvent.click(screen.getByText("Подтвердить"));

    await waitFor(() => {
      expect(mockVerify2FA).toHaveBeenCalledWith(
        "partial-token",
        "123456",
        false, // trustDevice defaults to false
      );
      expect(mockNavigate).toHaveBeenCalledWith("/");
    });
  });

  it("shows error toast on invalid 2FA code", async () => {
    mockSignIn.mockResolvedValue({
      data: {
        user: { id: "user-1" },
        session: { access_token: "partial-token", needs_2fa: true },
      },
      error: null,
    });

    mockVerify2FA.mockResolvedValue({
      data: null,
      error: { message: "Invalid 2FA code" },
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Вход")).toBeInTheDocument();
    });

    await userEvent.type(screen.getByLabelText("Юзернейм"), "testuser");
    await userEvent.type(screen.getByLabelText("Пароль"), "secret123");
    await userEvent.click(screen.getByText("Войти"));

    await waitFor(() => {
      expect(screen.getByText("Подтверждение входа")).toBeInTheDocument();
    });

    await userEvent.type(screen.getByLabelText("Код из аутентификатора"), "000000");
    await userEvent.click(screen.getByText("Подтвердить"));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Неверный код 2FA");
    });
  });

  it("goes back to login from 2FA form", async () => {
    mockSignIn.mockResolvedValue({
      data: {
        user: { id: "user-1" },
        session: { access_token: "partial-token", needs_2fa: true },
      },
      error: null,
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Вход")).toBeInTheDocument();
    });

    await userEvent.type(screen.getByLabelText("Юзернейм"), "testuser");
    await userEvent.type(screen.getByLabelText("Пароль"), "secret123");
    await userEvent.click(screen.getByText("Войти"));

    await waitFor(() => {
      expect(screen.getByText("Подтверждение входа")).toBeInTheDocument();
    });

    // Go back
    await userEvent.click(screen.getByText("Назад к входу"));

    // Should see login form again
    await waitFor(() => {
      expect(screen.getByText("Вход")).toBeInTheDocument();
    });
    expect(screen.getByText("Войти")).toBeInTheDocument();
  });

  // ─── Terms of Service dialog ────────────────────────────────────────────────

  it("opens TermsOfService dialog and accepts terms", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Вход")).toBeInTheDocument();
    });

    // Switch to register
    await userEvent.click(screen.getByText("Нет аккаунта? Регистрация"));

    // Click terms link
    await userEvent.click(screen.getByText("пользовательским соглашением GOMO6"));

    // Dialog should open
    await waitFor(() => {
      expect(
        screen.getByText("Пользовательское соглашение GOMO6"),
      ).toBeInTheDocument();
    });

    // Accept terms
    await userEvent.click(screen.getByText("Согласен"));

    // Dialog should close and checkbox should be checked
    await waitFor(() => {
      expect(
        screen.queryByText("Пользовательское соглашение GOMO6"),
      ).not.toBeInTheDocument();
    });

    // Submit button should be enabled now
    expect(screen.getByText("Зарегистрироваться")).not.toBeDisabled();
  });

  it("declines terms and closes TermsOfService dialog", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Вход")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Нет аккаунта? Регистрация"));
    await userEvent.click(screen.getByText("пользовательским соглашением GOMO6"));

    await waitFor(() => {
      expect(
        screen.getByText("Пользовательское соглашение GOMO6"),
      ).toBeInTheDocument();
    });

    // Decline
    await userEvent.click(screen.getByText("Покинуть сайт"));

    // Dialog should close
    await waitFor(() => {
      expect(
        screen.queryByText("Пользовательское соглашение GOMO6"),
      ).not.toBeInTheDocument();
    });

    // Checkbox should NOT be checked (declined)
    expect(screen.getByText("Зарегистрироваться")).toBeDisabled();
  });

  // ─── Submit button states ───────────────────────────────────────────────────

  it("disables submit button when loading", async () => {
    // Don't resolve signIn to simulate loading
    mockSignIn.mockReturnValue(new Promise(() => {}));

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Вход")).toBeInTheDocument();
    });

    await userEvent.type(screen.getByLabelText("Юзернейм"), "testuser");
    await userEvent.type(screen.getByLabelText("Пароль"), "secret123");
    await userEvent.click(screen.getByText("Войти"));

    expect(screen.getByText("Загрузка...")).toBeInTheDocument();
    expect(screen.getByText("Загрузка...")).toBeDisabled();
  });
});
