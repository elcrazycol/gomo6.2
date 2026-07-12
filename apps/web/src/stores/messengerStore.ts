import { create } from "zustand";
import type { Attachment, ConversationView, MessageView, TypingUser, ReceiptRow } from "@/components/messenger/types";
import { messengerApi } from "@/services/messengerApi";
import { eventManager } from "@/services/eventManager";
import { sendE2EMessage, getDeviceId } from "@/services/e2e/e2eManager";

// ─── Batched markDelivered/markRead ─────────────────────────────────────────
// Instead of hitting the API on every message, we queue the latest message ID
// per conversation and flush every 2 seconds. The backend's MarkRead/MarkDelivered
// use WHERE sent_at <= target, so sending just the latest ID marks all before it.

let flushTimer: ReturnType<typeof setInterval> | null = null;
const pendingDelivered = new Map<string, string>(); // convId → latestMessageId
const pendingRead = new Map<string, string>();       // convId → latestMessageId
const lastFlushed = { delivered: new Map<string, string>(), read: new Map<string, string>() };
const flushRetries = new Map<string, number>(); // "read:convId" → attempt count

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
      messengerApi.markDelivered(convId, msgId).catch(() => {
        lastFlushed.delivered.delete(convId);
      });
    }
  }
  pendingDelivered.clear();

  // Flush read (with retry limit)
  for (const [convId, msgId] of pendingRead) {
    if (lastFlushed.read.get(convId) !== msgId) {
      lastFlushed.read.set(convId, msgId);
      messengerApi.markRead(convId, msgId).catch(() => {
        const key = `read:${convId}`;
        const attempts = (flushRetries.get(key) ?? 0) + 1;
        flushRetries.set(key, attempts);
        if (attempts < 3) {
          lastFlushed.read.delete(convId);
          pendingRead.set(convId, msgId);
        } else {
          pendingRead.delete(convId);
          lastFlushed.read.delete(convId);
          flushRetries.delete(key);
        }
      });
    }
  }
  pendingRead.clear();
}

export function destroyMessenger(): void {
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  pendingDelivered.clear();
  pendingRead.clear();
  lastFlushed.delivered.clear();
  lastFlushed.read.clear();
  flushRetries.clear();
  lastReceiptsLoad.clear();
  // Clear all typing timers
  for (const timer of typingTimers.values()) clearTimeout(timer);
  typingTimers.clear();
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
  // Reset unread count locally so UI reflects read state immediately
  useMessengerStore.setState((s) => ({
    conversations: s.conversations.map((c) =>
      c.id === conversationId ? { ...c, unread_count: 0 } : c,
    ),
  }));
  startFlushTimer();
}

