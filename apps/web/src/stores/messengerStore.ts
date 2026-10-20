import { create } from "zustand";
import { toast } from "sonner";
import type {
  Attachment,
  ConversationView,
  MessageView,
  ReactionUser,
  TypingUser,
  ReceiptRow,
} from "@/components/messenger/types";
import { applyReaction, noteReactionUsed, replaceChips } from "@/components/messenger/reactions";
import { messengerApi } from "@/services/messengerApi";
import { eventManager } from "@/services/eventManager";
import { loadCachedMessages, saveCachedMessages } from "@/utils/messengerCache";
import { decryptNote, decryptNotesMeta, encryptNote, encryptNotesMeta, NOTES_LOCKED } from "@/utils/notesCrypto";
import type { NotesMeta } from "@/utils/notesCrypto";
import { messengerPlainPreview, messengerTextToPlain, stripDanglingTagFragment } from "@/components/messenger/messengerRichTextUtils";
import { appendMessages, mergeMessages, prependOlder, sortBySentAt } from "@/components/messenger/core/messageModel";
import {
  deleteOutbox,
  isPermanentSendError,
  listOutbox,
  outboxKey,
  outboxRetryDelay,
  putOutbox,
  clearOutbox,
  OUTBOX_MAX_ATTEMPTS,
  type OutboxEntry,
} from "@/components/messenger/core/outbox";

/** The realtime delta a peer's reaction arrives as. */
export type ReactionEvent = {
  message_id: string;
  conversation_id?: string;
  emoji: string;
  user_id: string;
  username: string;
  action: "add" | "remove";
};

let messageLoadGeneration = 0;
let loadMoreRequestGeneration = 0;
let conversationLoadGeneration = 0;
let initInFlight: Promise<void> | null = null;
/** The outbox retry loop (one timer, one in-flight flush). */
let outboxTimer: ReturnType<typeof setTimeout> | null = null;
let outboxFlushing = false;
let outboxListenersAttached = false;
const latestEventIds = new Map<string, string>();

// ── Buffered older pages ─────────────────────────────────────────────────────
// Older pages are fetched ahead of the reader but are only written into
// `messages` at a quiet moment (see flushPendingOlderMessages). Inserting a
// page above the viewport shifts the content under the reader; on iOS the
// scroll compensation for that shift is deferred until the momentum ends, so
// the shift is visible for as long as the coast lasts.
const pendingOlderPages = new Map<string, MessageView[]>();
/** Cap on the buffered runway (~two pages). */
const MAX_PENDING_OLDER_MESSAGES = 100;

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
// messengerTextToPlain's dangling-fragment strip handles. Emoji tokens are
// dropped WITHOUT the ◆ placeholder (a one-line list preview must not fill
// with diamonds); special-message markers (__GIFT__/__SHARE__) are kept
// verbatim so the list can decorate them with their real labels/names.
function sanitizeServerPreview(preview: string | null | undefined): string {
  if (!preview) return "";
  return messengerTextToPlain(stripDanglingTagFragment(preview))
    .replace(/◆/g, "")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, 80);
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

/**
 * Pending mail belongs in its chat the moment the reader wrote it — including
 * after a reload, when the message only exists in the outbox and not yet on the
 * server. Merge those bubbles back in (a `gaveUp` entry renders as failed, so
 * the tap-to-retry row survives a restart too).
 */
