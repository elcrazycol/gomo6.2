import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { toast } from "sonner";

import ModerationAppeals from "./ModerationAppeals";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/hooks/useModeratorGate", () => ({
  useModeratorGate: () => ({ user: { id: "mod-1" }, isModerator: true, canReadModeration: true }),
}));
vi.mock("react-router-dom", () => ({ Link: ({ children, to }: any) => <a href={to}>{children}</a> }));

const { mockRawRequest, mockWsService } = vi.hoisted(() => ({
  mockRawRequest: vi.fn(),
  mockWsService: { subscribe: vi.fn(), unsubscribe: vi.fn(), on: vi.fn(() => vi.fn()) },
}));
vi.mock("@/services/websocket", () => ({ wsService: mockWsService }));
vi.mock("@/integrations/api/client", () => ({
  apiClient: { rawRequest: (...args: any[]) => mockRawRequest(...args) },
}));

const appeal = {
  id: "ap-1",
  sanction_id: "s-1",
  user_id: "u-9",
  username: "victim",
  body: "я не спамил, это была ссылка на источник",
  status: "open",
  sanction_kind: "mute",
  sanction_reason: "флуд",
  created_at: "2026-09-30T10:00:00Z",
};

const apiResponse = (data: unknown) => ({ success: true, data });

describe("ModerationAppeals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRawRequest.mockImplementation((url: string) => {
      if (url.includes("/appeals?")) return Promise.resolve(apiResponse({ items: [appeal], total: 1, limit: 50, offset: 0 }));
      return Promise.resolve(apiResponse({ id: "ap-1", status: "accepted" }));
    });
  });

  it("lists open appeals with the sanction context", async () => {
    render(<ModerationAppeals />);
    await waitFor(() => {
      expect(screen.getByText("victim")).toBeInTheDocument();
    });
    expect(screen.getByText("я не спамил, это была ссылка на источник")).toBeInTheDocument();
    expect(screen.getByText(/Санкция: флуд/)).toBeInTheDocument();
  });

  it("accepts an appeal, which lifts the sanction", async () => {
    render(<ModerationAppeals />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Принять и снять/ })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: /Принять и снять/ }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByPlaceholderText(/Комментарий/), "проверил — нарушение не подтвердилось");
    await userEvent.click(within(dialog).getByRole("button", { name: "Принять" }));

    await waitFor(() => {
      expect(mockRawRequest).toHaveBeenCalledWith("/api/v1/moderation/appeals/ap-1/accept", {
        method: "POST",
        body: JSON.stringify({ note: "проверил — нарушение не подтвердилось" }),
      });
      expect(toast.success).toHaveBeenCalledWith("Апелляция принята, санкция снята");
    });
  });
});
