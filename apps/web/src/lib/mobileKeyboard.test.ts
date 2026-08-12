import { describe, it, expect, beforeEach } from "vitest";
import {
  computeContainerScrollDelta,
  computeDismissalFrame,
  computeKeyboardMetrics,
  computeWindowScrollDelta,
  getScrollContext,
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
