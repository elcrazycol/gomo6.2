import { describe, it, expect } from "vitest";
import {
  formatTime,
  formatDate,
  formatConversationDate,
  formatPresence,
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

  describe("formatDate", () => {
    it("returns 'Сегодня' for today", () => {
      const today = new Date().toISOString();
      expect(formatDate(today)).toBe("Сегодня");
    });

    it("returns 'Вчера' for yesterday", () => {
      const yesterday = new Date(Date.now() - 86400000).toISOString();
      expect(formatDate(yesterday)).toBe("Вчера");
    });

    it("returns formatted date for older dates", () => {
      const oldDate = "2024-01-15T00:00:00Z";
      const result = formatDate(oldDate);
      // "15 января" — Cyrillic characters won't match \w, just check it's not empty and not today/yesterday
      expect(result).not.toBe("");
      expect(result).not.toBe("Сегодня");
      expect(result).not.toBe("Вчера");
    });

    it("returns empty string for null", () => {
      expect(formatDate(null)).toBe("");
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

  describe("formatPresence", () => {
    it("returns 'онлайн' when online", () => {
      expect(formatPresence(true, null)).toBe("онлайн");
    });

    it("returns 'не в сети' when offline with no lastSeen", () => {
      expect(formatPresence(false, null)).toBe("не в сети");
      expect(formatPresence(null, null)).toBe("не в сети");
    });

    it("returns 'был(а)' prefix with date when offline with lastSeen", () => {
      const result = formatPresence(false, "2025-06-01T12:00:00Z");
      expect(result).toMatch(/^был\(а\)/);
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
