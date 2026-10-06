import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMessengerStore } from "@/stores/messengerStore";
import type { ConversationView } from "@/components/messenger/types";
import { useTabTitle, formatUnreadTitle } from "./useTabTitle";

const { applyUnreadBadges } = vi.hoisted(() => ({ applyUnreadBadges: vi.fn() }));
vi.mock("@/utils/unreadBadges", () => ({ applyUnreadBadges }));

function seedUnread(counts: number[]) {
  useMessengerStore.setState({
    conversations: counts.map(
      (count, i) => ({ id: `c${i}`, unread_count: count }) as unknown as ConversationView,
    ),
  });
}

let hidden = false;

beforeEach(() => {
  vi.clearAllMocks();
  hidden = false;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  });
  useMessengerStore.setState({ conversations: [] });
  document.title = "gomo6";
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useTabTitle", () => {
  it("shows the total unread count when the tab is visible", () => {
    seedUnread([2, 3]);

    renderHook(() => useTabTitle());

    expect(document.title).toBe(formatUnreadTitle(5));
    expect(applyUnreadBadges).toHaveBeenCalledWith(5);
  });

  it("falls back to the bare brand title when everything is read", () => {
    seedUnread([0, 0]);

    renderHook(() => useTabTitle());

    expect(document.title).toBe("gomo6");
    expect(applyUnreadBadges).toHaveBeenCalledWith(0);
  });

  it("never blinks for a message that arrives while the tab is visible", () => {
    vi.useFakeTimers();
    seedUnread([0]);

    renderHook(() => useTabTitle());
    act(() => seedUnread([1]));

    expect(document.title).toBe(formatUnreadTitle(1));

    act(() => vi.advanceTimersByTime(10_000));
    expect(document.title).toBe(formatUnreadTitle(1));
  });

  it("pulses a few times for a new message in a hidden tab, then settles", () => {
    vi.useFakeTimers();
    hidden = true;
    seedUnread([0]);

    renderHook(() => useTabTitle());
    expect(document.title).toBe("gomo6");

    // A new message lands while hidden.
    act(() => seedUnread([1]));
    expect(document.title).toBe(formatUnreadTitle(1));

    act(() => vi.advanceTimersByTime(1100));
    expect(document.title).toBe("gomo6");
    act(() => vi.advanceTimersByTime(1100));
    expect(document.title).toBe(formatUnreadTitle(1));
    act(() => vi.advanceTimersByTime(1100));
    expect(document.title).toBe("gomo6");

    // Bounded: the pulse ends on the static count and schedules nothing more.
    act(() => vi.advanceTimersByTime(1100));
    expect(document.title).toBe(formatUnreadTitle(1));
    act(() => vi.advanceTimersByTime(10_000));
    expect(document.title).toBe(formatUnreadTitle(1));
  });

  it("stops a running pulse the moment the tab becomes visible", () => {
    vi.useFakeTimers();
    hidden = true;
    seedUnread([0]);

    renderHook(() => useTabTitle());
    act(() => seedUnread([2]));
    act(() => vi.advanceTimersByTime(1100)); // pulse is mid-flight on the bare title
    expect(document.title).toBe("gomo6");

    hidden = false;
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(document.title).toBe(formatUnreadTitle(2));

    act(() => vi.advanceTimersByTime(10_000));
    expect(document.title).toBe(formatUnreadTitle(2));
  });

  it("clears the title and badges on unmount", () => {
    seedUnread([4]);

    const { unmount } = renderHook(() => useTabTitle());
    unmount();

    expect(document.title).toBe("gomo6");
    expect(applyUnreadBadges).toHaveBeenLastCalledWith(0);
  });
});
