import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  computeDismissalFrame,
  computeKeyboardMetrics,
  initMobileKeyboard,
  isBeyondTouchSlop,
  isEditableElement,
  isIOSDevice,
  isStickyGestureTarget,
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

describe("isStickyGestureTarget", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("returns false for null / non-element targets", () => {
    expect(isStickyGestureTarget(null)).toBe(false);
    expect(isStickyGestureTarget(undefined)).toBe(false);
  });

  it("returns false for ordinary elements", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    expect(isStickyGestureTarget(el)).toBe(false);
  });

  it("returns true for an element carrying data-kb-keep", () => {
    const keep = document.createElement("div");
    keep.setAttribute("data-kb-keep", "true");
    document.body.appendChild(keep);
    expect(isStickyGestureTarget(keep)).toBe(true);
  });

  it("returns true for descendants of a keep surface (messages inside the chat panel)", () => {
    const keep = document.createElement("div");
    keep.setAttribute("data-kb-keep", "true");
    const bubble = document.createElement("div");
    keep.appendChild(bubble);
    document.body.appendChild(keep);
    expect(isStickyGestureTarget(bubble)).toBe(true);
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

// ── Integration: LIVE keyboard geometry (the cooperate-with-iOS model) ─────
// The per-frame follow reads the LIVE visual viewport every frame while the
// keyboard is animating / an editable is focused and writes the vars directly
// — no interpolation, no easing, no document pin.

describe("live keyboard geometry", () => {
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

  it("glides with the LIVE viewport every frame, not just on resize events", () => {
    vi.useFakeTimers();
    const vv = stubTouchViewport();
    const input = document.createElement("input");
    document.body.appendChild(input);

    dispose = initMobileKeyboard();
    input.focus();

    // The keyboard slides up but fires NO resize events (the choppy-event
    // quirk). The per-frame follow reads the live viewport anyway, so the CSS
    // vars track the keyboard smoothly at 60fps instead of stepping.
    vv.height = 500;
    vi.advanceTimersByTime(16);
    expect(document.documentElement.style.getPropertyValue("--kb-inset")).toBe("300px");
    expect(document.documentElement.style.getPropertyValue("--app-vh")).toBe("500px");

    // The keyboard keeps rising — still no events.
    vv.height = 620;
    vi.advanceTimersByTime(16);
    expect(document.documentElement.style.getPropertyValue("--kb-inset")).toBe("180px");
    expect(document.documentElement.style.getPropertyValue("--app-vh")).toBe("620px");
  });

  it("detects a keyboard that opens without any visual-viewport events (live follow)", () => {
    vi.useFakeTimers();
    const vv = stubTouchViewport();
    const input = document.createElement("input");
    document.body.appendChild(input);

    dispose = initMobileKeyboard();

    input.focus();
    expect(document.documentElement.classList.contains("kb-open")).toBe(false);

    // iOS quirk: the keyboard slides up but NO resize event fires on re-focus.
    // vv.height is a live property, so the per-frame follow (started on
    // focus) detects it exactly — no focus poll needed.
    vv.height = 500;
    vi.advanceTimersByTime(300);

    expect(document.documentElement.classList.contains("kb-open")).toBe(true);
    expect(document.documentElement.style.getPropertyValue("--kb-inset")).toBe("300px");
  });

  it("caps a one-frame inset spike so the composer never jumps up for a millisecond", () => {
    vi.useFakeTimers();
    const vv = stubTouchViewport();
    const input = document.createElement("input");
    document.body.appendChild(input);

    dispose = initMobileKeyboard();

    input.focus();
    // Keyboard opens to 300px (800 → 500). The per-frame follow is live and
    // the committed inset is 300.
    vv.height = 500;
    vi.advanceTimersByTime(16);
    expect(document.documentElement.style.getPropertyValue("--kb-inset")).toBe("300px");

    // One-frame spike: the URL-bar/visualViewport desync at the end of the
    // slide-in reports 680px for a single frame (a 380px jump). Growth is
    // capped at lastCommitted (300) + MAX_KB_GROWTH_PER_FRAME (40) = 340 —
    // the composer glides up a hair instead of teleporting for a frame.
    vv.height = 120;
    vi.advanceTimersByTime(16);
    expect(document.documentElement.style.getPropertyValue("--kb-inset")).toBe("340px");

    // Spike gone: the true position is 500 again. Shrink is never capped, so
    // the inset returns to 300 the same frame — no bounce.
    vv.height = 500;
    vi.advanceTimersByTime(16);
    expect(document.documentElement.style.getPropertyValue("--kb-inset")).toBe("300px");
  });

  it("applies a deferred close instantly — live geometry, no easing", () => {
    vi.useFakeTimers();
    const vv = stubTouchViewport();
    const input = document.createElement("input");
    document.body.appendChild(input);

    dispose = initMobileKeyboard();

    input.focus();
    // Keyboard opens normally: 800 → 500 (delta 300).
    vv.height = 500;
    window.dispatchEvent(new Event("resize"));
    expect(document.documentElement.classList.contains("kb-open")).toBe(true);
    vi.advanceTimersByTime(400);
    expect(document.documentElement.style.getPropertyValue("--kb-inset")).toBe("300px");

    // iOS defers its close resize until AFTER the keyboard finished sliding
    // away: one event reports the whole closed geometry at once (delta 0).
    // The vars follow the live viewport directly — no jump-ease, no delayed
    // glide: the composer lands at the closed values in the same frame.
    vv.height = 800;
    window.dispatchEvent(new Event("resize"));
    expect(document.documentElement.classList.contains("kb-open")).toBe(false);
    expect(document.documentElement.style.getPropertyValue("--kb-inset")).toBe("0px");
    expect(document.documentElement.style.getPropertyValue("--app-vh")).toBe("800px");

    // The follow keeps reading the live (closed) viewport — nothing bounces.
    vi.advanceTimersByTime(700);
    expect(document.documentElement.style.getPropertyValue("--kb-inset")).toBe("0px");
    expect(document.documentElement.classList.contains("kb-open")).toBe(false);
  });
});
