import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";

import { ModerationNavCard } from "./ModerationNavCard";

vi.mock("react-router-dom", () => ({
  Link: ({ children, to }: any) => <a href={to}>{children}</a>,
}));

const { mockGetUser, mockGetMeta } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockGetMeta: vi.fn(),
}));

vi.mock("@/integrations/api/compat", () => ({ api: { auth: { getUser: mockGetUser } } }));
vi.mock("@/utils/currentUserMeta", () => ({ getCurrentUserMeta: mockGetMeta }));

describe("ModerationNavCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-1" } } });
  });

  it("renders the moderation entry at the bottom of the sidebar for staff", async () => {
    mockGetMeta.mockResolvedValue({ roles: ["moderator"], username: "mod", color: "" });
    render(<ModerationNavCard />);
    await waitFor(() => {
      expect(screen.getByRole("link", { name: /Модерация/ })).toHaveAttribute("href", "/moderation");
    });
  });

  it("also renders for a read-only helper", async () => {
    mockGetMeta.mockResolvedValue({ roles: ["helper"], username: "h", color: "" });
    render(<ModerationNavCard />);
    await waitFor(() => {
      expect(screen.getByRole("link", { name: /Модерация/ })).toBeInTheDocument();
    });
  });

  it("stays hidden for a regular user", async () => {
    mockGetMeta.mockResolvedValue({ roles: ["user"], username: "bob", color: "" });
    render(<ModerationNavCard />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("link", { name: /Модерация/ })).not.toBeInTheDocument();
  });
});
