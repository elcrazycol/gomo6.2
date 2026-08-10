import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useProfileInvalidation } from "./useProfileInvalidation";

const EVENT = "profile-cache:invalidate";

describe("useProfileInvalidation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires the callback when profile-cache:invalidate is dispatched", () => {
    const cb = vi.fn();
    renderHook(() => useProfileInvalidation(cb));

    act(() => {
      window.dispatchEvent(new Event(EVENT));
      vi.advanceTimersByTime(300);
    });

    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("debounces rapid successive events into a single callback", () => {
    const cb = vi.fn();
    renderHook(() => useProfileInvalidation(cb));

    act(() => {
      window.dispatchEvent(new Event(EVENT));
      vi.advanceTimersByTime(100);
      window.dispatchEvent(new Event(EVENT));
      vi.advanceTimersByTime(100);
      window.dispatchEvent(new Event(EVENT));
      vi.advanceTimersByTime(300);
    });

    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("does not fire before the debounce window elapses", () => {
    const cb = vi.fn();
    renderHook(() => useProfileInvalidation(cb));

    act(() => {
      window.dispatchEvent(new Event(EVENT));
      vi.advanceTimersByTime(299);
    });

    expect(cb).not.toHaveBeenCalled();
  });

  it("removes the listener on unmount so no callback fires", () => {
    const cb = vi.fn();
    const { unmount } = renderHook(() => useProfileInvalidation(cb));

    unmount();

    act(() => {
      window.dispatchEvent(new Event(EVENT));
      vi.advanceTimersByTime(300);
    });

    expect(cb).not.toHaveBeenCalled();
  });
});
