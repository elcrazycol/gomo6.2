import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";

import ModerationDashboard from "./ModerationDashboard";

vi.mock("@/hooks/useModeratorGate", () => ({
  useModeratorGate: () => ({ user: { id: "mod-1" }, isModerator: true, canReadModeration: true }),
}));

vi.mock("react-router-dom", () => ({
  Link: ({ children, to }: any) => <a href={to}>{children}</a>,
}));

const { mockRawRequest } = vi.hoisted(() => ({ mockRawRequest: vi.fn() }));
vi.mock("@/integrations/api/client", () => ({
  apiClient: { rawRequest: (...args: any[]) => mockRawRequest(...args) },
}));

const stats = {
  open_reports: 7,
  open_targets: 4,
  oldest_open_seconds: 5400, // 1 ч 30 мин
  median_response_seconds: 720, // 12 мин
  reports_today: 3,
  actions_today: 5,
  open_appeals: 1,
  computed_at: "2026-09-30T00:00:00Z",
};

describe("ModerationDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRawRequest.mockResolvedValue({ success: true, data: stats });
  });

  it("shows the queue depth, response time and today's counters", async () => {
    render(<ModerationDashboard />);

    await waitFor(() => {
      expect(screen.getByText("7")).toBeInTheDocument();
    });
    expect(screen.getByText("1 ч 30 мин")).toBeInTheDocument();
    expect(screen.getByText("12 мин")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("links to the queue and the audit log", async () => {
    render(<ModerationDashboard />);
    await waitFor(() => {
      expect(screen.getByRole("link", { name: /Очередь жалоб/ })).toHaveAttribute("href", "/moderation/reports");
    });
    expect(screen.getByRole("link", { name: /Журнал действий/ })).toHaveAttribute("href", "/moderation/audit");
  });
});
