import { create } from "zustand";
import type { Attachment, ConversationView, MessageView, TypingUser, ReceiptRow } from "@/components/messenger/types";
import { messengerApi } from "@/services/messengerApi";
import { eventManager } from "@/services/eventManager";
import { loadCachedMessages, saveCachedMessages } from "@/utils/messengerCache";
import { decryptNote, decryptNotesMeta, encryptNote, encryptNotesMeta, NOTES_LOCKED } from "@/utils/notesCrypto";
import type { NotesMeta } from "@/utils/notesCrypto";
import { messengerPlainPreview, messengerTextToPlain, stripDanglingTagFragment } from "@/components/messenger/messengerRichTextUtils";

let messageLoadGeneration = 0;
let loadMoreRequestGeneration = 0;
let conversationLoadGeneration = 0;
let initInFlight: Promise<void> | null = null;
const latestEventIds = new Map<string, string>();

function maxEventId(a: string, b: string): string {
  const left = a.replace(/^0+(?=\d)/, "");
  const right = b.replace(/^0+(?=\d)/, "");
  if (left.length !== right.length) return left.length > right.length ? left : right;
  return left >= right ? left : right;
}

function rememberLatestEventId(conversationId: string, messages: MessageView[]): void {
  const eventIds = messages
    .map((message) => message.event_id)
    .filter((id): id is string => typeof id === "string" && /^\d+$/.test(id));
  if (eventIds.length > 0) {
    latestEventIds.set(conversationId, eventIds.reduce(maxEventId));
  }
}

function persistMessages(ownerId: string | null, conversationId: string, messages: MessageView[]): void {
  if (!ownerId) return;
  void saveCachedMessages(ownerId, conversationId, messages);
}

// ─── Notes (client-side E2E self-chat) helpers ───────────────────────────────

function notesConversationExists(conversationId: string | null | undefined): boolean {
  if (!conversationId) return false;
  return useMessengerStore.getState().conversations.some((c) => c.id === conversationId && c.is_notes);
}

// Decrypts a batch of messages for the notes conversation. The store only ever
// holds readable plaintext; the IndexedDB cache keeps what the server stores.
// Notes metadata (pin/folder/tags) is decrypted alongside the body.
async function decryptNotesMessages(conversationId: string, messages: MessageView[]): Promise<MessageView[]> {
  if (!notesConversationExists(conversationId) || messages.length === 0) return messages;
  return Promise.all(
    messages.map(async (message) => {
      let next: MessageView = message;
      if (message.content && !message.is_deleted) {
        const decrypted = await decryptNote(message.content, conversationId);
        if (decrypted === null) {
          if (message.content !== NOTES_LOCKED) next = { ...next, content: NOTES_LOCKED };
        } else {
          next = { ...next, content: decrypted };
        }
      }
      if (message.notes_meta) {
        const meta = await decryptNotesMeta(message.notes_meta, conversationId);
        if (meta) {
          next = {
            ...next,
            notesPinned: meta.pinned ?? false,
            notesFolder: meta.folder ?? null,
            notesTags: meta.tags ?? [],
          };
        }
      }
      return next;
    }),
  );
}

// The server computes previews by truncating the raw wire content (BBCode +
// [e:…] tokens) to 80 chars. Strip the markup so the conversation list shows
// readable plain text — a truncated preview may also end mid-tag, which
// messengerTextToPlain's dangling-fragment strip handles.
function sanitizeServerPreview(preview: string | null | undefined): string {
  if (!preview) return "";
  return messengerTextToPlain(stripDanglingTagFragment(preview)).slice(0, 80);
}

// Decrypts notes conversation previews (the server passes the client
// ciphertext through verbatim so the device can decrypt them locally).
async function decryptNotesPreviews(conversations: ConversationView[]): Promise<ConversationView[]> {
  return Promise.all(
    conversations.map(async (c) => {
      if (c.is_notes) {
        const preview = c.last_message_preview;
        if (!preview) return c;
        const decrypted = await decryptNote(preview, c.id);
        return { ...c, last_message_preview: sanitizeServerPreview(decrypted ?? NOTES_LOCKED) };
      }
      return { ...c, last_message_preview: sanitizeServerPreview(c.last_message_preview) };
    }),
  );
}