function withOutboxEntries(
  messages: MessageView[],
  entries: OutboxEntry[],
  conversationId: string,
  ownerId: string,
): MessageView[] {
  const queued = entries.filter((entry) => entry.conversationId === conversationId);
  if (queued.length === 0) return messages;
  const present = new Set(messages.map((m) => m.client_id || m.id));
  const missing: MessageView[] = queued
    .filter((entry) => !present.has(entry.clientId))
    .map((entry) => ({
      id: `temp_${entry.clientId}`,
      conversation_id: conversationId,
      sender_user_id: ownerId,
      parent_message_id: entry.parentMessageId ?? null,
      content: entry.content,
      is_edited: false,
      is_deleted: false,
      edited_at: null,
      sent_at: new Date(entry.createdAt).toISOString(),
      client_id: entry.clientId,
      localStatus: entry.gaveUp ? "failed" : "sending",
      ...(entry.attachments.length > 0 ? { attachments: entry.attachments } : {}),
    }));
  if (missing.length === 0) return messages;
  return mergeMessages(messages, missing);
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
// Delivered receipts stay batched (a prefix marker: receiving the newest
// message implies every older one was delivered too). Read receipts use the
// Telegram-style "read line": the UI reports the NEWEST fully-visible message
// once per scroll/layout pass, the store debounces it and the backend marks
// the whole prefix up to it in a single request. Messages below the fold are
// never reported, so they stay unread — and a scroll burst costs one request,
// not one per message.

let flushTimer: ReturnType<typeof setInterval> | null = null;
type PendingReceipt = { messageId: string; sentAt?: string };
const pendingDelivered = new Map<string, PendingReceipt>(); // convId → latest message
const lastFlushed = {
  delivered: new Map<string, PendingReceipt>(),
};
// convId → newest read line reported by the UI but not yet sent.
const pendingReadLine = new Map<string, PendingReceipt>();
// convId → newest read line already confirmed sent. Read state is monotonic:
// only a line NEWER than this ever fires a request.
const lastSentReadLine = new Map<string, PendingReceipt>();
const localReadThrough = new Map<string, string>(); // convId → newest locally read sent_at



let readFlushTimer: ReturnType<typeof setTimeout> | null = null;
const READ_FLUSH_DELAY_MS = 400;
/** A failed read line is retried (reading is monotonic, so it never goes back). */
const READ_RETRY_DELAY_MS = 3000;

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
  if (pendingDelivered.size === 0) {
    if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
    return;
  }

  // Detach the batch before starting requests. A failed request can safely put
  // only its own newest receipt back into the queue instead of being erased by
  // a trailing clear().
  const deliveredBatch = [...pendingDelivered.entries()];
  pendingDelivered.clear();

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
}

/** Sleep until the earliest queued message is due; no queue, no timer. */
function scheduleOutboxFlush(delayMs: number): void {
  if (outboxTimer !== null) clearTimeout(outboxTimer);
  outboxTimer = setTimeout(() => {
    outboxTimer = null;
    void useMessengerStore.getState().flushOutbox();
  }, Math.max(250, delayMs));
}

async function armOutbox(): Promise<void> {
  if (outboxTimer !== null) {
    clearTimeout(outboxTimer);
    outboxTimer = null;
  }
  const owner = useMessengerStore.getState().me?.id;
  if (!owner) return;
  const pending = await listOutbox(owner);
  const active = pending.filter((entry) => !entry.gaveUp);
  if (active.length === 0) return;
  // The queue is persisted, so earliest-due is the only clock we need.
  scheduleOutboxFlush(Math.min(...active.map((entry) => entry.nextAttemptAt)) - Date.now());
}

/** Flush on the signals that mean "the network is back" (once per session). */
function attachOutboxListeners(): void {
  if (outboxListenersAttached || typeof window === "undefined") return;
  outboxListenersAttached = true;
  const flush = () => {
    void useMessengerStore.getState().flushOutbox();
  };
  window.addEventListener("online", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") flush();
  });
}

export function  destroyMessenger(): void {
  if (outboxTimer !== null) { clearTimeout(outboxTimer); outboxTimer = null; }
  outboxFlushing = false;
  void clearOutbox(useMessengerStore.getState().me?.id);
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  if (readFlushTimer) { clearTimeout(readFlushTimer); readFlushTimer = null; }
  pendingDelivered.clear();
  lastFlushed.delivered.clear();
  pendingReadLine.clear();
  lastSentReadLine.clear();
  lastReceiptsLoad.clear();
  // Clear all typing timers
  for (const timer of typingTimers.values()) clearTimeout(timer);
  typingTimers.clear();
  latestEventIds.clear();
  localReadThrough.clear();
  pendingOlderPages.clear();
}

export function queueMarkDelivered(conversationId: string, messageId: string, sentAt?: string): void {
  const receipt = { messageId, sentAt };
  const existing = pendingDelivered.get(conversationId);
  if (isLaterReceipt(receipt, existing)) pendingDelivered.set(conversationId, receipt);
  startFlushTimer();
}

