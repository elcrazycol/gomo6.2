import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DELETE_EXIT_MS, deleteExitDuration, runDeleteExit } from "./deleteAnimation";

/** A row with real-looking geometry: jsdom lays nothing out on its own. */
function buildRow(width = 240, height = 64): {
  row: HTMLDivElement;
  bubble: HTMLDivElement;
  next: HTMLDivElement;
  scroller: HTMLDivElement;
} {
  const scroller = document.createElement("div");
  scroller.className = "message-scroll";
  const list = document.createElement("div");
  list.className = "message-list";

  const row = document.createElement("div");
  row.className = "message-item message-row";
  const inner = document.createElement("div");
  inner.className = "bubble-row-inner";
  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  inner.appendChild(bubble);
  row.appendChild(inner);

  const next = document.createElement("div");
  next.className = "message-item";
  next.textContent = "следующее";

  list.append(row, next);
  scroller.appendChild(list);
  document.body.appendChild(scroller);

  const rectAt = (top: number, w: number, h: number) => ({
    x: 8, y: top, top, left: 8, right: 8 + w, bottom: top + h, width: w, height: h,
    toJSON: () => ({}),
  }) as DOMRect;

  row.getBoundingClientRect = () => rectAt(100, width, height);
  bubble.getBoundingClientRect = () => rectAt(108, width - 16, height - 8);
  next.getBoundingClientRect = () => rectAt(100 + height, width, 40);
  scroller.getBoundingClientRect = () => rectAt(0, 400, 800);
  list.getBoundingClientRect = () => rectAt(0, 400, 0);

  return { row, bubble, next, scroller };
}

let rafQueue: FrameRequestCallback[] = [];

/** Runs exactly the frames queued so far (self-rescheduling loops stop there). */
function flushFrames(): void {
  const batch = rafQueue;
  rafQueue = [];
  for (const cb of batch) cb(0);
}

describe("deleteAnimation", () => {
  beforeEach(() => {
    rafQueue = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("reports the full duration when motion is allowed", () => {
    expect(deleteExitDuration()).toBe(DELETE_EXIT_MS);
  });

  it("asks for no animation when the reader prefers reduced motion", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    expect(deleteExitDuration()).toBe(0);
  });

  it("breaks the bubble into pieces and collapses the row", () => {
    vi.useFakeTimers();
    const { row, bubble } = buildRow();

    runDeleteExit({ row, bubble, seed: "msg-1" });

    // The row is pinned to its current height and the collapse starts.
    expect(row.style.height).toBe("64px");
    expect(row.dataset.exit).toBe("1");
    expect(row.style.pointerEvents).toBe("none");

    // A dozen pieces, in a fixed layer that cannot inflate `scrollHeight`.
    const layer = document.querySelector<HTMLElement>(".delete-crumbs");
    expect(layer).not.toBeNull();
    expect(layer!.style.position).toBe("fixed");
    expect(layer!.querySelectorAll(".delete-crumb")).toHaveLength(12);
    // The theme decides the tint: my bubble and the peer's break differently.
    expect(layer!.querySelector<HTMLElement>(".delete-crumb")!.dataset.mine).toBe("0");
    // transform/opacity only — no painted effects that would cost a phone a frame
    const piece = layer!.querySelector<HTMLElement>(".delete-crumb")!;
    expect(piece.style.getPropertyValue("--crumb-dy")).toMatch(/px$/);
    expect(piece.style.getPropertyValue("--crumb-rot")).toMatch(/deg$/);

    // The collapse is a single height transition on one element.
    expect(row.style.transition).toContain("height");
  });

  it("is idempotent for a row that already started its exit", () => {
    vi.useFakeTimers();
    const { row, bubble } = buildRow();

    runDeleteExit({ row, bubble, seed: "msg-1" });
    runDeleteExit({ row, bubble, seed: "msg-1" });

    expect(document.querySelectorAll(".delete-crumbs")).toHaveLength(1);
  });

  it("removes the pieces by itself, even after the row is gone", () => {
    vi.useFakeTimers();
    const { row, bubble } = buildRow();

    runDeleteExit({ row, bubble, seed: "msg-1" });
    row.remove();
    expect(document.querySelector(".delete-crumbs")).not.toBeNull();

    vi.advanceTimersByTime(400);
    expect(document.querySelector(".delete-crumbs")).toBeNull();
  });

  it("keeps the content below the gap still while the row collapses", () => {
    vi.useFakeTimers();
    const { row, bubble, next, scroller } = buildRow();
    // Simulate an engine without native scroll anchoring: the witness drifts up
    // by the collapsed height on every frame until we compensate.
    let compensated = 0;
    Object.defineProperty(scroller, "scrollTop", {
      get: () => compensated,
      set: (value: number) => { compensated = value; },
      configurable: true,
    });
    Object.defineProperty(scroller, "scrollHeight", { get: () => 2000, configurable: true });
    let drift = 0;
    const realRect = next.getBoundingClientRect.bind(next);
    next.getBoundingClientRect = () => {
      const rect = realRect();
      return { ...rect, top: rect.top + drift } as DOMRect;
    };

    runDeleteExit({ row, bubble, seed: "msg-1" });
    // The browser moved the content below up by 32px (the row has collapsed).
    drift = -32;
    flushFrames();

    // The viewport followed it, so the witness is visually back in place.
    expect(compensated).toBe(-32);
  });

  it("collapses instantly with no pieces when the reader prefers reduced motion", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    const { row, bubble } = buildRow();

    runDeleteExit({ row, bubble, seed: "msg-1" });

    expect(row.style.height).toBe("0px");
    expect(document.querySelector(".delete-crumbs")).toBeNull();
  });
});
