import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";

import ModerationAction from "./ModerationAction";

vi.mock("@/hooks/useModeratorGate", () => ({
  useModeratorGate: () => ({ user: { id: "mod-1" }, isModerator: true, canReadModeration: true }),
}));
vi.mock("react-router-dom", () => ({
  Link: ({ children, to }: any) => <a href={to}>{children}</a>,
  useParams: () => ({ actionId: "a-1" }),
}));

const { mockRawRequest } = vi.hoisted(() => ({ mockRawRequest: vi.fn() }));
vi.mock("@/integrations/api/client", () => ({
  apiClient: { rawRequest: (...args: any[]) => mockRawRequest(...args) },
}));

const detail = {
  action: {
    id: "a-1",
    action: "sanction_ban",
    target_type: "user",
    target_id: "u-9",
    link: "/profile/u-9",
    reason_code: "spam",
    note: "спам-бот",
    moderator: "moduser",
    created_at: "2026-09-30T10:00:00Z",
  },
  target: { type: "user", id: "u-9", exists: true, author_username: "bob", author_id: "u-9", link: "/profile/u-9" },
  report: { id: "r-1", category: "spam", reason: "реклама", status: "resolved", reporter: { username: "alice" }, source: "user" },
  sanctions: [],
  appeals: [],
};

describe("ModerationAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRawRequest.mockResolvedValue({ success: true, data: detail });
  });

  it("shows the action, its moderator, target and originating report", async () => {
    render(<ModerationAction />);

    await waitFor(() => {
      expect(screen.getByText("Блокировка")).toBeInTheDocument();
    });
    expect(screen.getByText(/модератор: @moduser/)).toBeInTheDocument();
    expect(screen.getByText("спам-бот")).toBeInTheDocument();
    expect(screen.getByText("реклама")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Открыть жалобу →" })).toHaveAttribute("href", "/moderation/reports/r-1");
  });
});
