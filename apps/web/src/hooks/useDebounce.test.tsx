import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useDebouncedCallback, useThrottledCallback } from "./useDebounce";

describe("useDebouncedCallback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("delays callback execution", () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useDebouncedCallback(callback, 300));

    act(() => {
      result.current("arg1");
    });

    expect(callback).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(callback).toHaveBeenCalledWith("arg1");
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("cancels previous call on rapid invocation", () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useDebouncedCallback(callback, 300));

    act(() => {
      result.current("first");
    });

    act(() => {
      vi.advanceTimersByTime(200);
    });

    act(() => {
      result.current("second");
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith("second");
  });

  it("passes multiple arguments", () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useDebouncedCallback(callback, 100));

    act(() => {
      result.current("a", "b", "c");
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(callback).toHaveBeenCalledWith("a", "b", "c");
  });
});

describe("useThrottledCallback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls immediately on first invocation", () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useThrottledCallback(callback, 300));

    act(() => {
      result.current("arg1");
    });

    expect(callback).toHaveBeenCalledWith("arg1");
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("ignores calls within throttle window", () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useThrottledCallback(callback, 300));

    act(() => {
      result.current("first");
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    act(() => {
      result.current("second");
    });

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("calls again after throttle window", () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useThrottledCallback(callback, 300));

    act(() => {
      result.current("first");
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    act(() => {
      result.current("second");
    });

    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenLastCalledWith("second");
  });

  it("schedules deferred call when within window", () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useThrottledCallback(callback, 300));

    act(() => {
      result.current("first");
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    act(() => {
      result.current("second");
    });

    expect(callback).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenLastCalledWith("second");
  });
});
