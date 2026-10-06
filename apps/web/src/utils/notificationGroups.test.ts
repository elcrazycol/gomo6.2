import { describe, it, expect } from "vitest";

import { dayLabel, groupByDay } from "./notificationGroups";
import type { Notification } from "@/integrations/api/client";

const t = (key: string) =>
  key === "notif.today" ? "Сегодня" : key === "notif.yesterday" ? "Вчера" : key;

const notif = (id: string, createdAt: string) =>
  ({ id, created_at: createdAt, is_read: false }) as unknown as Notification;

// Local-time constructors so the assertions do not depend on the test machine's
// timezone (the grouping is done in local time).
const NOW = new Date(2026, 9, 20, 12, 0, 0); // 20 Oct 2026, 12:00 local
const at = (y: number, m: number, d: number, h = 9) => new Date(y, m, d, h).toISOString();

describe("dayLabel", () => {
  it("labels today and yesterday", () => {
    expect(dayLabel(new Date(2026, 9, 20, 9), NOW, t, "ru-RU")).toBe("Сегодня");
    expect(dayLabel(new Date(2026, 9, 19, 23), NOW, t, "ru-RU")).toBe("Вчера");
  });

  it("labels an older date in the current year without the year", () => {
    expect(dayLabel(new Date(2026, 9, 5, 9), NOW, t, "ru-RU")).toBe("5 октября");
  });

  it("adds the year for another year", () => {
    expect(dayLabel(new Date(2025, 9, 5, 9), NOW, t, "ru-RU")).toContain("2025");
  });
});

describe("groupByDay", () => {
  it("groups consecutive same-day items and preserves the order", () => {
    const groups = groupByDay(
      [notif("a", at(2026, 9, 20, 10)), notif("b", at(2026, 9, 20, 9)), notif("c", at(2026, 9, 19, 9))],
      NOW,
      t,
      "ru-RU",
    );

    expect(groups.map((g) => g.label)).toEqual(["Сегодня", "Вчера"]);
    expect(groups[0].items.map((n) => n.id)).toEqual(["a", "b"]);
    expect(groups[1].items.map((n) => n.id)).toEqual(["c"]);
  });

  it("returns no groups for an empty list", () => {
    expect(groupByDay([], NOW, t, "ru-RU")).toEqual([]);
  });
});
