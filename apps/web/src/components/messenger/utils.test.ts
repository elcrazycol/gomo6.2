import { describe, it, expect } from "vitest";
import {
  formatTime,
  formatConversationDate,
  formatPresence,
  formatReadAt,
  getInitials,
} from "./utils";

describe("utils", () => {
  describe("formatTime", () => {
    it("returns HH:MM for valid date", () => {
      // Use a fixed date to avoid timezone issues in CI
      const time = formatTime("2025-06-01T14:30:00Z");
      // Just check it looks like a time
      expect(time).toMatch(/^\d{2}:\d{2}$/);
    });

    it("returns empty string for null", () => {
      expect(formatTime(null)).toBe("");
    });
  });

  describe("formatConversationDate", () => {
    it("returns time for today", () => {
      const today = new Date().toISOString();
      const result = formatConversationDate(today);
      expect(result).toMatch(/^\d{2}:\d{2}$/);
    });

    it("returns 'Вчера' for yesterday", () => {
      const yesterday = new Date(Date.now() - 86400000).toISOString();
      expect(formatConversationDate(yesterday)).toBe("Вчера");
    });

    it("returns 'N дн.' for within a week", () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
      const result = formatConversationDate(threeDaysAgo);
      expect(result).toMatch(/^\d+ дн\.$/);
    });

    it("returns empty string for null", () => {
      expect(formatConversationDate(null)).toBe("");
    });
  });

  describe("formatReadAt", () => {
    it("returns 'Сегодня в HH:MM' for today", () => {
      const today = new Date().toISOString();
      const result = formatReadAt(today);
      expect(result).toMatch(/^Сегодня в \d{2}:\d{2}$/);
    });

    it("returns 'Вчера в HH:MM' for yesterday", () => {
      const yesterday = new Date(Date.now() - 86400000).toISOString();
      const result = formatReadAt(yesterday);
      expect(result).toMatch(/^Вчера в \d{2}:\d{2}$/);
    });

    it("returns 'DD.MM в HH:MM' for older dates", () => {
      const result = formatReadAt("2025-01-05T10:15:00Z");
      expect(result).toMatch(/^\d{2}\.\d{2} в \d{2}:\d{2}$/);
    });

    it("returns empty string for null or invalid", () => {
      expect(formatReadAt(null)).toBe("");
      expect(formatReadAt("not-a-date")).toBe("");
    });
  });

  describe("formatPresence", () => {
    it("returns 'онлайн' when online", () => {
      expect(formatPresence(true, null)).toBe("онлайн");
    });

    it("returns 'не в сети' when offline with no lastSeen", () => {
      expect(formatPresence(false, null)).toBe("не в сети");
      expect(formatPresence(null, null)).toBe("не в сети");
    });

    it("returns 'был(а) только что' when offline within the last minute", () => {
      const justNow = new Date(Date.now() - 30_000).toISOString();
      expect(formatPresence(false, justNow)).toBe("был(а) только что");
    });

    it("returns relative 'был(а) в сети N назад' for older offline", () => {
      const result = formatPresence(false, "2025-06-01T12:00:00Z");
      expect(result).toMatch(/^был\(а\) в сети .+ назад$/);
    });

    it("returns 'не в сети' for an invalid lastSeen date", () => {
      expect(formatPresence(false, "not-a-date")).toBe("не в сети");
    });

    it("online takes precedence over lastSeen", () => {
      expect(formatPresence(true, "2025-01-01T00:00:00Z")).toBe("онлайн");
    });
  });

  describe("getInitials", () => {
    it("returns first 2 characters uppercase", () => {
      expect(getInitials("alice")).toBe("AL");
    });

    it("handles short names", () => {
      expect(getInitials("a")).toBe("A");
    });

    it("handles cyrillic", () => {
      expect(getInitials("привет")).toBe("ПР");
    });
  });
});
