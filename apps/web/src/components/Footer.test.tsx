import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Footer } from "./Footer";

describe("Footer", () => {
  it("renders copyright", () => {
    render(<Footer />);
    expect(screen.getByText(/© 2026 gomo6/)).toBeInTheDocument();
  });

  it("renders Dev link", () => {
    render(<Footer />);
    const devLink = screen.getByRole("link", { name: "Dev" });
    expect(devLink).toBeInTheDocument();
    expect(devLink).toHaveAttribute("target", "_blank");
  });

  it("renders Docs link", () => {
    render(<Footer />);
    const docsLink = screen.getByRole("link", { name: "Docs" });
    expect(docsLink).toBeInTheDocument();
    expect(docsLink).toHaveAttribute("target", "_blank");
  });
});
