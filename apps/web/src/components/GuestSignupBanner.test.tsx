import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GuestSignupBanner } from "./GuestSignupBanner";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, className }: any) => (
    <button type="button" onClick={onClick} className={className}>
      {children}
    </button>
  ),
}));

describe("GuestSignupBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it("renders the signup CTA for guests", () => {
    render(<GuestSignupBanner />);
    expect(screen.getByText(/Зарегистрируйся/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Создать аккаунт" })).toBeInTheDocument();
  });

  it("navigates to /auth when the CTA is clicked", () => {
    render(<GuestSignupBanner />);
    fireEvent.click(screen.getByRole("button", { name: "Создать аккаунт" }));
    expect(mockNavigate).toHaveBeenCalledWith("/auth");
  });

  it("hides after dismissal and remembers it for the session", () => {
    const { unmount } = render(<GuestSignupBanner />);
    fireEvent.click(screen.getByRole("button", { name: "Скрыть предложение зарегистрироваться" }));

    expect(sessionStorage.getItem("guest-signup-banner-dismissed")).toBe("1");
    expect(screen.queryByText(/Зарегистрируйся/)).not.toBeInTheDocument();

    unmount();
    render(<GuestSignupBanner />);
    expect(screen.queryByText(/Зарегистрируйся/)).not.toBeInTheDocument();
  });
});
