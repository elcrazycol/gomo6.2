import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  getTransitionStyle,
  setTransitionStyle,
  runViewTransition,
} from "./viewTransitions";

describe("viewTransitions", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;
  });

  it("defaults to fade and remembers a choice", () => {
    expect(getTransitionStyle()).toBe("fade");
    setTransitionStyle("view-transition");
    expect(getTransitionStyle()).toBe("view-transition");
  });

  it("applies the update directly for the fade style", () => {
    const update = vi.fn();
    runViewTransition(update);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("goes through startViewTransition when selected and supported", async () => {
    setTransitionStyle("view-transition");
    const update = vi.fn();
    const start = vi.fn((cb: () => void) => {
      cb();
      return {
        finished: Promise.resolve(),
        ready: Promise.resolve(),
        updateCallbackDone: Promise.resolve(),
        skipTransition: () => {},
      };
    });
    (document as unknown as { startViewTransition?: unknown }).startViewTransition = start;

    runViewTransition(update);
    // Deferred to the next task so flushSync is not called inside a lifecycle.
    expect(update).not.toHaveBeenCalled();

    await Promise.resolve();
    expect(start).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("falls back to a direct update when the browser does not support it", () => {
    setTransitionStyle("view-transition");
    delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;

    const update = vi.fn();
    runViewTransition(update);
    expect(update).toHaveBeenCalledTimes(1);
  });
});
