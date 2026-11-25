import { describe, it, expect, vi, beforeEach } from "vitest";

const { ws } = vi.hoisted(() => {
  const handlers = new Map<string, (message?: unknown) => void>();
  return {
    ws: {
      connected: false,
      handlers,
      on: vi.fn((type: string, handler: (message?: unknown) => void) => {
        handlers.set(type, handler);
        return () => handlers.delete(type);
      }),
    },
  };
});

vi.mock("@/services/websocket", () => ({ wsService: ws }));

import {
  getMessengerConnectionStatus,
  subscribeMessengerConnection,
} from "./useMessengerConnection";

describe("messenger connection status", () => {
  beforeEach(() => {
    // The module wires the socket handlers once for the whole module lifetime;
    // the subscribed set is what each test owns.
    ws.connected = false;
  });

  it("starts in connecting (the socket may still be dialling)", () => {
    const unsubscribe = subscribeMessengerConnection(() => {});
    expect(getMessengerConnectionStatus()).toBe("connecting");
    unsubscribe();
  });

  it("becomes connected when the socket reports it", () => {
    ws.connected = true;
    const listener = vi.fn();
    const unsubscribe = subscribeMessengerConnection(listener);
    // The subscription refreshes immediately: a socket that came up before
    // the first consumer must not read as "connecting".
    expect(getMessengerConnectionStatus()).toBe("connected");

    ws.connected = false;
    ws.handlers.get("disconnected")?.({});
    expect(getMessengerConnectionStatus()).toBe("connecting");
    expect(listener).toHaveBeenCalled();

    ws.connected = true;
    ws.handlers.get("connected")?.({});
    expect(getMessengerConnectionStatus()).toBe("connected");
    unsubscribe();
  });

  it("distinguishes a missing network from a reconnecting socket", () => {
    const originalOnLine = navigator.onLine;
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    try {
      const unsubscribe = subscribeMessengerConnection(() => {});
      expect(getMessengerConnectionStatus()).toBe("offline");
      unsubscribe();
    } finally {
      Object.defineProperty(navigator, "onLine", { configurable: true, value: originalOnLine });
    }
  });
});
