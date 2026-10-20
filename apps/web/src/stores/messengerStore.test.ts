import { describe, it, expect, beforeEach, vi } from "vitest";
import { destroyMessenger, queueMarkRead, useMessengerStore } from "./messengerStore";
import { messengerApi } from "@/services/messengerApi";
import { loadCachedMessages, saveCachedMessages } from "@/utils/messengerCache";
import { listOutbox, outboxKey, putOutbox, __resetOutboxForTests } from "@/components/messenger/core/outbox";
import { encryptNote, encryptNotesMeta } from "@/utils/notesCrypto";
import type { ConversationView, MessageView } from "@/components/messenger/types";

// Mute the API module so we control responses
vi.mock("@/utils/messengerCache", () => ({
  loadCachedMessages: vi.fn().mockResolvedValue(null),
  saveCachedMessages: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/services/messengerApi", () => ({
  messengerApi: {
    getMyProfile: vi.fn(),
    listConversations: vi.fn(),
    getMessages: vi.fn(),
    sendMessage: vi.fn(),
    editMessage: vi.fn(),
    deleteMessage: vi.fn(),
    markRead: vi.fn(),
    markDelivered: vi.fn(),
    getOrCreateConversation: vi.fn(),
    getOrCreateNotes: vi.fn(),
    togglePin: vi.fn(),
    toggleReaction: vi.fn(),
    markVoiceListened: vi.fn(),
    updateNotesMeta: vi.fn(),
    getReceipts: vi.fn(),
    getUnreadCount: vi.fn(),
  },
}));

function mockConv(overrides: Partial<ConversationView> = {}): ConversationView {
  return {
    id: "conv-1",
    last_message_at: "2025-06-01T12:00:00Z",
    last_message_preview: "Hello!",
    last_message_sender_id: "u2",
    pinned_message_id: null,
    updated_at: "2025-06-01T12:00:00Z",
    unread_count: 0,
    is_muted: false,
    other_user_id: "u2",
    other_username: "alice",
    other_avatar_url: null,
    other_account_number: 1001,
    other_is_online: null,
    other_last_seen_at: null,
    is_group: false,
    group_name: null,
    group_avatar_url: null,
    member_count: 2,
    ...overrides,
  };
}

function mockMsg(overrides: Partial<MessageView> = {}): MessageView {
  // `client_id` is the canonical message identity (client_id || id) and the
  // backend enforces UNIQUE(conversation_id, client_id), so the fixture must
  // mint a distinct one per message — a shared constant would make distinct
  // messages collapse into a single row.
  const id = overrides.id ?? "msg-1";
  return {
    id,
    conversation_id: "conv-1",
    sender_user_id: "u1",
    parent_message_id: null,
    content: "Hello!",
    is_edited: false,
    is_deleted: false,
    edited_at: null,
    sent_at: "2025-06-01T12:00:00Z",
    client_id: id,
    ...overrides,
  };
}

