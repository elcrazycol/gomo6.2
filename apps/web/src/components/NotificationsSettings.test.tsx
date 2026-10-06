import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { toast } from "@/components/ui/sonner";
import NotificationsSettings from "./NotificationsSettings";

const mockIsPushSupported = vi.fn();
const mockGetPushPreferences = vi.fn();
const mockIsSubscribed = vi.fn();
const mockEnablePush = vi.fn();
const mockDisablePush = vi.fn();
const mockUpdatePushPreferences = vi.fn();

vi.mock("@/services/pushNotifications", () => ({
  isPushSupported: () => mockIsPushSupported(),
  getPushPreferences: () => mockGetPushPreferences(),
  isSubscribed: () => mockIsSubscribed(),
  enablePush: () => mockEnablePush(),
  disablePush: () => mockDisablePush(),
  updatePushPreferences: (m: Record<string, boolean>) => mockUpdatePushPreferences(m),
}));

vi.mock("@/components/ui/sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

const prefs = { available_types: ["like", "message"], type_map: {}, vapid_public_key: "key" };

beforeEach(() => {
  vi.clearAllMocks();
  mockIsPushSupported.mockReturnValue(true);
  mockGetPushPreferences.mockResolvedValue(prefs);
  mockIsSubscribed.mockResolvedValue(false);
  mockEnablePush.mockResolvedValue(true);
  mockUpdatePushPreferences.mockResolvedValue(true);
});

describe("NotificationsSettings", () => {
  it("explains when the browser cannot do push at all", async () => {
    mockIsPushSupported.mockReturnValue(false);
    render(<NotificationsSettings />);

    await waitFor(() => {
      expect(screen.getByText(/не поддерживает push-уведомления/)).toBeInTheDocument();
    });
    expect(mockGetPushPreferences).not.toHaveBeenCalled();
  });

  it("offers the master switch and hides the types until subscribed", async () => {
    render(<NotificationsSettings />);

    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "Включить push-уведомления на этом устройстве" })).toBeInTheDocument();
    });
    expect(screen.queryByText("Оценки")).not.toBeInTheDocument();
  });

  it("subscribes, then shows the per-type toggles", async () => {
    render(<NotificationsSettings />);

    const master = await screen.findByRole("switch", {
      name: "Включить push-уведомления на этом устройстве",
    });

    mockIsSubscribed.mockResolvedValue(true);
    await userEvent.click(master);

    await waitFor(() => {
      expect(mockEnablePush).toHaveBeenCalled();
    });
    expect(toast.success).toHaveBeenCalledWith("Push-уведомления включены");

    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "Оценки" })).toBeInTheDocument();
    });
    expect(screen.getByRole("switch", { name: "Сообщения" })).toBeInTheDocument();
  });

  it("saves a per-type toggle optimistically", async () => {
    mockIsSubscribed.mockResolvedValue(true);
    render(<NotificationsSettings />);

    const like = await screen.findByRole("switch", { name: "Оценки" });
    await userEvent.click(like);

    expect(mockUpdatePushPreferences).toHaveBeenCalledWith({ like: false });
  });

  it("rolls back and warns when saving a type fails", async () => {
    mockIsSubscribed.mockResolvedValue(true);
    mockUpdatePushPreferences.mockResolvedValue(false);
    render(<NotificationsSettings />);

    const like = await screen.findByRole("switch", { name: "Оценки" });
    await userEvent.click(like);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Не удалось сохранить настройки уведомлений");
    });
  });
});
