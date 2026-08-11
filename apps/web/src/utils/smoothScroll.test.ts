import { describe, it, expect, vi, afterEach } from "vitest";
import { shouldScrollToComments, smoothScrollToElement } from "./smoothScroll";

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

describe("shouldScrollToComments", () => {
  const elAt = (top: number) =>
    ({ getBoundingClientRect: () => ({ top, bottom: top + 100, height: 100 }) }) as unknown as Element;

  it("nudges down when the comments start far below the target line", () => {
    expect(shouldScrollToComments(elAt(800), 1000)).toBe(true);
  });

  it("does not move when the comments already start high on screen", () => {
    expect(shouldScrollToComments(elAt(200), 1000)).toBe(false);
  });

  it("ignores small gaps inside the dead zone to avoid jitter", () => {
    // target line = 35% of 1000 = 350, dead zone 64 → threshold 414.
    expect(shouldScrollToComments(elAt(400), 1000)).toBe(false);
    expect(shouldScrollToComments(elAt(500), 1000)).toBe(true);
  });

  it("honors custom target fraction and dead zone", () => {
    expect(shouldScrollToComments(elAt(700), 1000, { targetFraction: 0.5, deadZone: 32 })).toBe(true);
    expect(shouldScrollToComments(elAt(520), 1000, { targetFraction: 0.5, deadZone: 32 })).toBe(false);
  });

  it("never nudges past the bottom — clamping happens in the scroll helper", () => {
    // A top near the viewport bottom still qualifies; smoothScrollToElement
    // clamps the final position to the max scrollable offset.
    expect(shouldScrollToComments(elAt(900), 1000)).toBe(true);
  });
});
