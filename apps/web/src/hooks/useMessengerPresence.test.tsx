import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { destroyMessenger, useMessengerStore } from "@/stores/messengerStore";
import type { ConversationView } from "@/components/messenger/types";

// ─── Mock wsService (hoisted) ────────────────────────────────────────────────

const { mockWsService, emitToHandlers } = vi.hoisted(() => {
  const handlers = new Map<string, Set<(msg: unknown) => void>>();

  const mockWsService = {
    subscribeShared: vi.fn(),
    unsubscribeShared: vi.fn(),
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

  return { mockWsService, emitToHandlers };
});

vi.mock("@/services/websocket", () => ({
  wsService: mockWsService,
}));

// ─── Import after mocks ──────────────────────────────────────────────────────

import { useMessengerPresence } from "./useMessengerPresence";

function mockConv(overrides: Partial<ConversationView> = {}): ConversationView {
  return {
    id: "conv-1",
    last_message_at: "2025-06-01T12:00:00Z",
    last_message_preview: null,
    last_message_sender_id: null,
    pinned_message_id: null,
    updated_at: "2025-06-01T12:00:00Z",
    unread_count: 0,
    is_muted: false,
    other_user_id: "u2",
    other_username: "alice",
    other_avatar_url: null,
    other_account_number: null,
    other_is_online: null,
    other_last_seen_at: null,
    is_group: false,
    group_name: null,
    group_avatar_url: null,
    member_count: 2,
    ...overrides,
  };
}

describe("useMessengerPresence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    destroyMessenger();
    useMessengerStore.setState({
      me: { id: "u1", username: "me" },
      conversations: [],
      onlineUsers: new Set(),
    });
  });

  afterEach(() => {
    destroyMessenger();
    vi.restoreAllMocks();
  });

  it("subscribes to presence rooms of 1:1 partners only (not groups, notes, self)", () => {
    useMessengerStore.setState({
      conversations: [
        mockConv({ id: "conv-1", other_user_id: "u2" }),
        mockConv({ id: "conv-group", is_group: true, other_user_id: null }),
        mockConv({ id: "notes", is_notes: true, other_user_id: null }),
        mockConv({ id: "conv-self", other_user_id: "u1" }),
      ],
    });

    renderHook(() => useMessengerPresence());

    expect(mockWsService.subscribeShared).toHaveBeenCalledTimes(1);
    expect(mockWsService.subscribeShared).toHaveBeenCalledWith("presence_u2");
  });

  it("releases rooms on unmount", () => {
    useMessengerStore.setState({ conversations: [mockConv({ other_user_id: "u2" })] });

    const { unmount } = renderHook(() => useMessengerPresence());
    unmount();

    expect(mockWsService.unsubscribeShared).toHaveBeenCalledWith("presence_u2");
  });

  it("applies presence_snapshot into the store conversation + onlineUsers", async () => {
    useMessengerStore.setState({
      conversations: [mockConv({ other_user_id: "u2", other_is_online: null, other_last_seen_at: null })],
    });

    renderHook(() => useMessengerPresence());

    act(() => {
      emitToHandlers("presence_snapshot", {
        user_id: "u2",
        is_online: true,
        last_seen: "2025-06-01T12:00:00Z",
      });
    });

    await waitFor(() => {
      const state = useMessengerStore.getState();
      expect(state.onlineUsers.has("u2")).toBe(true);
      const conv = state.conversations.find((c) => c.id === "conv-1")!;
      expect(conv.other_is_online).toBe(true);
      expect(conv.other_last_seen_at).toBe("2025-06-01T12:00:00Z");
    });
  });

  it("applies user_offline delta, preserving last_seen from the snapshot", async () => {
    useMessengerStore.setState({
      conversations: [mockConv({ other_user_id: "u2", other_is_online: true, other_last_seen_at: "2025-06-01T12:00:00Z" })],
    });

    renderHook(() => useMessengerPresence());

    act(() => {
      emitToHandlers("user_offline", { user_id: "u2", is_online: false });
    });

    await waitFor(() => {
      const state = useMessengerStore.getState();
      expect(state.onlineUsers.has("u2")).toBe(false);
      const conv = state.conversations.find((c) => c.id === "conv-1")!;
      expect(conv.other_is_online).toBe(false);
      expect(conv.other_last_seen_at).toBe("2025-06-01T12:00:00Z");
    });
  });

  it("ignores events for users without a subscription", async () => {
    useMessengerStore.setState({ conversations: [mockConv({ other_user_id: "u2" })] });

    renderHook(() => useMessengerPresence());

    act(() => {
      emitToHandlers("user_online", { user_id: "u99", is_online: true });
    });

    expect(useMessengerStore.getState().onlineUsers.has("u99")).toBe(false);
  });
});
