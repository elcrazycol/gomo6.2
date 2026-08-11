import { describe, it, expect, vi, beforeEach } from "vitest";
import { rpc } from "./rpc";

const mocks = vi.hoisted(() => ({
  getPostLikesCount: vi.fn(),
  getThreadLikesCount: vi.fn(),
  getPostLikesBatch: vi.fn(),
  getThreadLikesBatch: vi.fn(),
  hasUserLikedPost: vi.fn(),
  hasUserLikedThread: vi.fn(),
  getRecentPostLikers: vi.fn(),
  getRecentThreadLikers: vi.fn(),
  getUserLikesReceivedCount: vi.fn(),
  getUserThreadLikesReceivedCount: vi.fn(),
  getUserPostLikesReceivedTimestamps: vi.fn(),
  getUserThreadLikesReceivedTimestamps: vi.fn(),
  getUserThreadReplyTimestamps: vi.fn(),
  toggleWallPostPin: vi.fn(),
  rawRequest: vi.fn(),
}));

vi.mock("./client", () => ({
  apiClient: {
    getPostLikesCount: mocks.getPostLikesCount,
    getThreadLikesCount: mocks.getThreadLikesCount,
    getPostLikesBatch: mocks.getPostLikesBatch,
    getThreadLikesBatch: mocks.getThreadLikesBatch,
    hasUserLikedPost: mocks.hasUserLikedPost,
    hasUserLikedThread: mocks.hasUserLikedThread,
    getRecentPostLikers: mocks.getRecentPostLikers,
    getRecentThreadLikers: mocks.getRecentThreadLikers,
    getUserLikesReceivedCount: mocks.getUserLikesReceivedCount,
    getUserThreadLikesReceivedCount: mocks.getUserThreadLikesReceivedCount,
    getUserPostLikesReceivedTimestamps: mocks.getUserPostLikesReceivedTimestamps,
    getUserThreadLikesReceivedTimestamps: mocks.getUserThreadLikesReceivedTimestamps,
    getUserThreadReplyTimestamps: mocks.getUserThreadReplyTimestamps,
    toggleWallPostPin: mocks.toggleWallPostPin,
    rawRequest: mocks.rawRequest,
  },
}));

const ok = (data: unknown) => ({ data, error: null });

