import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
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
    localStorage.removeItem("gomo6:cookie-consent");
    localStorage.removeItem("cookies-accepted");
  });

  afterEach(() => {
    cleanup();
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

  it("floats above the cookie banner while cookies are not accepted", () => {
    render(<GuestSignupBanner />);
    // With the cookie strip still visible the CTA must be raised above it
    // (bottom-24 on mobile / bottom-20 on larger screens instead of the
    // bottom-3/bottom-4 rest position).
    expect(screen.getByText(/Зарегистрируйся/).closest(".fixed")?.className).toContain("bottom-24");
    expect(screen.getByText(/Зарегистрируйся/).closest(".fixed")?.className).toContain("z-[60]");
  });

  it("settles to the bottom edge once a cookie choice is made", () => {
    localStorage.setItem(
      "gomo6:cookie-consent",
      JSON.stringify({ version: 1, necessary: true, analytics: false, ts: 1 }),
    );
    render(<GuestSignupBanner />);
    expect(screen.getByText(/Зарегистрируйся/).closest(".fixed")?.className).toContain("bottom-3");
  });

  it("moves down when the cookie consent changes", () => {
    render(<GuestSignupBanner />);
    expect(screen.getByText(/Зарегистрируйся/).closest(".fixed")?.className).toContain("bottom-24");

    act(() => {
      localStorage.setItem(
        "gomo6:cookie-consent",
        JSON.stringify({ version: 1, necessary: true, analytics: false, ts: 1 }),
      );
      window.dispatchEvent(new Event("gomo6:cookie-consent-changed"));
    });
    expect(screen.getByText(/Зарегистрируйся/).closest(".fixed")?.className).toContain("bottom-3");
  });
});
