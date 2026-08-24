import { describe, expect, it } from "vitest";
import { isNativePlatform, initCapacitor } from "./capacitor";

// The module must behave as a strict no-op in a browser-like environment
// (jsdom): the Capacitor plugins have no native bridge there, so the native
// bootstrap must not register listeners or touch the DOM.
describe("lib/capacitor (web environment)", () => {
  it("reports a non-native platform in the browser", () => {
    expect(isNativePlatform()).toBe(false);
  });

  it("initCapacitor is a no-op on web and returns a dispose fn", () => {
    const dispose = initCapacitor();
    expect(typeof dispose).toBe("function");
    // Must not have written any keyboard geometry on the document root.
    expect(document.documentElement.style.getPropertyValue("--kb-inset")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--app-vh")).toBe("");
    dispose();
  });
});
