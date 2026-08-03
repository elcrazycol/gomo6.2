import { useMessengerStore, queueMarkDelivered, queueMarkRead } from "@/stores/messengerStore";
import { wsService, type WebSocketMessage } from "@/services/websocket";

// ─── Messenger WebSocket — event handlers for chat-specific WS events ───────
// No connection management. Transport is handled by wsService + eventManager.
// This module only registers handlers that update the messenger store.

const TYPING_HEARTBEAT_MS = 3000;

type TypingState = {
  active: boolean;
  timer: ReturnType<typeof setTimeout> | null;
};

class MessengerWebSocket {
  private handlersUnsub: (() => void)[] = [];
  private initialized = false;
  private typingStates = new Map<string, TypingState>();

  connect(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.registerHandlers();
  }

  disconnect(): void {
    for (const unsub of this.handlersUnsub) unsub();
    this.handlersUnsub = [];
    for (const conversationId of [...this.typingStates.keys()]) this.stopTyping(conversationId);
    this.initialized = false;
  }

  sendTyping(conversationId: string, isTyping: boolean): void {
    if (!conversationId) return;
    const state = this.typingStates.get(conversationId) ?? { active: false, timer: null };

    if (!isTyping) {
      if (state.timer) clearTimeout(state.timer);
      this.typingStates.delete(conversationId);
      if (state.active) this.sendTypingEvent(conversationId, false);
      return;
    }

    if (!state.active) {
      state.active = true;
      this.sendTypingEvent(conversationId, true);
    }
    this.scheduleTypingHeartbeat(conversationId, state);
    this.typingStates.set(conversationId, state);
  }

  stopTyping(conversationId: string): void {
    this.sendTyping(conversationId, false);
  }

  private scheduleTypingHeartbeat(conversationId: string, state: TypingState): void {
    if (state.timer) return;
    state.timer = setTimeout(() => {
      state.timer = null;
      if (!this.typingStates.has(conversationId) || !state.active) return;
      this.sendTypingEvent(conversationId, true);
      this.scheduleTypingHeartbeat(conversationId, state);
    }, TYPING_HEARTBEAT_MS);
  }

  private sendTypingEvent(conversationId: string, isTyping: boolean): void {
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

  private registerHandlers(): void {
    if (this.handlersUnsub.length > 0) return;

    this.handlersUnsub.push(
      wsService.on("new_chat_message", (msg) => this.handleNewChatMessage(msg)),
      wsService.on("message_edited", (msg) => this.handleMessageEdited(msg)),
      wsService.on("message_deleted", (msg) => this.handleMessageDeleted(msg)),
      wsService.on("read_receipt", (msg) => this.handleReadReceipt(msg)),
      wsService.on("chat_typing", (msg) => this.handleTyping(msg)),
      wsService.on("user_online", (msg) => this.handleUserOnline(msg)),
      wsService.on("user_offline", (msg) => this.handleUserOffline(msg)),
      wsService.on("group_updated", (msg) => this.handleGroupUpdated(msg)),
    );
  }

  private getMessageData(msg: WebSocketMessage): Record<string, unknown> | null {
    if (!msg.data) {
      console.warn(`[Messenger WS] Received ${msg.type} without data`, msg);
      return null;
    }
    return msg.data as Record<string, unknown>;
  }

  private handleNewChatMessage(msg: WebSocketMessage): void {
    const data = this.getMessageData(msg);
    if (!data) return;
    const store = useMessengerStore.getState();
    const isMine = store.me?.id === data.sender_user_id;

    const content = (data.content as string) ?? "";

    const message = {
      id: data.id as string,
      event_id: typeof data.event_id === "string" ? data.event_id : typeof data.event_id === "number" ? String(data.event_id) : undefined,
      conversation_id: data.conversation_id as string,
      sender_user_id: data.sender_user_id as string,
      sender_username: (data.sender_username as string) ?? "",
      parent_message_id: (data.parent_message_id as string) ?? null,
      content,
      is_edited: (data.is_edited as boolean) ?? false,
      is_deleted: (data.is_deleted as boolean) ?? false,
      edited_at: (data.edited_at as string) ?? null,
      sent_at: data.sent_at as string,
      client_id: (data.client_id as string) ?? "",
      localStatus: "sent" as const,
      ...(data.attachments ? { attachments: data.attachments as import("@/components/messenger/types").Attachment[] } : {}),
    };
    store.addMessage(message);

    store.updateConversationFromWs(data.conversation_id as string, {
      last_message_at: data.sent_at as string,
      last_message_preview: content.slice(0, 80),
      last_message_sender_id: data.sender_user_id as string,
    }, !isMine);

    if (!isMine) {
      const convId = store.selectedConversationId;
      queueMarkDelivered(data.conversation_id as string, data.id as string, data.sent_at as string | undefined);
      if (convId === data.conversation_id) {
        queueMarkRead(data.conversation_id as string, data.id as string, data.sent_at as string | undefined);
      }
    }
  }

  private handleMessageEdited(msg: WebSocketMessage): void {
    const data = this.getMessageData(msg);
    if (!data) return;
    useMessengerStore.getState().updateMessage(data.id as string, {
      content: data.content as string,
      is_edited: true,
      edited_at: (data.edited_at as string) ?? new Date().toISOString(),
    });
  }

  private handleMessageDeleted(msg: WebSocketMessage): void {
    const data = this.getMessageData(msg);
    if (!data) return;
    useMessengerStore.getState().removeMessage(data.id as string);
  }

  private handleReadReceipt(msg: WebSocketMessage): void {
    const data = this.getMessageData(msg);
    if (!data) return;
    const convId = data.conversation_id as string;
    if (convId) {
      useMessengerStore.getState().loadReceipts(convId);
    }
  }

  private handleTyping(msg: WebSocketMessage): void {
    const d = this.getMessageData(msg);
    if (!d) return;
    useMessengerStore.getState().setTyping(
      d.user_id as string,
      (d.username as string) ?? "",
      (d.is_typing as boolean) ?? true,
    );
  }

  private handleUserOnline(msg: WebSocketMessage): void {
    const data = this.getMessageData(msg);
    if (!data) return;
    useMessengerStore.getState().setUserOnline(data.user_id as string, true);
  }

  private handleUserOffline(msg: WebSocketMessage): void {
    const data = this.getMessageData(msg);
    if (!data) return;
    useMessengerStore.getState().setUserOnline(data.user_id as string, false);
  }

  private handleGroupUpdated(_msg: WebSocketMessage): void {
    // Reload conversations to pick up group changes
    useMessengerStore.getState().loadConversations();
  }
}

export const messengerWs = new MessengerWebSocket();
