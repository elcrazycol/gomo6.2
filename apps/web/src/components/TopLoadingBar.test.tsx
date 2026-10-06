import { render, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { TopLoadingBar } from "./TopLoadingBar";
import { useLoadingBarStore } from "@/stores/loadingBarStore";

const barClass = (container: HTMLElement) => container.firstElementChild?.className ?? "";

describe("TopLoadingBar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useLoadingBarStore.setState({ count: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays hidden for a load shorter than the show delay", () => {
    const { container } = render(<TopLoadingBar />);

    act(() => {
      useLoadingBarStore.getState().begin();
    });
    act(() => {
      vi.advanceTimersByTime(100); // < 180ms
    });
    expect(barClass(container)).toContain("opacity-0");

    act(() => {
      useLoadingBarStore.getState().end();
    });
  });

  it("shows for a longer load and lingers briefly after it ends", () => {
    const { container } = render(<TopLoadingBar />);

    act(() => {
      useLoadingBarStore.getState().begin();
    });
    act(() => {
      vi.advanceTimersByTime(200); // past the show delay
    });
    expect(barClass(container)).toContain("opacity-100");

    act(() => {
      useLoadingBarStore.getState().end();
    });
    // Still visible right after ending — minimum on-screen time.
    expect(barClass(container)).toContain("opacity-100");

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(barClass(container)).toContain("opacity-0");
  });
});
