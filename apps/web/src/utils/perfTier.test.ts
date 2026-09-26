import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { detectPerfTier, applyPerfTier, initPerfTier } from "./perfTier";

type NavHints = {
  deviceMemory?: number;
  hardwareConcurrency?: number;
  connection?: { saveData?: boolean };
};

const originalHints: NavHints = (() => {
  const nav = navigator as Navigator & NavHints;
  return {
    deviceMemory: nav.deviceMemory,
    hardwareConcurrency: nav.hardwareConcurrency,
  };
})();

function setNav(hints: NavHints) {
  for (const key of ["deviceMemory", "hardwareConcurrency", "connection"] as const) {
    Object.defineProperty(navigator, key, {
      value: hints[key],
      configurable: true,
      writable: true,
    });
  }
}

beforeEach(() => {
  document.documentElement.className = "";
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setNav(originalHints);
});

describe("detectPerfTier", () => {
  it("stays on the full tier for a roomy device", () => {
    setNav({ deviceMemory: 8, hardwareConcurrency: 8, connection: { saveData: false } });
    expect(detectPerfTier()).toBe("full");
  });

  it("drops to lite when the user asked to save data", () => {
    setNav({ deviceMemory: 8, hardwareConcurrency: 8, connection: { saveData: true } });
    expect(detectPerfTier()).toBe("lite");
  });

  it("drops to lite on low RAM", () => {
    setNav({ deviceMemory: 4, hardwareConcurrency: 8, connection: {} });
    expect(detectPerfTier()).toBe("lite");
  });

  it("drops to lite on few cores", () => {
    setNav({ deviceMemory: 8, hardwareConcurrency: 4, connection: {} });
    expect(detectPerfTier()).toBe("lite");
  });

  it("stays on full when the hints are missing", () => {
    setNav({ connection: {} });
    expect(detectPerfTier()).toBe("full");
  });
});

describe("applyPerfTier", () => {
  it("toggles the perf-lite class on <html>", () => {
    applyPerfTier("lite");
    expect(document.documentElement.classList.contains("perf-lite")).toBe(true);
    applyPerfTier("full");
    expect(document.documentElement.classList.contains("perf-lite")).toBe(false);
  });
});

describe("initPerfTier", () => {
  it("does not sample frame pacing when already on the lite tier", () => {
    setNav({ deviceMemory: 2, hardwareConcurrency: 8, connection: {} });
    const addSpy = vi.spyOn(window, "addEventListener");
    initPerfTier();
    expect(document.documentElement.classList.contains("perf-lite")).toBe(true);
    expect(addSpy).not.toHaveBeenCalledWith("scroll", expect.anything(), expect.anything());
  });

  it("downgrades to lite when the first scroll cannot hold a smooth frame rate", async () => {
    setNav({ deviceMemory: 8, hardwareConcurrency: 8, connection: {} });

    // Every frame takes ~30ms → a janky scroll.
    let clock = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      clock += 30;
      queueMicrotask(() => cb(clock));
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});

    initPerfTier();
    expect(document.documentElement.classList.contains("perf-lite")).toBe(false);

    window.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.documentElement.classList.contains("perf-lite")).toBe(true);
  });

  it("keeps the full tier when frames are smooth", async () => {
    setNav({ deviceMemory: 8, hardwareConcurrency: 8, connection: {} });

    let clock = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      clock += 16;
      queueMicrotask(() => cb(clock));
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});

    initPerfTier();
    window.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.documentElement.classList.contains("perf-lite")).toBe(false);
  });
});
