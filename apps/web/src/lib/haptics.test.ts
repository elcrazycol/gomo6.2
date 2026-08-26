import { describe, it, expect, vi, afterEach } from "vitest";
import { hapticTick, hapticSuccess } from "./haptics";

describe("haptics", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("calls navigator.vibrate when the Vibration API is available", () => {
    const vibrate = vi.fn(() => true);
    vi.stubGlobal("navigator", { ...navigator, vibrate });

    hapticTick(8);
    expect(vibrate).toHaveBeenCalledWith(8);

    hapticSuccess();
    expect(vibrate).toHaveBeenCalledWith(4);
  });

  it("is a safe no-op without the Vibration API (jsdom / iOS Safari)", () => {
    vi.stubGlobal("navigator", { ...navigator, vibrate: undefined });

    expect(() => hapticTick(8)).not.toThrow();
    expect(() => hapticSuccess()).not.toThrow();
  });
});