export function queueMarkRead(conversationId: string, messageId: string, sentAt?: string): void {
  const receipt = { messageId, sentAt };
  // Keep only the newest read line. The backend marks the whole prefix up to
  // it, so older lines are subsumed — no reason to ever send them.
  const existing = pendingReadLine.get(conversationId);
  // This is called on EVERY scroll event (MessageList reports the visible
  // read line on every pass). When the line did not advance, nothing changed
  // — bail out before touching the store. An unconditional setState here used
  // to build a NEW conversation object per scroll event, which re-rendered
  // the whole chat (ChatView → renderMessage → MessageList) on every scroll.
  if (existing?.messageId === receipt.messageId) return;
  if (!isLaterReceipt(receipt, existing)) return;
  pendingReadLine.set(conversationId, receipt);
  if (sentAt) {
    const previous = localReadThrough.get(conversationId);
    if (!previous || Date.parse(sentAt) >= Date.parse(previous)) localReadThrough.set(conversationId, sentAt);
  }
  // Reset the UI immediately — the conversation the user is looking at is
  // read from their perspective even before the server confirms. The server
  // recomputes the true unread_count from the read line on the next fetch.
  // Only write the store when unread_count actually flips, so the steady-state
  // scroll path (already read) costs zero store writes.
  const conv = useMessengerStore.getState().conversations.find((c) => c.id === conversationId);
  if (conv && (conv.unread_count ?? 0) > 0) {
    useMessengerStore.setState((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === conversationId ? { ...c, unread_count: 0 } : c,
      ),
    }));
  }
  scheduleReadFlush();
}

function scheduleReadFlush(delay = READ_FLUSH_DELAY_MS): void {
  if (readFlushTimer) clearTimeout(readFlushTimer);
  readFlushTimer = setTimeout(flushPendingReads, delay);
}

function flushPendingReads(): void {
  readFlushTimer = null;
  if (pendingReadLine.size === 0) return;

  // Detach the batch before sending. Only lines NEWER than the last confirmed
  // one are worth a request (scrolling up must never re-mark anything).
  const batch = [...pendingReadLine.entries()];
  pendingReadLine.clear();

  for (const [convId, receipt] of batch) {
    if (!isLaterReceipt(receipt, lastSentReadLine.get(convId))) continue;
    lastSentReadLine.set(convId, receipt);
    messengerApi.markRead(convId, receipt.messageId).catch(() => {
      // Drop the confirmed marker so the next attempt is allowed…
      if (sameReceipt(lastSentReadLine.get(convId), receipt)) lastSentReadLine.delete(convId);
      // …and put the line back, so a failed request cannot leave a chat unread
      // until the reader happens to scroll again. A newer line queued in the
      // meantime subsumes this one (the marker is monotonic).
      const pending = pendingReadLine.get(convId);
      if (!pending || isLaterReceipt(receipt, pending)) pendingReadLine.set(convId, receipt);
      scheduleReadFlush(READ_RETRY_DELAY_MS);
    });
  }
}

// ─── Typing indicator auto-clear ────────────────────────────────────────────
const TYPING_TIMEOUT_MS = 5000;
const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
const lastReceiptsLoad = new Map<string, number>(); // convId → timestamp
const RECEIPTS_COOLDOWN_MS = 3000;