// ─── Typing indicator auto-clear ────────────────────────────────────────────
const TYPING_TIMEOUT_MS = 5000;
const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
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
  isLoadingMore: boolean;
  hasMoreMessages: boolean;
  isSending: boolean;
  error: string | null;

  // ── Computed helpers ──────────────────────────────────────────────────
  selectedConversation: () => ConversationView | null;
  totalUnread: () => number;

  // ── Actions (API) ─────────────────────────────────────────────────────
  init: () => Promise<void>;
  loadConversations: () => Promise<void>;
  ensureConversation: (conversationId: string) => Promise<void>;
  loadMessages: (conversationId: string) => Promise<void>;
  loadMoreMessages: (conversationId: string) => Promise<void>;
  sendMessage: (content: string, clientId: string, parentMessageId?: string, attachments?: Attachment[]) => Promise<string>;
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
  isLoadingMore: false,
  hasMoreMessages: true,
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

      // Register callback for EventManager conversation updates (reconnection recovery)
      eventManager.setMessengerCallbacks({
        onCountUpdate: (convs) => {
          const { selectedConversationId } = useMessengerStore.getState();
          const updated = convs.map((c) => {
            if (selectedConversationId === c.id) {
              return { ...c, unread_count: 0 };
            }
            return c;
          });
          useMessengerStore.setState({ conversations: updated as ConversationView[] });
        },
      });

      // Trigger initial sync now that all callbacks are registered
      eventManager.startSync();
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

  // ── Ensure single conversation exists in list (for WS first-message case)
  ensureConversation: async (conversationId: string) => {
    const { conversations } = get();
    if (conversations.some((c) => c.id === conversationId)) return;
    // Not found — reload full list (server has correct unread_count)
    const convs = await messengerApi.listConversations();
    set({ conversations: convs });
  },

  // ── Load messages ─────────────────────────────────────────────────────
  loadMessages: async (conversationId: string) => {
    set({ isMessagesLoading: true, error: null });
    try {
      const msgs = await messengerApi.getMessages(conversationId);
      set({ messages: msgs, isMessagesLoading: false, hasMoreMessages: msgs.length >= 50 });
    } catch (e) {
      set({ error: "Не удалось загрузить сообщения", isMessagesLoading: false });
    }
  },

  // ── Load older messages (pagination) ──────────────────────────────────
  loadMoreMessages: async (conversationId: string) => {
    const { messages, isLoadingMore } = get();
    if (isLoadingMore || messages.length === 0) return;

    const oldest = messages[0];
    set({ isLoadingMore: true });
    try {
      const older = await messengerApi.getMessages(conversationId, oldest.id);
      if (older.length === 0) {
        set({ hasMoreMessages: false, isLoadingMore: false });
        return;
      }
      set((s) => ({
        messages: [...older, ...s.messages],
        hasMoreMessages: older.length >= 50,
        isLoadingMore: false,
      }));
    } catch {
      set({ isLoadingMore: false });
    }
  },

  // ── Send message ──────────────────────────────────────────────────────
  sendMessage: async (content: string, clientId: string, parentMessageId?: string, attachments?: Attachment[]) => {
    const { selectedConversationId } = get();
    if (!selectedConversationId) return "";

    // Optimistic insert
    const tempId = `temp_${clientId}`;
    const optimistic: MessageView = {
      id: tempId,
      conversation_id: selectedConversationId,
      sender_user_id: get().me!.id,
      parent_message_id: parentMessageId ?? null,
      content,
      is_edited: false,
      is_deleted: false,
      edited_at: null,
      sent_at: new Date().toISOString(),
      client_id: clientId,
      localStatus: "sending",
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
    };
    set((s) => ({ messages: [...s.messages, optimistic], isSending: true }));

    try {
      const conversation = get().conversations.find((c) => c.id === selectedConversationId);
      let msg: MessageView;

      if (conversation?.is_e2e && conversation.other_user_id) {
        // E2E message: encrypt with Signal Protocol and send via E2E path
        const deviceId = getDeviceId();
        await sendE2EMessage(
          selectedConversationId,
          conversation.other_user_id,
          content,
          deviceId
        );
        // Construct a minimal MessageView for optimistic update
        // (the real message comes back via WebSocket)
        msg = {
          id: tempId,
          conversation_id: selectedConversationId,
          sender_user_id: get().me!.id,
          parent_message_id: parentMessageId ?? null,
          content,
          is_edited: false,
          is_deleted: false,
          edited_at: null,
          sent_at: new Date().toISOString(),
          client_id: clientId,
          ...(attachments && attachments.length > 0 ? { attachments } : {}),
        };
      } else {
        // Regular message
        msg = await messengerApi.sendMessage(selectedConversationId, content, clientId, parentMessageId, attachments);
      }
      const sentAt = msg.sent_at;
      set((s) => {
        // Update message from optimistic to real — preserve attachments from optimistic if server doesn't return them
        const messages = s.messages.map((m) => {
          if (m.client_id !== clientId) return m;
          const serverAttachments = msg.attachments && msg.attachments.length > 0 ? msg.attachments : m.attachments;
          return { ...msg, attachments: serverAttachments, localStatus: "sent" as const };
        });
        // Optimistically update conversation: move to top with new preview
        const target = s.conversations.find((c) => c.id === selectedConversationId);
        let conversations = s.conversations;
        if (target) {
          const previewText = content.trim()
            ? content.slice(0, 80)
            : attachments && attachments.length > 0
              ? `📎 ${attachments.length > 1 ? `${attachments.length} файлов` : attachments[0].name}`
              : "";
          const updated = {
            ...target,
            last_message_at: sentAt,
            last_message_preview: previewText,
            last_message_sender_id: s.me!.id,
            unread_count: 0,
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

    // Save original content for rollback
    const original = get().messages.find((m) => m.id === messageId);
    const originalContent = original?.content ?? content;

    // Optimistic update
    set((s) => ({
      messages: s.messages.map((m) => (m.id === messageId ? { ...m, content, is_edited: true, edited_at: new Date().toISOString() } : m)),
    }));

    try {
      await messengerApi.editMessage(selectedConversationId, messageId, content);
    } catch {
      // Revert to original content on failure
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === messageId ? { ...m, content: originalContent, is_edited: original?.is_edited ?? false, edited_at: original?.edited_at ?? null } : m,
        ),
        error: "Не удалось отредактировать сообщение",
      }));
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
    // Flush pending reads/delivered before switching so DB stays in sync
    flushPending();
    // Clear messages immediately to prevent stale messages from previous conversation
    set({ selectedConversationId: id, messages: [], hasMoreMessages: true, isLoadingMore: false, isMessagesLoading: !!id });
    if (id) {
      get().loadMessages(id);
      get().loadReceipts(id);
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
    if (isTyping) {
      // Clear any existing timer for this user
      const existing = typingTimers.get(userId);
      if (existing) clearTimeout(existing);

      // Set new auto-clear timer
      const timer = setTimeout(() => {
        typingTimers.delete(userId);
        useMessengerStore.getState().setTyping(userId, username, false);
      }, TYPING_TIMEOUT_MS);
      typingTimers.set(userId, timer);

      set((s) => ({
        typingUsers: { ...s.typingUsers, [userId]: { user_id: userId, username, is_typing: true, timestamp: Date.now() } },
      }));
    } else {
      // Clear timer and remove typing state
      const existing = typingTimers.get(userId);
      if (existing) clearTimeout(existing);
      typingTimers.delete(userId);

      set((s) => ({
        typingUsers: Object.fromEntries(Object.entries(s.typingUsers).filter(([id]) => id !== userId)),
      }));
    }
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
    const s = get();
    const found = s.conversations.some((c) => c.id === convId);
    if (!found) {
      // Conversation doesn't exist locally yet — fetch it
      s.ensureConversation(convId);
      return;
    }
    set((s2) => {
      const updatedConversations = s2.conversations.map((c) => {
        if (c.id !== convId) return c;
        const updated = { ...c, ...updates };
        if (incrementUnread && s2.selectedConversationId !== convId) {
          updated.unread_count = (c.unread_count ?? 0) + 1;
        } else if (s2.selectedConversationId === convId) {
          // User is viewing this conversation — force unread to 0
          updated.unread_count = 0;
        }
        return updated;
      });
      // Re-sort by last_message_at descending so conversations with new messages move to top
      updatedConversations.sort((a, b) => {
        const ta = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
        const tb = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
        return tb - ta;
      });
      return { conversations: updatedConversations };
    });
  },
}));
