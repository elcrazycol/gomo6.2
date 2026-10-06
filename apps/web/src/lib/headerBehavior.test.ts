import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  HEADER_BEHAVIORS,
  HEADER_BEHAVIOR_EVENT,
  HEADER_BEHAVIOR_KEY,
  DEFAULT_HEADER_BEHAVIOR,
  getHeaderBehavior,
  setHeaderBehavior,
} from "./headerBehavior";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("header behaviour preference", () => {
  it("defaults to a fixed header when nothing is stored", () => {
    expect(DEFAULT_HEADER_BEHAVIOR).toBe("fixed");
    expect(getHeaderBehavior()).toBe("fixed");
  });

  it("returns a stored valid value", () => {
    localStorage.setItem(HEADER_BEHAVIOR_KEY, "auto-hide");
    expect(getHeaderBehavior()).toBe("auto-hide");
  });

  it("falls back to the default on an unknown value", () => {
    localStorage.setItem(HEADER_BEHAVIOR_KEY, "sideways");
    expect(getHeaderBehavior()).toBe("fixed");
  });

  it("persists the choice and broadcasts it", () => {
    const listener = vi.fn();
    window.addEventListener(HEADER_BEHAVIOR_EVENT, listener);

    setHeaderBehavior("auto-hide");

    expect(localStorage.getItem(HEADER_BEHAVIOR_KEY)).toBe("auto-hide");
    expect(getHeaderBehavior()).toBe("auto-hide");
    expect(listener).toHaveBeenCalledTimes(1);

    window.removeEventListener(HEADER_BEHAVIOR_EVENT, listener);
  });

  it("exposes both options, with fixed listed first", () => {
    expect(HEADER_BEHAVIORS.map((b) => b.id)).toEqual(["fixed", "auto-hide"]);
  });
});
