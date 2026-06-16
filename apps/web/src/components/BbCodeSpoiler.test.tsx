import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "vitest";
import { BbCodeSpoiler } from "./BbCodeSpoiler";

describe("BbCodeSpoiler", () => {
  it("renders with default title", () => {
    render(<BbCodeSpoiler>Hidden content</BbCodeSpoiler>);
    expect(screen.getByText("Spoiler")).toBeInTheDocument();
  });

  it("renders with custom title", () => {
    render(<BbCodeSpoiler title="My Spoiler">Hidden content</BbCodeSpoiler>);
    expect(screen.getByText("My Spoiler")).toBeInTheDocument();
  });

  it("hides content by default", () => {
    render(<BbCodeSpoiler>Secret text</BbCodeSpoiler>);
    const spoilerTarget = screen.getByText("Secret text").closest(".SpoilerTarget");
    expect(spoilerTarget).toHaveStyle({ display: "none" });
  });

  it("reveals content on click", async () => {
    const user = userEvent.setup();
    render(<BbCodeSpoiler>Secret text</BbCodeSpoiler>);
    await user.click(screen.getByText("Spoiler"));
    const spoilerTarget = screen.getByText("Secret text").closest(".SpoilerTarget");
    expect(spoilerTarget).toHaveStyle({ display: "block" });
  });

  it("toggles content on repeated clicks", async () => {
    const user = userEvent.setup();
    render(<BbCodeSpoiler>Secret text</BbCodeSpoiler>);
    const btn = screen.getByText("Spoiler");
    await user.click(btn);
    await user.click(btn);
    const spoilerTarget = screen.getByText("Secret text").closest(".SpoilerTarget");
    expect(spoilerTarget).toHaveStyle({ display: "none" });
  });

  it("shows arrow indicator", () => {
    render(<BbCodeSpoiler>Content</BbCodeSpoiler>);
    expect(screen.getByText("▾")).toBeInTheDocument();
  });
});
