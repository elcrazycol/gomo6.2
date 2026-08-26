import { describe, it, expect, beforeEach, vi } from "vitest";
import { destroyMessenger, queueMarkRead, useMessengerStore } from "./messengerStore";
import { messengerApi } from "@/services/messengerApi";
import { loadCachedMessages, saveCachedMessages } from "@/utils/messengerCache";
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
  return {
    id: "msg-1",
    conversation_id: "conv-1",
    sender_user_id: "u1",
    parent_message_id: null,
    content: "Hello!",
    is_edited: false,
    is_deleted: false,
    edited_at: null,
    sent_at: "2025-06-01T12:00:00Z",
    client_id: "c1",
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

    it("marks optimistic message as failed on error", async () => {
      useMessengerStore.setState({ me: { id: "u1", username: "test" }, selectedConversationId: "conv-1" });
      vi.mocked(messengerApi.sendMessage).mockRejectedValue(new Error("fail"));

      const msgId = await useMessengerStore.getState().sendMessage("Hello!", "client-fail");

      expect(msgId).toBe("");
      const state = useMessengerStore.getState();
      expect(state.messages[0].localStatus).toBe("failed");
      expect(state.error).toBe("Не удалось отправить сообщение");
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
