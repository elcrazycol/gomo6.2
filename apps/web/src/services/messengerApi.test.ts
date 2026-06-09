import { describe, it, expect, vi, beforeEach } from "vitest";
import { messengerApi } from "./messengerApi";

const TEST_TOKEN = "test-token-abc";

describe("messengerApi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("auth_token", TEST_TOKEN);
    global.fetch = vi.fn();
  });

  function mockFetch(data: unknown, status = 200) {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({ success: status < 400, data, error: status >= 400 ? "test error" : undefined }),
    } as Response);
  }

  function mockFetchRaw(response: unknown, status = 200) {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      json: async () => response,
    } as Response);
  }

  describe("getMyProfile", () => {
    it("returns profile data", async () => {
      mockFetchRaw({ user: { id: "u1", username: "test" } });
      const profile = await messengerApi.getMyProfile();
      expect(profile).toEqual({ id: "u1", username: "test" });
    });

    it("throws on server error", async () => {
      mockFetchRaw({ error: "Unauthorized" }, 401);
      await expect(messengerApi.getMyProfile()).rejects.toThrow();
    });
  });

  describe("listConversations", () => {
    it("returns conversation list", async () => {
      const convs = [{ id: "c1", other_username: "alice" }];
      mockFetch(convs);
      const result = await messengerApi.listConversations();
      expect(result).toEqual(convs);
    });
  });

  describe("getOrCreateConversation", () => {
    it("returns conversation_id", async () => {
      mockFetch({ conversation_id: "conv-new" });
      const result = await messengerApi.getOrCreateConversation("u2");
      expect(result).toEqual({ conversation_id: "conv-new" });

      // Check correct fetch was called
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/v1/messenger/conversations",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ user_id: "u2" }),
        }),
      );
    });
  });

  describe("getMessages", () => {
    it("returns messages list", async () => {
      const msgs = [{ id: "m1", content: "Hello" }];
      mockFetch(msgs);
      const result = await messengerApi.getMessages("conv-1");
      expect(result).toEqual(msgs);
    });

    it("passes before query param", async () => {
      mockFetch([]);
      await messengerApi.getMessages("conv-1", "msg-5");
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/v1/messenger/conversations/conv-1/messages?before=msg-5",
        expect.any(Object),
      );
    });
  });

  describe("sendMessage", () => {
    it("posts message and returns result", async () => {
      const msg = { id: "m1", conversation_id: "conv-1", content: "Hello", client_id: "c1" };
      mockFetch(msg);
      const result = await messengerApi.sendMessage("conv-1", "Hello", "c1");

      expect(result).toEqual(msg);
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/v1/messenger/conversations/conv-1/messages",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ content: "Hello", client_id: "c1" }),
        }),
      );
    });
  });

  describe("editMessage", () => {
    it("puts edit and returns result", async () => {
      mockFetch({ updated: true });
      const result = await messengerApi.editMessage("conv-1", "msg-1", "New text");

      expect(result).toEqual({ updated: true });
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/v1/messenger/conversations/conv-1/messages/msg-1",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ content: "New text" }),
        }),
      );
    });
  });

  describe("deleteMessage", () => {
    it("sends DELETE and returns result", async () => {
      mockFetch({ deleted: true });
      const result = await messengerApi.deleteMessage("conv-1", "msg-1");

      expect(result).toEqual({ deleted: true });
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/v1/messenger/conversations/conv-1/messages/msg-1",
        expect.objectContaining({ method: "DELETE" }),
      );
    });
  });

  describe("markRead", () => {
    it("posts read marker", async () => {
      mockFetch({ ok: true });
      const result = await messengerApi.markRead("conv-1", "msg-1");

      expect(result).toEqual({ ok: true });
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/v1/messenger/conversations/conv-1/read",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ message_id: "msg-1" }),
        }),
      );
    });
  });

  describe("markDelivered", () => {
    it("posts delivered marker", async () => {
      mockFetch({ ok: true });
      const result = await messengerApi.markDelivered("conv-1", "msg-1");

      expect(result).toEqual({ ok: true });
    });
  });

  describe("getReceipts", () => {
    it("returns receipts list", async () => {
      const receipts = [{ message_id: "m1", user_id: "u1", delivered_at: "2025-01-01T00:00:00Z", read_at: null }];
      mockFetch(receipts);
      const result = await messengerApi.getReceipts("conv-1");
      expect(result).toEqual(receipts);
    });
  });

  describe("togglePin", () => {
    it("returns pin state", async () => {
      mockFetch({ pinned_message_id: "msg-1" });
      const result = await messengerApi.togglePin("conv-1", "msg-1");
      expect(result).toEqual({ pinned_message_id: "msg-1" });
    });
  });

  describe("getUnreadCount", () => {
    it("returns unread count", async () => {
      mockFetch({ unread_count: 7 });
      const result = await messengerApi.getUnreadCount();
      expect(result).toEqual({ unread_count: 7 });
    });
  });

  describe("error handling", () => {
    it("throws on non-ok response", async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: "Server error" }),
      } as Response);

      await expect(messengerApi.listConversations()).rejects.toThrow("Server error");
    });

    it("throws generic error when no error message", async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}),
      } as Response);

      await expect(messengerApi.listConversations()).rejects.toThrow("HTTP 500");
    });

    it("includes auth token in headers", async () => {
      mockFetch([]);
      await messengerApi.listConversations();

      const callArgs = vi.mocked(global.fetch).mock.calls[0];
      expect(callArgs[1]?.headers).toEqual(
        expect.objectContaining({ Authorization: `Bearer ${TEST_TOKEN}` }),
      );
    });
  });
});