function canApplyMessageLoad(ownerId: string | null, conversationId: string, generation: number): boolean {
  const state = useMessengerStore.getState();
  const selected = state.selectedConversationId;
  return generation === messageLoadGeneration
    && state.me?.id === ownerId
    && (selected === null || selected === conversationId);
}

function cacheCurrentMessages(ownerId: string | null, conversationId: string, messages: MessageView[]): void {
  // Notes content is encrypted with a device-local key; never persist it to
  // the IndexedDB cache (the store already holds the readable plaintext).
  if (messages.length > 0 && !notesConversationExists(conversationId)) persistMessages(ownerId, conversationId, messages);
}

function normalizeConversationUnread(conversation: ConversationView, selectedId: string | null): ConversationView {
  if (conversation.id === selectedId) return { ...conversation, unread_count: 0 };
  const readThrough = localReadThrough.get(conversation.id);
  if (readThrough && conversation.last_message_at && Date.parse(conversation.last_message_at) <= Date.parse(readThrough)) {
    return { ...conversation, unread_count: 0 };
  }
  return conversation;
}


// ─── Batched delivered/read receipts ─────────────────────────────────────────
// Delivered receipts remain batched. Read receipts are flushed immediately so
// a reload cannot discard the only request that clears unread_count. The
// backend uses WHERE sent_at <= target, so one latest marker covers the prefix.

let flushTimer: ReturnType<typeof setInterval> | null = null;
type PendingReceipt = { messageId: string; sentAt?: string };
const pendingDelivered = new Map<string, PendingReceipt>(); // convId → latest message
const pendingRead = new Map<string, PendingReceipt>();       // convId → latest message
const lastFlushed = {
  delivered: new Map<string, PendingReceipt>(),
  read: new Map<string, PendingReceipt>(),
};
const flushRetries = new Map<string, number>(); // "read:convId" → attempt count
const localReadThrough = new Map<string, string>(); // convId → newest locally read sent_at

function isLaterReceipt(candidate: PendingReceipt, current?: PendingReceipt): boolean {
  if (!current) return true;
  if (candidate.messageId === current.messageId) return false;
  const candidateTime = candidate.sentAt ? Date.parse(candidate.sentAt) : Number.NaN;
  const currentTime = current.sentAt ? Date.parse(current.sentAt) : Number.NaN;
  if (Number.isFinite(candidateTime) && Number.isFinite(currentTime) && candidateTime !== currentTime) {
    return candidateTime > currentTime;
  }
  // Message IDs are UUIDs, so lexical comparison is not chronological. When
  // no timestamp is available, the caller's latest observation wins.
  return true;
}

function sameReceipt(left: PendingReceipt | undefined, right: PendingReceipt): boolean {
  return left?.messageId === right.messageId && left?.sentAt === right.sentAt;
}

function startFlushTimer(): void {
  if (flushTimer) return;
  flushTimer = setInterval(flushPending, 2000);
}

