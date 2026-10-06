import { describe, it, expect, afterEach, vi } from "vitest";
import {
  DEFAULT_PROFILE_VIEW_MODE,
  PROFILE_VIEW_MODE_EVENT,
  PROFILE_VIEW_MODE_KEY,
  getProfileViewMode,
  setProfileViewMode,
} from "./profileViewMode";

describe("profileViewMode", () => {
  afterEach(() => {
    localStorage.removeItem(PROFILE_VIEW_MODE_KEY);
    vi.restoreAllMocks();
  });

  it("defaults to social when unset or invalid", () => {
    expect(getProfileViewMode()).toBe(DEFAULT_PROFILE_VIEW_MODE);
    localStorage.setItem(PROFILE_VIEW_MODE_KEY, "nonsense");
    expect(getProfileViewMode()).toBe("social");
  });

  it("persists forum and broadcasts a change event", () => {
    const handler = vi.fn();
    window.addEventListener(PROFILE_VIEW_MODE_EVENT, handler);

    setProfileViewMode("forum");

    expect(localStorage.getItem(PROFILE_VIEW_MODE_KEY)).toBe("forum");
    expect(getProfileViewMode()).toBe("forum");
    expect(handler).toHaveBeenCalledTimes(1);

    window.removeEventListener(PROFILE_VIEW_MODE_EVENT, handler);
  });

  it("persists social too", () => {
    setProfileViewMode("forum");
    setProfileViewMode("social");
    expect(getProfileViewMode()).toBe("social");
  });
});
