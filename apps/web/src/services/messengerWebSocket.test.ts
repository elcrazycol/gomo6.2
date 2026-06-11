import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock WebSocket ──────────────────────────────────────────────────────────

class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState: number = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: ((event?: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  sentMessages: string[] = [];
  url: string;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close(_code?: number, _reason?: string) {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  simulateMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }

  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }
}

// @ts-expect-error - replace global WebSocket
global.WebSocket = MockWebSocket;

// ─── Mock zustand store ──────────────────────────────────────────────────────

const storeMocks = {
  addMessage: vi.fn(),
  updateMessage: vi.fn(),
  removeMessage: vi.fn(),
  setTyping: vi.fn(),
  setUserOnline: vi.fn(),
  updateConversationFromWs: vi.fn(),
  loadReceipts: vi.fn(),
};

vi.mock("@/stores/messengerStore", () => ({
  useMessengerStore: {
    getState: vi.fn(() => ({
      ...storeMocks,
      selectedConversationId: "conv-1",
    })),
  },
}));

// ─── Import after mocks ──────────────────────────────────────────────────────

import { messengerWs } from "./messengerWebSocket";

describe("messengerWebSocket", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockWebSocket.instances = [];
    localStorage.setItem("auth_token", "test-token");
    vi.useFakeTimers();
  });

  afterEach(() => {
    messengerWs.disconnect();
    vi.useRealTimers();
  });

  describe("connect", () => {
    it("creates WebSocket when token exists", () => {
      const promise = messengerWs.connect();
      expect(MockWebSocket.instances.length).toBe(1);
    });

    it("does not connect if no token", () => {
      localStorage.removeItem("auth_token");
      messengerWs.connect();
      expect(MockWebSocket.instances.length).toBe(0);
    });

    it("does not double-connect while connecting", () => {
      messengerWs.connect();
      expect(MockWebSocket.instances.length).toBe(1);
      messengerWs.connect();
      expect(MockWebSocket.instances.length).toBe(1);
    });

    it("reconnects on close with backoff", () => {
      messengerWs.connect();
      const ws = MockWebSocket.instances[0]!;

      // Simulate close
      ws.close();
      expect(MockWebSocket.instances.length).toBe(1);

      // First reconnect attempt
      vi.advanceTimersByTime(1100);
      expect(MockWebSocket.instances.length).toBe(2);

      // Second close
      MockWebSocket.instances[1]!.close();
      vi.advanceTimersByTime(2100);
      expect(MockWebSocket.instances.length).toBe(3);
    });
  });

  describe("subscribe / unsubscribe", () => {
    it("sends auth on open, subscribe after server confirms", () => {
      messengerWs.connect();
      messengerWs.subscribe("chat_conv-1");

      const ws = MockWebSocket.instances[0]!;
      expect(ws.sentMessages.length).toBe(0); // Not connected yet

      // Connection opens — sends auth first
      ws.simulateOpen();
      expect(ws.sentMessages.length).toBeGreaterThanOrEqual(1);
      const authMsg = JSON.parse(ws.sentMessages[0]!);
      expect(authMsg.type).toBe("auth");

      // Server confirms auth — triggers resubscribeAll
      ws.simulateMessage({ type: "connected", data: { user_id: "u1" } });
      expect(ws.sentMessages.length).toBeGreaterThanOrEqual(2);
      const subMsg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]!);
      expect(subMsg.type).toBe("subscribe");
    });

    it("sends unsubscribe message when connected", () => {
      messengerWs.connect();
      const ws = MockWebSocket.instances[0]!;
      ws.simulateOpen(); // Must be connected first

      messengerWs.subscribe("chat_conv-1");
      messengerWs.unsubscribe("chat_conv-1");

      // Should have sent both subscribe and unsubscribe
      const messages = ws.sentMessages.map((m) => JSON.parse(m));
      const types = messages.map((m) => m.type as string);
      expect(types).toContain("subscribe");
      expect(types).toContain("unsubscribe");
    });
  });

  describe("message handling", () => {
    beforeEach(() => {
      messengerWs.connect();
      const ws = MockWebSocket.instances[0]!;
      ws.simulateOpen();
      messengerWs.subscribe("chat_conv-1");
    });

    it("handles new_chat_message", () => {
      const ws = MockWebSocket.instances[0]!;
      ws.simulateMessage({
        type: "new_chat_message",
        data: {
          id: "msg-1",
          conversation_id: "conv-1",
          sender_user_id: "u2",
          content: "Hello!",
          is_edited: false,
          is_deleted: false,
          sent_at: "2025-01-01T00:00:00Z",
          client_id: "c1",
        },
      });

      expect(storeMocks.addMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: "msg-1", content: "Hello!" }),
      );
      expect(storeMocks.updateConversationFromWs).toHaveBeenCalled();
    });

    it("handles message_edited", () => {
      const ws = MockWebSocket.instances[0]!;
      ws.simulateMessage({
        type: "message_edited",
        data: { id: "msg-1", content: "Edited" },
      });

      expect(storeMocks.updateMessage).toHaveBeenCalledWith("msg-1", expect.objectContaining({
        content: "Edited",
        is_edited: true,
      }));
    });

    it("handles message_deleted", () => {
      const ws = MockWebSocket.instances[0]!;
      ws.simulateMessage({
        type: "message_deleted",
        data: { id: "msg-1" },
      });

      expect(storeMocks.removeMessage).toHaveBeenCalledWith("msg-1");
    });

    it("handles read_receipt", () => {
      const ws = MockWebSocket.instances[0]!;
      ws.simulateMessage({
        type: "read_receipt",
        data: { message_id: "msg-1", user_id: "u2" },
      });

      expect(storeMocks.loadReceipts).toHaveBeenCalledWith("conv-1");
    });

    it("handles chat_typing", () => {
      const ws = MockWebSocket.instances[0]!;
      ws.simulateMessage({
        type: "chat_typing",
        data: { user_id: "u2", username: "alice", is_typing: true },
      });

      expect(storeMocks.setTyping).toHaveBeenCalled();
    });

    it("handles user_online", () => {
      const ws = MockWebSocket.instances[0]!;
      ws.simulateMessage({
        type: "user_online",
        data: { user_id: "u2" },
      });

      expect(storeMocks.setUserOnline).toHaveBeenCalledWith("u2", true);
    });

    it("handles user_offline", () => {
      const ws = MockWebSocket.instances[0]!;
      ws.simulateMessage({
        type: "user_offline",
        data: { user_id: "u2" },
      });

      expect(storeMocks.setUserOnline).toHaveBeenCalledWith("u2", false);
    });

    it("ignores malformed JSON gracefully", () => {
      const ws = MockWebSocket.instances[0]!;
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

      ws.onmessage?.({ data: "not valid json" } as MessageEvent);
      // Should not throw

      consoleError.mockRestore();
    });
  });

  describe("sendTyping", () => {
    it("sends typing event", () => {
      messengerWs.connect();
      const ws = MockWebSocket.instances[0]!;
      ws.simulateOpen();
      messengerWs.sendTyping("conv-1", true);

      const msgs = ws.sentMessages;
      expect(msgs.length).toBeGreaterThan(0);
      const msg = JSON.parse(msgs[msgs.length - 1]!);
      expect(msg.type).toBe("chat_typing");
      expect(msg.room).toBe("chat_conv-1");
    });
  });
});
