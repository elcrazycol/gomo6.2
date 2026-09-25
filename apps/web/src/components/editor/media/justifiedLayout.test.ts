import { describe, expect, it } from "vitest";
import { computeJustifiedSizes } from "./justifiedLayout";

describe("computeJustifiedSizes", () => {
  it("returns zeros for empty input or zero width", () => {
    expect(computeJustifiedSizes([], 600)).toEqual([]);
    expect(computeJustifiedSizes([1, 1], 0)).toEqual([
      { width: 0, height: 0 },
      { width: 0, height: 0 },
    ]);
  });

  it("fills a full row exactly to the container width", () => {
    const sizes = computeJustifiedSizes([2, 2, 2, 2], 600, { gap: 4, targetRowHeight: 220 });
    const rowWidth = sizes[0].width + sizes[1].width + 4;
    expect(Math.abs(rowWidth - 600)).toBeLessThanOrEqual(2);
    expect(sizes[0].height).toBe(sizes[1].height);
    expect(sizes[2].height).toBe(sizes[3].height);
    // No crop: a 2:1 item's box keeps roughly a 2:1 ratio.
    expect(sizes[0].width / sizes[0].height).toBeGreaterThan(1.8);
  });

  it("keeps the last short row at the target height (not stretched)", () => {
    const sizes = computeJustifiedSizes([1], 600, { targetRowHeight: 220 });
    expect(sizes[0].height).toBe(220);
    expect(sizes[0].width).toBe(220);
  });

  it("does not stretch a two-item last row", () => {
    const sizes = computeJustifiedSizes([1, 1], 600, { gap: 4, targetRowHeight: 220 });
    expect(sizes[0].width).toBe(220);
    expect(sizes[1].width).toBe(220);
  });

  it("treats invalid aspects as square", () => {
    const sizes = computeJustifiedSizes([0, -1, Number.NaN], 300, { gap: 0, targetRowHeight: 220 });
    expect(sizes.every((size) => size.height > 0 && size.width > 0)).toBe(true);
  });
});