function flushPending(): void {
  if (pendingDelivered.size === 0 && pendingRead.size === 0) {
    if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
    return;
  }

  // Detach batches before starting requests. A failed request can safely put
  // only its own newest receipt back into the queue instead of being erased by
  // a trailing clear().
  const deliveredBatch = [...pendingDelivered.entries()];
  const readBatch = [...pendingRead.entries()];
  pendingDelivered.clear();
  pendingRead.clear();

  for (const [convId, receipt] of deliveredBatch) {
    if (!isLaterReceipt(receipt, lastFlushed.delivered.get(convId))) continue;
    lastFlushed.delivered.set(convId, receipt);
    messengerApi.markDelivered(convId, receipt.messageId).catch(() => {
      if (sameReceipt(lastFlushed.delivered.get(convId), receipt)) {
        lastFlushed.delivered.delete(convId);
        pendingDelivered.set(convId, receipt);
        startFlushTimer();
      }
    });
  }

  for (const [convId, receipt] of readBatch) {
    if (!isLaterReceipt(receipt, lastFlushed.read.get(convId))) continue;
    lastFlushed.read.set(convId, receipt);
    messengerApi.markRead(convId, receipt.messageId).catch(() => {
      const key = `read:${convId}`;
      const attempts = (flushRetries.get(key) ?? 0) + 1;
      flushRetries.set(key, attempts);
      if (attempts < 3 && sameReceipt(lastFlushed.read.get(convId), receipt)) {
        lastFlushed.read.delete(convId);
        pendingRead.set(convId, receipt);
        startFlushTimer();
      } else if (sameReceipt(lastFlushed.read.get(convId), receipt)) {
        lastFlushed.read.delete(convId);
        flushRetries.delete(key);
      }
    });
  }
}

export function  destroyMessenger(): void {
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
  latestEventIds.clear();
  localReadThrough.clear();
}

export function queueMarkDelivered(conversationId: string, messageId: string, sentAt?: string): void {
  const receipt = { messageId, sentAt };
  const existing = pendingDelivered.get(conversationId);
  if (isLaterReceipt(receipt, existing)) pendingDelivered.set(conversationId, receipt);
  startFlushTimer();
}

export function queueMarkRead(conversationId: string, messageId: string, sentAt?: string): void {
  const receipt = { messageId, sentAt };
  if (sentAt) {
    const previous = localReadThrough.get(conversationId);
    if (!previous || Date.parse(sentAt) >= Date.parse(previous)) localReadThrough.set(conversationId, sentAt);
  }
  const existing = pendingRead.get(conversationId);
  if (isLaterReceipt(receipt, existing)) pendingRead.set(conversationId, receipt);
  // Reset the UI immediately, then start the request immediately. Read state
  // must not depend on a 2-second timer surviving a page reload.
  useMessengerStore.setState((s) => ({
    conversations: s.conversations.map((c) =>
      c.id === conversationId ? { ...c, unread_count: 0 } : c,
    ),
  }));
  flushPending();
}

// ─── Typing indicator auto-clear ────────────────────────────────────────────
const TYPING_TIMEOUT_MS = 5000;
const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
const lastReceiptsLoad = new Map<string, number>(); // convId → timestamp
const RECEIPTS_COOLDOWN_MS = 3000;

// A failed/retried receipt must still leave the page reliably. `keepalive` is
// set on the request itself; pagehide also starts the final pending attempt.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushPending);
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushPending();
  });
}

// ─── Store shape ────────────────────────────────────────────────────────────

type MessengerStore = {
  // ── Data ──────────────────────────────────────────────────────────────
  me: { id: string; username: string } | null;
  conversations: ConversationView[];
  selectedConversationId: string | null;
  openingUnreadCount: number;
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
  syncMessages: (conversationId: string) => Promise<void>;
  loadMoreMessages: (conversationId: string) => Promise<void>;
  sendMessage: (content: string, clientId: string, parentMessageId?: string, attachments?: Attachment[]) => Promise<string>;
  editMessage: (messageId: string, content: string) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  markRead: (messageId: string) => Promise<void>;
  markDelivered: (messageId: string) => Promise<void>;
  createConversation: (userId: string) => Promise<string | null>;
  ensureNotesConversation: () => Promise<string | null>;
  togglePin: (messageId: string) => Promise<void>;
  /** Updates a note's encrypted metadata (pin/folder/tags) and syncs it. */
  setNotesMeta: (messageId: string, meta: NotesMeta) => Promise<void>;
  /** Flips the pin flag of a note. */
  toggleNotesPin: (messageId: string) => Promise<void>;
  loadReceipts: (conversationId: string) => Promise<void>;

  // ── Actions (local) ───────────────────────────────────────────────────
  selectConversation: (id: string | null) => void;
  setError: (error: string | null) => void;
  addMessage: (message: MessageView) => void;
  updateMessage: (id: string, updates: Partial<MessageView>) => void;
  removeMessage: (id: string) => void;
  setTyping: (userId: string, username: string, isTyping: boolean) => void;
  /** Live presence for a 1:1 conversation partner: updates onlineUsers and
   * patches the matching conversation's other_is_online / other_last_seen_at
   * so the sidebar dot and the chat header react instantly. */
  setUserPresence: (userId: string, online: boolean, lastSeen?: string | null) => void;
  updateConversationFromWs: (convId: string, updates: Partial<ConversationView>, incrementUnread?: boolean) => void;
};

