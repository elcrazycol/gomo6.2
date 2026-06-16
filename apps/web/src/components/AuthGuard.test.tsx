import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { AuthGuard } from "./AuthGuard";

const mockNavigate = vi.fn();
const mockUseAuth = vi.fn();

vi.mock("react-router-dom", () => ({
  Navigate: ({ to, replace }: any) => <div data-testid="navigate" data-to={to} data-replace={replace} />,
  useLocation: () => ({ pathname: "/secret", search: "?tab=1" }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("@/components/PentagramLoader", () => ({
  PentagramLoader: () => <div data-testid="loader" />,
}));

describe("AuthGuard", () => {
  it("shows loader when loading", () => {
    mockUseAuth.mockReturnValue({ user: null, isLoading: true });
    render(<AuthGuard><div>children</div></AuthGuard>);
    expect(screen.getByTestId("loader")).toBeInTheDocument();
  });

  it("redirects to /auth when not authenticated", () => {
    mockUseAuth.mockReturnValue({ user: null, isLoading: false });
    render(<AuthGuard><div>children</div></AuthGuard>);
    const nav = screen.getByTestId("navigate");
    expect(nav).toHaveAttribute("data-to", expect.stringContaining("/auth?redirect="));
  });

  it("encodes current path in redirect", () => {
    mockUseAuth.mockReturnValue({ user: null, isLoading: false });
    render(<AuthGuard><div>children</div></AuthGuard>);
    const nav = screen.getByTestId("navigate");
    expect(nav.getAttribute("data-to")).toContain(encodeURIComponent("/secret?tab=1"));
  });

  it("renders children when authenticated", () => {
    mockUseAuth.mockReturnValue({ user: { id: "u1" }, isLoading: false });
    render(<AuthGuard><div>protected content</div></AuthGuard>);
    expect(screen.getByText("protected content")).toBeInTheDocument();
  });
});
