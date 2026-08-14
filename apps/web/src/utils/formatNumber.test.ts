import { describe, expect, it } from "vitest";

import { formatCompactNumber } from "@/utils/formatNumber";

describe("formatCompactNumber", () => {
  it("keeps small numbers raw", () => {
    expect(formatCompactNumber(0)).toBe("0");
    expect(formatCompactNumber(5)).toBe("5");
    expect(formatCompactNumber(999)).toBe("999");
  });

  it("formats thousands with К", () => {
    expect(formatCompactNumber(1000)).toBe("1К");
    expect(formatCompactNumber(1243)).toBe("1,2К");
    expect(formatCompactNumber(1250)).toBe("1,3К");
    expect(formatCompactNumber(25_000)).toBe("25К");
    expect(formatCompactNumber(999_499)).toBe("999,5К");
  });

  it("formats millions with М", () => {
    expect(formatCompactNumber(1_000_000)).toBe("1М");
    expect(formatCompactNumber(1_500_000)).toBe("1,5М");
    expect(formatCompactNumber(12_000_000)).toBe("12М");
  });

  it("normalizes rounding rollovers", () => {
    // A clean sub-thousand fraction stays as-is…
    expect(formatCompactNumber(999_500)).toBe("999,5К");
    // …but a value that would render as "1000К" rolls up to the next unit.
    expect(formatCompactNumber(999_950)).toBe("1М");
    expect(formatCompactNumber(999_999)).toBe("1М");
  });

  it("rolls over to the next unit at every boundary without recursing forever", () => {
    // М→Б rollover: 999 950 000 would previously recurse infinitely
    // (Math.round(abs/1000)*1000 stays in the same band).
    expect(formatCompactNumber(999_950_000)).toBe("1Б");
    expect(formatCompactNumber(999_999_999)).toBe("1Б");
    // Б→Т rollover.
    expect(formatCompactNumber(999_950_000_000)).toBe("1Т");
    // Т band: terminates even at its own rollover.
    expect(formatCompactNumber(999_950_000_000_000)).toBe("1000Т");
  });

  it("formats billions and trillions", () => {
    expect(formatCompactNumber(1_500_000_000)).toBe("1,5Б");
    expect(formatCompactNumber(12_000_000_000)).toBe("12Б");
    expect(formatCompactNumber(1_500_000_000_000)).toBe("1,5Т");
  });

  it("handles negative values", () => {
    expect(formatCompactNumber(-42)).toBe("-42");
    expect(formatCompactNumber(-1243)).toBe("-1,2К");
  });
});
