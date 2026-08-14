import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  computeContainerScrollDelta,
  computeDismissalFrame,
  computeKeyboardMetrics,
  computeWindowScrollDelta,
  getScrollContext,
  initMobileKeyboard,
  isBeyondTouchSlop,
  isEditableElement,
  isIOSDevice,
  isLockedGestureTarget,
} from "./mobileKeyboard";

describe("isIOSDevice", () => {
  it("detects iPhone and iPad user agents", () => {
    expect(isIOSDevice({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari", platform: "iPhone", maxTouchPoints: 5 })).toBe(true);
    expect(isIOSDevice({ userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Safari", platform: "iPad", maxTouchPoints: 5 })).toBe(true);
  });

  it("detects iPadOS 13+ which reports a desktop-style UA", () => {
    expect(isIOSDevice({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel", maxTouchPoints: 5 })).toBe(true);
  });

  it("does not flag real Macs or Android", () => {
    expect(isIOSDevice({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel", maxTouchPoints: 0 })).toBe(false);
    expect(isIOSDevice({ userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome", platform: "Linux armv8l", maxTouchPoints: 5 })).toBe(false);
  });
});

describe("computeKeyboardMetrics", () => {
  it("detects an open keyboard from the visual-viewport delta", () => {
    const m = computeKeyboardMetrics({ innerHeight: 800, visualViewportHeight: 500, isTouch: true });
    expect(m).toEqual({ isOpen: true, keyboardInset: 300, viewportHeight: 500 });
  });

  it("treats small deltas (URL bar noise) as closed", () => {
    const m = computeKeyboardMetrics({ innerHeight: 800, visualViewportHeight: 760, isTouch: true });
    expect(m).toEqual({ isOpen: false, keyboardInset: 0, viewportHeight: 760 });
  });

  it("never opens keyboard mode on non-touch (desktop) devices", () => {
    const m = computeKeyboardMetrics({ innerHeight: 800, visualViewportHeight: 500, isTouch: false });
    expect(m.isOpen).toBe(false);
    expect(m.keyboardInset).toBe(0);
    expect(m.viewportHeight).toBe(500);
  });

  it("falls back to innerHeight without a visual viewport", () => {
    const m = computeKeyboardMetrics({ innerHeight: 700, visualViewportHeight: null, isTouch: true });
    expect(m).toEqual({ isOpen: false, keyboardInset: 0, viewportHeight: 700 });
  });

  it("rounds fractional viewport heights", () => {
    const m = computeKeyboardMetrics({ innerHeight: 800.4, visualViewportHeight: 501.6, isTouch: true });
    expect(m.keyboardInset).toBe(299);
    expect(m.viewportHeight).toBe(502);
  });

  it("excludes the expanded iOS URL bar from the keyboard inset", () => {
    // URL bar expanded: the visual viewport is pushed down by 60px, so the
    // raw delta (800 − 340 = 460) over-counts the keyboard by that amount.
    // A bottom-anchored bar must only clear the true keyboard height (400).
    const m = computeKeyboardMetrics({
      innerHeight: 800,
      visualViewportHeight: 340,
      visualViewportOffsetTop: 60,
      isTouch: true,
    });
    expect(m.keyboardInset).toBe(400);
    expect(m.viewportHeight).toBe(340);
  });

  it("keeps the full delta when the URL bar is collapsed (offset 0)", () => {
    const m = computeKeyboardMetrics({
      innerHeight: 800,
      visualViewportHeight: 400,
      visualViewportOffsetTop: 0,
      isTouch: true,
    });
    expect(m.keyboardInset).toBe(400);
  });

  it("never yields a negative inset from a transient offset overshoot", () => {
    const m = computeKeyboardMetrics({
      innerHeight: 800,
      visualViewportHeight: 700,
      visualViewportOffsetTop: 120,
      isTouch: true,
    });
    expect(m.keyboardInset).toBe(0);
  });
});

describe("computeDismissalFrame", () => {
  it("keeps the open geometry at progress 0", () => {
    const frame = computeDismissalFrame({ startInset: 300, startViewportHeight: 500, endViewportHeight: 800, progress: 0 });
    expect(frame).toEqual({ keyboardInset: 300, viewportHeight: 500 });
  });

  it("reaches the closed geometry at progress 1", () => {
    const frame = computeDismissalFrame({ startInset: 300, startViewportHeight: 500, endViewportHeight: 800, progress: 1 });
    expect(frame).toEqual({ keyboardInset: 0, viewportHeight: 800 });
  });

  it("eases out: the descent is fast at first, slow at the end", () => {
    // easeOutCubic(0.5) = 1 - (1-0.5)^3 = 0.875 → inset ≈ 300 * 0.125 ≈ 38
    const half = computeDismissalFrame({ startInset: 300, startViewportHeight: 500, endViewportHeight: 800, progress: 0.5 });
    expect(half.keyboardInset).toBe(38);
    expect(half.viewportHeight).toBe(763); // 500 + 300 * 0.875
  });

  it("clamps progress outside [0,1]", () => {
    expect(computeDismissalFrame({ startInset: 300, startViewportHeight: 500, endViewportHeight: 800, progress: 2 })).toEqual({
      keyboardInset: 0,
      viewportHeight: 800,
    });
    expect(computeDismissalFrame({ startInset: 300, startViewportHeight: 500, endViewportHeight: 800, progress: -1 })).toEqual({
      keyboardInset: 300,
      viewportHeight: 500,
    });
  });
});

describe("isBeyondTouchSlop", () => {
  it("returns false for a tap (sub-slop movement)", () => {
    expect(
      isBeyondTouchSlop({ startX: 100, startY: 200, currentX: 104, currentY: 204, slopPx: 10 }),
    ).toBe(false);
  });

  it("returns true once the finger moves past the slop", () => {
    expect(
      isBeyondTouchSlop({ startX: 100, startY: 200, currentX: 106, currentY: 206, slopPx: 10 }),
    ).toBe(true);
  });

  it("returns true for a purely vertical scroll", () => {
    expect(
      isBeyondTouchSlop({ startX: 100, startY: 200, currentX: 102, currentY: 260, slopPx: 10 }),
    ).toBe(true);
  });

  it("never treats an unknown origin as a scroll", () => {
    expect(
      isBeyondTouchSlop({ startX: null, startY: null, currentX: 500, currentY: 900, slopPx: 10 }),
    ).toBe(false);
  });
});

describe("isLockedGestureTarget", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("returns false for null / non-element targets", () => {
    expect(isLockedGestureTarget(null)).toBe(false);
    expect(isLockedGestureTarget(undefined)).toBe(false);
  });

  it("returns false for ordinary elements", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    expect(isLockedGestureTarget(el)).toBe(false);
  });

  it("returns true for an element carrying data-kb-locked", () => {
    const locked = document.createElement("div");
    locked.setAttribute("data-kb-locked", "true");
    document.body.appendChild(locked);
    expect(isLockedGestureTarget(locked)).toBe(true);
  });

  it("returns true for descendants of a locked bar (the editor inside the composer)", () => {
    const locked = document.createElement("div");
    locked.setAttribute("data-kb-locked", "true");
    const editor = document.createElement("div");
    locked.appendChild(editor);
    document.body.appendChild(locked);
    expect(isLockedGestureTarget(editor)).toBe(true);
  });
});

describe("isEditableElement", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("matches input, textarea and select", () => {
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    const select = document.createElement("select");
    const div = document.createElement("div");
    expect(isEditableElement(input)).toBe(true);
    expect(isEditableElement(textarea)).toBe(true);
    expect(isEditableElement(select)).toBe(true);
    expect(isEditableElement(div)).toBe(false);
    expect(isEditableElement(null)).toBe(false);
  });

  it("matches contenteditable elements (ProseMirror editors)", () => {
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    document.body.appendChild(editable);
    expect(isEditableElement(editable)).toBe(true);
  });
});

describe("computeWindowScrollDelta", () => {
  it("returns 0 when the element is fully visible above the keyboard", () => {
    expect(computeWindowScrollDelta({ elementRectTop: 10, elementRectBottom: 300, visibleHeight: 500 })).toBe(0);
  });

  it("scrolls down so the element bottom sits 12px above the keyboard", () => {
    // visibleHeight 500, keyboard covers 300px of an 800px screen: an element
    // at bottom 700 must be brought up by 700 - (500 - 12) = 212.
    expect(computeWindowScrollDelta({ elementRectTop: 400, elementRectBottom: 700, visibleHeight: 500 })).toBe(212);
  });

  it("scrolls up when the browser scrolled the element past the top", () => {
    expect(computeWindowScrollDelta({ elementRectTop: -150, elementRectBottom: -80, visibleHeight: 500 })).toBe(-158);
  });

  it("scrolls down by the exact overshoot when slightly below the gap line", () => {
    // gap line = 500 - 12 = 488; bottom 496 is 8px below → scroll down 8.
    expect(computeWindowScrollDelta({ elementRectTop: 100, elementRectBottom: 496, visibleHeight: 500 })).toBe(8);
  });

  it("returns 0 when fully visible above the gap line", () => {
    expect(computeWindowScrollDelta({ elementRectTop: 100, elementRectBottom: 480, visibleHeight: 500 })).toBe(0);
  });
});

describe("computeContainerScrollDelta", () => {
  it("scrolls the container so the element is visible above the keyboard", () => {
    const delta = computeContainerScrollDelta({
      elementRectTop: 100,
      elementRectBottom: 600,
      scrollerRectTop: 50,
      scrollerRectBottom: 700,
      visibleHeight: 500, // keyboard top at 500
    });
    // visibleBottom = min(700, 500) - 12 = 488; delta = 600 - 488 = 112
    expect(delta).toBe(112);
  });

  it("returns 0 when the element already sits inside the visible area", () => {
    const delta = computeContainerScrollDelta({
      elementRectTop: 100,
      elementRectBottom: 400,
      scrollerRectTop: 50,
      scrollerRectBottom: 700,
      visibleHeight: 500,
    });
    expect(delta).toBe(0);
  });

  it("scrolls up when the element scrolled above the container top", () => {
    const delta = computeContainerScrollDelta({
      elementRectTop: 20,
      elementRectBottom: 100,
      scrollerRectTop: 50,
      scrollerRectBottom: 700,
      visibleHeight: 500,
    });
    expect(delta).toBe(20 - 50 - 8); // -38
  });
});

// ── Integration: keyboard-open scroll corrections (see applyState) ─────────
// The slide-in alignment must arm ONCE per keyboard-open transition: the
// keyboard animation fires a stream of visualViewport resizes, and re-arming
// on each one re-scrolled the page against the live (growing) editor rect,
// making long-post composers visibly fight the browser's caret scrolling.

describe("keyboard-open scroll corrections", () => {
  // initMobileKeyboard is module-global: dispose in afterEach (not just in
  // try/finally) so a mid-test failure can never leak `initialized` into the
  // other tests of this file.
  let dispose: (() => void) | null = null;

  afterEach(() => {
    dispose?.();
    dispose = null;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete (window as any).visualViewport;
    delete (window as any).innerHeight;
    document.body.innerHTML = "";
  });

  const stubTouchViewport = () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query === "(pointer: coarse)",
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }))
    );
    const vv: { height: number; offsetTop: number; addEventListener: () => void; removeEventListener: () => void } = {
      height: 800,
      offsetTop: 0,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
    Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    return vv;
  };

  // A focused input inside a scrollable container, with CONTROLLED geometry
  // (jsdom reports all-zero rects). While the keyboard is open the input's
  // bottom edge sits below the keyboard line, so a correction WOULD scroll.
  const setupFocusedInput = () => {
    const scroller = document.createElement("div");
    scroller.style.overflowY = "auto";
    Object.defineProperty(scroller, "scrollHeight", { value: 2000, configurable: true });
    Object.defineProperty(scroller, "clientHeight", { value: 500, configurable: true });

    let scrollTopValue = 0;
    let scrollWrites = 0;
    Object.defineProperty(scroller, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (v: number) => {
        scrollTopValue = v;
        scrollWrites += 1;
      },
    });

    const input = document.createElement("input");
    scroller.appendChild(input);
    document.body.appendChild(scroller);

    let rect = { top: 400, bottom: 700 };
    Object.defineProperty(input, "getBoundingClientRect", {
      configurable: true,
      value: () => rect,
    });

    return {
      input,
      getScrollWrites: () => scrollWrites,
      setRect: (next: { top: number; bottom: number }) => {
        rect = next;
      },
    };
  };

  it("arms the 4 progressive corrections once when the keyboard opens", () => {
    vi.useFakeTimers();
    const vv = stubTouchViewport();
    const { input, getScrollWrites } = setupFocusedInput();

    dispose = initMobileKeyboard();

    // Focused while fully visible at 800px — focus-in arms nothing.
    input.focus();
    expect(getScrollWrites()).toBe(0);

    // Keyboard slides in: visual viewport 800 → 500 (delta 300 ≥ 60).
    vv.height = 500;
    window.dispatchEvent(new Event("resize"));

    expect(document.documentElement.classList.contains("kb-open")).toBe(true);
    // Corrections are scheduled, not yet run.
    expect(getScrollWrites()).toBe(0);

    // The 0/120/300/600ms passes fire — exactly one arm = 4 corrections.
    vi.advanceTimersByTime(700);
    expect(getScrollWrites()).toBe(4);
  });

  it("does not re-arm corrections while the keyboard stays open", () => {
    vi.useFakeTimers();
    const vv = stubTouchViewport();
    const { input, getScrollWrites, setRect } = setupFocusedInput();

    dispose = initMobileKeyboard();

    input.focus();
    vv.height = 500;
    window.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(700);
    const writesAfterOpen = getScrollWrites();
    expect(writesAfterOpen).toBe(4);

    // While typing, the editor grows: its bottom edge (900) drops back below
    // the keyboard line (visible 450 − 12 = 438), so a correction WOULD be
    // needed — the old re-arm-on-resize code scrolled again here, which was
    // the long-post jitter. AND the visual viewport keeps changing (more
    // resize events). Neither may re-arm corrections.
    setRect({ top: 600, bottom: 900 });
    vv.height = 450;
    window.dispatchEvent(new Event("resize"));

    // The keyboard is still open; the CSS inset follows the new geometry…
    expect(document.documentElement.style.getPropertyValue("--kb-inset")).toBe("350px");
    expect(document.documentElement.classList.contains("kb-open")).toBe(true);

    vi.advanceTimersByTime(1000);
    // …but no NEW scroll corrections ran.
    expect(getScrollWrites()).toBe(writesAfterOpen);
  });
});

describe("getScrollContext", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  const makeScrollable = (): HTMLElement => {
    const scroller = document.createElement("div");
    scroller.style.overflowY = "auto";
    Object.defineProperty(scroller, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(scroller, "clientHeight", { value: 300, configurable: true });
    return scroller;
  };

  it("returns window mode for plain document flow", () => {
    const el = document.createElement("input");
    document.body.appendChild(el);
    expect(getScrollContext(el)).toEqual({ mode: "window", scroller: null });
  });

  it("finds the nearest scrollable ancestor", () => {
    const scroller = makeScrollable();
    const el = document.createElement("input");
    scroller.appendChild(el);
    document.body.appendChild(scroller);
    const ctx = getScrollContext(el);
    expect(ctx.mode).toBe("container");
    expect(ctx.scroller).toBe(scroller);
  });

  it("stops at a position:fixed ancestor with no closer scroller (app shell / modal)", () => {
    const shell = document.createElement("div");
    shell.style.position = "fixed";
    const el = document.createElement("input");
    shell.appendChild(el);
    document.body.appendChild(shell);
    expect(getScrollContext(el)).toEqual({ mode: "fixed", scroller: null });
  });

  it("prefers a real scrollable container over a fixed ancestor above it", () => {
    // e.g. a scrollable conversation list inside the fixed messenger shell:
    // the container is the element's actual scroll context.
    const shell = document.createElement("div");
    shell.style.position = "fixed";
    const scroller = makeScrollable();
    const el = document.createElement("input");
    scroller.appendChild(el);
    shell.appendChild(scroller);
    document.body.appendChild(shell);
    expect(getScrollContext(el)).toEqual({ mode: "container", scroller });
  });

  it("ignores non-scrollable overflow:hidden ancestors", () => {
    const wrapper = document.createElement("div");
    wrapper.style.overflow = "hidden";
    const el = document.createElement("input");
    wrapper.appendChild(el);
    document.body.appendChild(wrapper);
    expect(getScrollContext(el)).toEqual({ mode: "window", scroller: null });
  });

  it("ignores scrollable ancestors that cannot actually scroll", () => {
    const scroller = document.createElement("div");
    scroller.style.overflowY = "auto";
    // scrollHeight equals clientHeight → not scrollable
    Object.defineProperty(scroller, "scrollHeight", { value: 300, configurable: true });
    Object.defineProperty(scroller, "clientHeight", { value: 300, configurable: true });
    const el = document.createElement("input");
    scroller.appendChild(el);
    document.body.appendChild(scroller);
    expect(getScrollContext(el)).toEqual({ mode: "window", scroller: null });
  });
});
