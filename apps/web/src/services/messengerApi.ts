import type { Attachment, ConversationView, GroupMember, MessageView, ReceiptRow } from "@/components/messenger/types";
import { apiClient } from "@/integrations/api/client";
import { uploadFile } from "@/utils/storage";

const BASE = "/api/v1/messenger";
const TOKEN = () => apiClient.getToken() ?? "";

async function tryRefreshToken(force = false): Promise<string | null> {
  return apiClient.tryRefreshToken(force);
}

async function req<T>(path: string, options: RequestInit = {}): Promise<T> {
  const doFetch = async (token: string) => {
    const csrf = apiClient.getCSRFToken();
    const res = await fetch(`${BASE}${path}`, {
      ...options,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(csrf && options.method && options.method !== "GET" && options.method !== "HEAD" ? { "X-CSRF-Token": csrf } : {}),
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
    // On 401, refresh and retry, with a bounded second chance. The second
    // (forced) cycle exists because a concurrent refresh in ANOTHER tab can
    // blacklist the token our first refresh just issued (the backend
    // supersedes the previous access token on every refresh); the retry then
    // 401s and the user gets logged out of a healthy session. A genuinely
    // revoked session fails every refresh with 401/403, so this stays bounded.
    if (err.status === 401) {
      // Same bounded two-chance refresh as client.ts: a concurrent refresh in
      // another tab can blacklist the token our first refresh just issued, so
      // a single retry-401 must not fail the request. A genuinely revoked
      // session fails every refresh with 401/403, so this stays bounded.
      for (let attempt = 0; attempt < 2; attempt++) {
        const newToken = await tryRefreshToken(attempt > 0);
        if (!newToken) break;
        try {
          return await doFetch(newToken);
        } catch (retryError) {
          const re = retryError as Error & { status?: number };
          if (re.status !== 401) throw retryError;
          // 401 again — fall through to a forced second refresh.
        }
      }
      // Genuinely dead session: refresh rejected us (401/403) or there is no
      // refresh path at all. Force logout only in that case — a transient
      // network/5xx refresh failure must NOT log the user out.
      if (apiClient.getRefreshAuthFailed() || (!TOKEN() && !apiClient.getCSRFToken())) {
        apiClient.clearTokens();
        window.dispatchEvent(new CustomEvent('auth:expired'));
        throw new Error("Сессия истекла — обнови страницу (F5)");
      }
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
      if (err.status === 401 || (!apiClient.getToken() && !apiClient.getCSRFToken())) {
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

  /** Creates (once per user) the personal E2E-encrypted "Заметки" self-chat. */
  async getOrCreateNotes(): Promise<{ conversation_id: string }> {
    return req("/notes", { method: "POST" });
  },

  // ── Messages ──────────────────────────────────────────────────────────
  async getMessages(conversationId: string, before?: string, sinceEventId?: string, limit?: number): Promise<MessageView[]> {
    const params = new URLSearchParams();
    if (before) params.set("before", before);
    if (sinceEventId !== undefined) params.set("since_event_id", String(sinceEventId));
    if (limit !== undefined) params.set("limit", String(limit));
    const query = params.toString();
    return req<MessageView[]>(`/conversations/${conversationId}/messages${query ? `?${query}` : ""}`);
  },

  /** Stores the client-encrypted pin/folder/tags blob for a note (verbatim). */
  async updateNotesMeta(conversationId: string, messageId: string, meta: string): Promise<{ updated: boolean }> {
    return req(`/conversations/${conversationId}/messages/${messageId}/notes-meta`, {
      method: "PUT",
      body: JSON.stringify({ meta }),
    });
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
      // Preserve the final read marker during an immediate reload/navigation.
      keepalive: true,
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
  async uploadFile(file: File): Promise<{
    path: string;
    variants?: { preview_key: string; lqip: string; width: number; height: number; content_type: string };
  }> {
    const ext = file.name.split(".").pop() || "bin";
    const profile = await this.getMyProfile();
    const key = `${profile.id}/messenger/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    return uploadFile("uploads", key, file, undefined, false);
  },

  // ── Group chats ──────────────────────────────────────────────────────
  async createGroup(name: string, memberIds: string[]): Promise<{ conversation_id: string }> {
    return req("/groups", {
      method: "POST",
      body: JSON.stringify({ name, member_ids: memberIds }),
    });
  },

  async updateGroup(groupId: string, data: { name?: string; avatar_url?: string }): Promise<{ updated: boolean }> {
    return req(`/groups/${groupId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },

  async addGroupMembers(groupId: string, userIds: string[]): Promise<{ added: number }> {
    return req(`/groups/${groupId}/members`, {
      method: "POST",
      body: JSON.stringify({ user_ids: userIds }),
    });
  },

  async removeGroupMember(groupId: string, userId: string): Promise<{ removed: boolean }> {
    return req(`/groups/${groupId}/members/${userId}`, {
      method: "DELETE",
    });
  },

  async getGroupMembers(groupId: string): Promise<GroupMember[]> {
    return req<GroupMember[]>(`/groups/${groupId}/members`);
  },
};
