import { renderHook, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";

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
});

describe("pendingViewClass", () => {
  it("hides non-shown views and fades in the shown one", () => {
    expect(pendingViewClass(false)).toBe("hidden");
    expect(pendingViewClass(true)).toContain("animate-in");
  });

  it("does not add a fade when the View Transitions API animates the swap", () => {
    expect(pendingViewClass(true, "view-transition")).toBe("");
    // Still hidden when it is not the shown view.
    expect(pendingViewClass(false, "view-transition")).toBe("hidden");
  });
});
