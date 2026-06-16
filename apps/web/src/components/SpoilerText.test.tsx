import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { SpoilerText } from "./SpoilerText";

describe("SpoilerText", () => {
  it("renders blocked characters by default", () => {
    render(<SpoilerText content="hello" />);
    expect(screen.getByText("█████")).toBeInTheDocument();
  });

  it("shows reveal title", () => {
    render(<SpoilerText content="hello" />);
    expect(screen.getByTitle("Нажмите, чтобы раскрыть")).toBeInTheDocument();
  });

  it("reveals content on click", () => {
    render(<SpoilerText content="hello" />);
    fireEvent.click(screen.getByText("█████"));
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("removes title after reveal", () => {
    render(<SpoilerText content="hello" />);
    fireEvent.click(screen.getByText("█████"));
    expect(screen.queryByTitle("Нажмите, чтобы раскрыть")).not.toBeInTheDocument();
  });

  it("shows correct number of blocked chars", () => {
    render(<SpoilerText content="ab" />);
    expect(screen.getByText("██")).toBeInTheDocument();
  });

  it("applies hidden style when not revealed", () => {
    render(<SpoilerText content="test" />);
    const el = screen.getByText("████");
    expect(el.className).toContain("bg-foreground");
    expect(el.className).toContain("cursor-pointer");
  });

  it("applies transparent style when revealed", () => {
    render(<SpoilerText content="test" />);
    fireEvent.click(screen.getByText("████"));
    const el = screen.getByText("test");
    expect(el.className).toContain("bg-transparent");
  });
});
