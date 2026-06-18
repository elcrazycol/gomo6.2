import { create } from "zustand";
import type { ConversationView, MessageView, TypingUser, ReceiptRow } from "@/components/messenger/types";
import { messengerApi } from "@/services/messengerApi";

// ─── Batched markDelivered/markRead ─────────────────────────────────────────
// Instead of hitting the API on every message, we queue the latest message ID
// per conversation and flush every 2 seconds. The backend's MarkRead/MarkDelivered
// use WHERE sent_at <= target, so sending just the latest ID marks all before it.

let flushTimer: ReturnType<typeof setInterval> | null = null;
const pendingDelivered = new Map<string, string>(); // convId → latestMessageId
const pendingRead = new Map<string, string>();       // convId → latestMessageId
const lastFlushed = { delivered: new Map<string, string>(), read: new Map<string, string>() };

function startFlushTimer(): void {
  if (flushTimer) return;
  flushTimer = setInterval(flushPending, 2000);
}

function flushPending(): void {
  if (pendingDelivered.size === 0 && pendingRead.size === 0) {
    if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
    return;
  }

  // Flush delivered
  for (const [convId, msgId] of pendingDelivered) {
    if (lastFlushed.delivered.get(convId) !== msgId) {
      lastFlushed.delivered.set(convId, msgId);
      messengerApi.markDelivered(convId, msgId).catch(() => {});
    }
  }
  pendingDelivered.clear();

  // Flush read
  for (const [convId, msgId] of pendingRead) {
    if (lastFlushed.read.get(convId) !== msgId) {
      lastFlushed.read.set(convId, msgId);
      messengerApi.markRead(convId, msgId).catch(() => {});
    }
  }
  pendingRead.clear();
}

export function queueMarkDelivered(conversationId: string, messageId: string): void {
  // Only track the latest message per conversation — older ones are covered by backend
  const existing = pendingDelivered.get(conversationId);
  if (!existing || messageId > existing) {
    pendingDelivered.set(conversationId, messageId);
  }
  startFlushTimer();
}

export function queueMarkRead(conversationId: string, messageId: string): void {
  const existing = pendingRead.get(conversationId);
  if (!existing || messageId > existing) {
    pendingRead.set(conversationId, messageId);
  }
  startFlushTimer();
}

// ─── Receipts debounce ──────────────────────────────────────────────────────
const lastReceiptsLoad = new Map<string, number>(); // convId → timestamp
const RECEIPTS_COOLDOWN_MS = 3000;

// ─── Store shape ────────────────────────────────────────────────────────────

type MessengerStore = {
  // ── Data ──────────────────────────────────────────────────────────────
  me: { id: string; username: string } | null;
  conversations: ConversationView[];
  selectedConversationId: string | null;
  messages: MessageView[];
  receipts: Map<string, ReceiptRow[]>; // conversation_id → receipts
  typingUsers: Record<string, TypingUser>; // user_id → typing info
  onlineUsers: Set<string>;

  // ── UI state ──────────────────────────────────────────────────────────
  isInitialLoading: boolean;
  isMessagesLoading: boolean;
  isSending: boolean;
  error: string | null;

  // ── Computed helpers ──────────────────────────────────────────────────
  selectedConversation: () => ConversationView | null;
  totalUnread: () => number;

  // ── Actions (API) ─────────────────────────────────────────────────────
  init: () => Promise<void>;
  loadConversations: () => Promise<void>;
  loadMessages: (conversationId: string) => Promise<void>;
  sendMessage: (content: string, clientId: string) => Promise<string>;
  editMessage: (messageId: string, content: string) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  markRead: (messageId: string) => Promise<void>;
  markDelivered: (messageId: string) => Promise<void>;
  createConversation: (userId: string) => Promise<string | null>;
  togglePin: (messageId: string) => Promise<void>;
  loadReceipts: (conversationId: string) => Promise<void>;

  // ── Actions (local) ───────────────────────────────────────────────────
  selectConversation: (id: string | null) => void;
  setError: (error: string | null) => void;
  addMessage: (message: MessageView) => void;
  updateMessage: (id: string, updates: Partial<MessageView>) => void;
  removeMessage: (id: string) => void;
  setTyping: (userId: string, username: string, isTyping: boolean) => void;
  setUserOnline: (userId: string, online: boolean) => void;
  updateConversationFromWs: (convId: string, updates: Partial<ConversationView>, incrementUnread?: boolean) => void;
};

