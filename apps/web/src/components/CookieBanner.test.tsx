import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { CookieBanner } from "./CookieBanner";

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, variant, size, className, ...props }: any) => (
    <button onClick={onClick} data-variant={variant} className={className} {...props}>
      {children}
    </button>
  ),
}));

const CONSENT_KEY = "gomo6:cookie-consent";
const readConsent = () => JSON.parse(localStorage.getItem(CONSENT_KEY) || "null");

const show = () =>
  act(() => {
    vi.advanceTimersByTime(700);
  });

describe("CookieBanner", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not show once a choice has been made", () => {
    localStorage.setItem(
      CONSENT_KEY,
      JSON.stringify({ version: 1, necessary: true, analytics: true, ts: 1 }),
    );
    render(<CookieBanner />);
    show();
    expect(screen.queryByText("Мы используем куки")).not.toBeInTheDocument();
  });

  it("shows after the delay when nothing was chosen yet", () => {
    render(<CookieBanner />);
    expect(screen.queryByText("Мы используем куки")).not.toBeInTheDocument();
    show();
    expect(screen.getByText("Мы используем куки")).toBeInTheDocument();
  });

  it("«Принять все» grants analytics and hides the banner", () => {
    render(<CookieBanner />);
    show();

    act(() => {
      screen.getByRole("button", { name: "Принять все" }).click();
    });

    expect(readConsent().analytics).toBe(true);
    expect(screen.queryByText("Мы используем куки")).not.toBeInTheDocument();
  });

  it("«Только необходимые» records a rejection", () => {
    render(<CookieBanner />);
    show();

    act(() => {
      screen.getByRole("button", { name: "Только необходимые" }).click();
    });

    expect(readConsent().analytics).toBe(false);
  });

  it("«Настроить» reveals the categories and saves a custom choice", () => {
    render(<CookieBanner />);
    show();

    act(() => {
      screen.getByRole("button", { name: /Настроить/ }).click();
    });

    expect(screen.getByText("Необходимые")).toBeInTheDocument();
    expect(screen.getByText("Аналитика")).toBeInTheDocument();

    act(() => {
      screen.getByRole("switch", { name: "Аналитика" }).click();
    });
    act(() => {
      screen.getByRole("button", { name: "Сохранить выбор" }).click();
    });

    expect(readConsent().analytics).toBe(true);
    expect(screen.queryByText("Мы используем куки")).not.toBeInTheDocument();
  });

  it("re-opens into the settings view from the footer event", () => {
    localStorage.setItem(
      CONSENT_KEY,
      JSON.stringify({ version: 1, necessary: true, analytics: false, ts: 1 }),
    );
    render(<CookieBanner />);
    expect(screen.queryByText("Мы используем куки")).not.toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new Event("gomo6:open-cookie-settings"));
    });

    expect(screen.getByText("Мы используем куки")).toBeInTheDocument();
    expect(screen.getByText("Аналитика")).toBeInTheDocument();
  });
});
