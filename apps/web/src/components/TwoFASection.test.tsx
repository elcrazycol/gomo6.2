import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { toast } from "sonner";
import TwoFASection from "./TwoFASection";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockGet2FAStatus = vi.fn();
const mockSetupTOTP = vi.fn();
const mockVerifyAndEnableTOTP = vi.fn();
const mockDisableTOTP = vi.fn();

vi.mock("@/integrations/api/compat", () => ({
  api: {
    auth: {
      get2FAStatus: (...args: any[]) => mockGet2FAStatus(...args),
      setupTOTP: (...args: any[]) => mockSetupTOTP(...args),
      verifyAndEnableTOTP: (...args: any[]) => mockVerifyAndEnableTOTP(...args),
      disableTOTP: (...args: any[]) => mockDisableTOTP(...args),
    },
  },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderComponent(userId = "user-1") {
  return render(<TwoFASection userId={userId} />);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("TwoFASection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: 2FA disabled, no pending secret
    mockGet2FAStatus.mockResolvedValue({
      data: { enabled: false, has_pending_secret: false },
      error: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as any).confirm;
    delete (navigator as any).clipboard;
  });

  // ─── Loading state ──────────────────────────────────────────────────────────

  it("shows loading state initially while fetching 2FA status", () => {
    // Don't resolve the promise to keep loading
    mockGet2FAStatus.mockReturnValue(new Promise(() => {}));

    renderComponent();

    expect(screen.getByText("Загрузка статуса 2FA...")).toBeInTheDocument();
  });

  // ─── Main state: disabled ───────────────────────────────────────────────────

  it("shows disabled state when 2FA is off", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("❌ 2FA отключена")).toBeInTheDocument();
    });
    expect(
      screen.getByText("Добавьте дополнительный уровень защиты"),
    ).toBeInTheDocument();
    expect(screen.getByText("Включить 2FA")).toBeInTheDocument();
    expect(screen.getByText("Включить 2FA")).not.toBeDisabled();
  });

  // ─── Main state: enabled ────────────────────────────────────────────────────

  it("shows enabled state when 2FA is on", async () => {
    mockGet2FAStatus.mockResolvedValue({
      data: { enabled: true, has_pending_secret: false },
      error: null,
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("✅ 2FA включена")).toBeInTheDocument();
    });
    expect(
      screen.getByText("При входе потребуется код из аутентификатора"),
    ).toBeInTheDocument();
    expect(screen.getByText("Отключить")).toBeInTheDocument();
  });

  // ─── Load status error ──────────────────────────────────────────────────────

  it("handles error when loading 2FA status gracefully", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGet2FAStatus.mockResolvedValue({
      data: null,
      error: { message: "Network error" },
    });

    renderComponent();

    await waitFor(() => {
      // Should show the main UI (not loading), default to disabled
      expect(screen.getByText("❌ 2FA отключена")).toBeInTheDocument();
    });
    expect(consoleSpy).toHaveBeenCalledWith(
      "Failed to load 2FA status:",
      expect.objectContaining({ message: "Network error" }),
    );
    consoleSpy.mockRestore();
  });

  // ─── Setup flow ─────────────────────────────────────────────────────────────

  it("opens setup UI when 'Включить 2FA' is clicked", async () => {
    mockSetupTOTP.mockResolvedValue({
      data: {
        secret: "JBSWY3DPEHPK3PXP",
        uri: "otpauth://totp/gomo6:testuser?secret=JBSWY3DPEHPK3PXP",
      },
      error: null,
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Включить 2FA")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Включить 2FA"));

    await waitFor(() => {
      expect(screen.getByText("Настройка 2FA")).toBeInTheDocument();
    });

    // Should show QR code
    const qrImg = screen.getByAltText("QR Code for 2FA");
    expect(qrImg).toBeInTheDocument();
    expect(qrImg).toHaveAttribute(
      "src",
      expect.stringContaining(encodeURIComponent("otpauth://totp/gomo6:testuser?secret=JBSWY3DPEHPK3PXP")),
    );

    // Should show secret key
    const secretInput = screen.getByDisplayValue("JBSWY3DPEHPK3PXP");
    expect(secretInput).toBeInTheDocument();

    // Should show verify input
    expect(
      screen.getByLabelText(/Введите 6-значный код из аутентификатора/),
    ).toBeInTheDocument();
    expect(screen.getByText("Подтвердить")).toBeInTheDocument();
  });

  it("shows error toast when setupTOTP fails", async () => {
    mockSetupTOTP.mockResolvedValue({
      data: null,
      error: { message: "Already enabled" },
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Включить 2FA")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Включить 2FA"));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Ошибка настройки 2FA: Already enabled",
      );
    });
  });

  // ─── Verify flow ────────────────────────────────────────────────────────────

  it("verifies 2FA code and shows recovery codes on success", async () => {
    // Step 1: Setup
    mockSetupTOTP.mockResolvedValue({
      data: {
        secret: "JBSWY3DPEHPK3PXP",
        uri: "otpauth://totp/gomo6:testuser?secret=JBSWY3DPEHPK3PXP",
      },
      error: null,
    });
    // Step 2: Verify
    mockVerifyAndEnableTOTP.mockResolvedValue({
      data: {
        enabled: true,
        recovery_codes: ["AAAA-BBBB", "CCCC-DDDD", "EEEE-FFFF"],
      },
      error: null,
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Включить 2FA")).toBeInTheDocument();
    });

    // Start setup
    await userEvent.click(screen.getByText("Включить 2FA"));

    await waitFor(() => {
      expect(screen.getByText("Настройка 2FA")).toBeInTheDocument();
    });

    // Enter verify code
    const codeInput = screen.getByLabelText(
      /Введите 6-значный код из аутентификатора/,
    );
    await userEvent.type(codeInput, "123456");

    await userEvent.click(screen.getByText("Подтвердить"));

    // Should show recovery codes
    await waitFor(() => {
      expect(
        screen.getByText("⚠️ Сохраните коды восстановления!"),
      ).toBeInTheDocument();
    });

    expect(screen.getByText("AAAA-BBBB")).toBeInTheDocument();
    expect(screen.getByText("CCCC-DDDD")).toBeInTheDocument();
    expect(screen.getByText("EEEE-FFFF")).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith("2FA успешно включена!");
  });

  it("validates verify code minimum length (6 chars)", async () => {
    mockSetupTOTP.mockResolvedValue({
      data: {
        secret: "JBSWY3DPEHPK3PXP",
        uri: "otpauth://totp/gomo6:testuser?secret=JBSWY3DPEHPK3PXP",
      },
      error: null,
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Включить 2FA")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Включить 2FA"));

    await waitFor(() => {
      expect(screen.getByText("Настройка 2FA")).toBeInTheDocument();
    });

    // Enter only 5 digits
    const codeInput = screen.getByLabelText(
      /Введите 6-значный код из аутентификатора/,
    );
    await userEvent.type(codeInput, "12345");

    // Button should be disabled
    expect(screen.getByText("Подтвердить")).toBeDisabled();

    // The handleVerifyAndEnable won't even be called because button is disabled
    // Let's try to programmatically trigger it by adding the 6th digit
    await userEvent.type(codeInput, "6");

    // Now button should be enabled
    expect(screen.getByText("Подтвердить")).not.toBeDisabled();
  });

  it("shows 'Проверка...' loading on verify button while verifying", async () => {
    mockSetupTOTP.mockResolvedValue({
      data: {
        secret: "SECRET",
        uri: "otpauth://totp/gomo6:testuser?secret=SECRET",
      },
      error: null,
    });
    // Don't resolve verify promise to keep verifying state
    mockVerifyAndEnableTOTP.mockReturnValue(new Promise(() => {}));

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Включить 2FA")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Включить 2FA"));

    await waitFor(() => {
      expect(screen.getByText("Настройка 2FA")).toBeInTheDocument();
    });

    const codeInput = screen.getByLabelText(
      /Введите 6-значный код из аутентификатора/,
    );
    await userEvent.type(codeInput, "123456");
    await userEvent.click(screen.getByText("Подтвердить"));

    expect(screen.getByText("Проверка...")).toBeInTheDocument();
    expect(screen.getByText("Проверка...")).toBeDisabled();
  });

  it("shows error toast on verify failure", async () => {
    mockSetupTOTP.mockResolvedValue({
      data: {
        secret: "JBSWY3DPEHPK3PXP",
        uri: "otpauth://totp/gomo6:testuser?secret=JBSWY3DPEHPK3PXP",
      },
      error: null,
    });
    mockVerifyAndEnableTOTP.mockResolvedValue({
      data: null,
      error: { message: "Invalid code" },
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Включить 2FA")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Включить 2FA"));

    await waitFor(() => {
      expect(screen.getByText("Настройка 2FA")).toBeInTheDocument();
    });

    const codeInput = screen.getByLabelText(
      /Введите 6-значный код из аутентификатора/,
    );
    await userEvent.type(codeInput, "000000");
    await userEvent.click(screen.getByText("Подтвердить"));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Неверный код. Попробуйте снова.",
      );
    });
  });

  // ─── Secret key copy ────────────────────────────────────────────────────────

  it("copies secret key to clipboard when clicked and shows toast", async () => {
    // Set up clipboard mock for this test
    (navigator as any).clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };

    mockSetupTOTP.mockResolvedValue({
      data: {
        secret: "JBSWY3DPEHPK3PXP",
        uri: "otpauth://totp/gomo6:testuser?secret=JBSWY3DPEHPK3PXP",
      },
      error: null,
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Включить 2FA")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Включить 2FA"));

    await waitFor(() => {
      expect(screen.getByText("Настройка 2FA")).toBeInTheDocument();
    });

    // Click the secret key input
    const secretInput = screen.getByDisplayValue("JBSWY3DPEHPK3PXP");
    await userEvent.click(secretInput);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("JBSWY3DPEHPK3PXP");
    expect(toast.success).toHaveBeenCalledWith("Секрет скопирован");
  });

  // ─── Recovery codes: copy all ───────────────────────────────────────────────

  it("copies all recovery codes to clipboard", async () => {
    (navigator as any).clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };

    mockSetupTOTP.mockResolvedValue({
      data: {
        secret: "SECRET",
        uri: "otpauth://totp/gomo6:testuser?secret=SECRET",
      },
      error: null,
    });
    mockVerifyAndEnableTOTP.mockResolvedValue({
      data: {
        enabled: true,
        recovery_codes: ["CODE-1", "CODE-2"],
      },
      error: null,
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Включить 2FA")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Включить 2FA"));
    await waitFor(() => {
      expect(screen.getByText("Настройка 2FA")).toBeInTheDocument();
    });

    const codeInput = screen.getByLabelText(
      /Введите 6-значный код из аутентификатора/,
    );
    await userEvent.type(codeInput, "123456");
    await userEvent.click(screen.getByText("Подтвердить"));

    await waitFor(() => {
      expect(
        screen.getByText("⚠️ Сохраните коды восстановления!"),
      ).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Скопировать все"));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("CODE-1\nCODE-2");
    expect(toast.success).toHaveBeenCalledWith(
      "Коды скопированы в буфер обмена",
    );
  });

  // ─── Recovery codes: close ──────────────────────────────────────────────────

  it("closes recovery codes view and shows enabled state", async () => {
    mockSetupTOTP.mockResolvedValue({
      data: {
        secret: "SECRET",
        uri: "otpauth://totp/gomo6:testuser?secret=SECRET",
      },
      error: null,
    });
    mockVerifyAndEnableTOTP.mockResolvedValue({
      data: {
        enabled: true,
        recovery_codes: ["CODE-1"],
      },
      error: null,
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Включить 2FA")).toBeInTheDocument();
    });

    // Full flow: setup → verify → recovery codes
    await userEvent.click(screen.getByText("Включить 2FA"));
    await waitFor(() => {
      expect(screen.getByText("Настройка 2FA")).toBeInTheDocument();
    });
    await userEvent.type(
      screen.getByLabelText(/Введите 6-значный код из аутентификатора/),
      "123456",
    );
    await userEvent.click(screen.getByText("Подтвердить"));

    await waitFor(() => {
      expect(
        screen.getByText("⚠️ Сохраните коды восстановления!"),
      ).toBeInTheDocument();
    });

    // Close
    await userEvent.click(screen.getByText("Закрыть"));

    await waitFor(() => {
      expect(screen.getByText("✅ 2FA включена")).toBeInTheDocument();
    });
  });

  // ─── Disable 2FA ────────────────────────────────────────────────────────────

  it("disables 2FA when confirm returns true", async () => {
    (window as any).confirm = vi.fn().mockReturnValue(true);
    mockGet2FAStatus.mockResolvedValue({
      data: { enabled: true, has_pending_secret: false },
      error: null,
    });
    mockDisableTOTP.mockResolvedValue(undefined);

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("✅ 2FA включена")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Отключить"));

    expect(window.confirm).toHaveBeenCalledWith(
      "Вы уверены, что хотите отключить 2FA? Это снизит безопасность вашего аккаунта.",
    );
    expect(mockDisableTOTP).toHaveBeenCalledOnce();

    await waitFor(() => {
      expect(screen.getByText("❌ 2FA отключена")).toBeInTheDocument();
    });
    expect(toast.success).toHaveBeenCalledWith("2FA отключена");
  });

  it("does not disable 2FA when confirm returns false", async () => {
    (window as any).confirm = vi.fn().mockReturnValue(false);
    mockGet2FAStatus.mockResolvedValue({
      data: { enabled: true, has_pending_secret: false },
      error: null,
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("✅ 2FA включена")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Отключить"));

    expect(window.confirm).toHaveBeenCalledOnce();
    expect(mockDisableTOTP).not.toHaveBeenCalled();
    // Should still show enabled state
    expect(screen.getByText("✅ 2FA включена")).toBeInTheDocument();
  });

  it("shows error toast when disable fails", async () => {
    (window as any).confirm = vi.fn().mockReturnValue(true);
    mockGet2FAStatus.mockResolvedValue({
      data: { enabled: true, has_pending_secret: false },
      error: null,
    });
    mockDisableTOTP.mockRejectedValue(new Error("Server error"));

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("✅ 2FA включена")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Отключить"));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Ошибка отключения 2FA: Server error",
      );
    });

  });

  // ─── Setup from pending state ───────────────────────────────────────────────

  it("shows setup UI when there's a pending secret on load", async () => {
    // Simulate user already started setup but didn't verify
    mockGet2FAStatus.mockResolvedValue({
      data: { enabled: false, has_pending_secret: true },
      error: null,
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("❌ 2FA отключена")).toBeInTheDocument();
      expect(screen.getByText("Включить 2FA")).toBeInTheDocument();
    });

    // Click to continue setup (but since has_pending_secret=true but setupUri is empty,
    // clicking setup will call setupTOTP again to get fresh URI)
    mockSetupTOTP.mockResolvedValue({
      data: {
        secret: "NEW-SECRET",
        uri: "otpauth://totp/gomo6:testuser?secret=NEW-SECRET",
      },
      error: null,
    });

    await userEvent.click(screen.getByText("Включить 2FA"));

    await waitFor(() => {
      expect(screen.getByText("Настройка 2FA")).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue("NEW-SECRET")).toBeInTheDocument();
  });
});