// ─── Store implementation ───────────────────────────────────────────────────

export const useMessengerStore = create<MessengerStore>((set, get) => ({
  me: null,
  conversations: [],
  selectedConversationId: null,
  messages: [],
  receipts: new Map(),
  typingUsers: {},
  onlineUsers: new Set(),
  isInitialLoading: true,
  isMessagesLoading: false,
  isSending: false,
  error: null,

  // Computed (using function getters since zustand can't track derived state from get())
  selectedConversation: () => {
    const s = get();
    return s.conversations.find((c) => c.id === s.selectedConversationId) ?? null;
  },
  totalUnread: () => {
    return get().conversations.reduce((sum, c) => sum + (c.unread_count ?? 0), 0);
  },

  // ── Init ──────────────────────────────────────────────────────────────
  init: async () => {
    try {
      const profile = await messengerApi.getMyProfile();
      set({ me: { id: profile.id, username: profile.username } });
      await get().loadConversations();
    } catch (e) {
      set({ error: "Не удалось загрузить профиль", isInitialLoading: false });
      return;
    }
    set({ isInitialLoading: false });
  },

  // ── Load conversations ────────────────────────────────────────────────
  loadConversations: async () => {
    const convs = await messengerApi.listConversations();
    set({ conversations: convs });
  },

  // ── Load messages ─────────────────────────────────────────────────────
  loadMessages: async (conversationId: string) => {
    set({ isMessagesLoading: true, error: null });
    try {
      const msgs = await messengerApi.getMessages(conversationId);
      set({ messages: msgs, isMessagesLoading: false });
    } catch (e) {
      set({ error: "Не удалось загрузить сообщения", isMessagesLoading: false });
    }
  },

  // ── Send message ──────────────────────────────────────────────────────
  sendMessage: async (content: string, clientId: string) => {
    const { selectedConversationId } = get();
    if (!selectedConversationId) return "";

    // Optimistic insert
    const tempId = `temp_${clientId}`;
    const optimistic: MessageView = {
      id: tempId,
      conversation_id: selectedConversationId,
      sender_user_id: get().me!.id,
      parent_message_id: null,
      content,
      is_edited: false,
      is_deleted: false,
      edited_at: null,
      sent_at: new Date().toISOString(),
      client_id: clientId,
      localStatus: "sending",
    };
    set((s) => ({ messages: [...s.messages, optimistic], isSending: true }));

    try {
      const msg = await messengerApi.sendMessage(selectedConversationId, content, clientId);
      const sentAt = msg.sent_at;
      set((s) => {
        // Update message from optimistic to real
        const messages = s.messages.map((m) =>
          m.client_id === clientId ? { ...msg, localStatus: "sent" as const } : m,
        );
        // Optimistically update conversation: move to top with new preview
        const target = s.conversations.find((c) => c.id === selectedConversationId);
        let conversations = s.conversations;
        if (target) {
          const updated = {
            ...target,
            last_message_at: sentAt,
            last_message_preview: content.slice(0, 80),
            last_message_sender_id: s.me!.id,
          };
          conversations = [updated, ...s.conversations.filter((c) => c.id !== selectedConversationId)];
        }
        return { messages, conversations, isSending: false };
      });
      return msg.id;
    } catch (e) {
      set((s) => ({
        messages: s.messages.map((m) =>
          m.client_id === clientId ? { ...m, localStatus: "failed" as const } : m,
        ),
        isSending: false,
        error: "Не удалось отправить сообщение",
      }));
      return "";
    }
  },

  // ── Edit message ──────────────────────────────────────────────────────
  editMessage: async (messageId: string, content: string) => {
    const { selectedConversationId } = get();
    if (!selectedConversationId) return;
    try {
      await messengerApi.editMessage(selectedConversationId, messageId, content);
      set((s) => ({
        messages: s.messages.map((m) => (m.id === messageId ? { ...m, content, is_edited: true, edited_at: new Date().toISOString() } : m)),
      }));
    } catch {
      set({ error: "Не удалось отредактировать сообщение" });
    }
  },

  // ── Delete message ────────────────────────────────────────────────────
  deleteMessage: async (messageId: string) => {
    const { selectedConversationId } = get();
    if (!selectedConversationId) return;
    try {
      await messengerApi.deleteMessage(selectedConversationId, messageId);
      set((s) => ({
        messages: s.messages.map((m) => (m.id === messageId ? { ...m, is_deleted: true, content: "" } : m)),
      }));
    } catch {
      set({ error: "Не удалось удалить сообщение" });
    }
  },

  // ── Mark read ─────────────────────────────────────────────────────────
  markRead: async (messageId: string) => {
    const { selectedConversationId } = get();
    if (!selectedConversationId) return;
    try {
      await messengerApi.markRead(selectedConversationId, messageId);
      set((s) => ({
        conversations: s.conversations.map((c) =>
          c.id === selectedConversationId ? { ...c, unread_count: 0 } : c,
        ),
      }));
    } catch {
      // Ignore — non-critical
    }
  },

  // ── Mark delivered ────────────────────────────────────────────────────
  markDelivered: async (messageId: string) => {
    const { selectedConversationId } = get();
    if (!selectedConversationId) return;
    try {
      await messengerApi.markDelivered(selectedConversationId, messageId);
    } catch {
      // Ignore
    }
  },

  // ── Create/find conversation ──────────────────────────────────────────
  createConversation: async (userId: string) => {
    try {
      const resp = await messengerApi.getOrCreateConversation(userId);
      const convId = resp.conversation_id;
      await get().loadConversations();
      return convId;
    } catch (e) {
      set({ error: "Не удалось открыть диалог" });
      return null;
    }
  },

  // ── Toggle pin ────────────────────────────────────────────────────────
  togglePin: async (messageId: string) => {
    const { selectedConversationId } = get();
    if (!selectedConversationId) return;
    try {
      const resp = await messengerApi.togglePin(selectedConversationId, messageId);
      set((s) => ({
        conversations: s.conversations.map((c) =>
          c.id === selectedConversationId ? { ...c, pinned_message_id: resp.pinned_message_id ?? null } : c,
        ),
      }));
    } catch {
      set({ error: "Не удалось закрепить сообщение" });
    }
  },

  // ── Load receipts (debounced) ─────────────────────────────────────────
  loadReceipts: async (conversationId: string) => {
    const now = Date.now();
    const last = lastReceiptsLoad.get(conversationId) ?? 0;
    if (now - last < RECEIPTS_COOLDOWN_MS) return;
    lastReceiptsLoad.set(conversationId, now);

    try {
      const rows = await messengerApi.getReceipts(conversationId);
      set((s) => {
        const next = new Map(s.receipts);
        next.set(conversationId, rows);
        return { receipts: next };
      });
    } catch {
      // Ignore
    }
  },

  // ── Local actions ─────────────────────────────────────────────────────
  selectConversation: (id) => {
    set({ selectedConversationId: id });
    if (id) {
      get().loadMessages(id);
      get().loadReceipts(id);
    } else {
      set({ messages: [] });
    }
  },

  setError: (error) => set({ error }),

  addMessage: (message) => {
    set((s) => {
      // Dedup
      if (s.messages.some((m) => m.id === message.id || m.client_id === message.client_id)) return s;
      return {
        messages: [...s.messages, message].sort(
          (a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime(),
        ),
      };
    });
  },

  updateMessage: (id, updates) => {
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, ...updates } : m)),
    }));
  },

  removeMessage: (id) => {
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, is_deleted: true, content: "" } : m)),
    }));
  },

  setTyping: (userId, username, isTyping) => {
    set((s) => ({
      typingUsers: isTyping
        ? { ...s.typingUsers, [userId]: { user_id: userId, username, is_typing: true, timestamp: Date.now() } }
        : Object.fromEntries(Object.entries(s.typingUsers).filter(([id]) => id !== userId)),
    }));
  },

  setUserOnline: (userId, online) => {
    set((s) => {
      const next = new Set(s.onlineUsers);
      if (online) next.add(userId);
      else next.delete(userId);
      return { onlineUsers: next };
    });
  },

  updateConversationFromWs: (convId, updates, incrementUnread = false) => {
    set((s) => ({
      conversations: s.conversations.map((c) => {
        if (c.id !== convId) return c;
        const updated = { ...c, ...updates };
        if (incrementUnread) {
          updated.unread_count = (c.unread_count ?? 0) + 1;
        }
        return updated;
      }),
    }));
  },
}));