describe("rpc() compatibility wrapper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("likes-count RPC functions", () => {
    it("get_post_likes_count delegates with post_uuid", async () => {
      mocks.getPostLikesCount.mockResolvedValue(ok(42));
      const result = await rpc("get_post_likes_count", { post_uuid: "p-1" });

      expect(mocks.getPostLikesCount).toHaveBeenCalledWith("p-1");
      expect(result).toEqual({ data: 42, error: null });
    });

    it("get_thread_likes_count delegates with thread_uuid", async () => {
      mocks.getThreadLikesCount.mockResolvedValue(ok(7));
      const result = await rpc("get_thread_likes_count", { thread_uuid: "t-1" });

      expect(mocks.getThreadLikesCount).toHaveBeenCalledWith("t-1");
      expect(result).toEqual({ data: 7, error: null });
    });
  });

  describe("batch like lookups", () => {
    it("get_post_likes_batch splits and filters empty ids", async () => {
      mocks.getPostLikesBatch.mockResolvedValue(ok([{ id: "p1", likes: 3 }]));
      const result = await rpc("get_post_likes_batch", {
        post_ids: "p1,p2,,p3",
        user_uuid: "u-1",
      });

      expect(mocks.getPostLikesBatch).toHaveBeenCalledWith(["p1", "p2", "p3"], "u-1");
      expect(result.data).toEqual([{ id: "p1", likes: 3 }]);
    });

    it("get_post_likes_batch with missing ids passes empty array", async () => {
      mocks.getPostLikesBatch.mockResolvedValue(ok([]));
      await rpc("get_post_likes_batch", {});

      expect(mocks.getPostLikesBatch).toHaveBeenCalledWith([], undefined);
    });

    it("get_thread_likes_batch splits ids and passes user_uuid", async () => {
      mocks.getThreadLikesBatch.mockResolvedValue(ok([]));
      await rpc("get_thread_likes_batch", { thread_ids: "t1,t2", user_uuid: "u-2" });

      expect(mocks.getThreadLikesBatch).toHaveBeenCalledWith(["t1", "t2"], "u-2");
    });
  });

  describe("has-liked RPC functions", () => {
    it("has_user_liked_post", async () => {
      mocks.hasUserLikedPost.mockResolvedValue(ok(true));
      const result = await rpc("has_user_liked_post", { post_uuid: "p-1", user_uuid: "u-1" });

      expect(mocks.hasUserLikedPost).toHaveBeenCalledWith("p-1", "u-1");
      expect(result.data).toBe(true);
    });

    it("has_user_liked_thread", async () => {
      mocks.hasUserLikedThread.mockResolvedValue(ok(false));
      const result = await rpc("has_user_liked_thread", { thread_uuid: "t-1", user_uuid: "u-1" });

      expect(mocks.hasUserLikedThread).toHaveBeenCalledWith("t-1", "u-1");
      expect(result.data).toBe(false);
    });
  });

  describe("recent likers with numeric limit", () => {
    it("get_recent_post_likers coerces limit_count to number", async () => {
      mocks.getRecentPostLikers.mockResolvedValue(ok([{ id: "u1" }]));
      await rpc("get_recent_post_likers", { post_uuid: "p-1", limit_count: "5" });

      expect(mocks.getRecentPostLikers).toHaveBeenCalledWith("p-1", 5);
    });

    it("get_recent_thread_likers coerces limit_count to number", async () => {
      mocks.getRecentThreadLikers.mockResolvedValue(ok([]));
      await rpc("get_recent_thread_likers", { thread_uuid: "t-1", limit_count: "3" });

      expect(mocks.getRecentThreadLikers).toHaveBeenCalledWith("t-1", 3);
    });
  });

  describe("user received-likes counters", () => {
    it("get_user_likes_received_count", async () => {
      mocks.getUserLikesReceivedCount.mockResolvedValue(ok(15));
      const result = await rpc("get_user_likes_received_count", { user_uuid: "u-1" });

      expect(mocks.getUserLikesReceivedCount).toHaveBeenCalledWith("u-1");
      expect(result.data).toBe(15);
    });

    it("get_user_thread_likes_received_count", async () => {
      mocks.getUserThreadLikesReceivedCount.mockResolvedValue(ok(9));
      await rpc("get_user_thread_likes_received_count", { user_uuid: "u-1" });

      expect(mocks.getUserThreadLikesReceivedCount).toHaveBeenCalledWith("u-1");
    });

    it("get_user_post_likes_received_timestamps", async () => {
      mocks.getUserPostLikesReceivedTimestamps.mockResolvedValue(ok(["2024-01-01"]));
      const result = await rpc("get_user_post_likes_received_timestamps", { user_uuid: "u-1" });

      expect(mocks.getUserPostLikesReceivedTimestamps).toHaveBeenCalledWith("u-1");
      expect(result.data).toEqual(["2024-01-01"]);
    });

    it("get_user_thread_likes_received_timestamps", async () => {
      mocks.getUserThreadLikesReceivedTimestamps.mockResolvedValue(ok([]));
      await rpc("get_user_thread_likes_received_timestamps", { user_uuid: "u-1" });

      expect(mocks.getUserThreadLikesReceivedTimestamps).toHaveBeenCalledWith("u-1");
    });

    it("get_user_thread_reply_timestamps", async () => {
      mocks.getUserThreadReplyTimestamps.mockResolvedValue(ok([]));
      await rpc("get_user_thread_reply_timestamps", { user_uuid: "u-1" });

      expect(mocks.getUserThreadReplyTimestamps).toHaveBeenCalledWith("u-1");
    });
  });

  describe("raw RPC passthrough functions", () => {
    it("toggle_wall_post_pin delegates to the apiClient method", async () => {
      mocks.toggleWallPostPin.mockResolvedValue(ok({ pinned: true }));
      const result = await rpc("toggle_wall_post_pin", { _post_id: "p-1", _user_id: "u-1" });

      expect(mocks.toggleWallPostPin).toHaveBeenCalledWith("p-1", "u-1");
      expect(result).toEqual({ data: { pinned: true }, error: null });
    });

    it("get_avatar_history returns the raw response data", async () => {
      mocks.rawRequest.mockResolvedValue({ data: ["a1", "a2"] });
      const result = await rpc("get_avatar_history", { user_uuid: "u-1" });

      expect(mocks.rawRequest).toHaveBeenCalledWith("/api/rpc/get_avatar_history", {
        method: "POST",
        body: JSON.stringify({ user_uuid: "u-1" }),
      });
      expect(result.data).toEqual(["a1", "a2"]);
    });

    it("delete_avatar_from_history returns the raw response data", async () => {
      mocks.rawRequest.mockResolvedValue({ data: { deleted: true } });
      const result = await rpc("delete_avatar_from_history", { avatar_id: "a1" });

      expect(mocks.rawRequest).toHaveBeenCalledWith("/api/rpc/delete_avatar_from_history", expect.anything());
      expect(result.data).toEqual({ deleted: true });
    });

    it("toggle_achievement_pin returns the raw response data", async () => {
      mocks.rawRequest.mockResolvedValue({ data: { pinned: false } });
      const result = await rpc("toggle_achievement_pin", { achievement_id: "ach-1" });

      expect(mocks.rawRequest).toHaveBeenCalledWith("/api/rpc/toggle_achievement_pin", expect.anything());
      expect(result.data).toEqual({ pinned: false });
    });

    it("get_or_create_direct_chat falls back to the whole response when data is absent", async () => {
      // Go handler returns a plain string body → rawRequest resolves without a data field
      mocks.rawRequest.mockResolvedValue({ conversation_id: "conv-1" });
      const result = await rpc("get_or_create_direct_chat", { user_uuid: "u-1" });

      expect(mocks.rawRequest).toHaveBeenCalledWith("/api/rpc/get_or_create_direct_chat", expect.anything());
      expect(result.data).toEqual({ conversation_id: "conv-1" });
    });
  });

  describe("chat receipts", () => {
    it("chat_mark_delivered returns null data on success", async () => {
      mocks.rawRequest.mockResolvedValue(null);
      const result = await rpc("chat_mark_delivered", { conversation_id: "c-1" });

      expect(mocks.rawRequest).toHaveBeenCalledWith("/api/rpc/chat_mark_delivered", {
        method: "POST",
        body: JSON.stringify({ conversation_id: "c-1" }),
      });
      expect(result).toEqual({ data: null, error: null });
    });

    it("chat_mark_read returns null data on success", async () => {
      mocks.rawRequest.mockResolvedValue(null);
      const result = await rpc("chat_mark_read", { conversation_id: "c-1" });

      expect(mocks.rawRequest).toHaveBeenCalledWith("/api/rpc/chat_mark_read", expect.anything());
      expect(result).toEqual({ data: null, error: null });
    });
  });

  describe("unknown functions and error paths", () => {
    it("returns an error envelope for unknown RPC function names", async () => {
      const result = await rpc("does_not_exist", { a: 1 });

      expect(result).toEqual({ data: null, error: { message: "Unknown RPC function" } });
      expect(mocks.rawRequest).not.toHaveBeenCalled();
    });

    it("wraps apiClient errors into the error envelope", async () => {
      const boom = new Error("network down");
      mocks.getPostLikesCount.mockRejectedValue(boom);

      const result = await rpc("get_post_likes_count", { post_uuid: "p-1" });
      expect(result).toEqual({ data: null, error: boom });
    });

    it("wraps rawRequest errors into the error envelope", async () => {
      const boom = new Error("403 forbidden");
      mocks.rawRequest.mockRejectedValue(boom);

      const result = await rpc("get_avatar_history", {});
      expect(result).toEqual({ data: null, error: boom });
    });
  });
});
