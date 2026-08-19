import { describe, it, expect } from "vitest";
import i18n from "@/i18n";
import { notificationLink, isWallNotification, notificationTitle } from "./notifications";
import type { Notification } from "@/integrations/api/client";

const base = {
  id: "n1",
  user_id: "me",
  type: "like",
  title: "t",
  message: "",
  is_read: false,
  created_at: "2025-01-01T00:00:00Z",
} satisfies Notification;

describe("notificationLink", () => {
  it("links wall events to the wall post page", () => {
    const n: Notification = {
      ...base,
      type: "wall_comment",
      related_wall_post_id: "post-1",
      related_wall_user_id: "wall-owner",
    };
    expect(notificationLink(n)).toBe("/profile/wall-owner/wall/post-1");
  });

  it("falls back to the recipient's own wall when wall owner is missing", () => {
    const n: Notification = {
      ...base,
      type: "wall_post",
      related_wall_post_id: "post-2",
      user_id: "me",
    };
    expect(notificationLink(n)).toBe("/profile/me/wall/post-2");
  });

  it("links friend events to the actor profile", () => {
    const n: Notification = { ...base, type: "friend_request", related_user_id: "alice" };
    expect(notificationLink(n)).toBe("/profile/alice");
  });

  it("links thread events via slug when provided", () => {
    const n: Notification = { ...base, type: "reply", related_thread_id: "t1" };
    expect(notificationLink(n, "b")).toBe("/b/thread/t1");
  });

  it("falls back to # for notifications with no target", () => {
    expect(notificationLink({ ...base, type: "achievement_unlock" })).toBe("#");
  });
});

describe("isWallNotification", () => {
  it("recognizes wall event types", () => {
    expect(isWallNotification("wall_post_like")).toBe(true);
    expect(isWallNotification("like")).toBe(false);
  });
});

describe("notificationTitle", () => {
  const t = i18n.t.bind(i18n);

  it("renders a post-like from params", () => {
    const n: Notification = {
      ...base,
      type: "like",
      related_post_id: "p1",
      params: { actor: "alice" },
    };
    expect(notificationTitle(n, t)).toBe("@alice оценил(а) ваш пост");
  });

  it("renders a thread-like when there is no related post", () => {
    const n: Notification = {
      ...base,
      type: "like",
      related_thread_id: "t1",
      params: { actor: "alice" },
    };
    expect(notificationTitle(n, t)).toBe("@alice оценил(а) ваш тред");
  });

  it("renders a wall-like burst with a count", () => {
    const n: Notification = {
      ...base,
      type: "wall_post_like",
      params: { actor: "alice", count: 2 },
    };
    expect(notificationTitle(n, t)).toBe("@alice оценил(а) 2 из ваших записей");
  });

  it("renders an anonymous gift without an actor handle", () => {
    const n: Notification = {
      ...base,
      type: "gift_received",
      params: { anonymous: true, gift_name: "Роза" },
    };
    expect(notificationTitle(n, t)).toBe("🎁 Аноним подарил(а) вам Роза");
  });

  it("renders a friend request from params", () => {
    const n: Notification = {
      ...base,
      type: "friend_request",
      params: { actor: "bob" },
    };
    expect(notificationTitle(n, t)).toBe("@bob хочет добавить вас в друзья");
  });

  it("falls back to the baked title for legacy rows without params", () => {
    const n: Notification = { ...base, title: "legacy title" };
    expect(notificationTitle(n, t)).toBe("legacy title");
  });
});
