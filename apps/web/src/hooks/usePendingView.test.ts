import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

import { getTransitionDirection, setTransitionStyle } from "@/lib/viewTransitions";

import { usePendingView, pendingViewClass } from "./usePendingView";

describe("usePendingView", () => {
  it("starts on the initial view", () => {
    const { result } = renderHook(() =>
      usePendingView<"section" | "feed">("section", "section"),
    );
    expect(result.current.shown).toBe("section");
    expect(result.current.isShown("section")).toBe(true);
    expect(result.current.isRendered("feed")).toBe(false);
  });

  it("keeps the previous view rendered until the target reports ready", () => {
    const { result, rerender } = renderHook(
      ({ target }: { target: "section" | "feed" }) => usePendingView(target, "section"),
      { initialProps: { target: "section" as "section" | "feed" } },
    );

    rerender({ target: "feed" });

    // The target is mounted but not shown; the previous view stays on screen.
    expect(result.current.isRendered("feed")).toBe(true);
    expect(result.current.isShown("feed")).toBe(false);
    expect(result.current.isRendered("section")).toBe(true);
    expect(result.current.isShown("section")).toBe(true);

    act(() => result.current.readyFor("feed")());

    expect(result.current.isShown("feed")).toBe(true);
    // The old view unmounts once it is neither the target nor shown.
    expect(result.current.isRendered("section")).toBe(false);
  });

  it("hands out a stable onReady per view", () => {
    const { result, rerender } = renderHook(() => usePendingView("feed", "feed"));
    const first = result.current.readyFor("feed");
    rerender();
    expect(result.current.readyFor("feed")).toBe(first);
  });

  it("does not start a transition for a view that is already on screen", async () => {
    setTransitionStyle("view-transition");
    const start = vi.fn();
    (document as unknown as { startViewTransition?: unknown }).startViewTransition = start;

    const { result } = renderHook(() => usePendingView("section", "section"));
    act(() => result.current.readyFor("section")());

    await Promise.resolve();
    // No swap to animate — the view is already visible, and its content may
    // have been swapped underneath by its own fetch.
    expect(start).not.toHaveBeenCalled();
    expect(result.current.shown).toBe("section");
  });

  it("points the slide the way the depth changes", () => {
    const depthOf = { feed: 0, section: 1 } as const;
    // Раздел → feed is one level up: slide back.
    const up = renderHook(() => usePendingView<"feed" | "section">("feed", "section", depthOf));
    act(() => up.result.current.readyFor("feed")());
    expect(getTransitionDirection()).toBe("back");
    up.unmount();

    // Feed → раздел is one level down: slide forward.
    const down = renderHook(() => usePendingView<"feed" | "section">("section", "feed", depthOf));
    act(() => down.result.current.readyFor("section")());
    expect(getTransitionDirection()).toBe("forward");
    down.unmount();
  });
});

afterEach(() => {
  setTransitionStyle("fade");
  delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;
});

describe("pendingViewClass", () => {
  it("hides non-shown views and fades in the shown one", () => {
    expect(pendingViewClass(false)).toBe("hidden");
    expect(pendingViewClass(true)).toBe("view-fade-in");
  });

  it("uses the entrance animation of the picked CSS style", () => {
    expect(pendingViewClass(true, "rise")).toBe("view-rise-in");
    // Still hidden when it is not the shown view.
    expect(pendingViewClass(false, "rise")).toBe("hidden");
  });

  it("does not add a fade when the browser (or 'none') animates the swap", () => {
    expect(pendingViewClass(true, "view-transition")).toBe("");
    expect(pendingViewClass(true, "slide")).toBe("");
    expect(pendingViewClass(true, "none")).toBe("");
    // Still hidden when it is not the shown view.
    expect(pendingViewClass(false, "view-transition")).toBe("hidden");
  });
});
