import { describe, it, expect, beforeEach, vi } from "vitest";
import { useMessengerStore } from "./messengerStore";
import { messengerApi } from "@/services/messengerApi";
import type { ConversationView, MessageView } from "@/components/messenger/types";

// Mute the API module so we control responses
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
    togglePin: vi.fn(),
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
    other_user_id: "u2",
    other_username: "alice",
    other_avatar_url: null,
    other_account_number: 1001,
    other_is_online: null,
    other_last_seen_at: null,
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
    // Reset store to initial state
    useMessengerStore.setState({
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
    it("loads messages and sets loading state", async () => {
      vi.mocked(messengerApi.getMessages).mockResolvedValue([mockMsg(), mockMsg({ id: "msg-2" })]);

      await useMessengerStore.getState().loadMessages("conv-1");

      const state = useMessengerStore.getState();
      expect(state.messages).toHaveLength(2);
      expect(state.isMessagesLoading).toBe(false);
    });

    it("sets error on failure", async () => {
      vi.mocked(messengerApi.getMessages).mockRejectedValue(new Error("fail"));

      await useMessengerStore.getState().loadMessages("conv-1");

      expect(useMessengerStore.getState().error).toBe("Не удалось загрузить сообщения");
      expect(useMessengerStore.getState().isMessagesLoading).toBe(false);
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

    it("setUserOnline tracks online status", () => {
      useMessengerStore.getState().setUserOnline("u2", true);
      expect(useMessengerStore.getState().onlineUsers.has("u2")).toBe(true);

      useMessengerStore.getState().setUserOnline("u2", false);
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
