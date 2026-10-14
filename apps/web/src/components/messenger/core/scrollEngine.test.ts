import { describe, it, expect } from "vitest";
import {
  BOTTOM_GAP_HEIGHT,
  HISTORY_HEADER_HEIGHT,
  captureAnchor,
  virtualContentHeight,
  type VirtualRow,
} from "./scrollEngine";

const rows = (count: number, size = 72): VirtualRow[] =>
  Array.from({ length: count }, (_, index) => ({
    index,
    start: index * size,
    end: (index + 1) * size,
  }));

const idAt = (index: number) => `m${index}`;

describe("layout constants", () => {
  it("match the css layout values they mirror", () => {
    expect(HISTORY_HEADER_HEIGHT).toBe(34);
    expect(BOTTOM_GAP_HEIGHT).toBe(12);
  });
});

describe("virtualContentHeight", () => {
  it("is header + virtual total + footer gap", () => {
    expect(virtualContentHeight(720)).toBe(34 + 720 + 12);
  });
});

describe("captureAnchor", () => {
  it("captures the top-most visible message and its offset", () => {
    // Row 0 spans 0..72 and still reaches the viewport top at 60 → it is the
    // top-most visible row; offset = 60 - 0.
    expect(captureAnchor(rows(5), 60, idAt)).toEqual({ messageId: "m0", offset: 60 });
  });

  it("moves to the next row once the previous one is fully above the top", () => {
    // Row 0 (0..72) is fully above 80; row 1 (72..144) reaches the top.
    expect(captureAnchor(rows(5), 80, idAt)).toEqual({ messageId: "m1", offset: 80 - 72 });
  });

  it("returns null when no row reaches the viewport top", () => {
    expect(captureAnchor([], 100, idAt)).toBeNull();
  });

  it("skips rows without a resolvable message id", () => {
    const anchor = captureAnchor(rows(3), 0, (index) => (index === 0 ? undefined : `m${index}`));
    expect(anchor?.messageId).toBe("m1");
  });
});