describe("messengerStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    destroyMessenger();
    localStorage.clear();
    vi.mocked(loadCachedMessages).mockResolvedValue(null);
    vi.mocked(saveCachedMessages).mockResolvedValue(undefined);
    // loadMessages marks the freshly loaded conversation as read on open.
    vi.mocked(messengerApi.markRead).mockResolvedValue({ ok: true });
    // Reset store to initial state
    useMessengerStore.setState({
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
    });
  });

  describe("init", () => {
    it("loads profile and conversations on init", async () => {
      vi.mocked(messengerApi.getMyProfile).mockResolvedValue({ id: "u1", username: "testuser" });
      vi.mocked(messengerApi.listConversations).mockResolvedValue([mockConv()]);

      await useMessengerStore.getState().init();

      const state = useMessengerStore.getState();
      expect(state.me).toEqual({ id: "u1", username: "testuser" });
      expect(state.conversations).toHaveLength(1);
      expect(state.isInitialLoading).toBe(false);
    });

    it("sets error when profile fetch fails", async () => {
      vi.mocked(messengerApi.getMyProfile).mockRejectedValue(new Error("fail"));

      await useMessengerStore.getState().init();

      const state = useMessengerStore.getState();
      expect(state.error).toBe("Не удалось загрузить профиль");
      expect(state.isInitialLoading).toBe(false);
    });
  });

  describe("loadConversations", () => {
    it("replaces conversations list", async () => {
      vi.mocked(messengerApi.listConversations).mockResolvedValue([mockConv({ id: "conv-a" }), mockConv({ id: "conv-b" })]);

      await useMessengerStore.getState().loadConversations();

      expect(useMessengerStore.getState().conversations).toHaveLength(2);
    });
  });

  describe("loadMessages", () => {
    it("renders cached messages before the network response", async () => {
      const cached = [mockMsg({ id: "cached-1", content: "Offline copy" })];
      vi.mocked(loadCachedMessages).mockResolvedValue(cached);
      vi.mocked(messengerApi.getMessages).mockResolvedValue([mockMsg({ id: "fresh-1", content: "Fresh copy" })]);

      useMessengerStore.setState({ me: { id: "u1", username: "testuser" } });
      await useMessengerStore.getState().loadMessages("conv-1");

      expect(loadCachedMessages).toHaveBeenCalledWith("u1", "conv-1");
      expect(useMessengerStore.getState().messages[0].id).toBe("fresh-1");
      expect(saveCachedMessages).toHaveBeenCalledWith("u1", "conv-1", expect.any(Array));
    });

    it("loads messages and sets loading state", async () => {
      vi.mocked(messengerApi.getMessages).mockResolvedValue([mockMsg(), mockMsg({ id: "msg-2" })]);

      useMessengerStore.setState({ me: { id: "u1", username: "testuser" } });
      await useMessengerStore.getState().loadMessages("conv-1");

      const state = useMessengerStore.getState();
      expect(state.messages).toHaveLength(2);
      expect(state.isMessagesLoading).toBe(false);
    });

    it("does not auto-mark read on open (visibility tracking owns read receipts)", async () => {
      vi.mocked(messengerApi.getMessages).mockResolvedValue([
        mockMsg({ id: "older", sent_at: "2025-06-01T11:00:00Z" }),
        mockMsg({ id: "newest", sent_at: "2025-06-01T12:00:00Z", sender_user_id: "u1" }),
      ]);

      useMessengerStore.setState({ me: { id: "u1", username: "testuser" } });
      await useMessengerStore.getState().loadMessages("conv-1");

      // Read marking is visibility-based (MessageList), so loading a
      // conversation must not auto-read its history.
      expect(messengerApi.markRead).not.toHaveBeenCalled();
    });

    it("keeps a queued message visible after a reload, before the server has it", async () => {
      // The socket died mid-send: the message lives only in the outbox, so the
      // fresh server page does not contain it — it must still open in the chat.
      vi.mocked(messengerApi.getMessages).mockResolvedValue([
        mockMsg({ id: "server-1", content: "старое" }),
      ]);
      await putOutbox({
        key: outboxKey("u1", "conv-1", "client-queued"),
        ownerId: "u1",
        conversationId: "conv-1",
        content: "висит в очереди",
        clientId: "client-queued",
        attachments: [],
        createdAt: Date.parse("2025-06-01T12:05:00Z"),
        attempts: 2,
        nextAttemptAt: Date.now() + 5000,
      });

      useMessengerStore.setState({ me: { id: "u1", username: "testuser" } });
      await useMessengerStore.getState().loadMessages("conv-1");

      const queued = useMessengerStore.getState().messages.find((m) => m.client_id === "client-queued");
      expect(queued?.content).toBe("висит в очереди");
      expect(queued?.localStatus).toBe("sending");
      // The server page is what gets cached; pending mail is re-attached from
      // the outbox instead of being mistaken for history.
      expect(saveCachedMessages).toHaveBeenCalledWith("u1", "conv-1", [expect.objectContaining({ id: "server-1" })]);
    });

    it("renders a given-up message as failed so it can be retried", async () => {
      vi.mocked(messengerApi.getMessages).mockResolvedValue([]);
      await putOutbox({
        key: outboxKey("u1", "conv-1", "client-dead"),
        ownerId: "u1",
        conversationId: "conv-1",
        content: "не ушло",
        clientId: "client-dead",
        attachments: [],
        createdAt: Date.now(),
        attempts: 6,
        nextAttemptAt: 0,
        gaveUp: true,
      });

      useMessengerStore.setState({ me: { id: "u1", username: "testuser" } });
      await useMessengerStore.getState().loadMessages("conv-1");

      expect(useMessengerStore.getState().messages[0].localStatus).toBe("failed");
    });

    it("sets error on failure", async () => {
      vi.mocked(messengerApi.getMessages).mockRejectedValue(new Error("fail"));

      useMessengerStore.setState({ me: { id: "u1", username: "testuser" } });
      await useMessengerStore.getState().loadMessages("conv-1");

      expect(useMessengerStore.getState().error).toBe("Не удалось загрузить сообщения");
      expect(useMessengerStore.getState().isMessagesLoading).toBe(false);
    });
  });

  describe("loadMoreMessages", () => {
    it("prepends older history without duplicates, keeping chronological order", async () => {
      useMessengerStore.setState({
        me: { id: "u1", username: "test" },
        selectedConversationId: "conv-1",
        messages: [
          mockMsg({ id: "m2", sent_at: "2025-06-01T12:00:00Z" }),
          mockMsg({ id: "m3", sent_at: "2025-06-01T13:00:00Z" }),
        ],
      });
      // The paginated page overlaps with an existing message (a message that
      // arrived mid-request). A duplicated key would shift the virtualized
      // item windows and jump the layout while scrolling through history.
      vi.mocked(messengerApi.getMessages).mockResolvedValue([
        mockMsg({ id: "m1", sent_at: "2025-06-01T11:00:00Z" }),
        mockMsg({ id: "m2", sent_at: "2025-06-01T12:00:00Z" }),
      ]);

      await useMessengerStore.getState().loadMoreMessages("conv-1");

      const ids = useMessengerStore.getState().messages.map((m) => m.id);
      expect(ids).toEqual(["m1", "m2", "m3"]);
      expect(useMessengerStore.getState().isLoadingMore).toBe(false);
    });

    it("does nothing when already loading or no messages", async () => {
      useMessengerStore.setState({
        me: { id: "u1", username: "test" },
        selectedConversationId: "conv-1",
        messages: [],
        isLoadingMore: true,
      });

      await useMessengerStore.getState().loadMoreMessages("conv-1");

      expect(messengerApi.getMessages).not.toHaveBeenCalled();
    });

    it("buffers a postponed page instead of inserting it", async () => {
      useMessengerStore.setState({
        me: { id: "u1", username: "test" },
        selectedConversationId: "conv-1",
        messages: [mockMsg({ id: "m3", sent_at: "2025-06-01T13:00:00Z" })],
      });
      vi.mocked(messengerApi.getMessages).mockResolvedValue([
        mockMsg({ id: "m1", sent_at: "2025-06-01T11:00:00Z" }),
        mockMsg({ id: "m2", sent_at: "2025-06-01T12:00:00Z" }),
      ]);

      await useMessengerStore.getState().loadMoreMessages("conv-1", { postpone: true });

      // Nothing was inserted: a page that lands above the viewport moves the
      // content under the reader, and on iOS the compensation for that shift is
      // deferred until the momentum ends.
      expect(useMessengerStore.getState().messages.map((m) => m.id)).toEqual(["m3"]);
      expect(useMessengerStore.getState().isLoadingMore).toBe(false);

      // ...and the list inserts it at the moment it chooses.
      expect(useMessengerStore.getState().flushPendingOlderMessages("conv-1")).toBe(true);
      expect(useMessengerStore.getState().messages.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);

      // The buffer is emptied, so a second flush is a no-op.
      expect(useMessengerStore.getState().flushPendingOlderMessages("conv-1")).toBe(false);
    });

    it("uses the buffered page as the cursor for the next request", async () => {
      useMessengerStore.setState({
        me: { id: "u1", username: "test" },
        selectedConversationId: "conv-1",
        messages: [mockMsg({ id: "m3", sent_at: "2025-06-01T13:00:00Z" })],
      });
      vi.mocked(messengerApi.getMessages).mockResolvedValue([
        mockMsg({ id: "m1", sent_at: "2025-06-01T11:00:00Z" }),
      ]);

      await useMessengerStore.getState().loadMoreMessages("conv-1", { postpone: true });
      await useMessengerStore.getState().loadMoreMessages("conv-1", { postpone: true });

      // The second page is fetched *older* than the buffered one — asking for
      // the same cursor twice would return the same page forever.
      expect(messengerApi.getMessages).toHaveBeenNthCalledWith(1, "conv-1", "m3");
      expect(messengerApi.getMessages).toHaveBeenNthCalledWith(2, "conv-1", "m1");
    });

    it("drops a buffered page when the conversation moves on", async () => {
      useMessengerStore.setState({
        me: { id: "u1", username: "test" },
        selectedConversationId: "conv-1",
        messages: [mockMsg({ id: "m3", sent_at: "2025-06-01T13:00:00Z" })],
      });
      vi.mocked(messengerApi.getMessages).mockResolvedValue([
        mockMsg({ id: "m1", sent_at: "2025-06-01T11:00:00Z" }),
      ]);
      await useMessengerStore.getState().loadMoreMessages("conv-1", { postpone: true });

      // The reader switched chats: the page belongs to the old one and must not
      // be prepended into the new conversation's list.
      useMessengerStore.setState({
        selectedConversationId: "conv-2",
        messages: [mockMsg({ id: "n1", sent_at: "2025-06-01T13:00:00Z" })],
      });
      expect(useMessengerStore.getState().flushPendingOlderMessages("conv-1")).toBe(false);
      expect(useMessengerStore.getState().messages.map((m) => m.id)).toEqual(["n1"]);
    });
  });

  describe("sendMessage", () => {
    it("adds optimistic message then replaces with server response", async () => {
      useMessengerStore.setState({ me: { id: "u1", username: "test" }, selectedConversationId: "conv-1" });
      const sent = mockMsg({ id: "server-id", client_id: "client-abc" });
      vi.mocked(messengerApi.sendMessage).mockResolvedValue(sent);
      vi.mocked(messengerApi.listConversations).mockResolvedValue([]);

      const msgId = await useMessengerStore.getState().sendMessage("Hello!", "client-abc");

      expect(msgId).toBe("server-id");
      const state = useMessengerStore.getState();
      expect(state.messages[0].id).toBe("server-id");
      expect(state.messages[0].localStatus).toBe("sent");
    });

    it("keeps a network failure queued and shows the clock", async () => {
      useMessengerStore.setState({ me: { id: "u1", username: "test" }, selectedConversationId: "conv-1" });
      vi.mocked(messengerApi.sendMessage).mockRejectedValue(new Error("network down"));

      const msgId = await useMessengerStore.getState().sendMessage("Hello!", "client-net");

      expect(msgId).toBe("");
      const state = useMessengerStore.getState();
      // Still the reader's message, still on its way: the outbox retries it.
      expect(state.messages[0].localStatus).toBe("sending");
      expect(state.error).toBeNull();
      const queued = await listOutbox("u1");
      expect(queued.map((entry) => entry.clientId)).toContain("client-net");
    });

    it("marks a permanently refused message as failed and drops it from the queue", async () => {
      useMessengerStore.setState({ me: { id: "u1", username: "test" }, selectedConversationId: "conv-1" });
      const refused = Object.assign(new Error("bad request"), { status: 400 });
      vi.mocked(messengerApi.sendMessage).mockRejectedValue(refused);

      const msgId = await useMessengerStore.getState().sendMessage("Hello!", "client-bad");

      expect(msgId).toBe("");
      const state = useMessengerStore.getState();
      expect(state.messages[0].localStatus).toBe("failed");
      expect(state.error).toBe("Не удалось отправить сообщение");
      expect(await listOutbox("u1")).toHaveLength(0);
    });

    it("flushes a queued message when the network is back", async () => {
      const optimistic = mockMsg({ id: "temp_client-1", client_id: "client-1", localStatus: "sending" });
      useMessengerStore.setState({
        me: { id: "u1", username: "test" },
        selectedConversationId: "conv-1",
        messages: [optimistic],
      });
      await putOutbox({
        key: outboxKey("u1", "conv-1", "client-1"),
        ownerId: "u1",
        conversationId: "conv-1",
        content: "Hello",
        clientId: "client-1",
        attachments: [],
        createdAt: Date.now() - 5000,
        attempts: 0,
        nextAttemptAt: 0,
      });
      vi.mocked(messengerApi.sendMessage).mockResolvedValue(
        mockMsg({ id: "msg-real", client_id: "client-1", content: "Hello" }),
      );

      await useMessengerStore.getState().flushOutbox();

      expect(messengerApi.sendMessage).toHaveBeenCalledTimes(1);
      expect(await listOutbox("u1")).toHaveLength(0);
      expect(useMessengerStore.getState().messages[0].localStatus).toBe("sent");
    });

    it("returns empty if no conversation selected", async () => {
      const msgId = await useMessengerStore.getState().sendMessage("Hello!", "c1");
      expect(msgId).toBe("");
    });
  });

  describe("editMessage", () => {
    it("optimistically updates message content", async () => {
      useMessengerStore.setState({
        selectedConversationId: "conv-1",
        messages: [mockMsg({ id: "msg-1", content: "Old" })],
      });
      vi.mocked(messengerApi.editMessage).mockResolvedValue({ updated: true });

      await useMessengerStore.getState().editMessage("msg-1", "New content");

      const msg = useMessengerStore.getState().messages[0];
      expect(msg.content).toBe("New content");
      expect(msg.is_edited).toBe(true);
    });

    it("sets error on failure", async () => {
      useMessengerStore.setState({ selectedConversationId: "conv-1", messages: [mockMsg()] });
      vi.mocked(messengerApi.editMessage).mockRejectedValue(new Error("fail"));

      await useMessengerStore.getState().editMessage("msg-1", "New");

      expect(useMessengerStore.getState().error).toBe("Не удалось отредактировать сообщение");
    });
  });

  it("drops a queued message from the outbox when the reader deletes it", async () => {
    useMessengerStore.setState({
      me: { id: "u1", username: "test" },
      selectedConversationId: "conv-1",
      messages: [mockMsg({ id: "temp_client-1", client_id: "client-1", localStatus: "sending" })],
    });
    await putOutbox({
      key: outboxKey("u1", "conv-1", "client-1"),
      ownerId: "u1",
      conversationId: "conv-1",
      content: "не хочу",
      clientId: "client-1",
      attachments: [],
      createdAt: Date.now(),
      attempts: 1,
      nextAttemptAt: Date.now(),
    });

    await useMessengerStore.getState().deleteMessage("temp_client-1");
    await Promise.resolve();

    // No server row exists, and the retry must not resurrect the bubble.
    expect(messengerApi.deleteMessage).not.toHaveBeenCalled();
    expect(useMessengerStore.getState().messages).toHaveLength(0);
    expect(await listOutbox("u1")).toHaveLength(0);
  });

  describe("deleteMessage", () => {
    it("marks message as deleted", async () => {
      useMessengerStore.setState({
        selectedConversationId: "conv-1",
        messages: [mockMsg({ id: "msg-1", content: "Hello" })],
      });
      vi.mocked(messengerApi.deleteMessage).mockResolvedValue({ deleted: true });

      await useMessengerStore.getState().deleteMessage("msg-1");

      const msg = useMessengerStore.getState().messages[0];
      expect(msg.is_deleted).toBe(true);
      expect(msg.content).toBe("");
    });
  });

  describe("toggleReaction", () => {
    it("flips my chip optimistically and takes the server's list", async () => {
      useMessengerStore.setState({
        me: { id: "u1", username: "testuser" },
        selectedConversationId: "conv-1",
        messages: [mockMsg({ id: "msg-1", reactions: [] })],
      });
      let release: (value: unknown) => void = () => {};
      vi.mocked(messengerApi.toggleReaction).mockImplementation(
        () => new Promise((resolve) => { release = resolve as (value: unknown) => void; }) as never,
      );

      const pending = useMessengerStore.getState().toggleReaction("msg-1", "❤️");

      // Optimistic: the chip exists before the network answered.
      expect(useMessengerStore.getState().messages[0].reactions).toEqual([
        {
          emoji: "❤️",
          count: 1,
          mine: true,
          users: [{ id: "u1", username: "testuser" }],
          mineAt: expect.any(String),
        },
      ]);

      release({
        message_id: "msg-1",
        action: "add",
        reactions: [
          { emoji: "❤️", count: 2, mine: true, users: [{ id: "u1", username: "testuser" }, { id: "u2", username: "bob" }] },
          { emoji: "🔥", count: 1, mine: false, users: [{ id: "u2", username: "bob" }] },
        ],
      });
      await pending;

      expect(useMessengerStore.getState().messages[0].reactions?.map((c) => c.emoji)).toEqual(["❤️", "🔥"]);
      expect(useMessengerStore.getState().messages[0].reactions?.[0].count).toBe(2);
      expect(localStorage.getItem("gomo6:reactions:recent")).toBe("❤️");
    });

    it("rolls the optimistic chip back when the request fails", async () => {
      useMessengerStore.setState({
        me: { id: "u1", username: "testuser" },
        selectedConversationId: "conv-1",
        messages: [mockMsg({ id: "msg-1", reactions: [] })],
      });
      vi.mocked(messengerApi.toggleReaction).mockRejectedValue(new Error("offline"));

      await useMessengerStore.getState().toggleReaction("msg-1", "🔥");

      expect(useMessengerStore.getState().messages[0].reactions).toEqual([]);
    });

    it("ignores a message that is not in the open chat", async () => {
      useMessengerStore.setState({
        me: { id: "u1", username: "testuser" },
        selectedConversationId: "conv-1",
        messages: [],
      });

      await useMessengerStore.getState().toggleReaction("msg-404", "❤️");

      expect(messengerApi.toggleReaction).not.toHaveBeenCalled();
    });
  });

  describe("voice listened state", () => {
    it("adds me to the listeners optimistically and calls the server", async () => {
      useMessengerStore.setState({
        me: { id: "u1", username: "testuser" },
        selectedConversationId: "conv-1",
        messages: [mockMsg({ id: "msg-1", voiceListenedBy: [] })],
      });
      vi.mocked(messengerApi.markVoiceListened).mockResolvedValue({ listened: true });

      await useMessengerStore.getState().markVoiceListened("msg-1");

      expect(useMessengerStore.getState().messages[0].voiceListenedBy).toEqual(["u1"]);
      expect(messengerApi.markVoiceListened).toHaveBeenCalledWith("conv-1", "msg-1");
    });

    it("rolls the optimistic listener back when the server refuses", async () => {
      useMessengerStore.setState({
        me: { id: "u1", username: "testuser" },
        selectedConversationId: "conv-1",
        messages: [mockMsg({ id: "msg-1", voiceListenedBy: [] })],
      });
      vi.mocked(messengerApi.markVoiceListened).mockRejectedValue(new Error("offline"));

      await useMessengerStore.getState().markVoiceListened("msg-1");

      expect(useMessengerStore.getState().messages[0].voiceListenedBy).toEqual([]);
    });

    it("is idempotent for me and folds a peer's realtime delta", () => {
      useMessengerStore.setState({
        me: { id: "u1", username: "testuser" },
        messages: [mockMsg({ id: "msg-1", voiceListenedBy: ["u1"] })],
      });
      useMessengerStore.getState().applyVoiceListenedEvent({ message_id: "msg-1", user_id: "u1" });
      expect(useMessengerStore.getState().messages[0].voiceListenedBy).toEqual(["u1"]);

      useMessengerStore.getState().applyVoiceListenedEvent({ message_id: "msg-1", user_id: "u2" });
      expect(useMessengerStore.getState().messages[0].voiceListenedBy).toEqual(["u1", "u2"]);
    });
  });

  describe("applyReactionEvent", () => {
    it("folds a peer's delta into the chips", () => {
      useMessengerStore.setState({
        me: { id: "u1", username: "testuser" },
        messages: [mockMsg({ id: "msg-1", reactions: [] })],
      });

      useMessengerStore.getState().applyReactionEvent({
        message_id: "msg-1",
        emoji: "😂",
        user_id: "u2",
        username: "bob",
        action: "add",
      });

      expect(useMessengerStore.getState().messages[0].reactions).toEqual([
        { emoji: "😂", count: 1, mine: false, users: [{ id: "u2", username: "bob" }] },
      ]);
    });

    it("ignores a delta for a message the client does not hold", () => {
      useMessengerStore.setState({ me: { id: "u1", username: "testuser" }, messages: [] });

      useMessengerStore.getState().applyReactionEvent({
        message_id: "msg-404",
        emoji: "❤️",
        user_id: "u2",
        username: "bob",
        action: "add",
      });

      expect(useMessengerStore.getState().messages).toEqual([]);
    });
  });

  describe("markRead", () => {
    it("resets unread_count for conversation", async () => {
      useMessengerStore.setState({
        selectedConversationId: "conv-1",
        conversations: [mockConv({ id: "conv-1", unread_count: 5 })],
      });
      vi.mocked(messengerApi.markRead).mockResolvedValue({ ok: true });

      await useMessengerStore.getState().markRead("msg-1");

      expect(useMessengerStore.getState().conversations[0].unread_count).toBe(0);
    });

    it("collapses a scroll burst into ONE debounced read-line request (newest message)", async () => {
      vi.useFakeTimers();
      try {
        useMessengerStore.setState({
          conversations: [mockConv({ id: "conv-1", unread_count: 2 })],
        });
        vi.mocked(messengerApi.markRead).mockResolvedValue({ ok: true });

        // A single scroll pass reports many visible messages; the backend
        // marks the whole prefix up to the newest one, so only the newest
        // line ever fires a request.
        queueMarkRead("conv-1", "00000000-0000-0000-0000-000000000001", "2025-06-01T12:00:00Z");
        queueMarkRead("conv-1", "00000000-0000-0000-0000-000000000002", "2025-06-01T12:01:00Z");
        // Older line reported again — subsumed by the pending newest line.
        queueMarkRead("conv-1", "00000000-0000-0000-0000-000000000001", "2025-06-01T12:00:00Z");
        // The debounce has not fired yet — nothing was sent.
        expect(messengerApi.markRead).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(500);

        expect(messengerApi.markRead).toHaveBeenCalledTimes(1);
        expect(messengerApi.markRead).toHaveBeenCalledWith(
          "conv-1",
          "00000000-0000-0000-0000-000000000002",
        );
        expect(useMessengerStore.getState().conversations[0].unread_count).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it("retries a failed read line instead of leaving the chat unread", async () => {
      vi.useFakeTimers();
      try {
        useMessengerStore.setState({
          conversations: [mockConv({ id: "conv-1", unread_count: 5 })],
        });
        vi.mocked(messengerApi.markRead).mockRejectedValueOnce(new Error("offline"));

        queueMarkRead("conv-1", "00000000-0000-0000-0000-000000000004", "2025-06-01T12:04:00Z");
        await vi.advanceTimersByTimeAsync(500);
        expect(messengerApi.markRead).toHaveBeenCalledTimes(1);

        // The request failed; the line must come back and be tried again, not be
        // dropped until the reader happens to scroll once more.
        vi.mocked(messengerApi.markRead).mockResolvedValue({ ok: true });
        await vi.advanceTimersByTimeAsync(3500);

        expect(messengerApi.markRead).toHaveBeenCalledTimes(2);
        expect(messengerApi.markRead).toHaveBeenLastCalledWith(
          "conv-1",
          "00000000-0000-0000-0000-000000000004",
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it("never sends a read line older than the last confirmed one (scrolling up)", async () => {
      vi.useFakeTimers();
      try {
        useMessengerStore.setState({
          conversations: [mockConv({ id: "conv-1", unread_count: 2 })],
        });
        vi.mocked(messengerApi.markRead).mockResolvedValue({ ok: true });

        // User is at the bottom — the newest message is the read line.
        queueMarkRead("conv-1", "00000000-0000-0000-0000-000000000005", "2025-06-01T12:05:00Z");
        await vi.advanceTimersByTimeAsync(500);
        expect(messengerApi.markRead).toHaveBeenCalledTimes(1);

        // Scrolling up reveals older messages — they are already covered by
        // the prefix, so no second request may fire.
        queueMarkRead("conv-1", "00000000-0000-0000-0000-000000000003", "2025-06-01T12:03:00Z");
        await vi.advanceTimersByTimeAsync(500);

        expect(messengerApi.markRead).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not touch the store when the read line does not advance (steady-state scroll)", () => {
      useMessengerStore.setState({
        conversations: [mockConv({ id: "conv-1", unread_count: 0 })],
      });
      const conversationsBefore = useMessengerStore.getState().conversations;
      const convBefore = conversationsBefore[0];

      // Same line reported again (scroll events while already read) and an
      // older line (scrolling up) must not create new conversation objects —
      // that used to re-render the whole chat on every scroll event.
      queueMarkRead("conv-1", "00000000-0000-0000-0000-000000000001", "2025-06-01T12:00:00Z");
      queueMarkRead("conv-1", "00000000-0000-0000-0000-000000000001", "2025-06-01T12:00:00Z");
      queueMarkRead("conv-1", "00000000-0000-0000-0000-000000000000", "2025-06-01T11:00:00Z");

      expect(useMessengerStore.getState().conversations).toBe(conversationsBefore);
      expect(useMessengerStore.getState().conversations[0]).toBe(convBefore);
    });

    it("sends a new request when the read line advances further down", async () => {
      vi.useFakeTimers();
      try {
        useMessengerStore.setState({
          conversations: [mockConv({ id: "conv-1", unread_count: 2 })],
        });
        vi.mocked(messengerApi.markRead).mockResolvedValue({ ok: true });

        queueMarkRead("conv-1", "00000000-0000-0000-0000-000000000001", "2025-06-01T12:00:00Z");
        await vi.advanceTimersByTimeAsync(500);
        // The user keeps scrolling down — the line advances, one more request.
        queueMarkRead("conv-1", "00000000-0000-0000-0000-000000000002", "2025-06-01T12:01:00Z");
        await vi.advanceTimersByTimeAsync(500);

        expect(messengerApi.markRead).toHaveBeenCalledTimes(2);
        expect(messengerApi.markRead).toHaveBeenNthCalledWith(
          1,
          "conv-1",
          "00000000-0000-0000-0000-000000000001",
        );
        expect(messengerApi.markRead).toHaveBeenNthCalledWith(
          2,
          "conv-1",
          "00000000-0000-0000-0000-000000000002",
        );
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("createConversation", () => {
    it("creates conversation and refreshes list", async () => {
      vi.mocked(messengerApi.getOrCreateConversation).mockResolvedValue({ conversation_id: "conv-new" });
      vi.mocked(messengerApi.listConversations).mockResolvedValue([mockConv({ id: "conv-new" })]);

      const id = await useMessengerStore.getState().createConversation("u2");

      expect(id).toBe("conv-new");
    });

    it("returns null on failure", async () => {
      vi.mocked(messengerApi.getOrCreateConversation).mockRejectedValue(new Error("fail"));

      const id = await useMessengerStore.getState().createConversation("u2");

      expect(id).toBeNull();
      expect(useMessengerStore.getState().error).toBe("Не удалось открыть диалог");
    });
  });

  describe("notes (E2E self-chat)", () => {
    function notesConv(): ConversationView {
      return mockConv({
        id: "notes-1",
        is_notes: true,
        other_user_id: null,
        other_username: "",
        member_count: 1,
        last_message_preview: null,
      });
    }

    it("creates the notes conversation via API", async () => {
      vi.mocked(messengerApi.getOrCreateNotes).mockResolvedValue({ conversation_id: "notes-1" });
      vi.mocked(messengerApi.listConversations).mockResolvedValue([notesConv()]);

      const id = await useMessengerStore.getState().ensureNotesConversation();

      expect(id).toBe("notes-1");
      expect(useMessengerStore.getState().conversations[0].is_notes).toBe(true);
    });

    it("encrypts content before sending and decrypts the echoed ciphertext", async () => {
      useMessengerStore.setState({
        me: { id: "u1", username: "test" },
        selectedConversationId: "notes-1",
        conversations: [notesConv()],
      });
      // The server echoes the client ciphertext verbatim (it cannot decrypt it).
      vi.mocked(messengerApi.sendMessage).mockImplementation(
        async (_convId, content) => mockMsg({ id: "server-id", client_id: "c-notes", content }),
      );
      vi.mocked(messengerApi.listConversations).mockResolvedValue([]);

      const msgId = await useMessengerStore.getState().sendMessage("Моя секретная заметка", "c-notes");

      expect(msgId).toBe("server-id");
      const wireContent = vi.mocked(messengerApi.sendMessage).mock.calls[0]![1];
      // Only ciphertext may leave the device.
      expect(wireContent.startsWith("e2enote1:")).toBe(true);
      expect(wireContent.includes("секретная")).toBe(false);
      // The store shows the readable plaintext.
      expect(useMessengerStore.getState().messages[0].content).toBe("Моя секретная заметка");
    });

    it("decrypts notes messages on load", async () => {
      useMessengerStore.setState({
        me: { id: "u1", username: "test" },
        selectedConversationId: "notes-1",
        conversations: [notesConv()],
      });
      const payload = await encryptNote("старая заметка", "notes-1");
      vi.mocked(messengerApi.getMessages).mockResolvedValue([mockMsg({ id: "msg-n", content: payload })]);

      await useMessengerStore.getState().loadMessages("notes-1");

      expect(useMessengerStore.getState().messages[0].content).toBe("старая заметка");
    });

    it("decrypts notes metadata (pin/folder/tags) on load", async () => {
      useMessengerStore.setState({
        me: { id: "u1", username: "test" },
        selectedConversationId: "notes-1",
        conversations: [notesConv()],
      });
      const payload = await encryptNote("заметка с папкой", "notes-1");
      const metaPayload = await encryptNotesMeta(
        { pinned: true, folder: "Идеи", tags: ["важно", "работа"] },
        "notes-1",
      );
      vi.mocked(messengerApi.getMessages).mockResolvedValue([
        mockMsg({ id: "msg-n", content: payload, notes_meta: metaPayload }),
      ]);

      await useMessengerStore.getState().loadMessages("notes-1");

      const msg = useMessengerStore.getState().messages[0];
      expect(msg.content).toBe("заметка с папкой");
      expect(msg.notesPinned).toBe(true);
      expect(msg.notesFolder).toBe("Идеи");
      expect(msg.notesTags).toEqual(["важно", "работа"]);
    });

    it("setNotesMeta encrypts metadata and syncs it, updating state optimistically", async () => {
      useMessengerStore.setState({
        me: { id: "u1", username: "test" },
        selectedConversationId: "notes-1",
        conversations: [notesConv()],
        messages: [mockMsg({ id: "msg-n", content: "заметка" })],
      });
      vi.mocked(messengerApi.updateNotesMeta).mockResolvedValue({ updated: true });

      await useMessengerStore.getState().setNotesMeta("msg-n", {
        pinned: true,
        folder: "Идеи",
        tags: ["важно"],
      });

      const msg = useMessengerStore.getState().messages[0];
      expect(msg.notesPinned).toBe(true);
      expect(msg.notesFolder).toBe("Идеи");
      expect(msg.notesTags).toEqual(["важно"]);
      // Only ciphertext may leave the device — folder names never appear.
      const wire = vi.mocked(messengerApi.updateNotesMeta).mock.calls[0]![2];
      expect(wire.startsWith("e2enote1:")).toBe(true);
      expect(wire.includes("Идеи")).toBe(false);
      expect(wire.includes("важно")).toBe(false);
    });

    it("setNotesMeta reverts the optimistic update on failure", async () => {
      useMessengerStore.setState({
        me: { id: "u1", username: "test" },
        selectedConversationId: "notes-1",
        conversations: [notesConv()],
        messages: [mockMsg({ id: "msg-n", content: "заметка", notesFolder: "Старое" })],
      });
      vi.mocked(messengerApi.updateNotesMeta).mockRejectedValue(new Error("fail"));

      await useMessengerStore.getState().setNotesMeta("msg-n", { pinned: false, folder: "Новое" });

      const msg = useMessengerStore.getState().messages[0];
      expect(msg.notesFolder).toBe("Старое");
      expect(useMessengerStore.getState().error).toBe("Не удалось сохранить настройки заметки");
    });

    it("toggleNotesPin flips the pin flag", async () => {
      useMessengerStore.setState({
        me: { id: "u1", username: "test" },
        selectedConversationId: "notes-1",
        conversations: [notesConv()],
        messages: [mockMsg({ id: "msg-n", content: "заметка", notesPinned: false })],
      });
      vi.mocked(messengerApi.updateNotesMeta).mockResolvedValue({ updated: true });

      await useMessengerStore.getState().toggleNotesPin("msg-n");

      expect(useMessengerStore.getState().messages[0].notesPinned).toBe(true);
      const wire = vi.mocked(messengerApi.updateNotesMeta).mock.calls[0]![2];
      expect(wire.startsWith("e2enote1:")).toBe(true);
    });

    // ── favorite → notes mirror (issue #509) ──────────────────────────────
    describe("favorite notes", () => {
      const CONTENT = "__SHARE__:thread:t-1";

      it("creates an encrypted note in the notes chat with folder/tags meta", async () => {
        vi.mocked(messengerApi.getOrCreateNotes).mockResolvedValue({ conversation_id: "notes-1" });
        vi.mocked(messengerApi.listConversations).mockResolvedValue([notesConv()]);
        vi.mocked(messengerApi.sendMessage).mockImplementation(
          async (_convId, content) => mockMsg({ id: "fav-1", client_id: "fav", content }),
        );
        vi.mocked(messengerApi.updateNotesMeta).mockResolvedValue({ updated: true });

        const id = await useMessengerStore.getState().createFavoriteNote(CONTENT, {
          folder: "Избранное",
          tags: ["тема"],
        });

        expect(id).toBe("fav-1");
        // The note body leaves the device only as ciphertext.
        const wire = vi.mocked(messengerApi.sendMessage).mock.calls[0]![1];
        expect(wire.startsWith("e2enote1:")).toBe(true);
        expect(wire.includes("__SHARE__")).toBe(false);
        // Meta is written to the created note, also encrypted.
        const meta = vi.mocked(messengerApi.updateNotesMeta).mock.calls[0]![2];
        expect(meta.startsWith("e2enote1:")).toBe(true);
      });

      it("does not leak the note into a different open conversation", async () => {
        useMessengerStore.setState({
          selectedConversationId: "conv-other",
          conversations: [mockConv({ id: "conv-other" })],
          messages: [mockMsg({ id: "other-1", conversation_id: "conv-other" })],
        });
        vi.mocked(messengerApi.getOrCreateNotes).mockResolvedValue({ conversation_id: "notes-1" });
        vi.mocked(messengerApi.listConversations).mockResolvedValue([mockConv({ id: "conv-other" }), notesConv()]);
        vi.mocked(messengerApi.sendMessage).mockImplementation(
          async (_convId, content) => mockMsg({ id: "fav-1", client_id: "fav", content }),
        );
        vi.mocked(messengerApi.updateNotesMeta).mockResolvedValue({ updated: true });

        await useMessengerStore.getState().createFavoriteNote(CONTENT, { folder: "Избранное", tags: ["тема"] });

        // The open (non-notes) chat is untouched.
        const messages = useMessengerStore.getState().messages;
        expect(messages).toHaveLength(1);
        expect(messages[0].id).toBe("other-1");
      });

      it("inserts the note into the open notes chat and skips a duplicate", async () => {
        useMessengerStore.setState({
          selectedConversationId: "notes-1",
          conversations: [notesConv()],
          messages: [],
        });
        vi.mocked(messengerApi.getOrCreateNotes).mockResolvedValue({ conversation_id: "notes-1" });
        vi.mocked(messengerApi.listConversations).mockResolvedValue([notesConv()]);
        vi.mocked(messengerApi.sendMessage).mockImplementation(
          async (_convId, content) => mockMsg({ id: "fav-1", client_id: "fav", content }),
        );
        vi.mocked(messengerApi.updateNotesMeta).mockResolvedValue({ updated: true });

        await useMessengerStore.getState().createFavoriteNote(CONTENT, { folder: "Избранное", tags: ["тема"] });

        const msg = useMessengerStore.getState().messages[0];
        expect(msg.id).toBe("fav-1");
        expect(msg.content).toBe(CONTENT);
        expect(msg.notesFolder).toBe("Избранное");
        expect(msg.notesTags).toEqual(["тема"]);

        // Second call for the same item must not create another note.
        await useMessengerStore.getState().createFavoriteNote(CONTENT, { folder: "Избранное", tags: ["тема"] });
        expect(useMessengerStore.getState().messages).toHaveLength(1);
        expect(messengerApi.sendMessage).toHaveBeenCalledTimes(1);
      });

      it("deletes a favorite note matched by decrypted content", async () => {
        useMessengerStore.setState({
          selectedConversationId: "conv-other",
          conversations: [mockConv({ id: "conv-other" }), notesConv()],
          messages: [],
        });
        const payload = await encryptNote(CONTENT, "notes-1");
        const other = await encryptNote("другая заметка", "notes-1");
        vi.mocked(messengerApi.getMessages).mockResolvedValue([
          mockMsg({ id: "m-other", content: other }),
          mockMsg({ id: "m-fav", content: payload }),
        ]);
        vi.mocked(messengerApi.deleteMessage).mockResolvedValue({ deleted: true });

        await useMessengerStore.getState().deleteFavoriteNote(CONTENT);

        expect(messengerApi.deleteMessage).toHaveBeenCalledWith("notes-1", "m-fav");
      });

      it("does not create a notes chat when deleting and none exists", async () => {
        useMessengerStore.setState({ conversations: [mockConv({ id: "conv-other" })], messages: [] });
        vi.mocked(messengerApi.listConversations).mockResolvedValue([mockConv({ id: "conv-other" })]);

        await useMessengerStore.getState().deleteFavoriteNote(CONTENT);

        expect(messengerApi.getOrCreateNotes).not.toHaveBeenCalled();
        expect(messengerApi.deleteMessage).not.toHaveBeenCalled();
      });

      it("no-ops delete when no note matches", async () => {
        useMessengerStore.setState({ conversations: [notesConv()], messages: [] });
        const other = await encryptNote("чужое", "notes-1");
        vi.mocked(messengerApi.getMessages).mockResolvedValue([mockMsg({ id: "m-other", content: other })]);

        await useMessengerStore.getState().deleteFavoriteNote(CONTENT);

        expect(messengerApi.deleteMessage).not.toHaveBeenCalled();
      });
    });
  });

  describe("local actions", () => {
    it("addMessage inserts and deduplicates", () => {
      const msg = mockMsg({ id: "msg-1" });
      useMessengerStore.getState().addMessage(msg);
      useMessengerStore.getState().addMessage(msg); // should be deduplicated

      expect(useMessengerStore.getState().messages).toHaveLength(1);
    });

    it("addMessage sorts by sent_at", () => {
      const older = mockMsg({ id: "older", sent_at: "2025-01-01T00:00:00Z", client_id: "cold" });
      const newer = mockMsg({ id: "newer", sent_at: "2025-06-01T00:00:00Z", client_id: "cnew" });

      useMessengerStore.getState().addMessage(newer);
      useMessengerStore.getState().addMessage(older);

      const ids = useMessengerStore.getState().messages.map((m) => m.id);
      expect(ids).toEqual(["older", "newer"]);
    });

    it("updateMessage modifies a message in place", () => {
      useMessengerStore.setState({ messages: [mockMsg({ id: "msg-1", content: "old" })] });

      useMessengerStore.getState().updateMessage("msg-1", { content: "new", is_edited: true });

      const msg = useMessengerStore.getState().messages[0];
      expect(msg.content).toBe("new");
      expect(msg.is_edited).toBe(true);
    });

    it("removeMessage marks as deleted", () => {
      useMessengerStore.setState({ messages: [mockMsg({ id: "msg-1" })] });

      useMessengerStore.getState().removeMessage("msg-1");

      const msg = useMessengerStore.getState().messages[0];
      expect(msg.is_deleted).toBe(true);
    });

    it("setTyping adds and removes typing users", () => {
      useMessengerStore.getState().setTyping("u2", "alice", true);
      expect(useMessengerStore.getState().typingUsers["u2"]).toBeDefined();
      expect(useMessengerStore.getState().typingUsers["u2"].is_typing).toBe(true);

      useMessengerStore.getState().setTyping("u2", "alice", false);
      expect(useMessengerStore.getState().typingUsers["u2"]).toBeUndefined();
    });

    it("setUserPresence patches the matching 1:1 conversation and onlineUsers", () => {
      useMessengerStore.setState({
        conversations: [
          mockConv({ id: "conv-1", other_user_id: "u2", other_is_online: null, other_last_seen_at: null }),
          mockConv({ id: "conv-group", is_group: true, other_user_id: null }),
          mockConv({ id: "notes", is_notes: true, other_user_id: null }),
        ],
      });

      useMessengerStore.getState().setUserPresence("u2", true, "2025-06-01T12:00:00Z");

      expect(useMessengerStore.getState().onlineUsers.has("u2")).toBe(true);
      const conv = useMessengerStore.getState().conversations.find((c) => c.id === "conv-1")!;
      expect(conv.other_is_online).toBe(true);
      expect(conv.other_last_seen_at).toBe("2025-06-01T12:00:00Z");
      // Groups and notes conversations are never touched.
      expect(useMessengerStore.getState().conversations.find((c) => c.id === "conv-group")!.other_is_online).toBeNull();
      expect(useMessengerStore.getState().conversations.find((c) => c.id === "notes")!.other_is_online).toBeNull();
    });

    it("setUserPresence offline keeps the last known last_seen when the delta has none", () => {
      useMessengerStore.setState({
        conversations: [
          mockConv({ id: "conv-1", other_user_id: "u2", other_is_online: true, other_last_seen_at: "2025-06-01T12:00:00Z" }),
        ],
      });

      useMessengerStore.getState().setUserPresence("u2", false);

      const conv = useMessengerStore.getState().conversations.find((c) => c.id === "conv-1")!;
      expect(conv.other_is_online).toBe(false);
      expect(conv.other_last_seen_at).toBe("2025-06-01T12:00:00Z");
      expect(useMessengerStore.getState().onlineUsers.has("u2")).toBe(false);
    });

    it("updateConversationFromWs updates conversation fields", () => {
      useMessengerStore.setState({ conversations: [mockConv({ id: "conv-1", unread_count: 0 })] });

      useMessengerStore.getState().updateConversationFromWs("conv-1", {
        last_message_preview: "New message",
        unread_count: 1,
      });

      const c = useMessengerStore.getState().conversations[0];
      expect(c.last_message_preview).toBe("New message");
      expect(c.unread_count).toBe(1);
    });

    it("updateConversationFromWs strips BBCode from the preview", () => {
      useMessengerStore.setState({ conversations: [mockConv({ id: "conv-1", unread_count: 0 })] });

      // The server truncates the raw wire text to 80 chars — tags and even
      // mid-tag cuts must never leak into the conversation list.
      useMessengerStore.getState().updateConversationFromWs("conv-1", {
        last_message_preview: "[b]Привет[/b] [e:abc123] как дела [col=#ff00",
      });

      const c = useMessengerStore.getState().conversations[0];
      expect(c.last_message_preview).toBe("Привет как дела");
    });
  });

  describe("computed", () => {
    it("selectedConversation returns the active conversation", () => {
      useMessengerStore.setState({
        conversations: [mockConv({ id: "conv-1" }), mockConv({ id: "conv-2" })],
        selectedConversationId: "conv-2",
      });

      const selected = useMessengerStore.getState().selectedConversation();
      expect(selected?.id).toBe("conv-2");
    });

    it("selectedConversation returns null when none selected", () => {
      useMessengerStore.setState({
        conversations: [mockConv()],
        selectedConversationId: null,
      });

      expect(useMessengerStore.getState().selectedConversation()).toBeNull();
    });

    it("totalUnread sums all unread counts", () => {
      useMessengerStore.setState({
        conversations: [
          mockConv({ id: "a", unread_count: 3 }),
          mockConv({ id: "b", unread_count: 0 }),
          mockConv({ id: "c", unread_count: 7 }),
        ],
      });

      expect(useMessengerStore.getState().totalUnread()).toBe(10);
    });

    it("totalUnread returns 0 with no conversations", () => {
      useMessengerStore.setState({ conversations: [] });
      expect(useMessengerStore.getState().totalUnread()).toBe(0);
    });
  });
});
