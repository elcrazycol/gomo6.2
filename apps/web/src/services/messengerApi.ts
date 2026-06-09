import type { ConversationView, MessageView, ReceiptRow } from "@/components/messenger/types";

const BASE = "/api/v1/messenger";
const TOKEN = () => localStorage.getItem("auth_token") ?? "";

async function req<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN()}`,
      ...options.headers,
    },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json.data as T;
}

export const messengerApi = {
  // ── Profile ───────────────────────────────────────────────────────────
  async getMyProfile(): Promise<{ id: string; username: string }> {
    const res = await fetch("/api/v1/auth/me", {
      headers: { Authorization: `Bearer ${TOKEN()}` },
    });
    if (!res.ok) {
      const token = TOKEN();
      if (token) throw new Error("server_unreachable");
      throw new Error("not authenticated");
    }
    const json = await res.json();
    return json.user ?? json.data;
  },

  // ── Conversations ─────────────────────────────────────────────────────
  async listConversations(): Promise<ConversationView[]> {
    return req<ConversationView[]>("/conversations");
  },

  async getOrCreateConversation(userId: string): Promise<{ conversation_id: string }> {
    return req("/conversations", {
      method: "POST",
      body: JSON.stringify({ user_id: userId }),
    });
  },

  // ── Messages ──────────────────────────────────────────────────────────
  async getMessages(conversationId: string, before?: string): Promise<MessageView[]> {
    const params = before ? `?before=${before}` : "";
    return req<MessageView[]>(`/conversations/${conversationId}/messages${params}`);
  },

  async sendMessage(conversationId: string, content: string, clientId: string): Promise<MessageView> {
    return req<MessageView>(`/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content, client_id: clientId }),
    });
  },

  async editMessage(conversationId: string, messageId: string, content: string): Promise<{ updated: boolean }> {
    return req(`/conversations/${conversationId}/messages/${messageId}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    });
  },

  async deleteMessage(conversationId: string, messageId: string): Promise<{ deleted: boolean }> {
    return req(`/conversations/${conversationId}/messages/${messageId}`, {
      method: "DELETE",
    });
  },

  // ── Read/Delivered ────────────────────────────────────────────────────
  async markRead(conversationId: string, messageId: string): Promise<{ ok: boolean }> {
    return req(`/conversations/${conversationId}/read`, {
      method: "POST",
      body: JSON.stringify({ message_id: messageId }),
    });
  },

  async markDelivered(conversationId: string, messageId: string): Promise<{ ok: boolean }> {
    return req(`/conversations/${conversationId}/delivered`, {
      method: "POST",
      body: JSON.stringify({ message_id: messageId }),
    });
  },

  // ── Receipts ──────────────────────────────────────────────────────────
  async getReceipts(conversationId: string): Promise<ReceiptRow[]> {
    return req<ReceiptRow[]>(`/conversations/${conversationId}/receipts`);
  },

  // ── Leave ────────────────────────────────────────────────────────────
  async leaveConversation(conversationId: string): Promise<{ left: boolean }> {
    return req(`/conversations/${conversationId}/leave`, {
      method: "DELETE",
    });
  },

  // ── Pin ───────────────────────────────────────────────────────────────
  async togglePin(conversationId: string, messageId: string): Promise<{ pinned_message_id: string | null }> {
    return req(`/conversations/${conversationId}/pin`, {
      method: "POST",
      body: JSON.stringify({ message_id: messageId }),
    });
  },

  // ── Unread count ──────────────────────────────────────────────────────
  async getUnreadCount(): Promise<{ unread_count: number }> {
    return req("/unread-count");
  },
};
