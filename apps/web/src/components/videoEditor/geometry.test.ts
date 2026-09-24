import { describe, expect, it } from "vitest";
import {
  centeredCrop,
  fractionRatio,
  FULL_CROP,
  isFullCrop,
  moveCrop,
  pixelAspectOf,
  resizeCrop,
  round3,
} from "./geometry";

const closeTo = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

describe("pixelAspectOf", () => {
  it("returns the ratio for presets and null for free", () => {
    expect(pixelAspectOf("1:1")).toBe(1);
    expect(pixelAspectOf("16:9")).toBeCloseTo(16 / 9);
    expect(pixelAspectOf("free")).toBeNull();
  });
});

describe("fractionRatio", () => {
  it("maps a pixel aspect into fraction space", () => {
    // A 1:1 crop inside a 16:9 video: w/h fractions = 1 / (16/9).
    expect(fractionRatio(1, 16 / 9)).toBeCloseTo(0.5625);
  });

  it("falls back to the pixel aspect for degenerate video sizes", () => {
    expect(fractionRatio(1, 0)).toBe(1);
  });
});

describe("centeredCrop", () => {
  it("returns the full frame for the free preset", () => {
    expect(centeredCrop(16 / 9, "free")).toEqual(FULL_CROP);
  });

  it("centers a square crop inside a landscape video", () => {
    const crop = centeredCrop(16 / 9, "1:1");
    expect(closeTo(crop.w, 0.5625)).toBe(true);
    expect(closeTo(crop.h, 1)).toBe(true);
    expect(closeTo(crop.x, (1 - 0.5625) / 2)).toBe(true);
    expect(crop.y).toBe(0);
  });

  it("centers a portrait crop inside a landscape video", () => {
    const crop = centeredCrop(16 / 9, "9:16");
    expect(closeTo(crop.w, 0.5625 / (16 / 9))).toBe(true);
    expect(closeTo(crop.h, 1)).toBe(true);
  });
});

describe("isFullCrop", () => {
  it("detects the untouched frame", () => {
    expect(isFullCrop({ ...FULL_CROP })).toBe(true);
    expect(isFullCrop({ x: 0.1, y: 0, w: 0.9, h: 1 })).toBe(false);
  });
});

describe("moveCrop", () => {
  it("clamps the window inside the frame", () => {
    const moved = moveCrop({ x: 0.5, y: 0.5, w: 0.4, h: 0.4 }, 0.5, -0.5);
    expect(moved.x).toBeCloseTo(0.6);
    expect(moved.y).toBe(0);
  });
});

describe("resizeCrop", () => {
  it("resizes freely without locking", () => {
    const crop = resizeCrop({ x: 0.2, y: 0.2, w: 0.5, h: 0.5 }, "se", 0.1, 0.1, 0);
    expect(closeTo(crop.w, 0.6)).toBe(true);
    expect(closeTo(crop.h, 0.6)).toBe(true);
  });

  it("keeps the aspect ratio when dragging a corner", () => {
    const crop = resizeCrop({ x: 0.2, y: 0.2, w: 0.4, h: 0.4 }, "se", 0.1, 0.1, 0.5);
    expect(closeTo(crop.w / crop.h, 0.5)).toBe(true);
    // Anchored at the NW corner, shifted back inside the frame.
    expect(closeTo(crop.x, 0.2)).toBe(true);
    expect(closeTo(crop.y, 0)).toBe(true);
  });

  it("keeps the aspect ratio when dragging an edge", () => {
    const crop = resizeCrop({ x: 0.2, y: 0.2, w: 0.4, h: 0.4 }, "e", 0.1, 0, 0.5);
    expect(closeTo(crop.w / crop.h, 0.5)).toBe(true);
  });

  it("never shrinks below the minimum", () => {
    const crop = resizeCrop({ x: 0.2, y: 0.2, w: 0.5, h: 0.5 }, "se", -10, -10, 0);
    expect(crop.w).toBeGreaterThanOrEqual(0.0499);
    expect(crop.h).toBeGreaterThanOrEqual(0.0499);
  });
});

describe("round3", () => {
  it("rounds to three decimals", () => {
    expect(round3(0.12345)).toBe(0.123);
    expect(round3(0.9999)).toBe(1);
  });
});
