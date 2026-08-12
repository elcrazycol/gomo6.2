import { describe, it, expect, beforeEach } from "vitest";
import {
  computeContainerScrollDelta,
  computeKeyboardMetrics,
  computeWindowScrollDelta,
  getScrollContext,
  isEditableElement,
} from "./mobileKeyboard";

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
