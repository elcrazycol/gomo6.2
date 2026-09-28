import { act, render } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

import { TransitionPreview } from "./TransitionPreview";

const HALF_LOOP = 1100;
const LOOP = 2200;

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

  it("swaps the scene at the centre of the rail and alternates direction", () => {
    vi.useFakeTimers();
    const { container } = render(<TransitionPreview style="slide" />);

    // Page 1 is on screen until the head reaches the centre.
    expect(container.querySelector(".vt-preview-scene")?.getAttribute("data-direction")).toBe(
      "back",
    );

    act(() => {
      vi.advanceTimersByTime(HALF_LOOP);
    });
    expect(container.querySelector(".vt-preview-scene")?.getAttribute("data-direction")).toBe(
      "forward",
    );

    act(() => {
      vi.advanceTimersByTime(LOOP);
    });
    expect(container.querySelector(".vt-preview-scene")?.getAttribute("data-direction")).toBe(
      "back",
    );
  });

  it("renders the rail with a page dot at each end and a centre marker", () => {
    vi.useFakeTimers();
    const { container } = render(<TransitionPreview style="fade" />);

    expect(container.querySelectorAll(".vt-preview-track-dot")).toHaveLength(2);
    expect(container.querySelector(".vt-preview-track-center")).not.toBeNull();
    expect(container.querySelector(".vt-preview-track-head")).not.toBeNull();
  });
});
