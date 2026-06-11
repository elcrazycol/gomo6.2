import { describe, it, expect } from "vitest";
import { safeDate } from "./safeDate";

describe("safeDate", () => {
  // ─── Valid date strings ─────────────────────────────────────────────────

  it("parses a valid ISO date string", () => {
    const result = safeDate("2025-01-18T10:00:00Z");
    expect(result).toBeInstanceOf(Date);
    expect(result.getTime()).toBe(new Date("2025-01-18T10:00:00Z").getTime());
  });

  it("parses a date-only string", () => {
    const result = safeDate("2025-06-15");
    expect(result).toBeInstanceOf(Date);
    expect(result.getUTCFullYear()).toBe(2025);
    expect(result.getUTCMonth()).toBe(5); // June = 5
    expect(result.getUTCDate()).toBe(15);
  });

  // ─── Null / undefined / empty ────────────────────────────────────────────

  it("returns a valid Date when value is null", () => {
    const result = safeDate(null);
    expect(result).toBeInstanceOf(Date);
    expect(Number.isNaN(result.getTime())).toBe(false);
  });

  it("returns a valid Date when value is undefined", () => {
    const result = safeDate(undefined);
    expect(result).toBeInstanceOf(Date);
    expect(Number.isNaN(result.getTime())).toBe(false);
  });

  it("returns a valid Date when value is empty string", () => {
    const result = safeDate("");
    expect(result).toBeInstanceOf(Date);
    expect(Number.isNaN(result.getTime())).toBe(false);
  });

  // ─── Invalid date strings ───────────────────────────────────────────────

  it("returns a valid Date when value is garbage", () => {
    const result = safeDate("definitely not a date");
    expect(result).toBeInstanceOf(Date);
    expect(Number.isNaN(result.getTime())).toBe(false);
  });

  // ─── Edge cases ─────────────────────────────────────────────────────────

  it("returns epoch for 1970-01-01T00:00:00Z", () => {
    const result = safeDate("1970-01-01T00:00:00Z");
    expect(result.getTime()).toBe(0);
    expect(result.getUTCFullYear()).toBe(1970);
  });

  it("handles far future dates", () => {
    const result = safeDate("2099-12-31T23:59:59Z");
    expect(result).toBeInstanceOf(Date);
    expect(result.getTime()).toBe(new Date("2099-12-31T23:59:59Z").getTime());
    expect(result.getUTCFullYear()).toBe(2099);
  });

  it("returns current time as fallback (approximate check)", () => {
    const before = Date.now();
    const result = safeDate(null);
    const after = Date.now();
    expect(result.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.getTime()).toBeLessThanOrEqual(after);
  });
});
