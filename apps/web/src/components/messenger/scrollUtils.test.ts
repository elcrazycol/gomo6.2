import { describe, expect, it } from "vitest";
import { getMaxScrollTop, isNearScrollBottom } from "./scrollUtils";

describe("scrollUtils", () => {
  it("calculates the exact maximum scrollTop", () => {
    expect(getMaxScrollTop(2000, 500)).toBe(1500);
    expect(getMaxScrollTop(500, 2000)).toBe(0);
  });

  it("uses the real bottom edge and threshold", () => {
    expect(isNearScrollBottom(1500, 2000, 500)).toBe(true);
    expect(isNearScrollBottom(1470, 2000, 500)).toBe(true);
    expect(isNearScrollBottom(1467, 2000, 500)).toBe(false);
  });

  it("never treats negative scrollTop as beyond the bottom", () => {
    expect(isNearScrollBottom(-100, 500, 200, 32)).toBe(false);
    expect(isNearScrollBottom(-1, 100, 200, 32)).toBe(false);
  });
});
