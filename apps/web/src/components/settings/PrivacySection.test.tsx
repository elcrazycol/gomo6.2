import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { toast } from "sonner";
import { PrivacySection } from "./PrivacySection";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockGetSession = vi.fn();

vi.mock("@/integrations/api/compat", () => ({
  api: { auth: { getSession: (...args: unknown[]) => mockGetSession(...args) } },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const privacyRow = {
  user_id: "u1",
  private_profile: false,
  private_hide_avatar: false,
  private_hide_wall: false,
  private_hide_threads: true,
  private_hide_stats: false,
  private_hide_friends: true,
  private_hide_gifts: true,
  private_hide_achievements: true,
  show_online_status: true,
  show_profile_wall: false,
  allow_wall_posts_from_others: true,
  show_profile_stats: false,
  show_detailed_stats: false,
  remove_image_metadata: true,
  stats_visibility: { garma: false, posts: true },
};

const jsonResponse = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

let fetchMock: ReturnType<typeof vi.fn>;

const readBody = (init?: RequestInit) => JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue({ data: { session: { access_token: "token" } } });
  fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) =>
    init?.method === "PUT" || init?.method === "POST" ? jsonResponse({ data: privacyRow }) : jsonResponse({ data: [privacyRow] }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("PrivacySection", () => {
  it("renders the loaded row grouped by question", async () => {
    render(<PrivacySection userId="u1" />);

    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "Приватный профиль" })).toBeInTheDocument();
    });

    expect(screen.getByRole("switch", { name: "Приватный профиль" })).not.toBeChecked();
    // The wall toggle is off in the row...
    expect(screen.getByRole("switch", { name: "Показывать стену профиля" })).not.toBeChecked();
    // ...which disables the "allow posts from others" toggle.
    expect(screen.getByRole("switch", { name: "Разрешить посты от других" })).toBeDisabled();
  });

  it("disables the private-only toggles while the profile is public", async () => {
    render(<PrivacySection userId="u1" />);

    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "Приватный профиль" })).toBeInTheDocument();
    });

    expect(screen.getByRole("switch", { name: "Скрывать записи" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Скрывать список друзей" })).toBeDisabled();
  });

  it("marks the row dirty and saves stats_visibility with the rest of the payload", async () => {
    render(<PrivacySection userId="u1" />);

    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "Приватный профиль" })).toBeInTheDocument();
    });

    // Clean → the save button is disabled.
    const saveButton = screen.getByRole("button", { name: /Сохранить/ });
    expect(saveButton).toBeDisabled();

    await userEvent.click(screen.getByRole("switch", { name: "Приватный профиль" }));

    expect(screen.getByText(/Несохранённых изменений: 1/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Сохранить/ })).toBeEnabled();

    await userEvent.click(screen.getByRole("button", { name: /Сохранить/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/privacy_settings?user_id=eq.u1"),
        expect.objectContaining({ method: "PUT" }),
      );
    });

    const putCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PUT");
    const body = readBody(putCall?.[1] as RequestInit);
    // The bug this section fixes: the payload must carry stats_visibility.
    expect(body.stats_visibility).toMatchObject({ posts: true });
    expect(body.private_profile).toBe(true);
    expect(toast.success).toHaveBeenCalledWith("Настройки приватности сохранены");
  });

  it("restores defaults in the draft without touching the server", async () => {
    render(<PrivacySection userId="u1" />);

    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "Приватный профиль" })).toBeInTheDocument();
    });

    // Row has the wall hidden; the default is visible.
    expect(screen.getByRole("switch", { name: "Показывать стену профиля" })).not.toBeChecked();

    await userEvent.click(screen.getByRole("button", { name: /Сбросить/ }));

    expect(screen.getByRole("switch", { name: "Показывать стену профиля" })).toBeChecked();
    expect(toast.message).toHaveBeenCalled();
    // Still only the initial GET — reset must not write.
    expect(fetchMock.mock.calls.every(([, init]) => (init as RequestInit | undefined)?.method !== "PUT")).toBe(true);
  });
});
