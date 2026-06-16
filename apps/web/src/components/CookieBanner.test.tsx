import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CookieBanner } from "./CookieBanner";

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, variant, size, className, ...props }: any) => (
    <button onClick={onClick} data-variant={variant} className={className} {...props}>{children}</button>
  ),
}));

describe("CookieBanner", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not show when cookies already accepted", () => {
    localStorage.setItem("cookies-accepted", "true");
    render(<CookieBanner />);
    expect(screen.queryByText("куки")).not.toBeInTheDocument();
  });

  it("shows banner after delay when no prior acceptance", () => {
    render(<CookieBanner />);
    expect(screen.queryByText("куки")).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByText(/куки/)).toBeInTheDocument();
  });

  it("stores acceptance in localStorage when clicking accept", async () => {
    render(<CookieBanner />);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    const acceptBtn = screen.getByText("Принять");
    act(() => {
      acceptBtn.click();
    });

    expect(localStorage.getItem("cookies-accepted")).toBe("true");
    expect(screen.queryByText("куки")).not.toBeInTheDocument();
  });

  it("hides banner when clicking close button", async () => {
    render(<CookieBanner />);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    const closeBtn = screen.getByRole("button", { name: "" });
    act(() => {
      closeBtn.click();
    });

    expect(screen.queryByText("куки")).not.toBeInTheDocument();
  });

  it("links to privacy policy", async () => {
    render(<CookieBanner />);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    const link = screen.getByRole("link", { name: /политикой конфиденциальности/ });
    expect(link).toHaveAttribute("href", "/rules");
  });
});
