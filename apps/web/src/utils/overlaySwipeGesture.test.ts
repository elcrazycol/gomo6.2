import { describe, expect, it, vi } from "vitest";

import { canStartOverlayDrag } from "./overlaySwipeGesture";

describe("canStartOverlayDrag", () => {
  it("allows a swipe that starts on plain post content", () => {
    const paragraph = document.createElement("p");
    document.body.appendChild(paragraph);
    expect(canStartOverlayDrag(paragraph)).toBe(true);
    paragraph.remove();
  });

  it("blocks a swipe that starts on the before/after compare slider", () => {
    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-compare-wrapper", "true");
    const handle = document.createElement("div");
    handle.setAttribute("data-compare-handle", "true");
    wrapper.appendChild(handle);
    document.body.appendChild(wrapper);

    // Both the handle itself and anything inside the compare frame own the
    // horizontal gesture — dragging them must not close the post.
    expect(canStartOverlayDrag(handle)).toBe(false);
    expect(canStartOverlayDrag(wrapper)).toBe(false);

    wrapper.remove();
  });

  it("blocks a swipe that starts on an interactive control", () => {
    const button = document.createElement("button");
    document.body.appendChild(button);
    expect(canStartOverlayDrag(button)).toBe(false);
    button.remove();
  });

  it("respects an explicit data-no-swipe-close opt-out", () => {
    const zone = document.createElement("div");
    zone.setAttribute("data-no-swipe-close", "true");
    const child = document.createElement("span");
    zone.appendChild(child);
    document.body.appendChild(zone);

    expect(canStartOverlayDrag(child)).toBe(false);

    zone.remove();
  });

  it("blocks a swipe that starts inside a horizontally scrollable container", () => {
    const carousel = document.createElement("div");
    const child = document.createElement("span");
    carousel.appendChild(child);
    document.body.appendChild(carousel);
    Object.defineProperty(carousel, "scrollWidth", { value: 600, configurable: true });
    Object.defineProperty(carousel, "clientWidth", { value: 300, configurable: true });

    const styleSpy = vi
      .spyOn(window, "getComputedStyle")
      .mockReturnValue({ overflowX: "auto" } as unknown as CSSStyleDeclaration);

    expect(canStartOverlayDrag(child)).toBe(false);

    styleSpy.mockRestore();
    carousel.remove();
  });

  it("rejects non-element targets", () => {
    expect(canStartOverlayDrag(null)).toBe(false);
    expect(canStartOverlayDrag(window)).toBe(false);
  });
});
