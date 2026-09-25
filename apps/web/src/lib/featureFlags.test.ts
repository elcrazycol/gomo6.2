import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_FEATURE_FLAGS,
  FEATURE_FLAGS_STORAGE_KEY,
  clearFeatureFlagOverrides,
  getFeatureFlags,
  isFeatureEnabled,
  setFeatureFlagOverride,
} from "./featureFlags";

describe("featureFlags", () => {
  beforeEach(() => {
    clearFeatureFlagOverrides();
  });

  afterEach(() => {
    clearFeatureFlagOverrides();
  });

  it("falls back to the compiled default when no override is set", () => {
    expect(getFeatureFlags()).toEqual(DEFAULT_FEATURE_FLAGS);
    expect(isFeatureEnabled("wallInlineMedia")).toBe(true);
  });

  it("applies a localStorage override (can disable a default-on flag)", () => {
    setFeatureFlagOverride("wallInlineMedia", false);
    expect(isFeatureEnabled("wallInlineMedia")).toBe(false);
  });

  it("ignores unknown keys and non-boolean values", () => {
    window.localStorage.setItem(
      FEATURE_FLAGS_STORAGE_KEY,
      JSON.stringify({ wallInlineMedia: "yes", notAFlag: true, another: false }),
    );
    expect(getFeatureFlags()).toEqual(DEFAULT_FEATURE_FLAGS);
  });

  it("survives corrupt JSON in the override slot", () => {
    window.localStorage.setItem(FEATURE_FLAGS_STORAGE_KEY, "{not json");
    expect(getFeatureFlags()).toEqual(DEFAULT_FEATURE_FLAGS);
  });
});
