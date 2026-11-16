import { describe, expect, it } from "vitest";
import {
  hashSeed,
  mulberry32,
  oklch,
  paletteFor,
  patternNumber,
  suminagashiParams,
  turbulenceSeed,
} from "./seededPattern";

describe("seededPattern", () => {
  it("hashes deterministically", () => {
    expect(hashSeed("abc")).toBe(hashSeed("abc"));
    expect(hashSeed("abc")).not.toBe(hashSeed("abd"));
  });

  it("prng is deterministic per seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("pattern number stays in CS range 0-999", () => {
    for (const key of ["u1", "alice", "bob", "", "x".repeat(64)]) {
      const n = patternNumber(key);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(999);
    }
  });

  it("turbulence seed stays in 0-99", () => {
    expect(turbulenceSeed("u1")).toBeLessThanOrEqual(99);
    expect(turbulenceSeed("u1")).toBeGreaterThanOrEqual(0);
  });

  it("same key → identical artwork params (avatar == banner identity)", () => {
    const a = suminagashiParams("user-123");
    const b = suminagashiParams("user-123");
    expect(a).toEqual(b);
    expect(a.rings.length).toBeGreaterThanOrEqual(9);
  });

  it("different keys → different pattern numbers or palettes (usually)", () => {
    const nos = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map((k) => patternNumber(k)));
    expect(nos.size).toBeGreaterThan(1);
  });

  it("palettes stay muted (no neon)", () => {
    for (const key of ["a", "bb", "ccc", "dddd", "user-1"]) {
      const pal = paletteFor(key);
      expect(pal.bg[1]).toBeLessThanOrEqual(0.05);
      for (const ink of pal.inks) {
        expect(ink[1]).toBeLessThanOrEqual(0.09);
      }
      expect(oklch(pal.bg)).toMatch(/^oklch\(/);
    }
  });

  it("falls back for empty keys", () => {
    const p = suminagashiParams("");
    expect(p.seedKey).toBe("anon");
    expect(p.rings.length).toBeGreaterThan(0);
  });
});
