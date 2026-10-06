import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { toast } from "sonner";

import ModerationReport from "./ModerationReport";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/hooks/useModeratorGate", () => ({
  useModeratorGate: () => ({ user: { id: "mod-1" }, isModerator: true, canReadModeration: true }),
}));
vi.mock("react-router-dom", () => ({
  Link: ({ children, to }: any) => <a href={to}>{children}</a>,
  useParams: () => ({ reportId: "r-1" }),
}));

const { mockRawRequest } = vi.hoisted(() => ({ mockRawRequest: vi.fn() }));
vi.mock("@/integrations/api/client", () => ({
  apiClient: { rawRequest: (...args: any[]) => mockRawRequest(...args) },
}));

const detail = {
  report: {
    id: "r-1",
    target_type: "thread",
    target_id: "t-1",
    reporter: { username: "alice" },
    category: "spam",
    reason: "реклама казино",
    status: "open",
    source: "user",
    created_at: "2026-09-30T10:00:00Z",
  },
  target: {
    type: "thread",
    id: "t-1",
    exists: true,
    title: "Спорный тред",
    content: "текст треда",
    author_username: "bob",
    author_id: "u-9",
    link: "/thread/t-1",
  },
  actions: [{ id: "a-1", action: "sanction_mute", target_type: "user", target_id: "u-9", moderator: "moduser", note: "флуд", created_at: "2026-09-30T11:00:00Z" }],
  sanctions: [{ id: "s-1", kind: "mute", reason: "флуд", issued_by: "moduser", active: true }],
  appeals: [{ id: "ap-1", status: "open", body: "это ошибка" }],
};

const apiResponse = (data: unknown) => ({ success: true, data });

describe("ModerationReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRawRequest.mockResolvedValue(apiResponse(detail));
  });

  it("shows the report, target, action trail, sanction and appeal on one page", async () => {
    render(<ModerationReport />);

    await waitFor(() => {
      expect(screen.getByText("реклама казино")).toBeInTheDocument();
    });
    expect(screen.getByText("текст треда")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "bob" })).toHaveAttribute("href", "/moderation/users/u-9");
    expect(screen.getByRole("link", { name: "Запрет писать" })).toHaveAttribute("href", "/moderation/actions/a-1");
    expect(screen.getByText("это ошибка")).toBeInTheDocument();
  });

  it("resolves the report with a note", async () => {
    render(<ModerationReport />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Решить" })).toBeInTheDocument();
    });

    await userEvent.type(screen.getByPlaceholderText(/Комментарий/), "нарушение подтверждено");
    await userEvent.click(screen.getByRole("button", { name: "Решить" }));

    await waitFor(() => {
      expect(mockRawRequest).toHaveBeenCalledWith("/api/v1/moderation/reports/r-1/resolve", {
        method: "POST",
        body: JSON.stringify({ note: "нарушение подтверждено" }),
      });
      expect(toast.success).toHaveBeenCalledWith("Жалоба решена");
    });
  });
});
