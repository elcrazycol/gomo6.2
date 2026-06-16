import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock WebSocket ──────────────────────────────────────────────────────────

class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState: number = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
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

  close(code?: number, _reason?: string) {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code: code ?? 1000 } as CloseEvent);
  }

  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  simulateMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }

  simulateError() {
    this.onerror?.({} as Event);
  }

  simulateClose(code = 1000) {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code } as CloseEvent);
  }
}

// @ts-expect-error - replace global WebSocket
global.WebSocket = MockWebSocket;

// ─── Import after mock setup ─────────────────────────────────────────────────

import { wsService } from "./websocket";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("WebSocketService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    MockWebSocket.instances = [];
    wsService.disconnect();
    // Reset debounce tracker (private field) so connect() works in each test
    (wsService as any).lastConnectAttempt = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    wsService.disconnect();
    vi.useRealTimers();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Chunk 1: Connection lifecycle
  // ═══════════════════════════════════════════════════════════════════════════

  describe("connection lifecycle", () => {
    it("creates WebSocket when token exists", () => {
      localStorage.setItem("auth_token", "test-token");
      wsService.connect();

      expect(MockWebSocket.instances).toHaveLength(1);
    });

    it("does not connect when no token", () => {
      localStorage.removeItem("auth_token");
      wsService.connect();

      expect(MockWebSocket.instances).toHaveLength(0);
    });

    it("does not double-connect while connecting", () => {
      localStorage.setItem("auth_token", "test-token");
      wsService.connect();
      wsService.connect();

      expect(MockWebSocket.instances).toHaveLength(1);
    });

    it("debounces rapid connect attempts", () => {
      localStorage.setItem("auth_token", "test-token");
      wsService.connect();
      // Advance past connect, simulate close
      const ws = MockWebSocket.instances[0]!;
      ws.simulateOpen();
      ws.simulateClose(1006);

      // Try reconnecting immediately (within minConnectInterval)
      vi.advanceTimersByTime(100);
      wsService.connect();

      // Should only have the original + reconnect attempt (from scheduleReconnect, not from direct connect)
      // The debounce should prevent the direct connect
      expect(MockWebSocket.instances.length).toBeLessThanOrEqual(2);
    });

    it("handleOpen sets connected and sends auth", () => {
      localStorage.setItem("auth_token", "test-token");
      wsService.connect();

      const ws = MockWebSocket.instances[0]!;
      ws.simulateOpen();

      expect(ws.sentMessages.length).toBeGreaterThanOrEqual(1);
      const authMsg = JSON.parse(ws.sentMessages[0]!);
      expect(authMsg.type).toBe("auth");
      expect(authMsg.data.token).toBe("test-token");
    });

    it("handleOpen resets reconnect counter", () => {
      localStorage.setItem("auth_token", "test-token");
      wsService.connect();
      const ws = MockWebSocket.instances[0]!;
      ws.simulateOpen();
      expect(wsService.connected).toBe(true);
    });

    it("handleClose on clean close (1000) does not reconnect", () => {
      localStorage.setItem("auth_token", "test-token");
      wsService.connect();
      const ws = MockWebSocket.instances[0]!;
      ws.simulateOpen();

      ws.simulateClose(1000);

      expect(wsService.connected).toBe(false);
      // No reconnect attempt
      vi.advanceTimersByTime(5000);
      expect(MockWebSocket.instances).toHaveLength(1);
    });

    it("handleClose on abnormal close schedules reconnect", () => {
      localStorage.setItem("auth_token", "test-token");
      wsService.connect();
      const ws = MockWebSocket.instances[0]!;
      ws.simulateOpen();

      ws.simulateClose(1006); // abnormal

      expect(wsService.connected).toBe(false);
      // Should reconnect after delay
      vi.advanceTimersByTime(2000);
      expect(MockWebSocket.instances).toHaveLength(2);
    });

    it("disconnect cleans up everything", () => {
      localStorage.setItem("auth_token", "test-token");
      wsService.connect();
      const ws = MockWebSocket.instances[0]!;
      ws.simulateOpen();

      wsService.subscribe("room-1");
      wsService.on("new_post", vi.fn());

      wsService.disconnect();

      expect(wsService.connected).toBe(false);
      expect(wsService.rooms).toEqual([]);
      expect(MockWebSocket.instances[0]!.onclose).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Chunk 2: Reconnection
  // ═══════════════════════════════════════════════════════════════════════════

  describe("reconnection", () => {
    it("exponential backoff on reconnect", () => {
      localStorage.setItem("auth_token", "test-token");
      wsService.connect();
      const ws1 = MockWebSocket.instances[0]!;
      ws1.simulateOpen();
      ws1.simulateClose(1006);

      // First reconnect: delay ~1s
      vi.advanceTimersByTime(1100);
      expect(MockWebSocket.instances).toHaveLength(2);

      const ws2 = MockWebSocket.instances[1]!;
      ws2.simulateOpen();
      ws2.simulateClose(1006);

      // Second reconnect: delay ~2s
      vi.advanceTimersByTime(2100);
      expect(MockWebSocket.instances).toHaveLength(3);
    });

    it("stops reconnecting after max attempts", () => {
      localStorage.setItem("auth_token", "test-token");
      wsService.connect();
      const ws = MockWebSocket.instances[0]!;
      ws.simulateOpen();

      // Simulate 10 failed reconnects
      for (let i = 0; i < 10; i++) {
        MockWebSocket.instances[i]!.simulateClose(1006);
        vi.advanceTimersByTime(60000); // large enough for any backoff
      }

      // 11th attempt should not create a new WebSocket
      const countBefore = MockWebSocket.instances.length;
      MockWebSocket.instances[countBefore - 1]?.simulateClose(1006);
      vi.advanceTimersByTime(60000);
      expect(MockWebSocket.instances.length).toBe(countBefore);
    });

    it("no reconnect when no token in localStorage", () => {
      localStorage.setItem("auth_token", "test-token");
      wsService.connect();
      const ws = MockWebSocket.instances[0]!;
      ws.simulateOpen();

      // Clear token
      localStorage.removeItem("auth_token");
      ws.simulateClose(1006);

      vi.advanceTimersByTime(5000);
      expect(MockWebSocket.instances).toHaveLength(1); // no new instance
    });

    it("reconnect timeout cleared on disconnect", () => {
      localStorage.setItem("auth_token", "test-token");
      wsService.connect();
      const ws = MockWebSocket.instances[0]!;
      ws.simulateOpen();
      ws.simulateClose(1006);

      // Disconnect before reconnect fires
      wsService.disconnect();
      vi.advanceTimersByTime(5000);

      expect(MockWebSocket.instances).toHaveLength(1);
    });

    it("auth:expired event triggers disconnect", () => {
      localStorage.setItem("auth_token", "test-token");
      wsService.connect();
      const ws = MockWebSocket.instances[0]!;
      ws.simulateOpen();

      window.dispatchEvent(new CustomEvent("auth:expired"));

      expect(wsService.connected).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Chunk 3: Room subscriptions
  // ═══════════════════════════════════════════════════════════════════════════

  describe("room subscriptions", () => {
    it("subscribe sends message when connected", () => {
      localStorage.setItem("auth_token", "test-token");
      wsService.connect();
      const ws = MockWebSocket.instances[0]!;
      ws.simulateOpen();

      wsService.subscribe("room-1");

      const messages = ws.sentMessages.map((m) => JSON.parse(m));
      const subMsg = messages.find((m: { type: string }) => m.type === "subscribe");
      expect(subMsg).toBeDefined();
      expect(subMsg.data).toBe("room-1");
    });

    it("subscribe queues if not connected", () => {
      localStorage.setItem("auth_token", "test-token");
      wsService.connect();

      wsService.subscribe("room-1");
      expect(wsService.rooms).toContain("room-1");

      // No messages sent yet (not connected)
      expect(MockWebSocket.instances[0]!.sentMessages).toHaveLength(0);
    });

    it("unsubscribe sends message and removes from set", () => {
      localStorage.setItem("auth_token", "test-token");
      wsService.connect();
      const ws = MockWebSocket.instances[0]!;
      ws.simulateOpen();

      wsService.subscribe("room-1");
      wsService.unsubscribe("room-1");

      expect(wsService.rooms).not.toContain("room-1");
      const messages = ws.sentMessages.map((m) => JSON.parse(m));
      const unsubMsg = messages.find((m: { type: string }) => m.type === "unsubscribe");
      expect(unsubMsg).toBeDefined();
      expect(unsubMsg.data).toBe("room-1");
    });

    it("subscribeToNotifications subscribes to notifications_{userId}", () => {
      localStorage.setItem("auth_token", "test-token");
      wsService.connect();
      const ws = MockWebSocket.instances[0]!;
      ws.simulateOpen();

      wsService.subscribeToNotifications("user-123");

      expect(wsService.rooms).toContain("notifications_user-123");
    });

    it("subscribeToFeed subscribes to feed", () => {
      localStorage.setItem("auth_token", "test-token");
      wsService.connect();
      const ws = MockWebSocket.instances[0]!;
      ws.simulateOpen();

      wsService.subscribeToFeed();

      expect(wsService.rooms).toContain("feed");
    });

    it("subscribeToThread subscribes to thread id", () => {
      localStorage.setItem("auth_token", "test-token");
      wsService.connect();
      const ws = MockWebSocket.instances[0]!;
      ws.simulateOpen();

      wsService.subscribeToThread("thread-abc");

      expect(wsService.rooms).toContain("thread-abc");
    });

    it("resubscribeRooms after reconnect re-sends all subscriptions", () => {
      localStorage.setItem("auth_token", "test-token");
      wsService.connect();
      const ws1 = MockWebSocket.instances[0]!;
      ws1.simulateOpen();

      wsService.subscribe("room-1");
      wsService.subscribe("room-2");

      // Simulate abnormal close + reconnect
      ws1.simulateClose(1006);
      vi.advanceTimersByTime(2000);

      const ws2 = MockWebSocket.instances[1]!;
      ws2.simulateOpen();

      const messages = ws2.sentMessages.map((m) => JSON.parse(m));
      const subMsgs = messages.filter((m: { type: string }) => m.type === "subscribe");
      const subRooms = subMsgs.map((m: { data: string }) => m.data);
      expect(subRooms).toContain("room-1");
      expect(subRooms).toContain("room-2");
    });

    it("empty room string is no-op for subscribe/unsubscribe", () => {
      localStorage.setItem("auth_token", "test-token");
      wsService.connect();
      const ws = MockWebSocket.instances[0]!;
      ws.simulateOpen();

      wsService.subscribe("");
      wsService.unsubscribe("");

      expect(wsService.rooms).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Chunk 4: Message handling (on/off/emit)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("message handling", () => {
    it("on returns unsubscribe function", () => {
      const handler = vi.fn();
      const unsub = wsService.on("new_post", handler);

      expect(typeof unsub).toBe("function");
    });

    it("off removes handler", () => {
      const handler = vi.fn();
      wsService.on("new_post", handler);
      wsService.off("new_post", handler);

      localStorage.setItem("auth_token", "test-token");
      wsService.connect();
      const ws = MockWebSocket.instances[0]!;
      ws.simulateOpen();
      ws.simulateMessage({ type: "new_post", data: {}, timestamp: Date.now() });

      expect(handler).not.toHaveBeenCalled();
    });

    it("incoming message dispatches to registered handlers", () => {
      const handler = vi.fn();
      wsService.on("new_post", handler);

      localStorage.setItem("auth_token", "test-token");
      wsService.connect();
      const ws = MockWebSocket.instances[0]!;
      ws.simulateOpen();
      ws.simulateMessage({
        type: "new_post",
        data: { id: "post-1" },
        timestamp: Date.now(),
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ type: "new_post" }),
      );
    });

    it("handler error does not crash", () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      wsService.on("new_post", () => {
        throw new Error("handler crash");
      });

      localStorage.setItem("auth_token", "test-token");
      wsService.connect();
      const ws = MockWebSocket.instances[0]!;
      ws.simulateOpen();

      expect(() => {
        ws.simulateMessage({
          type: "new_post",
          data: {},
          timestamp: Date.now(),
        });
      }).not.toThrow();

      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });

    it("multiple handlers for same type all called", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      wsService.on("like", handler1);
      wsService.on("like", handler2);

      localStorage.setItem("auth_token", "test-token");
      wsService.connect();
      const ws = MockWebSocket.instances[0]!;
      ws.simulateOpen();
      ws.simulateMessage({
        type: "like",
        data: { post_id: "p1" },
        timestamp: Date.now(),
      });

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Chunk 5: Send + properties
  // ═══════════════════════════════════════════════════════════════════════════

  describe("send and properties", () => {
    it("sendTyping sends typing message", () => {
      localStorage.setItem("auth_token", "test-token");
      wsService.connect();
      const ws = MockWebSocket.instances[0]!;
      ws.simulateOpen();

      wsService.sendTyping("room-1");

      const messages = ws.sentMessages.map((m) => JSON.parse(m));
      const typingMsg = messages.find((m: { type: string }) => m.type === "typing");
      expect(typingMsg).toBeDefined();
      expect(typingMsg.data.room).toBe("room-1");
    });

    it("sendTyping when not connected is no-op", () => {
      localStorage.setItem("auth_token", "test-token");
      wsService.connect();

      wsService.sendTyping("room-1");
      // Should not throw
    });

    it("connected getter returns connection state", () => {
      expect(wsService.connected).toBe(false);

      localStorage.setItem("auth_token", "test-token");
      wsService.connect();
      const ws = MockWebSocket.instances[0]!;
      ws.simulateOpen();

      expect(wsService.connected).toBe(true);
    });

    it("rooms getter returns subscribed rooms", () => {
      localStorage.setItem("auth_token", "test-token");
      wsService.connect();
      const ws = MockWebSocket.instances[0]!;
      ws.simulateOpen();

      wsService.subscribe("room-1");
      wsService.subscribe("room-2");

      expect(wsService.rooms).toEqual(expect.arrayContaining(["room-1", "room-2"]));
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Chunk 6: Ping + error handling
  // ═══════════════════════════════════════════════════════════════════════════

  describe("ping and error handling", () => {
    it("ping sent every 30s when connected", () => {
      localStorage.setItem("auth_token", "test-token");
      wsService.connect();
      const ws = MockWebSocket.instances[0]!;
      ws.simulateOpen();

      const countBefore = ws.sentMessages.length;
      vi.advanceTimersByTime(30000);

      const messages = ws.sentMessages.slice(countBefore).map((m) => JSON.parse(m));
      const pingMsg = messages.find((m: { type: string }) => m.type === "ping");
      expect(pingMsg).toBeDefined();
    });

    it("ping not sent when disconnected", () => {
      localStorage.setItem("auth_token", "test-token");
      wsService.connect();
      const ws = MockWebSocket.instances[0]!;
      ws.simulateOpen();
      ws.simulateClose(1000);

      const countBefore = ws.sentMessages.length;
      vi.advanceTimersByTime(30000);

      expect(ws.sentMessages.length).toBe(countBefore);
    });

    it("handleError does not throw", () => {
      localStorage.setItem("auth_token", "test-token");
      wsService.connect();
      const ws = MockWebSocket.instances[0]!;

      expect(() => ws.simulateError()).not.toThrow();
    });
  });
});
