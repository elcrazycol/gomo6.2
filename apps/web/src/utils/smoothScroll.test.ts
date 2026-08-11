import { describe, it, expect, vi, afterEach } from "vitest";
import { smoothScrollToElement } from "./smoothScroll";

describe("smoothScrollToElement", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to an instant scrollIntoView under reduced motion", () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (() => ({ matches: true })) as unknown as typeof window.matchMedia,
    );
    const el = document.createElement("div");
    const scrollIntoView = vi.fn();
    el.scrollIntoView = scrollIntoView as unknown as typeof el.scrollIntoView;

    smoothScrollToElement(el, { block: "center" });

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "center" });
  });

  it("bails out silently in jsdom where there is nowhere to scroll", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    // jsdom geometry is all zeroes → no measurable delta → must not throw.
    expect(() => smoothScrollToElement(el, { block: "center", duration: 100 })).not.toThrow();
    document.body.removeChild(el);
  });
});
