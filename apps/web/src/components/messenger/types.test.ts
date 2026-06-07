import { describe, it, expect } from "vitest";
import { mergeMessages } from "./types";
import type { MessageView } from "./types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const USER_A = "user-a";
const USER_B = "user-b";

function msg(overrides: Partial<MessageView> & { id: string; client_message_id: string }): MessageView {
  return {
    conversation_id: "conv-1",
    sender_user_id: USER_B,
    sent_at: "2025-06-01T12:00:00Z",
    content_encrypted: "",
    content: "hello",
    plainText: "hello",
    peerDeliveredAt: null,
    peerReadAt: null,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("mergeMessages", () => {
  describe("basic merge", () => {
    it("returns normalized messages when current is empty", () => {
      const normalized = [
        msg({ id: "s1", client_message_id: "cm-s1", plainText: "first" }),
        msg({ id: "s2", client_message_id: "cm-s2", plainText: "second" }),
      ];
      const result = mergeMessages([], normalized, USER_A);
      expect(result).toEqual(normalized);
    });

    it("returns an empty array when both inputs are empty", () => {
      const result = mergeMessages([], [], USER_A);
      expect(result).toEqual([]);
    });

    it("deduplicates by client_message_id when server returns same messages", () => {
      const current = [
        msg({ id: "s1", client_message_id: "cm-s1", plainText: "first" }),
        msg({ id: "s2", client_message_id: "cm-s2", plainText: "second" }),
      ];
      const normalized = [
        msg({ id: "s1", client_message_id: "cm-s1", plainText: "first" }),
        msg({ id: "s2", client_message_id: "cm-s2", plainText: "second" }),
      ];
      const result = mergeMessages(current, normalized, USER_A);
      expect(result).toHaveLength(2);
    });

    it("sorts messages by sent_at ascending", () => {
      const normalized = [
        msg({ id: "s2", client_message_id: "cm-s2", sent_at: "2025-06-01T12:02:00Z", plainText: "second" }),
        msg({ id: "s1", client_message_id: "cm-s1", sent_at: "2025-06-01T12:01:00Z", plainText: "first" }),
      ];
      const result = mergeMessages([], normalized, USER_A);
      expect(result[0].id).toBe("s1");
      expect(result[1].id).toBe("s2");
    });
  });

  describe("pending messages", () => {
    it("keeps pending messages not yet on server", () => {
      const current = [
        msg({ id: "s1", client_message_id: "cm-s1", plainText: "confirmed" }),
        msg({
          id: "local-1", client_message_id: "cm-pending", plainText: "pending msg",
          localStatus: "pending", sender_user_id: USER_A,
        }),
      ];
      const normalized = [
        msg({ id: "s1", client_message_id: "cm-s1", plainText: "confirmed" }),
      ];
      const result = mergeMessages(current, normalized, USER_A);
      expect(result).toHaveLength(2);
      expect(result.find((m) => m.client_message_id === "cm-pending")).toBeDefined();
      expect(result.find((m) => m.client_message_id === "cm-pending")?.localStatus).toBe("pending");
    });

    it("replaces pending message with server version when confirmed", () => {
      const current = [
        msg({ id: "s1", client_message_id: "cm-s1", plainText: "old" }),
        msg({
          id: "local-1", client_message_id: "cm-pending-1", plainText: "just sent",
          localStatus: "pending", sender_user_id: USER_A,
        }),
      ];
      const normalized = [
        msg({ id: "s1", client_message_id: "cm-s1", plainText: "old" }),
        msg({
          id: "s2", client_message_id: "cm-pending-1", plainText: "just sent",
          sender_user_id: USER_A,
        }),
      ];
      const result = mergeMessages(current, normalized, USER_A);
      expect(result).toHaveLength(2);
      const confirmed = result.find((m) => m.client_message_id === "cm-pending-1");
      expect(confirmed).toBeDefined();
      expect(confirmed?.id).toBe("s2");
      expect(confirmed?.localStatus).toBeUndefined();
    });

    it("merges multiple pending messages — some confirmed, some not", () => {
      const current = [
        msg({ id: "s1", client_message_id: "cm-s1", plainText: "old" }),
        msg({
          id: "local-1", client_message_id: "cm-p1", plainText: "pending 1",
          localStatus: "pending", sender_user_id: USER_A,
        }),
        msg({
          id: "local-2", client_message_id: "cm-p2", plainText: "pending 2",
          localStatus: "pending", sender_user_id: USER_A,
        }),
      ];
      const normalized = [
        msg({ id: "s1", client_message_id: "cm-s1", plainText: "old" }),
        msg({
          id: "s2", client_message_id: "cm-p1", plainText: "pending 1",
          sender_user_id: USER_A,
        }),
      ];
      const result = mergeMessages(current, normalized, USER_A);
      expect(result).toHaveLength(3);
      expect(result.find((m) => m.client_message_id === "cm-p1")?.id).toBe("s2");
      expect(result.find((m) => m.client_message_id === "cm-p1")?.localStatus).toBeUndefined();
      expect(result.find((m) => m.client_message_id === "cm-p2")?.localStatus).toBe("pending");
    });

    it("does not match pending messages from other users", () => {
      const current = [
        msg({
          id: "local-1", client_message_id: "cm-p1", plainText: "other's pending",
          localStatus: "pending", sender_user_id: USER_B,
        }),
      ];
      const normalized = [
        msg({
          id: "s1", client_message_id: "cm-p1", plainText: "other's pending",
          sender_user_id: USER_B,
        }),
      ];
      const result = mergeMessages(current, normalized, USER_A);
      const pending = result.find((m) => m.client_message_id === "cm-p1");
      expect(pending?.localStatus).toBe("pending");
    });

    it("preserves plainText from pending when server version is encrypted", () => {
      const current = [
        msg({
          id: "local-1", client_message_id: "cm-p1", plainText: "my secret message",
          content: "", content_encrypted: "",
          localStatus: "pending", sender_user_id: USER_A,
        }),
      ];
      const normalized = [
        msg({
          id: "s1", client_message_id: "cm-p1", plainText: "[encrypted]",
          content: "[encrypted]", content_encrypted: "encrypted-blob",
          sender_user_id: USER_A,
        }),
      ];
      const result = mergeMessages(current, normalized, USER_A);
      const merged = result.find((m) => m.client_message_id === "cm-p1");
      expect(merged?.plainText).toBe("my secret message");
      expect(merged?.content_encrypted).toBe("encrypted-blob");
    });

    it("preserves cache of peerDeliveredAt via ?? fallback when server has no receipt yet", () => {
      // Pending message had peerDeliveredAt set (other user already received it),
      // but the server hasn't synced this receipt yet. The ?? fallback should preserve it.
      const current = [
        msg({
          id: "local-1", client_message_id: "cm-p1", plainText: "hello",
          content: "", content_encrypted: "",
          localStatus: "pending", sender_user_id: USER_A,
          peerDeliveredAt: "2025-06-01T12:01:00Z",
          peerReadAt: null,
        }),
      ];
      const normalized = [
        msg({
          id: "s1", client_message_id: "cm-p1", plainText: "hello",
          content: "hello", content_encrypted: "",
          sender_user_id: USER_A,
          peerDeliveredAt: null, // server hasn't synced yet
          peerReadAt: null,
        }),
      ];
      const result = mergeMessages(current, normalized, USER_A);
      const merged = result.find((m) => m.client_message_id === "cm-p1");
      expect(merged?.id).toBe("s1");
      expect(merged?.peerDeliveredAt).toBe("2025-06-01T12:01:00Z"); // kept from pending
      expect(merged?.peerReadAt).toBeNull();
    });
  });

  describe("incremental load scenarios", () => {
    it("merges new server messages with existing confirmed ones", () => {
      const current = [
        msg({ id: "s1", client_message_id: "cm-s1", sent_at: "2025-06-01T12:00:00Z", plainText: "old" }),
        msg({ id: "s2", client_message_id: "cm-s2", sent_at: "2025-06-01T12:01:00Z", plainText: "second" }),
      ];
      const normalized = [
        msg({ id: "s1", client_message_id: "cm-s1", sent_at: "2025-06-01T12:00:00Z", plainText: "old" }),
        msg({ id: "s2", client_message_id: "cm-s2", sent_at: "2025-06-01T12:01:00Z", plainText: "second" }),
        msg({ id: "s3", client_message_id: "cm-s3", sent_at: "2025-06-01T12:02:00Z", plainText: "new" }),
      ];
      const result = mergeMessages(current, normalized, USER_A);
      expect(result).toHaveLength(3);
      expect(result[2].id).toBe("s3");
    });

    it("handles race: pending confirmed by server AND new messages arrive simultaneously", () => {
      const current = [
        msg({ id: "s1", client_message_id: "cm-s1", plainText: "old" }),
        msg({
          id: "local-1", client_message_id: "cm-p1", plainText: "just sent",
          localStatus: "pending", sender_user_id: USER_A,
        }),
      ];
      const normalized = [
        msg({ id: "s1", client_message_id: "cm-s1", plainText: "old" }),
        msg({
          id: "s2", client_message_id: "cm-p1", plainText: "just sent",
          sender_user_id: USER_A,
        }),
        msg({ id: "s3", client_message_id: "cm-s3", sent_at: "2025-06-01T12:03:00Z", plainText: "reply!" }),
      ];
      const result = mergeMessages(current, normalized, USER_A);
      expect(result).toHaveLength(3);
      expect(result.find((m) => m.client_message_id === "cm-p1")?.id).toBe("s2");
      expect(result.find((m) => m.client_message_id === "cm-p1")?.localStatus).toBeUndefined();
      expect(result.find((m) => m.client_message_id === "cm-s3")?.plainText).toBe("reply!");
    });
  });

  describe("sorting", () => {
    it("maintains chronological order after merge", () => {
      const current = [
        msg({ id: "s1", client_message_id: "cm-s1", sent_at: "2025-06-01T12:00:00Z", plainText: "first" }),
        msg({
          id: "local-1", client_message_id: "cm-p1", sent_at: "2025-06-01T12:05:00Z",
          plainText: "pending late", localStatus: "pending", sender_user_id: USER_A,
        }),
      ];
      const normalized = [
        msg({ id: "s1", client_message_id: "cm-s1", sent_at: "2025-06-01T12:00:00Z", plainText: "first" }),
        msg({ id: "s2", client_message_id: "cm-s2", sent_at: "2025-06-01T12:02:00Z", plainText: "middle" }),
        msg({ id: "s3", client_message_id: "cm-s3", sent_at: "2025-06-01T12:04:00Z", plainText: "almost late" }),
      ];
      const result = mergeMessages(current, normalized, USER_A);
      expect(result).toHaveLength(4);
      expect(result[0].id).toBe("s1");
      expect(result[1].id).toBe("s2");
      expect(result[2].id).toBe("s3");
      expect(result[3].id).toBe("local-1");
    });
  });
});
