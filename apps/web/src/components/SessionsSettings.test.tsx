import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { toast } from "sonner";
import { SessionsSettings } from "./SessionsSettings";
import type { SessionInfo } from "@/integrations/api/client";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockGetSessions = vi.fn();
const mockDeleteSession = vi.fn();
const mockDeleteAllOtherSessions = vi.fn();
const mockSignOut = vi.fn();

vi.mock("@/integrations/api/client", () => ({
  apiClient: {
    getSessions: (...args: any[]) => mockGetSessions(...args),
    deleteSession: (...args: any[]) => mockDeleteSession(...args),
    deleteAllOtherSessions: (...args: any[]) => mockDeleteAllOtherSessions(...args),
  },
}));

vi.mock("@/integrations/api/compat", () => ({
  api: {
    auth: {
      signOut: (...args: any[]) => mockSignOut(...args),
    },
  },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: "s1",
    user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    os_name: "Windows",
    browser_name: "Chrome",
    device_type: "desktop",
    ip_address: "8.8.8.8",
    country_code: "US",
    country_name: "США",
    created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    last_active_at: new Date().toISOString(),
    is_current: false,
    online: false,
    ...overrides,
  };
}

const currentSession = makeSession({
  id: "current-1",
  is_current: true,
  browser_name: "Safari",
  os_name: "macOS",
  created_at: new Date().toISOString(),
});

const otherSession = makeSession({
  id: "other-1",
  is_current: false,
  online: true,
  browser_name: "Firefox",
  os_name: "Linux",
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("SessionsSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSessions.mockResolvedValue([currentSession]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a loader while sessions are being fetched", () => {
    mockGetSessions.mockReturnValue(new Promise(() => {}));
    const { container } = render(<SessionsSettings />);
    expect(container.querySelector(".pentagram-loader")).toBeInTheDocument();
  });

  it("renders the device list with names and locations", async () => {
    mockGetSessions.mockResolvedValue([otherSession]);
    render(<SessionsSettings />);

    await waitFor(() => {
      expect(screen.getByText("Firefox · Linux")).toBeInTheDocument();
    });
    // Location: country name + IP, with the US flag emoji
    expect(screen.getByText(/🇺🇸/)).toBeInTheDocument();
    expect(screen.getByText(/США · 8\.8\.8\.8/)).toBeInTheDocument();
  });

  it("marks the current session with 'Это устройство' badge", async () => {
    render(<SessionsSettings />);

    await waitFor(() => {
      expect(screen.getByText("Safari · macOS")).toBeInTheDocument();
    });
    expect(screen.getByText("Это устройство")).toBeInTheDocument();
    // Current session shows a "Выйти" action
    expect(screen.getByText("Выйти")).toBeInTheDocument();
  });

  it("shows the 'В сети' badge for online sessions", async () => {
    mockGetSessions.mockResolvedValue([otherSession]);
    render(<SessionsSettings />);

    await waitFor(() => {
      expect(screen.getByText("Firefox · Linux")).toBeInTheDocument();
    });
    expect(screen.getByText("В сети")).toBeInTheDocument();
  });

  it("renders 'Неизвестное устройство' when OS and browser are unknown", async () => {
    mockGetSessions.mockResolvedValue([
      makeSession({ id: "anon", browser_name: "Unknown", os_name: "Unknown" }),
    ]);
    render(<SessionsSettings />);

    await waitFor(() => {
      expect(screen.getByText("Неизвестное устройство")).toBeInTheDocument();
    });
  });

  it("shows the empty state when there are no sessions", async () => {
    mockGetSessions.mockResolvedValue([]);
    render(<SessionsSettings />);

    await waitFor(() => {
      expect(screen.getByText("Нет активных сессий")).toBeInTheDocument();
    });
  });

  it("shows an error toast when loading fails", async () => {
    mockGetSessions.mockRejectedValue(new Error("network"));
    render(<SessionsSettings />);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Не удалось загрузить список сессий");
    });
  });

  it("refetches sessions when the refresh button is clicked", async () => {
    mockGetSessions.mockResolvedValue([currentSession]);
    render(<SessionsSettings />);

    await waitFor(() => {
      expect(screen.getByText("Safari · macOS")).toBeInTheDocument();
    });
    expect(mockGetSessions).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByLabelText("Обновить список сессий"));

    await waitFor(() => {
      expect(mockGetSessions).toHaveBeenCalledTimes(2);
    });
  });

  it("polls sessions every 30 seconds", async () => {
    vi.useFakeTimers();
    mockGetSessions.mockResolvedValue([currentSession]);

    render(<SessionsSettings />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockGetSessions).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(mockGetSessions).toHaveBeenCalledTimes(2);
  });

  it("deletes a non-current session and removes it from the list", async () => {
    mockGetSessions.mockResolvedValue([currentSession, otherSession]);
    mockDeleteSession.mockResolvedValue({ ok: true, was_current: false });
    render(<SessionsSettings />);

    await waitFor(() => {
      expect(screen.getByText("Firefox · Linux")).toBeInTheDocument();
    });

    const buttons = screen.getAllByText("Завершить");
    await userEvent.click(buttons[0]);

    await waitFor(() => {
      expect(mockDeleteSession).toHaveBeenCalledWith("other-1");
      expect(toast.success).toHaveBeenCalledWith(
        "Сессия завершена — устройство выведено из аккаунта",
      );
    });
    expect(screen.queryByText("Firefox · Linux")).not.toBeInTheDocument();
    expect(screen.getByText("Safari · macOS")).toBeInTheDocument();
    // "Завершить все другие сессии" button disappears once no others remain
    expect(screen.queryByText(/Завершить все другие сессии/)).not.toBeInTheDocument();
  });

  it("logs out locally when the current session is deleted", async () => {
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      value: { href: "http://localhost/settings" },
      writable: true,
    });
    try {
      mockGetSessions.mockResolvedValue([currentSession]);
      mockDeleteSession.mockResolvedValue({ ok: true, was_current: true });
      render(<SessionsSettings />);

      await waitFor(() => {
        expect(screen.getByText("Safari · macOS")).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText("Выйти"));

      await waitFor(() => {
        expect(mockDeleteSession).toHaveBeenCalledWith("current-1");
        expect(mockSignOut).toHaveBeenCalled();
      });
      expect(window.location.href).toBe("/auth");
    } finally {
      Object.defineProperty(window, "location", {
        value: originalLocation,
        writable: true,
      });
    }
  });

  it("shows an error toast when deleting a session fails", async () => {
    mockGetSessions.mockResolvedValue([currentSession, otherSession]);
    mockDeleteSession.mockRejectedValue(new Error("boom"));
    render(<SessionsSettings />);

    await waitFor(() => {
      expect(screen.getByText("Firefox · Linux")).toBeInTheDocument();
    });

    await userEvent.click(screen.getAllByText("Завершить")[0]);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Не удалось завершить сессию");
    });
    expect(screen.getByText("Firefox · Linux")).toBeInTheDocument();
  });

  it("terminates all other sessions and keeps only the current one", async () => {
    mockGetSessions.mockResolvedValue([currentSession, otherSession]);
    mockDeleteAllOtherSessions.mockResolvedValue({ deleted: 1 });
    render(<SessionsSettings />);

    await waitFor(() => {
      expect(screen.getByText("Firefox · Linux")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText(/Завершить все другие сессии/));

    await waitFor(() => {
      expect(mockDeleteAllOtherSessions).toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalledWith("Завершено сессий: 1");
    });
    expect(screen.queryByText("Firefox · Linux")).not.toBeInTheDocument();
    expect(screen.getByText("Safari · macOS")).toBeInTheDocument();
  });

  it("reports when there are no other active sessions", async () => {
    mockGetSessions.mockResolvedValue([currentSession]);
    render(<SessionsSettings />);

    await waitFor(() => {
      expect(screen.getByText("Safari · macOS")).toBeInTheDocument();
    });
    // No "terminate all" button when there are no other sessions
    expect(screen.queryByText(/Завершить все другие сессии/)).not.toBeInTheDocument();
  });

  it("renders device-type icons (mobile / tablet / unknown globe)", async () => {
    mockGetSessions.mockResolvedValue([
      makeSession({ id: "m1", device_type: "mobile" }),
      makeSession({ id: "t1", device_type: "tablet" }),
      makeSession({ id: "g1", browser_name: "Unknown", os_name: "Unknown" }),
    ]);
    const { container } = render(<SessionsSettings />);

    await waitFor(() => {
      expect(screen.getAllByText("Неизвестное устройство").length).toBeGreaterThan(0);
    });

    expect(container.querySelector(".lucide-smartphone")).toBeInTheDocument();
    expect(container.querySelector(".lucide-tablet")).toBeInTheDocument();
    expect(container.querySelector(".lucide-globe")).toBeInTheDocument();
  });

  it("formats relative time for recent activity", async () => {
    mockGetSessions.mockResolvedValue([
      makeSession({
        id: "just-now",
        created_at: new Date().toISOString(),
        last_active_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      }),
      makeSession({
        id: "hours-ago",
        created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        last_active_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    ]);
    render(<SessionsSettings />);

    await waitFor(() => {
      expect(screen.getByText("только что")).toBeInTheDocument();
      expect(screen.getByText("5 мин. назад")).toBeInTheDocument();
      expect(screen.getByText("2 ч. назад")).toBeInTheDocument();
      expect(screen.getByText("3 дн. назад")).toBeInTheDocument();
    });
  });
});
