import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { CensorBlur } from "./CensorBlur";

describe("CensorBlur", () => {
  it("renders children with blur by default", () => {
    const { container } = render(<CensorBlur>Secret text</CensorBlur>);
    const spoiler = container.querySelector(".CensorSpoiler");
    expect(spoiler).toBeInTheDocument();
    expect(spoiler).toHaveStyle({ filter: "blur(5px)" });
  });

  it("shows reveal title when not revealed", () => {
    render(<CensorBlur>Secret</CensorBlur>);
    expect(screen.getByTitle("Нажмите, чтобы раскрыть")).toBeInTheDocument();
  });

  it("reveals content on click", async () => {
    const { container } = render(<CensorBlur>Secret text</CensorBlur>);
    fireEvent.click(screen.getByRole("button"));
    const spoiler = container.querySelector(".CensorSpoiler");
    expect(spoiler).toHaveStyle({ filter: "blur(0px)" });
  });

  it("removes title after reveal", () => {
    render(<CensorBlur>Secret</CensorBlur>);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByTitle("Нажмите, чтобы раскрыть")).not.toBeInTheDocument();
  });

  it("sets aria-pressed to true after reveal", () => {
    render(<CensorBlur>Secret</CensorBlur>);
    const btn = screen.getByRole("button");
    expect(btn).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-pressed", "true");
  });

  it("reveals on Enter key", () => {
    const { container } = render(<CensorBlur>Secret</CensorBlur>);
    fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });
    const spoiler = container.querySelector(".CensorSpoiler");
    expect(spoiler).toHaveStyle({ filter: "blur(0px)" });
  });

  it("reveals on Space key", () => {
    const { container } = render(<CensorBlur>Secret</CensorBlur>);
    fireEvent.keyDown(screen.getByRole("button"), { key: " " });
    const spoiler = container.querySelector(".CensorSpoiler");
    expect(spoiler).toHaveStyle({ filter: "blur(0px)" });
  });

  it("does not re-blur after reveal", () => {
    const { container } = render(<CensorBlur>Secret</CensorBlur>);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("button"));
    const spoiler = container.querySelector(".CensorSpoiler");
    expect(spoiler).toHaveStyle({ filter: "blur(0px)" });
  });
});
