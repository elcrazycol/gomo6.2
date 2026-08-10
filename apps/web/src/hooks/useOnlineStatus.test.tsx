import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockUpdate = vi.fn();

vi.mock("@/integrations/api/compat", () => ({
  api: {
    from: () => ({
      update: (...args: any[]) => {
        const result = mockUpdate(...args);
        // Chainable eq() that resolves to the update promise.
        return { eq: () => result };
      },
    }),
  },
}));

// useOnlineStatus keeps SESSION-scoped state in the module. Each test imports a
// fresh module instance (vi.resetModules) so the state never leaks between
// tests, while the session-shared behavior within a test is preserved.
let useOnlineStatus: (userId: string | undefined) => void;

beforeEach(async () => {
  mockUpdate.mockReset();
  mockUpdate.mockResolvedValue({ data: null, error: null });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  vi.resetModules();
  const mod = await import("./useOnlineStatus");
  useOnlineStatus = mod.useOnlineStatus;
});

const flush = () => act(async () => {});

describe("useOnlineStatus", () => {
  it("writes online once on first mount with a userId", async () => {
    renderHook(() => useOnlineStatus("user-1"));

    await flush();
    await flush();
    await flush();

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith({ is_online: true, last_seen_at: expect.any(String) });
  });

  it("does NOT write again on a second mount in the same session", async () => {
    const { unmount } = renderHook(() => useOnlineStatus("user-1"));
    await flush();
    await flush();

    unmount();

    // Simulate SPA navigation: same session, new page mount.
    renderHook(() => useOnlineStatus("user-1"));
    await flush();
    await flush();

    // Still only the first write — the second mount skipped because the
    // session ref already knows we are online.
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it("does NOT write offline when the tab is hidden (hub owns offline)", async () => {
    renderHook(() => useOnlineStatus("user-1"));
    await flush();
    await flush();

    act(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();
    await flush();

    // Still only the initial online write — tab-hide defers to the WS hub.
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it("writes offline on pagehide and online again on the next mount", async () => {
    const { unmount } = renderHook(() => useOnlineStatus("user-1"));
    await flush();
    await flush();

    // Real navigation away (pagehide) → offline write.
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    await flush();
    await flush();

    expect(mockUpdate).toHaveBeenCalledTimes(2);
    expect(mockUpdate).toHaveBeenLastCalledWith({ is_online: false, last_seen_at: expect.any(String) });

    unmount();

    // Next mount in the new page: session ref was reset to offline → writes online.
    renderHook(() => useOnlineStatus("user-1"));
    await flush();
    await flush();

    expect(mockUpdate).toHaveBeenCalledTimes(3);
    expect(mockUpdate).toHaveBeenLastCalledWith({ is_online: true, last_seen_at: expect.any(String) });
  });

  it("does not write when there is no userId", async () => {
    renderHook(() => useOnlineStatus(undefined));

    await flush();
    await flush();

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("retries a failed write instead of remembering it", async () => {
    mockUpdate.mockRejectedValueOnce(new Error("network down"));

    renderHook(() => useOnlineStatus("user-1"));
    await flush();
    await flush();

    // First attempt failed → not remembered, so the next heartbeat (60s) or
    // visibility toggle retries. Simulate the retry via a visibility cycle.
    act(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    act(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();
    await flush();

    // failed online + retried online (no offline write on hide)
    expect(mockUpdate).toHaveBeenCalledTimes(2);
  });
});
