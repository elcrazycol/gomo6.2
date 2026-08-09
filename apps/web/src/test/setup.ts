import "@testing-library/jest-dom/vitest";

// Polyfill ResizeObserver for jsdom (used by Radix UI components)
if (typeof window !== "undefined" && !window.ResizeObserver) {
  window.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any;
}

// Polyfill scrollIntoView for jsdom
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// Polyfill matchMedia for jsdom (required by embla-carousel)
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// Polyfill IntersectionObserver for jsdom (attachment lazy loading + embla)
if (typeof window !== "undefined" && !window.IntersectionObserver) {
  class IntersectionObserverMock {
    readonly root = null;
    readonly rootMargin = "";
    readonly thresholds: number[] = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  window.IntersectionObserver = IntersectionObserverMock as unknown as typeof window.IntersectionObserver;
}

// Polyfill PointerEvent for jsdom: fireEvent.pointer* builds a plain Event
// otherwise, dropping clientX/clientY/pointerId, which silently no-ops the
// lightbox pan/crop drag handlers (NaN coordinates). MouseEvent already
// carries clientX/clientY; we only need to expose the pointer-specific fields.
if (typeof window !== "undefined" && !window.PointerEvent) {
  class PointerEventPolyfill extends window.MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? "mouse";
      this.isPrimary = init.isPrimary ?? true;
    }
  }
  window.PointerEvent = PointerEventPolyfill as unknown as typeof window.PointerEvent;
}