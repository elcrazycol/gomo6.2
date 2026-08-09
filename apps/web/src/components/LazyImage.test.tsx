import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { LazyImage } from "./LazyImage";

type ObserveCallback = IntersectionObserverCallback;

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  callback: ObserveCallback;
  observed: Element[] = [];
  constructor(callback: ObserveCallback) {
    this.callback = callback;
    MockIntersectionObserver.instances.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
  /** Fire the callback with every observed element marked intersecting. */
  trigger() {
    act(() => {
      this.callback(
        this.observed.map(
          (target) => ({ isIntersecting: true, target, intersectionRatio: 1 }) as IntersectionObserverEntry,
        ),
        this as unknown as IntersectionObserver,
      );
    });
  }
}

function lastObserver() {
  return MockIntersectionObserver.instances[MockIntersectionObserver.instances.length - 1];
}

describe("LazyImage", () => {
  beforeEach(() => {
    MockIntersectionObserver.instances = [];
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the placeholder and defers the real image until the container intersects", () => {
    const { container } = render(<LazyImage src="photo.jpg" alt="Photo" />);
    // Placeholder is rendered, real image is not yet.
    expect(container.querySelector("img[alt='']")).not.toBeNull();
    expect(container.querySelector("img[alt='Photo']")).toBeNull();
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/placeholder.svg");
  });

  it("observes the container element, not the gated img", () => {
    render(<LazyImage src="photo.jpg" alt="Photo" />);
    const observer = lastObserver();
    expect(observer.observed).toHaveLength(1);
    // Regression: the observed node must be the container div. The main <img>
    // only exists after isInView, so observing it would never fire.
    expect(observer.observed[0].tagName).toBe("DIV");
  });

  it("loads the real image once the container is in view", () => {
    const { container } = render(<LazyImage src="photo.jpg" alt="Photo" />);
    lastObserver().trigger();
    const img = container.querySelector("img[alt='Photo']");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("photo.jpg");
    expect(img?.getAttribute("loading")).toBe("lazy");
  });

  it("calls onLoad and swaps the placeholder for the loaded image", () => {
    const onLoad = vi.fn();
    const { container } = render(<LazyImage src="photo.jpg" alt="Photo" onLoad={onLoad} />);
    lastObserver().trigger();
    const img = container.querySelector("img[alt='Photo']") as HTMLImageElement;
    expect(img).not.toBeNull();
    fireEvent.load(img);
    expect(onLoad).toHaveBeenCalledTimes(1);
    // Placeholder gone once loaded.
    expect(container.querySelector("img[alt='']")).toBeNull();
  });

  it("calls onError and shows the fallback when the image fails", () => {
    const onError = vi.fn();
    const { container } = render(<LazyImage src="broken.jpg" alt="Photo" onError={onError} />);
    lastObserver().trigger();
    const img = container.querySelector("img[alt='Photo']") as HTMLImageElement;
    fireEvent.error(img);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Изображение не загрузилось");
    expect(container.querySelector("img[alt='']")).toBeNull();
  });

  it("disconnects the observer on unmount", () => {
    const { unmount } = render(<LazyImage src="photo.jpg" alt="Photo" />);
    const observer = lastObserver();
    const disconnect = vi.spyOn(observer, "disconnect");
    unmount();
    expect(disconnect).toHaveBeenCalled();
  });
});
