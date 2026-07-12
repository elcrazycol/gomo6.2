import { useMessengerStore, queueMarkDelivered, queueMarkRead } from "@/stores/messengerStore";
import { wsService, type WebSocketMessage } from "@/services/websocket";
import { receiveE2EMessage, getDeviceId } from "@/services/e2e/e2eManager";
import type { CiphertextEntry } from "@/components/messenger/types";

// ─── Messenger WebSocket — event handlers for chat-specific WS events ───────
// No connection management. Transport is handled by wsService + eventManager.
// This module only registers handlers that update the messenger store.

class MessengerWebSocket {
  private handlersUnsub: (() => void)[] = [];
  private initialized = false;

  connect(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.registerHandlers();
  }

  disconnect(): void {
    for (const unsub of this.handlersUnsub) unsub();
    this.handlersUnsub = [];
    this.initialized = false;
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

  private handleNewChatMessage(msg: WebSocketMessage): void {
    const data = msg.data as Record<string, unknown>;
    const store = useMessengerStore.getState();
    const isMine = store.me?.id === data.sender_user_id;

    const ciphertexts = data.ciphertexts as CiphertextEntry[] | undefined;
    const content = data.content as string;

    // Decrypt E2E messages from others
    if (ciphertexts && ciphertexts.length > 0 && !isMine) {
      const myDeviceId = getDeviceId();
      receiveE2EMessage(ciphertexts, myDeviceId, data.sender_user_id as string)
        .then((plaintext) => {
          if (plaintext) {
            // Update the already-added message with decrypted content
            store.updateMessage(data.id as string, { content: plaintext });
            store.updateConversationFromWs(data.conversation_id as string, {
              last_message_at: data.sent_at as string,
              last_message_preview: plaintext.slice(0, 80),
              last_message_sender_id: data.sender_user_id as string,
            }, true);
          } else {
            store.updateMessage(data.id as string, {
              content: "[зашифровано — ключи недоступны]",
            });
          }
        })
        .catch(() => {
          store.updateMessage(data.id as string, {
            content: "[зашифровано — ключи недоступны]",
          });
        });
    }

    const message = {
      id: data.id as string,
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
      last_message_preview: ciphertexts && ciphertexts.length > 0 && !isMine
        ? "🔒 Зашифрованное сообщение"
        : (data.content as string)?.slice(0, 80) ?? "",
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
    const data = msg.data as Record<string, unknown>;
    const convId = data.conversation_id as string;
    if (convId) {
      useMessengerStore.getState().loadReceipts(convId);
    }
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

  private handleGroupUpdated(_msg: WebSocketMessage): void {
    // Reload conversations to pick up group changes
    useMessengerStore.getState().loadConversations();
  }
}

export const messengerWs = new MessengerWebSocket();
