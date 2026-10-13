import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ForumProfileEdgeToggle } from "./ForumProfileEdgeToggle";

describe("ForumProfileEdgeToggle", () => {
  it("is invisible until the gutter is hovered when it only expands", () => {
    render(<ForumProfileEdgeToggle side="left" active={false} onToggle={() => {}} />);
    // Barely there: with no hover the glyph stays transparent, so the social
    // layout is not cluttered by a control that is only discovered on approach.
    expect(screen.getByTestId("forum-edge-chevron").getAttribute("class")).toContain("opacity-0");
  });

  it("keeps the chevron visible while its side hosts the forum panel", () => {
    render(<ForumProfileEdgeToggle side="right" active onToggle={() => {}} />);
    const chevronClass = screen.getByTestId("forum-edge-chevron").getAttribute("class") ?? "";
    expect(chevronClass).not.toContain("opacity-0");
    expect(chevronClass).toContain("opacity-70");
  });

  it("keeps the click target small instead of covering the whole gutter strip", () => {
    render(
      <ForumProfileEdgeToggle side="left" active={false} onToggle={() => {}} gutterWidth="400px" />,
    );
    const button = screen.getByTestId("forum-edge-button");
    // The gutter is only the positioning context now: the button is a small
    // control pinned beside the content column, not a full-height strip.
    expect(button.className).not.toContain("inset-y-0");
    expect(button.className).toContain("h-9");
  });

  it("reports its own side on click", () => {
    const onToggle = vi.fn();
    render(<ForumProfileEdgeToggle side="left" active={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByTestId("forum-edge-button"));
    expect(onToggle).toHaveBeenCalledWith("left");
  });

  it("labels the expand and collapse states", () => {
    const { rerender } = render(<ForumProfileEdgeToggle side="left" active={false} onToggle={() => {}} />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-label", "Развернуть в форумный режим");
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "false");

    rerender(<ForumProfileEdgeToggle side="left" active onToggle={() => {}} />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-label", "Свернуть в режим соцсети");
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  });
});
