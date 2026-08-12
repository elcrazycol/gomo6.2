import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ─── Mock wsService (hoisted) ────────────────────────────────────────────────

const { mockWsService, emitToHandlers, subscribedRooms } = vi.hoisted(() => {
  const handlers = new Map<string, Set<(msg: unknown) => void>>();
  const subscribedRooms = new Map<string, number>();

  const mockWsService = {
    subscribeShared: vi.fn((room: string) => {
      subscribedRooms.set(room, (subscribedRooms.get(room) ?? 0) + 1);
    }),
    unsubscribeShared: vi.fn((room: string) => {
      const count = (subscribedRooms.get(room) ?? 0) - 1;
      if (count <= 0) subscribedRooms.delete(room);
      else subscribedRooms.set(room, count);
    }),
    on: vi.fn((type: string, handler: (msg: unknown) => void) => {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(handler);
      return () => {
        handlers.get(type)?.delete(handler);
      };
    }),
  };

  function emitToHandlers(type: string, data: unknown) {
    const h = handlers.get(type);
    if (h) {
      for (const fn of h) {
        fn({ type, data, timestamp: Date.now() });
      }
    }
  }

  return { mockWsService, emitToHandlers, subscribedRooms };
});

vi.mock("@/services/websocket", () => ({
  wsService: mockWsService,
}));

// ─── Import after mocks ──────────────────────────────────────────────────────

import { useUserRealtimeStatus, useRealtimeOnlineStatus } from "./useRealtimeStatus";

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderHookWithClient<T>(callback: () => T) {
  const queryClient = makeQueryClient();
  return renderHook(callback, {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

describe("useRealtimeStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    subscribedRooms.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("useUserRealtimeStatus", () => {
    it("subscribes to presence_<userId> on mount and releases on unmount", () => {
      const { unmount } = renderHookWithClient(() => useUserRealtimeStatus("u42"));

      expect(mockWsService.subscribeShared).toHaveBeenCalledWith("presence_u42");
      expect(subscribedRooms.get("presence_u42")).toBe(1);

      unmount();
      expect(subscribedRooms.has("presence_u42")).toBe(false);
      expect(mockWsService.unsubscribeShared).toHaveBeenCalledWith("presence_u42");
    });

    it("does not subscribe without a userId or when disabled", () => {
      renderHookWithClient(() => useUserRealtimeStatus(undefined));
      renderHookWithClient(() => useUserRealtimeStatus("u42", false));

      expect(mockWsService.subscribeShared).not.toHaveBeenCalled();
    });

    it("applies presence_snapshot (is_online + last_seen)", async () => {
      const { result } = renderHookWithClient(() => useUserRealtimeStatus("u42"));

      act(() => {
        emitToHandlers("presence_snapshot", {
          user_id: "u42",
          is_online: true,
          last_seen: "2025-06-01T12:00:00Z",
        });
      });

      await waitFor(() => {
        expect(result.current).toEqual({
          user_id: "u42",
          is_online: true,
          last_seen: "2025-06-01T12:00:00Z",
        });
      });
    });

    it("ignores events for other users", () => {
      const { result } = renderHookWithClient(() => useUserRealtimeStatus("u42"));

      act(() => {
        emitToHandlers("presence_snapshot", { user_id: "u99", is_online: true });
        emitToHandlers("user_online", { user_id: "u99", is_online: true });
      });

      expect(result.current).toBeNull();
    });

    it("applies user_online / user_offline deltas and preserves last_seen on offline", async () => {
      const { result } = renderHookWithClient(() => useUserRealtimeStatus("u42"));

      act(() => {
        emitToHandlers("presence_snapshot", {
          user_id: "u42",
          is_online: true,
          last_seen: "2025-06-01T12:00:00Z",
        });
      });
      await waitFor(() => expect(result.current?.is_online).toBe(true));

      // Delta without last_seen must keep the snapshot's value.
      act(() => {
        emitToHandlers("user_offline", { user_id: "u42", is_online: false });
      });
      await waitFor(() => {
        expect(result.current).toEqual({
          user_id: "u42",
          is_online: false,
          last_seen: "2025-06-01T12:00:00Z",
        });
      });

      // Delta WITH last_seen wins.
      act(() => {
        emitToHandlers("user_offline", {
          user_id: "u42",
          is_online: false,
          last_seen: "2025-06-01T11:00:00Z",
        });
      });
      await waitFor(() => expect(result.current?.last_seen).toBe("2025-06-01T11:00:00Z"));
    });

    it("updates the profile-hover react-query cache", async () => {
      const queryClient = makeQueryClient();
      queryClient.setQueryData(["profile-hover", "u42"], {
        profile: { id: "u42", is_online: false },
      });

      renderHook(
        () => useUserRealtimeStatus("u42"),
        {
          wrapper: ({ children }: { children: React.ReactNode }) => (
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
          ),
        },
      );

      act(() => {
        emitToHandlers("user_online", { user_id: "u42", is_online: true });
      });

      await waitFor(() => {
        const cached = queryClient.getQueryData<{ profile: { is_online: boolean } }>([
          "profile-hover",
          "u42",
        ]);
        expect(cached?.profile.is_online).toBe(true);
      });
    });
  });

  describe("useRealtimeOnlineStatus", () => {
    it("subscribes to each user's presence room and returns a status map", async () => {
      const { result } = renderHookWithClient(() => useRealtimeOnlineStatus(["u1", "u2"]));

      expect(mockWsService.subscribeShared).toHaveBeenCalledWith("presence_u1");
      expect(mockWsService.subscribeShared).toHaveBeenCalledWith("presence_u2");

      act(() => {
        emitToHandlers("presence_snapshot", { user_id: "u1", is_online: true, last_seen: "2025-06-01T12:00:00Z" });
      });

      await waitFor(() => {
        expect(result.current.get("u1")).toEqual({
          user_id: "u1",
          is_online: true,
          last_seen: "2025-06-01T12:00:00Z",
        });
      });
    });

    it("caps live subscriptions at 30 users", () => {
      const ids = Array.from({ length: 40 }, (_, i) => `u${i}`);
      const { unmount } = renderHookWithClient(() => useRealtimeOnlineStatus(ids));

      expect(mockWsService.subscribeShared).toHaveBeenCalledTimes(30);
      expect(mockWsService.subscribeShared).toHaveBeenCalledWith("presence_u0");
      expect(mockWsService.subscribeShared).not.toHaveBeenCalledWith("presence_u39");

      unmount();
      expect(subscribedRooms.size).toBe(0);
    });

    it("releases all rooms on unmount", () => {
      const { unmount } = renderHookWithClient(() => useRealtimeOnlineStatus(["u1", "u2"]));

      unmount();
      expect(subscribedRooms.has("presence_u1")).toBe(false);
      expect(subscribedRooms.has("presence_u2")).toBe(false);
    });
  });
});
