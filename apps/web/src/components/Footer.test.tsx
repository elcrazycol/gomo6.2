import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { Footer } from "./Footer";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Footer", () => {
  it("shows product version and short commit hash when injected", () => {
    vi.stubEnv("VITE_APP_VERSION", "2.0.0");
    vi.stubEnv("VITE_GIT_COMMIT", "deadbeefcafe1234");

    render(<Footer />);

    expect(screen.getByText("v2.0.0")).toBeInTheDocument();
    expect(screen.getByTitle("Deployed commit: deadbeefcafe1234")).toBeInTheDocument();
    expect(screen.getByText("deadbee")).toBeInTheDocument();
  });

  it("hides version and hash when build env is unset", () => {
    vi.stubEnv("VITE_APP_VERSION", "unknown");
    vi.stubEnv("VITE_GIT_COMMIT", "unknown");

    render(<Footer />);

    expect(screen.queryByText(/v\d/)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/Deployed commit/)).not.toBeInTheDocument();
  });
});