import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { AnimatedVideo } from "./AnimatedVideo";
import { useAnimatedVideoStore } from "@/stores/animatedVideoStore";

type EntryInit = { isIntersecting?: boolean; intersectionRatio?: number };

const RECT = {
  top: 100,
  bottom: 300,
  height: 200,
  left: 0,
  right: 400,
  width: 400,
  x: 0,
  y: 100,
  toJSON: () => ({}),
} as DOMRect;

/** jsdom has no IntersectionObserver, so we drive the callbacks by hand. */
class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  callback: IntersectionObserverCallback;
  options: IntersectionObserverInit;
  elements = new Set<Element>();

  constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit = {}) {
    this.callback = callback;
    this.options = options;
    MockIntersectionObserver.instances.push(this);
  }

  observe(el: Element) {
    this.elements.add(el);
  }
  unobserve(el: Element) {
    this.elements.delete(el);
  }
  disconnect() {
    this.elements.clear();
  }
  takeRecords() {
    return [];
  }
  fire(init: EntryInit = {}) {
    const entry = {
      isIntersecting: init.isIntersecting ?? true,
      intersectionRatio: init.intersectionRatio ?? 1,
      target: [...this.elements][0],
      boundingClientRect: RECT,
    } as unknown as IntersectionObserverEntry;
    this.callback([entry], this as unknown as IntersectionObserver);
  }
}

const nearObserver = () =>
  MockIntersectionObserver.instances.find((o) => o.options.rootMargin === "300px");
const visibleObserver = () =>
  MockIntersectionObserver.instances.find((o) => Array.isArray(o.options.threshold));

const video = () => document.querySelector("video") as HTMLVideoElement;

describe("AnimatedVideo", () => {
  beforeEach(() => {
    MockIntersectionObserver.instances = [];
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(RECT);
    useAnimatedVideoStore.setState({ candidates: new Map(), activeIds: [], autoplayMode: "always" });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("loads only when near, then autoplays once half visible", async () => {
    render(<AnimatedVideo src="blob:test" />);

    // Far away: no source attached yet.
    expect(video().getAttribute("src")).toBeNull();

    act(() => nearObserver()?.fire({ isIntersecting: true }));
    expect(video().getAttribute("src")).toBe("blob:test");

    act(() => visibleObserver()?.fire({ intersectionRatio: 1 }));
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
  });

  it("stays paused while off screen", async () => {
    render(<AnimatedVideo src="blob:test" />);
    act(() => nearObserver()?.fire({ isIntersecting: true }));
    act(() => visibleObserver()?.fire({ intersectionRatio: 0 }));

    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it("falls back to a play button when autoplay is blocked", async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValue(
      new DOMException("blocked", "NotAllowedError"),
    );
    render(<AnimatedVideo src="blob:test" />);

    act(() => nearObserver()?.fire({ isIntersecting: true }));
    act(() => visibleObserver()?.fire({ intersectionRatio: 1 }));

    expect(await screen.findByLabelText("Воспроизвести")).toBeInTheDocument();
  });
});
