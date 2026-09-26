import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useProfileRealtimeInvalidation } from "./useProfileRealtimeInvalidation";

const mockOn = vi.fn();
const mockSubscribeToFeed = vi.fn();
const mockEnsureConnected = vi.fn();
let socketConnected = true;

vi.mock("@/services/websocket", () => ({
  wsService: {
    on: (...args: unknown[]) => mockOn(...args),
    subscribeToFeed: () => mockSubscribeToFeed(),
    ensureConnected: () => mockEnsureConnected(),
    get connected() {
      return socketConnected;
    },
  },
}));

const mockDispatch = vi.fn();
vi.mock("@/utils/profileCustomization", () => ({
  dispatchProfileCacheInvalidate: () => mockDispatch(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockOn.mockReturnValue(() => {});
  socketConnected = true;
});

describe("useProfileRealtimeInvalidation", () => {
  it("re-broadcasts a server profile_updated as the local invalidate event", () => {
    renderHook(() => useProfileRealtimeInvalidation());

    expect(mockOn).toHaveBeenCalledWith("profile_updated", expect.any(Function));

    // Simulate the server broadcast arriving.
    const handler = mockOn.mock.calls[0][1] as (msg: unknown) => void;
    handler({ type: "profile_updated", data: { user_id: "user-2" } });

    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes when it unmounts", () => {
    const unsubscribe = vi.fn();
    mockOn.mockReturnValue(unsubscribe);

    const { unmount } = renderHook(() => useProfileRealtimeInvalidation());
    unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("repairs a dead socket and resyncs caches when the tab comes back", () => {
    // A viewer whose socket died while the tab was hidden may have missed
    // profile_updated events and would otherwise keep the stale nickname.
    socketConnected = false;
    renderHook(() => useProfileRealtimeInvalidation());

    document.dispatchEvent(new Event("visibilitychange"));

    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockSubscribeToFeed).toHaveBeenCalledTimes(1);
    expect(mockEnsureConnected).toHaveBeenCalledTimes(1);
  });

  it("leaves a live socket alone (events arrived as they happened)", () => {
    socketConnected = true;
    renderHook(() => useProfileRealtimeInvalidation());

    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));

    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockEnsureConnected).not.toHaveBeenCalled();
  });

  it("recovers when the network comes back", () => {
    socketConnected = false;
    renderHook(() => useProfileRealtimeInvalidation());

    window.dispatchEvent(new Event("online"));

    expect(mockEnsureConnected).toHaveBeenCalledTimes(1);
  });

  it("stops listening when it unmounts", () => {
    socketConnected = false;
    const { unmount } = renderHook(() => useProfileRealtimeInvalidation());
    unmount();

    window.dispatchEvent(new Event("online"));

    expect(mockEnsureConnected).not.toHaveBeenCalled();
  });
});
