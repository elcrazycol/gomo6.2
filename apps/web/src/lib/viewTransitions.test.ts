import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  DEFAULT_TRANSITION_STYLE,
  TRANSITION_STYLES,
  getTransitionDirection,
  getTransitionStyle,
  isViewTransitionStyle,
  runTransition,
  runViewTransition,
  sectionTransitionName,
  setTransitionDirection,
  setTransitionStyle,
  transitionEnterClass,
} from "./viewTransitions";

/** Flush microtasks + the queued macrotask so promise chains settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Minimal `document.startViewTransition` stand-in the module-under-test drives. */
const mockStartViewTransition = () => {
  let settle!: (skipped: boolean) => void;
  const finished = new Promise<void>((resolve, reject) => {
    settle = (skipped) =>
      skipped ? reject(new Error("AbortError: Transition was skipped")) : resolve();
  });
  const start = vi.fn((cb: () => void) => {
    const result = cb();
    return {
      finished,
      ready: Promise.resolve(),
      updateCallbackDone: Promise.resolve(result),
      skipTransition: () => {},
    };
  });
  (document as unknown as { startViewTransition?: unknown }).startViewTransition = start;
  return { start, settle: (skipped = false) => settle(skipped) };
};

describe("viewTransitions", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("perf-lite");
    delete document.documentElement.dataset.vtDirection;
  });

  afterEach(() => {
    delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;
  });

  it("defaults to fade and remembers a choice", () => {
    expect(getTransitionStyle()).toBe("fade");
    setTransitionStyle("slide");
    expect(getTransitionStyle()).toBe("slide");
  });

  it("shows the default first and Наплыв (View Transitions) second", () => {
    expect(DEFAULT_TRANSITION_STYLE).toBe("fade");
    expect(TRANSITION_STYLES[0].id).toBe(DEFAULT_TRANSITION_STYLE);
    expect(TRANSITION_STYLES[1].id).toBe("view-transition");
    // Every style is offered exactly once, and none is missing.
    expect(new Set(TRANSITION_STYLES.map((s) => s.id)).size).toBe(TRANSITION_STYLES.length);
    expect(TRANSITION_STYLES.map((s) => s.id).sort()).toEqual([
      "fade",
      "none",
      "rise",
      "slide",
      "view-transition",
    ]);
  });

  it("classifies which styles the browser animates", () => {
    expect(isViewTransitionStyle("view-transition")).toBe(true);
    expect(isViewTransitionStyle("slide")).toBe(true);
    expect(isViewTransitionStyle("fade")).toBe(false);
    expect(isViewTransitionStyle("rise")).toBe(false);
    expect(isViewTransitionStyle("none")).toBe(false);
  });

  it("maps CSS styles to their entrance animation and the rest to none", () => {
    expect(transitionEnterClass("fade")).toBe("view-fade-in");
    expect(transitionEnterClass("rise")).toBe("view-rise-in");
    expect(transitionEnterClass("slide")).toBe("");
    expect(transitionEnterClass("view-transition")).toBe("");
    expect(transitionEnterClass("none")).toBe("");
  });

  it("builds the shared-element name from a раздел slug", () => {
    expect(sectionTransitionName("news-society")).toBe("section-news-society");
    // Slugs are CSS idents — anything odd is neutralised, never left to abort
    // the transition.
    expect(sectionTransitionName("18+ / news")).toBe("section-18----news");
  });

  it("remembers the slide direction", () => {
    expect(getTransitionDirection()).toBe("forward");
    setTransitionDirection("back");
    expect(getTransitionDirection()).toBe("back");
  });

  it("applies the update directly for the fade style", () => {
    const update = vi.fn();
    runViewTransition(update);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("goes through startViewTransition when selected and supported", async () => {
    setTransitionStyle("slide");
    const update = vi.fn();
    const { start, settle } = mockStartViewTransition();

    runViewTransition(update);
    // Deferred to the next task so flushSync is not called inside a lifecycle.
    expect(update).not.toHaveBeenCalled();

    await flush();
    expect(start).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);

    settle();
    await flush();
  });

  it("falls back to a direct update when the browser does not support it", () => {
    setTransitionStyle("view-transition");
    delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;

    const update = vi.fn();
    runViewTransition(update);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("skips the browser transition on weak hardware (perf-lite)", () => {
    setTransitionStyle("slide");
    document.documentElement.classList.add("perf-lite");
    mockStartViewTransition();

    const update = vi.fn();
    runViewTransition(update);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("can force a transition past perf-lite for the Settings previews", async () => {
    document.documentElement.classList.add("perf-lite");
    const update = vi.fn();
    const { start, settle } = mockStartViewTransition();

    runTransition("slide", update, { force: true });
    await flush();
    expect(start).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);

    settle();
    await flush();
  });

  it("runs a second update after the running swap instead of racing it", async () => {
    setTransitionStyle("view-transition");
    const first = vi.fn();
    const second = vi.fn();
    const { start, settle } = mockStartViewTransition();

    // Two views report ready in the same tick (cache hit + revalidation).
    runViewTransition(first);
    runViewTransition(second);

    await flush();
    // Only ONE transition starts — a second would abort the first.
    expect(start).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();

    settle();
    await flush();
    // The superseded update still lands, just without its own animation.
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("swallows a skipped-transition rejection and stays usable", async () => {
    setTransitionStyle("view-transition");
    const update = vi.fn();
    const { start, settle } = mockStartViewTransition();

    runViewTransition(update);
    await flush();
    expect(start).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);

    // An aborted transition rejects `finished`; it must not bubble up as an
    // unhandled rejection, and it must release the single-flight slot.
    settle(true);
    await flush();

    const after = vi.fn();
    const next = mockStartViewTransition();
    runViewTransition(after);
    await flush();
    expect(next.start).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledTimes(1);

    next.settle();
    await flush();
  });
});