// ─── Store implementation ───────────────────────────────────────────────────

export const useMessengerStore = create<MessengerStore>((set, get) => ({
  me: null,
  conversations: [],
  selectedConversationId: null,
  openingUnreadCount: 0,
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
  init: () => {
    if (initInFlight) return initInFlight;
    initInFlight = (async () => {
      try {
      const profile = await messengerApi.getMyProfile();
      set({ me: { id: profile.id, username: profile.username } });
      await get().loadConversations();

      // Register callback for EventManager conversation updates (reconnection recovery)
      eventManager.setMessengerCallbacks({
        onCountUpdate: (convs) => {
          const { selectedConversationId } = useMessengerStore.getState();
          void (async () => {
            const decrypted = await decryptNotesPreviews(convs as ConversationView[]);
            const updated = decrypted.map((c) => normalizeConversationUnread(c, selectedConversationId));
            // EventManager already fetched this snapshot. Invalidate any older
            // list request before applying it, while preserving a local read
            // marker that the server response may not have observed yet.
            conversationLoadGeneration += 1;
            useMessengerStore.setState({ conversations: updated });
          })();
        },
        onReconnect: () => {
          const activeConversationId = useMessengerStore.getState().selectedConversationId;
          if (activeConversationId) {
            void useMessengerStore.getState().syncMessages(activeConversationId);
            void useMessengerStore.getState().loadReceipts(activeConversationId);
          }
        },
      });

      // Trigger initial sync now that all callbacks are registered
      eventManager.startSync();
    } catch (e) {
        set({ error: "Не удалось загрузить профиль", isInitialLoading: false });
        return;
      }
      // `loadConversations` has its own request generation. The single-flight
      // promise is the authoritative init lifecycle, so never leave the app
      // stuck loading just because that nested request advanced the counter.
      set({ isInitialLoading: false });
    })().finally(() => {
      initInFlight = null;
    });
    return initInFlight;
  },

  // ── Load conversations ────────────────────────────────────────────────
  loadConversations: async () => {
    const generation = ++conversationLoadGeneration;
    const raw = await messengerApi.listConversations();
    const convs = await decryptNotesPreviews(raw);
    if (generation !== conversationLoadGeneration) return;
    const selectedId = get().selectedConversationId;
    // The open conversation is considered read locally immediately. This
    // prevents a reconnect/poll response that crossed the mark-read request
    // from flashing the old server counter back into the UI.
    set({
      conversations: convs.map((conversation) => normalizeConversationUnread(conversation, selectedId)),
    });
  },

  // ── Ensure single conversation exists in list (for WS first-message case)
  ensureConversation: async (conversationId: string) => {
    const { conversations } = get();
    if (conversations.some((c) => c.id === conversationId)) return;
    // Not found — reload full list (server has correct unread_count)
    const generation = ++conversationLoadGeneration;
    const raw = await messengerApi.listConversations();
    const convs = await decryptNotesPreviews(raw);
    if (generation !== conversationLoadGeneration) return;
    const selectedId = get().selectedConversationId;
    set({
      conversations: convs.map((conversation) => normalizeConversationUnread(conversation, selectedId)),
    });
  },

  // ── Load messages ─────────────────────────────────────────────────────
  loadMessages: async (conversationId: string) => {
    const generation = ++messageLoadGeneration;
    let hasCachedMessages = false;
    const ownerId = get().me?.id ?? null;
    set({ isMessagesLoading: true, error: null });

    // Render the last local snapshot first. The network request below still
    // runs immediately and remains authoritative when it succeeds.
    try {
      const cached = ownerId ? await loadCachedMessages(ownerId, conversationId) : null;
      const cachedView = cached ? await decryptNotesMessages(conversationId, cached) : null;
      if (cachedView && cachedView.length > 0 && canApplyMessageLoad(ownerId, conversationId, generation)) {
        hasCachedMessages = true;
        rememberLatestEventId(conversationId, cachedView);
        set({ messages: cachedView, hasMoreMessages: cachedView.length >= 50 });
      }
    } catch {
      // IndexedDB is an optional optimization; never block the network path.
    }

    try {
      // Notes are personal-scale: load every message so the pinned section and
      // folder filters are complete — a pinned note could otherwise sit beyond
      // the first paginated page. Loop 100-message pages with the `before`
      // cursor until the server returns an empty page.
      let raw: MessageView[];
      if (notesConversationExists(conversationId)) {
        raw = [];
        let before: string | undefined;
        for (let page = 0; page < 200; page += 1) {
          const pageRaw = await messengerApi.getMessages(conversationId, before, undefined, 100);
          if (pageRaw.length === 0) break;
          raw = [...pageRaw, ...raw];
          if (pageRaw.length < 100) break;
          before = pageRaw[0].id;
        }
      } else {
        raw = await messengerApi.getMessages(conversationId);
      }
      const msgs = await decryptNotesMessages(conversationId, raw);
      if (!canApplyMessageLoad(ownerId, conversationId, generation)) return;
      set({
        messages: msgs,
        isMessagesLoading: false,
        hasMoreMessages: !notesConversationExists(conversationId) && msgs.length >= 50,
      });
      rememberLatestEventId(conversationId, msgs);
      // Notes content is device-encrypted: never persist it to the IndexedDB
      // cache (the store already holds the readable plaintext).
      if (!notesConversationExists(conversationId)) persistMessages(ownerId, conversationId, msgs);
      // The conversation is on screen: tell the server immediately that it is
      // fully read, using the newest visible message (own or other). Relying on
      // the other user's last message alone lets a conversation whose newest
      // message is our own stay unread on the server, so the badge would come
      // back after a reload. queueMarkRead flushes instantly and the backend
      // treats the marker as a prefix (sent_at <= marker).
      const lastVisible = [...msgs].reverse().find((m) => !m.is_deleted && !m.localStatus);
      if (lastVisible) {
        queueMarkRead(conversationId, lastVisible.id, lastVisible.sent_at);
      }
    } catch {
      if (!canApplyMessageLoad(ownerId, conversationId, generation)) return;
      set({
        error: hasCachedMessages ? null : "Не удалось загрузить сообщения",
        isMessagesLoading: false,
      });
    }
  },

  // ── Reconnect delta sync ──────────────────────────────────────────────
  syncMessages: async (conversationId: string) => {
    const ownerId = get().me?.id ?? null;
    const sinceEventId = latestEventIds.get(conversationId);
    try {
      const raw = await messengerApi.getMessages(conversationId, undefined, sinceEventId);
      const delta = await decryptNotesMessages(conversationId, raw);
      if (get().selectedConversationId !== conversationId || get().me?.id !== ownerId) return;
      if (delta.length === 0) return;
      set((s) => {
        const byIdentity = new Map(s.messages.map((message) => [message.id || message.client_id, message]));
        for (const message of delta) byIdentity.set(message.id || message.client_id, message);
        const messages = [...byIdentity.values()].sort((a, b) =>
          new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime(),
        );
        rememberLatestEventId(conversationId, delta);
        cacheCurrentMessages(ownerId, conversationId, messages);
        return { messages };
      });
    } catch {
      // Reconnect recovery is best effort; polling/full open remains available.
    }
  },

  // ── Load older messages (pagination) ──────────────────────────────────
  loadMoreMessages: async (conversationId: string) => {
    const { messages, isLoadingMore } = get();
    if (isLoadingMore || messages.length === 0) return;
    const generation = messageLoadGeneration;
    const requestGeneration = ++loadMoreRequestGeneration;
    const ownerId = get().me?.id ?? null;

    const oldest = messages[0];
    set({ isLoadingMore: true });
    try {
      const raw = await messengerApi.getMessages(conversationId, oldest.id);
      const older = await decryptNotesMessages(conversationId, raw);
      if (!canApplyMessageLoad(ownerId, conversationId, generation)) {
        if (requestGeneration === loadMoreRequestGeneration) {
          set({ isLoadingMore: false });
        }
        return;
      }
      if (older.length === 0) {
        set({ hasMoreMessages: false, isLoadingMore: false });
        return;
      }
      set((s) => {
        // Merge older history without duplicates. Pagination is keyed on the
        // oldest message's sent_at (strictly exclusive server-side), but a
        // message that arrived mid-request can still land on both pages — a
        // duplicated key would shift the virtualized item windows and jump
        // the layout while the user scrolls through history.
        const byIdentity = new Map<string, MessageView>();
        for (const message of older) byIdentity.set(message.id || message.client_id, message);
        for (const message of s.messages) {
          const key = message.id || message.client_id;
          if (!byIdentity.has(key)) byIdentity.set(key, message);
        }
        // Stable sort (ES2019+): messages sharing a sent_at keep the insertion
        // order above (older first, then existing) — identical to the plain
        // concatenation order, so no message ever "moves" on a tie.
        const messages = [...byIdentity.values()].sort(
          (a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime(),
        );
        rememberLatestEventId(conversationId, messages);
        cacheCurrentMessages(ownerId, conversationId, messages);
        return {
          messages,
          hasMoreMessages: older.length >= 50,
          isLoadingMore: false,
        };
      });
    } catch {
      if (requestGeneration === loadMoreRequestGeneration) {
        set({ isLoadingMore: false });
      }
    }
  },

  // ── Send message ──────────────────────────────────────────────────────
  sendMessage: async (content: string, clientId: string, parentMessageId?: string, attachments?: Attachment[]) => {
    const { selectedConversationId } = get();
    if (!selectedConversationId) return "";

    // Notes: encrypt plaintext locally before it ever leaves the device. The
    // server stores the ciphertext verbatim and never holds the key.
    const isNotes = notesConversationExists(selectedConversationId);
    let wireContent = content;
    if (isNotes && content.trim()) {
      try {
        wireContent = await encryptNote(content, selectedConversationId);
      } catch {
        set({ error: "Не удалось зашифровать заметку" });
        return "";
      }
    }

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
      const msg: MessageView = await messengerApi.sendMessage(
        selectedConversationId,
        wireContent,
        clientId,
        parentMessageId,
        attachments,
      );
      const sentAt = msg.sent_at;
      // For notes the server echoes the client ciphertext; decrypt it back to
      // plaintext so the store only ever holds readable notes.
      let displayContent = msg.content;
      if (isNotes) {
        const decrypted = await decryptNote(msg.content, selectedConversationId);
        displayContent = decrypted ?? content;
      }
      set((s) => {
        // Update message from optimistic to real — preserve attachments from optimistic if server doesn't return them
        const messages = s.messages.map((m) => {
          if (m.client_id !== clientId) return m;
          const serverAttachments = msg.attachments && msg.attachments.length > 0 ? msg.attachments : m.attachments;
          return { ...msg, content: displayContent, attachments: serverAttachments, localStatus: "sent" as const };
        });
        // Optimistically update conversation: move to top with new preview
        const target = s.conversations.find((c) => c.id === selectedConversationId);
        let conversations = s.conversations;
        if (target) {
          const previewText = content.trim()
            ? messengerPlainPreview(content, 80)
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
        rememberLatestEventId(selectedConversationId, messages);
        cacheCurrentMessages(s.me?.id ?? null, selectedConversationId, messages);
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

    // Notes: encrypt the new content locally before the edit request.
    let wireContent = content;
    if (notesConversationExists(selectedConversationId) && content.trim()) {
      try {
        wireContent = await encryptNote(content, selectedConversationId);
      } catch {
        set({ error: "Не удалось зашифровать заметку" });
        return;
      }
    }

    // Save original content for rollback
    const original = get().messages.find((m) => m.id === messageId);
    const originalContent = original?.content ?? content;

    // Optimistic update
    set((s) => ({
      messages: s.messages.map((m) => (m.id === messageId ? { ...m, content, is_edited: true, edited_at: new Date().toISOString() } : m)),
    }));

    try {
      await messengerApi.editMessage(selectedConversationId, messageId, wireContent);
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

  // ── Get or create the personal notes chat ─────────────────────────────
  ensureNotesConversation: async () => {
    try {
      const resp = await messengerApi.getOrCreateNotes();
      await get().loadConversations();
      return resp.conversation_id;
    } catch (e) {
      set({ error: "Не удалось открыть Заметки" });
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

  // ── Notes metadata (pin/folder/tags, client-side E2E) ────────────────
  setNotesMeta: async (messageId, meta) => {
    const { selectedConversationId } = get();
    if (!selectedConversationId) return;
    const original = get().messages.find((m) => m.id === messageId);
    if (!original) return;
    const normalized: NotesMeta = {
      pinned: Boolean(meta.pinned),
      folder: meta.folder?.trim() ? meta.folder.trim() : null,
      tags: (meta.tags ?? []).map((tag) => tag.trim()).filter(Boolean),
    };
    const apply = (patch: Partial<MessageView>) =>
      set((s) => ({
        messages: s.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
      }));
    // Optimistic update — the notes chat feels instant.
    apply({
      notesPinned: normalized.pinned,
      notesFolder: normalized.folder,
      notesTags: normalized.tags,
    });
    try {
      const wire = await encryptNotesMeta(normalized, selectedConversationId);
      await messengerApi.updateNotesMeta(selectedConversationId, messageId, wire);
    } catch {
      // Revert on failure so the UI never shows state the server lacks.
      apply({
        notesPinned: original.notesPinned ?? false,
        notesFolder: original.notesFolder ?? null,
        notesTags: original.notesTags ?? [],
      });
      set({ error: "Не удалось сохранить настройки заметки" });
    }
  },

  toggleNotesPin: async (messageId) => {
    const message = get().messages.find((m) => m.id === messageId);
    if (!message) return;
    await get().setNotesMeta(messageId, {
      pinned: !message.notesPinned,
      folder: message.notesFolder ?? null,
      tags: message.notesTags ?? [],
    });
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
    // Invalidate in-flight cache/network responses before switching so a slow
    // previous conversation can never overwrite the newly selected one.
    messageLoadGeneration++;
    loadMoreRequestGeneration++;
    // Flush pending reads/delivered before switching so DB stays in sync
    flushPending();
    // Clear messages immediately to prevent stale messages from previous conversation
    const openingUnreadCount = id
      ? get().conversations.find((conversation) => conversation.id === id)?.unread_count ?? 0
      : 0;
    set({
      selectedConversationId: id,
      openingUnreadCount,
      messages: [],
      hasMoreMessages: true,
      isLoadingMore: false,
      isMessagesLoading: !!id,
      conversations: get().conversations.map((conversation) =>
        conversation.id === id ? { ...conversation, unread_count: 0 } : conversation,
      ),
    });
    if (id) {
      get().loadMessages(id);
      get().loadReceipts(id);
    }
  },

  setError: (error) => set({ error }),

  addMessage: (message) => {
    const apply = (finalMessage: MessageView) => {
      set((s) => {
        // Dedup
        if (s.messages.some((m) => m.id === message.id || m.client_id === message.client_id)) return s;
        // Events for another conversation update its preview, but must never
        // leak into the currently visible message list.
        if (s.selectedConversationId && s.selectedConversationId !== message.conversation_id) return s;
        const messages = [...s.messages, finalMessage].sort(
          (a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime(),
        );
        rememberLatestEventId(message.conversation_id, messages);
        cacheCurrentMessages(s.me?.id ?? null, message.conversation_id, messages);
        return { messages };
      });
    };
    if (!notesConversationExists(message.conversation_id)) {
      apply(message);
      return;
    }
    // Notes WS payloads carry the client ciphertext — decrypt before showing.
    void (async () => {
      const content = message.content
        ? (await decryptNote(message.content, message.conversation_id)) ?? NOTES_LOCKED
        : message.content;
      apply({ ...message, content });
    })();
  },

  updateMessage: (id, updates) => {
    const apply = (finalUpdates: Partial<MessageView>) => {
      set((s) => {
        const messages = s.messages.map((m) => (m.id === id ? { ...m, ...finalUpdates } : m));
        const changed = messages.some((m, index) => m !== s.messages[index]);
        if (changed && s.selectedConversationId) cacheCurrentMessages(s.me?.id ?? null, s.selectedConversationId, messages);
        return { messages };
      });
    };
    const content = updates.content;
    const conversationId = get().selectedConversationId;
    if (conversationId && notesConversationExists(conversationId)) {
      if (updates.notes_meta !== undefined) {
        // WS notes-meta events carry the client ciphertext — decrypt first and
        // never keep the wire blob on the readable message.
        void (async () => {
          const meta = await decryptNotesMeta(updates.notes_meta, conversationId);
          if (!meta) {
            apply({
              ...updates,
              notes_meta: undefined,
              notesPinned: false,
              notesFolder: null,
              notesTags: [],
            });
            return;
          }
          apply({
            ...updates,
            notes_meta: undefined,
            notesPinned: meta.pinned ?? false,
            notesFolder: meta.folder ?? null,
            notesTags: meta.tags ?? [],
          });
        })();
        return;
      }
      if (content !== undefined) {
        // WS edit events for notes carry the client ciphertext — decrypt first.
        void (async () => {
          const decrypted = (await decryptNote(content, conversationId)) ?? NOTES_LOCKED;
          apply({ ...updates, content: decrypted });
        })();
        return;
      }
    }
    apply(updates);
  },

  removeMessage: (id) => {
    set((s) => {
      const messages = s.messages.map((m) => (m.id === id ? { ...m, is_deleted: true, content: "" } : m));
      const changed = messages.some((m, index) => m !== s.messages[index]);
      if (changed && s.selectedConversationId) cacheCurrentMessages(s.me?.id ?? null, s.selectedConversationId, messages);
      return { messages };
    });
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

  setUserPresence: (userId, online, lastSeen) => {
    set((s) => {
      const onlineUsers = new Set(s.onlineUsers);
      if (online) onlineUsers.add(userId);
      else onlineUsers.delete(userId);
      // Patch only the 1:1 conversation(s) with this peer. When a delta
      // carries no last_seen, keep the last known value (from the snapshot or
      // the REST-loaded conversation) instead of stamping the arrival time.
      const conversations = s.conversations.map((c) => {
        if (c.is_group || c.is_notes || c.other_user_id !== userId) return c;
        return {
          ...c,
          other_is_online: online,
          other_last_seen_at: lastSeen ?? c.other_last_seen_at,
        };
      });
      return { onlineUsers, conversations };
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
        // WS previews carry the raw (possibly BBCode) wire text — clean it
        // before it reaches the conversation list.
        const updates2 = updates.last_message_preview !== undefined
          ? { ...updates, last_message_preview: sanitizeServerPreview(updates.last_message_preview) }
          : updates;
        const updated = { ...c, ...updates2 };
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

// ─── Exported selectors (avoid creating new refs in components) ───────────
export const selectSelectedConversation = (s: MessengerStore) =>
  s.conversations.find((c) => c.id === s.selectedConversationId) ?? null;

export const selectTotalUnread = (s: MessengerStore) =>
  s.conversations.reduce((sum, c) => sum + (c.unread_count ?? 0), 0);
