import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  DEFAULT_PROFILE_BACKGROUND_VARIANT,
  PROFILE_BACKGROUND_VARIANTS,
  getProfileBackgroundVariant,
  setProfileBackgroundVariant,
} from "./profileBackground";

describe("profileBackground", () => {
  const dispatchSpy = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    window.dispatchEvent = dispatchSpy as unknown as typeof window.dispatchEvent;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exposes exactly 4 display variants", () => {
    expect(PROFILE_BACKGROUND_VARIANTS.map((v) => v.id)).toEqual([
      "banner",
      "card",
      "page",
      "page_dim",
    ]);
  });

  it("defaults to the banner variant when nothing is stored", () => {
    expect(getProfileBackgroundVariant()).toBe(DEFAULT_PROFILE_BACKGROUND_VARIANT);
    expect(getProfileBackgroundVariant()).toBe("banner");
  });

  it("persists and returns the chosen variant", () => {
    setProfileBackgroundVariant("page");
    expect(getProfileBackgroundVariant()).toBe("page");
    expect(localStorage.getItem("profile-background-variant")).toBe("page");
  });

  it("ignores unknown stored values and falls back to the default", () => {
    localStorage.setItem("profile-background-variant", "tiled");
    expect(getProfileBackgroundVariant()).toBe(DEFAULT_PROFILE_BACKGROUND_VARIANT);
  });

  it("notifies open profile pages about the change", () => {
    setProfileBackgroundVariant("card");
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "profile-background:variant-change" }),
    );
  });
});
