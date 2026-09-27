import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  DEFAULT_MR_RANDOM_COUNT,
  MAX_MR_RANDOM_COUNT,
  MR_RANDOM_COUNT_EVENT,
  getMrRandomCount,
  setMrRandomCount,
} from "@/lib/mrRandom";

describe("mrRandom preference", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to 1", () => {
    expect(getMrRandomCount()).toBe(DEFAULT_MR_RANDOM_COUNT);
    expect(DEFAULT_MR_RANDOM_COUNT).toBe(1);
  });

  it("persists the chosen count and broadcasts it", () => {
    const listener = vi.fn();
    window.addEventListener(MR_RANDOM_COUNT_EVENT, listener);

    setMrRandomCount(3);

    expect(getMrRandomCount()).toBe(3);
    expect(listener).toHaveBeenCalledTimes(1);

    window.removeEventListener(MR_RANDOM_COUNT_EVENT, listener);
  });

  it("clamps out-of-range values", () => {
    setMrRandomCount(0);
    expect(getMrRandomCount()).toBe(1);

    setMrRandomCount(99);
    expect(getMrRandomCount()).toBe(MAX_MR_RANDOM_COUNT);
  });
});
