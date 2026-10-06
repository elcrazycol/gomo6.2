import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, afterEach } from "vitest";
import { Footer } from "./Footer";

const renderFooter = () =>
  render(
    <MemoryRouter>
      <Footer />
    </MemoryRouter>,
  );

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Footer", () => {
  it("shows product version and short commit hash when injected", () => {
    vi.stubEnv("VITE_APP_VERSION", "2.0.0");
    vi.stubEnv("VITE_GIT_COMMIT", "deadbeefcafe1234");

    renderFooter();

    expect(screen.getByText("v2.0.0")).toBeInTheDocument();
    expect(screen.getByTitle("Deployed commit: deadbeefcafe1234")).toBeInTheDocument();
    expect(screen.getByText("deadbee")).toBeInTheDocument();
  });

  it("hides version and hash when build env is unset", () => {
    vi.stubEnv("VITE_APP_VERSION", "unknown");
    vi.stubEnv("VITE_GIT_COMMIT", "unknown");

    renderFooter();

    expect(screen.queryByText(/v\d/)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/Deployed commit/)).not.toBeInTheDocument();
  });

  it("links to the legal documents", () => {
    vi.stubEnv("VITE_APP_VERSION", "unknown");
    vi.stubEnv("VITE_GIT_COMMIT", "unknown");

    renderFooter();

    expect(screen.getByRole("link", { name: "Соглашение" })).toHaveAttribute("href", "/legal/terms");
    expect(screen.getByRole("link", { name: "Конфиденциальность" })).toHaveAttribute(
      "href",
      "/legal/privacy",
    );
    expect(screen.getByRole("link", { name: "Правила" })).toHaveAttribute("href", "/legal/rules");
  });
});
