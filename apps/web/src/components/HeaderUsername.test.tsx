import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { HeaderUsername } from "./HeaderUsername";

const mockNavigate = vi.fn();
const mockGetProfile = vi.fn();
const mockLoadProfile = vi.fn();

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("@/contexts/ProfileCacheContext", () => ({
  useProfileCache: () => ({
    getProfile: (...args: any[]) => mockGetProfile(...args),
    loadProfile: (...args: any[]) => mockLoadProfile(...args),
  }),
}));

vi.mock("@/components/ProfileHoverCard", () => ({
  ProfileHoverCard: ({ children }: any) => <div data-testid="hover-card">{children}</div>,
}));

vi.mock("@/components/AdminBadge", () => ({
  AdminBadge: () => <span data-testid="admin-badge" />,
}));

vi.mock("@/utils/profileCustomization", () => ({
  parseCssToStyle: (css: string) => {
    if (css === "color: red") return { color: "red" };
    return {};
  },
}));

describe("HeaderUsername", () => {
  it("returns null when no profile data", () => {
    mockGetProfile.mockReturnValue(null);
    mockLoadProfile.mockResolvedValue(undefined);
    const { container } = render(<HeaderUsername userId="user-1" />);
    expect(container.innerHTML).toBe("");
  });

  it("renders username from cached profile", async () => {
    mockGetProfile.mockReturnValue({ username: "alice", color: "", customization: null });
    render(<HeaderUsername userId="user-1" />);
    expect(screen.getByText("alice")).toBeInTheDocument();
  });

  it("loads profile from API when not cached", async () => {
    mockGetProfile.mockReturnValue(null);
    mockLoadProfile.mockResolvedValue({ username: "bob", color: "purple", customization: null });
    render(<HeaderUsername userId="user-1" />);
    await screen.findByText("bob");
    expect(mockLoadProfile).toHaveBeenCalledWith("user-1");
  });

  it("applies color class", () => {
    mockGetProfile.mockReturnValue({ username: "colored", color: "purple", customization: null });
    render(<HeaderUsername userId="user-1" />);
    const el = screen.getByText("colored");
    expect(el.className).toContain("text-purple-500");
  });

  it("applies custom CSS style from customization", () => {
    mockGetProfile.mockReturnValue({
      username: "styled",
      color: "",
      customization: { username_css: "color: red" },
    });
    render(<HeaderUsername userId="user-1" />);
    const el = screen.getByText("styled");
    expect(el.style.color).toBe("red");
  });

  it("renders username icon SVG when present", () => {
    mockGetProfile.mockReturnValue({
      username: "icon_user",
      color: "",
      customization: { username_icon_svg: '<svg></svg>' },
    });
    render(<HeaderUsername userId="user-1" />);
    expect(screen.getByText("icon_user")).toBeInTheDocument();
  });

  it("shows 'Профиль' when username is empty", () => {
    mockGetProfile.mockReturnValue({ username: "", color: "", customization: null });
    render(<HeaderUsername userId="user-1" />);
    expect(screen.getByText("Профиль")).toBeInTheDocument();
  });

  it("navigates to profile on click", async () => {
    mockGetProfile.mockReturnValue({ username: "clickable", color: "", customization: null });
    const user = userEvent.setup();
    render(<HeaderUsername userId="user-1" />);
    await user.click(screen.getByText("clickable"));
    expect(mockNavigate).toHaveBeenCalledWith("/profile/user-1");
  });

  it("renders admin badge", () => {
    mockGetProfile.mockReturnValue({ username: "admin", color: "", customization: null });
    render(<HeaderUsername userId="user-1" />);
    expect(screen.getByTestId("admin-badge")).toBeInTheDocument();
  });
});
