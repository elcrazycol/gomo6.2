import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock wsService (hoisted) ────────────────────────────────────────────────

const { mockWsService, emitToHandlers } = vi.hoisted(() => {
  const handlers = new Map<string, Set<(msg: unknown) => void>>();
  let _connected = false;

  const mockWsService = {
    get connected() { return _connected; },
    connect: vi.fn(() => { _connected = true; }),
    disconnect: vi.fn(() => { _connected = false; }),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    sendRaw: vi.fn(),
    on: vi.fn((type: string, handler: (msg: unknown) => void) => {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(handler);
      return () => { handlers.get(type)?.delete(handler); };
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

// ─── Mock zustand store (hoisted) ───────────────────────────────────────────

const { storeMocks, queueMarkDeliveredMock, queueMarkReadMock } = vi.hoisted(() => {
  const storeMocks = {
    addMessage: vi.fn(),
    updateMessage: vi.fn(),
    removeMessage: vi.fn(),
    setTyping: vi.fn(),
    updateConversationFromWs: vi.fn(),
    loadReceipts: vi.fn(),
    applyReadReceiptEvent: vi.fn(),
    applyDeliveryReceiptEvent: vi.fn(),
    applyConversationUpdatedEvent: vi.fn(),
    applyReactionEvent: vi.fn(),
    applyVoiceListenedEvent: vi.fn(),
  };
  const queueMarkDeliveredMock = vi.fn();
  const queueMarkReadMock = vi.fn();
  return { storeMocks, queueMarkDeliveredMock, queueMarkReadMock };
});

vi.mock("@/stores/messengerStore", () => ({
    getConversationReadThrough: () => null,
  useMessengerStore: {
    getState: vi.fn(() => ({
      ...storeMocks,
      me: { id: "u1", username: "test" },
      selectedConversationId: "conv-1",
    })),
  },
  queueMarkDelivered: (...args: unknown[]) => queueMarkDeliveredMock(...args),
  queueMarkRead: (...args: unknown[]) => queueMarkReadMock(...args),
}));

// ─── Import after mocks ──────────────────────────────────────────────────────

import { messengerWs } from "./messengerWebSocket";

describe("messengerWebSocket", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("auth_token", "test-token");
  });

  afterEach(() => {
    messengerWs.disconnect();
  });

  describe("connect", () => {
    it("registers handlers on wsService (does not call wsService.connect)", () => {
      messengerWs.connect();
      expect(mockWsService.connect).not.toHaveBeenCalled();
      expect(mockWsService.on).toHaveBeenCalledWith("new_chat_message", expect.any(Function));
      expect(mockWsService.on).toHaveBeenCalledWith("message_edited", expect.any(Function));
      expect(mockWsService.on).toHaveBeenCalledWith("message_notes_meta", expect.any(Function));
      expect(mockWsService.on).toHaveBeenCalledWith("message_deleted", expect.any(Function));
      expect(mockWsService.on).toHaveBeenCalledWith("message_reaction", expect.any(Function));
      expect(mockWsService.on).toHaveBeenCalledWith("message_voice_listened", expect.any(Function));
      expect(mockWsService.on).toHaveBeenCalledWith("read_receipt", expect.any(Function));
      expect(mockWsService.on).toHaveBeenCalledWith("chat_typing", expect.any(Function));
      // Presence (user_online/user_offline) is handled by the presence rooms
      // via useMessengerPresence, not by this legacy global-feed handler.
      expect(mockWsService.on).not.toHaveBeenCalledWith("user_online", expect.any(Function));
      expect(mockWsService.on).not.toHaveBeenCalledWith("user_offline", expect.any(Function));
      expect(mockWsService.on).toHaveBeenCalledWith("delivery_receipt", expect.any(Function));
      expect(mockWsService.on).toHaveBeenCalledWith("conversation_updated", expect.any(Function));
    });

    it("does not double-register handlers", () => {
      messengerWs.connect();
      messengerWs.connect();
      expect(mockWsService.on).toHaveBeenCalledTimes(11);
    });
  });

  describe("message handling", () => {
    beforeEach(() => {
      messengerWs.connect();
    });

    it("handles new_chat_message", () => {
      emitToHandlers("new_chat_message", {
        id: "msg-1",
        conversation_id: "conv-1",
        sender_user_id: "u2",
        content: "Hello!",
        is_edited: false,
        is_deleted: false,
        sent_at: "2025-01-01T00:00:00Z",
        client_id: "c1",
      });

      expect(storeMocks.addMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: "msg-1", content: "Hello!" }),
      );
      expect(storeMocks.updateConversationFromWs).toHaveBeenCalled();
    });

    it("handles message_edited", () => {
      emitToHandlers("message_edited", {
        id: "msg-1",
        content: "Edited",
      });

      expect(storeMocks.updateMessage).toHaveBeenCalledWith("msg-1", expect.objectContaining({
        content: "Edited",
        is_edited: true,
      }));
    });

    it("handles message_reaction as a delta", () => {
      emitToHandlers("message_reaction", {
        message_id: "msg-1",
        conversation_id: "conv-1",
        emoji: "🔥",
        user_id: "u2",
        username: "bob",
        action: "add",
      });

      expect(storeMocks.applyReactionEvent).toHaveBeenCalledWith({
        message_id: "msg-1",
        conversation_id: "conv-1",
        emoji: "🔥",
        user_id: "u2",
        username: "bob",
        action: "add",
      });
    });

    it("ignores a message_reaction without an emoji or an author", () => {
      emitToHandlers("message_reaction", { message_id: "msg-1", emoji: "", user_id: "u2", action: "add" });
      emitToHandlers("message_reaction", { message_id: "msg-1", emoji: "🔥", user_id: "", action: "add" });

      expect(storeMocks.applyReactionEvent).not.toHaveBeenCalled();
    });

    it("handles message_voice_listened as a listener delta", () => {
      emitToHandlers("message_voice_listened", { message_id: "msg-1", conversation_id: "conv-1", user_id: "u2" });

      expect(storeMocks.applyVoiceListenedEvent).toHaveBeenCalledWith({ message_id: "msg-1", user_id: "u2" });
    });

    it("ignores a message_voice_listened without ids", () => {
      emitToHandlers("message_voice_listened", { message_id: "", user_id: "u2" });
      emitToHandlers("message_voice_listened", { message_id: "msg-1", user_id: "" });
      expect(storeMocks.applyVoiceListenedEvent).not.toHaveBeenCalled();
    });

    it("handles message_notes_meta", () => {
      emitToHandlers("message_notes_meta", {
        id: "msg-1",
        conversation_id: "conv-1",
        notes_meta: "e2enote1:someciphertext",
      });

      expect(storeMocks.updateMessage).toHaveBeenCalledWith("msg-1", {
        notes_meta: "e2enote1:someciphertext",
      });
    });

    it("handles message_deleted", () => {
      emitToHandlers("message_deleted", { id: "msg-1" });
      expect(storeMocks.removeMessage).toHaveBeenCalledWith("msg-1");
    });

    it("handles read_receipt in O(1) via applyReadReceiptEvent", () => {
      emitToHandlers("read_receipt", { message_id: "msg-1", user_id: "u2", conversation_id: "conv-1", read_at: "2025-01-01T00:05:00Z" });
      expect(storeMocks.applyReadReceiptEvent).toHaveBeenCalledWith({
        conversation_id: "conv-1",
        user_id: "u2",
        message_id: "msg-1",
        read_at: "2025-01-01T00:05:00Z",
      });
      expect(storeMocks.loadReceipts).not.toHaveBeenCalled();
    });

    it("handles delivery_receipt in O(1)", () => {
      emitToHandlers("delivery_receipt", { conversation_id: "conv-1", user_id: "u2", message_id: "msg-9", delivered_at: "2025-01-01T00:04:00Z" });
      expect(storeMocks.applyDeliveryReceiptEvent).toHaveBeenCalledWith({
        conversation_id: "conv-1",
        user_id: "u2",
        message_id: "msg-9",
        delivered_at: "2025-01-01T00:04:00Z",
      });
    });

    it("handles conversation_updated by refetching the list", () => {
      emitToHandlers("conversation_updated", { conversation_id: "conv-1", encryption_mode: "e2e" });
      expect(storeMocks.applyConversationUpdatedEvent).toHaveBeenCalledWith({
        conversation_id: "conv-1",
        encryption_mode: "e2e",
        preview_changed: false,
      });
    });

    it("forwards preview_changed on conversation_updated", () => {
      emitToHandlers("conversation_updated", { conversation_id: "conv-1", preview_changed: true });
      expect(storeMocks.applyConversationUpdatedEvent).toHaveBeenCalledWith({
        conversation_id: "conv-1",
        encryption_mode: undefined,
        preview_changed: true,
      });
    });

    it("handles chat_typing", () => {
      emitToHandlers("chat_typing", { user_id: "u2", username: "alice", is_typing: true });
      expect(storeMocks.setTyping).toHaveBeenCalled();
    });

    it("queues markDelivered (not markRead) for incoming messages", () => {
      emitToHandlers("new_chat_message", {
        id: "msg-1",
        conversation_id: "conv-1",
        sender_user_id: "u2",
        content: "Hi",
        sent_at: "2025-01-01T00:00:00Z",
      });

      expect(queueMarkDeliveredMock).toHaveBeenCalledWith("conv-1", "msg-1", "2025-01-01T00:00:00Z");
      // Read marking is visibility-based (owned by MessageList), not arrival-based.
      expect(queueMarkReadMock).not.toHaveBeenCalled();
    });

    it("skips markDelivered for own messages", () => {
      emitToHandlers("new_chat_message", {
        id: "msg-1",
        conversation_id: "conv-1",
        sender_user_id: "u1",
        content: "Hi",
        sent_at: "2025-01-01T00:00:00Z",
      });

      expect(queueMarkDeliveredMock).not.toHaveBeenCalled();
      expect(queueMarkReadMock).not.toHaveBeenCalled();
    });
  });

  describe("sendTyping", () => {
    it("sends typing event via wsService.sendRaw", () => {
      messengerWs.sendTyping("conv-1", true);
      expect(mockWsService.sendRaw).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "chat_typing",
          room: "chat_conv-1",
          data: { is_typing: true, conversation_id: "conv-1" },
        }),
      );
    });
  });
});
