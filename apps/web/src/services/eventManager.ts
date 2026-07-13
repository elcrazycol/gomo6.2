// Centralized event manager for notifications and messenger real-time updates.
// Owns WebSocket subscription lifecycle, reconnection recovery, and polling fallback.

import { wsService, type WebSocketMessage, type WebSocketMessageType } from "./websocket";
import { messengerApi } from "./messengerApi";

type MessageHandler = (message: WebSocketMessage) => void;

class EventManager {
  private initialized = false;
  private userId: string | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private handlers: Map<WebSocketMessageType, Set<MessageHandler>> = new Map();
  private subscribedConversations: Set<string> = new Set();
  private disconnectTimestamp: number | null = null;
  private lastSyncTime: number = 0;
  private wsUnsubs: (() => void)[] = [];

  // Store callbacks
  private onNotificationCountUpdate: ((count: number) => void) | null = null;
  private onMessengerCountUpdate: ((conversations: Array<{ id: string; unread_count: number }>) => void) | null = null;

  get connected(): boolean {
    return wsService.connected;
  }

  init(userId: string): void {
    if (this.initialized && this.userId === userId) return;
    if (this.initialized) this.cleanup();

    this.userId = userId;
    this.initialized = true;
    this.lastSyncTime = Date.now();

    // Listen for WS lifecycle events
    this.wsUnsubs.push(
      wsService.on("connected", this.handleConnected),
    );

    // Bridge wsService "new_notification" events to eventManager handlers
    this.wsUnsubs.push(
      wsService.on("new_notification", (msg) => {
        const handlers = this.handlers.get("new_notification");
        if (handlers) handlers.forEach(h => h(msg));
      }),
    );

    // Subscribe to user-level notification room
    wsService.subscribeToNotifications(userId);
  }

  cleanup(): void {
    this.stopPolling();

    for (const unsub of this.wsUnsubs) unsub();
    this.wsUnsubs = [];

    if (this.userId) {
      wsService.unsubscribe(`notifications_${this.userId}`);
    }

    for (const convId of this.subscribedConversations) {
      wsService.unsubscribe(`chat_${convId}`);
    }

    this.handlers.clear();
    this.subscribedConversations.clear();
    this.onNotificationCountUpdate = null;
    this.onMessengerCountUpdate = null;
    this.userId = null;
    this.initialized = false;
    this.disconnectTimestamp = null;
  }

  // ── Subscription management ────────────────────────────────────────────────

  subscribeConversation(convId: string): void {
    if (!this.initialized || this.subscribedConversations.has(convId)) return;
    this.subscribedConversations.add(convId);
    wsService.subscribe(`chat_${convId}`);
  }

  unsubscribeConversation(convId: string): void {
    if (!this.initialized || !this.subscribedConversations.has(convId)) return;
    this.subscribedConversations.delete(convId);
    wsService.unsubscribe(`chat_${convId}`);
  }

  // ── Handler registration ───────────────────────────────────────────────────

  on(type: WebSocketMessageType, handler: MessageHandler): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
    return () => this.off(type, handler);
  }

  off(type: WebSocketMessageType, handler: MessageHandler): void {
    this.handlers.get(type)?.delete(handler);
  }

  // ── Store callbacks ────────────────────────────────────────────────────────

  setNotificationCallbacks(opts: {
    onCountUpdate?: (count: number) => void;
  }): void {
    if (opts.onCountUpdate) this.onNotificationCountUpdate = opts.onCountUpdate;
  }

  setMessengerCallbacks(opts: {
    onCountUpdate?: (conversations: Array<{ id: string; unread_count: number }>) => void;
  }): void {
    if (opts.onCountUpdate) this.onMessengerCountUpdate = opts.onCountUpdate;
  }

  // ── Initial sync trigger ───────────────────────────────────────────────────
  // Call AFTER all stores have registered their callbacks.

  startSync(): void {
    this.syncAll();
  }

  // ── Internal: WS lifecycle ────────────────────────────────────────────────

  private handleConnected = (): void => {
    this.stopPolling();

    // Resubscribe conversation rooms
    for (const convId of this.subscribedConversations) {
      wsService.subscribe(`chat_${convId}`);
    }

    // Re-subscribe notification room
    if (this.userId) {
      wsService.subscribeToNotifications(this.userId);
    }

    // Recovery: refetch missed data
    const timeDisconnected = this.disconnectTimestamp ? Date.now() - this.disconnectTimestamp : 0;
    const forceFullRefetch = timeDisconnected > 60000;
    this.syncAll(forceFullRefetch);
    this.disconnectTimestamp = null;
  };

  // ── Internal: Sync ─────────────────────────────────────────────────────────

  private async syncAll(_forceFullRefetch = false): Promise<void> {
    this.lastSyncTime = Date.now();

    try {
      const notifResp = await fetch(
        `/api/v1/notifications/unread-count`,
        {
          headers: { Authorization: `Bearer ${localStorage.getItem("auth_token")}` },
        }
      );
      if (notifResp.ok) {
        const notifData = await notifResp.json();
        const count = notifData?.data?.unread_count ?? 0;
        this.onNotificationCountUpdate?.(count);
      }
    } catch {
      // Silent
    }

    try {
      const convs = await messengerApi.listConversations();
      this.onMessengerCountUpdate?.(convs);
    } catch {
      // Silent
    }

    if (!wsService.connected) {
      this.startPolling();
    }
  }

  // ── Internal: Polling fallback ─────────────────────────────────────────────

  private startPolling(): void {
    if (this.pollTimer) return;
    this.schedulePoll();
  }

  private schedulePoll(): void {
    this.pollTimer = setTimeout(async () => {
      if (wsService.connected) {
        this.stopPolling();
        return;
      }
      await this.syncAll();
      this.schedulePoll();
    }, 30000);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }
}

export const eventManager = new EventManager();
