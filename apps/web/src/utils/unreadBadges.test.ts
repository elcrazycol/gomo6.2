import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyUnreadBadges } from "./unreadBadges";

const FAVICON_ID = "gomo6-unread-favicon";
const BADGE_DATA_URL = "data:image/png;base64,BADGE";

// jsdom ships no canvas implementation, so stub a minimal 2D context plus
// toDataURL to exercise the renderer.
const ctx = {
  fillStyle: "",
  font: "",
  textAlign: "",
  textBaseline: "",
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  fillText: vi.fn(),
  drawImage: vi.fn(),
};

function faviconHref(): string | null {
  return document.getElementById(FAVICON_ID)?.getAttribute("href") ?? null;
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => ctx as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(BADGE_DATA_URL);
  // Images never load in jsdom; resolve synchronously with a fake element.
  vi.stubGlobal(
    "Image",
    class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      width = 192;
      height = 192;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    },
  );
  Object.defineProperty(navigator, "setAppBadge", {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
  Object.defineProperty(navigator, "clearAppBadge", {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.getElementById(FAVICON_ID)?.remove();
});

describe("applyUnreadBadges", () => {
  it("paints the count onto the favicon and mirrors it to the app badge", async () => {
    applyUnreadBadges(5);

    await vi.waitFor(() => expect(faviconHref()).toBe(BADGE_DATA_URL));
    expect(ctx.drawImage).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalledWith("5", expect.any(Number), expect.any(Number));
    expect(navigator.setAppBadge).toHaveBeenCalledWith(5);
  });

  it("caps the rendered label at 99+", async () => {
    applyUnreadBadges(150);

    await vi.waitFor(() => expect(faviconHref()).toBe(BADGE_DATA_URL));
    expect(ctx.fillText).toHaveBeenCalledWith("99+", expect.any(Number), expect.any(Number));
  });

  it("restores the shipped icon and clears the app badge at zero", async () => {
    applyUnreadBadges(3);
    await vi.waitFor(() => expect(faviconHref()).toBe(BADGE_DATA_URL));

    applyUnreadBadges(0);

    expect(faviconHref()).toBe("/favicon.ico");
    expect(navigator.clearAppBadge).toHaveBeenCalled();
  });

  it("does not throw when the Badging API is unavailable", () => {
    Object.defineProperty(navigator, "setAppBadge", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "clearAppBadge", { configurable: true, value: undefined });

    expect(() => applyUnreadBadges(2)).not.toThrow();
  });
});
