import { describe, expect, it } from "vitest";
import {
  CASCADE_VARIANTS,
  INSTANT,
  SPRING,
  STREAM_CASCADE_VARIANTS,
  STREAM_ITEM_VARIANTS,
  STAGGER,
  hoverLift,
  pressFeedback,
  spatialEnter,
  springFor,
  travelDirection,
} from "./motion";

describe("motion presets", () => {
  it("are springs with positive stiffness and damping", () => {
    for (const [name, preset] of Object.entries(SPRING)) {
      expect(preset.type, name).toBe("spring");
      expect(preset.stiffness, name).toBeGreaterThan(0);
      expect(preset.damping, name).toBeGreaterThan(0);
    }
  });

  it("collapse to an instant transition under reduced motion", () => {
    expect(springFor("standard", true)).toBe(INSTANT);
    expect(springFor("standard", false)).toBe(SPRING.standard);
    // `useReducedMotion()` is null while unknown — motion is allowed.
    expect(springFor("standard", null)).toBe(SPRING.standard);
  });
});

describe("shared stream choreography", () => {
  it("uses the common short cascade for content groups", () => {
    expect(CASCADE_VARIANTS).toEqual({
      hidden: {},
      show: { transition: STAGGER },
    });
  });

  it("moves stream rows a small distance with expo tweens and no scale", () => {
    expect(STREAM_CASCADE_VARIANTS.show).toEqual({
      transition: { staggerChildren: 0.055, delayChildren: 0.02 },
    });
    expect(STREAM_ITEM_VARIANTS.hidden).toEqual({
      opacity: 0,
      y: 12,
    });
    expect(STREAM_ITEM_VARIANTS.show).toMatchObject({
      opacity: 1,
      y: 0,
    });
    expect(STREAM_ITEM_VARIANTS.show).not.toHaveProperty("scale");
  });
});

describe("travelDirection", () => {
  it("is forward when moving rightwards or staying put", () => {
    expect(travelDirection(0, 2)).toBe(1);
    expect(travelDirection(3, 3)).toBe(1);
  });

  it("is backward when moving leftwards", () => {
    expect(travelDirection(4, 1)).toBe(-1);
  });
});

describe("spatialEnter", () => {
  it("offsets the entry along the travel direction", () => {
    const forward = spatialEnter(1, 14, false);
    expect(forward.initial).toEqual({ opacity: 0, x: 14 });
    expect(forward.animate).toEqual({ opacity: 1, x: 0 });

    const backward = spatialEnter(-1, 14, false);
    expect(backward.initial).toEqual({ opacity: 0, x: -14 });
  });

  it("has no initial state under reduced motion or on first paint", () => {
    expect(spatialEnter(1, 14, true).initial).toBe(false);
    expect(spatialEnter(1, 14, false, false).initial).toBe(false);
  });
});

describe("pointer feedback", () => {
  it("scales on press and hover", () => {
    expect(pressFeedback(false)).toEqual({ whileTap: { scale: 0.96 } });
    expect(pressFeedback(false, 0.9)).toEqual({ whileTap: { scale: 0.9 } });
    expect(hoverLift(false)).toEqual({ whileHover: { scale: 1.03 } });
  });

  it("is inert under reduced motion", () => {
    expect(pressFeedback(true)).toEqual({});
    expect(hoverLift(true)).toEqual({});
  });
});
