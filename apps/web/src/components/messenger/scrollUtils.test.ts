import { describe, expect, it } from "vitest";
import { estimatePrependedHeight } from "./scrollUtils";

type Row = { id: string; height: number };

const estimate = (row: Row) => row.height;

describe("estimatePrependedHeight", () => {
  it("sums only rows before the existing boundary", () => {
    const rows: Row[] = [
      { id: "old-1", height: 40 },
      { id: "old-2", height: 55 },
      { id: "boundary", height: 70 },
      { id: "newer", height: 80 },
    ];
    expect(estimatePrependedHeight(rows, "boundary", estimate)).toBe(95);
  });

  it("returns zero when nothing was prepended", () => {
    expect(estimatePrependedHeight([{ id: "boundary", height: 70 }], "boundary", estimate)).toBe(0);
    expect(estimatePrependedHeight([{ id: "newer", height: 70 }], "missing", estimate)).toBe(0);
  });

  it("does not allow a negative estimate to move the viewport", () => {
    expect(estimatePrependedHeight([
      { id: "old", height: -20 },
      { id: "boundary", height: 70 },
    ], "boundary", estimate)).toBe(0);
  });
});
