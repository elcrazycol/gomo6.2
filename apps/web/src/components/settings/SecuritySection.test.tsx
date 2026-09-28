import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
import { SecuritySection } from "./SecuritySection";

const mockUpdateUser = vi.fn();

vi.mock("@/integrations/api/compat", () => ({
  api: { auth: { updateUser: (...args: unknown[]) => mockUpdateUser(...args) } },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

// The embedded editors have their own tests — stub them so this one is about
// the password flow and the section chrome.
vi.mock("@/components/TwoFASection", () => ({ TwoFASection: () => <div>2FA-EDITOR</div> }));
vi.mock("@/components/PasskeysSettings", () => ({ PasskeysSettings: () => <div>PASSKEYS-EDITOR</div> }));
vi.mock("@/components/SessionsSettings", () => ({ SessionsSettings: () => <div>SESSIONS-EDITOR</div> }));
vi.mock("@/lib/cookieConsent", () => ({ openCookieSettings: vi.fn() }));

const renderSection = () =>
  render(
    <MemoryRouter>
      <SecuritySection userId="u1" />
    </MemoryRouter>,
  );

const openDialog = async () => {
  await userEvent.click(screen.getByRole("button", { name: /Сменить пароль/ }));
  return screen.getByLabelText("Текущий пароль");
};

const submit = async () => {
  const buttons = screen.getAllByRole("button", { name: /Сменить пароль/ });
  await userEvent.click(buttons[buttons.length - 1]);
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateUser.mockResolvedValue({ error: null });
});

describe("SecuritySection", () => {
  it("gathers password, 2FA, passkeys, sessions and the legal block", () => {
    renderSection();

    expect(screen.getByText("Пароль")).toBeInTheDocument();
    expect(screen.getByText("2FA-EDITOR")).toBeInTheDocument();
    expect(screen.getByText("PASSKEYS-EDITOR")).toBeInTheDocument();
    expect(screen.getByText("SESSIONS-EDITOR")).toBeInTheDocument();
    expect(screen.getByText("Правовая информация")).toBeInTheDocument();
  });

  it("requires every field", async () => {
    renderSection();
    await openDialog();
    await submit();

    expect(toast.error).toHaveBeenCalledWith("Заполните все поля");
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it("rejects mismatched confirmation", async () => {
    renderSection();
    await openDialog();

    await userEvent.type(screen.getByLabelText("Текущий пароль"), "old-pass");
    await userEvent.type(screen.getByLabelText("Новый пароль"), "new-pass-1");
    await userEvent.type(screen.getByLabelText("Подтвердите новый пароль"), "new-pass-2");
    await submit();

    expect(toast.error).toHaveBeenCalledWith("Пароли не совпадают");
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it("rejects a too-short password", async () => {
    renderSection();
    await openDialog();

    await userEvent.type(screen.getByLabelText("Текущий пароль"), "old-pass");
    await userEvent.type(screen.getByLabelText("Новый пароль"), "12345");
    await userEvent.type(screen.getByLabelText("Подтвердите новый пароль"), "12345");
    await submit();

    expect(toast.error).toHaveBeenCalledWith("Пароль должен быть не менее 6 символов");
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it("changes the password and closes the dialog", async () => {
    renderSection();
    await openDialog();

    await userEvent.type(screen.getByLabelText("Текущий пароль"), "old-pass");
    await userEvent.type(screen.getByLabelText("Новый пароль"), "new-pass-123");
    await userEvent.type(screen.getByLabelText("Подтвердите новый пароль"), "new-pass-123");
    await submit();

    await waitFor(() => {
      expect(mockUpdateUser).toHaveBeenCalledWith({ password: "new-pass-123", current_password: "old-pass" });
    });
    expect(toast.success).toHaveBeenCalledWith("Пароль успешно изменён");
  });

  it("reports a failed change with the server message", async () => {
    mockUpdateUser.mockResolvedValue({ error: { message: "Wrong password" } });
    renderSection();
    await openDialog();

    await userEvent.type(screen.getByLabelText("Текущий пароль"), "bad");
    await userEvent.type(screen.getByLabelText("Новый пароль"), "new-pass-123");
    await userEvent.type(screen.getByLabelText("Подтвердите новый пароль"), "new-pass-123");
    await submit();

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Ошибка изменения пароля: Wrong password");
    });
  });
});
