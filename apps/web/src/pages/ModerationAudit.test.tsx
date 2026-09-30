import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";

import ModerationAudit from "./ModerationAudit";

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

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => null,
  SelectContent: () => null,
  SelectItem: () => null,
}));

const page = (items: unknown[]) => ({ items, total: items.length, limit: 50, offset: 0 });

const actions = [
  {
    id: "a-1",
    action: "sanction_mute",
    target_type: "user",
    target_id: "u-2",
    link: "/profile/u-2",
    reason_code: "spam",
    note: "флуд",
    moderator: "moduser",
    created_at: "2026-09-30T10:00:00Z",
  },
  {
    id: "a-2",
    action: "resolve_target",
    target_type: "thread",
    target_id: "t-1",
    link: "/thread/t-1",
    reason_code: null,
    note: null,
    moderator: "moduser",
    created_at: "2026-09-30T09:00:00Z",
  },
];

describe("ModerationAudit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRawRequest.mockResolvedValue({ success: true, data: page(actions) });
  });

  it("lists audit entries with the moderator, target link and note", async () => {
    render(<ModerationAudit />);

    await waitFor(() => {
      expect(screen.getByText("Запрет писать")).toBeInTheDocument();
    });
    expect(screen.getByText("Жалобы объекта закрыты")).toBeInTheDocument();
    expect(screen.getAllByText(/модератор: moduser/)).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: /открыть/ })[0]).toHaveAttribute("href", "/profile/u-2");
    expect(screen.getByText("флуд")).toBeInTheDocument();
    expect(mockRawRequest).toHaveBeenCalledWith(expect.stringContaining("/api/v1/moderation/actions?limit=50&offset=0"));
  });

  it("shows the empty state", async () => {
    mockRawRequest.mockResolvedValue({ success: true, data: page([]) });
    render(<ModerationAudit />);
    await waitFor(() => {
      expect(screen.getByText("Записей нет")).toBeInTheDocument();
    });
  });
});
