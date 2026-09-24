import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shouldAutoplay, useAnimatedVideoStore } from "./animatedVideoStore";

/** An element whose measured rect can be moved between assertions. */
function movableEl(top: number, height = 100) {
  const el = {
    _top: top,
    _height: height,
    getBoundingClientRect: () => ({
      top: el._top,
      bottom: el._top + el._height,
      height: el._height,
      left: 0,
      right: 100,
      width: 100,
      x: 0,
      y: el._top,
      toJSON: () => ({}),
    }),
  };
  return el as unknown as HTMLElement & { _top: number };
}

const activeIds = () => useAnimatedVideoStore.getState().activeIds;

describe("animated video manager", () => {
  beforeEach(() => {
    // jsdom viewport height is 768 → center at 384.
    useAnimatedVideoStore.setState({ candidates: new Map(), activeIds: [], autoplayMode: "always" });
  });

  it("orders active clips by distance to the viewport center", () => {
    const s = useAnimatedVideoStore.getState();
    s.register("far", movableEl(100)); // center 150 → dist 234
    s.register("near", movableEl(360)); // center 410 → dist 26
    s.register("mid", movableEl(200)); // center 250 → dist 134

    expect(activeIds()).toEqual(["near", "mid", "far"]);
  });

  it("caps playback at three clips", () => {
    const s = useAnimatedVideoStore.getState();
    [0, 100, 200, 300, 400].forEach((top, i) => s.register(`c${i}`, movableEl(top)));

    expect(activeIds()).toHaveLength(3);
    // nearest to 384 wins: top 300 (center 350) then 400 (450) then 200 (250)
    expect(activeIds()).toEqual(["c3", "c4", "c2"]);
  });

  it("ignores clips that are off screen", () => {
    const s = useAnimatedVideoStore.getState();
    s.register("visible", movableEl(300));
    s.register("below", movableEl(1200));

    expect(activeIds()).toEqual(["visible"]);
  });

  it("re-ranks when the layout moves", () => {
    const a = movableEl(100);
    const b = movableEl(360);
    const s = useAnimatedVideoStore.getState();
    s.register("a", a);
    s.register("b", b);
    expect(activeIds()).toEqual(["b", "a"]);

    a._top = 360;
    b._top = 100;
    useAnimatedVideoStore.getState().recompute();
    expect(activeIds()).toEqual(["a", "b"]);
  });

  it("frees the slot when a clip unregisters", () => {
    const s = useAnimatedVideoStore.getState();
    s.register("a", movableEl(360));
    s.register("b", movableEl(340));
    s.register("c", movableEl(320));
    s.register("d", movableEl(300));
    expect(activeIds()).toHaveLength(3);

    useAnimatedVideoStore.getState().unregister("a");
    expect(activeIds()).toEqual(["b", "c", "d"]);
  });
});

describe("shouldAutoplay", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (navigator as { connection?: unknown }).connection;
  });

  it("honours the never / always preference", () => {
    expect(shouldAutoplay("never")).toBe(false);
    expect(shouldAutoplay("always")).toBe(true);
  });

  it("respects the browser data-saver hint", () => {
    Object.defineProperty(navigator, "connection", {
      value: { saveData: true, effectiveType: "4g" },
      configurable: true,
    });
    expect(shouldAutoplay("always")).toBe(false);
  });

  it("skips slow connections in wifi mode", () => {
    Object.defineProperty(navigator, "connection", {
      value: { saveData: false, effectiveType: "3g" },
      configurable: true,
    });
    expect(shouldAutoplay("wifi")).toBe(false);
    expect(shouldAutoplay("always")).toBe(true);
  });

  it("respects prefers-reduced-motion", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList);
    expect(shouldAutoplay("always")).toBe(false);
  });
});
