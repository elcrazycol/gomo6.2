import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

import { TransitionPreview } from "./TransitionPreview";

describe("TransitionPreview", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the mock scene for the requested style", () => {
    vi.useFakeTimers(); // keep the auto-loop from firing mid-test
    const { container } = render(<TransitionPreview style="slide" />);

    const scene = container.querySelector(".vt-preview-scene");
    expect(scene).not.toBeNull();
    expect(scene?.getAttribute("data-style")).toBe("slide");
    expect(container.querySelectorAll(".vt-preview-layer")).toHaveLength(2);
  });

  it("flips the slide direction on replay so both ways are shown", () => {
    vi.useFakeTimers();
    const { container } = render(<TransitionPreview style="slide" />);

    expect(container.querySelector(".vt-preview-scene")?.getAttribute("data-direction")).toBe(
      "forward",
    );

    fireEvent.click(screen.getByRole("button", { name: /показать/i }));

    expect(container.querySelector(".vt-preview-scene")?.getAttribute("data-direction")).toBe(
      "back",
    );
    expect(screen.getByRole("button", { name: /ещё раз/i })).toBeInTheDocument();
  });
});
