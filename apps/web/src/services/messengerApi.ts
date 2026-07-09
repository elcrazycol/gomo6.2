import type { Attachment, ConversationView, MessageView, ReceiptRow } from "@/components/messenger/types";
import { apiClient } from "@/integrations/api/client";
import { uploadFile } from "@/utils/storage";

const BASE = "/api/v1/messenger";
const TOKEN = () => localStorage.getItem("auth_token") ?? "";

async function tryRefreshToken(): Promise<string | null> {
  return apiClient.tryRefreshToken();
}

async function req<T>(path: string, options: RequestInit = {}): Promise<T> {
  const doFetch = async (token: string) => {
    const res = await fetch(`${BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });
    // Try to parse JSON even on error
    let json: Record<string, unknown> = {};
    try { json = await res.json(); } catch { /* non-JSON response */ }
    if (!res.ok) {
      const err = new Error((json.error as string) || `HTTP ${res.status}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    return json.data as T;
  };

  try {
    return await doFetch(TOKEN());
  } catch (e) {
    const err = e as Error & { status?: number };
    // On 401, try to refresh the token and retry once
    if (err.status === 401) {
      const newToken = await tryRefreshToken();
      if (newToken) {
        return await doFetch(newToken);
      }
      // Refresh failed — force logout
      apiClient.clearTokens();
      window.dispatchEvent(new CustomEvent('auth:expired'));
      throw new Error("Сессия истекла — обнови страницу (F5)");
    }
    throw e;
  }
}

export const messengerApi = {
  // ── Profile ───────────────────────────────────────────────────────────
  async getMyProfile(): Promise<{ id: string; username: string }> {
    try {
      const result = await apiClient.request<{ id: string; username: string }>('/api/v1/auth/me');
      return result.data as { id: string; username: string };
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 401 || !localStorage.getItem("auth_token")) {
        throw new Error("not authenticated");
      }
      throw new Error("server_unreachable");
    }
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

  async sendMessage(
    conversationId: string,
    content: string,
    clientId: string,
    parentMessageId?: string,
    attachments?: Attachment[],
  ): Promise<MessageView> {
    return req<MessageView>(`/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        content,
        client_id: clientId,
        ...(parentMessageId ? { parent_message_id: parentMessageId } : {}),
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
      }),
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

  // ── File upload ──────────────────────────────────────────────────────
  async uploadFile(file: File): Promise<{ path: string }> {
    const ext = file.name.split(".").pop() || "bin";
    const key = `messenger/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    return uploadFile("uploads", key, file);
  },
};