// A failed/retried receipt must still leave the page reliably. `keepalive` is
// set on the request itself; pagehide also starts the final pending attempt.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    flushPending();
    flushPendingReads();
  });
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushPending();
      flushPendingReads();
    }
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
  /** Fetches the previous page. With `{ postpone: true }` the page is buffered
   *  instead of inserted — the caller decides when it is safe to show it. */
  loadMoreMessages: (conversationId: string, options?: { postpone?: boolean }) => Promise<void>;
  /** Inserts a buffered page. Call only while the scroller is at rest. */
  flushPendingOlderMessages: (conversationId: string) => boolean;
  /** Sends a message. When `conversationId` is omitted the currently open
   *  conversation is used; the explicit override lets the share sheet send
   *  into a chat without opening the messenger. */
  sendMessage: (content: string, clientId: string, parentMessageId?: string, attachments?: Attachment[], conversationId?: string) => Promise<string>;
  /** Retries every queued message of the signed-in account, oldest first. */
  flushOutbox: () => Promise<void>;
  editMessage: (messageId: string, content: string) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  markRead: (messageId: string) => Promise<void>;
  markDelivered: (messageId: string) => Promise<void>;
  createConversation: (userId: string) => Promise<string | null>;
  ensureNotesConversation: () => Promise<string | null>;
  togglePin: (messageId: string) => Promise<void>;
  /** Toggles my reaction on a message: optimistic chips, then the server's list. */
  toggleReaction: (messageId: string, emoji: string) => Promise<void>;
  /** Folds a peer's reaction delta from the realtime hub into the open chat. */
  applyReactionEvent: (event: ReactionEvent) => void;
  /** The reader played an incoming voice note: drops its "unheard" dot. */
  markVoiceListened: (messageId: string) => Promise<void>;
  /** A peer played a note (realtime): the sender's dot disappears too. */
  applyVoiceListenedEvent: (event: { message_id: string; user_id: string }) => void;
  /** Updates a note's encrypted metadata (pin/folder/tags) and syncs it. */
  setNotesMeta: (messageId: string, meta: NotesMeta) => Promise<void>;
  /** Flips the pin flag of a note. */
  toggleNotesPin: (messageId: string) => Promise<void>;
  /** Mirrors a favorited post/thread into the notes chat as a note. Best-effort
   *  (issue #509); returns the note id, or null on failure. Never disturbs the
   *  currently open chat and never depends on `me` being loaded. */
  createFavoriteNote: (content: string, meta: NotesMeta) => Promise<string | null>;
  /** Removes the note mirroring an unfavorited item, matched by its decrypted
   *  content. Best-effort; never creates a notes chat just to delete. */
  deleteFavoriteNote: (content: string) => Promise<void>;
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
      // Pending messages from the previous session go out as soon as we can,
      // and the triggers for "the network is back" are armed once.
      attachOutboxListeners();
      void get().flushOutbox();

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
    // A full (re)load supersedes any page that was waiting to be shown.
    pendingOlderPages.delete(conversationId);
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
        const queued = ownerId ? await listOutbox(ownerId) : [];
        const view = ownerId
          ? withOutboxEntries(cachedView, queued, conversationId, ownerId)
          : cachedView;
        rememberLatestEventId(conversationId, view);
        set({ messages: view, hasMoreMessages: cachedView.length >= 50 });
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
      const rawMsgs = await decryptNotesMessages(conversationId, raw);
      if (!canApplyMessageLoad(ownerId, conversationId, generation)) return;
      const queued = ownerId ? await listOutbox(ownerId) : [];
      const msgs = ownerId
        ? withOutboxEntries(rawMsgs, queued, conversationId, ownerId)
        : rawMsgs;
      if (ownerId) {
        // A message whose send response was lost is on the server already: the
        // page proves it, so the stale queue entry must not linger forever.
        const confirmed = new Set(rawMsgs.map((m) => m.client_id).filter(Boolean));
        queued
          .filter((entry) => confirmed.has(entry.clientId))
          .forEach((entry) => void deleteOutbox(entry.key));
      }
      set({
        messages: msgs,
        isMessagesLoading: false,
        // Pagination is a property of the server page, not of pending bubbles.
        hasMoreMessages: !notesConversationExists(conversationId) && rawMsgs.length >= 50,
      });
      rememberLatestEventId(conversationId, msgs);
      // Notes content is device-encrypted: never persist it to the IndexedDB
      // cache (the store already holds the readable plaintext).
      // Cache only what the server confirmed: pending bubbles are re-attached
      // from the outbox on the next load.
      if (!notesConversationExists(conversationId)) persistMessages(ownerId, conversationId, rawMsgs);
      // Read marking is owned by MessageList's visibility tracking: only the
      // messages actually on screen get a read receipt (each with its own real
      // read_at). Loading a conversation must not auto-read its whole history.
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
        const messages = mergeMessages(s.messages, delta);
        rememberLatestEventId(conversationId, delta);
        cacheCurrentMessages(ownerId, conversationId, messages);
        return { messages };
      });
    } catch {
      // Reconnect recovery is best effort; polling/full open remains available.
    }
  },

  // ── Load older messages (pagination) ──────────────────────────────────
  // `postpone` fetches the page but leaves it in the buffer instead of writing
  // it into `messages` (see flushPendingOlderMessages). The list uses that so a
  // page can be *requested* early — while the reader is still far from the top
  // — without *inserting* it while they are coasting.
  loadMoreMessages: async (conversationId: string, options?: { postpone?: boolean }) => {
    const postpone = options?.postpone === true;
    const { messages, isLoadingMore } = get();
    if (isLoadingMore || messages.length === 0) return;
    const buffered = postpone ? pendingOlderPages.get(conversationId) : undefined;
    if (postpone && (buffered?.length ?? 0) >= MAX_PENDING_OLDER_MESSAGES) return;
    const generation = messageLoadGeneration;
    const requestGeneration = ++loadMoreRequestGeneration;
    const ownerId = get().me?.id ?? null;

    // With a buffered page already fetched, the cursor is that page's oldest
    // message — `messages` has not moved yet.
    const oldest = buffered?.[0] ?? messages[0];
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
      if (postpone) {
        set({ hasMoreMessages: older.length >= 50, isLoadingMore: false });
        pendingOlderPages.set(conversationId, prependOlder(buffered ?? [], older));
        return;
      }
      set((s) => {
        // Merge older history without duplicates. Pagination is keyed on the
        // oldest message's sent_at (strictly exclusive server-side), but a
        // message that arrived mid-request can still land on both pages — the
        // model dedupes by identity and keeps the copy already on screen (it
        // may carry a local edit/status the re-fetched page lacks).
        const messages = prependOlder(s.messages, older);
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

  // ── Insert a buffered page ────────────────────────────────────────────
  // Returns true when a page was inserted. The caller is the list, and it only
  // calls this at a moment when the scroller is at rest: inserting a page above
  // the viewport shifts the content the reader is looking at, and on iOS the
  // scroll compensation for that shift is deferred until the momentum ends —
  // which is exactly the "thrown thousands of pixels" behaviour.
  flushPendingOlderMessages: (conversationId: string) => {
    const page = pendingOlderPages.get(conversationId);
    if (!page || page.length === 0) return false;
    pendingOlderPages.delete(conversationId);
    if (get().selectedConversationId !== conversationId) return false;
    const ownerId = get().me?.id ?? null;
    set((s) => {
      const messages = prependOlder(s.messages, page);
      rememberLatestEventId(conversationId, messages);
      cacheCurrentMessages(ownerId, conversationId, messages);
      return { messages };
    });
    return true;
  },

  // ── Send message ──────────────────────────────────────────────────────
  sendMessage: async (content: string, clientId: string, parentMessageId?: string, attachments?: Attachment[], conversationId?: string) => {
    const { selectedConversationId } = get();
    const convId = conversationId ?? selectedConversationId;
    if (!convId) return "";

    // Notes: encrypt plaintext locally before it ever leaves the device. The
    // server stores the ciphertext verbatim and never holds the key.
    const isNotes = notesConversationExists(convId);
    let wireContent = content;
    if (isNotes && content.trim()) {
      try {
        wireContent = await encryptNote(content, convId);
      } catch {
        set({ error: "Не удалось зашифровать заметку" });
        return "";
      }
    }

    // Optimistic insert. A retry of the same message must replace its bubble,
    // not stack a second one with the same identity (and the same row key).
    const tempId = `temp_${clientId}`;
    const previous = get().messages.find((m) => m.client_id === clientId);
    const optimistic: MessageView = {
      id: previous?.id ?? tempId,
      conversation_id: convId,
      sender_user_id: get().me!.id,
      parent_message_id: parentMessageId ?? previous?.parent_message_id ?? null,
      content,
      is_edited: false,
      is_deleted: false,
      edited_at: null,
      // Keep the original timestamp so a retried message stays where the reader
      // wrote it instead of jumping under newer replies.
      sent_at: previous?.sent_at ?? new Date().toISOString(),
      client_id: clientId,
      localStatus: "sending",
      ...(((attachments && attachments.length > 0 ? attachments : previous?.attachments) ?? []) as Attachment[]).length > 0
        ? { attachments: (attachments && attachments.length > 0 ? attachments : previous?.attachments)! }
        : {},
    };
    set((s) => {
      // The chat list reflects the message immediately: Telegram shows the
      // pending text there, not the previous one until the server answers.
      const target = s.conversations.find((c) => c.id === convId);
      const previewText = content.trim()
        ? messengerPlainPreview(content, 80)
        : attachments && attachments.length > 0
          ? `📎 ${attachments.length > 1 ? `${attachments.length} файлов` : attachments[0].name}`
          : "";
      const conversations = target
        ? [
            {
              ...target,
              last_message_at: optimistic.sent_at,
              last_message_preview: previewText,
              last_message_sender_id: optimistic.sender_user_id,
              unread_count: 0,
            },
            ...s.conversations.filter((c) => c.id !== convId),
          ]
        : s.conversations;
      // `messages` belongs to the open chat: a background send leaves it alone
      // and lets the realtime echo place the message.
      const isOpen = s.selectedConversationId === convId;
      const messages = !isOpen
        ? s.messages
        : previous
          ? sortBySentAt(s.messages.map((m) => (m.client_id === clientId ? optimistic : m)))
          : mergeMessages(s.messages, [optimistic]);
      return { messages, isSending: true, conversations };
    });

    // Outbox first: the message is the reader's from the moment they pressed
    // send. If the tab dies here, the next launch retries it (Telegram's clock,
    // not a lost message and not a toast).
    const outboxEntry: OutboxEntry = {
      key: outboxKey(get().me?.id ?? "", convId, clientId),
      ownerId: get().me?.id ?? "",
      conversationId: convId,
      content,
      clientId,
      parentMessageId,
      attachments: attachments ?? [],
      createdAt: Date.now(),
      attempts: 0,
      nextAttemptAt: Date.now(),
    };
    await putOutbox(outboxEntry);

    try {
      const msg: MessageView = await messengerApi.sendMessage(
        convId,
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
        const decrypted = await decryptNote(msg.content, convId);
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
        const target = s.conversations.find((c) => c.id === convId);
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
          conversations = [updated, ...s.conversations.filter((c) => c.id !== convId)];
        }
        if (s.selectedConversationId === convId) {
          rememberLatestEventId(convId, messages);
          cacheCurrentMessages(s.me?.id ?? null, convId, messages);
        }
        return { messages, conversations, isSending: false };
      });
      void deleteOutbox(outboxEntry.key);
      return msg.id;
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (isPermanentSendError(status) || OUTBOX_MAX_ATTEMPTS <= 0) {
        // A 400/403/404 will never succeed: the bubble becomes "failed" with a
        // retry button, and the queue forgets it.
        void deleteOutbox(outboxEntry.key);
        set((s) => ({
          messages: s.messages.map((m) =>
            m.client_id === clientId ? { ...m, localStatus: "failed" as const } : m,
          ),
          isSending: false,
          error: "Не удалось отправить сообщение",
        }));
        return "";
      }

      // Network / 5xx / rate limit: stay "sending" (the clock), retry by itself.
      const attempts = outboxEntry.attempts + 1;
      set((s) => ({
        messages: s.messages.map((m) =>
          m.client_id === clientId ? { ...m, localStatus: "sending" as const } : m,
        ),
        isSending: false,
      }));
      await putOutbox({
        ...outboxEntry,
        attempts,
        nextAttemptAt: Date.now() + outboxRetryDelay(attempts),
        lastError: e instanceof Error ? e.message : "network",
      });
      scheduleOutboxFlush(outboxRetryDelay(attempts));
      return "";
    }
  },

  flushOutbox: async () => {
    const { me } = get();
    if (!me || outboxFlushing) return;
    outboxFlushing = true;
    try {
      const pending = (await listOutbox(me.id)).filter((entry) => !entry.gaveUp);
      const now = Date.now();
      // An entry that failed blocks the rest of ITS chat (order is per chat, not
      // global): other conversations must not wait for a dead one.
      const blocked = new Set<string>();

      for (const entry of pending) {
        if (blocked.has(entry.conversationId)) continue;
        if (entry.nextAttemptAt > now) {
          blocked.add(entry.conversationId);
          continue;
        }

        const isNotes = notesConversationExists(entry.conversationId);
        let wireContent = entry.content;
        if (isNotes && entry.content.trim()) {
          try {
            wireContent = await encryptNote(entry.content, entry.conversationId);
          } catch {
            // Cannot encrypt on this device (notes key gone): keep it queued.
            blocked.add(entry.conversationId);
            continue;
          }
        }

        try {
          const msg = await messengerApi.sendMessage(
            entry.conversationId,
            wireContent,
            entry.clientId,
            entry.parentMessageId,
            entry.attachments.length > 0 ? entry.attachments : undefined,
          );
          const displayContent = isNotes
            ? (await decryptNote(msg.content, entry.conversationId)) ?? entry.content
            : msg.content;
          const delivered: MessageView = {
            ...msg,
            content: displayContent,
            attachments: msg.attachments && msg.attachments.length > 0 ? msg.attachments : entry.attachments,
            localStatus: "sent",
          };

          set((s) => {
            const isOpen = s.selectedConversationId === entry.conversationId;
            // The bubble may be missing (the app restarted while the message was
            // queued and the chat was never opened): materialize it on arrival.
            const messages = isOpen
              ? mergeMessages(s.messages, [delivered])
              : s.messages;
            const target = s.conversations.find((c) => c.id === entry.conversationId);
            let conversations = s.conversations;
            if (target) {
              const previewText = entry.content.trim()
                ? messengerPlainPreview(entry.content, 80)
                : entry.attachments.length > 0
                  ? `📎 ${entry.attachments.length > 1 ? `${entry.attachments.length} файлов` : entry.attachments[0].name}`
                  : "";
              conversations = [
                {
                  ...target,
                  last_message_at: msg.sent_at,
                  last_message_preview: previewText,
                  last_message_sender_id: s.me!.id,
                  unread_count: 0,
                },
                ...s.conversations.filter((c) => c.id !== entry.conversationId),
              ];
            }
            // `s.messages` holds the OPEN chat only: caching it under another
            // conversation id would overwrite that chat's history.
            if (isOpen) {
              rememberLatestEventId(entry.conversationId, messages);
              cacheCurrentMessages(s.me?.id ?? null, entry.conversationId, messages);
            }
            return { messages, conversations };
          });
          await deleteOutbox(entry.key);
        } catch (e) {
          const status = (e as { status?: number }).status;
          const attempts = entry.attempts + 1;
          const refused = isPermanentSendError(status);
          if (refused || attempts >= OUTBOX_MAX_ATTEMPTS) {
            // Telegram keeps a refused message in the chat until the reader
            // deletes or resends it — so the entry stays, flagged as given up.
            await putOutbox({
              ...entry,
              attempts,
              gaveUp: true,
              lastError: e instanceof Error ? e.message : "network",
            });
            set((s) => ({
              messages: s.messages.map((m) =>
                m.client_id === entry.clientId && m.conversation_id === entry.conversationId
                  ? { ...m, localStatus: "failed" as const }
                  : m,
              ),
            }));
            continue;
          }
          await putOutbox({
            ...entry,
            attempts,
            nextAttemptAt: Date.now() + outboxRetryDelay(attempts),
            lastError: e instanceof Error ? e.message : "network",
          });
          blocked.add(entry.conversationId);
        }
      }
    } finally {
      outboxFlushing = false;
      void armOutbox();
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
    const { selectedConversationId, me } = get();
    if (!selectedConversationId) return;

    // A queued message has no server row yet: deleting it must drop it from the
    // outbox, otherwise the retry would resurrect it after the bubble is gone.
    const local = get().messages.find(
      (m) => m.id === messageId && (m.localStatus === "sending" || m.localStatus === "failed"),
    );
    if (local?.client_id) {
      if (me) void deleteOutbox(outboxKey(me.id, local.conversation_id, local.client_id));
      set((s) => ({ messages: s.messages.filter((m) => m.id !== messageId) }));
      return;
    }

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

  // ── Reactions ────────────────────────────────────────────────────────
  toggleReaction: async (messageId, emoji) => {
    const { me, selectedConversationId, messages } = get();
    if (!me || !selectedConversationId) return;
    const message = messages.find((entry) => entry.id === messageId);
    if (!message) return;

    // Optimistic: the chip flips under the finger. The server's answer replaces
    // the whole list, so a lost race cannot leave a wrong count behind.
    const before = message.reactions;
    const viewer: ReactionUser = { id: me.id, username: me.username };
    get().updateMessage(messageId, {
      reactions: applyReaction(before, emoji, viewer, "toggle", me.id),
    });
    noteReactionUsed(emoji);

    try {
      const result = await messengerApi.toggleReaction(selectedConversationId, messageId, emoji);
      get().updateMessage(messageId, { reactions: replaceChips(result.reactions) });
    } catch {
      // Silent rollbacks are how the first version of this looked "broken":
      // the chip flipped back and nothing said why.
      get().updateMessage(messageId, { reactions: before });
      toast.error("Не удалось поставить реакцию");
    }
  },

  applyReactionEvent: (event) => {
    const { me, messages } = get();
    const message = messages.find((entry) => entry.id === event.message_id);
    if (!message) return;
    const viewerId = me?.id ?? "";
    const user: ReactionUser = { id: event.user_id, username: event.username };
    get().updateMessage(event.message_id, {
      reactions: applyReaction(message.reactions, event.emoji, user, event.action, viewerId),
    });
  },

  // ── Voice notes ─────────────────────────────────────────────────────
  markVoiceListened: async (messageId) => {
    const { me, selectedConversationId, messages } = get();
    if (!me || !selectedConversationId) return;
    const message = messages.find((entry) => entry.id === messageId);
    if (!message) return;
    const listeners = message.voiceListenedBy ?? [];
    if (listeners.includes(me.id)) return;

    // Optimistic: the dot goes away under the finger, then the server confirms
    // and the peer's device learns about it over the conversation room.
    get().updateMessage(messageId, { voiceListenedBy: [...listeners, me.id] });
    try {
      await messengerApi.markVoiceListened(selectedConversationId, messageId);
    } catch {
      get().updateMessage(messageId, { voiceListenedBy: listeners });
    }
  },

  applyVoiceListenedEvent: (event) => {
    const message = get().messages.find((entry) => entry.id === event.message_id);
    if (!message) return;
    const listeners = message.voiceListenedBy ?? [];
    if (listeners.includes(event.user_id)) return;
    get().updateMessage(event.message_id, { voiceListenedBy: [...listeners, event.user_id] });
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

  // ── Favorite → notes mirror (issue #509) ──────────────────────────────
  // These run in the BACKGROUND, from the feed/wall, where the messenger may
  // not be initialized and a different chat may be open. So they deliberately
  // avoid sendMessage's optimistic insert into `s.messages` (the selected
  // conversation) and never touch `me`.
  createFavoriteNote: async (content, meta) => {
    try {
      const convId = await get().ensureNotesConversation();
      if (!convId) return null;

      // Idempotency: if the notes chat is open and already shows this note
      // (e.g. a WS echo landed first), don't create a second one.
      if (get().selectedConversationId === convId && get().messages.some((m) => m.content === content)) {
        return null;
      }

      // Encrypting is a write, so this may mint the device key on first use —
      // intended for the first favorite note on a fresh device.
      const wireContent = await encryptNote(content, convId);
      const clientId = `fav_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const msg = await messengerApi.sendMessage(convId, wireContent, clientId);

      // Meta is separate from the body: a meta failure must not lose the note.
      try {
        const wireMeta = await encryptNotesMeta(meta, convId);
        await messengerApi.updateNotesMeta(convId, msg.id, wireMeta);
      } catch {
        // Note created without organization meta — leave it visible.
      }

      set((s) => {
        // Only ever touch the OPEN conversation's list — never leak the note
        // into a different chat that happens to be selected.
        if (s.selectedConversationId !== convId) return s;
        if (s.messages.some((m) => m.id === msg.id || m.client_id === clientId)) return s;
        const optimistic: MessageView = {
          ...msg,
          content,
          notesPinned: Boolean(meta.pinned),
          notesFolder: meta.folder?.trim() ? meta.folder.trim() : null,
          notesTags: meta.tags ?? [],
        };
        const messages = [...s.messages, optimistic].sort(
          (a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime(),
        );
        rememberLatestEventId(convId, messages);
        // Notes are device-encrypted — never persisted to IndexedDB.
        return { messages };
      });
      return msg.id;
    } catch {
      return null;
    }
  },

  deleteFavoriteNote: async (content) => {
    try {
      let convId = get().conversations.find((c) => c.is_notes)?.id ?? null;
      if (!convId) {
        // Discover the notes chat without creating it (POST /notes would).
        await get().loadConversations();
        convId = get().conversations.find((c) => c.is_notes)?.id ?? null;
      }
      if (!convId) return;

      // Fast path: the open notes chat already holds decrypted plaintext.
      let messageId: string | null = null;
      if (get().selectedConversationId === convId) {
        const hit = get().messages.find((m) => !m.is_deleted && m.content === content);
        if (hit) messageId = hit.id;
      }

      // Slow path: page through the notes conversation, decrypting as we go.
      if (!messageId) {
        let before: string | undefined;
        for (let page = 0; page < 200; page += 1) {
          const pageRaw = await messengerApi.getMessages(convId, before, undefined, 100);
          if (pageRaw.length === 0) break;
          for (const raw of pageRaw) {
            if (raw.is_deleted) continue;
            if ((await decryptNote(raw.content, convId)) === content) {
              messageId = raw.id;
              break;
            }
          }
          if (messageId) break;
          if (pageRaw.length < 100) break;
          before = pageRaw[0].id;
        }
      }
      if (!messageId) return;

      await messengerApi.deleteMessage(convId, messageId);
      set((s) => {
        if (s.selectedConversationId !== convId) return s;
        return {
          messages: s.messages.map((m) =>
            m.id === messageId ? { ...m, is_deleted: true, content: "" } : m,
          ),
        };
      });
    } catch {
      // Best-effort — the unfavorite already succeeded.
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
    // Invalidate in-flight cache/network responses before switching so a slow
    // previous conversation can never overwrite the newly selected one.
    messageLoadGeneration++;
    loadMoreRequestGeneration++;
    // Flush pending reads/delivered before switching so DB stays in sync
    flushPending();
    flushPendingReads();
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
        // Fast in-order append (no full re-sort); falls back to a merge on
        // clock skew.
        const messages = appendMessages(s.messages, [finalMessage]);
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

/**
 * The boundary of "unread" for a conversation: the newest timestamp that is known
 * to have been read. The local marker wins when it is later than the server's
 * `last_read_at`, because reading advances locally long before the server
 * confirms it. The unread marker is captured from this value when a chat is
 * opened and stays put for that session (Telegram's rule): it belongs to the
 * moment the reader left off, and the next open — with the read line advanced —
 * simply has no marker to place.
 *
 * Returns `null` when nothing is known to be read (everything is unread).
 */
export function getConversationReadThrough(conversationId: string): string | null {
  const local = localReadThrough.get(conversationId) ?? null;
  const fromServer = useMessengerStore.getState().conversations
    .find((c) => c.id === conversationId)?.last_read_at ?? null;
  if (local && fromServer) return Date.parse(local) >= Date.parse(fromServer) ? local : fromServer;
  return local ?? fromServer;
}
