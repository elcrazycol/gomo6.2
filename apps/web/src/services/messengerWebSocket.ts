import { useMessengerStore, queueMarkDelivered, queueMarkRead } from "@/stores/messengerStore";
import { wsService, type WebSocketMessage } from "@/services/websocket";

// ─── Messenger WebSocket — thin wrapper over wsService ──────────────────────
// No separate connection. All transport is handled by wsService (App.tsx).
// This class only registers handlers for chat-specific events.

class MessengerWebSocket {
  private handlersUnsub: (() => void)[] = [];
  private handlersRegistered = false;

  get connected(): boolean {
    return wsService.connected;
  }

  connect(): void {
    // wsService is already connected by App.tsx — just ensure handlers are registered
    this.registerHandlers();
  }

  disconnect(): void {
    this.unregisterHandlers();
  }

  subscribe(room: string): void {
    wsService.subscribe(room);
  }

  unsubscribe(room: string): void {
    wsService.unsubscribe(room);
  }

  sendTyping(conversationId: string, isTyping: boolean): void {
    wsService.sendRaw({
      type: "chat_typing",
      room: `chat_${conversationId}`,
      data: {
        is_typing: isTyping,
        conversation_id: conversationId,
      },
      timestamp: Date.now(),
    });
  }

  // ─── Handler registration ──────────────────────────────────────────────────

  private registerHandlers(): void {
    if (this.handlersRegistered) return;
    this.handlersRegistered = true;

    this.handlersUnsub.push(
      wsService.on("new_chat_message", (msg) => this.handleNewChatMessage(msg)),
      wsService.on("message_edited", (msg) => this.handleMessageEdited(msg)),
      wsService.on("message_deleted", (msg) => this.handleMessageDeleted(msg)),
      wsService.on("read_receipt", (msg) => this.handleReadReceipt(msg)),
      wsService.on("chat_typing", (msg) => this.handleTyping(msg)),
      wsService.on("user_online", (msg) => this.handleUserOnline(msg)),
      wsService.on("user_offline", (msg) => this.handleUserOffline(msg)),
    );
  }

  private unregisterHandlers(): void {
    for (const unsub of this.handlersUnsub) unsub();
    this.handlersUnsub = [];
    this.handlersRegistered = false;
  }

  // ─── Event handlers ────────────────────────────────────────────────────────

  private handleNewChatMessage(msg: WebSocketMessage): void {
    const data = msg.data as Record<string, unknown>;
    const store = useMessengerStore.getState();

    const message = {
      id: data.id as string,
      conversation_id: data.conversation_id as string,
      sender_user_id: data.sender_user_id as string,
      parent_message_id: (data.parent_message_id as string) ?? null,
      content: data.content as string,
      is_edited: (data.is_edited as boolean) ?? false,
      is_deleted: (data.is_deleted as boolean) ?? false,
      edited_at: (data.edited_at as string) ?? null,
      sent_at: data.sent_at as string,
      client_id: (data.client_id as string) ?? "",
      localStatus: "sent" as const,
    };
    store.addMessage(message);

    const isMine = store.me?.id === data.sender_user_id;

    store.updateConversationFromWs(data.conversation_id as string, {
      last_message_at: data.sent_at as string,
      last_message_preview: (data.content as string)?.slice(0, 80) ?? "",
      last_message_sender_id: data.sender_user_id as string,
    }, !isMine);

    if (!isMine) {
      const convId = store.selectedConversationId;
      queueMarkDelivered(data.conversation_id as string, data.id as string);
      if (convId === data.conversation_id) {
        queueMarkRead(data.conversation_id as string, data.id as string);
      }
    }
  }

  private handleMessageEdited(msg: WebSocketMessage): void {
    const data = msg.data as Record<string, unknown>;
    useMessengerStore.getState().updateMessage(data.id as string, {
      content: data.content as string,
      is_edited: true,
      edited_at: (data.edited_at as string) ?? new Date().toISOString(),
    });
  }

  private handleMessageDeleted(msg: WebSocketMessage): void {
    const data = msg.data as Record<string, unknown>;
    useMessengerStore.getState().removeMessage(data.id as string);
  }

  private handleReadReceipt(msg: WebSocketMessage): void {
    const store = useMessengerStore.getState();
    const convId = store.selectedConversationId;
    if (convId) store.loadReceipts(convId);
  }

  private handleTyping(msg: WebSocketMessage): void {
    const d = msg.data as Record<string, unknown>;
    useMessengerStore.getState().setTyping(
      d.user_id as string,
      (d.username as string) ?? "",
      (d.is_typing as boolean) ?? true,
    );
  }

  private handleUserOnline(msg: WebSocketMessage): void {
    const data = msg.data as Record<string, unknown>;
    useMessengerStore.getState().setUserOnline(data.user_id as string, true);
  }

  private handleUserOffline(msg: WebSocketMessage): void {
    const data = msg.data as Record<string, unknown>;
    useMessengerStore.getState().setUserOnline(data.user_id as string, false);
  }
}

export const messengerWs = new MessengerWebSocket();
