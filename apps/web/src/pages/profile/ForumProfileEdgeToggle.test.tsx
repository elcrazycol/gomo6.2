import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ForumProfileEdgeToggle } from "./ForumProfileEdgeToggle";

describe("ForumProfileEdgeToggle", () => {
  it("renders an expand button when its side is inactive", () => {
    render(<ForumProfileEdgeToggle side="left" active={false} onToggle={() => {}} />);
    const button = screen.getByRole("button", { name: "Развернуть в форумный режим" });
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("labels the button for collapse and marks it pressed when active", () => {
    render(<ForumProfileEdgeToggle side="right" active onToggle={() => {}} />);
    const button = screen.getByRole("button", { name: "Свернуть в режим соцсети" });
    expect(button).toHaveAttribute("aria-pressed", "true");
  });

  it("reports its own side on click", () => {
    const onToggle = vi.fn();
    render(<ForumProfileEdgeToggle side="left" active={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalledWith("left");
  });
});
