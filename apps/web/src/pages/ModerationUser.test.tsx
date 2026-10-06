import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { toast } from "sonner";

import ModerationUser from "./ModerationUser";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/hooks/useModeratorGate", () => ({
  useModeratorGate: () => ({ user: { id: "mod-1" }, isModerator: true, canReadModeration: true }),
}));

vi.mock("react-router-dom", () => ({
  Link: ({ children, to }: any) => <a href={to}>{children}</a>,
  useParams: () => ({ userId: "u-2" }),
}));

const { mockRawRequest } = vi.hoisted(() => ({ mockRawRequest: vi.fn() }));

vi.mock("@/integrations/api/client", () => ({
  apiClient: { rawRequest: (...args: any[]) => mockRawRequest(...args) },
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => null,
  SelectContent: () => null,
  SelectItem: () => null,
}));

const card = (overrides: Record<string, unknown> = {}) => ({
  user: {
    id: "u-2",
    username: "spammer",
    display_name: "Спамер",
    created_at: "2026-01-01T00:00:00Z",
    is_online: false,
    garma: 3,
    posts: 5,
    threads: 1,
    wall_posts: 2,
    comments: 3,
    likes_received: 0,
    roles: ["user"],
    is_staff: false,
  },
  sanctions: [
    {
      id: "s-1",
      kind: "ban",
      reason: "Спам и реклама",
      issued_by: "moduser",
      created_at: "2026-09-01T10:00:00Z",
      expires_at: null,
      revoked_at: null,
      active: true,
    },
  ],
  notes: [{ id: "n-1", body: "подозрительный паттерн", author: "moduser", created_at: "2026-09-01T10:00:00Z" }],
  reports_against: { open: 2, total: 3, recent: [] },
  reports_by: { open: 0, total: 0, recent: [] },
  ...overrides,
});

const activityItem = {
  id: 42,
  event_type: "like_given",
  target_type: "post",
  target_id: "p-1",
  link: "/thread/t-1",
  created_at: "2026-09-02T10:00:00Z",
};

const apiResponse = (data: unknown) => ({ success: true, data });

describe("ModerationUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRawRequest.mockImplementation((url: string) => {
      if (url.includes("/activity")) return Promise.resolve(apiResponse({ items: [activityItem], next_cursor: "" }));
      return Promise.resolve(apiResponse(card()));
    });
  });

  it("renders the account summary with an active-ban badge", async () => {
    render(<ModerationUser />);
    await waitFor(() => {
      expect(screen.getByText("Спамер")).toBeInTheDocument();
    });
    expect(screen.getByText("забанен")).toBeInTheDocument();
    expect(screen.getByText("Спам и реклама")).toBeInTheDocument();
  });

  it("applies a sanction with the chosen kind, reason and duration", async () => {
    render(<ModerationUser />);
    await waitFor(() => {
      expect(screen.getByText("Спамер")).toBeInTheDocument();
    });

    await userEvent.type(screen.getByPlaceholderText("Причина (её увидит пользователь)"), "флуд в чате");
    await userEvent.click(screen.getByRole("button", { name: /Применить/ }));

    await waitFor(() => {
      expect(mockRawRequest).toHaveBeenCalledWith("/api/v1/moderation/users/u-2/sanctions", {
        method: "POST",
        body: JSON.stringify({ kind: "warn", reason: "флуд в чате", duration_minutes: 0 }),
      });
      expect(toast.success).toHaveBeenCalledWith("Санкция применена");
    });
  });

  it("adds an internal note", async () => {
    render(<ModerationUser />);
    await waitFor(() => {
      expect(screen.getByText("подозрительный паттерн")).toBeInTheDocument();
    });

    await userEvent.type(screen.getByPlaceholderText(/Внутренняя заметка/), "проверить ещё раз");
    await userEvent.click(screen.getByRole("button", { name: /Добавить/ }));

    await waitFor(() => {
      expect(mockRawRequest).toHaveBeenCalledWith("/api/v1/moderation/users/u-2/notes", {
        method: "POST",
        body: JSON.stringify({ body: "проверить ещё раз" }),
      });
    });
  });

  it("shows reports counts and the activity log with a link to the target", async () => {
    render(<ModerationUser />);
    await waitFor(() => {
      expect(screen.getByText("Поставил лайк")).toBeInTheDocument();
    });
    expect(screen.getByText(/На него — 3/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /post/ })).toHaveAttribute("href", "/thread/t-1");
  });

  it("revokes an active sanction through the confirmation dialog", async () => {
    render(<ModerationUser />);
    await waitFor(() => {
      expect(screen.getByText("Спам и реклама")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: /Снять/ }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /Снять/ }));

    await waitFor(() => {
      expect(mockRawRequest).toHaveBeenCalledWith("/api/v1/moderation/users/u-2/sanctions/s-1", {
        method: "DELETE",
      });
      expect(toast.success).toHaveBeenCalledWith("Санкция снята");
    });
  });

  it("hides the sanction form for staff accounts", async () => {
    mockRawRequest.mockImplementation((url: string) => {
      if (url.includes("/activity")) return Promise.resolve(apiResponse({ items: [], next_cursor: "" }));
      return Promise.resolve(
        apiResponse(card({ user: { ...card().user, username: "mod2", roles: ["moderator"], is_staff: true }, sanctions: [] })),
      );
    });

    render(<ModerationUser />);
    await waitFor(() => {
      expect(screen.getByText(/Это модератор/)).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /Применить/ })).not.toBeInTheDocument();
  });
});
