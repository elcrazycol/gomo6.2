import { useMessengerStore } from "@/stores/messengerStore";
import type { WsEvent } from "@/components/messenger/types";

// ─── Messenger WebSocket — focused, clean, single responsibility ────────────

const WS_BASE = import.meta.env.VITE_WS_URL || "/ws";

class MessengerWebSocket {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private subscribedRooms = new Set<string>();

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) return;

    const token = localStorage.getItem("auth_token");
    if (!token) return;

    try {
      const url = `${WS_BASE}?token=${encodeURIComponent(token)}`;
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.startPing();
        this.resubscribeAll();
      };

      this.ws.onmessage = (event) => this.handleMessage(event);

      this.ws.onclose = () => {
        this.stopPing();
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        // close event will handle reconnection
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.stopPing();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.subscribedRooms.clear();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close(1000, "disconnect");
      this.ws = null;
    }
  }

  subscribe(room: string): void {
    this.subscribedRooms.add(room);
    this.send({ type: "subscribe", data: room });
  }

  unsubscribe(room: string): void {
    this.subscribedRooms.delete(room);
    this.send({ type: "unsubscribe", data: room });
  }

  sendTyping(conversationId: string, isTyping: boolean): void {
    // Only room is sent — server fills user_id/username from auth context
    this.send({
      type: "chat_typing",
      room: `chat_${conversationId}`,
      data: {
        is_typing: isTyping,
        conversation_id: conversationId,
      },
    });
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private send(data: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      // Data is sent as-is — no double JSON.stringify.
      // The server expects data to be either a string (for subscribe/unsubscribe room names)
      // or a JSON object (for typing payloads, etc.).
      const payload = data.data ?? data;
      this.ws.send(JSON.stringify({
        type: data.type,
        room: data.room,
        data: typeof payload === "string" ? payload : JSON.stringify(payload),
        timestamp: Date.now(),
      }));
    }
  }

  private startPing(): void {
    this.pingTimer = setInterval(() => {
      this.send({ type: "ping" });
    }, 30_000);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
  }

  private resubscribeAll(): void {
    for (const room of this.subscribedRooms) {
      this.send({ type: "subscribe", data: room });
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30_000);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private handleMessage(event: MessageEvent): void {
    try {
      const msg = JSON.parse(event.data);
      const store = useMessengerStore.getState();

      switch (msg.type as WsEvent["type"]) {
        case "new_chat_message": {
          const data = msg.data;
          const message = {
            id: data.id,
            conversation_id: data.conversation_id,
            sender_user_id: data.sender_user_id,
            parent_message_id: data.parent_message_id ?? null,
            content: data.content,
            is_edited: data.is_edited ?? false,
            is_deleted: data.is_deleted ?? false,
            edited_at: data.edited_at ?? null,
            sent_at: data.sent_at,
            client_id: data.client_id ?? "",
            localStatus: "sent" as const,
          };
          store.addMessage(message);

          // Update conversation preview
          store.updateConversationFromWs(data.conversation_id, {
            last_message_at: data.sent_at,
            last_message_preview: data.content?.slice(0, 80) ?? "",
            last_message_sender_id: data.sender_user_id,
          });

          // Auto-mark as delivered + read if this chat is currently open
          const isMine = store.me?.id === data.sender_user_id;
          if (!isMine) {
            const convId = store.selectedConversationId;
            // Mark delivered for the sender to see ✓✓ status
            store.markDelivered(data.id);
            // If this conversation is open, mark as read immediately
            if (convId === data.conversation_id) {
              store.markRead(data.id);
            }
          }
          break;
        }

        case "message_edited": {
          store.updateMessage(msg.data.id, {
            content: msg.data.content,
            is_edited: true,
            edited_at: msg.data.edited_at ?? new Date().toISOString(),
          });
          break;
        }

        case "message_deleted": {
          store.removeMessage(msg.data.id);
          break;
        }

        case "read_receipt": {
          // Reload receipts for the relevant conversation
          const convId = store.selectedConversationId;
          if (convId) store.loadReceipts(convId);
          break;
        }

        case "chat_typing": {
          const d = msg.data;
          store.setTyping(d.user_id, d.username ?? "", d.is_typing ?? true);
          // Auto-clear typing after 3 seconds (fallback if is_typing:false is lost)
          if (d.is_typing) {
            setTimeout(() => {
              store.setTyping(d.user_id, d.username ?? "", false);
            }, 3000);
          }
          break;
        }

        case "user_online": {
          store.setUserOnline(msg.data.user_id, true);
          break;
        }

        case "user_offline": {
          store.setUserOnline(msg.data.user_id, false);
          break;
        }
      }
    } catch (e) {
      console.error("[MessengerWS] Parse error:", e);
    }
  }
}

export const messengerWs = new MessengerWebSocket();
