import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { messengerApi } from "./messengerApi";
import { apiClient } from "@/integrations/api/client";

const TEST_TOKEN = "test-token-abc";

describe("messengerApi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiClient.setToken(TEST_TOKEN);
    global.fetch = vi.fn();
  });

  function mockFetch(data: unknown, status = 200) {
    const body = JSON.stringify({ success: status < 400, data, error: status >= 400 ? "test error" : undefined });
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ "Content-Type": "application/json" }),
      // Real Response exposes both text() and json(); the API client reads
      // text() first and parses it, so mocks must provide it too.
      text: async () => body,
      json: async () => JSON.parse(body),
    } as Response);
  }

  function mockFetchRaw(response: unknown, status = 200) {
    const body = JSON.stringify(response);
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ "Content-Type": "application/json" }),
      text: async () => body,
      json: async () => response,
    } as Response);
  }

  describe("toggleReaction", () => {
    it("posts the emoji and returns the message's chips", async () => {
      mockFetchRaw({
        success: true,
        data: {
          message_id: "msg-1",
          action: "add",
          reactions: [{ emoji: "❤️", count: 1, mine: true, users: [{ id: "u1", username: "me" }] }],
        },
      });

      const result = await messengerApi.toggleReaction("conv-1", "msg-1", "❤️");

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/v1/messenger/conversations/conv-1/messages/msg-1/reactions",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ emoji: "❤️" }) }),
      );
      expect(result.action).toBe("add");
      expect(result.reactions).toHaveLength(1);
      expect(result.reactions[0].mine).toBe(true);
    });

    it("surfaces the server's refusal (too many reactions)", async () => {
      mockFetch({}, 409);

      await expect(messengerApi.toggleReaction("conv-1", "msg-1", "❤️")).rejects.toThrow();
    });
  });

  describe("getMyProfile", () => {
    // getCurrentUser caches for 30s across tests in this file: move the fake
    // clock monotonically forward so every case starts expired (fake Date
    // only — real timers keep the retry/backoff paths honest).
    let fakeNow = 0;
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      if (!fakeNow) fakeNow = Date.now();
      fakeNow += 31_000;
      vi.setSystemTime(fakeNow);
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("returns profile data", async () => {
      mockFetchRaw({ success: true, data: { id: "u1", username: "test" } });
      const profile = await messengerApi.getMyProfile();
      expect(profile).toEqual({ id: "u1", username: "test" });
    });

    it("shares one request between concurrent callers", async () => {
      mockFetchRaw({ success: true, data: { id: "u1", username: "test" } });
      const [a, b] = await Promise.all([
        messengerApi.getMyProfile(),
        messengerApi.getMyProfile(),
      ]);
      expect(a).toEqual({ id: "u1", username: "test" });
      expect(b).toEqual({ id: "u1", username: "test" });
      expect(vi.mocked(global.fetch).mock.calls.filter(([url]) => String(url).includes("/api/v1/auth/me"))).toHaveLength(1);
    });

    it("throws not authenticated when logged out", async () => {
      apiClient.clearTokens();
      await expect(messengerApi.getMyProfile()).rejects.toThrow("not authenticated");
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

    it("passes since_event_id query param", async () => {
      mockFetch([]);
      await messengerApi.getMessages("conv-1", undefined, "42");
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/v1/messenger/conversations/conv-1/messages?since_event_id=42",
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

  describe("E2E key directory", () => {
    it("publishes a device key", async () => {
      mockFetch({ user_id: "u1", device_id: "d1", public_key: "k", alg: "p256-aesgcm", updated_at: "2025-01-01T00:00:00Z" });
      const result = await messengerApi.putDeviceKey("d1", "k");
      expect(result.device_id).toBe("d1");
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/v1/messenger/keys",
        expect.objectContaining({ method: "PUT", body: JSON.stringify({ device_id: "d1", public_key: "k", alg: "p256-aesgcm" }) }),
      );
    });

    it("fetches a peer's keys", async () => {
      mockFetch([{ user_id: "u2", device_id: "d9", public_key: "peer", alg: "p256-aesgcm", updated_at: "2025-01-01T00:00:00Z" }]);
      const result = await messengerApi.getUserKeys("u2");
      expect(result).toHaveLength(1);
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/v1/messenger/users/u2/keys",
        expect.any(Object),
      );
    });

    it("switches a conversation to e2e mode", async () => {
      mockFetch({ encryption_mode: "e2e" });
      const result = await messengerApi.updateEncryptionMode("conv-1", "e2e");
      expect(result).toEqual({ encryption_mode: "e2e" });
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/v1/messenger/conversations/conv-1/encryption",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ mode: "e2e" }) }),
      );
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
