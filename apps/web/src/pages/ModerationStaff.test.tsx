import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { toast } from "sonner";

import ModerationStaff from "./ModerationStaff";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/hooks/useModeratorGate", () => ({
  useModeratorGate: () => ({ user: { id: "admin-1" }, isModerator: true, isAdmin: true, canReadModeration: true }),
}));
vi.mock("react-router-dom", () => ({ Link: ({ children, to }: any) => <a href={to}>{children}</a> }));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => null,
  SelectContent: () => null,
  SelectItem: () => null,
}));

const { mockRawRequest } = vi.hoisted(() => ({ mockRawRequest: vi.fn() }));
vi.mock("@/integrations/api/client", () => ({
  apiClient: { rawRequest: (...args: any[]) => mockRawRequest(...args) },
}));

const apiResponse = (data: unknown) => ({ success: true, data });

describe("ModerationStaff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRawRequest.mockImplementation((url: string) => {
      if (url.startsWith("/api/v1/moderation/staff") && !url.includes("?")) {
        return Promise.resolve(apiResponse({ items: [{ user_id: "u-9", username: "bob", display_name: "Боб", roles: ["moderator"] }] }));
      }
      return Promise.resolve(apiResponse({ user_id: "u-9", role: "helper" }));
    });
  });

  it("lists staff with their roles", async () => {
    render(<ModerationStaff />);
    await waitFor(() => {
      expect(screen.getByText("Боб")).toBeInTheDocument();
    });
    expect(screen.getByText("@bob")).toBeInTheDocument();
    expect(screen.getByText("moderator")).toBeInTheDocument();
  });

  it("grants a role by username", async () => {
    render(<ModerationStaff />);
    await waitFor(() => {
      expect(screen.getByText("Боб")).toBeInTheDocument();
    });

    await userEvent.type(screen.getByPlaceholderText("username"), "carol");
    await userEvent.click(screen.getByRole("button", { name: /Выдать/ }));

    await waitFor(() => {
      expect(mockRawRequest).toHaveBeenCalledWith("/api/v1/moderation/staff", {
        method: "POST",
        body: JSON.stringify({ username: "carol", role: "helper" }),
      });
      expect(toast.success).toHaveBeenCalledWith("Роль выдана");
    });
  });
});
