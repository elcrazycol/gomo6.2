import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { UserBadge } from "./UserBadge";

const mockFrom = vi.fn();
const mockGetProfileCustomization = vi.fn();

vi.mock("@/integrations/api/compat", () => ({
  api: {
    from: (...args: any[]) => mockFrom(...args),
  },
}));

vi.mock("@/utils/profileCustomization", () => ({
  getProfileCustomization: (...args: any[]) => mockGetProfileCustomization(...args),
  parseCssToStyle: () => ({}),
}));

vi.mock("react-router-dom", () => ({
  Link: ({ children, to, className, onClick }: any) => (
    <a href={to} className={className} onClick={onClick}>{children}</a>
  ),
}));

vi.mock("@/components/ProfileHoverCard", () => ({
  ProfileHoverCard: ({ children }: any) => <div data-testid="hover-card">{children}</div>,
}));

vi.mock("@/components/AdminBadge", () => ({
  AdminBadge: ({ userId }: any) => <span data-testid="admin-badge">{userId}</span>,
}));

describe("UserBadge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockImplementation((table: string) => {
      const p = Promise.resolve({ data: [], error: null }) as any;
      p.select = () => p;
      p.eq = () => p;
      return p;
    });
    mockGetProfileCustomization.mockResolvedValue(null);
  });

  it("renders username", async () => {
    render(<UserBadge userId="u1" username="testuser" />);
    await waitFor(() => {
      expect(screen.getByText("testuser")).toBeInTheDocument();
    });
  });

  it("renders Аноним when anonymous", () => {
    render(<UserBadge userId="u1" username="testuser" isAnonymous />);
    expect(screen.getByText("Аноним")).toBeInTheDocument();
  });

  it("renders Аноним when no userId", () => {
    render(<UserBadge userId={null} username="testuser" />);
    expect(screen.getByText("Аноним")).toBeInTheDocument();
  });

  it("creates link to profile", async () => {
    render(<UserBadge userId="u1" username="testuser" />);
    await waitFor(() => {
      const link = screen.getByRole("link");
      expect(link).toHaveAttribute("href", "/profile/u1");
    });
  });

  it("does not create link when disableLink is true", async () => {
    render(<UserBadge userId="u1" username="testuser" disableLink />);
    await waitFor(() => {
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });
  });

  it("renders hover card wrapper", async () => {
    render(<UserBadge userId="u1" username="testuser" />);
    await waitFor(() => {
      expect(screen.getByTestId("hover-card")).toBeInTheDocument();
    });
  });

  it("renders admin badge", async () => {
    render(<UserBadge userId="u1" username="testuser" />);
    await waitFor(() => {
      expect(screen.getByTestId("admin-badge")).toBeInTheDocument();
    });
  });

  it("applies custom className", async () => {
    const { container } = render(<UserBadge userId="u1" username="testuser" className="custom" />);
    await waitFor(() => {
      const wrapper = container.querySelector(".custom");
      expect(wrapper).toBeInTheDocument();
    });
  });

  it("applies showOutline class", async () => {
    render(<UserBadge userId="u1" username="testuser" showOutline />);
    await waitFor(() => {
      const text = screen.getByText("testuser");
      expect(text.className).toContain("text-base");
    });
  });

  it("renders thread opener badge", async () => {
    render(<UserBadge userId="u1" username="testuser" isThreadOpener />);
    await waitFor(() => {
      expect(screen.getByText("TO")).toBeInTheDocument();
    });
  });
});
